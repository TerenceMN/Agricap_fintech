"""Services investissements — façade du module.

Le mouvement d'argent réel est TOUJOURS délégué à `transactions`/`caisses` (référencé en
FK sur `Movement.transaction`) ; cette app ne détient jamais elle-même le solde. Elle
orchestre le cycle et produit les événements que la comptabilité consomme.

Répartition des responsabilités depuis le lot « cycle de vie » :

- `workflow.py` : machine à états P01→P13, gardes, journal des transitions ;
- `committee.py` : quorum du comité d'investissement (P04) ;
- `funding.py` : réservation, encaissement, clôture, décaissement, retours, distributions ;
- `metrics.py` : XIRR, défaut, concentration, score de santé ;
- ce fichier : création des entités et opérations sans effet monétaire.
"""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from audit.services import record as audit_record
from common.exceptions import ValidationFailed
from common.parsing import to_date, to_decimal

from . import funding, workflow
from .models import (
    AnalystObservation, FinancialAnalysis, InvestmentConfig, Investor, Offer, PerformanceReport,
    Project, Subscription, TechnicalAnalysis,
)

#: Ré-export : le graphe canonique vit dans `workflow.py`, un seul endroit.
ALLOWED_TRANSITIONS = workflow.ALLOWED_TRANSITIONS

#: Ré-exports des services monétaires — les appelants historiques n'ont pas à savoir
#: dans quel module la mécanique a été rangée.
reserve = funding.reserve
settle = funding.settle
cancel_reservation = funding.cancel_reservation
close_offer = funding.close_offer
close_fundraising = funding.close_fundraising
disburse = funding.disburse
record_return = funding.record_return
distribute = funding.distribute
refund_project = funding.refund_project
cancel_project = funding.cancel_project


@transaction.atomic
def create_project(*, code: str, title: str, sector: str = "", location: str = "",
                    funding_target: Decimal | str = "0", promoter: str = "", manager_sub: str = "",
                    by: str = "") -> Project:
    if not code or not title:
        raise ValidationFailed("Code et titre du projet requis.")
    if Project.objects.filter(code=code).exists():
        raise ValidationFailed(f"Le code projet « {code} » existe déjà.")
    project = Project.objects.create(
        code=code, title=title, sector=sector, location=location,
        funding_target=to_decimal(funding_target), promoter=promoter, manager_sub=manager_sub, created_by=by,
    )
    audit_record(actor=by, action="investments.project.create", entity_type="Project", entity_id=project.code)
    return project


def transition_status(*, project: Project, to_status: str, by: str = "", reason: str = "",
                       actor_role: str = "", details: dict | None = None) -> Project:
    """Façade de `workflow.transition` — point d'entrée unique du changement de statut.

    Aucun motif de complaisance n'est fabriqué ici : « Passage en P08 » n'explique rien.
    Un appelant qui ne fournit pas de motif reçoit `TRANSITION_REASON_REQUIRED`.
    """
    return workflow.transition(project, to_status=to_status, actor_sub=by, reason=reason,
                                actor_role=actor_role, details=details)


@transaction.atomic
def approve_analysis(*, project: Project, kind: str, by: str = "") -> Project:
    """Approuve l'analyse technique ou financière — condition d'entrée en comité (P04).

    L'approbation est un acte humain daté et signé : c'est elle que la garde de P04
    vérifie, pas la simple existence d'un enregistrement d'analyse.
    """
    kind = (kind or "").strip().lower()
    modele = {"technical": TechnicalAnalysis, "financial": FinancialAnalysis}.get(kind)
    if modele is None:
        raise ValidationFailed("Type d'analyse inconnu : attendu « technical » ou « financial ».")
    analysis = modele.objects.filter(project=project).first()
    if analysis is None:
        raise ValidationFailed(
            f"Aucune analyse {kind} enregistrée sur ce projet : il n'y a rien à approuver."
        )
    analysis.approved_at = timezone.now()
    analysis.approved_by = by
    analysis.save(update_fields=["approved_at", "approved_by", "updated_at"])
    audit_record(actor=by, action=f"investments.analysis.{kind}.approve", entity_type="Project",
                 entity_id=project.code, details={"kind": kind})
    return project


@transaction.atomic
def clear_conditions(*, project: Project, by: str = "", note: str = "") -> Project:
    """Déclare levées les conditions posées par le comité — condition d'entrée en P06."""
    if project.status != Project.Status.P05:
        raise ValidationFailed(
            "Les conditions ne se lèvent que sur un projet en approbation conditionnelle (P05)."
        )
    if not (project.committee_conditions or "").strip():
        raise ValidationFailed("Aucune condition n'a été enregistrée pour ce projet.")
    project.conditions_cleared_at = timezone.now()
    project.save(update_fields=["conditions_cleared_at", "updated_at"])
    audit_record(actor=by, action="investments.project.conditions_cleared", entity_type="Project",
                 entity_id=project.code, details={"note": note})
    return project


@transaction.atomic
def create_offer(*, project: Project, code: str, coupon_rate: Decimal | str, maturity_months: int,
                  min_ticket: Decimal | str, available_bonds: int, funding_goal: Decimal | str = "0",
                  min_funding_amount: Decimal | str | None = None, oversubscription_policy: str = "",
                  subscription_deadline=None, by: str = "") -> Offer:
    """Crée une offre. Le plancher de min-funding, s'il n'est pas donné, est dérivé du
    ratio paramétré en base — jamais d'un nombre écrit dans le code."""
    if Offer.objects.filter(code=code).exists():
        raise ValidationFailed(f"Le code offre « {code} » existe déjà.")
    goal = to_decimal(funding_goal)
    cfg = InvestmentConfig.active()
    if min_funding_amount in (None, ""):
        plancher = (goal * Decimal(cfg.default_min_funding_ratio)).quantize(Decimal("0.01"))
    else:
        plancher = to_decimal(min_funding_amount)
    if plancher > goal:
        raise ValidationFailed(
            f"Le plancher de min-funding ({plancher}) ne peut pas dépasser l'objectif ({goal})."
        )
    politique = (oversubscription_policy or cfg.default_oversubscription_policy or
                 Offer.Oversubscription.QUEUE)
    if politique not in Offer.Oversubscription.values:
        raise ValidationFailed(f"Politique de sursouscription inconnue : « {politique} ».")
    offer = Offer.objects.create(
        project=project, code=code, coupon_rate=to_decimal(coupon_rate), maturity_months=maturity_months,
        min_ticket=to_decimal(min_ticket), available_bonds=available_bonds, max_bonds=available_bonds,
        funding_goal=goal, min_funding_amount=plancher, oversubscription_policy=politique,
        subscription_deadline=to_date(subscription_deadline),
    )
    audit_record(actor=by, action="investments.offer.create", entity_type="Offer", entity_id=offer.code,
                 details={"fundingGoal": str(goal), "minFunding": str(plancher), "policy": politique})
    return offer


def subscribe(*, investor: Investor, offer_id: int, bonds: int, idempotency_key: str,
              by: str = "") -> Subscription:
    """Alias historique de `funding.reserve` — une souscription RÉSERVE, elle n'encaisse pas."""
    return funding.reserve(investor=investor, offer_id=offer_id, bonds=bonds,
                            idempotency_key=idempotency_key, by=by)


def submit_performance_report(*, project: Project, data: dict, by: str = "") -> PerformanceReport:
    actual_revenue = float(data.get("actualRevenue", 0) or 0)
    forecast_revenue = float(data.get("forecastRevenue", 0) or 0)
    deviation = round(((actual_revenue - forecast_revenue) / forecast_revenue) * 100, 2) if forecast_revenue else 0.0
    report = PerformanceReport.objects.create(
        project=project, reporting_period=data.get("reportingPeriod", ""),
        actual_revenue=actual_revenue, forecast_revenue=forecast_revenue,
        actual_costs=float(data.get("actualCosts", 0) or 0), forecast_costs=float(data.get("forecastCosts", 0) or 0),
        actual_production=float(data.get("actualProduction", 0) or 0),
        forecast_production=float(data.get("forecastProduction", 0) or 0),
        deviation_percent=deviation, deviation_comments=data.get("deviationComments", ""),
    )
    if abs(deviation) > 10:
        AnalystObservation.objects.create(
            project=project, category=AnalystObservation.Category.RISK,
            risk_flag=AnalystObservation.RiskFlag.HIGH,
            observation=f"Écart de {deviation}% détecté sur le rapport de performance "
                        f"{report.reporting_period or report.pk}.",
        )
    audit_record(actor=by, action="investments.performance_report.submit", entity_type="PerformanceReport",
                 entity_id=str(report.pk), details={"deviation_percent": deviation})
    return report


@transaction.atomic
def investor_action(*, investor: Investor, action: str, by: str = "") -> Investor:
    """Suspend/réactive un investisseur (pas de suppression — même logique que
    `agencies.services.suspend`/`unlock_temporary`)."""
    if action == "suspend":
        investor.status = Investor.Status.SUSPENDED
    elif action == "activate":
        investor.status = Investor.Status.ACTIVE
    else:
        raise ValidationFailed(f"Action inconnue : {action}")
    investor.save(update_fields=["status", "updated_at"])
    audit_record(actor=by, action=f"investments.investor.{action}", entity_type="Investor",
                 entity_id=str(investor.pk))
    return investor


def portfolio_allocation(*, investor: Investor) -> dict:
    """Allocation du portefeuille — sur l'argent RÉELLEMENT placé.

    Une souscription seulement réservée ne pèse pas dans une allocation d'actifs :
    elle n'est pas un actif, elle est une intention. Seuls les montants encaissés
    comptent (`settled_amount` sur les souscriptions vivantes).
    """
    from caisses.models import ClientWallet

    from .models import ObligationPosition
    bonds_total = Subscription.objects.filter(
        investor=investor, status__in=Subscription.FUNDED_STATUSES,
    ).aggregate(total=Sum("settled_amount"))["total"] or Decimal("0")
    obligations_total = ObligationPosition.objects.filter(investor=investor).aggregate(
        total=Sum("invested_amount"))["total"] or Decimal("0")
    cash_total = ClientWallet.objects.filter(user=investor.user).aggregate(total=Sum("balance"))["total"] or Decimal("0")
    return {
        "bonds": float(bonds_total + obligations_total),
        "cash": float(cash_total),
        # Aucun produit actions n'existe encore dans le système — trou produit assumé,
        # pas inventé silencieusement (voir le plan).
        "stocks": 0.0,
    }

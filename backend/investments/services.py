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
def set_expert_valuation(*, project: Project, amount, valuation_date, source: str = "",
                          by: str = "") -> Project:
    """Enregistre la valorisation d'expert d'un projet — Annexe D, titres de capital.

    Les trois éléments sont indissociables : une valeur sans date ni source n'est pas
    une expertise, c'est une opinion, et `metrics._expert_valuation()` la refusera. On
    refuse donc de l'enregistrer plutôt que de l'enregistrer pour la voir écartée en
    silence à l'affichage. Une expertise antidatée du futur n'existe pas non plus.

    Aucun écrasement muet : l'ancienne valeur part au journal d'audit, qui est
    append-only — la trajectoire des valorisations successives est elle-même une
    donnée (une action réévaluée trois fois en six mois se remarque).
    """
    montant = to_decimal(amount)
    if montant < Decimal("0"):
        raise ValidationFailed("Une valorisation d'expert ne peut pas être négative.")
    jour = to_date(valuation_date)
    if jour is None:
        raise ValidationFailed(
            "La date de la valorisation d'expert est obligatoire : une valeur sans date "
            "n'est pas une expertise."
        )
    if jour > timezone.now().date():
        raise ValidationFailed("La date de la valorisation d'expert ne peut pas être future.")
    if not (source or "").strip():
        raise ValidationFailed(
            "La source de la valorisation d'expert est obligatoire (cabinet, rapport, "
            "référence) : une valorisation sans auteur n'est pas opposable."
        )
    ancien = {
        "amount": str(project.expert_valuation) if project.expert_valuation is not None else None,
        "date": project.expert_valuation_date.isoformat() if project.expert_valuation_date else None,
        "source": project.expert_valuation_source,
    }
    project.expert_valuation = montant
    project.expert_valuation_date = jour
    project.expert_valuation_source = source.strip()
    project.save(update_fields=["expert_valuation", "expert_valuation_date",
                                 "expert_valuation_source", "updated_at"])
    audit_record(actor=by, action="investments.project.expert_valuation", entity_type="Project",
                 entity_id=project.code,
                 details={"previous": ancien, "amount": str(montant), "date": jour.isoformat(),
                          "source": project.expert_valuation_source})
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


def _deviation_percent(actual, forecast) -> Decimal:
    """`(réalisé − prévu) / prévu × 100`, en `Decimal`, quantifié à 0,01.

    Sans prévision, il n'y a pas d'écart — pas un écart de 0 % : `0` signifierait
    « conforme à la prévision », ce qui est faux quand aucune prévision n'a été posée.
    On retourne 0 faute de champ nullable dans un modèle déjà consommé, mais
    `has_forecast` ci-dessous permet à l'appelant de distinguer les deux cas.
    """
    prevu = to_decimal(forecast or 0)
    if prevu == 0:
        return Decimal("0.00")
    return ((to_decimal(actual or 0) - prevu) / prevu * Decimal("100")).quantize(Decimal("0.01"))


def submit_performance_report(*, project: Project, data: dict, by: str = "") -> PerformanceReport:
    """Enregistre le reporting du promoteur ET calcule SES écarts — les trois.

    L'écart de revenu était seul calculé côté serveur : les écrans recalculaient donc
    l'écart de coûts eux-mêmes, avec leur propre formule, pour une grandeur qui décide
    d'une observation de risque. Deux formules pour une grandeur, c'est l'incident de
    données du principe 11 en germe. Les trois écarts sont désormais calculés ici, une
    fois, et figés avec le rapport.

    Le seuil d'alerte vient de `InvestmentConfig` (principe 8), et le sens de chaque
    écart est respecté : des coûts SUPÉRIEURS à la prévision sont défavorables, des
    revenus supérieurs ne le sont pas.
    """
    cfg = InvestmentConfig.active()
    seuil = Decimal(cfg.performance_deviation_alert_percent)

    revenu = _deviation_percent(data.get("actualRevenue"), data.get("forecastRevenue"))
    couts = _deviation_percent(data.get("actualCosts"), data.get("forecastCosts"))
    production = _deviation_percent(data.get("actualProduction"), data.get("forecastProduction"))

    report = PerformanceReport.objects.create(
        project=project, reporting_period=data.get("reportingPeriod", ""),
        actual_revenue=float(to_decimal(data.get("actualRevenue", 0) or 0)),
        forecast_revenue=float(to_decimal(data.get("forecastRevenue", 0) or 0)),
        actual_costs=float(to_decimal(data.get("actualCosts", 0) or 0)),
        forecast_costs=float(to_decimal(data.get("forecastCosts", 0) or 0)),
        actual_production=float(to_decimal(data.get("actualProduction", 0) or 0)),
        forecast_production=float(to_decimal(data.get("forecastProduction", 0) or 0)),
        deviation_percent=float(revenu), cost_deviation_percent=float(couts),
        production_deviation_percent=float(production),
        deviation_comments=data.get("deviationComments", ""),
    )

    # Un écart de revenu ou de production s'apprécie en valeur absolue (une prévision
    # dépassée de 40 % est autant un signal sur la QUALITÉ de la prévision qu'un bon
    # résultat — CLAUDE.md §4.3) ; un écart de coûts ne se signale que s'il DÉPASSE.
    alertes = []
    if abs(revenu) > seuil:
        alertes.append(f"revenu {revenu:+} %")
    if couts > seuil:
        alertes.append(f"coûts {couts:+} % au-dessus de la prévision")
    if abs(production) > seuil:
        alertes.append(f"production {production:+} %")
    if alertes:
        AnalystObservation.objects.create(
            project=project, category=AnalystObservation.Category.RISK,
            risk_flag=AnalystObservation.RiskFlag.HIGH,
            observation=(
                f"Écart supérieur au seuil de {seuil} % sur le rapport de performance "
                f"{report.reporting_period or report.pk} : {' ; '.join(alertes)}."
            ),
        )
    audit_record(actor=by, action="investments.performance_report.submit", entity_type="PerformanceReport",
                 entity_id=str(report.pk),
                 details={"deviation_percent": str(revenu), "cost_deviation_percent": str(couts),
                          "production_deviation_percent": str(production), "threshold": str(seuil)})
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
    positions_obligataires = ObligationPosition.objects.filter(investor=investor).count()
    return {
        "bonds": float(bonds_total + obligations_total),
        # `bonds` additionne DEUX grandeurs qui ne se valent pas, et le total seul le
        # cachait. À gauche, de l'argent reçu et comptabilisé (B10), rapprochable d'une
        # pièce. À droite, des positions obligataires dont le montant est saisi libre,
        # dont le coupon, le taux et la maturité viennent des défauts du modèle
        # (250 / 9 % / 24 mois) et qui ne sont rattachées à aucune offre — elles
        # n'ont jamais transité par un encaissement.
        #
        # Conséquence mesurable : `GET /metrics/mine` ne compte QUE les souscriptions
        # encaissées, donc le même investisseur lit deux « investi » différents sur
        # deux écrans — l'incident de données du principe 11. Tant que le produit
        # obligataire n'est pas raccroché au cycle des offres, la ventilation est le
        # minimum honnête : le total reste servi tel quel pour ne rien casser, mais
        # sa composition est désormais lisible.
        "bondsFromSubscriptions": float(bonds_total),
        "bondsFromObligationPositions": float(obligations_total),
        "obligationPositionsCount": positions_obligataires,
        "reconciliationWarning": (
            "Les positions obligataires sont incluses dans « bonds » mais absentes de "
            "`metrics/mine.totalInvested`, qui ne compte que les souscriptions "
            "encaissées : les deux écrans afficheront des montants différents pour cet "
            "investisseur tant que ce produit n'est pas rattaché au cycle des offres."
            if obligations_total else None
        ),
        "cash": float(cash_total),
        # Aucun produit actions n'existe encore dans le système — trou produit assumé,
        # pas inventé silencieusement (voir le plan).
        "stocks": 0.0,
    }

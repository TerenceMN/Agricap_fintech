"""Services investissements — le mouvement d'argent réel est TOUJOURS délégué à
`transactions`/`caisses` (référencé en FK sur `Movement.transaction`) ; cette app ne
détient jamais elle-même le solde, elle ne fait qu'orchestrer projets/offres/souscriptions."""
from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import F, Sum

from audit.services import record as audit_record
from common import idempotency
from common.exceptions import ConflictError, NotFoundError, ValidationFailed
from common.parsing import to_decimal

from . import serializers
from .models import (
    AnalystObservation, Investor, Movement, Offer, PerformanceReport, Project, Subscription,
)

# Workflow P01→P13 : dictionnaire des transitions autorisées (P12 Défaut / P13 Annulé sont
# des sorties terminales, atteignables depuis plusieurs étapes).
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    Project.Status.P01: {Project.Status.P02, Project.Status.P13},
    Project.Status.P02: {Project.Status.P03, Project.Status.P13},
    Project.Status.P03: {Project.Status.P04, Project.Status.P13},
    Project.Status.P04: {Project.Status.P05, Project.Status.P13},
    Project.Status.P05: {Project.Status.P06, Project.Status.P13},
    Project.Status.P06: {Project.Status.P07, Project.Status.P13},
    Project.Status.P07: {Project.Status.P08, Project.Status.P13},
    Project.Status.P08: {Project.Status.P09, Project.Status.P12},
    Project.Status.P09: {Project.Status.P10, Project.Status.P12},
    Project.Status.P10: {Project.Status.P11, Project.Status.P12},
    Project.Status.P11: set(),
    Project.Status.P12: set(),
    Project.Status.P13: set(),
}


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


@transaction.atomic
def transition_status(*, project: Project, to_status: str, by: str = "") -> Project:
    allowed = ALLOWED_TRANSITIONS.get(project.status, set())
    if to_status not in allowed:
        raise ValidationFailed(f"Transition {project.status} → {to_status} non autorisée.")
    project.status = to_status
    project.save(update_fields=["status", "updated_at"])
    audit_record(actor=by, action="investments.project.transition", entity_type="Project", entity_id=project.code,
                 details={"to": to_status})
    return project


@transaction.atomic
def create_offer(*, project: Project, code: str, coupon_rate: Decimal | str, maturity_months: int,
                  min_ticket: Decimal | str, available_bonds: int, funding_goal: Decimal | str = "0",
                  by: str = "") -> Offer:
    if Offer.objects.filter(code=code).exists():
        raise ValidationFailed(f"Le code offre « {code} » existe déjà.")
    offer = Offer.objects.create(
        project=project, code=code, coupon_rate=to_decimal(coupon_rate), maturity_months=maturity_months,
        min_ticket=to_decimal(min_ticket), available_bonds=available_bonds, max_bonds=available_bonds,
        funding_goal=to_decimal(funding_goal),
    )
    audit_record(actor=by, action="investments.offer.create", entity_type="Offer", entity_id=offer.code)
    return offer


@transaction.atomic
def subscribe(*, investor: Investor, offer_id: int, bonds: int, idempotency_key: str,
              by: str = "") -> Subscription:
    if bonds <= 0:
        raise ValidationFailed("Le nombre d'obligations souscrites doit être positif.")

    rec = idempotency.begin(
        scope="investments.subscribe", key=idempotency_key,
        params={"investor": investor.pk, "offer": offer_id, "bonds": bonds}, by=by,
    )

    offer = Offer.objects.select_for_update().select_related("project").filter(pk=offer_id).first()
    if not offer:
        raise NotFoundError("Offre introuvable.")
    if offer.project.status != Project.Status.P06:
        raise ConflictError("Ce projet n'est pas ouvert à la souscription.")
    if bonds < offer.min_bonds or bonds > offer.available_bonds:
        raise ValidationFailed(
            f"Nombre d'obligations hors bornes (min={offer.min_bonds}, disponible={offer.available_bonds})."
        )

    amount = (offer.bond_unit_value * bonds).quantize(Decimal("0.01"))
    subscription = Subscription.objects.create(
        investor=investor, offer=offer, amount=amount, bonds=bonds,
        coupon_rate_snapshot=offer.coupon_rate, created_by=by,
    )
    Offer.objects.filter(pk=offer.pk).update(
        available_bonds=F("available_bonds") - bonds, funded_amount=F("funded_amount") + amount,
    )
    Project.objects.filter(pk=offer.project_id).update(funded_amount=F("funded_amount") + amount)
    Movement.objects.create(
        type=Movement.Type.SUBSCRIPTION, investor=investor, project=offer.project, subscription=subscription,
        assigned_manager_sub=offer.project.manager_sub, amount=amount, currency="USD",
    )

    audit_record(actor=by, action="investments.subscribe", entity_type="Subscription", entity_id=str(subscription.pk),
                 details={"offer": offer.code, "bonds": bonds, "amount": str(amount)})
    idempotency.complete(rec, response=serializers.subscription_row(subscription),
                          entity_type="Subscription", entity_id=str(subscription.pk))
    return subscription


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
    from caisses.models import ClientWallet

    from .models import ObligationPosition
    bonds_total = Subscription.objects.filter(investor=investor).aggregate(total=Sum("amount"))["total"] or Decimal("0")
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

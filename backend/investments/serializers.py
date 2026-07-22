"""Fonctions de sérialisation plates (convention `portfolio/serializers.py`) — utilisées à
la fois par `services.py` (snapshot d'idempotence) et `views.py` (réponse succès)."""
from __future__ import annotations

from .models import Investor, Movement, Offer, Project, Subscription

#: Unité de CHAQUE taux servi par ces sérialiseurs — déclarée, jamais devinée.
#:
#: Le module stocke ses taux dans DEUX unités, et ce n'est pas un choix : c'est un
#: héritage. `Offer.coupon_rate` et `ObligationPosition.rate` sont en points de
#: pourcentage (9,000 = 9 %) ; `Offer.loan_to_value`, `BondWithdrawal.penalty_rate`,
#: `SecondaryMarketListing.fee_rate`, `InvestmentConfig.default_rate_alert` et
#: `concentration_threshold` sont des fractions (0,60 = 60 %). Deux conventions
#: cohabitent donc jusque dans la MÊME table (`Offer.coupon_rate` à 9,000 à côté de
#: `Offer.loan_to_value` à 0,600).
#:
#: Les uniformiser en sortie sans les uniformiser en base créerait une troisième
#: convention et ferait afficher 1 250 % là où on attend 12,5 % — c'est une migration
#: de données sur des montants réels, donc une décision, jamais un effet de bord de
#: sérialisation. En attendant qu'elle soit tranchée, **aucun taux ne sort sans son
#: unité** : le consommateur lit `units`, il ne parie plus.
UNIT_PERCENT = "percent"      # 9,0 = 9 %
UNIT_FRACTION = "fraction"    # 0,09 = 9 %

OFFER_RATE_UNITS = {"couponRate": UNIT_PERCENT}
COLLATERAL_RATE_UNITS = {"loanToValue": UNIT_FRACTION}
SUBSCRIPTION_RATE_UNITS = {"couponRate": UNIT_PERCENT}
OBLIGATION_RATE_UNITS = {"rate": UNIT_PERCENT}
WITHDRAWAL_RATE_UNITS = {"penaltyRate": UNIT_FRACTION}


def project_row(p: Project) -> dict:
    return {
        "id": p.pk, "code": p.code, "title": p.title, "sector": p.sector, "location": p.location,
        "promoter": p.promoter, "status": p.status, "fundingTarget": float(p.funding_target),
        # `fundedAmount` = ENCAISSÉ (B10). Les réservations vivent sur l'offre.
        "fundedAmount": float(p.funded_amount), "progressPercent": p.progress_percent,
        "disbursedAmount": float(p.disbursed_amount), "returnedAmount": float(p.returned_amount),
        "distributedAmount": float(p.distributed_amount),
        "riskScore": p.risk_score, "globalScore": p.global_score, "managerName": p.manager_name,
        "managerSub": p.manager_sub, "isInvestable": p.is_investable,
    }


def project_detail_row(p: Project) -> dict:
    """Version enrichie de `project_row` pour la vue détail (ProjectDetailsModal,
    ProjectQA...) — champs narratifs/JSON volontairement absents de la liste pour ne pas
    alourdir `GET /investments/projects`. Fusionne les conditions de la dernière offre
    (l'offre elle-même reste une entité séparée, gérée par `OffersManagement.jsx`)."""
    row = {
        **project_row(p),
        "objectives": p.objectives, "description": p.description, "riskAnalysis": p.risk_analysis,
        "fundAllocation": p.fund_allocation, "impactEsg": p.impact_esg, "imageUrl": p.image_url,
        "promoterContact": p.promoter_contact,
        "startDate": p.start_date.isoformat() if p.start_date else None,
        "expectedMaturity": p.expected_maturity.isoformat() if p.expected_maturity else None,
        # Valorisation d'expert : les trois champs voyagent ENSEMBLE. Servir la valeur
        # sans sa date permettrait à un écran d'afficher une expertise de 2023 comme si
        # elle datait d'aujourd'hui — exactement ce que l'Annexe D interdit.
        "expertValuation": float(p.expert_valuation) if p.expert_valuation is not None else None,
        "expertValuationDate": (p.expert_valuation_date.isoformat()
                                 if p.expert_valuation_date else None),
        "expertValuationSource": p.expert_valuation_source,
    }
    latest_offer = p.offers.order_by("-created_at").first()
    if latest_offer:
        row.update({
            "typeOfTitle": latest_offer.type_of_title, "couponRate": float(latest_offer.coupon_rate),
            "paymentFrequency": latest_offer.payment_frequency, "maturityMonths": latest_offer.maturity_months,
            "minTicket": float(latest_offer.min_ticket),
            "units": OFFER_RATE_UNITS,
        })
    return row


def offer_row(o: Offer) -> dict:
    return {
        "id": o.pk, "code": o.code, "projectId": o.project_id, "typeOfTitle": o.type_of_title,
        "couponRate": float(o.coupon_rate), "maturityMonths": o.maturity_months,
        "minTicket": float(o.min_ticket), "bondUnitValue": float(o.bond_unit_value),
        "minBonds": o.min_bonds, "maxBonds": o.max_bonds, "availableBonds": o.available_bonds,
        "fundingGoal": float(o.funding_goal),
        # Deux grandeurs distinctes, jamais confondues : engagements vs argent reçu.
        "reservedAmount": float(o.reserved_amount), "fundedAmount": float(o.funded_amount),
        "minFundingAmount": float(o.min_funding_amount),
        "oversubscriptionPolicy": o.oversubscription_policy,
        "subscriptionDeadline": o.subscription_deadline.isoformat() if o.subscription_deadline else None,
        "closedAt": o.closed_at.isoformat() if o.closed_at else None,
        "status": o.status,
        "units": OFFER_RATE_UNITS,
    }


def investor_row(i: Investor) -> dict:
    return {
        "id": i.pk, "userSub": i.user_id, "investorType": i.investor_type, "kycStatus": i.kyc_status,
        "riskProfile": i.risk_profile, "status": i.status, "assignedManagerSub": i.assigned_manager_sub,
    }


def subscription_row(s: Subscription) -> dict:
    return {
        "id": s.pk, "investorId": s.investor_id, "offerId": s.offer_id,
        # `amount` = RÉSERVÉ, `allocatedAmount` = servi après arbitrage de
        # sursouscription, `settledAmount` = réellement encaissé. Trois grandeurs, trois
        # champs : les fondre en un seul reviendrait à présenter une intention comme un
        # placement.
        "amount": float(s.amount), "allocatedAmount": float(s.allocated_amount),
        "settledAmount": float(s.settled_amount), "refundedAmount": float(s.refunded_amount),
        "bonds": s.bonds, "queueRank": s.queue_rank, "status": s.status,
        "paymentStatus": s.payment_status,
        "couponRate": float(s.coupon_rate_snapshot), "subscriptionDate": s.subscription_date.isoformat(),
        "reservedAt": s.reserved_at.isoformat() if s.reserved_at else None,
        "settledAt": s.settled_at.isoformat() if s.settled_at else None,
        "refundedAt": s.refunded_at.isoformat() if s.refunded_at else None,
        "nextPaymentDate": s.next_payment_date.isoformat() if s.next_payment_date else None,
        "totalReceived": float(s.total_received), "subPortfolioId": s.sub_portfolio_id,
        "units": SUBSCRIPTION_RATE_UNITS,
    }


def distribution_row(d) -> dict:
    return {
        "id": d.pk, "offerId": d.offer_id, "kind": d.kind, "totalAmount": float(d.total_amount),
        "currency": d.currency, "valueDate": d.value_date.isoformat(), "executedBy": d.executed_by,
        "lines": [
            {"subscriptionId": line.subscription_id, "investorId": line.investor_id,
             "share": float(line.share), "amount": float(line.amount)}
            for line in d.lines.all()
        ],
    }


def investment_event_row(e) -> dict:
    """Ligne de la file consommée par le moteur d'écritures (`accounting`)."""
    return {
        "id": e.pk, "eventType": e.event_type,
        "projectCode": e.project.code if e.project_id else None,
        "offerCode": e.offer.code if e.offer_id else None,
        "subscriptionId": e.subscription_id, "investorId": e.investor_id,
        "amount": float(e.amount), "currency": e.currency,
        "segregationAccount": e.segregation_account,
        "occurredAt": e.occurred_at.isoformat(), "actor": e.actor_sub, "payload": e.payload,
        "consumedAt": e.consumed_at.isoformat() if e.consumed_at else None,
        "journalReference": e.journal_reference,
    }


def movement_row(m: Movement) -> dict:
    return {
        "id": m.pk, "type": m.type, "investorId": m.investor_id, "projectId": m.project_id,
        "amount": float(m.amount), "currency": m.currency, "status": m.status,
        "geographicZone": m.geographic_zone, "dateTime": m.date_time.isoformat(),
    }


def technical_analysis_row(t) -> dict:
    return {
        "projectId": t.project_id, "landSize": t.land_size, "productionCapacity": t.production_capacity,
        "productionCycleMonths": t.production_cycle_months, "yieldForecast": t.yield_forecast,
        "climateRisk": t.climate_risk, "mitigation": t.mitigation,
    }


def financial_analysis_row(f) -> dict:
    return {
        "projectId": f.project_id, "investmentBreakdown": f.investment_breakdown,
        "revenueForecast": f.revenue_forecast, "costStructure": f.cost_structure,
        "cashflowProjection": f.cashflow_projection, "ebitdaMargin": f.ebitda_margin,
        "dscr": f.dscr, "irr": f.irr, "financialScore": f.financial_score,
    }


def collateral_row(c) -> dict:
    return {
        "offerId": c.offer_id, "debtType": c.debt_type, "guarantees": c.guarantees,
        "collateralValue": float(c.collateral_value), "loanToValue": float(c.loan_to_value),
        "units": COLLATERAL_RATE_UNITS,
    }


def performance_report_row(r) -> dict:
    return {
        "id": r.pk, "projectId": r.project_id, "reportingPeriod": r.reporting_period,
        "submissionDate": r.submission_date.isoformat(),
        "actualRevenue": r.actual_revenue, "forecastRevenue": r.forecast_revenue,
        "actualCosts": r.actual_costs, "forecastCosts": r.forecast_costs,
        "actualProduction": r.actual_production, "forecastProduction": r.forecast_production,
        # Trois écarts CALCULÉS ET FIGÉS par le serveur. `deviationPercent` reste
        # l'écart de revenu (nom historique consommé tel quel). `unfavorable` dit le
        # sens : un écart de coûts positif est défavorable, un écart de revenu positif
        # ne l'est pas — l'écran n'a pas à connaître cette règle métier.
        "deviationPercent": r.deviation_percent,
        "revenueDeviationPercent": r.deviation_percent,
        "costDeviationPercent": r.cost_deviation_percent,
        "productionDeviationPercent": r.production_deviation_percent,
        "unfavorable": {
            "revenue": r.deviation_percent < 0,
            "costs": r.cost_deviation_percent > 0,
            "production": r.production_deviation_percent < 0,
        },
        "hasForecast": {
            "revenue": bool(r.forecast_revenue), "costs": bool(r.forecast_costs),
            "production": bool(r.forecast_production),
        },
        "deviationComments": r.deviation_comments,
        "validationStatus": r.validation_status, "validatedBy": r.validated_by,
        "validationDate": r.validation_date.isoformat() if r.validation_date else None,
    }

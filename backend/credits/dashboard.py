"""
Tableau de bord crédits — Étape 7.

Agrège des KPIs adaptés au rôle de l'utilisateur.

GET /api/credits/dashboard/

Rôles et vue (identifiants canoniques de `rbac.role_registry`, groupés dans
`credits.roles`) :
  Client (client, agri_op…)      → mes dossiers, prochains remboursements, encours
  Terrain + gestion crédit       → dossiers en attente de traitement, volume mensuel
  gest_zone                      → stats agence : volume, taux de défaut, en-cours
  dir_ops                        → stats multi-agences
  Comité (dg, admin)             → dossiers en attente d'accord comité
  Superadmin (admin, dg)         → vue globale + anomalies

Le comité de crédit n'a pas de rôle propre : il est exercé par `dg` et `admin`
(décision de juillet 2026, aucun nouveau rôle). La vue comité est donc servie
aux rôles de direction, qui voient aussi la vue globale — l'ordre de priorité
ci-dessous tranche : la vue globale prime pour l'admin.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db.models import Count, Sum, Q
from django.utils import timezone

# Statuts "en cours de vie" du crédit
_ACTIVE_STATUSES = ("submitted", "in_analysis", "approved", "pending_disbursement", "active")
_PENDING_ANALYSIS = ("submitted", "in_analysis", "adjourned")
_ANALYSIS_PENDING_APPROVAL = ("in_analysis",)


def get_dashboard(sub: str, roles: set[str], view: str = "") -> dict[str, Any]:
    """
    Point d'entrée principal. Retourne le tableau de bord adapté au rôle.

    `view` sélectionne explicitement une lentille pour les rôles qui en portent
    plusieurs. Le comité de crédit n'ayant pas de rôle propre (il est exercé par
    `dg` et `admin`, qui voient par défaut la vue globale), sa corbeille est
    atteignable via `?view=committee` — sinon elle serait inaccessible.
    """
    from credits.models import CreditApplication

    from credits.roles import (
        BRANCH_ROLES, COMMITTEE_ROLES, DIRECTION_ROLES, STAFF_ROLES, SUPERADMIN_ROLES,
    )

    roles = set(roles or ())
    is_admin = bool(roles & SUPERADMIN_ROLES)
    is_staff = bool(roles & STAFF_ROLES)
    is_committee = bool(roles & COMMITTEE_ROLES)
    is_regional = bool(roles & DIRECTION_ROLES)
    is_branch = bool(roles & BRANCH_ROLES)

    # Lentille explicite — refusée si le rôle n'y a pas droit (pas de silence)
    if view == "committee":
        if not is_committee:
            raise PermissionError("Vue comité réservée à la direction.")
        return _committee_dashboard()

    if is_admin:
        return _admin_dashboard()
    if is_committee:
        return _committee_dashboard()
    if is_regional:
        return _regional_dashboard()
    if is_branch:
        return _branch_dashboard(sub)
    if is_staff:
        return _agent_dashboard(sub)

    # Client par défaut
    return _client_dashboard(sub)


# ── Vue client ────────────────────────────────────────────────────────────────

def _client_dashboard(sub: str) -> dict[str, Any]:
    from credits.models import CreditApplication

    my_apps = CreditApplication.objects.filter(client__sub=sub)

    counts = my_apps.aggregate(
        total=Count("id"),
        active=Count("id", filter=Q(status="active")),
        pending=Count("id", filter=Q(status__in=_PENDING_ANALYSIS)),
        rejected=Count("id", filter=Q(status="rejected")),
        closed=Count("id", filter=Q(status="closed")),
    )

    encours = my_apps.filter(status="active").aggregate(
        total=Sum("disbursed_amount")
    )["total"] or Decimal("0")

    # Dossier nécessitant consentement client
    consent_needed = my_apps.filter(
        client_consent_expires__gt=timezone.now(),
        client_consent_at__isnull=True,
    ).count()

    recent = list(
        my_apps.order_by("-created_at").values(
            "code", "status", "amount_requested", "currency", "created_at",
        )[:5]
    )
    _serialize_qs_values(recent)

    return {
        "role": "client",
        "summary": {
            "totalApplications": counts["total"],
            "activeCredits": counts["active"],
            "pendingApplications": counts["pending"],
            "rejectedApplications": counts["rejected"],
            "closedCredits": counts["closed"],
            "totalEncoursUsd": float(encours),
            "consentNeeded": consent_needed,
        },
        "recentApplications": recent,
    }


# ── Vue agent / analyst ───────────────────────────────────────────────────────

def _agent_dashboard(sub: str) -> dict[str, Any]:
    from credits.models import CreditApplication

    now = timezone.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    qs = CreditApplication.objects.all()

    counts = qs.aggregate(
        total=Count("id"),
        pending_submission=Count("id", filter=Q(status="submitted")),
        in_analysis=Count("id", filter=Q(status="in_analysis")),
        adjourned=Count("id", filter=Q(status="adjourned")),
        pending_disbursement=Count("id", filter=Q(status="pending_disbursement")),
        approved=Count("id", filter=Q(status="approved")),
        active=Count("id", filter=Q(status="active")),
    )

    monthly = qs.filter(
        status="active",
        disbursed_at__gte=month_start,
    ).aggregate(
        count=Count("id"),
        volume=Sum("disbursed_amount"),
    )

    # Dossiers bloqués sans action depuis > 7 jours
    stale_threshold = now - timezone.timedelta(days=7)
    stale = qs.filter(
        status__in=_PENDING_ANALYSIS,
        updated_at__lt=stale_threshold,
    ).count()

    # Consentements qui expirent dans 24h
    expiring_soon = qs.filter(
        client_consent_at__isnull=True,
        client_consent_expires__gte=now,
        client_consent_expires__lt=now + timezone.timedelta(hours=24),
    ).count()

    return {
        "role": "agent",
        "summary": {
            "totalApplications": counts["total"],
            "pendingSubmission": counts["pending_submission"],
            "inAnalysis": counts["in_analysis"],
            "adjourned": counts["adjourned"],
            "pendingDisbursement": counts["pending_disbursement"],
            "approved": counts["approved"],
            "activeCredits": counts["active"],
            "staleApplications": stale,
            "consentExpiringSoon": expiring_soon,
        },
        "monthlyDisbursements": {
            "count": monthly["count"] or 0,
            "volumeUsd": float(monthly["volume"] or 0),
        },
    }


# ── Vue credit_committee ──────────────────────────────────────────────────────

def _committee_dashboard() -> dict[str, Any]:
    from credits.models import CreditApplication
    from config import settings

    from credits.committee import _amount_usd, committee_threshold_usd, requires_committee

    qs = CreditApplication.objects.select_related("client", "value_chain")

    # La corbeille applique EXACTEMENT la règle qui autorise le vote
    # (`requires_committee`, qui convertit en USD). Le filtre précédent comparait
    # `amount_requested` BRUT à un seuil en USD, donc des devises entre elles :
    # un dossier en CDF porte un nombre énorme en brut et entrait toujours dans
    # la corbeille — pour se voir ensuite refuser le vote en
    # `COMMITTEE_NOT_REQUIRED`. Le comité voyait des dossiers sur lesquels il ne
    # pouvait rien faire.
    # `in_analysis` est la file d'instruction : ensemble borné, donc filtrable en
    # Python. C'est le prix assumé pour n'avoir QU'UNE règle — une seconde règle
    # au niveau SQL, c'est une divergence qui revient au premier changement.
    candidats = [a for a in qs.filter(status="in_analysis") if requires_committee(a)]
    candidats.sort(key=_amount_usd, reverse=True)

    # Agrégat converti : sommer des montants de devises différentes et appeler le
    # total « USD » produisait un chiffre qui ne veut rien dire (§7.2, KPI honnêtes).
    total_usd = sum(_amount_usd(a) for a in candidats)

    pending_list = [
        {
            "code": a.code,
            "status": a.status,
            "amount_requested": a.amount_requested,
            "currency": a.currency,
            "value_chain__label": a.value_chain.label if a.value_chain_id else None,
            "created_at": a.created_at,
            # Montant comparable entre dossiers : c'est lui qui a décidé de la
            # présence dans la corbeille, il doit donc être lisible à l'écran.
            "amountUsd": _amount_usd(a),
        }
        for a in candidats[:20]
    ]
    _serialize_qs_values(pending_list)

    return {
        "role": "credit_committee",
        "summary": {
            "pendingReview": len(candidats),
            "totalVolumeUsd": float(total_usd),
            "delegationThresholdUsd": float(committee_threshold_usd()),
        },
        "pendingApplications": pending_list,
    }


# ── Vue branch_manager ────────────────────────────────────────────────────────

def _branch_dashboard(sub: str) -> dict[str, Any]:
    from credits.models import CreditApplication

    qs = CreditApplication.objects.all()
    now = timezone.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    counts = qs.aggregate(
        total=Count("id"),
        pending_approval=Count("id", filter=Q(status="in_analysis")),
        approved=Count("id", filter=Q(status="approved")),
        active=Count("id", filter=Q(status="active")),
        rejected=Count("id", filter=Q(status="rejected")),
        closed=Count("id", filter=Q(status="closed")),
    )

    monthly = qs.filter(
        status="active",
        disbursed_at__gte=month_start,
    ).aggregate(
        count=Count("id"),
        volume=Sum("disbursed_amount"),
    )

    default_rate = _compute_default_rate(qs)

    return {
        "role": "branch_manager",
        "summary": {
            "totalApplications": counts["total"],
            "pendingApproval": counts["pending_approval"],
            "approved": counts["approved"],
            "activeCredits": counts["active"],
            "rejectedApplications": counts["rejected"],
            "closedCredits": counts["closed"],
            "defaultRatePct": default_rate,
        },
        "monthlyDisbursements": {
            "count": monthly["count"] or 0,
            "volumeUsd": float(monthly["volume"] or 0),
        },
    }


# ── Vue regional_director ─────────────────────────────────────────────────────

def _regional_dashboard() -> dict[str, Any]:
    from credits.models import CreditApplication
    from reference_data.models import ValueChain

    qs = CreditApplication.objects.all()

    global_counts = qs.aggregate(
        total=Count("id"),
        active=Count("id", filter=Q(status="active")),
        pending=Count("id", filter=Q(status__in=_PENDING_ANALYSIS)),
        total_encours=Sum("disbursed_amount", filter=Q(status="active")),
    )

    # Répartition par filière
    by_vc = list(
        qs.filter(status="active")
        .values("value_chain__code", "value_chain__label")
        .annotate(
            count=Count("id"),
            encours=Sum("disbursed_amount"),
        )
        .order_by("-encours")[:10]
    )

    for row in by_vc:
        row["encours"] = float(row["encours"] or 0)

    default_rate = _compute_default_rate(qs)

    return {
        "role": "regional_director",
        "summary": {
            "totalApplications": global_counts["total"],
            "activeCredits": global_counts["active"],
            "pendingApplications": global_counts["pending"],
            "totalEncoursUsd": float(global_counts["total_encours"] or 0),
            "defaultRatePct": default_rate,
        },
        "activeByValueChain": by_vc,
    }


# ── Vue admin ─────────────────────────────────────────────────────────────────

def _admin_dashboard() -> dict[str, Any]:
    from credits.models import CreditApplication, ScoringCriterion, CreditGuarantee

    qs = CreditApplication.objects.all()

    counts = qs.aggregate(
        total=Count("id"),
        draft=Count("id", filter=Q(status="draft")),
        submitted=Count("id", filter=Q(status="submitted")),
        in_analysis=Count("id", filter=Q(status="in_analysis")),
        approved=Count("id", filter=Q(status="approved")),
        pending_disbursement=Count("id", filter=Q(status="pending_disbursement")),
        active=Count("id", filter=Q(status="active")),
        rejected=Count("id", filter=Q(status="rejected")),
        adjourned=Count("id", filter=Q(status="adjourned")),
        closed=Count("id", filter=Q(status="closed")),
        total_encours=Sum("disbursed_amount", filter=Q(status="active")),
    )

    # Critères de scoring configurés
    scoring_criteria_count = ScoringCriterion.objects.filter(active=True).count()

    # Garanties en attente de confirmation (morale PENDING)
    pending_moral = CreditGuarantee.objects.filter(
        guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
        status=CreditGuarantee.Status.PENDING,
    ).count()

    # Consentements expirés non traités
    now = timezone.now()
    expired_consents = qs.filter(
        client_consent_expires__lt=now,
        client_consent_at__isnull=True,
        status__in=("submitted", "in_analysis"),
    ).count()

    default_rate = _compute_default_rate(qs)

    return {
        "role": "admin",
        "counts": {
            "draft": counts["draft"],
            "submitted": counts["submitted"],
            "in_analysis": counts["in_analysis"],
            "approved": counts["approved"],
            "pending_disbursement": counts["pending_disbursement"],
            "active": counts["active"],
            "rejected": counts["rejected"],
            "adjourned": counts["adjourned"],
            "closed": counts["closed"],
            "total": counts["total"],
        },
        "financials": {
            "totalEncoursUsd": float(counts["total_encours"] or 0),
            "defaultRatePct": default_rate,
        },
        "alerts": {
            "pendingMoralGuarantees": pending_moral,
            "expiredConsents": expired_consents,
            "scoringCriteriaActive": scoring_criteria_count,
        },
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _compute_default_rate(qs) -> float:
    """
    Taux de défaut simplifié :
    dossiers REJETÉS / (dossiers ACTIFS + FERMÉS + REJETÉS) × 100.
    Retourne 0.0 si dénominateur nul.
    """
    agg = qs.aggregate(
        rejected=Count("id", filter=Q(status="rejected")),
        resolved=Count("id", filter=Q(status__in=("active", "closed", "rejected"))),
    )
    total = agg["resolved"] or 0
    if total == 0:
        return 0.0
    return round(agg["rejected"] / total * 100, 1)


def _serialize_qs_values(rows: list[dict]) -> None:
    """Convertit les champs datetime en isoformat dans une liste de dicts .values()."""
    for row in rows:
        for key, val in list(row.items()):
            if hasattr(val, "isoformat"):
                row[key] = val.isoformat()
            elif isinstance(val, Decimal):
                row[key] = float(val)

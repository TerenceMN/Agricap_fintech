"""
Service de préremplissage pour une nouvelle demande de crédit.

Agrège depuis :
  - FintechUser / KycProfile (identité, KYC, capacité)
  - Prêts actifs / encours (ratio d'endettement)
  - Dernière Feuille de Besoins du client (si disponible)
  - Référentiel actif (ValueChains en cache)
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any


def _safe_decimal(val) -> float | None:
    if val is None:
        return None
    try:
        return float(Decimal(str(val)))
    except Exception:
        return None


def _kyc_level_label(level: str) -> str:
    labels = {
        "T0": "Non vérifié",
        "T1": "Vérification basique",
        "T2": "Vérification intermédiaire",
        "T3": "Vérification avancée",
        "T4": "Vérification complète",
    }
    return labels.get(level, level)


def get_prefill_data(client_sub: str, requester_sub: str) -> dict[str, Any]:
    """
    Retourne les données de préremplissage pour un dossier de crédit.

    client_sub   : sub OIDC du bénéficiaire final
    requester_sub: sub OIDC du demandeur (peut être un agent)
    """
    from accounts.models import FintechUser

    # ── Données client ────────────────────────────────────────────────────────
    try:
        user = FintechUser.objects.select_related("kyc_profile").get(sub=client_sub)
    except FintechUser.DoesNotExist:
        return {"error": "client_not_found", "client_sub": client_sub}

    client_data: dict[str, Any] = {
        "sub": user.sub,
        "displayName": user.full_name,
        "phone": user.phone,
    }

    # ── KYC ──────────────────────────────────────────────────────────────────
    kyc_data: dict[str, Any] = {}
    kyc = getattr(user, "kyc_profile", None)
    if kyc:
        kyc_data = {
            "level": kyc.kyc_level,
            "levelLabel": _kyc_level_label(kyc.kyc_level),
            "status": kyc.kyc_status,
            "monthlyLimit": _safe_decimal(kyc.monthly_limit),
        }

    # ── Encours et capacité d'endettement ────────────────────────────────────
    debt_data: dict[str, Any] = _compute_debt_info(user)

    # ── Référentiel actif ─────────────────────────────────────────────────────
    value_chains = _get_active_value_chains()

    # ── Dernière demande / Feuille de besoins du client ──────────────────────
    last_needs = _get_last_needs_sheet(client_sub)

    # ── Suggestion de filière ─────────────────────────────────────────────────
    suggested_chain_code = _suggest_value_chain(client_sub, value_chains)

    on_behalf_of = (requester_sub != client_sub)
    result: dict[str, Any] = {
        "client": client_data,
        "kyc": kyc_data,
        "debt": debt_data,
        "valueChains": value_chains,
        "suggestedValueChainCode": suggested_chain_code,
        "onBehalfOf": on_behalf_of,
        "lastNeedsSheet": last_needs,
        "defaults": {
            "currency": "USD",
            "area_ha": last_needs.get("area_ha") if last_needs else None,
            "value_chain_code": suggested_chain_code,
        },
    }

    if on_behalf_of:
        result["consentRequired"] = True
        result["consentDeadlineHours"] = 72

    return result


def _compute_debt_info(user) -> dict[str, Any]:
    """Calcule l'encours et le taux d'endettement estimé."""
    try:
        from credits.models import CreditApplication
        active_statuses = [
            CreditApplication.Status.ACTIVE,
            CreditApplication.Status.PENDING_DISBURSEMENT,
            CreditApplication.Status.IN_ANALYSIS,
            CreditApplication.Status.APPROVED,
        ]
        active_apps = CreditApplication.objects.filter(
            client=user, status__in=active_statuses
        )
        total_encours_usd = sum(
            float(app.amount_approved or app.amount_requested or 0)
            for app in active_apps
            if app.currency == "USD"
        )
        active_count = active_apps.count()
    except Exception:
        total_encours_usd = 0
        active_count = 0

    kyc = getattr(user, "kyc_profile", None)
    monthly_limit = float(kyc.monthly_limit) if kyc and kyc.monthly_limit else None

    # Ratio d'endettement simplifié : encours / (limite mensuelle × 6 mois)
    debt_ratio: float | None = None
    if monthly_limit and monthly_limit > 0:
        capacity_6m = monthly_limit * 6
        debt_ratio = round(total_encours_usd / capacity_6m * 100, 1) if capacity_6m > 0 else None

    return {
        "activeLoansCount": active_count,
        "totalEncoursUsd": total_encours_usd,
        "monthlyCapacityUsd": monthly_limit,
        "debtRatioPct": debt_ratio,
        "debtRatingLabel": _debt_rating(debt_ratio),
    }


def _debt_rating(ratio: float | None) -> str:
    if ratio is None:
        return "inconnu"
    if ratio <= 30:
        return "faible"
    if ratio <= 60:
        return "modéré"
    return "élevé"


def _get_active_value_chains() -> list[dict]:
    """Retourne les chaînes de valeur actives (depuis le cache si disponible)."""
    try:
        from django.core.cache import cache
        from reference_data.models import ValueChain

        CACHE_KEY = "reference_data:value_chains:active"
        cached = cache.get(CACHE_KEY)
        if cached is not None:
            return cached

        chains = list(
            ValueChain.objects.filter(active=True)
            .values(
                "code", "label", "cycle_months",
                "cost_per_hectare_usd", "cost_per_hectare_cdf",
                "base_rate", "min_score_required",
                "harvest_months", "module_weights", "eligible_guarantees",
            )
        )
        # Décimaux → float pour sérialisation JSON
        for c in chains:
            c["cost_per_hectare_usd"] = float(c["cost_per_hectare_usd"] or 0)
            c["cost_per_hectare_cdf"] = float(c["cost_per_hectare_cdf"] or 0)
            c["base_rate"] = float(c["base_rate"] or 0)

        cache.set(CACHE_KEY, chains, 300)
        return chains
    except Exception:
        return []


def _get_last_needs_sheet(client_sub: str) -> dict | None:
    """Retourne un résumé de la dernière Feuille de Besoins du client."""
    try:
        from credits.models import NeedsSheet, CreditApplication
        app = (
            CreditApplication.objects
            .filter(client__sub=client_sub, needs_sheet__isnull=False, needs_sheet__parsed_ok=True)
            .order_by("-created_at")
            .select_related("needs_sheet__value_chain")
            .first()
        )
        if not app or not app.needs_sheet:
            return None
        ns = app.needs_sheet
        return {
            "application_code": app.code,
            "uploaded_at": ns.uploaded_at.isoformat(),
            "area_ha": float(ns.area_ha) if ns.area_ha else None,
            "currency": ns.currency,
            "grand_total": float(ns.grand_total),
            "value_chain_code": ns.value_chain.code if ns.value_chain else None,
            "total_by_module": ns.total_by_module,
        }
    except Exception:
        return None


def _suggest_value_chain(client_sub: str, value_chains: list[dict]) -> str | None:
    """Suggère la filière la plus récente utilisée par le client."""
    if not value_chains:
        return None
    try:
        from credits.models import CreditApplication
        last = (
            CreditApplication.objects
            .filter(client__sub=client_sub, value_chain__isnull=False)
            .order_by("-created_at")
            .values_list("value_chain__code", flat=True)
            .first()
        )
        if last:
            return last
    except Exception:
        pass
    # Fallback : première filière disponible
    return value_chains[0]["code"] if value_chains else None

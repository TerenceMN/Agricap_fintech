"""
Moteur de scoring paramétrique Crédits Agricoles (Étape 3).

Les barèmes sont lus depuis `ScoringCriterion` en base (pas dans le code).
Chaque méthode de calcul reçoit l'application et le config du critère.

Usage :
    engine = CreditScoringEngine(application)
    result = engine.compute()
    # result = {score, breakdown, eligible, proposedRate, scheduleDraft, ...}
"""
from __future__ import annotations

import decimal
import math
from typing import Any


# ── Helpers ────────────────────────────────────────────────────────────────────

def _threshold_points(value: float, thresholds: list[list]) -> int:
    """
    Retourne les points associés au premier seuil franchi.
    Format : [[seuil_max, points], ...] trié par seuil décroissant.
    Ex : [[30, 20], [50, 12], [70, 5], [100, 0]] — si value ≤ 30 → 20 pts
    """
    for threshold, points in thresholds:
        if value <= threshold:
            return points
    return 0


def _threshold_points_desc(value: float, thresholds: list[list]) -> int:
    """
    Comme _threshold_points mais seuil dans l'ordre décroissant (≥ N → points).
    Ex : [[90, 30], [75, 20], [60, 10], [0, 0]] — si value ≥ 90 → 30 pts
    """
    for threshold, points in thresholds:
        if value >= threshold:
            return points
    return 0


# ── Moteur principal ───────────────────────────────────────────────────────────

class CreditScoringEngine:
    """
    Moteur de scoring paramétrique.
    Instancié avec un CreditApplication ; appeler .compute() pour obtenir le résultat.
    """

    def __init__(self, application) -> None:
        self.app = application
        self.client = application.client
        self.value_chain = application.value_chain
        self.needs_sheet = application.needs_sheet

    def compute(self) -> dict[str, Any]:
        from credits.models import ScoringCriterion

        criteria = list(ScoringCriterion.objects.filter(active=True).order_by("order"))

        breakdown: list[dict] = []
        total_weighted = 0.0
        max_weighted = 0.0

        for criterion in criteria:
            points, detail = self._dispatch(criterion)
            points = max(0, min(points, criterion.max_points))  # clamp [0, max]
            w = float(criterion.weight)
            total_weighted += points * w
            max_weighted += criterion.max_points * w
            breakdown.append({
                "code": criterion.code,
                "label": criterion.label,
                "points": points,
                "maxPoints": criterion.max_points,
                "weight": w,
                "weightedScore": round(points * w, 2),
                "detail": detail,
            })

        score = round(total_weighted / max_weighted * 100, 1) if max_weighted > 0 else 0.0

        min_required = self.value_chain.min_score_required if self.value_chain else 50
        eligible = score >= min_required

        proposed_rate = self._propose_rate(score)
        schedule = self._draft_schedule(proposed_rate)

        return {
            "score": score,
            "breakdown": breakdown,
            "eligible": eligible,
            "minScoreRequired": min_required,
            "proposedRate": proposed_rate,
            "scheduleDraft": schedule,
            "valuationNote": self._valuation_note(score, eligible),
        }

    def _dispatch(self, criterion) -> tuple[int, dict]:
        method = criterion.compute_method
        config = criterion.config or {}
        try:
            if method == "repayment_history":
                return self._repayment_history(criterion.max_points, config)
            if method == "needs_coherence":
                return self._needs_coherence(criterion.max_points, config)
            if method == "debt_ratio":
                return self._debt_ratio(criterion.max_points, config)
            if method == "kyc_seniority":
                return self._kyc_seniority(criterion.max_points, config)
            if method == "sector_risk":
                return self._sector_risk(criterion.max_points, config)
        except Exception as exc:
            return 0, {"error": str(exc)}
        return 0, {"note": f"Méthode inconnue : {method}"}

    # ── Méthodes de calcul ────────────────────────────────────────────────────

    def _repayment_history(self, max_points: int, config: dict) -> tuple[int, dict]:
        """
        Historique de remboursement.
        Cherche les prêts CLÔTURÉS du client dans portfolio.Loan et credits.CreditApplication.
        """
        thresholds = config.get("on_time_pct_thresholds", [[90, max_points], [0, 0]])
        no_history = config.get("no_history_points", max_points // 2)

        closed_count = 0
        on_time_count = 0

        # Source 1 : credits.CreditApplication CLOSED
        try:
            from credits.models import CreditApplication
            past = CreditApplication.objects.filter(
                client=self.client, status=CreditApplication.Status.CLOSED
            ).exclude(pk=self.app.pk)
            closed_count += past.count()
            # Heuristique : pas de rejet = remboursé normalement
            on_time_count += past.filter(rejection_reason_code="").count()
        except Exception:
            pass

        # Source 2 : portfolio.Loan (ancien parcours)
        try:
            from portfolio.models import Loan
            loans = Loan.objects.filter(borrower_sub=self.client.sub, status="CLOSED")
            closed_count += loans.count()
            on_time_count += loans.count()  # si CLOSED sans incident on considère OK
        except Exception:
            pass

        if closed_count == 0:
            points = no_history
            detail = {
                "note": "Aucun historique de remboursement — points partiels accordés.",
                "closedLoans": 0,
                "onTimePct": None,
            }
        else:
            pct = on_time_count / closed_count * 100
            points = _threshold_points_desc(pct, thresholds)
            detail = {
                "closedLoans": closed_count,
                "onTimePct": round(pct, 1),
                "onTimeCount": on_time_count,
            }
        return points, detail

    def _needs_coherence(self, max_points: int, config: dict) -> tuple[int, dict]:
        """
        Cohérence de la Feuille de Besoins vs le référentiel filière.
        """
        ns = self.needs_sheet
        vc = self.value_chain

        if ns is None or not ns.parsed_ok:
            pts = config.get("no_needs_sheet", max_points // 2)
            return pts, {"note": "Feuille de Besoins absente ou non parsée."}

        if vc is None:
            pts = config.get("no_needs_sheet", max_points // 2)
            return pts, {"note": "Filière non renseignée — comparaison impossible."}

        area = float(self.app.area_ha or ns.area_ha or 0)
        if area <= 0:
            pts = config.get("no_needs_sheet", max_points // 2)
            return pts, {"note": "Superficie non renseignée."}

        currency = (self.app.currency or ns.currency or "USD").upper()
        ref_per_ha = float(
            vc.cost_per_hectare_usd if currency == "USD" else vc.cost_per_hectare_cdf
        )
        ref_total = ref_per_ha * area
        declared = float(ns.grand_total)

        if ref_total == 0:
            return max_points // 2, {"note": "Coût référentiel = 0, comparaison ignorée."}

        ratio = abs(declared - ref_total) / ref_total * 100  # % d'écart

        if ratio <= 10:
            pts = config.get("within_10pct", max_points)
        elif ratio <= 20:
            pts = config.get("within_20pct", int(max_points * 0.72))
        elif ratio <= 30:
            pts = config.get("within_30pct", int(max_points * 0.4))
        else:
            pts = config.get("beyond_30pct", 0)

        detail = {
            "declaredTotal": declared,
            "referentialTotal": round(ref_total, 2),
            "deviationPct": round(ratio, 1),
            "currency": currency,
        }
        return pts, detail

    def _debt_ratio(self, max_points: int, config: dict) -> tuple[int, dict]:
        """
        Ratio d'endettement actif / capacité de remboursement mensuelle × 6 mois.
        """
        thresholds = config.get("thresholds", [[30, max_points], [50, 12], [70, 5], [100, 0]])

        kyc = getattr(self.client, "kyc_profile", None)
        monthly_capacity = float(kyc.monthly_limit) if kyc and kyc.monthly_limit else 0

        try:
            from credits.models import CreditApplication
            active_statuses = [
                CreditApplication.Status.ACTIVE,
                CreditApplication.Status.PENDING_DISBURSEMENT,
                CreditApplication.Status.IN_ANALYSIS,
                CreditApplication.Status.APPROVED,
            ]
            encours = sum(
                float(a.amount_approved or a.amount_requested or 0)
                for a in CreditApplication.objects.filter(
                    client=self.client, status__in=active_statuses, currency="USD"
                ).exclude(pk=self.app.pk)
            )
        except Exception:
            encours = 0

        if monthly_capacity <= 0:
            detail = {
                "note": "Limite mensuelle KYC non renseignée — ratio non calculable.",
                "encours": encours,
            }
            # Neutre : moitié des points
            return max_points // 2, detail

        capacity_6m = monthly_capacity * 6
        ratio = encours / capacity_6m * 100 if capacity_6m > 0 else 100.0
        pts = _threshold_points(ratio, thresholds)

        detail = {
            "encoursUsd": round(encours, 2),
            "monthlyCapacityUsd": round(monthly_capacity, 2),
            "capacity6mUsd": round(capacity_6m, 2),
            "debtRatioPct": round(ratio, 1),
        }
        return pts, detail

    def _kyc_seniority(self, max_points: int, config: dict) -> tuple[int, dict]:
        """
        Niveau KYC + ancienneté du compte client.
        """
        kyc_points_map: dict = config.get("kyc_points", {"T4": 10, "T3": 7, "T2": 4, "T1": 2, "T0": 0})
        seniority_thresholds = config.get(
            "seniority_months_thresholds", [[24, 5], [12, 3], [6, 1], [0, 0]]
        )

        kyc = getattr(self.client, "kyc_profile", None)
        kyc_level = kyc.kyc_level if kyc else "T0"
        kyc_pts = kyc_points_map.get(kyc_level, 0)

        # Ancienneté en mois depuis la création du compte
        from django.utils import timezone
        created = self.client.created_at if hasattr(self.client, "created_at") else None
        if created:
            delta_months = (timezone.now() - created).days / 30.44
        else:
            delta_months = 0

        seniority_pts = _threshold_points_desc(delta_months, seniority_thresholds)
        pts = kyc_pts + seniority_pts

        detail = {
            "kycLevel": kyc_level,
            "kycPoints": kyc_pts,
            "seniorityMonths": round(delta_months, 1),
            "seniorityPoints": seniority_pts,
        }
        return pts, detail

    def _sector_risk(self, max_points: int, config: dict) -> tuple[int, dict]:
        """
        Risque filière : risk_factor du référentiel.
        Plus le risk_factor est bas, plus la filière est sûre → plus de points.
        """
        thresholds = config.get("risk_factor_thresholds", [[0.15, max_points], [1.0, 0]])

        if self.value_chain is None:
            return max_points // 2, {"note": "Filière non renseignée."}

        rf = float(self.value_chain.risk_factor)
        pts = _threshold_points(rf, thresholds)
        detail = {
            "riskFactor": rf,
            "valueChain": self.value_chain.code,
            "label": self.value_chain.label,
        }
        return pts, detail

    # ── Taux proposé ─────────────────────────────────────────────────────────

    def _propose_rate(self, score: float) -> float:
        """
        Calcule le taux proposé à partir du score.
        Base : value_chain.base_rate
        Ajustement : score élevé → taux réduit, score faible → surcote.
        """
        base = float(self.value_chain.base_rate) if self.value_chain else 18.0

        if score >= 85:
            adjustment = -2.0
        elif score >= 70:
            adjustment = 0.0
        elif score >= 55:
            adjustment = +2.5
        else:
            adjustment = +5.0  # score très bas — taux maximum

        return round(max(base + adjustment, base * 0.7), 2)

    # ── Planning indicatif ────────────────────────────────────────────────────

    def _draft_schedule(self, annual_rate: float) -> dict:
        """
        Génère un plan de remboursement indicatif (amortissement constant).
        Basé sur amount_requested et cycle_months de la filière.
        """
        amount = float(self.app.amount_requested or 0)
        n = int(self.value_chain.cycle_months) if self.value_chain else 12

        if amount <= 0 or n <= 0 or annual_rate <= 0:
            return {"note": "Données insuffisantes pour simuler le plan."}

        monthly_rate = annual_rate / 100 / 12

        if monthly_rate == 0:
            monthly_payment = amount / n
        else:
            monthly_payment = amount * monthly_rate / (1 - (1 + monthly_rate) ** (-n))

        monthly_payment = round(monthly_payment, 2)
        total_repayment = round(monthly_payment * n, 2)
        total_interest = round(total_repayment - amount, 2)

        # Premières et dernières échéances
        installments = []
        balance = amount
        for i in range(1, n + 1):
            interest = round(balance * monthly_rate, 2)
            principal = round(monthly_payment - interest, 2)
            balance = round(balance - principal, 2)
            if i <= 3 or i >= n - 1:
                installments.append({
                    "month": i,
                    "payment": monthly_payment,
                    "principal": principal,
                    "interest": interest,
                    "balance": max(balance, 0),
                })

        return {
            "principalAmount": amount,
            "annualRatePct": annual_rate,
            "termMonths": n,
            "monthlyPayment": monthly_payment,
            "totalRepayment": total_repayment,
            "totalInterest": total_interest,
            "currency": self.app.currency or "USD",
            "installmentsSample": installments,
        }

    # ── Note de valorisation ──────────────────────────────────────────────────

    def _valuation_note(self, score: float, eligible: bool) -> str:
        if score >= 85:
            return "Dossier excellent — traitement prioritaire recommandé."
        if score >= 70:
            return "Dossier solide — aucune réserve majeure."
        if score >= 55:
            return "Dossier recevable — quelques points d'attention à lever."
        if eligible:
            return "Dossier limite — examen approfondi requis avant approbation."
        return "Score insuffisant — dossier non éligible en l'état."


# ── Simulation sans dossier persisté ─────────────────────────────────────────

class SimulationContext:
    """
    Objet léger imitant CreditApplication pour la simulation /simulate/.
    Permet de scorer sans créer de dossier en base.
    """

    def __init__(
        self,
        client,
        value_chain=None,
        needs_sheet=None,
        area_ha=None,
        amount_requested=None,
        currency: str = "USD",
    ) -> None:
        self.client = client
        self.value_chain = value_chain
        self.needs_sheet = needs_sheet
        self.area_ha = decimal.Decimal(str(area_ha)) if area_ha else None
        self.amount_requested = decimal.Decimal(str(amount_requested)) if amount_requested else None
        self.currency = currency
        self.pk = None  # pas de PK → les requêtes `.exclude(pk=self.app.pk)` fonctionnent


def simulate(
    client_sub: str,
    value_chain_code: str | None = None,
    needs_sheet_id: int | None = None,
    area_ha: float | None = None,
    amount_requested: float | None = None,
    currency: str = "USD",
) -> dict:
    """
    Simule le scoring sans créer de dossier en base.
    Utilisé par POST /api/credits/simulate/.
    """
    from accounts.models import FintechUser
    from reference_data.models import ValueChain
    from credits.models import NeedsSheet

    try:
        client = FintechUser.objects.select_related("kyc_profile").get(sub=client_sub)
    except FintechUser.DoesNotExist:
        return {"error": "client_not_found"}

    value_chain = None
    if value_chain_code:
        try:
            value_chain = ValueChain.objects.get(code=value_chain_code, active=True)
        except ValueChain.DoesNotExist:
            return {"error": f"Filière '{value_chain_code}' inconnue."}

    needs_sheet = None
    if needs_sheet_id:
        try:
            needs_sheet = NeedsSheet.objects.get(pk=needs_sheet_id, uploaded_by=client_sub)
        except NeedsSheet.DoesNotExist:
            pass

    ctx = SimulationContext(
        client=client,
        value_chain=value_chain,
        needs_sheet=needs_sheet,
        area_ha=area_ha,
        amount_requested=amount_requested,
        currency=currency,
    )
    engine = CreditScoringEngine(ctx)
    return engine.compute()

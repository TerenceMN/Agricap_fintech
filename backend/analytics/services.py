"""Score de conformité pondéré multi-composantes (Supervision.jsx) — remplace le simple
« % de KYC validés » calculé auparavant côté client. Chaque composante qui n'a aucune
donnée source (ex. aucun profil KYC créé, aucun rapprochement complété sur 30 jours) vaut
`None` et ses poids sont RENORMALISÉS sur les composantes restantes — plutôt que de compter
silencieusement cette composante comme 0/100, ce qui pénaliserait injustement un système
juste encore vide de données."""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from .models import ComplianceScoreSnapshot

# Poids v1 — composantes calculables avec les données réellement présentes dans le
# système (pas de "KYC agences"/"reporting réglementaire"/"actions correctives" : ces
# concepts n'existent nulle part ailleurs dans AGRICAP FINTECH, les inventer ici serait
# fabriquer un chiffre sans substance).
COMPONENT_WEIGHTS = {
    "KYC_CLIENTS": 0.35,
    "RAPPRO_PONCTUALITE": 0.25,
    "ALERTES_CRITIQUES": 0.20,
    "RESEAU_ACTIF": 0.20,
}

_RECONCILIATION_WINDOW_DAYS = 30
_RECONCILIATION_PUNCTUAL_HOURS = 24


def _kyc_clients_score() -> float | None:
    from compliance.models import KycProfile
    total = KycProfile.objects.count()
    if not total:
        return None
    validated = KycProfile.objects.filter(kyc_status=KycProfile.Status.VALIDE).count()
    return round(validated / total * 100, 1)


def _rapprochement_ponctualite_score() -> float | None:
    from agencies.models import AgencyReconciliation
    since = timezone.now() - timedelta(days=_RECONCILIATION_WINDOW_DAYS)
    completed = AgencyReconciliation.objects.filter(
        status=AgencyReconciliation.Status.COMPLETED, closed_at__gte=since,
    )
    total = completed.count()
    if not total:
        return None
    punctual = sum(
        1 for r in completed
        if r.closed_at and (r.closed_at - r.opened_at) <= timedelta(hours=_RECONCILIATION_PUNCTUAL_HOURS)
    )
    return round(punctual / total * 100, 1)


def _alertes_critiques_score() -> float | None:
    from transactions.models import SpecialCase
    active_critical = SpecialCase.objects.filter(
        alert_level=SpecialCase.AlertLevel.CRITIQUE,
    ).exclude(status=SpecialCase.Status.BLOQUE).count()
    return max(0.0, 100.0 - 10.0 * active_critical)


def _reseau_actif_score() -> float | None:
    from agencies.models import Agency
    denom = Agency.objects.exclude(status=Agency.Status.FERMEE).count()
    if not denom:
        return None
    active = Agency.objects.filter(status=Agency.Status.ACTIF).count()
    return round(active / denom * 100, 1)


_COMPONENT_FUNCS = {
    "KYC_CLIENTS": ("KYC clients validés", _kyc_clients_score),
    "RAPPRO_PONCTUALITE": ("Rapprochements clôturés < 24h", _rapprochement_ponctualite_score),
    "ALERTES_CRITIQUES": ("Absence d'alertes critiques", _alertes_critiques_score),
    "RESEAU_ACTIF": ("Agences actives du réseau", _reseau_actif_score),
}


def compute_compliance_score(*, persist: bool = True) -> dict:
    components = []
    for code, (label, fn) in _COMPONENT_FUNCS.items():
        components.append({"code": code, "label": label, "weight": COMPONENT_WEIGHTS[code], "score": fn()})

    available = [c for c in components if c["score"] is not None]
    if not available:
        global_score = None
    else:
        weight_sum = sum(c["weight"] for c in available)
        global_score = round(sum(c["score"] * c["weight"] for c in available) / weight_sum, 1)

    delta_wow = None
    if global_score is not None:
        reference = ComplianceScoreSnapshot.objects.filter(
            computed_at__lte=timezone.now() - timedelta(days=7),
        ).order_by("-computed_at").first()
        if reference:
            delta_wow = round(global_score - reference.global_score, 1)

    # Persistance limitée à un instantané par heure (pas de planificateur dans ce projet
    # pour un vrai recalcul horaire en tâche de fond) — évite qu'un simple rafraîchissement
    # de la page Supervision ne crée un instantané à chaque requête.
    if persist and global_score is not None:
        recent = ComplianceScoreSnapshot.objects.filter(
            computed_at__gte=timezone.now() - timedelta(hours=1),
        ).exists()
        if not recent:
            ComplianceScoreSnapshot.objects.create(global_score=global_score, components=components)

    return {"score": global_score, "components": components, "deltaWow": delta_wow}

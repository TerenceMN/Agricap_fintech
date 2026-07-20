"""Paliers KYC (T1/T2/T3) dérivés des documents APPROUVÉS d'un utilisateur — remplace le
`kyc_level`/`monthly_limit` figés de `KycProfile` (valeurs par défaut statiques, jamais
recalculées) par une progression réelle : T1 (aucun document validé) -> T2 (pièce d'identité
validée) -> T3 (pièce d'identité + justificatif de domicile validés). Recalculé au moment de
chaque revue de document (`document_review`), pas sur un planificateur (aucune infrastructure
de tâches planifiées dans ce projet — même principe que `support.sla`)."""
from __future__ import annotations

from decimal import Decimal

from common.choices import FlowStatus

from .models import Document, KycProfile

LEVEL_LIMITS = {"T1": Decimal("500"), "T2": Decimal("5000"), "T3": Decimal("50000")}
BALANCE_CAPS = {"T1": Decimal("1000"), "T2": Decimal("10000"), "T3": Decimal("1000000")}
DEFAULT_LEVEL = "T1"


def compute_kyc_level(*, user) -> str:
    approved = Document.objects.filter(user=user, status=FlowStatus.APPROVED)
    has_id = approved.filter(type=Document.Type.ID_CARD).exists()
    has_address = approved.filter(type=Document.Type.PROOF_ADDRESS).exists()
    if has_id and has_address:
        return "T3"
    if has_id:
        return "T2"
    return DEFAULT_LEVEL


def sync_kyc_level(*, user) -> KycProfile:
    profile, _ = KycProfile.objects.get_or_create(user=user)
    level = compute_kyc_level(user=user)
    limit = LEVEL_LIMITS[level]
    if profile.kyc_level != level or profile.monthly_limit != limit:
        profile.kyc_level = level
        profile.monthly_limit = limit
        profile.save(update_fields=["kyc_level", "monthly_limit", "updated_at"])
    return profile


def monthly_limit_for(*, user) -> Decimal:
    profile = KycProfile.objects.filter(user=user).first()
    return profile.monthly_limit if profile else LEVEL_LIMITS[DEFAULT_LEVEL]


def balance_cap_for(*, user) -> Decimal:
    profile = KycProfile.objects.filter(user=user).first()
    level = profile.kyc_level if profile else DEFAULT_LEVEL
    return BALANCE_CAPS.get(level, BALANCE_CAPS[DEFAULT_LEVEL])


def monthly_withdrawal_total(*, user, currency: str, now=None) -> Decimal:
    """Somme des retraits déjà effectués ce mois civil, tous portefeuilles de cette devise —
    utilisé pour vérifier le plafond KYC avant d'accepter un nouveau retrait."""
    from django.db.models import Sum
    from django.utils import timezone

    from caisses.models import WalletMovement

    now = now or timezone.now()
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total = WalletMovement.objects.filter(
        wallet__user=user, wallet__currency=currency, kind=WalletMovement.Kind.WITHDRAW,
        created_at__gte=start_of_month,
    ).aggregate(total=Sum("amount"))["total"]
    return total or Decimal("0")

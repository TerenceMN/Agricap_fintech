"""
Service de gestion des garanties (Étape 4).

Quatre types canoniques :
  epargne   — blocage d'un montant sur SavingsPlan (hold comptable)
  morale    — caution solidaire d'un tiers avec confirmation J+7
  materiel  — gage sur un actif mobilier vérifié (assets.Asset)
  foncier   — hypothèque sur un actif immobilier vérifié (assets.Asset)

Principe 9 — une garantie est opposable ou n'est pas. Concrètement :
  - le type posé doit figurer dans `ValueChain.eligible_guarantees` de la
    filière du dossier (`assert_type_eligible`) ;
  - un gage porte sur un actif **vérifié par un agent**, libre de tout autre
    gage, et pour sa **valeur retenue** après décote — jamais sa valeur déclarée ;
  - le double gage est empêché par un verrou atomique posé à la confirmation.

Le module ne modifie pas les modèles du module savings — il crée uniquement
des enregistrements CreditGuarantee dans le module credits.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone


# ── Helpers ────────────────────────────────────────────────────────────────────

def _hold_ref() -> str:
    return f"HOLD-{uuid.uuid4().hex[:8].upper()}"


def _available_savings_balance(savings_plan, currency: str) -> Decimal:
    """
    Solde disponible = balance − somme des holds actifs sur ce plan.
    On reste dans le module credits pour ne pas coupler au module savings.
    """
    from credits.models import CreditGuarantee
    active_holds = CreditGuarantee.objects.filter(
        savings_plan=savings_plan,
        guarantee_type=CreditGuarantee.GuaranteeType.EPARGNE,
        status__in=[
            CreditGuarantee.Status.ACTIVE,
            CreditGuarantee.Status.PENDING,
        ],
    )
    held = sum(g.hold_amount or Decimal(0) for g in active_holds)
    return (savings_plan.balance or Decimal(0)) - held


# ── Garantie épargne ───────────────────────────────────────────────────────────

class InsufficientSavingsError(Exception):
    pass


class GuaranteeError(Exception):
    pass


@transaction.atomic
def place_savings_hold(
    application,
    savings_plan_id: int,
    amount: Decimal,
    registered_by_sub: str,
    notes: str = "",
) -> "credits.models.CreditGuarantee":
    """
    Bloque `amount` sur le plan d'épargne `savings_plan_id` pour le dossier.

    Règles :
      - Le plan doit appartenir au client du dossier
      - Le solde disponible (hors holds actifs) doit être ≥ amount
      - Un dossier ne peut avoir qu'un seul hold actif à la fois
    """
    from savings.models import SavingsPlan
    from credits.models import CreditGuarantee

    try:
        plan = SavingsPlan.objects.get(pk=savings_plan_id, user=application.client)
    except SavingsPlan.DoesNotExist:
        raise GuaranteeError("Plan d'épargne introuvable ou n'appartient pas au client.")

    if plan.status != SavingsPlan.Status.ACTIF:
        raise GuaranteeError("Le plan d'épargne n'est pas actif.")

    assert_type_eligible(application, CreditGuarantee.GuaranteeType.EPARGNE)

    available = _available_savings_balance(plan, plan.currency)
    if available < amount:
        raise InsufficientSavingsError(
            f"Solde disponible insuffisant : {available:.2f} {plan.currency} "
            f"(demandé : {amount:.2f} {plan.currency}, dont "
            f"{plan.balance - available:.2f} déjà bloqués)."
        )

    # Libérer un éventuel hold précédent sur ce dossier
    existing = CreditGuarantee.objects.filter(
        application=application,
        guarantee_type=CreditGuarantee.GuaranteeType.EPARGNE,
        status__in=[CreditGuarantee.Status.ACTIVE, CreditGuarantee.Status.PENDING],
    ).first()
    if existing:
        _do_release(existing)

    guarantee = CreditGuarantee.objects.create(
        application=application,
        guarantee_type=CreditGuarantee.GuaranteeType.EPARGNE,
        status=CreditGuarantee.Status.ACTIVE,
        savings_plan=plan,
        hold_amount=amount,
        hold_currency=plan.currency,
        hold_reference=_hold_ref(),
        hold_placed_at=timezone.now(),
        registered_by_sub=registered_by_sub,
        notes=notes,
    )

    # Mettre à jour le champ guarantee_type sur le dossier
    application.guarantee_type = "epargne"
    application.save(update_fields=["guarantee_type", "updated_at"])

    return guarantee


def release_savings_hold(guarantee) -> None:
    """Libère un bloc d'épargne (rejet, annulation, expiration)."""
    if guarantee.guarantee_type != "epargne":
        raise GuaranteeError("Cette garantie n'est pas de type épargne.")
    if guarantee.status == guarantee.Status.RELEASED:
        return
    _do_release(guarantee)


def _do_release(guarantee) -> None:
    guarantee.status = guarantee.Status.RELEASED
    guarantee.hold_released_at = timezone.now()
    guarantee.save(update_fields=["status", "hold_released_at", "updated_at"])

    # Un gage sur actif libère aussi l'actif sous-jacent
    if guarantee.asset_id:
        from assets.services import release_asset
        release_asset(guarantee.asset)


# ── Éligibilité du type de garantie par filière ───────────────────────────────

class GuaranteeTypeNotEligible(GuaranteeError):
    """Type de garantie non admis pour la filière du dossier."""


def assert_type_eligible(application, guarantee_type: str) -> None:
    """Vérifie que le type figure dans `ValueChain.eligible_guarantees`.

    Le référentiel filière portait déjà ce champ sans que rien ne le contrôle :
    n'importe quel type pouvait être posé sur n'importe quelle filière. Le
    contrôle est fait ici, à la pose, et re-vérifié à la soumission (défense en
    profondeur — un dossier ancien peut contenir un type devenu inéligible
    après mise à jour du référentiel).

    Filière absente du dossier : on n'invente pas de règle, on laisse passer —
    le scoring signalera l'absence de filière par ailleurs.
    """
    chain = getattr(application, "value_chain", None)
    if chain is None:
        return

    eligible = list(getattr(chain, "eligible_guarantees", None) or [])
    if not eligible:
        return  # référentiel non renseigné : pas de restriction inventée

    if guarantee_type not in eligible:
        raise GuaranteeTypeNotEligible(
            f"La garantie « {guarantee_type} » n'est pas admise pour la filière "
            f"{chain.label} (types admis : {', '.join(eligible)})."
        )


# ── Garantie sur actif (materiel / foncier) ───────────────────────────────────

@transaction.atomic
def place_asset_guarantee(
    application,
    asset_id: int,
    registered_by_sub: str,
) -> "credits.models.CreditGuarantee":
    """Pose un gage sur un actif vérifié du client.

    Cinq règles bloquantes, dans cet ordre — chacune renvoie un code distinct
    pour que le front puisse guider le client plutôt qu'afficher « erreur » :
      1. l'actif existe et appartient au client du dossier   ASSET_NOT_OWNED
      2. il est vérifié et libre de gage                     ASSET_NOT_VERIFIED / ASSET_ALREADY_PLEDGED
      3. sa catégorie donne un type de garantie              ASSET_CATEGORY_MISMATCH
      4. ce type est admis pour la filière                   GUARANTEE_TYPE_NOT_ELIGIBLE
      5. il porte une valeur retenue                         ASSET_NO_RETAINED_VALUE

    La garantie est créée en PENDING : le gage effectif de l'actif n'intervient
    qu'à la confirmation par un agent (`confirm_asset_guarantee`), qui pose le
    verrou atomique contre le double gage.
    """
    from assets.models import Asset
    from credits.models import CreditGuarantee

    # 1. Propriété
    asset = Asset.objects.filter(pk=asset_id).first()
    if asset is None or asset.user_id != application.client_id:
        raise GuaranteeError(
            "Actif introuvable ou n'appartenant pas au client du dossier."
        )

    # 2. Statut
    if asset.gage_application_id is not None:
        raise GuaranteeError(
            f"L'actif « {asset.name} » est déjà nanti sur un autre dossier."
        )
    if asset.status not in (Asset.Status.VERIFIE, Asset.Status.LIBERE):
        raise GuaranteeError(
            f"L'actif « {asset.name} » n'a pas été vérifié par un agent. "
            "Un actif déclaré ne peut pas servir de garantie."
        )

    # 3. Catégorie → type de garantie
    guarantee_type = asset.guarantee_type
    if not guarantee_type:
        raise GuaranteeError(
            f"La catégorie « {asset.type} » ne correspond à aucun type de garantie."
        )

    # 4. Éligibilité filière
    assert_type_eligible(application, guarantee_type)

    # 5. Valeur retenue
    if not asset.valeur_retenue or asset.valeur_retenue <= 0:
        raise GuaranteeError(
            "L'actif n'a pas de valeur retenue : la vérification est incomplète."
        )

    # Un même actif ne peut pas être proposé deux fois sur le même dossier
    existing = CreditGuarantee.objects.filter(
        application=application, asset=asset,
        status__in=[CreditGuarantee.Status.PENDING, CreditGuarantee.Status.ACTIVE],
    ).first()
    if existing:
        return existing

    return CreditGuarantee.objects.create(
        application=application,
        guarantee_type=guarantee_type,
        status=CreditGuarantee.Status.PENDING,
        asset=asset,
        covered_amount=asset.valeur_retenue,
        hold_currency=asset.currency,
        registered_by_sub=registered_by_sub,
    )


@transaction.atomic
def confirm_asset_guarantee(guarantee, confirmer_sub: str):
    """Confirme un gage : l'actif passe effectivement en `gage`, sous verrou.

    C'est ici — et pas à la pose — que le double gage est empêché : deux
    dossiers qui confirment simultanément sur le même actif sont sérialisés par
    le `select_for_update` de `pledge_asset`.
    """
    from assets.services import AssetAlreadyPledged, AssetError, pledge_asset
    from credits.models import CreditGuarantee

    if guarantee.guarantee_type not in CreditGuarantee.ASSET_BACKED_TYPES:
        raise GuaranteeError("Cette garantie n'est pas un gage sur actif.")
    if guarantee.status == CreditGuarantee.Status.ACTIVE:
        return guarantee
    if guarantee.status == CreditGuarantee.Status.RELEASED:
        raise GuaranteeError("Garantie déjà levée.")

    try:
        asset = pledge_asset(guarantee.asset_id, guarantee.application)
    except AssetAlreadyPledged as exc:
        raise GuaranteeError(str(exc)) from exc
    except AssetError as exc:
        raise GuaranteeError(str(exc)) from exc

    guarantee.status = CreditGuarantee.Status.ACTIVE
    guarantee.covered_amount = asset.valeur_retenue
    guarantee.confirmed_by_sub = confirmer_sub
    guarantee.confirmed_at = timezone.now()
    guarantee.save(update_fields=[
        "status", "covered_amount", "confirmed_by_sub", "confirmed_at", "updated_at",
    ])
    return guarantee


# ── Garantie morale ────────────────────────────────────────────────────────────

MORAL_GUARANTEE_EXPIRY_DAYS = 7


@transaction.atomic
def register_moral_guarantee(
    application,
    guarantor_name: str,
    guarantor_phone: str,
    guarantor_id_number: str,
    registered_by_sub: str,
    guarantor_sub: str = "",
    notes: str = "",
) -> "credits.models.CreditGuarantee":
    """
    Enregistre une caution morale.
    Le garant a MORAL_GUARANTEE_EXPIRY_DAYS jours pour confirmer.
    Pendant ce délai le statut est PENDING.
    """
    from credits.models import CreditGuarantee

    if not guarantor_name.strip():
        raise GuaranteeError("Le nom du garant est requis.")
    if not guarantor_phone.strip():
        raise GuaranteeError("Le téléphone du garant est requis.")
    if not guarantor_id_number.strip():
        raise GuaranteeError("Le numéro d'identité du garant est requis.")

    assert_type_eligible(application, CreditGuarantee.GuaranteeType.MORALE)

    # Invalider toute caution morale PENDING ou ACTIVE précédente sur ce dossier
    CreditGuarantee.objects.filter(
        application=application,
        guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
        status__in=[CreditGuarantee.Status.PENDING, CreditGuarantee.Status.ACTIVE],
    ).update(status=CreditGuarantee.Status.RELEASED, updated_at=timezone.now())

    expires = timezone.now() + timezone.timedelta(days=MORAL_GUARANTEE_EXPIRY_DAYS)

    guarantee = CreditGuarantee.objects.create(
        application=application,
        guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
        status=CreditGuarantee.Status.PENDING,
        guarantor_sub=guarantor_sub,
        guarantor_name=guarantor_name,
        guarantor_phone=guarantor_phone,
        guarantor_id_number=guarantor_id_number,
        expires_at=expires,
        registered_by_sub=registered_by_sub,
        notes=notes,
    )

    application.guarantee_type = "morale"
    application.save(update_fields=["guarantee_type", "updated_at"])

    # Notifier le garant par SMS si le module SMS est disponible
    _notify_guarantor_sms(guarantee)

    return guarantee


def confirm_moral_guarantee(
    guarantee, confirmer_sub: str
) -> "credits.models.CreditGuarantee":
    """
    Le garant confirme sa caution morale.
    `confirmer_sub` doit correspondre à guarantor_sub (si renseigné)
    ou être un agent autorisé avec preuve physique.
    """
    from credits.models import CreditGuarantee

    if guarantee.guarantee_type != CreditGuarantee.GuaranteeType.MORALE:
        raise GuaranteeError("Cette garantie n'est pas de type caution morale.")
    if guarantee.status == CreditGuarantee.Status.ACTIVE and guarantee.confirmed_at:
        raise GuaranteeError("Déjà confirmée.")
    if guarantee.status == CreditGuarantee.Status.RELEASED:
        raise GuaranteeError("Garantie déjà levée.")
    if guarantee.is_expired:
        guarantee.status = CreditGuarantee.Status.EXPIRED
        guarantee.save(update_fields=["status", "updated_at"])
        raise GuaranteeError(
            f"Délai de confirmation expiré le {guarantee.expires_at.strftime('%d/%m/%Y')}."
        )

    # Si un sub garant est renseigné, seul lui peut confirmer
    if guarantee.guarantor_sub and guarantee.guarantor_sub != confirmer_sub:
        raise GuaranteeError(
            "Le confirmateur doit être le garant enregistré "
            f"({guarantee.guarantor_name})."
        )

    guarantee.status = CreditGuarantee.Status.ACTIVE
    guarantee.confirmed_by_sub = confirmer_sub
    guarantee.confirmed_at = timezone.now()
    guarantee.save(update_fields=["status", "confirmed_by_sub", "confirmed_at", "updated_at"])
    return guarantee


def expire_pending_moral_guarantees() -> int:
    """
    Passe en EXPIRED toutes les cautions morales PENDING dont le délai est dépassé.
    À appeler depuis une tâche Celery périodique (quotidienne).
    Retourne le nombre d'enregistrements mis à jour.
    """
    from credits.models import CreditGuarantee
    now = timezone.now()
    updated = CreditGuarantee.objects.filter(
        guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
        status=CreditGuarantee.Status.PENDING,
        expires_at__lt=now,
    ).update(status=CreditGuarantee.Status.EXPIRED, updated_at=now)
    return updated


# ── Notification SMS garant ────────────────────────────────────────────────────

def _notify_guarantor_sms(guarantee) -> None:
    """Envoie un SMS au garant (best-effort, échec silencieux)."""
    try:
        from common.sms import send_sms
        phone = guarantee.guarantor_phone
        app = guarantee.application
        expires = guarantee.expires_at.strftime("%d/%m/%Y")
        message = (
            f"AGRICAP : Vous êtes désigné garant du dossier crédit {app.code} "
            f"(client : {app.client.full_name}). "
            f"Confirmez votre caution avant le {expires} via l'application ou "
            f"auprès de votre agence."
        )
        send_sms(phone, message)
    except Exception:
        pass  # SMS non bloquant


# ── Vue synthèse des garanties d'un dossier ───────────────────────────────────

def get_guarantee_summary(application) -> dict[str, Any]:
    """Retourne un résumé des garanties actives d'un dossier."""
    from credits.models import CreditGuarantee

    guarantees = list(
        application.guarantees.order_by("-created_at")
    )

    result: dict[str, Any] = {
        "count": len(guarantees),
        "guaranteeType": application.guarantee_type or None,
        "items": [],
    }

    # Couverture = somme des montants retenus des garanties ACTIVES uniquement.
    # Une garantie en attente de confirmation ne couvre rien.
    couverture = Decimal("0")

    for g in guarantees:
        item: dict = {
            "id": g.pk,
            "type": g.guarantee_type,
            "status": g.status,
            "coveredAmount": float(g.covered_amount) if g.covered_amount is not None else None,
            "createdAt": g.created_at.isoformat(),
        }
        if g.status == CreditGuarantee.Status.ACTIVE:
            couverture += g.covered_amount or g.hold_amount or Decimal("0")

        if g.guarantee_type in CreditGuarantee.ASSET_BACKED_TYPES and g.asset_id:
            item.update({
                "asset": {
                    "id": g.asset_id,
                    "name": g.asset.name,
                    "category": g.asset.type,
                    "declaredValue": float(g.asset.value),
                    "retainedValue": (
                        float(g.asset.valeur_retenue)
                        if g.asset.valeur_retenue is not None else None
                    ),
                    "currency": g.asset.currency,
                    "status": g.asset.status,
                    "verifiedAt": (
                        g.asset.verifie_le.isoformat() if g.asset.verifie_le else None
                    ),
                },
                "confirmedAt": g.confirmed_at.isoformat() if g.confirmed_at else None,
            })
        if g.guarantee_type == CreditGuarantee.GuaranteeType.EPARGNE:
            item.update({
                "holdAmount": float(g.hold_amount or 0),
                "holdCurrency": g.hold_currency,
                "holdReference": g.hold_reference,
                "holdPlacedAt": g.hold_placed_at.isoformat() if g.hold_placed_at else None,
                "holdReleasedAt": g.hold_released_at.isoformat() if g.hold_released_at else None,
                "availableBalance": (
                    float(_available_savings_balance(g.savings_plan, g.hold_currency))
                    if g.savings_plan and g.status != CreditGuarantee.Status.RELEASED
                    else None
                ),
            })
        elif g.guarantee_type == CreditGuarantee.GuaranteeType.MORALE:
            item.update({
                "guarantorName": g.guarantor_name,
                "guarantorPhone": g.guarantor_phone,
                "guarantorIdNumber": g.guarantor_id_number,
                "confirmedAt": g.confirmed_at.isoformat() if g.confirmed_at else None,
                "expiresAt": g.expires_at.isoformat() if g.expires_at else None,
                "isExpired": g.is_expired,
                "daysLeft": (
                    max(0, (g.expires_at - timezone.now()).days)
                    if g.expires_at and g.status == CreditGuarantee.Status.PENDING
                    else None
                ),
            })
        result["items"].append(item)

    montant = application.amount_approved or application.amount_requested
    result["coverage"] = {
        "retainedTotal": float(couverture),
        "currency": application.currency,
        "requestedAmount": float(montant) if montant is not None else None,
        # Ratio calculé sur les valeurs retenues après décote, jamais déclarées
        "ratio": (
            round(float(couverture / montant), 3)
            if montant else None
        ),
        "activeCount": sum(
            1 for g in guarantees if g.status == CreditGuarantee.Status.ACTIVE
        ),
    }
    return result

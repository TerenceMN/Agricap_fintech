"""Canal d'une opération de portefeuille (dépôt/retrait) — par quelle « porte » l'argent
passe. C'est le socle de la décision du fondateur : **le portefeuille est le seul point de
contact avec l'extérieur, et une seule porte y donne accès.**

Deux familles :

* **interne** (`agent`) : espèces / agence — le staff CONSTATE la remise. Le mouvement est
  crédité/débité directement, sans fournisseur (comportement historique).
* **externe** (`mobile_money`, `bank`) : l'argent traverse réellement un tiers (Makuta). Un
  dépôt externe n'est crédité qu'à la CONFIRMATION du fournisseur ; un retrait externe n'est
  versé qu'APRÈS l'approbation humaine et le débit du portefeuille. Ces cas passent par un
  `PaymentOrder` (voir `caisses/payments.py`), jamais par un crédit/débit direct.

Les codes reprennent volontairement la nomenclature de `savings.SavingsPlan.Channel`
(`agent` / `mobile_money` / `bank` / `wallet`) — principe 6 : une seule nomenclature PAR
concept. Cette table gagnerait à vivre dans `common/` pour être partagée entre `savings` et
`caisses` sans duplication (demandé dans le rapport ; `common/` n'est pas dans ce périmètre).

Le NOM d'opération renvoyé (`MM_COLLECT`, `BANK_PAYOUT`…) est une clé LOGIQUE dans
`settings.MAKUTA["OPERATIONS"]` : aucun endpoint métier Makuta n'est codé en dur ici, la
documentation fournisseur ne décrivant que l'authentification (cf. `payments.py`).
"""
from __future__ import annotations

from common.exceptions import ValidationFailed

#: Canal interne — le staff constate la remise physique (espèces/agence).
AGENT = "agent"
#: Canaux externes — l'argent traverse un tiers, donc passe par un ordre de paiement Makuta.
MOBILE_MONEY = "mobile_money"
BANK = "bank"

#: Vide = interne par défaut (compatibilité : l'ancien dépôt ne portait pas de canal).
INTERNAL_CHANNELS = frozenset({AGENT, ""})
EXTERNAL_CHANNELS = frozenset({MOBILE_MONEY, BANK})
KNOWN_CHANNELS = INTERNAL_CHANNELS | EXTERNAL_CHANNELS

#: Canal externe → nom LOGIQUE de l'opération fournisseur (clé de settings.MAKUTA).
_COLLECT_OPERATION = {MOBILE_MONEY: "MM_COLLECT", BANK: "BANK_COLLECT"}
_PAYOUT_OPERATION = {MOBILE_MONEY: "MM_PAYOUT", BANK: "BANK_PAYOUT"}

#: Table INVERSE : chaque opération du catalogue impose un sens. Elle existe pour qu'un
#: appelant ne puisse pas demander un encaissement sur l'opération de décaissement (et
#: réciproquement) : le sens et le chemin fournisseur partiraient alors dans deux directions
#: opposées, et l'ordre serait irréconciliable. Les sens repris ici sont exactement ceux de
#: `PaymentOrder.Direction` — la valeur, pas l'énumération, pour ne pas importer les modèles
#: dans ce module de nomenclature.
_OPERATION_DIRECTION = {
    **{operation: "COLLECTION" for operation in _COLLECT_OPERATION.values()},
    **{operation: "PAYOUT" for operation in _PAYOUT_OPERATION.values()},
}


def is_known(channel: str) -> bool:
    return (channel or "") in KNOWN_CHANNELS


def is_external(channel: str) -> bool:
    """Vrai si ce canal engage réellement un tiers (Makuta), donc un `PaymentOrder`."""
    return (channel or "") in EXTERNAL_CHANNELS


def collect_operation(channel: str) -> str:
    """Nom logique de l'opération d'ENCAISSEMENT pour ce canal externe (dépôt)."""
    try:
        return _COLLECT_OPERATION[channel]
    except KeyError:
        raise ValidationFailed(
            f"Canal d'encaissement externe inconnu : « {channel or '(vide)'} »."
        ) from None


def payout_operation(channel: str) -> str:
    """Nom logique de l'opération de DÉCAISSEMENT pour ce canal externe (retrait)."""
    try:
        return _PAYOUT_OPERATION[channel]
    except KeyError:
        raise ValidationFailed(
            f"Canal de décaissement externe inconnu : « {channel or '(vide)'} »."
        ) from None


def direction_for_operation(operation: str) -> str:
    """Sens imposé par une opération du catalogue AGRICAP.

    Renvoie `""` pour toute opération hors catalogue : une configuration sur mesure peut
    exister, et nous ne présumons rien de son sens (principe 2) — la vérification de
    cohérence ne s'applique qu'à ce que nous nommons nous-mêmes.
    """
    return _OPERATION_DIRECTION.get(operation or "", "")


def required_operations() -> tuple[str, ...]:
    """Les opérations que `settings.MAKUTA["OPERATIONS"]` doit couvrir pour que dépôt ET
    retrait fonctionnent sur les deux canaux externes. C'est la liste que `manage.py
    check_makuta` déroule — elle est dérivée d'ici, jamais recopiée ailleurs (principe 6)."""
    return tuple(
        operation
        for channel in (MOBILE_MONEY, BANK)
        for operation in (_COLLECT_OPERATION[channel], _PAYOUT_OPERATION[channel])
    )

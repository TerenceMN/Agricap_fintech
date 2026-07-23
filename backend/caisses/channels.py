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


def is_known(channel: str) -> bool:
    return (channel or "") in KNOWN_CHANNELS


def is_external(channel: str) -> bool:
    """Vrai si ce canal engage réellement un tiers (Makuta), donc un `PaymentOrder`."""
    return (channel or "") in EXTERNAL_CHANNELS


def collect_operation(channel: str) -> str:
    """Nom logique de l'opération d'ENCAISSEMENT pour ce canal externe (dépôt)."""
    return _COLLECT_OPERATION[channel]


def payout_operation(channel: str) -> str:
    """Nom logique de l'opération de DÉCAISSEMENT pour ce canal externe (retrait)."""
    return _PAYOUT_OPERATION[channel]

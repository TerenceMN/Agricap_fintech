"""Services FX — le taux appliqué à une conversion DOIT être figé et stocké au moment de
l'opération, jamais recalculé a posteriori (voir Annexe A du prompt de conception)."""
from __future__ import annotations

import logging
import re
import time
import warnings
from datetime import date as date_cls
from decimal import Decimal, InvalidOperation

import requests
import urllib3
from django.db import transaction
from django.utils import timezone

from audit.services import record as audit_record
from common.exceptions import NotFoundError, ValidationFailed
from common.parsing import to_decimal

from .models import ExchangeRate

logger = logging.getLogger("fx.bcc_sync")

MIN_CLIENT_MARGIN_VS_BCC = Decimal("0.015")  # 1.5%, marge minimale client/staff vs BCC

# BCC ne publie plus qu'un « Cours indicatif » unique par devise (colonnes acheteur/vendeur
# masquées côté source, cf. commentaire HTML de leur page) — `ExchangeRate` exige pourtant
# sell > buy. On applique un spread synthétique minime, symétrique autour du cours réel
# publié, uniquement pour satisfaire cette contrainte de schéma ; le cours BCC réel reste le
# point central (buy+sell)/2.
BCC_SYNTHETIC_SPREAD = Decimal("0.0005")  # 0.05%
BCC_RATES_URL = "https://www.bcc.cd/operations-et-marches/domaine-operationnel/operations-de-change/cours-de-change"
BCC_MAX_ATTEMPTS = 3
BCC_RETRY_DELAY_SECONDS = 2
BCC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
# Bornes de plausibilité du « Cours indicatif » (CDF pour 1 unité de devise) — protège contre
# un parsing corrompu (page restructurée, valeur capturée par erreur) plutôt que d'enregistrer
# silencieusement un chiffre absurde comme taux officiel.
BCC_MIN_PLAUSIBLE_RATE = Decimal("0.01")
BCC_MAX_PLAUSIBLE_RATE = Decimal("1000000")
_BCC_ROW_RE = re.compile(
    r"<td>\s*([A-Z]{3})\s*</td>\s*<td>[^<]*</td>\s*(?:<!--.*?-->\s*)?<td>\s*([\d\s.,]+)\s*</td>",
    re.DOTALL,
)


@transaction.atomic
def set_rate(*, tier: str, currency: str, buy: Decimal | str, sell: Decimal | str,
             effective_date: date_cls, by: str = "") -> ExchangeRate:
    buy = to_decimal(buy)
    sell = to_decimal(sell)
    if sell <= buy:
        raise ValidationFailed("Le taux de vente doit être strictement supérieur au taux d'achat.")
    if tier in (ExchangeRate.Tier.STAFF, ExchangeRate.Tier.CLIENT):
        bcc = ExchangeRate.objects.filter(
            tier=ExchangeRate.Tier.BCC, currency=currency, effective_date=effective_date
        ).first()
        if bcc and sell < bcc.sell_rate * (1 + MIN_CLIENT_MARGIN_VS_BCC):
            raise ValidationFailed(
                "Le taux {} doit avoir une marge d'au moins 1.5% au-dessus du taux BCC.".format(tier)
            )
    rate, _ = ExchangeRate.objects.update_or_create(
        tier=tier, currency=currency, effective_date=effective_date,
        defaults={"buy_rate": buy, "sell_rate": sell, "created_by": by},
    )
    audit_record(actor=by, action="fx.set_rate", entity_type="ExchangeRate", entity_id=str(rate.pk),
                 details={"tier": tier, "currency": currency, "buy": str(buy), "sell": str(sell)})
    return rate


def current_rate(*, tier: str, currency: str, on: date_cls | None = None) -> ExchangeRate | None:
    qs = ExchangeRate.objects.filter(tier=tier, currency=currency)
    if on:
        qs = qs.filter(effective_date__lte=on)
    return qs.order_by("-effective_date").first()


def convert(*, amount: Decimal | str, from_currency: str, to_currency: str, tier: str = "CLIENT",
            on: date_cls | None = None) -> Decimal:
    """Le CDF est le pivot implicite : `from_currency`/`to_currency` valent "CDF" ou une des
    devises étrangères cotées (`ExchangeRate.Currency`)."""
    amount = to_decimal(amount)
    if from_currency == to_currency:
        return amount
    if from_currency == "CDF":
        rate = current_rate(tier=tier, currency=to_currency, on=on)
        if not rate:
            raise NotFoundError(f"Aucun taux {tier}/{to_currency} disponible.")
        return (amount / rate.sell_rate).quantize(Decimal("0.01"))
    if to_currency == "CDF":
        rate = current_rate(tier=tier, currency=from_currency, on=on)
        if not rate:
            raise NotFoundError(f"Aucun taux {tier}/{from_currency} disponible.")
        return (amount * rate.buy_rate).quantize(Decimal("0.01"))
    raise ValidationFailed("Conversion directe entre deux devises étrangères non supportée (passer par CDF).")


def _parse_bcc_number(raw: str) -> Decimal:
    # Format BCC : espace = séparateur de milliers, virgule = séparateur décimal (ex. "2 252,2900").
    cleaned = raw.replace("\xa0", " ").replace(" ", "").replace(",", ".")
    return Decimal(cleaned)


def _fetch_bcc_page() -> str:
    """GET avec re-essais (le site BCC est parfois lent/instable) — `verify=False` car son
    certificat TLS ne se vérifie pas proprement (constaté), et un User-Agent de navigateur
    au cas où le site filtrerait les clients sans en-tête reconnu."""
    last_error: Exception | ValidationFailed | None = None
    for attempt in range(1, BCC_MAX_ATTEMPTS + 1):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", urllib3.exceptions.InsecureRequestWarning)
            try:
                resp = requests.get(BCC_RATES_URL, timeout=15, verify=False,
                                     headers={"User-Agent": BCC_USER_AGENT})
            except requests.RequestException as exc:
                last_error = exc
                logger.warning("Tentative %s/%s échouée (réseau) : %s", attempt, BCC_MAX_ATTEMPTS, exc)
                if attempt < BCC_MAX_ATTEMPTS:
                    time.sleep(BCC_RETRY_DELAY_SECONDS)
                continue
        if resp.status_code == 200:
            return resp.text
        last_error = ValidationFailed(f"BCC a répondu {resp.status_code}.")
        logger.warning("Tentative %s/%s : statut HTTP %s", attempt, BCC_MAX_ATTEMPTS, resp.status_code)
        if attempt < BCC_MAX_ATTEMPTS:
            time.sleep(BCC_RETRY_DELAY_SECONDS)
    raise ValidationFailed(f"BCC injoignable après {BCC_MAX_ATTEMPTS} tentatives : {last_error}")


def fetch_bcc_rates(*, by: str = "") -> list[ExchangeRate]:
    """Récupère le « Cours indicatif » du jour publié par la BCC (page HTML publique, pas
    d'API) et l'enregistre comme taux BCC pour les devises couvertes par `ExchangeRate.
    Currency`. Robustesse : re-essais réseau, tolérance aux lignes/devises individuellement
    illisibles ou hors bornes plausibles (une devise en échec n'annule pas les autres), et le
    formulaire manuel (`set_rate`) reste utilisable si tout échoue — aucune donnée n'est
    jamais écrite tant que le parsing n'a pas produit au moins une valeur exploitable."""
    html = _fetch_bcc_page()

    found: dict[str, Decimal] = {}
    for code, raw_value in _BCC_ROW_RE.findall(html):
        try:
            value = _parse_bcc_number(raw_value)
        except (InvalidOperation, ValueError):
            logger.warning("Valeur illisible pour %s (%r) — ignorée.", code, raw_value)
            continue
        if not (BCC_MIN_PLAUSIBLE_RATE <= value <= BCC_MAX_PLAUSIBLE_RATE):
            logger.warning("Valeur hors bornes plausibles pour %s (%s) — ignorée.", code, value)
            continue
        found[code] = value

    covered = [c for c in ExchangeRate.Currency.values if c in found]
    if not covered:
        raise ValidationFailed(
            "Aucune devise exploitable dans la page BCC (format de page changé, ou valeurs hors bornes)."
        )

    today = timezone.localdate()
    rates: list[ExchangeRate] = []
    errors: list[str] = []
    for code in covered:
        indicatif = found[code]
        buy = (indicatif * (1 - BCC_SYNTHETIC_SPREAD)).quantize(Decimal("0.000001"))
        sell = (indicatif * (1 + BCC_SYNTHETIC_SPREAD)).quantize(Decimal("0.000001"))
        try:
            rates.append(set_rate(tier=ExchangeRate.Tier.BCC, currency=code, buy=buy, sell=sell,
                                   effective_date=today, by=by))
        except Exception as exc:  # une devise en échec (DB, contrainte...) ne bloque pas les autres
            logger.warning("Échec enregistrement %s : %s", code, exc)
            errors.append(f"{code}: {exc}")

    if not rates:
        raise ValidationFailed("Aucun taux BCC n'a pu être enregistré : " + "; ".join(errors))
    logger.info("Synchronisation BCC : %s devise(s) mise(s) à jour (%s).",
                len(rates), ", ".join(r.currency for r in rates))
    return rates

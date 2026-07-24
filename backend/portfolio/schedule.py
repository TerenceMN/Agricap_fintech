"""
Échéancier RÉEL du prêt décaissé (taux & maturité) — le calendrier que le client
rembourse effectivement, par opposition à l'échéancier PRÉVISIONNEL du moteur
d'analyse (`credits/echeancier.py`), qui sert au scoring.

Méthode : intérêt simple sur le solde restant dû en début de période ; amortissement
constant du principal (ou remboursement in fine « bullet »). Le taux est MENSUEL
(en %) — c'est l'unité du champ `Loan.rate`, et c'est le premier écart de méthode
avec le prévisionnel, qui raisonne en taux ANNUEL (cf. « Écarts assumés » ci-dessous).

Règles non négociables (principe 4), alignées mot pour mot sur `credits/echeancier.py` :
  - `Decimal` partout, `float` nulle part — un `float` en entrée lève `TypeError`,
    il n'est jamais converti en silence ;
  - quantize explicite à 0,01 avec `ROUND_HALF_UP` sur chaque montant produit
    (`round()` de Python fait de l'arrondi BANCAIRE : sur 250 × 0,05 %/mois il
    renvoyait 0,12 là où la règle du centime donne 0,13) ;
  - intérêts de la période calculés sur le solde de DÉBUT de période, avant paiement ;
  - dernière tranche de capital ajustée au solde exact → CRD final rigoureusement nul
    ET Σ principal = capital (en `float`, 1 000 amorti sur 3 échéances ne rendait que
    999,99 : le centime résiduel n'était porté par aucune ligne) ;
  - tout montant porte sa devise : chaque ligne et les totaux la transportent.

Écarts de MÉTHODE assumés avec `credits/echeancier.py` (faits à connaître, pas des
bugs d'arrondi — ils sont remontés au fondateur, pas masqués ici) :
  1. unité du taux : MENSUEL ici (`Loan.rate`), ANNUEL dans le prévisionnel ;
     à échéancier identique il faut `Loan.rate = taux_annuel / 12` ;
  2. le prévisionnel gère un DIFFÉRÉ (intérêts seuls / franchise totale) ; ce module
     n'en a aucun — un dossier scoré avec 5 mois de différé est remboursé sans
     différé une fois décaissé ;
  3. ce module gère des périodicités (mensuel/trimestriel/annuel/in fine) que le
     prévisionnel ignore (mensuel strict) ;
  4. la base amortie est `amount_approved` (à défaut `amount_requested`), pas le
     total réellement décaissé.
Hors ces quatre points, et à paramètres équivalents (mensuel, sans différé,
taux mensuel = taux annuel / 12), les deux moteurs produisent les MÊMES chiffres —
c'est verrouillé par un test de non-régression croisé (`portfolio/tests.py`).
"""
from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
CENT_POURCENT = Decimal("100")
MOIS_PAR_AN = Decimal("12")

#: Périodicités de remboursement → pas en mois. « bullet » (in fine) est traité à
#: part : son pas vaut la durée totale du prêt.
FREQ_MONTHS = {"monthly": 1, "quarterly": 3, "annual": 12}


def add_months(d: date, months: int) -> date:
    """Ajoute `months` mois à une date (borne le jour à la fin de mois)."""
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def q2(value: Decimal) -> Decimal:
    """Quantize monétaire unique du module : 0,01 / ROUND_HALF_UP.

    Le pendant exact de `credits.echeancier.q2` : les deux échéanciers d'un même
    prêt ne peuvent pas diverger d'un centime par différence de règle d'arrondi.
    """
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def _dec(value, nom: str) -> Decimal:
    """Conversion stricte vers `Decimal`.

    Un `float` est REFUSÉ, jamais converti : accepter `0.1` (binaire = 0,1000…0055)
    rouvrirait silencieusement la porte que ce module vient de fermer. L'appelant
    doit fournir un `Decimal`, une chaîne ou un entier.
    """
    if isinstance(value, float):
        raise TypeError(
            f"{nom} reçu en float ({value!r}) : le chemin de l'échéancier est en "
            f"Decimal (principe 4). Passez un Decimal, une chaîne ou un entier."
        )
    if value in (None, ""):
        return ZERO
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, ArithmeticError) as exc:
        raise ValueError(f"{nom} n'est pas un nombre exploitable : {value!r}") from exc


def _pas_et_nombre(duration: int, frequency: str) -> tuple[int, int]:
    """Pas de la périodicité (en mois) et nombre d'échéances.

    Le plafond est calculé en arithmétique ENTIÈRE (`-(-a // b)`) : `ceil(a / b)`
    passerait par une division flottante — 8/3 = 2,666…65 — sur le chemin qui
    détermine le nombre d'échéances du client.
    """
    pas = duration if frequency == "bullet" else FREQ_MONTHS.get(frequency, 1)
    pas = pas or 1
    return pas, max(1, -(-duration // pas))


def build_schedule(principal, monthly_rate_pct, duration_months: int,
                   frequency: str, start_date: date, currency: str = "USD") -> list[dict]:
    """Tableau d'amortissement du prêt décaissé.

    Args:
        principal: capital amorti (`Decimal`, chaîne ou entier — jamais un `float`).
        monthly_rate_pct: taux MENSUEL en pourcentage (1.5 = 1,5 %/mois).
        duration_months: durée totale du prêt, en mois.
        frequency: `monthly` | `quarterly` | `annual` | `bullet` (in fine).
        start_date: date d'effet ; la première échéance tombe un pas plus tard.
        currency: devise portée par chaque ligne (aucun montant nu).

    Returns:
        Une ligne par échéance : `number`, `date`, `principal`, `interest`,
        `total`, `balance`, `currency` — tous les montants en `Decimal` quantizés
        à 0,01. Liste vide si le prêt n'a pas de capital ou pas de durée
        (dossier pas encore configuré) — jamais d'échéancier « best effort ».
    """
    principal = q2(_dec(principal, "principal"))
    taux = _dec(monthly_rate_pct, "monthly_rate_pct")
    duration = int(duration_months or 0)
    if principal <= 0 or duration <= 0:
        return []

    pas, nombre = _pas_et_nombre(duration, frequency)
    taux_periode = taux / CENT_POURCENT * Decimal(pas)

    rows: list[dict] = []
    balance = principal
    current = start_date
    for i in range(1, nombre + 1):
        current = add_months(current, pas)
        # Intérêts sur le solde de DÉBUT de période, avant imputation du capital.
        interest = q2(balance * taux_periode)
        if frequency == "bullet":
            principal_payment = balance if i == nombre else ZERO
        else:
            principal_payment = q2(principal / Decimal(nombre))
            if i == nombre:
                # Dernière échéance : on solde EXACTEMENT le résidu d'arrondi des
                # tranches précédentes → CRD final nul et Σ principal = capital.
                principal_payment = balance
        balance = q2(balance - principal_payment)
        rows.append({
            "number": i,
            "date": current.isoformat(),
            "principal": q2(principal_payment),
            "interest": interest,
            "total": q2(principal_payment + interest),
            "balance": balance,
            "currency": currency,
        })
    return rows


def schedule_totals(rows: list[dict], duration_months: int, currency: str = "USD") -> dict:
    """Agrégats de l'échéancier.

    `apr` est un TAUX MOYEN ANNUEL NOMINAL — intérêts totaux rapportés au capital,
    ramenés à l'année — et NON un TAEG : il n'intègre ni frais de dossier, ni
    commissions, ni actualisation des flux. Le libellé « TAEG » de l'écran
    d'échéancier est donc trompeur (écart signalé, correction côté front hors
    périmètre de ce lot).
    """
    total_principal = q2(sum((r["principal"] for r in rows), ZERO))
    total_interest = q2(sum((r["interest"] for r in rows), ZERO))
    annees = Decimal(int(duration_months or 12)) / MOIS_PAR_AN
    apr = ZERO
    if total_principal > 0 and annees > 0:
        apr = q2(total_interest / total_principal / annees * CENT_POURCENT)
    return {
        "total_principal": total_principal,
        "total_interest": total_interest,
        "total_payments": q2(total_principal + total_interest),
        "apr": apr,
        "final_balance": rows[-1]["balance"] if rows else ZERO,
        "currency": currency,
    }

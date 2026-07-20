"""
Calcul de l'échéancier d'amortissement (taux & maturité) — logique déterministe,
portée côté serveur depuis le simulateur du modal admin. Intérêt simple sur le solde
restant pour la période ; amortissement constant du principal (ou remboursement in
fine « bullet »). Le taux est MENSUEL (en %).
"""
from __future__ import annotations

import calendar
from datetime import date
from math import ceil


def add_months(d: date, months: int) -> date:
    """Ajoute `months` mois à une date (borne le jour à la fin de mois)."""
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


FREQ_MONTHS = {"monthly": 1, "quarterly": 3, "annual": 12}


def build_schedule(principal: float, monthly_rate_pct: float, duration_months: int,
                   frequency: str, start_date: date) -> list[dict]:
    """
    Renvoie la liste des échéances : {number, date, principal, interest, total, balance}.
    """
    principal = float(principal or 0)
    rate = float(monthly_rate_pct or 0)
    duration = int(duration_months or 0)
    if principal <= 0 or duration <= 0:
        return []

    freq_months = duration if frequency == "bullet" else FREQ_MONTHS.get(frequency, 1)
    freq_months = freq_months or 1
    n = max(1, ceil(duration / freq_months))

    rows: list[dict] = []
    balance = principal
    current = start_date
    for i in range(1, n + 1):
        current = add_months(current, freq_months)
        interest = balance * (rate / 100.0) * freq_months
        if frequency == "bullet":
            principal_payment = principal if i == n else 0.0
        else:
            principal_payment = principal / n
            if i == n:                       # solde le résidu sur la dernière échéance
                principal_payment = balance
        total = principal_payment + interest
        balance = max(0.0, balance - principal_payment)
        rows.append({
            "number": i,
            "date": current.isoformat(),
            "principal": round(principal_payment, 2),
            "interest": round(interest, 2),
            "total": round(total, 2),
            "balance": round(balance, 2),
        })
    return rows


def schedule_totals(rows: list[dict], duration_months: int) -> dict:
    total_principal = sum(r["principal"] for r in rows)
    total_interest = sum(r["interest"] for r in rows)
    years = (duration_months or 12) / 12.0
    apr = ((total_interest / total_principal) / years * 100.0) if total_principal and years else 0.0
    return {
        "total_principal": round(total_principal, 2),
        "total_interest": round(total_interest, 2),
        "total_payments": round(total_principal + total_interest, 2),
        "apr": round(apr, 2),
    }

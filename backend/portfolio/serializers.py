"""
Sérialisation → dictionnaires au FORMAT ATTENDU par le frontend (Module Crédits
Agricoles). On expose les libellés français des statuts (badges/filtres du SPA) et
des nombres (float) plutôt que des Decimal en chaîne.
"""
from __future__ import annotations

from decimal import Decimal

from .models import Loan, LoanTransaction


def _f(value) -> float:
    return float(value) if isinstance(value, Decimal) else (float(value) if value is not None else 0.0)


def loan_row(loan: Loan) -> dict:
    """Ligne de la table admin (colonnes ID/Date/Bénéficiaire/…)."""
    return {
        "id": loan.reference,
        "date": loan.date.isoformat() if loan.date else "",
        "operator": loan.operator,
        "type": loan.category,
        "amountRequested": _f(loan.amount_requested),
        "amountApproved": _f(loan.amount_approved),
        "amountDisbursed": _f(loan.disbursed),
        "currency": loan.currency,
        "duration": loan.duration_months,
        "rate": _f(loan.rate),
        "dueDate": loan.due_date.isoformat() if loan.due_date else "",
        "manager": loan.manager,
        "investor": loan.investor,
        "source": loan.source,
        "status": loan.get_status_display(),          # libellé FR (badge + filtre)
        "statusCode": loan.status,
        "score": loan.score,
        "guarantee": loan.guarantee,
        "progress": loan.progress,
        "frequency": loan.frequency,
        "startDate": loan.start_date.isoformat() if loan.start_date else "",
        "outstanding": _f(loan.outstanding),
        "repaid": _f(loan.repaid),
        # Traçabilité vers la demande de crédit.
        "applicationCode": loan.application.code if loan.application_id else "",
        "decision": ((loan.application.score_result or {}).get("eligible", False)
                     and "FAVORABLE" or "") if loan.application_id else "",
        "analysisStatut": loan.application.status if loan.application_id else "",
    }


def transaction_row(t: LoanTransaction) -> dict:
    return {
        "id": t.pk,
        "date": t.date.isoformat() if t.date else "",
        "kind": t.kind,
        "type": t.label or t.get_kind_display(),
        "amount": None if t.amount is None else _f(t.amount),
        "currency": t.currency,
        "originalAmount": None if t.original_amount is None else _f(t.original_amount),
        "originalCurrency": t.original_currency,
        "paymentMethod": t.payment_method,
        "ref": t.reference,
        "status": t.get_status_display(),
        "verifiedBy": t.verified_by,
        "subwalletId": t.subwallet_id,
    }


def transactions_with_balance(loan: Loan) -> list[dict]:
    """Journal + solde restant cumulé (running balance), dans l'ordre chronologique."""
    rows = []
    balance = Decimal("0")
    for t in loan.transactions.all():
        if t.amount is not None:
            balance += t.amount
        row = transaction_row(t)
        row["balance"] = _f(balance)
        rows.append(row)
    return rows


def config_payload(loan: Loan) -> dict:
    """Config courante (taux/maturité/statut) + historique d'audit."""
    return {
        "currentConfig": {
            "rate": _f(loan.rate),
            "duration": loan.duration_months,
            "frequency": loan.frequency,
            "status": loan.get_status_display(),
            "statusCode": loan.status,
            "startDate": loan.start_date.isoformat() if loan.start_date else "",
        },
        "history": [
            {
                "date": h.created_at.isoformat(),
                "action": h.action,
                "user": h.user,
                "details": h.details,
            }
            for h in loan.config_history.all()
        ],
    }


def note_row(n) -> dict:
    return {"id": n.pk, "author": n.author, "text": n.text, "date": n.created_at.isoformat()}


def subwallet_row(sw) -> dict:
    return {
        "id": sw.pk, "moduleKey": sw.module_key, "label": sw.label,
        "allocatedAmount": _f(sw.allocated_amount), "balance": _f(sw.balance),
    }


def guarantee_row(g) -> dict:
    return {
        "id": g.pk, "type": g.type, "label": g.label, "description": g.description,
        "value": _f(g.value) if g.value is not None else None,
    }

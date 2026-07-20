"""
Logique métier du portefeuille de crédits : génération de référence, création d'un
dossier, configuration taux/maturité (avec audit), mouvements financiers, transitions
de statut (actions du menu), et agrégats du tableau de bord (résumé + alertes).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from audit.services import record as audit_record
from common.exceptions import InsufficientFundsError, ValidationFailed

from .models import Loan, LoanConfigHistory, LoanGuarantee, LoanNote, LoanSubWallet, LoanTransaction
from .schedule import add_months, build_schedule, schedule_totals


# --- Utilitaires de conversion tolérants -----------------------------------
def _dec(value, default="0") -> Decimal:
    if value in (None, ""):
        return Decimal(default)
    try:
        return Decimal(str(value).replace(",", ".").replace(" ", ""))
    except (InvalidOperation, ValueError):
        return Decimal(default)


def _int(value, default=0) -> int:
    try:
        return int(float(str(value).replace(",", ".")))
    except (TypeError, ValueError):
        return default


def _date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


# Libellés / codes acceptés → code canonique de statut.
_STATUS_MAP = {
    "en traitement": Loan.Status.EN_TRAITEMENT, "en_traitement": Loan.Status.EN_TRAITEMENT,
    "approuvé": Loan.Status.APPROUVE, "approuve": Loan.Status.APPROUVE, "approuvé": Loan.Status.APPROUVE,
    "en cours": Loan.Status.EN_COURS, "en_cours": Loan.Status.EN_COURS, "active": Loan.Status.EN_COURS,
    "défaut": Loan.Status.DEFAUT, "defaut": Loan.Status.DEFAUT,
    "clôturé": Loan.Status.CLOTURE, "cloture": Loan.Status.CLOTURE, "clôturé": Loan.Status.CLOTURE,
    "rejeté": Loan.Status.REJETE, "rejete": Loan.Status.REJETE, "cancelled": Loan.Status.REJETE,
    "suspendu": Loan.Status.SUSPENDU, "suspended": Loan.Status.SUSPENDU,
    "bloqué": Loan.Status.BLOQUE, "bloque": Loan.Status.BLOQUE, "blocked": Loan.Status.BLOQUE,
}


def status_code(value, default=Loan.Status.EN_TRAITEMENT) -> str:
    if not value:
        return default
    v = str(value).strip().lower()
    for code in Loan.Status.values:
        if v == code.lower():
            return code
    return _STATUS_MAP.get(v, default)


def generate_reference() -> str:
    """Référence lisible CRD-AAAA-NNN, séquentielle par année (saisie manuelle)."""
    year = timezone.localdate().year
    prefix = f"CRD-{year}-"
    n = Loan.objects.filter(reference__startswith=prefix).count() + 1
    while Loan.objects.filter(reference=f"{prefix}{n:03d}").exists():
        n += 1
    return f"{prefix}{n:03d}"


# --- Pont avec le moteur d'analyse (credit) --------------------------------
# La décision d'analyse (§8.3) initialise le statut de gestion.
_APP_STATUS_TO_LOAN = {
    "draft":               Loan.Status.EN_TRAITEMENT,
    "submitted":           Loan.Status.EN_TRAITEMENT,
    "in_analysis":         Loan.Status.EN_TRAITEMENT,
    "adjourned":           Loan.Status.EN_TRAITEMENT,
    "approved":            Loan.Status.APPROUVE,
    "pending_disbursement": Loan.Status.APPROUVE,
    "active":              Loan.Status.EN_COURS,
    "rejected":            Loan.Status.REJETE,
    "closed":              Loan.Status.CLOTURE,
}


@transaction.atomic
def create_from_application(app, *, by: str = ""):
    """
    Crée (ou resynchronise) un dossier de GESTION à partir d'une CreditApplication
    (nouveau module credits). Les montants et le score viennent directement des champs
    du modèle ; les champs de gestion déjà édités (gestionnaire, taux, dates) sont préservés.
    """
    sr = app.score_result or {}
    score = sr.get("score") or 0
    schedule = sr.get("scheduleDraft") or []
    duree = len(schedule) if schedule else 12

    snapshot = dict(
        operator=getattr(app.client, "full_name", None) or "—",
        category=getattr(app.value_chain, "label", None) or "",
        amount_requested=app.amount_requested or Decimal("0"),
        amount_approved=app.amount_approved or Decimal("0"),
        score=int(score or 0),
        guarantee=app.guarantee_type or "",
        source="Credits",
    )

    existing = Loan.objects.filter(application=app).first()
    if existing:
        for key, val in snapshot.items():
            setattr(existing, key, val)
        existing.save()
        return existing

    loan = Loan.objects.create(
        reference=app.code, application=app,
        duration_months=duree or 12,
        status=_APP_STATUS_TO_LOAN.get(app.status, Loan.Status.EN_TRAITEMENT),
        created_by=by, **snapshot,
    )
    return loan


def sync_from_applications(*, by: str = "") -> int:
    """Garantit qu'un dossier de gestion existe pour CHAQUE demande analysée."""
    from credits.models import CreditApplication
    linked = set(Loan.objects.exclude(application__isnull=True).values_list("application_id", flat=True))
    created = 0
    for app in CreditApplication.objects.all():
        if app.id not in linked:
            create_from_application(app, by=by)
            created += 1
    return created


def _recompute_due_date(loan: Loan) -> None:
    if loan.start_date and loan.duration_months:
        loan.due_date = add_months(loan.start_date, int(loan.duration_months))


@transaction.atomic
def create_loan(data: dict, *, by: str = "") -> Loan:
    loan = Loan(
        reference=generate_reference(),
        date=_date(data.get("date")) or timezone.localdate(),
        operator=(data.get("operator") or "").strip(),
        category=(data.get("category") or data.get("type") or "").strip(),
        amount_requested=_dec(data.get("amountRequested") or data.get("amount_requested")),
        amount_approved=_dec(data.get("amountApproved") or data.get("amount_approved")),
        currency=(data.get("currency") or "USD").upper()[:3],
        duration_months=_int(data.get("duration") or data.get("duration_months"), 12),
        rate=_dec(data.get("rate")),
        frequency=(data.get("frequency") or "monthly"),
        start_date=_date(data.get("startDate") or data.get("start_date")),
        manager=(data.get("manager") or "").strip(),
        investor=(data.get("investor") or "").strip(),
        source=(data.get("source") or "App").strip(),
        status=status_code(data.get("status"), Loan.Status.EN_TRAITEMENT),
        score=_int(data.get("score"), 0),
        guarantee=(data.get("guarantee") or "").strip(),
        borrower_sub=(data.get("borrowerSub") or "").strip(),
        created_by=by,
    )
    _recompute_due_date(loan)
    loan.save()
    return loan


# --- Espace client (Credits.jsx) : auto-service, sous-portefeuilles par module ----------
@transaction.atomic
def submit_client_application(data: dict, *, by: str) -> Loan:
    """Le client soumet lui-même sa demande (formulaire multi-étapes : demande initiale +
    simulateur de modules + garanties). Devient un dossier de gestion `Loan` standard
    (visible aussi côté admin), avec `borrower_sub=by` pour le scoper à l'espace client."""
    loan = Loan.objects.create(
        reference=generate_reference(),
        operator=(data.get("demandeur") or "").strip(),
        category=(data.get("culture") or "").strip(),
        amount_requested=_dec(data.get("montant")),
        currency=(data.get("currency") or "USD").upper()[:3],
        status=Loan.Status.EN_TRAITEMENT,
        score=_int(data.get("score"), 0),
        source="App",
        borrower_sub=by,
        created_by=by,
    )
    modules = data.get("modules") or {}
    for key, mod in modules.items():
        if not mod.get("active"):
            continue
        amount = _dec(mod.get("cost")) * _dec(mod.get("financing"), "100") / Decimal("100")
        LoanSubWallet.objects.create(
            loan=loan, module_key=key, label=mod.get("label") or key,
            allocated_amount=amount, balance=amount,
        )
    loan.amount_approved = sum((sw.allocated_amount for sw in loan.subwallets.all()), Decimal("0"))
    loan.save(update_fields=["amount_approved"])

    for g in data.get("guarantees") or []:
        LoanGuarantee.objects.create(
            loan=loan, type=g.get("type", ""), label=g.get("label", ""),
            description=g.get("description", ""), value=_dec(g.get("value")) if g.get("value") else None,
        )
    loan.guarantee = ", ".join(g.get("label", "") for g in data.get("guarantees") or [] if g.get("label"))
    loan.save(update_fields=["guarantee"])

    audit_record(actor=by, action="portfolio.client_application.submit", entity_type="Loan",
                 entity_id=loan.reference, details={"amount": str(loan.amount_approved)})
    return loan


def client_loans(sub: str) -> list:
    return list(Loan.objects.filter(borrower_sub=sub))


def client_loan_detail(loan: Loan) -> dict:
    from . import serializers
    return {
        **serializers.loan_row(loan),
        "subwallets": [serializers.subwallet_row(sw) for sw in loan.subwallets.all()],
        "guarantees": [serializers.guarantee_row(g) for g in loan.guarantee_items.all()],
        "transactions": serializers.transactions_with_balance(loan),
        **schedule_for(loan),
    }


@transaction.atomic
def pay_from_subwallet(loan: Loan, subwallet_id: int, amount, beneficiary: str, description: str, *,
                        by: str) -> LoanTransaction:
    subwallet = loan.subwallets.filter(pk=subwallet_id).first()
    if not subwallet:
        raise ValidationFailed("Sous-portefeuille introuvable.")
    amt = _dec(amount)
    if amt <= 0:
        raise ValidationFailed("Montant invalide.")
    if amt > subwallet.balance:
        raise InsufficientFundsError("Solde du sous-portefeuille insuffisant.")
    subwallet.balance -= amt
    subwallet.save(update_fields=["balance"])
    tx = LoanTransaction.objects.create(
        loan=loan, subwallet=subwallet, kind=LoanTransaction.Kind.DISBURSEMENT,
        label=description or f"Paiement — {subwallet.label}", amount=amt, currency=loan.currency,
        payment_method="Virement interne", reference=beneficiary, verified_by=by,
    )
    if loan.status in (Loan.Status.APPROUVE, Loan.Status.EN_TRAITEMENT):
        loan.status = Loan.Status.EN_COURS
        loan.save(update_fields=["status"])
    audit_record(actor=by, action="portfolio.subwallet.pay", entity_type="LoanTransaction",
                 entity_id=str(tx.pk), details={"subwallet": subwallet.module_key, "amount": str(amt),
                                                 "beneficiary": beneficiary})
    return tx


@transaction.atomic
def rebalance_subwallets(loan: Loan, from_id: int, to_id: int, amount, *, by: str) -> None:
    if from_id == to_id:
        raise ValidationFailed("Les deux sous-portefeuilles doivent être différents.")
    # Verrouillage ordonné par pk (comme `caisses.transfer_funds`) — évite un deadlock si
    # deux réajustements concurrents portent sur la même paire dans l'ordre inverse.
    ids = sorted([from_id, to_id])
    locked = {sw.pk: sw for sw in loan.subwallets.select_for_update().filter(pk__in=ids)}
    from_sw, to_sw = locked.get(from_id), locked.get(to_id)
    if not from_sw or not to_sw:
        raise ValidationFailed("Sous-portefeuille introuvable.")
    amt = _dec(amount)
    if amt <= 0:
        raise ValidationFailed("Montant invalide.")
    if amt > from_sw.balance:
        raise InsufficientFundsError("Solde du sous-portefeuille source insuffisant.")
    from_sw.balance -= amt
    from_sw.allocated_amount -= amt
    to_sw.balance += amt
    to_sw.allocated_amount += amt
    from_sw.save(update_fields=["balance", "allocated_amount"])
    to_sw.save(update_fields=["balance", "allocated_amount"])
    LoanConfigHistory.objects.create(
        loan=loan, action="Réajustement entre modules", user=by or "Client",
        details=f"{from_sw.label} → {to_sw.label} : {amt} {loan.currency}",
    )
    audit_record(actor=by, action="portfolio.subwallet.rebalance", entity_type="Loan", entity_id=loan.reference,
                 details={"from": from_sw.module_key, "to": to_sw.module_key, "amount": str(amt)})


@transaction.atomic
def update_loan(loan: Loan, data: dict) -> Loan:
    """Mise à jour partielle générique d'un dossier."""
    fields = {
        "operator": "operator", "category": "category", "manager": "manager",
        "investor": "investor", "source": "source", "guarantee": "guarantee",
    }
    for key, attr in fields.items():
        if key in data or attr in data:
            setattr(loan, attr, (data.get(key) if key in data else data.get(attr)) or "")
    if "amountApproved" in data or "amount_approved" in data:
        loan.amount_approved = _dec(data.get("amountApproved") or data.get("amount_approved"))
    if "score" in data:
        loan.score = _int(data.get("score"), loan.score)
    if "status" in data:
        loan.status = status_code(data.get("status"), loan.status)
    if "startDate" in data or "start_date" in data:
        loan.start_date = _date(data.get("startDate") or data.get("start_date"))
    if "duration" in data or "duration_months" in data:
        loan.duration_months = _int(data.get("duration") or data.get("duration_months"), loan.duration_months)
    _recompute_due_date(loan)
    loan.save()
    return loan


@transaction.atomic
def apply_config(loan: Loan, data: dict, *, by: str = "", action: str = "Modification") -> dict:
    """
    Applique taux/durée/fréquence/statut/date d'effet + enregistre une entrée d'audit.
    Renvoie l'échéancier recalculé.
    """
    loan.rate = _dec(data.get("rate"), str(loan.rate))
    loan.duration_months = _int(data.get("duration") or data.get("duration_months"), loan.duration_months)
    if data.get("frequency"):
        loan.frequency = data["frequency"]
    if data.get("startDate") or data.get("start_date"):
        loan.start_date = _date(data.get("startDate") or data.get("start_date"))
    if data.get("status"):
        loan.status = status_code(data.get("status"), loan.status)
    _recompute_due_date(loan)
    loan.save()

    details = f"Taux: {loan.rate}%/mois, Durée: {loan.duration_months} mois, Statut: {loan.get_status_display()}"
    LoanConfigHistory.objects.create(loan=loan, action=action, user=by or "Système", details=details)
    return schedule_for(loan)


def schedule_for(loan: Loan) -> dict:
    principal = float(loan.amount_approved or loan.amount_requested or 0)
    start = loan.start_date or loan.date or timezone.localdate()
    rows = build_schedule(principal, float(loan.rate), int(loan.duration_months), loan.frequency, start)
    return {"schedule": rows, "totals": schedule_totals(rows, int(loan.duration_months)),
            "currency": loan.currency}


@transaction.atomic
def add_transaction(loan: Loan, data: dict, *, by: str = "") -> LoanTransaction:
    kind = (data.get("kind") or "").upper()
    if kind not in LoanTransaction.Kind.values:
        kind = LoanTransaction.Kind.OTHER
    tx = LoanTransaction.objects.create(
        loan=loan,
        date=_date(data.get("date")) or timezone.localdate(),
        kind=kind,
        label=(data.get("label") or data.get("type") or "").strip(),
        amount=None if data.get("amount") in (None, "") else _dec(data.get("amount")),
        currency=(data.get("currency") or loan.currency).upper()[:3],
        original_amount=None if data.get("originalAmount") in (None, "") else _dec(data.get("originalAmount")),
        original_currency=(data.get("originalCurrency") or "").upper()[:3],
        payment_method=(data.get("paymentMethod") or "").strip(),
        reference=(data.get("ref") or data.get("reference") or "").strip(),
        status=data.get("statusCode") or _txn_status(data.get("status")),
        verified_by=(data.get("verifiedBy") or by or "").strip(),
    )
    # Un premier décaissement fait passer le dossier « en cours ».
    if kind == LoanTransaction.Kind.DISBURSEMENT and loan.status in (
        Loan.Status.APPROUVE, Loan.Status.EN_TRAITEMENT
    ):
        loan.status = Loan.Status.EN_COURS
        loan.save(update_fields=["status"])
    return tx


def _txn_status(value, default=LoanTransaction.Status.VALIDE) -> str:
    if not value:
        return default
    v = str(value).strip().lower()
    mapping = {"validé": "VALIDE", "valide": "VALIDE", "en attente": "EN_ATTENTE",
               "en_attente": "EN_ATTENTE", "non applicable": "NON_APPLICABLE"}
    for code in LoanTransaction.Status.values:
        if v == code.lower():
            return code
    return mapping.get(v, default)


# --- Actions du menu (réaffecter, prolonger, pause, clôturer, annuler…) -----
@transaction.atomic
def run_action(loan: Loan, action: str, data: dict, *, by: str = "") -> dict:
    action = (action or "").lower()
    label = None

    if action == "reassign":
        loan.manager = (data.get("manager") or "").strip() or loan.manager
        loan.save(update_fields=["manager"])
        label = f"Réaffectation gestionnaire → {loan.manager}"

    elif action == "extend":
        months = _int(data.get("months"), 0)
        if months:
            loan.duration_months += months
        if data.get("dueDate") or data.get("due_date"):
            loan.due_date = _date(data.get("dueDate") or data.get("due_date"))
        else:
            _recompute_due_date(loan)
        loan.save(update_fields=["duration_months", "due_date"])
        label = f"Prolongation échéance (+{months} mois)"

    elif action in ("pause", "suspend"):
        loan.status = Loan.Status.SUSPENDU
        loan.save(update_fields=["status"])
        label = "Mise en pause / suspension"

    elif action == "block":
        loan.status = Loan.Status.BLOQUE
        loan.rate = Decimal("0")
        loan.save(update_fields=["status", "rate"])
        label = "Blocage (taux 0%)"

    elif action == "resume":
        loan.status = Loan.Status.EN_COURS
        loan.save(update_fields=["status"])
        label = "Réactivation"

    elif action == "close":
        loan.status = Loan.Status.CLOTURE
        loan.save(update_fields=["status"])
        label = "Clôture du dossier"

    elif action in ("cancel", "reject"):
        loan.status = Loan.Status.REJETE
        loan.save(update_fields=["status"])
        label = "Annulation / rejet"

    elif action == "default":
        loan.status = Loan.Status.DEFAUT
        loan.save(update_fields=["status"])
        label = "Passage en défaut"

    elif action == "approve":
        loan.status = Loan.Status.APPROUVE
        if data.get("amountApproved") or data.get("amount_approved"):
            loan.amount_approved = _dec(data.get("amountApproved") or data.get("amount_approved"))
        loan.save(update_fields=["status", "amount_approved"])
        label = "Approbation du dossier"

    elif action == "reminder":
        add_transaction(loan, {
            "kind": "REMINDER", "label": "Relance envoyée",
            "paymentMethod": data.get("channel") or "Notification",
            "status": "Non applicable", "amount": None,
        }, by=by)
        label = "Relance / notification"

    elif action == "note":
        text = (data.get("text") or "").strip()
        if text:
            LoanNote.objects.create(loan=loan, author=by or "Admin", text=text)
        label = "Note ajoutée"

    elif action == "disburse":
        add_transaction(loan, {
            "kind": "DISBURSEMENT",
            "label": data.get("label") or "Décaissement",
            "amount": data.get("amount"),
            "currency": data.get("currency") or loan.currency,
            "paymentMethod": data.get("paymentMethod") or "Virement bancaire",
            "ref": data.get("ref"),
            "status": data.get("status") or "Validé",
            "verifiedBy": by,
        }, by=by)
        label = "Décaissement enregistré"

    else:
        return {"ok": False, "detail": f"Action inconnue : {action}"}

    LoanConfigHistory.objects.create(loan=loan, action=label, user=by or "Admin", details=data.get("note") or "")
    return {"ok": True, "detail": label}


# --- Tableau de bord --------------------------------------------------------
def summary() -> list[dict]:
    """Cartes de synthèse (agrégats du portefeuille)."""
    qs = Loan.objects.all()
    total = qs.count()
    approved = qs.filter(status__in=[Loan.Status.APPROUVE, Loan.Status.EN_COURS])
    disbursed_total = sum(float(l.disbursed) for l in qs)
    outstanding_total = sum(float(l.outstanding) for l in qs)
    en_defaut = qs.filter(status=Loan.Status.DEFAUT).count()
    en_traitement = qs.filter(status=Loan.Status.EN_TRAITEMENT).count()
    clotures = qs.filter(status=Loan.Status.CLOTURE).count()

    def money(v):
        return f"${v:,.0f}".replace(",", " ")

    return [
        {"title": "Dossiers", "value": str(total), "icon": "BarChart"},
        {"title": "En traitement", "value": str(en_traitement), "icon": "Calendar"},
        {"title": "Actifs", "value": str(approved.count()), "icon": "CheckSquare"},
        {"title": "Décaissé (cumul)", "value": money(disbursed_total), "icon": "DollarSign"},
        {"title": "Encours", "value": money(outstanding_total), "icon": "Repeat"},
        {"title": "En défaut", "value": str(en_defaut), "icon": "AlertTriangle",
         "trendValue": f"{clotures} clôturés", "trendDirection": "up"},
    ]


def alerts() -> list[dict]:
    """Dossiers nécessitant une attention (échéance dépassée, défaut, à décaisser)."""
    today = timezone.localdate()
    out = []
    for loan in Loan.objects.exclude(status__in=[Loan.Status.CLOTURE, Loan.Status.REJETE]):
        if loan.status == Loan.Status.DEFAUT:
            out.append({"reference": loan.reference, "operator": loan.operator,
                        "level": "danger", "message": "Dossier en défaut."})
        elif loan.due_date and loan.due_date < today:
            out.append({"reference": loan.reference, "operator": loan.operator,
                        "level": "warning",
                        "message": f"Échéance dépassée ({loan.due_date.isoformat()})."})
        elif loan.status == Loan.Status.APPROUVE and loan.disbursed == 0:
            out.append({"reference": loan.reference, "operator": loan.operator,
                        "level": "info", "message": "Approuvé, en attente de décaissement."})
    return out


def calendar_entries():
    """Prochaines échéances (agrégées sur les dossiers actifs)."""
    out = []
    for loan in Loan.objects.filter(status__in=[Loan.Status.EN_COURS, Loan.Status.APPROUVE]):
        data = schedule_for(loan)
        for row in data["schedule"]:
            out.append({
                "reference": loan.reference, "operator": loan.operator,
                "currency": loan.currency, **row,
            })
    out.sort(key=lambda r: r["date"])
    return out

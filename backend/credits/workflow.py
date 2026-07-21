"""
Machine à états et circuit d'approbation — Crédits Agricoles (Étape 5).

Transitions autorisées :
  DRAFT           → SUBMITTED       (submit)
  SUBMITTED       → IN_ANALYSIS     (start_analysis)
  IN_ANALYSIS     → APPROVED        (approve)   maker ≠ checker, délégation
  IN_ANALYSIS     → REJECTED        (reject)    message structuré + score
  IN_ANALYSIS     → ADJOURNED       (adjourn)
  ADJOURNED       → IN_ANALYSIS     (reopen_analysis)
  SUBMITTED       → (client consent enregistré)

Règles cross-cutting :
  - maker ≠ checker : submitted_by_sub ≠ reviewed_by_sub
  - on_behalf_of : consentement client requis dans CREDIT_CONSENT_WINDOW_HOURS
  - délégation : montant approuvé ≤ limite du rôle de l'approbateur
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


# ── Journalisation du workflow (tâche D, priorité métier n°1) ──────────────────

def _audit_transition(app, *, actor: str, action: str, etape: str, **details) -> None:
    """Trace append-only d'une transition de la machine à états (principe 3).

    Réutilise le journal d'audit unique (`audit.services.record`, le mécanisme de
    `guarantees._audit`). Volontairement NON best-effort : une décision de crédit
    non journalisée ne se reconstitue pas — un auditeur doit pouvoir rejouer
    chaque transition (acteur, dossier, étape, motif, horodatage). L'appel vit
    dans la transaction atomique de la transition : si l'audit échoue, la
    transition est annulée avec lui.

    `entity_id = app.code` : la référence humaine du dossier, filtrable directement
    par l'écran auditeur (`GET /api/audit/entries?entity_type=CreditApplication&
    entity_id=CRED-…`).
    """
    from audit.services import record

    payload = {"applicationCode": app.code, "etape": etape, "statut": app.status}
    payload.update({k: v for k, v in details.items() if v not in (None, "")})
    record(
        actor=actor or "",
        action=action,
        entity_type="CreditApplication",
        entity_id=app.code,
        details=payload,
    )


# ── Exceptions ────────────────────────────────────────────────────────────────

class WorkflowError(Exception):
    """Transition invalide ou règle métier violée.

    Chaque sous-classe porte son `code` : c'est lui que le front consomme, jamais
    la formulation du message. `errors` détaille les causes quand il y en a
    plusieurs — un « dossier incomplet » qui agrège quatre manques en une phrase
    n'est pas exploitable par une interface (principe 5).
    """

    code = "WORKFLOW_ERROR"
    #: Statut HTTP porte par la regle elle-meme. 422 par defaut : « la requete
    #: est comprise mais une regle metier la refuse ». Les conflits d'etat de
    #: ressource (409) et les refus d'autorisation (403) le surchargent.
    http_status = 422

    def __init__(self, message: str, errors: list[dict] | None = None) -> None:
        super().__init__(message)
        #: `[{code, message}]` — vide quand la cause est unique (voir `as_errors`).
        self.errors = errors or []

    def as_errors(self) -> list[dict]:
        """Représentation structurée, toujours non vide — prête pour la réponse API."""
        return self.errors or [{"code": self.code, "message": str(self)}]


class InvalidTransition(WorkflowError):
    """Le statut courant n'autorise pas cette transition."""

    code = "INVALID_TRANSITION"
    http_status = 409   # conflit avec l'etat courant de la ressource


class ApplicationIncomplete(WorkflowError):
    """Champs obligatoires manquants ou garanties devenues inéligibles."""

    code = "APPLICATION_INCOMPLETE"


class DelegationError(WorkflowError):
    """Montant hors délégation pour ce rôle."""

    code = "DELEGATION_EXCEEDED"
    http_status = 403   # refus d'autorisation, pas de validation


class MakerCheckerError(WorkflowError):
    """Soumetteur et approbateur sont la même personne."""

    code = "MAKER_CHECKER_VIOLATION"
    http_status = 409   # conflit : la ressource a deja ete touchee par cet acteur


class ConsentError(WorkflowError):
    """Consentement client manquant pour une demande on_behalf_of."""

    code = "CLIENT_CONSENT_MISSING"
    http_status = 409   # conflit : le consentement manque a l'etat courant


class ConsentExpired(ConsentError):
    """La fenêtre de consentement (72 h) est dépassée.

    Distincte de `ConsentError` parce que l'action attendue diffère : un
    consentement manquant se recueille, un consentement expiré se renouvelle —
    et son expiration signale que quelque chose a traîné dans l'instruction.
    Cette distinction n'était portée que par le statut HTTP (409 vs 410) : elle
    est devenue invisible pour un front découplé des statuts, d'où le code propre.
    """

    code = "CLIENT_CONSENT_EXPIRED"
    http_status = 410   # la fenêtre de consentement n'existe plus, elle a expiré


# ── Helpers ───────────────────────────────────────────────────────────────────

def _assert_status(app, *allowed: str) -> None:
    if app.status not in allowed:
        raise InvalidTransition(
            f"Transition impossible depuis le statut «{app.status}». "
            f"Statuts attendus : {', '.join(allowed)}."
        )


def _max_delegation_usd(roles: list[str]) -> float | None:
    """
    Retourne la limite de délégation maximale parmi les rôles de l'approbateur.
    None = illimité. Lève NoDelegationAuthority si aucun rôle ne figure dans la
    table de délégation.

    L'implémentation vit dans `credits.roles` — unique source de vérité de la
    nomenclature. L'ancienne version initialisait `best` à 0 et retournait donc
    silencieusement 0 pour une liste de rôles vide, ce qui faisait échouer toute
    approbation d'un montant > 0 en `delegation_exceeded`.
    """
    from credits.roles import delegation_limit
    return delegation_limit(roles)


def _to_usd(amount: Decimal, currency: str) -> float:
    """Convertit un montant en USD pour la comparaison au plafond de délégation.

    Dette connue : le taux CDF→USD est un défaut de secours paramétrable, pas un
    taux du jour journalisé comme l'exige le principe 4. À remplacer par le
    convertisseur du module Accounting quand il sera exposé ; l'usage du défaut
    est loggué pour qu'il ne passe jamais inaperçu.
    """
    if currency == "USD":
        return float(amount)

    rate = getattr(settings, "CREDIT_FALLBACK_CDF_PER_USD", 2800)
    logger.warning(
        "Conversion %s→USD au taux de secours %s (non journalisé, non daté) "
        "pour un contrôle de délégation.", currency, rate,
    )
    return float(amount / Decimal(str(rate)))


def _consent_window_hours() -> int:
    return getattr(settings, "CREDIT_CONSENT_WINDOW_HOURS", 72)


def _structured_rejection_message(app) -> str:
    """Construit le message de rejet lisible par le client."""
    score_result = app.score_result or {}
    score = score_result.get("score", "N/R")
    min_req = score_result.get("minScoreRequired", "N/R")
    reason_map = {
        "score_insuffisant": "Score de crédit insuffisant",
        "garantie": "Garantie insuffisante ou non confirmée",
        "endettement": "Taux d'endettement trop élevé",
        "incoherences": "Incohérences dans le dossier (besoins vs référentiel)",
        "autre": "Motif divers — voir commentaire de l'analyste",
    }
    reason_label = reason_map.get(app.rejection_reason_code, app.rejection_reason_code)

    lines = [
        f"Dossier {app.code} — REJETÉ",
        f"Motif : {reason_label}.",
    ]

    if app.rejection_reason_code == "score_insuffisant" and score != "N/R":
        lines.append(f"Score obtenu : {score}/100 (minimum requis : {min_req}).")
        breakdown = score_result.get("breakdown", [])
        if breakdown:
            lines.append("Détail des critères :")
            for b in breakdown:
                lines.append(
                    f"  • {b['label']} : {b['points']}/{b['maxPoints']} pts"
                )

    if app.rejection_comment:
        lines.append(f"Commentaire analyste : {app.rejection_comment}")

    lines.append(
        "Vous pouvez déposer un nouveau dossier après avoir amélioré votre situation "
        "ou contactez votre conseiller pour plus d'informations."
    )
    return "\n".join(lines)


def _ineligible_guarantee_errors(app) -> list[dict]:
    """Types de garantie du dossier devenus inadmis pour sa filière.

    Conserve le `code` et le message de `GuaranteeTypeNotEligible` — celui-ci
    énumère les types admis, information que le front ne peut pas reconstituer
    (il ne connaît pas `ValueChain.eligible_guarantees`, et ne doit pas le
    connaître : principe 7).
    """
    from credits.guarantees import GuaranteeTypeNotEligible, assert_type_eligible
    from credits.models import CreditGuarantee

    errors: list[dict] = []
    vivantes = app.guarantees.filter(
        status__in=[CreditGuarantee.Status.PENDING, CreditGuarantee.Status.ACTIVE],
    )
    for guarantee in vivantes:
        try:
            assert_type_eligible(app, guarantee.guarantee_type)
        except GuaranteeTypeNotEligible as exc:
            errors.append({"code": exc.code, "message": str(exc)})
    return errors


def _missing_guarantor_consent_errors(app) -> list[dict]:
    """Cautions morales du dossier que leur garant n'a pas (encore) consenties.

    C'est le verrou qui rend la caution opposable : un dossier ne franchit pas
    l'étape de soumission tant qu'une personne y est engagée sans avoir dit oui.
    Sans lui, tout le mécanisme de consentement resterait décoratif — on
    pourrait l'ignorer et instruire quand même.

    Le code remonte dans `errors[]` plutôt qu'en racine : la soumission agrège
    toutes les causes de l'étape (principe 5), et `APPLICATION_INCOMPLETE` reste
    le code de la transition. Contrat publié dans `docs/status-fragments/`.
    """
    from credits.guarantor import GuarantorConsentMissing
    from credits.models import CreditGuarantee

    en_attente = app.guarantees.filter(
        guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
        status__in=[
            CreditGuarantee.Status.PENDING,
            CreditGuarantee.Status.PENDING_CONSENT,
            CreditGuarantee.Status.DECLINED,
            CreditGuarantee.Status.EXPIRED,
        ],
    )

    messages = {
        CreditGuarantee.Status.DECLINED:
            "Le garant {nom} a refusé la caution : le dossier ne peut pas être "
            "soumis avec cette garantie.",
        CreditGuarantee.Status.EXPIRED:
            "Le délai de réponse du garant {nom} a expiré : désignez à nouveau "
            "un garant avant de soumettre.",
    }
    defaut = (
        "Le garant {nom} n'a pas encore consenti à sa caution. Une caution "
        "solidaire n'engage personne tant que la personne n'a pas accepté."
    )

    errors: list[dict] = []
    for g in en_attente:
        nom = g.guarantor_name or (
            g.guarantor.full_name if g.guarantor_id else "désigné"
        )
        errors.append({
            "code": GuarantorConsentMissing.code,
            "message": messages.get(g.status, defaut).format(nom=nom),
        })
    return errors


# ── Transitions ───────────────────────────────────────────────────────────────

@transaction.atomic
def submit(app, submitter_sub: str) -> None:
    """
    DRAFT → SUBMITTED.
    Valide les champs obligatoires, déclenche la fenêtre de consentement
    si la demande est faite par un agent (on_behalf_of).
    """
    _assert_status(app, "draft")

    errors: list[dict] = []
    if not app.client_id:
        errors.append({"code": "CLIENT_MANQUANT",
                       "message": "Client non renseigné."})
    if not app.value_chain_id:
        errors.append({"code": "FILIERE_MANQUANTE",
                       "message": "Filière (chaîne de valeur) non renseignée."})
    if not app.area_ha or app.area_ha <= 0:
        errors.append({"code": "SUPERFICIE_MANQUANTE",
                       "message": "Superficie (area_ha) manquante ou nulle."})
    if not app.amount_requested or app.amount_requested <= 0:
        errors.append({"code": "MONTANT_MANQUANT",
                       "message": "Montant demandé manquant ou nul."})

    # Défense en profondeur : un dossier resté longtemps en brouillon peut
    # porter un type de garantie devenu inéligible depuis une mise à jour du
    # référentiel filière. Le contrôle existe déjà à la pose ; on le refait ici
    # plutôt que de laisser passer une garantie non opposable.
    errors.extend(_ineligible_guarantee_errors(app))

    # Principe 9 : une caution que son garant n'a pas acceptée n'est pas une
    # garantie. Elle ne franchit pas la soumission.
    errors.extend(_missing_guarantor_consent_errors(app))

    if errors:
        # Le message agrégé reste pour les appelants qui n'affichent que `detail` ;
        # `errors` porte le détail exploitable, une entrée par cause.
        raise ApplicationIncomplete(
            "Dossier incomplet : " + " | ".join(e["message"] for e in errors),
            errors=errors,
        )

    app.status = "submitted"
    app.submitted_at = timezone.now()
    app.submitted_by_sub = submitter_sub

    # Si demande par un agent pour le compte d'un client : fenêtre de consentement
    if app.is_on_behalf_of:
        window = _consent_window_hours()
        app.client_consent_expires = timezone.now() + timezone.timedelta(hours=window)

    app.save(update_fields=[
        "status", "submitted_at", "submitted_by_sub",
        "client_consent_expires", "updated_at",
    ])

    _audit_transition(
        app, actor=submitter_sub, action="credits.workflow.submit",
        etape="soumission", onBehalfOf=app.is_on_behalf_of,
        clientConsentExpires=(app.client_consent_expires.isoformat()
                              if app.client_consent_expires else None),
    )

    # Notifier le client si on_behalf_of
    if app.is_on_behalf_of:
        _notify_client_consent_needed(app)


@transaction.atomic
def start_analysis(app, analyst_sub: str) -> None:
    """SUBMITTED → IN_ANALYSIS."""
    _assert_status(app, "submitted")

    # Vérifier consentement si on_behalf_of
    if app.is_on_behalf_of and not app.client_consent_at:
        if app.client_consent_expires and app.client_consent_expires < timezone.now():
            raise ConsentExpired(
                "Le consentement client a expiré. "
                "Le client doit être recontacté pour reformuler la demande."
            )
        raise ConsentError(
            f"En attente du consentement client (délai : {_consent_window_hours()}h). "
            "L'analyse ne peut débuter qu'après confirmation."
        )

    app.status = "in_analysis"
    app.reviewed_by_sub = analyst_sub
    app.reviewed_at = timezone.now()
    app.save(update_fields=["status", "reviewed_by_sub", "reviewed_at", "updated_at"])

    _audit_transition(
        app, actor=analyst_sub, action="credits.workflow.start_analysis",
        etape="prise_en_charge",
    )


@transaction.atomic
def approve(
    app,
    approver_sub: str,
    amount_approved: Decimal,
    comment: str = "",
    approver_roles: list[str] | None = None,
) -> None:
    """
    IN_ANALYSIS → APPROVED.

    Vérifie :
      - maker ≠ checker (submitted_by_sub ≠ approver_sub)
      - délégation : amount_approved ≤ max pour les rôles de l'approbateur
    """
    _assert_status(app, "in_analysis")

    # Maker ≠ checker
    if app.submitted_by_sub and app.submitted_by_sub == approver_sub:
        raise MakerCheckerError(
            "La même personne ne peut pas soumettre et approuver un dossier "
            "(principe maker ≠ checker)."
        )

    # Délégation — un rôle sans autorité et un plafond dépassé sont deux cas
    # distincts : le premier ne s'escalade pas, il se refuse.
    from credits.roles import NoDelegationAuthority

    roles = approver_roles or []
    try:
        max_usd = _max_delegation_usd(roles)
    except NoDelegationAuthority as exc:
        raise DelegationError(str(exc)) from exc

    if max_usd is not None:
        amount_usd = _to_usd(amount_approved, app.currency)
        if amount_usd > max_usd:
            raise DelegationError(
                f"Montant approuvé ({amount_usd:,.0f} USD) dépasse votre limite de délégation "
                f"({max_usd:,.0f} USD). Escaladez vers un niveau supérieur."
            )

    app.status = "approved"
    app.amount_approved = amount_approved
    app.reviewed_by_sub = approver_sub
    app.reviewed_at = timezone.now()
    app.approval_comment = comment
    app.rejection_reason_code = ""
    app.rejection_comment = ""
    app.save(update_fields=[
        "status", "amount_approved", "reviewed_by_sub", "reviewed_at",
        "approval_comment", "rejection_reason_code", "rejection_comment", "updated_at",
    ])

    _audit_transition(
        app, actor=approver_sub, action="credits.workflow.approve",
        etape="approbation", montantApprouve=str(amount_approved),
        devise=app.currency, motif=comment,
    )

    _notify_client_decision(app, approved=True)


@transaction.atomic
def reject(
    app,
    rejector_sub: str,
    reason_code: str,
    comment: str = "",
    rejector_roles: list[str] | None = None,
) -> dict[str, Any]:
    """
    IN_ANALYSIS → REJECTED.
    Retourne le message de rejet structuré (à envoyer au client).
    """
    _assert_status(app, "in_analysis")

    valid_reasons = [c[0] for c in app.RejectionReason.choices]
    if reason_code not in valid_reasons:
        raise WorkflowError(
            f"Code de motif invalide : '{reason_code}'. "
            f"Valeurs acceptées : {', '.join(valid_reasons)}."
        )

    # Maker ≠ checker sur le rejet aussi
    if app.submitted_by_sub and app.submitted_by_sub == rejector_sub:
        raise MakerCheckerError(
            "La même personne ne peut pas soumettre et rejeter un dossier."
        )

    app.status = "rejected"
    app.rejection_reason_code = reason_code
    app.rejection_comment = comment
    app.reviewed_by_sub = rejector_sub
    app.reviewed_at = timezone.now()
    app.save(update_fields=[
        "status", "rejection_reason_code", "rejection_comment",
        "reviewed_by_sub", "reviewed_at", "updated_at",
    ])

    _audit_transition(
        app, actor=rejector_sub, action="credits.workflow.reject",
        etape="rejet", reasonCode=reason_code, motif=comment,
    )

    message = _structured_rejection_message(app)
    _notify_client_decision(app, approved=False, rejection_message=message)

    # Libérer les garanties épargne actives
    _release_savings_holds_on_rejection(app)

    return {
        "code": app.code,
        "status": app.status,
        "rejectionReasonCode": reason_code,
        "rejectionMessage": message,
        "score": (app.score_result or {}).get("score"),
    }


@transaction.atomic
def adjourn(app, approver_sub: str, comment: str = "") -> None:
    """IN_ANALYSIS → ADJOURNED (dossier ajourné, nouveau dépôt requis)."""
    _assert_status(app, "in_analysis")

    if not comment.strip():
        raise WorkflowError("Un commentaire est obligatoire pour ajourner un dossier.")

    app.status = "adjourned"
    app.reviewed_by_sub = approver_sub
    app.reviewed_at = timezone.now()
    app.approval_comment = comment
    app.save(update_fields=[
        "status", "reviewed_by_sub", "reviewed_at", "approval_comment", "updated_at",
    ])

    _audit_transition(
        app, actor=approver_sub, action="credits.workflow.adjourn",
        etape="ajournement", motif=comment,
    )


@transaction.atomic
def reopen_analysis(app, analyst_sub: str) -> None:
    """ADJOURNED → IN_ANALYSIS (après corrections du client)."""
    _assert_status(app, "adjourned")

    app.status = "in_analysis"
    app.reviewed_by_sub = analyst_sub
    app.reviewed_at = timezone.now()
    app.save(update_fields=["status", "reviewed_by_sub", "reviewed_at", "updated_at"])

    _audit_transition(
        app, actor=analyst_sub, action="credits.workflow.reopen_analysis",
        etape="reouverture",
    )


@transaction.atomic
def record_client_consent(
    app, client_sub: str, method: str = "app"
) -> None:
    """
    Enregistre le consentement du client pour une demande on_behalf_of.
    Peut être appelé depuis l'app mobile (method='app'), SMS (method='sms') ou USSD.
    """
    _assert_status(app, "submitted")

    if not app.is_on_behalf_of:
        raise WorkflowError("Ce dossier n'est pas une demande au nom d'un tiers.")

    if str(app.client.sub) != client_sub:
        raise WorkflowError("Seul le client bénéficiaire peut confirmer son consentement.")

    if app.client_consent_expires and app.client_consent_expires < timezone.now():
        raise ConsentExpired(
            f"Le délai de consentement a expiré le "
            f"{app.client_consent_expires.strftime('%d/%m/%Y à %H:%M')}. "
            "Un nouveau dossier doit être soumis."
        )

    app.client_consent_at = timezone.now()
    app.client_consent_method = method
    app.save(update_fields=["client_consent_at", "client_consent_method", "updated_at"])

    _audit_transition(
        app, actor=client_sub, action="credits.workflow.client_consent",
        etape="consentement_client", methode=method,
    )


# ── Sérialiseur de dossier ─────────────────────────────────────────────────────

def serialize_application(app) -> dict[str, Any]:
    """Sérialise un CreditApplication pour l'API."""
    from credits.guarantees import get_guarantee_summary

    client = app.client
    vc = app.value_chain
    ns = app.needs_sheet

    return {
        "code": app.code,
        "status": app.status,
        "currency": app.currency,
        "areaHa": float(app.area_ha) if app.area_ha else None,
        "amountRequested": float(app.amount_requested) if app.amount_requested else None,
        "amountApproved": float(app.amount_approved) if app.amount_approved else None,
        "client": {
            "sub": client.sub,
            "displayName": client.full_name,
            "phone": client.phone,
        },
        "valueChain": {"code": vc.code, "label": vc.label} if vc else None,
        "isOnBehalfOf": app.is_on_behalf_of,
        "initiatedBySub": app.initiated_by_sub,
        "submittedBySub": app.submitted_by_sub,
        "submittedAt": app.submitted_at.isoformat() if app.submitted_at else None,
        "pendingClientConsent": app.pending_client_consent,
        "clientConsentAt": app.client_consent_at.isoformat() if app.client_consent_at else None,
        "clientConsentExpires": app.client_consent_expires.isoformat() if app.client_consent_expires else None,
        "needsSheet": {
            "id": ns.pk,
            "parsedOk": ns.parsed_ok,
            "grandTotal": float(ns.grand_total),
            "currency": ns.currency,
            "warnings": ns.warnings,
            "anomalies": ns.anomalies,
        } if ns else None,
        "scoreResult": app.score_result or None,
        "guaranteeType": app.guarantee_type or None,
        "guarantees": get_guarantee_summary(app),
        "reviewedBySub": app.reviewed_by_sub or None,
        "reviewedAt": app.reviewed_at.isoformat() if app.reviewed_at else None,
        "approvalComment": app.approval_comment or None,
        "rejectionReasonCode": app.rejection_reason_code or None,
        "rejectionComment": app.rejection_comment or None,
        "createdAt": app.created_at.isoformat(),
        "updatedAt": app.updated_at.isoformat(),
        "disbursement": _disbursement_summary(app),
        "moduleAllocations": [
            {
                "module": a.module,
                "cost": float(a.cost),
                "financingPct": float(a.financing_pct),
                "amountFinanced": float(a.amount_financed),
                "source": a.source,
            }
            for a in app.module_allocations.all()
        ],
    }


def _disbursement_summary(app) -> dict | None:
    try:
        from credits.disbursement import serialize_disbursement
        return serialize_disbursement(app)
    except Exception:
        return None


# ── Notifications (best-effort) ───────────────────────────────────────────────

def _notify_client_consent_needed(app) -> None:
    try:
        from common.sms import send_sms
        expires = app.client_consent_expires.strftime("%d/%m/%Y à %H:%M")
        send_sms(
            phone=app.client.phone,
            message=f"AGRICAP : Un agent a déposé une demande de crédit {app.code} en votre nom. "
            f"Confirmez votre accord avant le {expires} via l'application ou votre agence.",
        )
    except Exception:
        # Journalisé, PAS avalé. Un `pass` muet a caché pendant tout ce temps un
        # `send_sms()` appelé en positionnel alors qu'il exige des mots-clés :
        # chaque notification client levait un TypeError, personne ne recevait
        # rien, et rien ne le signalait. Un canal secondaire ne doit pas faire
        # échouer l'opération métier — mais son échec doit LAISSER UNE TRACE.
        logger.warning("[NOTIF] envoi impossible pour %s", getattr(app, "code", "?"), exc_info=True)


def _notify_client_decision(app, approved: bool, rejection_message: str = "") -> None:
    try:
        from common.sms import send_sms
        if approved:
            msg = (
                f"AGRICAP : Votre dossier {app.code} a été APPROUVÉ. "
                f"Montant approuvé : {app.amount_approved} {app.currency}. "
                "Votre conseiller vous contactera pour le décaissement."
            )
        else:
            # SMS court — le message complet est dans l'app
            reason_map = {
                "score_insuffisant": "score insuffisant",
                "garantie": "garantie insuffisante",
                "endettement": "endettement trop élevé",
                "incoherences": "incohérences dossier",
                "autre": "voir détail en agence",
            }
            reason = reason_map.get(app.rejection_reason_code, "motif divers")
            msg = (
                f"AGRICAP : Votre dossier {app.code} n'a pas pu être approuvé "
                f"({reason}). Contactez votre conseiller pour plus d'informations."
            )
        send_sms(phone=app.client.phone, message=msg)
    except Exception:
        # Journalisé, PAS avalé. Un `pass` muet a caché pendant tout ce temps un
        # `send_sms()` appelé en positionnel alors qu'il exige des mots-clés :
        # chaque notification client levait un TypeError, personne ne recevait
        # rien, et rien ne le signalait. Un canal secondaire ne doit pas faire
        # échouer l'opération métier — mais son échec doit LAISSER UNE TRACE.
        logger.warning("[NOTIF] envoi impossible pour %s", getattr(app, "code", "?"), exc_info=True)


def _release_savings_holds_on_rejection(app) -> None:
    try:
        from credits.models import CreditGuarantee
        from credits.guarantees import release_savings_hold
        holds = CreditGuarantee.objects.filter(
            application=app,
            guarantee_type=CreditGuarantee.GuaranteeType.EPARGNE,
            status__in=[CreditGuarantee.Status.ACTIVE, CreditGuarantee.Status.PENDING],
        )
        for hold in holds:
            release_savings_hold(hold)
    except Exception:
        # Journalisé, PAS avalé. Un `pass` muet a caché pendant tout ce temps un
        # `send_sms()` appelé en positionnel alors qu'il exige des mots-clés :
        # chaque notification client levait un TypeError, personne ne recevait
        # rien, et rien ne le signalait. Un canal secondaire ne doit pas faire
        # échouer l'opération métier — mais son échec doit LAISSER UNE TRACE.
        logger.warning("[NOTIF] envoi impossible pour %s", getattr(app, "code", "?"), exc_info=True)

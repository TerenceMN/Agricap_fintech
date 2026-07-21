"""
Journalisation du workflow — une trace d'audit append-only PAR transition.

Tâche métier n°1 : « toute transition sans trace est un trou ». Ces tests
épinglent qu'aucune transition de la machine à états — soumission, prise en
charge, approbation, rejet, ajournement, réouverture, consentement client, ET les
trois étapes de décaissement — ne s'exécute sans écrire exactement une entrée dans
le journal d'audit unique (`audit.AuditEntry`), rattachée au code du dossier.

Si quelqu'un ajoute une transition sans `_audit_transition`, un de ces tests
tombe : c'est le filet qui rend la journalisation non négociable.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from accounts.models import FintechUser
from audit.models import AuditEntry
from credits.models import CreditApplication, DisbursementRequest


def _user(sub: str) -> FintechUser:
    user, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": sub, "phone": f"+243{sub[-9:].zfill(9)}"},
    )
    return user


def _chain(code: str = "01"):
    from reference_data.models import ReferenceFileUpload, ValueChain
    upload = ReferenceFileUpload.objects.first() or ReferenceFileUpload.objects.create(
        file_type=ReferenceFileUpload.FileType.VALUE_CHAINS,
        uploaded_by="sub-test", status=ReferenceFileUpload.Status.ACTIVE,
    )
    chain, _ = ValueChain.objects.get_or_create(
        code=code,
        defaults={
            "label": "Céréales — Maïs", "source_file": upload, "cycle_months": 8,
            "cost_per_hectare_usd": Decimal("9111"), "cost_per_hectare_cdf": Decimal("0"),
            "module_weights": {}, "risk_factor": Decimal("0.3"),
            "min_score_required": 50, "base_rate": Decimal("18.00"),
            "harvest_months": [6], "eligible_guarantees": ["epargne", "morale"],
        },
    )
    return chain


_SEQ = {"n": 0}


def _app(**overrides) -> CreditApplication:
    _SEQ["n"] += 1
    client = _user(overrides.pop("client_sub", "sub-client"))
    defaults = dict(
        client=client, status="draft", currency="USD",
        amount_requested=Decimal("5000"),
        code=f"CRED-J-{_SEQ['n']:04d}",
    )
    defaults.update(overrides)
    return CreditApplication.objects.create(**defaults)


def _entries(app, action: str):
    return AuditEntry.objects.filter(
        entity_type="CreditApplication", entity_id=app.code, action=action,
    )


class WorkflowJournalTest(TestCase):
    """Chaque transition écrit une entrée d'audit rattachée au code du dossier."""

    def test_submit_est_journalise(self):
        from credits.workflow import submit
        chain = _chain()
        app = _app(status="draft", value_chain=chain, area_ha=Decimal("2.0"))
        submit(app, submitter_sub="sub-agent")
        e = _entries(app, "credits.workflow.submit")
        self.assertEqual(e.count(), 1)
        self.assertEqual(e.first().actor, "sub-agent")
        self.assertEqual(e.first().details.get("etape"), "soumission")

    def test_start_analysis_est_journalise(self):
        from credits.workflow import start_analysis
        app = _app(status="submitted", submitted_by_sub="sub-agent")
        start_analysis(app, analyst_sub="sub-analyst")
        self.assertEqual(_entries(app, "credits.workflow.start_analysis").count(), 1)

    def test_approve_est_journalise(self):
        from credits.workflow import approve
        app = _app(status="in_analysis", submitted_by_sub="sub-agent",
                   amount_requested=Decimal("5000"))
        approve(app, approver_sub="sub-dg", amount_approved=Decimal("5000"),
                comment="OK", approver_roles=["dg"])
        e = _entries(app, "credits.workflow.approve")
        self.assertEqual(e.count(), 1)
        self.assertEqual(e.first().details.get("montantApprouve"), "5000")

    def test_reject_est_journalise(self):
        from credits.workflow import reject
        app = _app(status="in_analysis", submitted_by_sub="sub-agent")
        reject(app, rejector_sub="sub-dg", reason_code="autre", comment="Non")
        e = _entries(app, "credits.workflow.reject")
        self.assertEqual(e.count(), 1)
        self.assertEqual(e.first().details.get("reasonCode"), "autre")

    def test_adjourn_est_journalise(self):
        from credits.workflow import adjourn
        app = _app(status="in_analysis", submitted_by_sub="sub-agent")
        adjourn(app, approver_sub="sub-analyst", comment="Compléments requis")
        self.assertEqual(_entries(app, "credits.workflow.adjourn").count(), 1)

    def test_reopen_analysis_est_journalise(self):
        from credits.workflow import reopen_analysis
        app = _app(status="adjourned", submitted_by_sub="sub-agent")
        reopen_analysis(app, analyst_sub="sub-analyst")
        self.assertEqual(_entries(app, "credits.workflow.reopen_analysis").count(), 1)

    def test_client_consent_est_journalise(self):
        from credits.workflow import record_client_consent
        client = _user("sub-benef")
        app = _app(client_sub="sub-benef", status="submitted",
                   initiated_by_sub="sub-agent", submitted_by_sub="sub-agent",
                   client_consent_expires=timezone.now() + timezone.timedelta(hours=72))
        record_client_consent(app, client_sub=str(client.sub), method="app")
        self.assertEqual(_entries(app, "credits.workflow.client_consent").count(), 1)

    def test_disbursement_request_est_journalise(self):
        from credits.disbursement import request_disbursement
        app = _app(status="approved", submitted_by_sub="sub-agent",
                   amount_approved=Decimal("5000"))
        request_disbursement(app, requester_sub="sub-agent", notes="demande")
        self.assertEqual(_entries(app, "credits.disbursement.request").count(), 1)

    def test_disbursement_confirm_est_journalise(self):
        from credits.disbursement import request_disbursement, confirm_disbursement
        app = _app(status="approved", submitted_by_sub="sub-agent",
                   value_chain=_chain(), amount_approved=Decimal("5000"))
        request_disbursement(app, requester_sub="sub-agent")
        confirm_disbursement(app, confirmer_sub="sub-cashier")
        e = _entries(app, "credits.disbursement.confirm")
        self.assertEqual(e.count(), 1)
        # maker ≠ checker : l'entrée trace les DEUX acteurs.
        self.assertEqual(e.first().details.get("demandePar"), "sub-agent")
        self.assertEqual(e.first().details.get("confirmePar"), "sub-cashier")

    def test_disbursement_cancel_est_journalise(self):
        from credits.disbursement import (
            request_disbursement, cancel_disbursement_request,
        )
        app = _app(status="approved", submitted_by_sub="sub-agent",
                   amount_approved=Decimal("5000"))
        request_disbursement(app, requester_sub="sub-agent")
        cancel_disbursement_request(app, cancelled_by_sub="sub-agent")
        self.assertEqual(_entries(app, "credits.disbursement.cancel").count(), 1)

    def test_aucune_transition_ne_partage_une_entree(self):
        """Un parcours complet écrit une entrée DISTINCTE par étape (pas d'écrasement)."""
        from credits.workflow import submit, start_analysis, approve
        chain = _chain()
        app = _app(status="draft", value_chain=chain, area_ha=Decimal("2.0"))
        submit(app, submitter_sub="sub-agent")
        start_analysis(app, analyst_sub="sub-analyst")
        approve(app, approver_sub="sub-dg", amount_approved=Decimal("5000"),
                comment="OK", approver_roles=["dg"])
        actions = set(
            AuditEntry.objects
            .filter(entity_type="CreditApplication", entity_id=app.code)
            .values_list("action", flat=True)
        )
        self.assertEqual(actions, {
            "credits.workflow.submit",
            "credits.workflow.start_analysis",
            "credits.workflow.approve",
        })

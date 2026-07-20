from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from common.exceptions import ConflictError, StepUpRequiredError, ValidationFailed
from common.testing import AuthedAPITestCase

from . import compliance, evolution, maker_checker, services
from .models import (
    Agency,
    AgencyActionRequest,
    AgencyComplianceSnapshot,
    AgencyReactivation,
    AgencyReconciliation,
    EvolutionPlan,
)


def _proof(name="preuve.pdf"):
    return SimpleUploadedFile(name, b"contenu de la preuve", content_type="application/pdf")


class AgencyLifecycleTests(AuthedAPITestCase):
    def test_create_suspend_unlock_close(self):
        agency = services.create_agency(code="AG-1", name="Agence Test", by="u")
        agency = services.suspend(agency=agency, reason="KYC", by="u")
        self.assertEqual(agency.status, Agency.Status.SUSPENDU)
        agency = services.unlock_temporary(agency=agency, reason="KYC régularisé", document=_proof(), by="u")
        self.assertEqual(agency.status, Agency.Status.ACTIF)
        agency = services.close(agency=agency, reason="fin", by="u")
        self.assertEqual(agency.status, Agency.Status.FERMEE)

    def test_close_blocked_if_nonzero_balance(self):
        from caisses.models import TreasuryAccount
        agency = services.create_agency(code="AG-2", name="Agence Test 2", by="u")
        TreasuryAccount.objects.create(code="TA-1", name="Caisse", agency=agency, currency="USD",
                                        balance=Decimal("50"))
        with self.assertRaises(ConflictError):
            services.close(agency=agency, reason="fin", by="u")

    def test_action_endpoint_requires_validate_capability(self):
        services.create_agency(code="AG-3", name="Agence 3", by="u")
        self.login(role="agri_op", sub="client-1")  # pas de capacité validate
        res = self.client.post("/api/agencies/AG-3/action", {"action": "suspend", "reason": "x"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_evolve_type_updates_agency_and_audits(self):
        agency = services.create_agency(code="AG-4", name="Agence 4", type_=Agency.Type.POINT_SERVICE, by="u")
        agency = services.evolve_type(agency=agency, new_type=Agency.Type.URBAINE, reason="Croissance du volume", by="u")
        self.assertEqual(agency.type, Agency.Type.URBAINE)

    def test_evolve_type_rejects_same_type(self):
        agency = services.create_agency(code="AG-5", name="Agence 5", type_=Agency.Type.RURALE, by="u")
        with self.assertRaises(ValidationFailed):
            services.evolve_type(agency=agency, new_type=Agency.Type.RURALE, by="u")

    def test_evolve_type_endpoint_requires_validate_capability(self):
        services.create_agency(code="AG-6", name="Agence 6", type_=Agency.Type.POINT_SERVICE, by="u")
        self.login(role="agri_op", sub="client-2")  # pas de capacité validate
        res = self.client.post("/api/agencies/AG-6/action",
                                {"action": "evolve_type", "newType": "URBAINE"}, format="json")
        self.assertEqual(res.status_code, 403)


class AgencyReactivationTests(AuthedAPITestCase):
    def test_unlock_requires_reason_and_document(self):
        agency = services.create_agency(code="AG-7", name="Agence 7", by="u")
        agency = services.suspend(agency=agency, reason="x", by="u")
        with self.assertRaises(ValidationFailed):
            services.unlock_temporary(agency=agency, reason="", document=_proof(), by="u")
        with self.assertRaises(ValidationFailed):
            services.unlock_temporary(agency=agency, reason="motif", document=None, by="u")

    def test_unlock_records_reactivation_history(self):
        agency = services.create_agency(code="AG-8", name="Agence 8", by="u")
        agency = services.suspend(agency=agency, reason="x", by="u")
        services.unlock_temporary(agency=agency, reason="Contrôle KYC régularisé", document=_proof(), by="u")
        reactivation = AgencyReactivation.objects.get(agency=agency)
        self.assertEqual(reactivation.kind, AgencyReactivation.Kind.UNLOCK)
        self.assertEqual(reactivation.reason, "Contrôle KYC régularisé")
        self.assertTrue(reactivation.document.name)

    def test_reopen_closed_agency(self):
        agency = services.create_agency(code="AG-9", name="Agence 9", by="u")
        agency = services.close(agency=agency, reason="fin", by="u")
        agency = services.reopen(agency=agency, reason="Reprise d'activité approuvée", document=_proof(), by="u")
        self.assertEqual(agency.status, Agency.Status.ACTIF)
        reactivation = AgencyReactivation.objects.get(agency=agency, kind=AgencyReactivation.Kind.REOPEN)
        self.assertEqual(reactivation.reason, "Reprise d'activité approuvée")

    def test_reopen_rejects_non_closed_agency(self):
        agency = services.create_agency(code="AG-10", name="Agence 10", by="u")
        with self.assertRaises(ValidationFailed):
            services.reopen(agency=agency, reason="motif", document=_proof(), by="u")

    def test_reopen_endpoint_with_document(self):
        agency = services.create_agency(code="AG-11", name="Agence 11", by="u")
        services.close(agency=agency, reason="fin", by="u")
        self.login(role="dg", sub="u-reopen")
        res = self.client.post(
            "/api/agencies/AG-11/action",
            {"action": "reopen", "reason": "Reprise approuvée", "document": _proof()},
            format="multipart",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], Agency.Status.ACTIF)

    def test_reopen_endpoint_rejects_missing_document(self):
        agency = services.create_agency(code="AG-12", name="Agence 12", by="u")
        services.close(agency=agency, reason="fin", by="u")
        self.login(role="dg", sub="u-reopen2")
        res = self.client.post(
            "/api/agencies/AG-12/action", {"action": "reopen", "reason": "Reprise approuvée"}, format="multipart",
        )
        self.assertEqual(res.status_code, 400)

    def test_status_history_combines_suspend_close_and_reactivations(self):
        agency = services.create_agency(code="AG-13", name="Agence 13", by="u")
        agency = services.suspend(agency=agency, reason="Contrôle KYC en cours", by="u")
        agency = services.unlock_temporary(agency=agency, reason="KYC régularisé", document=_proof(), by="u")
        agency = services.close(agency=agency, reason="Fin d'activité", by="u")
        services.reopen(agency=agency, reason="Reprise approuvée", document=_proof(), by="u")

        self.login(role="dg", sub="u-history")
        res = self.client.get("/api/agencies/AG-13/status-history")
        self.assertEqual(res.status_code, 200)
        kinds = [r["kind"] for r in res.data]
        self.assertEqual(set(kinds), {"SUSPEND", "CLOSE", "UNLOCK", "REOPEN"})

        unlock_row = next(r for r in res.data if r["kind"] == "UNLOCK")
        self.assertEqual(unlock_row["reason"], "KYC régularisé")
        self.assertIsNotNone(unlock_row["documentUrl"])

        suspend_row = next(r for r in res.data if r["kind"] == "SUSPEND")
        self.assertEqual(suspend_row["reason"], "Contrôle KYC en cours")
        self.assertIsNone(suspend_row["documentUrl"])

        # Ordre antichronologique (le plus récent en premier).
        timestamps = [r["createdAt"] for r in res.data]
        self.assertEqual(timestamps, sorted(timestamps, reverse=True))

    def test_status_history_requires_audit_capability(self):
        services.create_agency(code="AG-14", name="Agence 14", by="u")
        self.login(role="agri_op", sub="client-3")  # pas de capacité audit
        res = self.client.get("/api/agencies/AG-14/status-history")
        self.assertEqual(res.status_code, 403)


class AgencyReconciliationTests(AuthedAPITestCase):
    def setUp(self):
        self.agency = services.create_agency(code="AG-15", name="Agence 15", by="u")

    def test_open_assign_complete_workflow(self):
        recon = services.open_reconciliation(agency=self.agency, period_start=date(2026, 6, 1),
                                              period_end=date(2026, 6, 30), by="u")
        self.assertEqual(recon.status, AgencyReconciliation.Status.PENDING)
        recon = services.assign_reconciliation(reconciliation=recon, assignee_sub="agent-1", by="u")
        self.assertEqual(recon.status, AgencyReconciliation.Status.IN_PROGRESS)
        recon = services.complete_reconciliation(reconciliation=recon, delta_amount="0", currency="USD", by="u")
        self.assertEqual(recon.status, AgencyReconciliation.Status.COMPLETED)
        self.assertIsNotNone(recon.closed_at)

    def test_cannot_open_second_reconciliation_while_one_pending(self):
        services.open_reconciliation(agency=self.agency, period_start=date(2026, 6, 1),
                                      period_end=date(2026, 6, 30), by="u")
        with self.assertRaises(ConflictError):
            services.open_reconciliation(agency=self.agency, period_start=date(2026, 7, 1),
                                          period_end=date(2026, 7, 31), by="u")

    def test_period_end_before_start_rejected(self):
        with self.assertRaises(ValidationFailed):
            services.open_reconciliation(agency=self.agency, period_start=date(2026, 6, 30),
                                          period_end=date(2026, 6, 1), by="u")

    def test_complete_twice_rejected(self):
        recon = services.open_reconciliation(agency=self.agency, period_start=date(2026, 6, 1),
                                              period_end=date(2026, 6, 30), by="u")
        services.complete_reconciliation(reconciliation=recon, delta_amount="0", currency="USD", by="u")
        with self.assertRaises(ConflictError):
            services.complete_reconciliation(reconciliation=recon, delta_amount="0", currency="USD", by="u")

    def test_open_endpoint_requires_validate_capability(self):
        self.login(role="agri_op", sub="client-4")  # pas de capacité validate
        res = self.client.post("/api/agencies/reconciliations", {
            "agencyCode": "AG-15", "periodStart": "2026-06-01", "periodEnd": "2026-06-30",
        }, format="json")
        self.assertEqual(res.status_code, 403)

    def test_full_endpoint_workflow(self):
        self.login(role="dg", sub="u-recon")
        res = self.client.post("/api/agencies/reconciliations", {
            "agencyCode": "AG-15", "periodStart": "2026-06-01", "periodEnd": "2026-06-30",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        recon_id = res.data["id"]

        res = self.client.post(f"/api/agencies/reconciliations/{recon_id}/assign",
                                {"assigneeSub": "agent-1"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "IN_PROGRESS")

        res = self.client.post(f"/api/agencies/reconciliations/{recon_id}/complete",
                                {"deltaAmount": "15.50", "currency": "USD", "notes": "Écart mineur"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "COMPLETED")
        self.assertEqual(res.data["deltaAmount"], 15.5)

        res = self.client.get("/api/agencies/reconciliations", {"agency": "AG-15"})
        self.assertEqual(len(res.data), 1)


class AgencyMakerCheckerTests(AuthedAPITestCase):
    def setUp(self):
        self.agency = services.create_agency(code="AG-16", name="Agence 16", by="u")

    def _approve_with_code(self, req, approver_sub, approver_role):
        with patch("agencies.maker_checker.secrets.randbelow", return_value=123456):
            challenge, _ = maker_checker.request_approval_code(action_request=req, approver_sub=approver_sub)
        self.assertTrue(maker_checker.verify_approval_code(challenge_id=challenge.pk, code="123456"))
        return maker_checker.approve_agency_action(action_request=req, approver_sub=approver_sub,
                                                     approver_role=approver_role, code="123456")

    def test_request_then_approve_suspends_agency(self):
        req = maker_checker.request_agency_action(agency=self.agency, action_type="SUSPEND",
                                                    reason="KYC non conforme", by="maker-1")
        self.assertEqual(req.status, AgencyActionRequest.Status.PENDING_APPROVAL)
        req = self._approve_with_code(req, "checker-1", "dg")
        self.assertEqual(req.status, AgencyActionRequest.Status.EXECUTED)
        self.agency.refresh_from_db()
        self.assertEqual(self.agency.status, Agency.Status.SUSPENDU)

    def test_maker_cannot_approve_own_request(self):
        req = maker_checker.request_agency_action(agency=self.agency, action_type="SUSPEND", reason="x", by="maker-1")
        with self.assertRaises(ConflictError):
            maker_checker.approve_agency_action(action_request=req, approver_sub="maker-1", approver_role="dg",
                                                 code="000000")

    def test_approve_without_verified_code_requires_step_up(self):
        req = maker_checker.request_agency_action(agency=self.agency, action_type="SUSPEND", reason="x", by="maker-1")
        with self.assertRaises(StepUpRequiredError):
            maker_checker.approve_agency_action(action_request=req, approver_sub="checker-1", approver_role="dg",
                                                 code=None)

    def test_reopen_and_unlock_require_document_at_request_time(self):
        with self.assertRaises(ValidationFailed):
            maker_checker.request_agency_action(agency=self.agency, action_type="UNLOCK_TEMPORARY",
                                                 reason="x", document=None, by="maker-1")

    def test_reject_records_note(self):
        req = maker_checker.request_agency_action(agency=self.agency, action_type="CLOSE", reason="x", by="maker-1")
        req = maker_checker.reject_agency_action(action_request=req, approver_sub="checker-1", note="Motif insuffisant")
        self.assertEqual(req.status, AgencyActionRequest.Status.REJECTED)
        self.assertEqual(req.rejection_note, "Motif insuffisant")

    def test_cannot_open_second_request_while_one_pending(self):
        maker_checker.request_agency_action(agency=self.agency, action_type="SUSPEND", reason="x", by="maker-1")
        with self.assertRaises(ConflictError):
            maker_checker.request_agency_action(agency=self.agency, action_type="CLOSE", reason="y", by="maker-1")

    def test_full_endpoint_workflow(self):
        self.login(role="gest_zone", sub="maker-2")  # a la capacité validate
        res = self.client.post("/api/agencies/action-requests", {
            "agencyCode": "AG-16", "actionType": "SUSPEND", "reason": "Contrôle terrain",
        }, format="multipart")
        self.assertEqual(res.status_code, 201)
        req_id = res.data["id"]

        self.login(role="dg", sub="checker-2")
        with patch("agencies.maker_checker.secrets.randbelow", return_value=654321):
            res = self.client.post(f"/api/agencies/action-requests/{req_id}/request-code", {}, format="json")
        self.assertEqual(res.status_code, 200)
        challenge_id = res.data["challengeId"]

        res = self.client.post(f"/api/agencies/action-requests/{req_id}/verify-code",
                                {"challengeId": challenge_id, "code": "654321"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["verified"])

        res = self.client.post(f"/api/agencies/action-requests/{req_id}/approve", {"code": "654321"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "EXECUTED")

        self.agency.refresh_from_db()
        self.assertEqual(self.agency.status, Agency.Status.SUSPENDU)


class AgencyComplianceScoreTests(AuthedAPITestCase):
    def setUp(self):
        self.agency = services.create_agency(code="AG-CS1", name="Agence CS1", by="u")

    def _component(self, result, code):
        return next(c for c in result["components"] if c["code"] == code)

    def test_no_data_anywhere_only_incident_component_is_computable(self):
        result = compliance.compute_agency_compliance_score(agency=self.agency, persist=False)
        self.assertIsNone(self._component(result, "RAPPRO_PONCTUALITE")["score"])
        self.assertIsNone(self._component(result, "TRANSACTIONS_RETARD")["score"])
        self.assertIsNone(self._component(result, "TRESORERIE_SAINE")["score"])
        self.assertEqual(self._component(result, "HISTORIQUE_INCIDENTS")["score"], 100.0)
        self.assertEqual(result["score"], 100.0)  # seule composante disponible -> renormalisée à elle seule

    def test_punctual_reconciliation_scores_100(self):
        recon = services.open_reconciliation(agency=self.agency, period_start=date(2026, 6, 1),
                                              period_end=date(2026, 6, 30), by="u")
        services.complete_reconciliation(reconciliation=recon, delta_amount="0", currency="USD", by="u")
        result = compliance.compute_agency_compliance_score(agency=self.agency, persist=False)
        self.assertEqual(self._component(result, "RAPPRO_PONCTUALITE")["score"], 100.0)

    def test_late_reconciliation_lowers_score(self):
        recon = services.open_reconciliation(agency=self.agency, period_start=date(2026, 6, 1),
                                              period_end=date(2026, 6, 30), by="u")
        AgencyReconciliation.objects.filter(pk=recon.pk).update(opened_at=timezone.now() - timedelta(hours=48))
        recon.refresh_from_db()
        services.complete_reconciliation(reconciliation=recon, delta_amount="0", currency="USD", by="u")
        result = compliance.compute_agency_compliance_score(agency=self.agency, persist=False)
        self.assertEqual(self._component(result, "RAPPRO_PONCTUALITE")["score"], 0.0)

    def test_reactivation_history_lowers_score(self):
        AgencyReactivation.objects.create(agency=self.agency, kind=AgencyReactivation.Kind.UNLOCK,
                                           reason="Preuve fournie.", document=_proof())
        result = compliance.compute_agency_compliance_score(agency=self.agency, persist=False)
        self.assertEqual(self._component(result, "HISTORIQUE_INCIDENTS")["score"], 80.0)

    def test_blocked_treasury_account_lowers_score(self):
        from caisses.models import TreasuryAccount
        TreasuryAccount.objects.create(code="TA-CS1", name="Caisse CS1", agency=self.agency,
                                        status=TreasuryAccount.Status.BLOQUE)
        result = compliance.compute_agency_compliance_score(agency=self.agency, persist=False)
        self.assertEqual(self._component(result, "TRESORERIE_SAINE")["score"], 0.0)

    def test_persist_updates_agency_field_and_creates_one_snapshot_per_hour(self):
        AgencyReactivation.objects.create(agency=self.agency, kind=AgencyReactivation.Kind.UNLOCK,
                                           reason="Preuve fournie.", document=_proof())
        result = compliance.compute_agency_compliance_score(agency=self.agency, persist=True)
        self.assertIsNotNone(result["score"])
        self.agency.refresh_from_db()
        self.assertEqual(self.agency.compliance_score, result["score"])
        self.assertEqual(AgencyComplianceSnapshot.objects.filter(agency=self.agency).count(), 1)

        compliance.compute_agency_compliance_score(agency=self.agency, persist=True)
        self.assertEqual(AgencyComplianceSnapshot.objects.filter(agency=self.agency).count(), 1)

    def test_endpoint_returns_score(self):
        AgencyReactivation.objects.create(agency=self.agency, kind=AgencyReactivation.Kind.UNLOCK,
                                           reason="Preuve fournie.", document=_proof())
        self.login(role="gest_zone", sub="u-cs1")
        res = self.client.get(f"/api/agencies/{self.agency.code}/compliance-score")
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(res.data["score"])


class EvolutionPlanTests(AuthedAPITestCase):
    def setUp(self):
        self.agency = services.create_agency(code="AG-EV1", name="Agence EV1",
                                              type_=Agency.Type.POINT_SERVICE, by="u")

    def test_start_plan_creates_default_checklist(self):
        plan = evolution.start_evolution_plan(agency=self.agency, to_type=Agency.Type.RURALE,
                                               reason="Croissance du volume", by="u")
        self.assertEqual(plan.status, EvolutionPlan.Status.IN_PROGRESS)
        self.assertEqual(plan.items.count(), len(evolution.DEFAULT_CHECKLIST))
        self.assertTrue(all(not i.is_done for i in plan.items.all()))

    def test_start_plan_rejects_same_type(self):
        with self.assertRaises(ValidationFailed):
            evolution.start_evolution_plan(agency=self.agency, to_type=Agency.Type.POINT_SERVICE, by="u")

    def test_cannot_start_second_plan_while_one_in_progress(self):
        evolution.start_evolution_plan(agency=self.agency, to_type=Agency.Type.RURALE, by="u")
        with self.assertRaises(ConflictError):
            evolution.start_evolution_plan(agency=self.agency, to_type=Agency.Type.URBAINE, by="u")

    def test_complete_blocked_until_all_items_checked(self):
        plan = evolution.start_evolution_plan(agency=self.agency, to_type=Agency.Type.RURALE, by="u")
        with self.assertRaises(ConflictError):
            evolution.complete_evolution_plan(plan=plan, by="u")
        items = list(plan.items.all())
        for item in items[:-1]:
            evolution.check_evolution_item(item=item, by="agent-1")
        with self.assertRaises(ConflictError):
            evolution.complete_evolution_plan(plan=plan, by="u")
        evolution.check_evolution_item(item=items[-1], by="agent-1")

        agency = evolution.complete_evolution_plan(plan=plan, by="u")
        self.assertEqual(agency.type, Agency.Type.RURALE)
        plan.refresh_from_db()
        self.assertEqual(plan.status, EvolutionPlan.Status.COMPLETED)
        self.assertIsNotNone(plan.completed_at)

    def test_check_item_is_idempotent(self):
        plan = evolution.start_evolution_plan(agency=self.agency, to_type=Agency.Type.RURALE, by="u")
        item = plan.items.first()
        evolution.check_evolution_item(item=item, by="agent-1")
        first_done_at = item.done_at
        item2 = evolution.check_evolution_item(item=item, by="agent-2")
        self.assertEqual(item2.done_at, first_done_at)
        self.assertEqual(item2.done_by, "agent-1")  # inchangé, pas ré-attribué au 2e appelant

    def test_cancel_plan_frees_agency_for_a_new_plan(self):
        plan = evolution.start_evolution_plan(agency=self.agency, to_type=Agency.Type.RURALE, by="u")
        evolution.cancel_evolution_plan(plan=plan, reason="Abandonné", by="u")
        plan.refresh_from_db()
        self.assertEqual(plan.status, EvolutionPlan.Status.CANCELLED)
        # Un nouveau plan peut maintenant être démarré.
        new_plan = evolution.start_evolution_plan(agency=self.agency, to_type=Agency.Type.URBAINE, by="u")
        self.assertEqual(new_plan.status, EvolutionPlan.Status.IN_PROGRESS)

    def test_cannot_check_item_or_complete_a_cancelled_plan(self):
        plan = evolution.start_evolution_plan(agency=self.agency, to_type=Agency.Type.RURALE, by="u")
        item = plan.items.first()
        evolution.cancel_evolution_plan(plan=plan, by="u")
        with self.assertRaises(ConflictError):
            evolution.check_evolution_item(item=item, by="u")
        with self.assertRaises(ConflictError):
            evolution.complete_evolution_plan(plan=plan, by="u")

    def test_full_workflow_via_api(self):
        self.login(role="dg", sub="u-ev1")
        started = self.client.post(f"/api/agencies/{self.agency.code}/evolution-plans",
                                    {"toType": "RURALE", "reason": "Croissance"}, format="json")
        self.assertEqual(started.status_code, 201)
        plan_id = started.data["id"]
        self.assertEqual(len(started.data["items"]), len(evolution.DEFAULT_CHECKLIST))

        for item in started.data["items"]:
            res = self.client.post(f"/api/agencies/evolution-plans/{plan_id}/items/{item['id']}/check", {},
                                    format="json")
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.data["isDone"])

        completed = self.client.post(f"/api/agencies/evolution-plans/{plan_id}/complete", {}, format="json")
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.data["status"], "COMPLETED")

        self.agency.refresh_from_db()
        self.assertEqual(self.agency.type, Agency.Type.RURALE)

        listed = self.client.get(f"/api/agencies/{self.agency.code}/evolution-plans")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.data), 1)

    def test_endpoints_require_validate_capability(self):
        self.login(role="agri_op", sub="client-ev1")  # pas de capacité validate
        res = self.client.post(f"/api/agencies/{self.agency.code}/evolution-plans",
                                {"toType": "RURALE"}, format="json")
        self.assertEqual(res.status_code, 403)

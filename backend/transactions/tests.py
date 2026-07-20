from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone

from common.exceptions import StepUpRequiredError
from common.testing import AuthedAPITestCase

from . import services
from .models import SpecialCase, Transaction, ValidationThreshold


class TransactionWorkflowTests(AuthedAPITestCase):
    def setUp(self):
        ValidationThreshold.objects.create(operation_type="PAYMENT", auto_limit="1000", manager_limit="5000")

    def test_auto_validated_below_threshold(self):
        tx = services.create_transaction(agency_id=None, kind="debit", amount="50", currency="USD",
                                          operation_type="PAYMENT", idempotency_key="t1", by="u")
        self.assertEqual(tx.status, "posted")
        self.assertTrue(tx.auto_validated)

    def test_single_approval_between_thresholds_no_otp_needed(self):
        tx = services.create_transaction(agency_id=None, kind="debit", amount="2000", currency="USD",
                                          operation_type="PAYMENT", idempotency_key="t2", by="u")
        self.assertEqual(tx.status, "pending_validation")
        tx = services.approve(transaction_id=tx.pk, approver_sub="mgr", approver_role="gest_caisse")
        self.assertEqual(tx.status, "posted")

    def test_supervisor_tier_requires_otp(self):
        tx = services.create_transaction(agency_id=None, kind="debit", amount="10000", currency="USD",
                                          operation_type="PAYMENT", idempotency_key="t3", by="u")
        with self.assertRaises(StepUpRequiredError):
            services.approve(transaction_id=tx.pk, approver_sub="sup1", approver_role="dg")


class TransactionQuorumTests(AuthedAPITestCase):
    def setUp(self):
        ValidationThreshold.objects.create(operation_type="PAYMENT", auto_limit="1000", manager_limit="5000")
        self.tx = services.create_transaction(agency_id=None, kind="debit", amount="10000", currency="USD",
                                               operation_type="PAYMENT", idempotency_key="quorum-1", by="u")

    def _approve_with_otp(self, sub, role):
        with patch("transactions.services.secrets.randbelow", return_value=123456):
            challenge = services.request_step_up_otp(transaction_id=self.tx.pk, approver_sub=sub)
        self.assertTrue(services.verify_step_up_otp(challenge_id=challenge.pk, code="123456"))
        return services.approve(transaction_id=self.tx.pk, approver_sub=sub, approver_role=role, otp_code="123456")

    def test_quorum_of_three_then_fourth_is_idempotent_noop(self):
        tx = self._approve_with_otp("sup1", "dg")
        self.assertEqual(tx.status, "pending_validation")
        tx = self._approve_with_otp("sup2", "dir_ops")
        self.assertEqual(tx.status, "pending_validation")
        tx = self._approve_with_otp("sup3", "aud_fin")
        self.assertEqual(tx.status, "posted")
        # 4e approbateur après quorum déjà atteint -> no-op idempotent, pas d'erreur.
        tx = self._approve_with_otp("sup4", "aud_tech")
        self.assertEqual(tx.status, "posted")

    def test_wrong_otp_code_not_verified(self):
        with patch("transactions.services.secrets.randbelow", return_value=123456):
            challenge = services.request_step_up_otp(transaction_id=self.tx.pk, approver_sub="sup1")
        self.assertFalse(services.verify_step_up_otp(challenge_id=challenge.pk, code="000000"))
        with self.assertRaises(StepUpRequiredError):
            services.approve(transaction_id=self.tx.pk, approver_sub="sup1", approver_role="dg", otp_code="000000")


class OverduePendingTests(AuthedAPITestCase):
    def setUp(self):
        ValidationThreshold.objects.create(operation_type="PAYMENT", auto_limit="1000", manager_limit="5000",
                                            manual_timeout_hours=24)

    def test_fresh_pending_transaction_not_overdue(self):
        services.create_transaction(agency_id=None, kind="debit", amount="2000", currency="USD",
                                     operation_type="PAYMENT", idempotency_key="ov-1", by="u")
        self.assertEqual(services.overdue_pending_count(), 0)

    def test_transaction_past_timeout_is_overdue(self):
        tx = services.create_transaction(agency_id=None, kind="debit", amount="2000", currency="USD",
                                          operation_type="PAYMENT", idempotency_key="ov-2", by="u")
        Transaction.objects.filter(pk=tx.pk).update(created_at=timezone.now() - timedelta(hours=25))
        self.assertEqual(services.overdue_pending_count(), 1)

    def test_posted_transaction_never_counted_even_if_old(self):
        tx = services.create_transaction(agency_id=None, kind="debit", amount="50", currency="USD",
                                          operation_type="PAYMENT", idempotency_key="ov-3", by="u")
        self.assertEqual(tx.status, "posted")  # sous le seuil auto -> jamais "en attente"
        Transaction.objects.filter(pk=tx.pk).update(created_at=timezone.now() - timedelta(days=10))
        self.assertEqual(services.overdue_pending_count(), 0)

    def test_supervision_endpoint_includes_overdue_count(self):
        tx = services.create_transaction(agency_id=None, kind="debit", amount="2000", currency="USD",
                                          operation_type="PAYMENT", idempotency_key="ov-4", by="u")
        Transaction.objects.filter(pk=tx.pk).update(created_at=timezone.now() - timedelta(hours=48))
        self.login(role="dg", sub="u-supervision")
        res = self.client.get("/api/transactions/supervision")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["overdueCount"], 1)


class SpecialCaseApiTests(AuthedAPITestCase):
    def setUp(self):
        ValidationThreshold.objects.create(operation_type="PAYMENT", auto_limit="1000", manager_limit="5000")
        self.tx = services.create_transaction(agency_id=None, kind="debit", amount="7000", currency="USD",
                                               operation_type="PAYMENT", emitter="client-1",
                                               idempotency_key="sc-1", by="u")
        self.case = SpecialCase.objects.create(transaction=self.tx, alert_level="ELEVE",
                                                recommendation="Vérifier l'origine des fonds.")

    def test_special_case_row_embeds_transaction_fields(self):
        self.login(role="aud_fin", sub="u-audit")
        res = self.client.get("/api/transactions/special-cases")
        self.assertEqual(res.status_code, 200)
        row = next(r for r in res.data if r["id"] == self.case.pk)
        self.assertEqual(row["ref"], f"TX-{self.tx.pk}")
        self.assertEqual(row["client"], "client-1")
        self.assertEqual(row["amount"], 7000.0)
        self.assertEqual(row["transactionStatus"], "pending_validation")

    def test_escalate_special_case(self):
        self.login(role="aud_fin", sub="u-audit2")
        res = self.client.post(f"/api/transactions/special-cases/{self.case.pk}/escalate",
                                {"supervisorSub": "sup-1"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "EN_OBSERVATION")
        self.assertEqual(res.data["escalatedTo"], "sup-1")

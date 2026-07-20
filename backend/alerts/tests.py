from __future__ import annotations

from datetime import timedelta
from unittest.mock import Mock, patch

from django.test import override_settings
from django.utils import timezone

from common.exceptions import ConflictError
from common.testing import AuthedAPITestCase

from . import services
from .models import Alert, AlertRule

_SMS_CONFIGURED = {"API_URL": "https://example.test/SendSMS", "API_ID": "API1", "API_PASSWORD": "pwd",
                   "SENDER_ID": "TEST"}


def _make_overdue_transaction(idempotency_key: str, by: str = "u"):
    from transactions import services as tx_services
    from transactions.models import Transaction, ValidationThreshold
    ValidationThreshold.objects.get_or_create(
        operation_type="PAYMENT",
        defaults={"auto_limit": "1000", "manager_limit": "5000", "manual_timeout_hours": 24},
    )
    tx = tx_services.create_transaction(agency_id=None, kind="debit", amount="2000", currency="USD",
                                         operation_type="PAYMENT", idempotency_key=idempotency_key, by=by)
    Transaction.objects.filter(pk=tx.pk).update(created_at=timezone.now() - timedelta(hours=48))
    return tx


class AlertRuleTests(AuthedAPITestCase):
    def test_default_rules_are_seeded(self):
        self.assertTrue(AlertRule.objects.filter(code="AGENCY_SUSPENDED_72H").exists())
        self.assertTrue(AlertRule.objects.filter(code="COMPLIANCE_LOW_60").exists())

    def test_create_rule_rejects_duplicate_code(self):
        services.create_alert_rule(code="X1", name="Test", metric="TRANSACTION_OVERDUE", operator=">=",
                                    threshold=1, severity="WARNING", by="u")
        with self.assertRaises(Exception):
            services.create_alert_rule(code="X1", name="Autre", metric="TRANSACTION_OVERDUE", operator=">=",
                                        threshold=2, severity="WARNING", by="u")

    def test_update_rule_can_disable_without_deleting(self):
        rule = services.create_alert_rule(code="X2", name="Test", metric="TRANSACTION_OVERDUE", operator=">=",
                                           threshold=1, severity="WARNING", by="u")
        services.update_alert_rule(rule=rule, enabled=False, by="u")
        rule.refresh_from_db()
        self.assertFalse(rule.enabled)
        self.assertTrue(AlertRule.objects.filter(pk=rule.pk).exists())  # jamais de suppression physique


class AlertEvaluationTests(AuthedAPITestCase):
    def setUp(self):
        AlertRule.objects.all().delete()  # isole des règles seedées par la migration

    def test_agency_suspended_raises_alert_once_past_threshold(self):
        from agencies import services as agency_services
        rule = services.create_alert_rule(code="R1", name="Suspendue", metric="AGENCY_SUSPENDED",
                                           operator=">=", threshold=24, severity="WARNING", by="u")
        agency = agency_services.create_agency(code="AG-AL-1", name="Agence Al 1", by="u")
        agency_services.suspend(agency=agency, reason="x", by="u")
        from audit.models import AuditEntry
        AuditEntry.objects.filter(entity_type="Agency", entity_id="AG-AL-1", action="agency.suspend").update(
            created_at=timezone.now() - timedelta(hours=25),
        )
        services.evaluate_and_sync_alerts()
        self.assertTrue(Alert.objects.filter(rule=rule, source_id="AG-AL-1", status="ACTIVE").exists())
        # Deuxième évaluation -> pas de doublon.
        services.evaluate_and_sync_alerts()
        self.assertEqual(Alert.objects.filter(rule=rule, source_id="AG-AL-1").count(), 1)

    def test_agency_suspended_recently_does_not_raise(self):
        from agencies import services as agency_services
        services.create_alert_rule(code="R2", name="Suspendue", metric="AGENCY_SUSPENDED",
                                    operator=">=", threshold=24, severity="WARNING", by="u")
        agency = agency_services.create_agency(code="AG-AL-2", name="Agence Al 2", by="u")
        agency_services.suspend(agency=agency, reason="x", by="u")
        services.evaluate_and_sync_alerts()
        self.assertFalse(Alert.objects.filter(source_id="AG-AL-2").exists())

    def test_transaction_overdue_metric_raises_global_alert(self):
        from transactions.models import Transaction, ValidationThreshold
        ValidationThreshold.objects.create(operation_type="PAYMENT", auto_limit="1000", manager_limit="5000",
                                            manual_timeout_hours=24)
        from transactions import services as tx_services
        tx = tx_services.create_transaction(agency_id=None, kind="debit", amount="2000", currency="USD",
                                             operation_type="PAYMENT", idempotency_key="al-tx-1", by="u")
        Transaction.objects.filter(pk=tx.pk).update(created_at=timezone.now() - timedelta(hours=48))
        services.create_alert_rule(code="R3", name="TX retard", metric="TRANSACTION_OVERDUE",
                                    operator=">=", threshold=1, severity="WARNING", by="u")
        services.evaluate_and_sync_alerts()
        self.assertTrue(Alert.objects.filter(source_type="Transaction", source_id="global").exists())

    def test_escalation_bumps_unacknowledged_warning_to_critical(self):
        rule = services.create_alert_rule(code="R4", name="TX retard", metric="TRANSACTION_OVERDUE",
                                           operator=">=", threshold=0, severity="WARNING", by="u")
        alert = Alert.objects.create(rule=rule, severity="WARNING", title="x", dedup_key="R4:global")
        Alert.objects.filter(pk=alert.pk).update(triggered_at=timezone.now() - timedelta(minutes=90))
        services._escalate_unacknowledged_warnings()
        alert.refresh_from_db()
        self.assertEqual(alert.severity, "CRITICAL")

    def test_acknowledge_then_resolve(self):
        rule = services.create_alert_rule(code="R5", name="Test", metric="TRANSACTION_OVERDUE",
                                           operator=">=", threshold=0, severity="WARNING", by="u")
        alert = Alert.objects.create(rule=rule, severity="WARNING", title="x", dedup_key="R5:global")
        alert = services.acknowledge_alert(alert=alert, by="u")
        self.assertEqual(alert.status, "ACKNOWLEDGED")
        alert = services.resolve_alert(alert=alert, note="Réglé", by="u")
        self.assertEqual(alert.status, "RESOLVED")
        with self.assertRaises(ConflictError):
            services.resolve_alert(alert=alert, note="Encore", by="u")


class AlertRuleSmsNotificationTests(AuthedAPITestCase):
    def setUp(self):
        AlertRule.objects.all().delete()

    @override_settings(SMS=_SMS_CONFIGURED)
    @patch("common.sms.requests.get")
    def test_new_alert_notifies_configured_phone(self, mock_get):
        _make_overdue_transaction("al-sms-1")
        mock_get.return_value = Mock(json=lambda: {"status": "S"})
        services.create_alert_rule(code="R-SMS-1", name="TX retard SMS", metric="TRANSACTION_OVERDUE",
                                    operator=">=", threshold=1, severity="CRITICAL",
                                    notify_phone="+243900000009", by="u")
        services.evaluate_and_sync_alerts()
        mock_get.assert_called_once()
        self.assertEqual(mock_get.call_args.kwargs["params"]["phonenumber"], "243900000009")

    @patch("common.sms.requests.get")
    def test_no_notify_phone_configured_does_not_send(self, mock_get):
        _make_overdue_transaction("al-sms-2")
        services.create_alert_rule(code="R-SMS-2", name="TX retard", metric="TRANSACTION_OVERDUE",
                                    operator=">=", threshold=1, severity="WARNING", by="u")
        services.evaluate_and_sync_alerts()
        mock_get.assert_not_called()

    @override_settings(SMS=_SMS_CONFIGURED)
    @patch("common.sms.requests.get")
    def test_duplicate_active_alert_does_not_resend_sms(self, mock_get):
        _make_overdue_transaction("al-sms-3")
        mock_get.return_value = Mock(json=lambda: {"status": "S"})
        services.create_alert_rule(code="R-SMS-3", name="TX retard", metric="TRANSACTION_OVERDUE",
                                    operator=">=", threshold=1, severity="WARNING",
                                    notify_phone="+243900000010", by="u")
        services.evaluate_and_sync_alerts()
        services.evaluate_and_sync_alerts()
        mock_get.assert_called_once()

    def test_rule_row_and_update_expose_notify_phone(self):
        self.login(role="admin_it", sub="cfg-1")  # config=True
        created = self.client.post("/api/alerts/rules", {
            "code": "R-SMS-4", "name": "Test", "metric": "TRANSACTION_OVERDUE", "operator": ">=",
            "threshold": 1, "severity": "WARNING", "notifyPhone": "+243900000011",
        }, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["notifyPhone"], "+243900000011")

        updated = self.client.patch(f"/api/alerts/rules/{created.data['id']}", {"notifyPhone": "+243900000012"},
                                     format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["notifyPhone"], "+243900000012")


class AlertApiTests(AuthedAPITestCase):
    def test_rules_endpoint_requires_config_capability(self):
        self.login(role="agri_op", sub="u1")
        res = self.client.get("/api/alerts/rules")
        self.assertEqual(res.status_code, 403)

    def test_alerts_endpoint_requires_read_capability_and_evaluates(self):
        self.login(role="dg", sub="u2")
        res = self.client.get("/api/alerts/")
        self.assertEqual(res.status_code, 200)

    def test_acknowledge_and_resolve_endpoints(self):
        rule = AlertRule.objects.filter(enabled=True).first()
        alert = Alert.objects.create(rule=rule, severity="WARNING", title="x", dedup_key="api-test:1")
        self.login(role="dg", sub="u3")
        res = self.client.post(f"/api/alerts/{alert.pk}/acknowledge", {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "ACKNOWLEDGED")
        res = self.client.post(f"/api/alerts/{alert.pk}/resolve", {"resolutionNote": "ok"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "RESOLVED")

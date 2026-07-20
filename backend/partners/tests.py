from __future__ import annotations

from unittest.mock import Mock, patch

import requests

from common.exceptions import ConflictError, ValidationFailed
from common.testing import AuthedAPITestCase

from . import services
from .models import Partner, PartnerHealthCheck


class PartnersTests(AuthedAPITestCase):
    def test_sync_requires_config_capability(self):
        partner = Partner.objects.create(name="Airtel Money")
        self.login(role="agent_terrain", sub="p1")  # pas de capacité config
        res = self.client.post(f"/api/partners/{partner.pk}/sync", {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_sync_with_config_capability(self):
        partner = Partner.objects.create(name="Orange Money")
        self.login(role="admin_it", sub="p2")  # capacité config=True
        res = self.client.post(f"/api/partners/{partner.pk}/sync", {}, format="json")
        self.assertEqual(res.data["status"], "Actif")

    def test_sync_writes_audit_entry(self):
        partner = Partner.objects.create(name="M-Pesa")
        self.login(role="dg", sub="p3")  # config=True et audit=True
        self.client.post(f"/api/partners/{partner.pk}/sync", {}, format="json")
        res = self.client.get("/api/audit/entries", {"entity_type": "Partner"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(any(e["action"] == "partner.sync" and e["entityId"] == str(partner.pk) for e in res.data))


class PartnerHealthCheckTests(AuthedAPITestCase):
    def test_check_health_without_base_url_is_honest_not_simulated(self):
        partner = Partner.objects.create(name="Airtel Money")
        with self.assertRaises(ValidationFailed):
            services.check_health(partner=partner, by="u")

    @patch("partners.services.requests.get")
    def test_check_health_success_resets_failures(self, mock_get):
        partner = Partner.objects.create(name="Orange Money", base_url="https://example.test/health",
                                          consecutive_failures=3)
        mock_get.return_value = Mock(status_code=200)
        check = services.check_health(partner=partner, by="u")
        self.assertTrue(check.ok)
        partner.refresh_from_db()
        self.assertEqual(partner.consecutive_failures, 0)
        self.assertEqual(partner.circuit_state, Partner.CircuitState.CLOSED)
        self.assertEqual(partner.status, Partner.Status.ACTIF)

    @patch("partners.services.requests.get")
    def test_circuit_opens_after_threshold_failures(self, mock_get):
        partner = Partner.objects.create(name="Banque X", base_url="https://example.test/health")
        mock_get.side_effect = requests.RequestException("timeout")
        for _ in range(services.CIRCUIT_FAILURE_THRESHOLD):
            services.check_health(partner=partner, by="u")
            partner.refresh_from_db()
        self.assertEqual(partner.circuit_state, Partner.CircuitState.OPEN)
        self.assertEqual(partner.status, Partner.Status.DECONNECTE)
        # Un nouvel appel pendant la fenêtre de cooldown est refusé sans re-solliciter le réseau.
        mock_get.reset_mock()
        with self.assertRaises(ConflictError):
            services.check_health(partner=partner, by="u")
        mock_get.assert_not_called()

    def test_configure_partner_sets_base_url(self):
        partner = Partner.objects.create(name="M-Pesa")
        services.configure_partner(partner=partner, base_url="https://mpesa.example/health", by="u")
        partner.refresh_from_db()
        self.assertEqual(partner.base_url, "https://mpesa.example/health")

    def test_configure_endpoint_requires_config_capability(self):
        partner = Partner.objects.create(name="M-Pesa")
        self.login(role="agent_terrain", sub="p4")
        res = self.client.patch(f"/api/partners/{partner.pk}", {"baseUrl": "https://x"}, format="json")
        self.assertEqual(res.status_code, 403)

    @patch("partners.services.requests.get")
    def test_test_endpoint_returns_check_result(self, mock_get):
        partner = Partner.objects.create(name="Orange Money", base_url="https://example.test/health")
        mock_get.return_value = Mock(status_code=200)
        self.login(role="admin_it", sub="p5")
        res = self.client.post(f"/api/partners/{partner.pk}/test", {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["check"]["ok"])

    def test_logs_endpoint_combines_health_and_sync(self):
        partner = Partner.objects.create(name="M-Pesa")
        PartnerHealthCheck.objects.create(partner=partner, ok=True, latency_ms=42)
        services.sync_partner(partner=partner, by="u")
        self.login(role="dg", sub="p6")
        res = self.client.get(f"/api/partners/{partner.pk}/logs")
        self.assertEqual(res.status_code, 200)
        self.assertEqual({r["type"] for r in res.data}, {"health", "sync"})

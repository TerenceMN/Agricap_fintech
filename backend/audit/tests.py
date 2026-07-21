"""Tests de lecture du journal d'audit (`GET /api/audit/entries`) — filtres du contrat §4
et signalement de troncature (`totalRows`). LECTURE SEULE : aucune écriture possible."""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from common.testing import AuthedAPITestCase
from audit.models import AuditEntry
from audit.services import record


class AuditFilterTests(AuthedAPITestCase):
    def setUp(self):
        record(actor="analyst-1", actor_role="gest_credit",
               action="credits.analyse.execute", entity_type="AnalyseCredit",
               entity_id="7", details={"applicationCode": "CRED-0001"})
        record(actor="analyst-2", actor_role="gest_credit",
               action="credits.analyse.justifier", entity_type="AnalyseCredit",
               entity_id="8", details={"applicationCode": "CRED-0002"})
        record(actor="agent-9", actor_role="agent_terrain",
               action="assets.verify", entity_type="Asset",
               entity_id="42", details={"reference": "CRED-0001"})

    def test_filter_by_dossier_matches_application_code_and_reference(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.get("/api/audit/entries?dossier=CRED-0001")
        self.assertEqual(res.status_code, 200)
        actions = {e["action"] for e in res.data}
        self.assertEqual(actions, {"credits.analyse.execute", "assets.verify"})

    def test_filter_by_acteur(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.get("/api/audit/entries?acteur=analyst-2")
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["action"], "credits.analyse.justifier")

    def test_filter_by_etape_is_substring_on_action(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.get("/api/audit/entries?etape=analyse")
        self.assertEqual(len(res.data), 2)
        res2 = self.client.get("/api/audit/entries?etape=analyse.execute")
        self.assertEqual(len(res2.data), 1)

    def test_filter_by_period(self):
        self.login(role="aud_fin", sub="auditor")
        # Repousser une entrée dans le passé.
        old = AuditEntry.objects.filter(actor="agent-9").first()
        AuditEntry.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(days=10))
        today = timezone.now().date().isoformat()
        res = self.client.get(f"/api/audit/entries?depuis={today}")
        actors = {e["user"] for e in res.data}
        self.assertNotIn("agent-9", actors)
        self.assertIn("analyst-1", actors)

    def test_meta_exposes_total_rows_and_header(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.get("/api/audit/entries?meta=1")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["totalRows"], 3)
        self.assertEqual(res.data["returned"], 3)
        self.assertFalse(res.data["truncated"])
        self.assertEqual(res["X-Total-Rows"], "3")

    def test_default_response_is_bare_list_backward_compatible(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.get("/api/audit/entries")
        self.assertIsInstance(res.data, list)
        self.assertEqual(res["X-Total-Rows"], "3")

    def test_requires_audit_capability(self):
        self.login(role="agent_terrain", sub="no-audit")  # pas de capacité audit
        res = self.client.get("/api/audit/entries")
        self.assertEqual(res.status_code, 403)

    def test_read_only_no_write_verb(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.post("/api/audit/entries", {}, format="json")
        self.assertEqual(res.status_code, 405)  # méthode non autorisée


class AuditExportTests(AuthedAPITestCase):
    def setUp(self):
        record(actor="analyst-1", actor_role="gest_credit",
               action="credits.analyse.execute", entity_type="AnalyseCredit",
               entity_id="7", details={"applicationCode": "CRED-0001"})
        record(actor="agent-9", actor_role="agent_terrain",
               action="assets.verify", entity_type="Asset",
               entity_id="42", details={"reference": "CRED-0001"})
        record(actor="analyst-2", actor_role="gest_credit",
               action="credits.analyse.justifier", entity_type="AnalyseCredit",
               entity_id="8", details={"applicationCode": "CRED-0002"})

    def _body(self, res) -> str:
        return b"".join(res.streaming_content).decode("utf-8")

    def test_export_is_csv_attachment_with_all_rows(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.get("/api/audit/export")
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/csv", res["Content-Type"])
        self.assertIn("attachment", res["Content-Disposition"])
        self.assertIn(".csv", res["Content-Disposition"])
        body = self._body(res)
        # BOM UTF-8 en tête (ouverture correcte dans Excel).
        self.assertEqual(ord(body[0]), 0xFEFF)
        body = body[1:]
        # En-tête + 3 lignes de données.
        lines = [l for l in body.splitlines() if l.strip()]
        self.assertEqual(len(lines), 4)
        self.assertIn("Horodatage", lines[0])
        self.assertIn("credits.analyse.execute", body)
        self.assertEqual(res["X-Total-Rows"], "3")
        self.assertEqual(res["X-Truncated"], "0")

    def test_export_respects_filters(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.get("/api/audit/export?dossier=CRED-0001")
        body = self._body(res)
        self.assertIn("credits.analyse.execute", body)
        self.assertIn("assets.verify", body)
        self.assertNotIn("credits.analyse.justifier", body)
        self.assertEqual(res["X-Total-Rows"], "2")

    def test_export_details_preserved_as_json(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.get("/api/audit/export?acteur=analyst-1")
        body = self._body(res)
        # Le code du dossier vit dans les détails — rien n'est perdu à l'export.
        self.assertIn("applicationCode", body)
        self.assertIn("CRED-0001", body)

    def test_export_requires_audit_capability(self):
        self.login(role="agent_terrain", sub="no-audit")
        res = self.client.get("/api/audit/export")
        self.assertEqual(res.status_code, 403)

    def test_export_read_only_no_write_verb(self):
        self.login(role="aud_fin", sub="auditor")
        res = self.client.post("/api/audit/export", {}, format="json")
        self.assertEqual(res.status_code, 405)

from __future__ import annotations

from common.testing import AuthedAPITestCase

from . import services
from .models import AuditEntry


class AuditServiceTests(AuthedAPITestCase):
    def test_record_creates_entry(self):
        entry = services.record(
            actor="u-1", action="agency.suspend", entity_type="Agency", entity_id="AG-01",
            details={"reason": "KYC"},
        )
        self.assertEqual(AuditEntry.objects.count(), 1)
        self.assertEqual(entry.entity_id, "AG-01")

    def test_entries_endpoint_requires_audit_capability(self):
        self.login(role="agent_terrain", sub="u-2")  # pas de capacité audit
        res = self.client.get("/api/audit/entries")
        self.assertEqual(res.status_code, 403)

    def test_entries_endpoint_visible_to_auditor(self):
        services.record(actor="u-3", action="x", entity_type="Y", entity_id="1")
        self.login(role="aud_fin", sub="u-4")  # capacité audit=True
        res = self.client.get("/api/audit/entries")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    def test_entries_filter_by_entity(self):
        services.record(actor="a", action="x", entity_type="Agency", entity_id="1")
        services.record(actor="a", action="x", entity_type="Loan", entity_id="2")
        self.login(role="dg", sub="u-5")
        res = self.client.get("/api/audit/entries?entity_type=Agency")
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["entityType"], "Agency")

    def test_entries_filter_by_financial_category_excludes_system_actions(self):
        services.record(actor="a", action="agency.suspend", entity_type="Agency", entity_id="1")
        services.record(actor="a", action="rbac.role.update", entity_type="RoleOverride", entity_id="2")
        services.record(actor="a", action="transaction.create", entity_type="Transaction", entity_id="3")
        services.record(actor="a", action="portfolio.subwallet.pay", entity_type="LoanTransaction", entity_id="4")
        self.login(role="dg", sub="u-6")
        res = self.client.get("/api/audit/entries?category=financial")
        actions = {r["action"] for r in res.data}
        self.assertEqual(actions, {"transaction.create", "portfolio.subwallet.pay"})

    def test_entries_resolve_actor_name_from_fintech_user(self):
        from accounts.models import FintechUser
        FintechUser.objects.create(sub="staff-1", full_name="Jean Mukendi", email="jean@agricap.local", role="dg")
        services.record(actor="staff-1", action="alert_rule.update", entity_type="AlertRule", entity_id="1")
        services.record(actor="ghost-sub", action="alert_rule.update", entity_type="AlertRule", entity_id="2")
        self.login(role="dg", sub="u-7")
        res = self.client.get("/api/audit/entries")
        by_actor = {r["user"]: r["userName"] for r in res.data}
        self.assertEqual(by_actor["staff-1"], "Jean Mukendi")
        # Acteur sans FintechUser correspondant (ex. sub périmé) -> repli sur le sub brut,
        # pas une erreur.
        self.assertEqual(by_actor["ghost-sub"], "ghost-sub")

    def test_entries_falls_back_to_email_when_full_name_blank(self):
        from accounts.models import FintechUser
        FintechUser.objects.create(sub="staff-2", full_name="", email="staff2@agricap.local", role="dg")
        services.record(actor="staff-2", action="x", entity_type="Y", entity_id="1")
        self.login(role="dg", sub="u-8")
        res = self.client.get("/api/audit/entries")
        row = next(r for r in res.data if r["user"] == "staff-2")
        self.assertEqual(row["userName"], "staff2@agricap.local")

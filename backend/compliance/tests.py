from __future__ import annotations

from accounts.models import FintechUser
from common.testing import AuthedAPITestCase

from . import kyc_levels
from .models import Document


class ComplianceTests(AuthedAPITestCase):
    def test_upload_and_list_own_documents(self):
        self.login(role="client", sub="d1")
        res = self.client.post("/api/compliance/documents/mine", {"type": "id_card", "name": "CNI"}, format="json")
        self.assertEqual(res.status_code, 201)
        listed = self.client.get("/api/compliance/documents/mine")
        self.assertEqual(len(listed.data), 1)

    def test_validate_kyc_requires_validate_capability(self):
        FintechUser.objects.create(sub="d2", role="invest")
        self.login(role="agri_op", sub="staff1")  # pas de capacité validate
        res = self.client.post("/api/compliance/kyc/d2/validate", {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_validate_kyc_with_capability(self):
        FintechUser.objects.create(sub="d3", role="invest")
        self.login(role="compliance", sub="staff2")  # capacité validate=True
        res = self.client.post("/api/compliance/kyc/d3/validate", {}, format="json")
        self.assertEqual(res.data["kycStatus"], "Validé")


class KycLevelTests(AuthedAPITestCase):
    def test_no_approved_documents_stays_t1(self):
        self.login(role="client", sub="k1")
        self.client.get("/api/rbac/me")
        user = FintechUser.objects.get(sub="k1")
        Document.objects.create(user=user, type=Document.Type.ID_CARD, name="CNI")  # pas encore approuvé

        profile = kyc_levels.sync_kyc_level(user=user)
        self.assertEqual(profile.kyc_level, "T1")
        self.assertEqual(profile.monthly_limit, kyc_levels.LEVEL_LIMITS["T1"])

    def test_approved_id_card_reaches_t2(self):
        self.login(role="client", sub="k2")
        self.client.get("/api/rbac/me")
        user = FintechUser.objects.get(sub="k2")
        Document.objects.create(user=user, type=Document.Type.ID_CARD, name="CNI", status="approved")

        profile = kyc_levels.sync_kyc_level(user=user)
        self.assertEqual(profile.kyc_level, "T2")
        self.assertEqual(profile.monthly_limit, kyc_levels.LEVEL_LIMITS["T2"])

    def test_approved_id_and_address_reaches_t3(self):
        self.login(role="client", sub="k3")
        self.client.get("/api/rbac/me")
        user = FintechUser.objects.get(sub="k3")
        Document.objects.create(user=user, type=Document.Type.ID_CARD, name="CNI", status="approved")
        Document.objects.create(user=user, type=Document.Type.PROOF_ADDRESS, name="Facture", status="approved")

        profile = kyc_levels.sync_kyc_level(user=user)
        self.assertEqual(profile.kyc_level, "T3")
        self.assertEqual(profile.monthly_limit, kyc_levels.LEVEL_LIMITS["T3"])

    def test_document_review_endpoint_upgrades_kyc_level(self):
        self.login(role="client", sub="k4")
        self.client.get("/api/rbac/me")
        user = FintechUser.objects.get(sub="k4")
        doc = Document.objects.create(user=user, type=Document.Type.ID_CARD, name="CNI")

        self.login(role="compliance", sub="reviewer1")
        res = self.client.post(f"/api/compliance/documents/{doc.pk}/review", {"status": "approved"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["kycLevel"], "T2")
        doc.refresh_from_db()
        self.assertEqual(doc.status, "approved")

    def test_document_review_requires_validate_capability(self):
        self.login(role="client", sub="k5")
        self.client.get("/api/rbac/me")
        user = FintechUser.objects.get(sub="k5")
        doc = Document.objects.create(user=user, type=Document.Type.ID_CARD, name="CNI")
        res = self.client.post(f"/api/compliance/documents/{doc.pk}/review", {"status": "approved"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_my_kyc_reports_level_and_limit(self):
        self.login(role="client", sub="k6")
        res = self.client.get("/api/compliance/kyc/mine")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["kycLevel"], "T1")
        self.assertEqual(res.data["monthlyLimit"], float(kyc_levels.LEVEL_LIMITS["T1"]))
        self.assertIn("USD", res.data["withdrawnThisMonth"])

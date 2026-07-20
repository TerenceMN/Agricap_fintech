from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from common.testing import AuthedAPITestCase

from . import services
from .models import ComplianceScoreSnapshot


class AnalyticsTests(AuthedAPITestCase):
    def test_overview_requires_read_capability(self):
        self.login(role="dg", sub="a1")
        res = self.client.get("/api/analytics/overview")
        self.assertEqual(res.status_code, 200)
        self.assertIn("activeAgencies", res.data)


class ComplianceScoreTests(AuthedAPITestCase):
    def test_ratio_components_are_none_without_data_but_alert_component_is_not(self):
        result = services.compute_compliance_score(persist=False)
        by_code = {c["code"]: c["score"] for c in result["components"]}
        # Les composantes en % d'un total (KYC/rapprochements/réseau) n'ont pas de sens sans
        # dénominateur -> None, pas 0 (0 laisserait croire à une conformité mauvaise plutôt
        # qu'absente). "Alertes critiques" reste calculable même à vide : 0 alerte = 100%,
        # une valeur légitime, pas une absence de donnée.
        self.assertIsNone(by_code["KYC_CLIENTS"])
        self.assertIsNone(by_code["RAPPRO_PONCTUALITE"])
        self.assertIsNone(by_code["RESEAU_ACTIF"])
        self.assertEqual(by_code["ALERTES_CRITIQUES"], 100.0)
        # Score global = seule composante disponible, renormalisée sur elle seule.
        self.assertEqual(result["score"], 100.0)

    def test_kyc_component_computed_from_real_profiles(self):
        from accounts.models import FintechUser
        from compliance.models import KycProfile
        FintechUser.objects.create(sub="u1", role="client")
        FintechUser.objects.create(sub="u2", role="client")
        KycProfile.objects.create(user_id="u1", kyc_status=KycProfile.Status.VALIDE)
        KycProfile.objects.create(user_id="u2", kyc_status=KycProfile.Status.EN_ATTENTE)
        result = services.compute_compliance_score(persist=False)
        kyc = next(c for c in result["components"] if c["code"] == "KYC_CLIENTS")
        self.assertEqual(kyc["score"], 50.0)
        self.assertIsNotNone(result["score"])  # au moins une composante dispo -> score global

    def test_reseau_actif_component_excludes_closed_agencies(self):
        from agencies import services as agency_services
        agency_services.create_agency(code="AG-CS-1", name="A1", by="u")
        a2 = agency_services.create_agency(code="AG-CS-2", name="A2", by="u")
        agency_services.suspend(agency=a2, reason="x", by="u")
        a3 = agency_services.create_agency(code="AG-CS-3", name="A3", by="u")
        agency_services.close(agency=a3, reason="x", by="u")
        result = services.compute_compliance_score(persist=False)
        reseau = next(c for c in result["components"] if c["code"] == "RESEAU_ACTIF")
        self.assertEqual(reseau["score"], 50.0)  # 1 ACTIF sur 2 (fermée exclue du dénominateur)

    def test_delta_wow_compares_against_week_old_snapshot(self):
        from accounts.models import FintechUser
        from compliance.models import KycProfile
        FintechUser.objects.create(sub="u1", role="client")
        KycProfile.objects.create(user_id="u1", kyc_status=KycProfile.Status.VALIDE)
        old = ComplianceScoreSnapshot.objects.create(global_score=80.0, components=[])
        ComplianceScoreSnapshot.objects.filter(pk=old.pk).update(
            computed_at=timezone.now() - timedelta(days=8),
        )
        result = services.compute_compliance_score(persist=False)
        self.assertEqual(result["deltaWow"], round(result["score"] - 80.0, 1))

    def test_endpoint_requires_read_capability(self):
        self.login(role="dg", sub="a2")
        res = self.client.get("/api/analytics/compliance-score")
        self.assertEqual(res.status_code, 200)
        self.assertIn("score", res.data)

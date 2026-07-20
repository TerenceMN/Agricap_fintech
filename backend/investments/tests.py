from __future__ import annotations

from decimal import Decimal

from common.exceptions import ConflictError, ValidationFailed
from common.idempotency import IdempotentReplay
from common.testing import AuthedAPITestCase

from . import services
from .models import (
    AnalystObservation, BondConversion, BondWithdrawal, Collateral, FinancialAnalysis, Investor,
    ObligationPosition, Offer, Project, ProjectQuestion, TechnicalAnalysis,
)


def _make_investable_project(code: str) -> Project:
    p = services.create_project(code=code, title="Projet Test", funding_target="5000", by="u")
    for target in ("P02", "P03", "P04", "P05", "P06"):
        p = services.transition_status(project=p, to_status=target, by="u")
    return p


class ProjectWorkflowTests(AuthedAPITestCase):
    def test_valid_transition(self):
        p = services.create_project(code="PRJ-1", title="Maïs Kongo", funding_target="10000", by="u")
        p = services.transition_status(project=p, to_status=Project.Status.P02, by="u")
        self.assertEqual(p.status, "P02")

    def test_invalid_transition_rejected(self):
        p = services.create_project(code="PRJ-2", title="Riz", funding_target="10000", by="u")
        with self.assertRaises(ValidationFailed):
            services.transition_status(project=p, to_status=Project.Status.P09, by="u")

    def test_duplicate_code_rejected(self):
        services.create_project(code="PRJ-DUP", title="A", funding_target="1", by="u")
        with self.assertRaises(ValidationFailed):
            services.create_project(code="PRJ-DUP", title="B", funding_target="1", by="u")


class SubscriptionTests(AuthedAPITestCase):
    def setUp(self):
        self.project = _make_investable_project("PRJ-3")
        self.offer = services.create_offer(
            project=self.project, code="OFR-1", coupon_rate="9.0", maturity_months=24,
            min_ticket="100", available_bonds=10, funding_goal="1000", by="u",
        )
        from accounts.models import FintechUser
        self.user = FintechUser.objects.create(sub="inv-1", email="i@test.local", role="invest")
        self.investor = Investor.objects.create(user=self.user)

    def test_subscribe_within_bounds(self):
        sub = services.subscribe(investor=self.investor, offer_id=self.offer.pk, bonds=3,
                                  idempotency_key="s1", by="inv-1")
        self.offer.refresh_from_db()
        self.assertEqual(self.offer.available_bonds, 7)
        self.assertEqual(sub.amount, Decimal("300.00"))

    def test_subscribe_exceeding_available_bonds_rejected(self):
        with self.assertRaises(ValidationFailed):
            services.subscribe(investor=self.investor, offer_id=self.offer.pk, bonds=99,
                                idempotency_key="s2", by="inv-1")
        self.offer.refresh_from_db()
        self.assertEqual(self.offer.available_bonds, 10)  # inchangé (all-or-nothing)

    def test_subscribe_when_project_not_investable(self):
        services.transition_status(project=self.project, to_status="P07", by="u")
        with self.assertRaises(ConflictError):
            services.subscribe(investor=self.investor, offer_id=self.offer.pk, bonds=1,
                                idempotency_key="s3", by="inv-1")

    def test_subscribe_idempotent_replay_no_double_decrement(self):
        services.subscribe(investor=self.investor, offer_id=self.offer.pk, bonds=2,
                            idempotency_key="same", by="inv-1")
        with self.assertRaises(IdempotentReplay):
            services.subscribe(investor=self.investor, offer_id=self.offer.pk, bonds=2,
                                idempotency_key="same", by="inv-1")
        self.offer.refresh_from_db()
        self.assertEqual(self.offer.available_bonds, 8)


class PerformanceReportTests(AuthedAPITestCase):
    def test_large_deviation_flags_observation(self):
        project = services.create_project(code="PRJ-4", title="Test", funding_target="1000", by="u")
        services.submit_performance_report(
            project=project, data={"actualRevenue": 500, "forecastRevenue": 1000}, by="u",
        )
        self.assertTrue(AnalystObservation.objects.filter(project=project, risk_flag="HIGH").exists())

    def test_small_deviation_does_not_flag(self):
        project = services.create_project(code="PRJ-5", title="Test", funding_target="1000", by="u")
        services.submit_performance_report(
            project=project, data={"actualRevenue": 980, "forecastRevenue": 1000}, by="u",
        )
        self.assertFalse(AnalystObservation.objects.filter(project=project).exists())


class InvestorActionTests(AuthedAPITestCase):
    def setUp(self):
        from accounts.models import FintechUser
        self.user = FintechUser.objects.create(sub="inv-action-1", email="ia@test.local", role="invest")
        self.investor = Investor.objects.create(user=self.user)

    def test_suspend_then_activate(self):
        self.investor = services.investor_action(investor=self.investor, action="suspend", by="u")
        self.assertEqual(self.investor.status, "SUSPENDED")
        self.investor = services.investor_action(investor=self.investor, action="activate", by="u")
        self.assertEqual(self.investor.status, "ACTIVE")

    def test_unknown_action_rejected(self):
        with self.assertRaises(ValidationFailed):
            services.investor_action(investor=self.investor, action="delete", by="u")

    def test_action_via_api_requires_validate_capability(self):
        self.login(role="gest_port", sub="mgr-1")
        res = self.client.post(f"/api/investments/investors/{self.investor.pk}/action",
                                {"action": "suspend"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "SUSPENDED")

    def test_action_via_api_forbidden_without_capability(self):
        self.login(role="agri_op", sub="client-y")
        res = self.client.post(f"/api/investments/investors/{self.investor.pk}/action",
                                {"action": "suspend"}, format="json")
        self.assertEqual(res.status_code, 403)


class InvestmentsApiTests(AuthedAPITestCase):
    def test_subscribe_via_api_requires_idempotency_key(self):
        project = _make_investable_project("PRJ-6")
        offer = services.create_offer(project=project, code="OFR-2", coupon_rate="9", maturity_months=24,
                                       min_ticket="100", available_bonds=5, by="u")
        self.login(role="invest", sub="inv-2")
        res = self.client.post("/api/investments/subscriptions", {"offerId": offer.pk, "bonds": 1}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_create_project_requires_create_capability(self):
        self.login(role="agri_op", sub="client-x")  # pas de capacité create
        res = self.client.post("/api/investments/projects", {"code": "PRJ-7", "title": "X"}, format="json")
        self.assertEqual(res.status_code, 403)


class ProjectAnalysisApiTests(AuthedAPITestCase):
    def setUp(self):
        self.project = services.create_project(code="PRJ-8", title="Manioc", funding_target="1000", by="u")
        self.offer = services.create_offer(project=self.project, code="OFR-8", coupon_rate="9", maturity_months=24,
                                            min_ticket="100", available_bonds=5, by="u")
        self.login(role="invest", sub="inv-8")

    def test_technical_analysis_404_when_absent(self):
        res = self.client.get(f"/api/investments/projects/{self.project.code}/technical-analysis")
        self.assertEqual(res.status_code, 404)

    def test_technical_analysis_returned_when_present(self):
        TechnicalAnalysis.objects.create(project=self.project, land_size=12.5, yield_forecast=3.2)
        res = self.client.get(f"/api/investments/projects/{self.project.code}/technical-analysis")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["landSize"], 12.5)

    def test_financial_analysis_returned_when_present(self):
        FinancialAnalysis.objects.create(project=self.project, irr=14.2)
        res = self.client.get(f"/api/investments/projects/{self.project.code}/financial-analysis")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["irr"], 14.2)

    def test_collateral_returned_when_present(self):
        Collateral.objects.create(offer=self.offer, debt_type="Obligation garantie",
                                   collateral_value="5000", loan_to_value="0.6")
        res = self.client.get(f"/api/investments/offers/{self.offer.pk}/collateral")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["debtType"], "Obligation garantie")

    def test_collateral_404_when_absent(self):
        res = self.client.get(f"/api/investments/offers/{self.offer.pk}/collateral")
        self.assertEqual(res.status_code, 404)


class QuestionsAndReportsApiTests(AuthedAPITestCase):
    def test_questions_filtered_by_project(self):
        project_a = services.create_project(code="PRJ-9A", title="A", funding_target="1", by="u")
        project_b = services.create_project(code="PRJ-9B", title="B", funding_target="1", by="u")
        from accounts.models import FintechUser
        user = FintechUser.objects.create(sub="inv-9", email="q@test.local", role="invest")
        investor = Investor.objects.create(user=user)
        ProjectQuestion.objects.create(project=project_a, investor=investor, question="Q sur A")
        ProjectQuestion.objects.create(project=project_b, investor=investor, question="Q sur B")
        self.login(role="invest", sub="inv-9")
        res = self.client.get(f"/api/investments/questions?project={project_a.code}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["question"], "Q sur A")

    def test_performance_report_row_includes_full_detail(self):
        project = services.create_project(code="PRJ-10", title="C", funding_target="1", by="u")
        services.submit_performance_report(
            project=project, data={"actualRevenue": 900, "forecastRevenue": 1000, "reportingPeriod": "T1-2026"},
            by="u",
        )
        self.login(role="invest", sub="inv-10")
        res = self.client.get(f"/api/investments/performance-reports?project={project.code}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data[0]["reportingPeriod"], "T1-2026")
        self.assertEqual(res.data[0]["actualRevenue"], 900)
        self.assertIn("validationDate", res.data[0])


class ObligationApiTests(AuthedAPITestCase):
    def setUp(self):
        from accounts.models import FintechUser
        self.user = FintechUser.objects.create(sub="inv-11", email="ob@test.local", role="invest")
        self.investor = Investor.objects.create(user=self.user)
        self.login(role="invest", sub="inv-11")

    def test_subscribe_then_list(self):
        res = self.client.post("/api/investments/obligations", {"name": "Plan A", "investedAmount": "1000"},
                                format="json")
        self.assertEqual(res.status_code, 201)
        listed = self.client.get("/api/investments/obligations")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.data), 1)
        self.assertEqual(listed.data[0]["investedAmount"], 1000.0)
        self.assertIn("dateCreated", listed.data[0])

    def test_withdrawals_and_conversions_listed(self):
        position = ObligationPosition.objects.create(investor=self.investor, invested_amount="1000")
        BondWithdrawal.objects.create(position=position, amount="200", reason="Test")
        BondConversion.objects.create(position=position, coupons=4, value="1188", shares=11)
        withdrawals = self.client.get(f"/api/investments/obligations/{position.pk}/withdrawals")
        conversions = self.client.get(f"/api/investments/obligations/{position.pk}/conversions")
        self.assertEqual(withdrawals.status_code, 200)
        self.assertEqual(len(withdrawals.data), 1)
        self.assertEqual(conversions.status_code, 200)
        self.assertEqual(conversions.data[0]["shares"], 11)

    def test_cannot_list_other_investors_withdrawals(self):
        from accounts.models import FintechUser
        other_user = FintechUser.objects.create(sub="inv-12", email="ob2@test.local", role="invest")
        other_investor = Investor.objects.create(user=other_user)
        position = ObligationPosition.objects.create(investor=other_investor, invested_amount="500")
        res = self.client.get(f"/api/investments/obligations/{position.pk}/withdrawals")
        self.assertEqual(res.status_code, 404)

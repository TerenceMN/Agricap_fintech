from __future__ import annotations

from decimal import Decimal

from common.testing import AuthedAPITestCase

from .models import SavingsDeposit, SavingsGroup, SavingsPlan


class SavingsTests(AuthedAPITestCase):
    def test_create_and_list_own_plan(self):
        self.login(role="client", sub="c1")
        res = self.client.post("/api/savings/plans/mine", {"name": "Campagne maïs", "objectif": "1000"},
                                format="json")
        self.assertEqual(res.status_code, 201)
        res = self.client.get("/api/savings/plans/mine")
        self.assertEqual(len(res.data), 1)

    def test_deposit_increases_balance(self):
        self.login(role="client", sub="c2")
        create = self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json")
        plan_id = create.data["id"]
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit", {"amount": "50"}, format="json")
        self.assertEqual(res.data["balance"], 50.0)

    def _plan(self, sub: str) -> int:
        self.login(role="client", sub=sub)
        return self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json").data["id"]

    def test_deposit_refuses_non_positive_or_unreadable_amount(self):
        """`to_decimal` est tolérant : sans ce contrôle, `-500` DÉBITAIT le plan
        (un retrait déguisé en dépôt) et `"abc"` enregistrait un dépôt de 0."""
        plan_id = self._plan("c-neg")
        for amount in ("-500", "0", "abc", ""):
            res = self.client.post(f"/api/savings/plans/{plan_id}/deposit",
                                    {"amount": amount}, format="json")
            self.assertEqual(res.status_code, 422, amount)
            self.assertEqual(res.data["errors"][0]["code"], "AMOUNT_INVALID")
        listing = self.client.get("/api/savings/plans/mine")
        self.assertEqual(listing.data[0]["balance"], 0.0)

    def test_deposit_refuses_unknown_channel(self):
        plan_id = self._plan("c-chan")
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit",
                                {"amount": "10", "channel": "crypto"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["errors"][0]["code"], "CHANNEL_UNKNOWN")

    def test_deposit_refuses_closed_plan(self):
        plan_id = self._plan("c-closed")
        SavingsPlan.objects.filter(pk=plan_id).update(status=SavingsPlan.Status.CLOTURE)
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit", {"amount": "10"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["errors"][0]["code"], "PLAN_CLOSED")

    def test_deposit_collects_all_causes(self):
        """Un 422 porte TOUTES les causes de l'étape, pas seulement la première :
        l'écran les déplie une par une (principe 5)."""
        plan_id = self._plan("c-multi")
        SavingsPlan.objects.filter(pk=plan_id).update(status=SavingsPlan.Status.CLOTURE)
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit",
                                {"amount": "-1", "channel": "crypto"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(
            [e["code"] for e in res.data["errors"]],
            ["AMOUNT_INVALID", "CHANNEL_UNKNOWN", "PLAN_CLOSED"],
        )

    def test_deposit_is_quantized_to_two_decimals(self):
        plan_id = self._plan("c-round")
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit",
                                {"amount": "10.005"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(SavingsDeposit.objects.get(plan_id=plan_id).amount, Decimal("10.01"))

    def test_deposit_on_someone_else_plan_is_not_found(self):
        plan_id = self._plan("c-owner")
        self.login(role="client", sub="c-intrus")
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit", {"amount": "10"}, format="json")
        self.assertEqual(res.status_code, 404)

    def test_group_creation_requires_create_capability(self):
        self.login(role="agri_op", sub="c3")  # pas de capacité create
        res = self.client.post("/api/savings/groups", {"name": "AVEC Test"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_group_integration_request_and_approval(self):
        self.login(role="gest_zone", sub="admin1")  # create=True, validate=True
        group_res = self.client.post("/api/savings/groups", {"name": "AVEC 1"}, format="json")
        group_id = group_res.data["id"]
        self.login(role="client", sub="member1")
        req = self.client.post(f"/api/savings/groups/{group_id}/requests/join", {"reason": "x"}, format="json")
        self.assertEqual(req.status_code, 201)
        self.login(role="gest_zone", sub="admin1")
        decide = self.client.post(f"/api/savings/groups/requests/{req.data['id']}/decide",
                                   {"decision": "approved"}, format="json")
        self.assertEqual(decide.data["status"], "approved")
        self.assertEqual(SavingsGroup.objects.get(pk=group_id).members.count(), 1)

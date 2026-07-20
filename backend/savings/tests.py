from __future__ import annotations

from common.testing import AuthedAPITestCase

from .models import SavingsGroup


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

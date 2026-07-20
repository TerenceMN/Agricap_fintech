from __future__ import annotations

from common.testing import AuthedAPITestCase

from .models import Loan


class ClientCreditApplicationTests(AuthedAPITestCase):
    def _submit(self, **overrides):
        payload = {
            "demandeur": "Coopérative KIVU AGRI", "culture": "Café", "montant": "10000",
            "currency": "USD",
            "modules": {
                "semences": {"label": "Semences & Intrants", "cost": 5000, "financing": 100, "active": True},
                "mecanisation": {"label": "Opérations mécanisées", "cost": 3000, "financing": 100, "active": True},
                "reserve": {"label": "Réserve d'exploitation", "cost": 2000, "financing": 100, "active": False},
            },
            "guarantees": [{"type": "morale", "label": "Garantie Solidaire"}],
        }
        payload.update(overrides)
        return self.client.post("/api/portfolio/mine", payload, format="json")

    def test_submit_creates_loan_with_subwallets_from_active_modules_only(self):
        self.login(role="client", sub="c1")
        res = self._submit()
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["amountApproved"], 8000.0)  # semences + mecanisation, reserve inactive
        self.assertEqual(len(res.data["subwallets"]), 2)
        self.assertEqual(len(res.data["guarantees"]), 1)

    def test_mine_lists_only_own_loans(self):
        self.login(role="client", sub="c2")
        self._submit()
        self.login(role="client", sub="c3")
        self._submit(demandeur="Autre Coopérative")
        res = self.client.get("/api/portfolio/mine")
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["operator"], "Autre Coopérative")

    def test_client_cannot_access_another_clients_loan_detail(self):
        self.login(role="client", sub="c4")
        created = self._submit()
        ref = created.data["id"]
        self.login(role="client", sub="c5")
        res = self.client.get(f"/api/portfolio/mine/{ref}")
        self.assertEqual(res.status_code, 404)


class SubwalletPaymentAndRebalanceTests(AuthedAPITestCase):
    def _submit_and_get_subwallets(self, sub):
        self.login(role="client", sub=sub)
        created = self.client.post("/api/portfolio/mine", {
            "demandeur": "Coop Test", "culture": "Maïs", "montant": "6000", "currency": "USD",
            "modules": {
                "semences": {"label": "Semences", "cost": 3000, "financing": 100, "active": True},
                "mecanisation": {"label": "Mécanisation", "cost": 3000, "financing": 100, "active": True},
            },
            "guarantees": [],
        }, format="json")
        ref = created.data["id"]
        subwallets = {sw["moduleKey"]: sw for sw in created.data["subwallets"]}
        return ref, subwallets

    def test_pay_debits_subwallet_and_records_transaction(self):
        ref, subwallets = self._submit_and_get_subwallets("p1")
        res = self.client.post(f"/api/portfolio/mine/{ref}/pay", {
            "subwalletId": subwallets["semences"]["id"], "amount": "1000",
            "beneficiary": "Agro-Dépôt SARL", "description": "Achat semences maïs",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        updated = {sw["moduleKey"]: sw for sw in res.data["subwallets"]}
        self.assertEqual(updated["semences"]["balance"], 2000.0)
        self.assertEqual(len(res.data["transactions"]), 1)

    def test_pay_rejects_amount_exceeding_balance(self):
        ref, subwallets = self._submit_and_get_subwallets("p2")
        res = self.client.post(f"/api/portfolio/mine/{ref}/pay", {
            "subwalletId": subwallets["semences"]["id"], "amount": "999999", "beneficiary": "X",
        }, format="json")
        self.assertEqual(res.status_code, 409)

    def test_rebalance_moves_allocation_between_modules(self):
        ref, subwallets = self._submit_and_get_subwallets("p3")
        res = self.client.post(f"/api/portfolio/mine/{ref}/rebalance", {
            "fromId": subwallets["mecanisation"]["id"], "toId": subwallets["semences"]["id"], "amount": "500",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        updated = {sw["moduleKey"]: sw for sw in res.data["subwallets"]}
        self.assertEqual(updated["mecanisation"]["balance"], 2500.0)
        self.assertEqual(updated["semences"]["balance"], 3500.0)

    def test_rebalance_rejects_insufficient_source_balance(self):
        ref, subwallets = self._submit_and_get_subwallets("p4")
        res = self.client.post(f"/api/portfolio/mine/{ref}/rebalance", {
            "fromId": subwallets["semences"]["id"], "toId": subwallets["mecanisation"]["id"], "amount": "999999",
        }, format="json")
        self.assertEqual(res.status_code, 409)

    def test_pay_and_rebalance_require_authentication(self):
        res = self.client.get("/api/portfolio/mine")
        self.assertEqual(res.status_code, 401)

from __future__ import annotations

from decimal import Decimal

from common.testing import AuthedAPITestCase

from .models import SavingsDeposit, SavingsGroup, SavingsPlan


def _fund_wallet(sub: str, amount: str = "1000", currency: str = "USD"):
    """Alimente le portefeuille du client — le cash qu'un dépôt d'épargne déplacera vers
    le plan. Le `FintechUser` existe dès la première requête authentifiée (création du
    plan)."""
    from accounts.models import FintechUser
    from caisses.models import ClientWallet

    user = FintechUser.objects.get(sub=sub)
    wallet, _ = ClientWallet.objects.get_or_create(user=user, currency=currency)
    ClientWallet.objects.filter(pk=wallet.pk).update(balance=Decimal(amount))
    wallet.refresh_from_db()
    return wallet


def _wallet_balance(sub: str, currency: str = "USD") -> Decimal:
    from caisses.models import ClientWallet

    wallet = ClientWallet.objects.filter(user_id=sub, currency=currency).first()
    return Decimal(wallet.balance) if wallet else Decimal("0")


class SavingsTests(AuthedAPITestCase):
    def test_create_and_list_own_plan(self):
        self.login(role="client", sub="c1")
        res = self.client.post("/api/savings/plans/mine", {"name": "Campagne maïs", "objectif": "1000"},
                                format="json")
        self.assertEqual(res.status_code, 201)
        res = self.client.get("/api/savings/plans/mine")
        self.assertEqual(len(res.data), 1)

    def test_deposit_increases_balance(self):
        """Le dépôt crédite le plan — en débitant le portefeuille du client (flux interne)."""
        self.login(role="client", sub="c2")
        create = self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json")
        plan_id = create.data["id"]
        _fund_wallet("c2", "1000")
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit", {"amount": "50"}, format="json")
        self.assertEqual(res.data["balance"], 50.0)

    def test_deposit_debits_wallet_by_same_amount(self):
        """Invariant « une seule porte » : le cash quitte RÉELLEMENT le portefeuille, du
        même montant que ce qui est inscrit au plan — jamais d'argent créé de rien."""
        from caisses.models import WalletMovement

        self.login(role="client", sub="c-debit")
        plan_id = self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json").data["id"]
        _fund_wallet("c-debit", "1000")
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit", {"amount": "120.50"},
                                format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["balance"], 120.5)
        # Le portefeuille a été débité du même montant.
        self.assertEqual(_wallet_balance("c-debit"), Decimal("879.50"))
        movement = WalletMovement.objects.get(wallet__user_id="c-debit")
        self.assertEqual(movement.kind, WalletMovement.Kind.WITHDRAW)
        self.assertEqual(movement.amount, Decimal("120.50"))

    def test_deposit_conserves_money_wallet_plus_plan(self):
        """wallet_avant == wallet_après + solde_plan : le dépôt déplace, il ne crée pas."""
        self.login(role="client", sub="c-conserve")
        plan_id = self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json").data["id"]
        _fund_wallet("c-conserve", "500")
        self.client.post(f"/api/savings/plans/{plan_id}/deposit", {"amount": "200"}, format="json")
        plan = self.client.get("/api/savings/plans/mine").data[0]
        self.assertEqual(_wallet_balance("c-conserve") + Decimal(str(plan["balance"])), Decimal("500"))

    def test_deposit_refused_when_wallet_insufficient_no_partial(self):
        """Solde insuffisant → 422 structuré, aucune inscription partielle : ni dépôt, ni
        crédit du plan, et le portefeuille reste intact."""
        self.login(role="client", sub="c-poor")
        plan_id = self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json").data["id"]
        _fund_wallet("c-poor", "30")
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit", {"amount": "50"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["errors"][0]["code"], "WALLET_INSUFFICIENT_FUNDS")
        self.assertEqual(SavingsDeposit.objects.filter(plan_id=plan_id).count(), 0)
        self.assertEqual(self.client.get("/api/savings/plans/mine").data[0]["balance"], 0.0)
        self.assertEqual(_wallet_balance("c-poor"), Decimal("30"))

    def test_deposit_refused_when_no_wallet(self):
        """Sans portefeuille dans la devise du plan, il n'y a pas de cash à déplacer."""
        self.login(role="client", sub="c-nowallet")
        plan_id = self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json").data["id"]
        res = self.client.post(f"/api/savings/plans/{plan_id}/deposit", {"amount": "10"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["errors"][0]["code"], "WALLET_MISSING")
        self.assertEqual(SavingsDeposit.objects.filter(plan_id=plan_id).count(), 0)

    def test_deposit_idempotent_replay_does_not_double_debit(self):
        """Même clé d'idempotence rejouée : un seul dépôt, un seul débit."""
        self.login(role="client", sub="c-idem")
        plan_id = self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json").data["id"]
        _fund_wallet("c-idem", "1000")
        body = {"amount": "75", "idempotencyKey": "dep-1"}
        first = self.client.post(f"/api/savings/plans/{plan_id}/deposit", body, format="json")
        second = self.client.post(f"/api/savings/plans/{plan_id}/deposit", body, format="json")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(SavingsDeposit.objects.filter(plan_id=plan_id).count(), 1)
        self.assertEqual(_wallet_balance("c-idem"), Decimal("925"))
        self.assertEqual(second.data["balance"], 75.0)

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
        _fund_wallet("c-round", "1000")
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

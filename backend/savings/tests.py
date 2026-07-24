from __future__ import annotations

from decimal import Decimal

from common.testing import AuthedAPITestCase

from .models import (
    SavingsAdjustment, SavingsDeposit, SavingsGroup, SavingsGroupMember, SavingsPlan,
    SavingsRateChange,
)


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


class SavingsRateConfigTests(AuthedAPITestCase):
    """GAP Critique : la config de taux vivait en `localStorage` et le taux mensuel était
    calculé côté client (`val/12`). Ces tests verrouillent le calcul serveur, la
    persistance atomique, l'append-only et l'audit."""

    def _client_plan(self, sub: str = "rc-owner") -> int:
        self.login(role="client", sub=sub)
        return self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json").data["id"]

    def test_rate_config_get_defaults(self):
        plan_id = self._client_plan()
        self.login(role="dg", sub="dg1")
        res = self.client.get(f"/api/savings/plans/{plan_id}/rate-config")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["annualRate"], 4.5)
        self.assertEqual(res.data["monthlyRate"], 0.375)
        self.assertEqual(res.data["status"], "actif")
        self.assertEqual(res.data["history"], [])

    def test_rate_update_computes_monthly_server_side(self):
        """Le taux mensuel n'est PAS lu du corps : il est recalculé (annuel/12)."""
        plan_id = self._client_plan()
        self.login(role="dg", sub="dg1")
        # Le client tenterait d'imposer un monthlyRate fantaisiste — il est ignoré.
        res = self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                                {"action": "rate_update", "annualRate": "3.6",
                                 "monthlyRate": "99"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["annualRate"], 3.6)
        self.assertEqual(res.data["monthlyRate"], 0.3)
        plan = SavingsPlan.objects.get(pk=plan_id)
        self.assertEqual(plan.interest_rate, Decimal("3.600"))
        self.assertEqual(plan.monthly_rate, Decimal("0.3000"))
        self.assertEqual(len(res.data["history"]), 1)

    def test_rate_above_max_is_rejected(self):
        plan_id = self._client_plan()
        self.login(role="dg", sub="dg1")
        res = self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                                {"action": "rate_update", "annualRate": "7"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["errors"][0]["code"], "RATE_ABOVE_MAX")
        self.assertEqual(SavingsRateChange.objects.filter(plan_id=plan_id).count(), 0)

    def test_rate_negative_is_rejected(self):
        plan_id = self._client_plan()
        self.login(role="dg", sub="dg1")
        res = self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                                {"action": "rate_update", "annualRate": "-2"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["errors"][0]["code"], "RATE_NEGATIVE")

    def test_block_zeroes_rate_and_sets_status(self):
        plan_id = self._client_plan()
        self.login(role="dg", sub="dg1")
        res = self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                                {"action": "block"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["annualRate"], 0.0)
        self.assertEqual(res.data["monthlyRate"], 0.0)
        self.assertEqual(res.data["status"], "bloque")

    def test_suspend_then_resume_keeps_rate(self):
        plan_id = self._client_plan()
        self.login(role="dg", sub="dg1")
        self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                         {"action": "rate_update", "annualRate": "4.8"}, format="json")
        suspend = self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                                    {"action": "suspend"}, format="json")
        self.assertEqual(suspend.data["status"], "suspendu")
        self.assertEqual(suspend.data["annualRate"], 4.8)
        resume = self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                                   {"action": "resume"}, format="json")
        self.assertEqual(resume.data["status"], "actif")
        self.assertEqual(resume.data["annualRate"], 4.8)

    def test_rate_changes_are_append_only(self):
        """Chaque changement ajoute une ligne d'historique — jamais d'UPDATE/DELETE (P3)."""
        plan_id = self._client_plan()
        self.login(role="dg", sub="dg1")
        self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                         {"action": "rate_update", "annualRate": "3.0"}, format="json")
        res = self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                               {"action": "rate_update", "annualRate": "5.0"}, format="json")
        self.assertEqual(SavingsRateChange.objects.filter(plan_id=plan_id).count(), 2)
        # Historique renvoyé le plus récent d'abord.
        self.assertEqual(res.data["history"][0]["annualRate"], 5.0)
        self.assertEqual(res.data["history"][1]["annualRate"], 3.0)

    def test_rate_config_requires_config_capability(self):
        plan_id = self._client_plan()
        self.login(role="client", sub="rc-nope")  # pas de capacité config
        res = self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                               {"action": "rate_update", "annualRate": "3"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_rate_change_is_audited(self):
        from audit.models import AuditEntry

        plan_id = self._client_plan()
        self.login(role="dg", sub="dg1")
        self.client.post(f"/api/savings/plans/{plan_id}/rate-config",
                         {"action": "rate_update", "annualRate": "3.6", "reason": "revue"},
                         format="json")
        entry = AuditEntry.objects.filter(action="savings.plan.rate_change",
                                          entity_id=str(plan_id)).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.details["monthlyRate"], "0.3000")
        self.assertEqual(entry.actor, "dg1")


class SavingsAdjustmentTests(AuthedAPITestCase):
    def _client_plan(self, sub: str = "adj-owner") -> int:
        self.login(role="client", sub=sub)
        return self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json").data["id"]

    def test_adjustment_persists_and_returns_server_metrics(self):
        plan_id = self._client_plan()
        self.login(role="dg", sub="dg1")
        res = self.client.post(f"/api/savings/plans/{plan_id}/adjustment",
                               {"targetAmount": "1000", "periodicDeposit": "100",
                                "frequency": "mensuel", "depositMode": "agent"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["metrics"]["remaining"], 1000.0)
        self.assertEqual(res.data["metrics"]["depositsNeeded"], 10)
        self.assertEqual(len(res.data["metrics"]["projection"]), 10)
        plan = SavingsPlan.objects.get(pk=plan_id)
        self.assertEqual(plan.objectif, Decimal("1000.00"))
        self.assertEqual(plan.periodic_deposit, Decimal("100.00"))

    def test_adjustment_never_touches_balance(self):
        """Conservation de la monnaie : l'ajustement configure, il ne crédite pas."""
        plan_id = self._client_plan("adj-bal")
        SavingsPlan.objects.filter(pk=plan_id).update(balance=Decimal("250"))
        self.login(role="dg", sub="dg1")
        self.client.post(f"/api/savings/plans/{plan_id}/adjustment",
                         {"targetAmount": "5000", "periodicDeposit": "50"}, format="json")
        self.assertEqual(SavingsPlan.objects.get(pk=plan_id).balance, Decimal("250"))

    def test_adjustment_deposits_needed_null_without_periodic(self):
        plan_id = self._client_plan("adj-noperiodic")
        self.login(role="dg", sub="dg1")
        res = self.client.post(f"/api/savings/plans/{plan_id}/adjustment",
                               {"targetAmount": "1000", "periodicDeposit": "0"}, format="json")
        self.assertIsNone(res.data["metrics"]["depositsNeeded"])
        self.assertEqual(res.data["metrics"]["projection"], [])

    def test_adjustment_rejects_unknown_frequency(self):
        plan_id = self._client_plan("adj-freq")
        self.login(role="dg", sub="dg1")
        res = self.client.post(f"/api/savings/plans/{plan_id}/adjustment",
                               {"targetAmount": "100", "frequency": "lunaire"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["errors"][0]["code"], "FREQUENCY_UNKNOWN")

    def test_adjustment_is_append_only(self):
        plan_id = self._client_plan("adj-append")
        self.login(role="dg", sub="dg1")
        self.client.post(f"/api/savings/plans/{plan_id}/adjustment",
                         {"targetAmount": "100", "periodicDeposit": "10"}, format="json")
        self.client.post(f"/api/savings/plans/{plan_id}/adjustment",
                         {"targetAmount": "200", "periodicDeposit": "20"}, format="json")
        self.assertEqual(SavingsAdjustment.objects.filter(plan_id=plan_id).count(), 2)


class SavingsGroupAssignTests(AuthedAPITestCase):
    def _make_group(self, name: str = "AVEC 1") -> int:
        self.login(role="gest_zone", sub="gz1")  # create + cooperatives
        return self.client.post("/api/savings/groups", {"name": name}, format="json").data["id"]

    def _ensure_user(self, sub: str):
        """Fait exister le FintechUser en l'authentifiant une fois."""
        self.login(role="client", sub=sub)
        self.client.get("/api/savings/plans/mine")

    def test_assign_creates_membership_and_audit(self):
        from audit.models import AuditEntry

        group_id = self._make_group()
        self._ensure_user("member-a")
        self.login(role="gest_zone", sub="gz1")
        res = self.client.post("/api/savings/groups/assign",
                               {"userSub": "member-a", "groupId": group_id}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(SavingsGroupMember.objects.filter(group_id=group_id, user_id="member-a").exists())
        self.assertTrue(AuditEntry.objects.filter(action="savings.group.assign_member",
                                                  entity_id=str(group_id)).exists())

    def test_reassign_is_exclusive(self):
        group_a = self._make_group("A")
        group_b = self._make_group("B")
        self._ensure_user("member-x")
        self.login(role="gest_zone", sub="gz1")
        self.client.post("/api/savings/groups/assign",
                         {"userSub": "member-x", "groupId": group_a}, format="json")
        self.client.post("/api/savings/groups/assign",
                         {"userSub": "member-x", "groupId": group_b}, format="json")
        self.assertFalse(SavingsGroupMember.objects.filter(group_id=group_a, user_id="member-x").exists())
        self.assertTrue(SavingsGroupMember.objects.filter(group_id=group_b, user_id="member-x").exists())

    def test_unassign_removes_membership(self):
        group_id = self._make_group()
        self._ensure_user("member-y")
        self.login(role="gest_zone", sub="gz1")
        self.client.post("/api/savings/groups/assign",
                         {"userSub": "member-y", "groupId": group_id}, format="json")
        res = self.client.post("/api/savings/groups/assign",
                               {"userSub": "member-y", "groupId": "none"}, format="json")
        self.assertIsNone(res.data["groupId"])
        self.assertFalse(SavingsGroupMember.objects.filter(user_id="member-y").exists())

    def test_assign_requires_cooperatives_capability(self):
        group_id = self._make_group()
        self._ensure_user("member-z")
        self.login(role="client", sub="member-z")  # pas de capacité cooperatives
        res = self.client.post("/api/savings/groups/assign",
                               {"userSub": "member-z", "groupId": group_id}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_assign_unknown_user_is_404(self):
        group_id = self._make_group()
        self.login(role="gest_zone", sub="gz1")
        res = self.client.post("/api/savings/groups/assign",
                               {"userSub": "ghost", "groupId": group_id}, format="json")
        self.assertEqual(res.status_code, 404)


class SavingsGroupDetailTests(AuthedAPITestCase):
    def test_group_detail_includes_member_history_and_requests(self):
        self.login(role="gest_zone", sub="gz1")
        group_id = self.client.post("/api/savings/groups", {"name": "Coop"}, format="json").data["id"]
        # Un membre affecté + une demande d'intégration en attente.
        self.login(role="client", sub="m1")
        self.client.get("/api/savings/plans/mine")
        self.client.post(f"/api/savings/groups/{group_id}/requests/join", {"reason": "x"}, format="json")
        self.login(role="gest_zone", sub="gz1")
        self.client.post("/api/savings/groups/assign",
                         {"userSub": "m1", "groupId": group_id}, format="json")
        res = self.client.get(f"/api/savings/groups/{group_id}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["memberHistory"]), 1)
        self.assertEqual(res.data["memberHistory"][0]["sub"], "m1")
        self.assertIsNone(res.data["memberHistory"][0]["contribution"])
        self.assertEqual(len(res.data["requests"]), 1)
        self.assertFalse(res.data["contributionsTracked"])

    def test_all_plans_includes_holder_sub_and_groups(self):
        self.login(role="client", sub="holder-1")
        self.client.post("/api/savings/plans/mine", {"name": "Plan"}, format="json")
        self.login(role="gest_zone", sub="gz1")
        group_id = self.client.post("/api/savings/groups", {"name": "G"}, format="json").data["id"]
        self.client.post("/api/savings/groups/assign",
                         {"userSub": "holder-1", "groupId": group_id}, format="json")
        rows = self.client.get("/api/savings/plans").data
        row = next(r for r in rows if r["holderSub"] == "holder-1")
        self.assertEqual(row["holderGroups"], ["G"])

    def test_group_audit_returns_entries(self):
        self.login(role="gest_zone", sub="gz1")
        group_id = self.client.post("/api/savings/groups", {"name": "GA"}, format="json").data["id"]
        res = self.client.get(f"/api/savings/groups/{group_id}/audit")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(any(e["action"] == "savings.group.create" for e in res.data))


class CloisonnementEpargneTests(AuthedAPITestCase):
    """Ce qui appartient au membre, ce qui appartient à l'institution.

    Le module épargne mélangeait les deux derrière un même `HasCapability("read")` : le
    catalogue des groupes (que le membre doit voir pour en rejoindre un) et le back-office
    épargne (tous les plans, tous les titulaires, les adhésions nominatives). Les rôles
    clients portant `read=True`, la seconde famille était publique.
    """

    def _groupe(self, nom="Coopérative de Goma"):
        self.login(role="gest_zone", sub="gz-cloisonnement")
        return self.client.post("/api/savings/groups", {"name": nom, "rate": "5.0"},
                                format="json").data["id"]

    def test_un_membre_ne_lit_pas_tous_les_plans_de_la_cooperative(self):
        self.login(role="client", sub="membre-epargne")
        self.assertEqual(self.client.get("/api/savings/plans").status_code, 403)

    def test_un_membre_lit_le_catalogue_sans_les_soldes_ni_les_noms_des_autres(self):
        """Le catalogue reste ouvert — sans lui, personne ne peut demander à rejoindre un
        groupe. Ce qui en sort est réduit : le solde du groupe est un agrégat de
        l'institution, et la liste de ses membres l'identité de tiers."""
        gid = self._groupe()
        self.login(role="client", sub="membre-epargne")
        res = self.client.get("/api/savings/groups")
        self.assertEqual(res.status_code, 200)
        ligne = next(g for g in res.data if g["id"] == gid)
        self.assertEqual(ligne["name"], "Coopérative de Goma")
        self.assertIn("membersCount", ligne)      # la taille, oui
        self.assertNotIn("balance", ligne)        # l'encours, non
        self.assertNotIn("members", ligne)        # les noms, non

    def test_le_personnel_conserve_le_catalogue_complet(self):
        gid = self._groupe()
        self.login(role="gest_zone", sub="gz-cloisonnement")
        ligne = next(g for g in self.client.get("/api/savings/groups").data if g["id"] == gid)
        self.assertIn("balance", ligne)
        self.assertIn("members", ligne)

    def test_un_investisseur_ne_cree_pas_une_cooperative_d_epargne(self):
        """`invest` porte `create` : garder la création de groupe sous cette capacité la
        mettait à sa portée, taux compris. Administrer le réseau mutualiste est la
        capacité `cooperatives`, qu'aucun rôle client ne porte."""
        self.login(role="invest", sub="investisseur-epargne")
        res = self.client.post("/api/savings/groups", {"name": "Groupe pirate", "rate": "99"},
                               format="json")
        self.assertEqual(res.status_code, 403)

    def test_un_membre_ne_lit_ni_la_fiche_ni_le_journal_d_un_groupe(self):
        gid = self._groupe()
        self.login(role="client", sub="membre-epargne")
        self.assertEqual(self.client.get(f"/api/savings/groups/{gid}").status_code, 403)
        self.assertEqual(self.client.get(f"/api/savings/groups/{gid}/audit").status_code, 403)

    def test_un_membre_lit_ses_propres_adhesions(self):
        self.login(role="client", sub="membre-epargne")
        self.assertEqual(self.client.get("/api/savings/groups/mine").status_code, 200)
        self.assertEqual(self.client.get("/api/savings/plans/mine").status_code, 200)

from __future__ import annotations

from decimal import Decimal
from unittest.mock import Mock, patch

import requests

from common.exceptions import (
    ConflictError,
    IdempotencyConflictError,
    InsufficientFundsError,
    PermissionDeniedError,
    StepUpRequiredError,
    ValidationFailed,
)
from common.idempotency import IdempotentReplay
from common.testing import AuthedAPITestCase

from . import cash_register, partner_link, regularization, services, withdrawal_tiers
from .models import (
    ClientWallet,
    FundTransfer,
    RegularizationOrder,
    TreasuryAccount,
    WithdrawalRequest,
    WithdrawalThreshold,
)


class CaissesServiceTests(AuthedAPITestCase):
    def setUp(self):
        self.a = TreasuryAccount.objects.create(code="A1", name="Caisse A", currency="USD", balance=Decimal("100"))
        self.b = TreasuryAccount.objects.create(code="B1", name="Caisse B", currency="USD", balance=Decimal("0"))

    def test_transfer_moves_balance(self):
        services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="30",
                                 idempotency_key="k1", by="u")
        self.a.refresh_from_db()
        self.b.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("70.00"))
        self.assertEqual(self.b.balance, Decimal("30.00"))

    def test_transfer_insufficient_funds_is_all_or_nothing(self):
        with self.assertRaises(InsufficientFundsError):
            services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="9999",
                                     idempotency_key="k2", by="u")
        self.a.refresh_from_db()
        self.b.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("100.00"))
        self.assertEqual(self.b.balance, Decimal("0.00"))

    def test_transfer_idempotent_replay_no_double_debit(self):
        services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="10",
                                 idempotency_key="same-key", by="u")
        with self.assertRaises(IdempotentReplay):
            services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="10",
                                     idempotency_key="same-key", by="u")
        self.a.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("90.00"))
        self.assertEqual(FundTransfer.objects.count(), 1)

    def test_transfer_idempotency_conflict_on_different_params(self):
        services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="10",
                                 idempotency_key="key-x", by="u")
        with self.assertRaises(IdempotencyConflictError):
            services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="20",
                                     idempotency_key="key-x", by="u")

    def test_adjust_account_in_and_out(self):
        services.adjust_account(account_id=self.a.pk, amount="50", direction="in",
                                 idempotency_key="adj-1", by="u")
        self.a.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("150.00"))
        services.adjust_account(account_id=self.a.pk, amount="20", direction="out",
                                 idempotency_key="adj-2", by="u")
        self.a.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("130.00"))

    def test_adjust_account_out_insufficient_funds(self):
        with self.assertRaises(InsufficientFundsError):
            services.adjust_account(account_id=self.a.pk, amount="9999", direction="out",
                                     idempotency_key="adj-3", by="u")


class StaffPerOperationCeilingTests(AuthedAPITestCase):
    def setUp(self):
        from accounts.models import FintechUser
        from rbac.models import StaffProfile

        self.a = TreasuryAccount.objects.create(code="CL1", name="Caisse Ceiling 1", currency="USD",
                                                  balance=Decimal("10000"))
        self.b = TreasuryAccount.objects.create(code="CL2", name="Caisse Ceiling 2", currency="USD",
                                                  balance=Decimal("0"))
        self.agent = FintechUser.objects.create(sub="agent-ceil-1", role="gest_caisse")
        StaffProfile.objects.create(user=self.agent, per_operation_ceiling=Decimal("500"))

    def test_transfer_within_ceiling_succeeds(self):
        services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="500",
                                 idempotency_key="ceil-1", by="agent-ceil-1")
        self.a.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("9500.00"))

    def test_transfer_above_ceiling_rejected(self):
        with self.assertRaises(PermissionDeniedError):
            services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="501",
                                     idempotency_key="ceil-2", by="agent-ceil-1")
        self.a.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("10000.00"))

    def test_adjust_account_above_ceiling_rejected(self):
        with self.assertRaises(PermissionDeniedError):
            services.adjust_account(account_id=self.a.pk, amount="600", direction="in",
                                     idempotency_key="ceil-3", by="agent-ceil-1")

    def test_no_profile_or_no_ceiling_configured_is_unrestricted(self):
        services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="9999",
                                 idempotency_key="ceil-4", by="no-profile-user")
        self.a.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("1.00"))

    def test_higher_ceiling_role_can_execute_larger_amount(self):
        from accounts.models import FintechUser
        from rbac.models import StaffProfile
        supervisor = FintechUser.objects.create(sub="dg-ceil-1", role="dg")
        StaffProfile.objects.create(user=supervisor, per_operation_ceiling=Decimal("50000"))
        services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="5000",
                                 idempotency_key="ceil-5", by="dg-ceil-1")
        self.a.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("5000.00"))

    def test_ceiling_enforced_via_api_action_endpoint(self):
        self.login(role="gest_caisse", sub="agent-ceil-1")
        res = self.client.post(f"/api/caisses/accounts/{self.a.code}/action", {
            "action": "add_flow", "direction": "in", "amount": "600", "idempotencyKey": "ceil-6",
        }, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "permission_denied")

    def test_ceiling_settable_via_rbac_user_endpoint(self):
        self.login(role="admin", sub="config-1")
        res = self.client.patch("/api/rbac/users/agent-ceil-1", {"perOperationCeiling": "750"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["perOperationCeiling"], 750.0)
        services.transfer_funds(from_account_id=self.a.pk, to_account_id=self.b.pk, amount="700",
                                 idempotency_key="ceil-7", by="agent-ceil-1")
        self.a.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("9300.00"))


class DepositKycCapTests(AuthedAPITestCase):
    def _make_wallet(self, sub, balance="0", kyc_level=None):
        self.login(role="client", sub=sub)
        self.client.get("/api/rbac/me")  # déclenche le provisioning JIT
        from accounts.models import FintechUser

        from compliance.kyc_levels import LEVEL_LIMITS
        from compliance.models import KycProfile
        user = FintechUser.objects.get(sub=sub)
        if kyc_level:
            KycProfile.objects.create(user=user, kyc_level=kyc_level, monthly_limit=LEVEL_LIMITS[kyc_level])
        return ClientWallet.objects.create(user=user, currency="USD", balance=Decimal(balance))

    def test_deposit_within_t1_cap_succeeds(self):
        wallet = self._make_wallet("dep1")
        services.deposit(wallet_id=wallet.pk, amount="500", idempotency_key="dep-1", by="dep1")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("500.00"))

    def test_deposit_above_t1_cap_rejected(self):
        wallet = self._make_wallet("dep2", balance="900")
        with self.assertRaises(ValidationFailed):
            services.deposit(wallet_id=wallet.pk, amount="500", idempotency_key="dep-2", by="dep2")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("900.00"))  # rejeté -> pas de crédit partiel

    def test_higher_kyc_level_allows_higher_deposit(self):
        wallet = self._make_wallet("dep3", balance="900", kyc_level="T2")
        services.deposit(wallet_id=wallet.pk, amount="500", idempotency_key="dep-3", by="dep3")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("1400.00"))


class CashRegisterTests(AuthedAPITestCase):
    def setUp(self):
        self.caisse = TreasuryAccount.objects.create(code="CR1", name="Caisse Guichet 1", kind="CAISSE",
                                                       currency="USD", balance=Decimal("500"))
        self.bank = TreasuryAccount.objects.create(code="CR-BQ1", name="Banque 1", kind="BANQUE",
                                                     currency="USD", balance=Decimal("500"))

    def test_open_session_requires_caisse_kind(self):
        with self.assertRaises(ValidationFailed):
            cash_register.open_session(account=self.bank, opening_count="500", by="u")

    def test_cannot_open_second_session_while_one_open(self):
        cash_register.open_session(account=self.caisse, opening_count="500", by="u")
        with self.assertRaises(ConflictError):
            cash_register.open_session(account=self.caisse, opening_count="500", by="u")

    def test_close_matching_count_closes_cleanly(self):
        session = cash_register.open_session(account=self.caisse, opening_count="500", by="u")
        session = cash_register.close_session(session=session, closing_count="500", by="u")
        self.assertEqual(session.status, "CLOSED")
        self.assertEqual(session.discrepancy, Decimal("0.00"))
        self.caisse.refresh_from_db()
        self.assertEqual(self.caisse.status, TreasuryAccount.Status.ACTIF)

    def test_close_with_discrepancy_freezes_account(self):
        session = cash_register.open_session(account=self.caisse, opening_count="500", by="u")
        session = cash_register.close_session(session=session, closing_count="470", by="u")
        self.assertEqual(session.status, "DISCREPANCY")
        self.assertEqual(session.discrepancy, Decimal("-30.00"))
        self.caisse.refresh_from_db()
        self.assertEqual(self.caisse.status, TreasuryAccount.Status.BLOQUE)

    def test_close_within_tolerance_does_not_freeze(self):
        session = cash_register.open_session(account=self.caisse, opening_count="500", by="u")
        session = cash_register.close_session(session=session, closing_count="499.50", by="u")
        self.assertEqual(session.status, "CLOSED")
        self.caisse.refresh_from_db()
        self.assertEqual(self.caisse.status, TreasuryAccount.Status.ACTIF)

    def test_cannot_close_already_closed_session(self):
        session = cash_register.open_session(account=self.caisse, opening_count="500", by="u")
        cash_register.close_session(session=session, closing_count="500", by="u")
        with self.assertRaises(ConflictError):
            cash_register.close_session(session=session, closing_count="500", by="u")

    def test_blocked_account_rejects_adjust(self):
        session = cash_register.open_session(account=self.caisse, opening_count="500", by="u")
        cash_register.close_session(session=session, closing_count="470", by="u")  # gèle le compte
        with self.assertRaises(ConflictError):
            services.adjust_account(account_id=self.caisse.pk, amount="10", direction="in",
                                     idempotency_key="cr-adj-1", by="u")

    def test_daily_ceiling_enforced_only_while_session_open(self):
        self.caisse.daily_ceiling = Decimal("100")
        self.caisse.save(update_fields=["daily_ceiling"])

        # Sans séance ouverte, le plafond n'est pas suivi (aucune session à incrémenter).
        services.adjust_account(account_id=self.caisse.pk, amount="80", direction="in",
                                 idempotency_key="cr-adj-2", by="u")
        self.caisse.refresh_from_db()
        self.assertEqual(self.caisse.balance, Decimal("580.00"))

        cash_register.open_session(account=self.caisse, opening_count="580", by="u")
        services.adjust_account(account_id=self.caisse.pk, amount="60", direction="in",
                                 idempotency_key="cr-adj-3", by="u")  # 60 <= 100, OK
        with self.assertRaises(ValidationFailed):
            services.adjust_account(account_id=self.caisse.pk, amount="50", direction="in",
                                     idempotency_key="cr-adj-4", by="u")  # 60+50=110 > 100

    def test_register_sessions_endpoint(self):
        cash_register.open_session(account=self.caisse, opening_count="500", by="u")
        self.login(role="gest_caisse", sub="mgr-cr1")
        res = self.client.get(f"/api/caisses/accounts/{self.caisse.code}/register-sessions")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["status"], "OPEN")

    def test_register_open_close_via_action_endpoint(self):
        self.login(role="gest_caisse", sub="mgr-cr2")
        opened = self.client.post(f"/api/caisses/accounts/{self.caisse.code}/action",
                                   {"action": "register_open", "openingCount": "500"}, format="json")
        self.assertEqual(opened.status_code, 201)
        self.assertEqual(opened.data["status"], "OPEN")

        closed = self.client.post(f"/api/caisses/accounts/{self.caisse.code}/action",
                                   {"action": "register_close", "closingCount": "500"}, format="json")
        self.assertEqual(closed.status_code, 200)
        self.assertEqual(closed.data["status"], "CLOSED")


class TreasuryAccountPartnerLinkTests(AuthedAPITestCase):
    def setUp(self):
        from partners.models import Partner
        self.partner = Partner.objects.create(name="Orange Money")
        self.mm_account = TreasuryAccount.objects.create(code="MM1", name="Mobile Money 1", kind="MOBILE_MONEY",
                                                           currency="USD", balance=Decimal("0"))
        self.caisse = TreasuryAccount.objects.create(code="CX1", name="Caisse X1", kind="CAISSE",
                                                       currency="USD", balance=Decimal("0"))

    def test_link_partner_requires_mobile_money_kind(self):
        with self.assertRaises(ValidationFailed):
            partner_link.link_partner(account=self.caisse, partner_id=self.partner.pk, by="u")

    def test_link_partner_sets_fk(self):
        account = partner_link.link_partner(account=self.mm_account, partner_id=self.partner.pk, by="u")
        self.assertEqual(account.partner_id, self.partner.pk)

    def test_sync_requires_linked_partner(self):
        with self.assertRaises(ValidationFailed):
            partner_link.sync_account_partner(account=self.mm_account, by="u")

    def test_sync_requires_mobile_money_kind(self):
        with self.assertRaises(ValidationFailed):
            partner_link.sync_account_partner(account=self.caisse, by="u")

    def test_sync_without_base_url_degrades_to_logical_success(self):
        partner_link.link_partner(account=self.mm_account, partner_id=self.partner.pk, by="u")
        self.mm_account.status = TreasuryAccount.Status.EN_OBSERVATION
        self.mm_account.save(update_fields=["status"])
        result = partner_link.sync_account_partner(account=self.mm_account, by="u")
        self.assertEqual(result["partnerSyncStatus"], "SUCCESS")
        self.mm_account.refresh_from_db()
        self.assertEqual(self.mm_account.status, TreasuryAccount.Status.ACTIF)

    @patch("partners.services.requests.get")
    def test_sync_failure_moves_account_to_en_observation(self, mock_get):
        self.partner.base_url = "https://example.test/health"
        self.partner.save(update_fields=["base_url"])
        mock_get.side_effect = requests.RequestException("timeout")
        partner_link.link_partner(account=self.mm_account, partner_id=self.partner.pk, by="u")

        result = partner_link.sync_account_partner(account=self.mm_account, by="u")
        self.assertEqual(result["partnerSyncStatus"], "FAILED")
        self.mm_account.refresh_from_db()
        self.assertEqual(self.mm_account.status, TreasuryAccount.Status.EN_OBSERVATION)

    def test_sync_success_does_not_clear_a_discrepancy_freeze(self):
        partner_link.link_partner(account=self.mm_account, partner_id=self.partner.pk, by="u")
        self.mm_account.status = TreasuryAccount.Status.BLOQUE
        self.mm_account.save(update_fields=["status"])
        partner_link.sync_account_partner(account=self.mm_account, by="u")
        self.mm_account.refresh_from_db()
        self.assertEqual(self.mm_account.status, TreasuryAccount.Status.BLOQUE)

    def test_link_and_sync_via_action_endpoint(self):
        self.login(role="gest_caisse", sub="mgr-pl1")
        linked = self.client.post(f"/api/caisses/accounts/{self.mm_account.code}/action",
                                   {"action": "link_partner", "partnerId": self.partner.pk}, format="json")
        self.assertEqual(linked.status_code, 200)
        self.assertEqual(linked.data["partnerId"], self.partner.pk)
        self.assertEqual(linked.data["partnerName"], "Orange Money")

        synced = self.client.post(f"/api/caisses/accounts/{self.mm_account.code}/action",
                                   {"action": "sync_partner"}, format="json")
        self.assertEqual(synced.status_code, 200)
        self.assertEqual(synced.data["partnerSyncStatus"], "SUCCESS")


class CaissesConvertTests(AuthedAPITestCase):
    def test_convert_uses_frozen_fx_rate(self):
        from fx.services import set_rate
        from datetime import date
        set_rate(tier="CLIENT", currency="USD", buy="2780", sell="2820", effective_date=date(2026, 1, 1), by="u")

        self.login(role="client", sub="fx-1")
        self.client.get("/api/rbac/me")  # déclenche le provisioning JIT
        from accounts.models import FintechUser
        user = FintechUser.objects.get(sub="fx-1")
        ClientWallet.objects.create(user=user, currency="USD", balance=Decimal("100"))

        result = services.convert_wallet(user=user, from_currency="USD", to_currency="CDF", amount="10",
                                          idempotency_key="conv-1", by="fx-1")
        self.assertEqual(result["result"], 27800.00)
        usd_wallet = ClientWallet.objects.get(user=user, currency="USD")
        cdf_wallet = ClientWallet.objects.get(user=user, currency="CDF")
        self.assertEqual(usd_wallet.balance, Decimal("90.00"))
        self.assertEqual(cdf_wallet.balance, Decimal("27800.00"))

    def test_convert_without_rate_configured_fails_cleanly(self):
        from common.exceptions import NotFoundError
        self.login(role="client", sub="fx-2")
        self.client.get("/api/rbac/me")  # déclenche le provisioning JIT
        from accounts.models import FintechUser
        user = FintechUser.objects.get(sub="fx-2")
        ClientWallet.objects.create(user=user, currency="USD", balance=Decimal("100"))
        with self.assertRaises(NotFoundError):
            services.convert_wallet(user=user, from_currency="USD", to_currency="CDF", amount="10",
                                     idempotency_key="conv-2", by="fx-2")


class CaissesApiTests(AuthedAPITestCase):
    def setUp(self):
        self.a = TreasuryAccount.objects.create(code="A2", name="Caisse A2", currency="USD", balance=Decimal("100"))
        self.b = TreasuryAccount.objects.create(code="B2", name="Caisse B2", currency="USD", balance=Decimal("0"))

    def test_transfer_via_api_and_replay_returns_same_transfer(self):
        self.login(role="gest_caisse", sub="mgr-1")
        payload = {"action": "transfer", "toCode": "B2", "amount": "15", "idempotencyKey": "api-key-1"}
        res1 = self.client.post("/api/caisses/accounts/A2/action", payload, format="json")
        self.assertEqual(res1.status_code, 200)
        res2 = self.client.post("/api/caisses/accounts/A2/action", payload, format="json")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res1.data["transferId"], res2.data["transferId"])
        self.a.refresh_from_db()
        self.assertEqual(self.a.balance, Decimal("85.00"))  # un seul débit malgré 2 appels

    def test_transfer_requires_validate_capability(self):
        self.login(role="agri_op", sub="client-1")
        res = self.client.post("/api/caisses/accounts/A2/action",
                                {"action": "transfer", "toCode": "B2", "amount": "1", "idempotencyKey": "k"},
                                format="json")
        self.assertEqual(res.status_code, 403)

    def test_insufficient_funds_maps_to_409_via_global_handler(self):
        self.login(role="gest_caisse", sub="mgr-2")
        res = self.client.post("/api/caisses/accounts/A2/action",
                                {"action": "transfer", "toCode": "B2", "amount": "99999", "idempotencyKey": "k9"},
                                format="json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "insufficient_funds")


class WithdrawalTierServiceTests(AuthedAPITestCase):
    def _make_wallet(self, sub, balance="10000", kyc_level=None):
        self.login(role="client", sub=sub)
        self.client.get("/api/rbac/me")  # déclenche le provisioning JIT
        from accounts.models import FintechUser

        from compliance.kyc_levels import LEVEL_LIMITS
        from compliance.models import KycProfile
        user = FintechUser.objects.get(sub=sub)
        if kyc_level:
            KycProfile.objects.create(user=user, kyc_level=kyc_level, monthly_limit=LEVEL_LIMITS[kyc_level])
        return ClientWallet.objects.create(user=user, currency="USD", balance=Decimal(balance))

    def test_auto_tier_withdraws_immediately(self):
        wallet = self._make_wallet("w1")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="100",
                                                           idempotency_key="wd-1", by="w1")
        self.assertEqual(req.status, "posted")
        self.assertTrue(req.auto_validated)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("9900.00"))

    def test_withdrawal_above_kyc_monthly_limit_is_rejected(self):
        wallet = self._make_wallet("w1b")  # T1 par défaut -> plafond mensuel 500
        with self.assertRaises(ValidationFailed):
            withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="600",
                                                        idempotency_key="wd-1b", by="w1b")

    def test_manager_tier_pending_until_single_approval(self):
        wallet = self._make_wallet("w2", kyc_level="T2")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="1000",
                                                           idempotency_key="wd-2", by="w2")
        self.assertEqual(req.status, "pending_validation")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("10000.00"))  # pas encore débité

        req = withdrawal_tiers.approve(request_id=req.pk, approver_sub="mgr1", approver_role="gest_caisse")
        self.assertEqual(req.status, "posted")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("9000.00"))

    def test_manager_tier_reject_leaves_balance_untouched(self):
        wallet = self._make_wallet("w3", kyc_level="T2")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="1000",
                                                           idempotency_key="wd-3", by="w3")
        req = withdrawal_tiers.reject(request_id=req.pk, approver_sub="mgr2", approver_role="gest_caisse",
                                       reason="Suspicion de fraude.")
        self.assertEqual(req.status, "rejected")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("10000.00"))

    def test_quorum_tier_requires_three_supervisors_with_otp(self):
        wallet = self._make_wallet("w4", kyc_level="T3")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="6000",
                                                           idempotency_key="wd-4", by="w4")
        self.assertEqual(req.status, "pending_validation")

        def _approve_with_otp(sub, role):
            with patch("caisses.withdrawal_tiers.secrets.randbelow", return_value=123456):
                challenge = withdrawal_tiers.request_step_up_otp(request_id=req.pk, approver_sub=sub)
            self.assertTrue(withdrawal_tiers.verify_step_up_otp(challenge_id=challenge.pk, code="123456"))
            return withdrawal_tiers.approve(request_id=req.pk, approver_sub=sub, approver_role=role,
                                             otp_code="123456")

        r = _approve_with_otp("sup1", "dg")
        self.assertEqual(r.status, "pending_validation")
        r = _approve_with_otp("sup2", "dir_ops")
        self.assertEqual(r.status, "pending_validation")
        r = _approve_with_otp("sup3", "aud_tech")
        self.assertEqual(r.status, "posted")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("4000.00"))

        # 4e approbation après quorum déjà atteint -> no-op idempotent, pas d'erreur.
        r = _approve_with_otp("sup4", "aud_fin")
        self.assertEqual(r.status, "posted")

    def test_non_supervisor_cannot_approve_quorum_tier(self):
        wallet = self._make_wallet("w5", kyc_level="T3")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="6000",
                                                           idempotency_key="wd-5", by="w5")
        with self.assertRaises(ConflictError):
            withdrawal_tiers.approve(request_id=req.pk, approver_sub="mgr3", approver_role="gest_caisse")

    def test_quorum_tier_approval_without_otp_raises_step_up_required(self):
        wallet = self._make_wallet("w6", kyc_level="T3")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="6000",
                                                           idempotency_key="wd-6", by="w6")
        with self.assertRaises(StepUpRequiredError):
            withdrawal_tiers.approve(request_id=req.pk, approver_sub="sup1", approver_role="dg")

    def test_request_insufficient_funds_rejected_immediately(self):
        wallet = self._make_wallet("w7", balance="50")
        with self.assertRaises(InsufficientFundsError):
            withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="100",
                                                        idempotency_key="wd-7", by="w7")

    def test_balance_rechecked_at_approval_time_all_or_nothing(self):
        """Le solde peut changer entre la demande (palier manager, non débitée) et
        l'approbation — le débit final revérifie le solde plutôt que de faire confiance à la
        vérification faite à la création."""
        wallet = self._make_wallet("w8", balance="1200", kyc_level="T2")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="1000",
                                                           idempotency_key="wd-8", by="w8")
        ClientWallet.objects.filter(pk=wallet.pk).update(balance=Decimal("500"))
        with self.assertRaises(InsufficientFundsError):
            withdrawal_tiers.approve(request_id=req.pk, approver_sub="mgr4", approver_role="gest_caisse")

    def test_idempotent_replay_does_not_double_debit(self):
        wallet = self._make_wallet("w9")
        withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="100",
                                                    idempotency_key="same-wd-key", by="w9")
        with self.assertRaises(IdempotentReplay):
            withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="100",
                                                        idempotency_key="same-wd-key", by="w9")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("9900.00"))
        self.assertEqual(WithdrawalRequest.objects.filter(wallet=wallet).count(), 1)

    def test_configured_threshold_overrides_default(self):
        WithdrawalThreshold.objects.create(currency="USD", auto_limit=Decimal("10"), manager_limit=Decimal("50"))
        wallet = self._make_wallet("w10")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="20",
                                                           idempotency_key="wd-10", by="w10")
        self.assertEqual(req.status, "pending_validation")  # 10 <= 20 < 50 -> palier manager, pas auto


class WithdrawalRequestApiTests(AuthedAPITestCase):
    def _make_wallet(self, sub, balance="10000", kyc_level=None):
        self.login(role="client", sub=sub)
        self.client.get("/api/rbac/me")  # déclenche le provisioning JIT
        from accounts.models import FintechUser

        from compliance.kyc_levels import LEVEL_LIMITS
        from compliance.models import KycProfile
        user = FintechUser.objects.get(sub=sub)
        if kyc_level:
            KycProfile.objects.create(user=user, kyc_level=kyc_level, monthly_limit=LEVEL_LIMITS[kyc_level])
        return ClientWallet.objects.create(user=user, currency="USD", balance=Decimal(balance))

    def test_my_withdraw_below_auto_limit_posts_immediately(self):
        wallet = self._make_wallet("api-w1")
        res = self.client.post("/api/caisses/wallets/mine/withdraw",
                                {"amount": "100", "currency": "USD", "idempotencyKey": "api-wd-1"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "posted")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("9900.00"))

    def test_my_withdraw_above_auto_limit_is_pending(self):
        self._make_wallet("api-w2", kyc_level="T2")
        res = self.client.post("/api/caisses/wallets/mine/withdraw",
                                {"amount": "1000", "currency": "USD", "idempotencyKey": "api-wd-2"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "pending_validation")
        self.assertEqual(res.data["requiredApprovals"], 1)

    def test_client_cannot_approve_withdrawal_requests(self):
        wallet = self._make_wallet("api-w3", kyc_level="T2")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="1000",
                                                           idempotency_key="api-wd-3", by="api-w3")
        res = self.client.post(f"/api/caisses/withdrawal-requests/{req.pk}/approve", {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_manager_can_approve_via_api(self):
        wallet = self._make_wallet("api-w4", kyc_level="T2")
        req = withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="1000",
                                                           idempotency_key="api-wd-4", by="api-w4")
        self.login(role="gest_caisse", sub="api-mgr1")
        res = self.client.post(f"/api/caisses/withdrawal-requests/{req.pk}/approve", {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "posted")

    def test_list_withdrawal_requests_requires_validate_capability(self):
        wallet = self._make_wallet("api-w5", kyc_level="T2")
        withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="1000",
                                                    idempotency_key="api-wd-5", by="api-w5")
        denied = self.client.get("/api/caisses/withdrawal-requests")
        self.assertEqual(denied.status_code, 403)

        self.login(role="gest_caisse", sub="api-mgr2")
        allowed = self.client.get("/api/caisses/withdrawal-requests")
        self.assertEqual(allowed.status_code, 200)
        self.assertGreaterEqual(len(allowed.data), 1)

    def test_my_withdrawal_requests_shows_own_pending_request(self):
        wallet = self._make_wallet("api-w6", kyc_level="T2")
        withdrawal_tiers.create_withdrawal_request(wallet_id=wallet.pk, amount="1000",
                                                    idempotency_key="api-wd-6", by="api-w6")
        res = self.client.get("/api/caisses/wallets/mine/withdrawal-requests")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["status"], "pending_validation")

    def test_my_withdrawal_requests_does_not_leak_other_users_requests(self):
        self._make_wallet("api-w7")
        self.login(role="client", sub="api-w8")
        res = self.client.get("/api/caisses/wallets/mine/withdrawal-requests")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 0)

    def test_wallet_for_user_requires_validate_capability(self):
        self._make_wallet("api-w9")
        res = self.client.get("/api/caisses/wallets/for-user/api-w9")
        self.assertEqual(res.status_code, 403)

    def test_wallet_for_user_gets_or_creates_wallet(self):
        wallet = self._make_wallet("api-w10")
        self.login(role="gest_caisse", sub="agent-lookup-1")
        res = self.client.get("/api/caisses/wallets/for-user/api-w10", {"currency": "USD"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["id"], wallet.pk)
        self.assertEqual(res.data["userSub"], "api-w10")

        # Devise pas encore utilisée par ce client -> création à la volée.
        created = self.client.get("/api/caisses/wallets/for-user/api-w10", {"currency": "CDF"})
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.data["balance"], 0.0)
        self.assertNotEqual(created.data["id"], wallet.pk)


class RegularizationOrderTests(AuthedAPITestCase):
    def _make_wallet(self, sub, balance="0"):
        self.login(role="client", sub=sub)
        self.client.get("/api/rbac/me")  # déclenche le provisioning JIT
        from accounts.models import FintechUser
        user = FintechUser.objects.get(sub=sub)
        return ClientWallet.objects.create(user=user, currency="USD", balance=Decimal(balance))

    def test_auto_tier_credits_immediately(self):
        wallet = self._make_wallet("r1")
        order = regularization.create_regularization_order(
            wallet_id=wallet.pk, amount="100", reason="Dépôt MM non crédité.",
            idempotency_key="reg-1", by="agent-1",
        )
        self.assertEqual(order.status, "posted")
        self.assertTrue(order.auto_validated)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("100.00"))
        self.assertEqual(order.movement.kind, "REGULARIZATION")

    def test_manager_tier_pending_then_approved_credits_wallet(self):
        wallet = self._make_wallet("r2")
        order = regularization.create_regularization_order(
            wallet_id=wallet.pk, amount="500", idempotency_key="reg-2", by="agent-2",
        )
        self.assertEqual(order.status, "pending_validation")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))  # pas encore crédité

        order = regularization.approve(order_id=order.pk, approver_sub="mgr1", approver_role="gest_caisse")
        self.assertEqual(order.status, "posted")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("500.00"))

    def test_manager_tier_reject_leaves_balance_untouched(self):
        wallet = self._make_wallet("r3")
        order = regularization.create_regularization_order(
            wallet_id=wallet.pk, amount="500", idempotency_key="reg-3", by="agent-3",
        )
        order = regularization.reject(order_id=order.pk, approver_sub="mgr2", approver_role="gest_caisse",
                                       reason="Aucune preuve de dépôt côté opérateur.")
        self.assertEqual(order.status, "rejected")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_quorum_tier_requires_three_supervisors_with_otp(self):
        wallet = self._make_wallet("r4")
        order = regularization.create_regularization_order(
            wallet_id=wallet.pk, amount="3000", idempotency_key="reg-4", by="agent-4",
        )
        self.assertEqual(order.status, "pending_validation")

        def _approve_with_otp(sub, role):
            with patch("caisses.regularization.secrets.randbelow", return_value=123456):
                challenge = regularization.request_step_up_otp(order_id=order.pk, approver_sub=sub)
            self.assertTrue(regularization.verify_step_up_otp(challenge_id=challenge.pk, code="123456"))
            return regularization.approve(order_id=order.pk, approver_sub=sub, approver_role=role,
                                           otp_code="123456")

        r = _approve_with_otp("sup1", "dg")
        self.assertEqual(r.status, "pending_validation")
        r = _approve_with_otp("sup2", "dir_ops")
        self.assertEqual(r.status, "pending_validation")
        r = _approve_with_otp("sup3", "aud_tech")
        self.assertEqual(r.status, "posted")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("3000.00"))

    def test_non_supervisor_cannot_approve_quorum_tier(self):
        wallet = self._make_wallet("r5")
        order = regularization.create_regularization_order(
            wallet_id=wallet.pk, amount="3000", idempotency_key="reg-5", by="agent-5",
        )
        with self.assertRaises(ConflictError):
            regularization.approve(order_id=order.pk, approver_sub="mgr3", approver_role="gest_caisse")

    def test_ticket_linkage_posts_message_and_resolves_ticket(self):
        from support.models import Ticket

        wallet = self._make_wallet("r6")
        ticket = Ticket.objects.create(user=wallet.user, subject="Dépôt manquant", category="mobile-money")
        order = regularization.create_regularization_order(
            wallet_id=wallet.pk, amount="80", reason="Dépôt Mobile Money confirmé chez l'opérateur.",
            ticket_id=ticket.pk, idempotency_key="reg-6", by="agent-6",
        )
        self.assertEqual(order.status, "posted")
        ticket.refresh_from_db()
        self.assertEqual(ticket.status, "resolu")
        self.assertIsNotNone(ticket.resolved_at)
        messages = list(ticket.messages.all())
        self.assertEqual(len(messages), 1)
        self.assertIn("Crédit de régularisation", messages[0].text)
        self.assertFalse(messages[0].is_internal)

    def test_idempotent_replay_does_not_double_credit(self):
        wallet = self._make_wallet("r7")
        regularization.create_regularization_order(wallet_id=wallet.pk, amount="100",
                                                     idempotency_key="same-reg-key", by="agent-7")
        with self.assertRaises(IdempotentReplay):
            regularization.create_regularization_order(wallet_id=wallet.pk, amount="100",
                                                         idempotency_key="same-reg-key", by="agent-7")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("100.00"))
        self.assertEqual(RegularizationOrder.objects.filter(wallet=wallet).count(), 1)


class RegularizationOrderApiTests(AuthedAPITestCase):
    def _make_wallet(self, sub, balance="0"):
        self.login(role="client", sub=sub)
        self.client.get("/api/rbac/me")  # déclenche le provisioning JIT
        from accounts.models import FintechUser
        user = FintechUser.objects.get(sub=sub)
        return ClientWallet.objects.create(user=user, currency="USD", balance=Decimal(balance))

    def test_client_cannot_create_or_approve_regularization_orders(self):
        wallet = self._make_wallet("api-r1")
        denied_create = self.client.post(
            "/api/caisses/regularization-orders",
            {"walletId": wallet.pk, "amount": "100", "idempotencyKey": "api-reg-1"}, format="json",
        )
        self.assertEqual(denied_create.status_code, 403)

    def test_manager_creates_and_approves_via_api(self):
        wallet = self._make_wallet("api-r2")
        self.login(role="gest_caisse", sub="api-mgr1")
        created = self.client.post(
            "/api/caisses/regularization-orders",
            {"walletId": wallet.pk, "amount": "500", "reason": "Vérification MM.", "idempotencyKey": "api-reg-2"},
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["status"], "pending_validation")

        approved = self.client.post(
            f"/api/caisses/regularization-orders/{created.data['orderId']}/approve", {}, format="json",
        )
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.data["status"], "posted")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("500.00"))

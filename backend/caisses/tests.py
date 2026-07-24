from __future__ import annotations

from decimal import Decimal
from io import StringIO
from unittest.mock import Mock, patch

import requests
from django.test import override_settings

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


# ═══════════════════════════════════════ ORDRES DE PAIEMENT (fournisseur Makuta)
#
# AUCUN appel réseau dans ces tests : `settings.MAKUTA` est neutralisé sous `test`
# (config/settings.py), chaque classe réinjecte une configuration FICTIVE via
# `override_settings`, et `requests.post`/`requests.get` du module `common.makuta` sont
# systématiquement remplacés. Les chemins, noms de champs et valeurs de statut ci-dessous
# sont des FIXTURES, pas une hypothèse sur le vrai contrat Makuta : celui-ci n'est pas
# documenté (cf. rapport). Les tests vérifient le MÉCANISME, pas le protocole.

_TEST_KEYS: dict[str, str] = {}


def _test_key_pair() -> tuple[str, str]:
    """Paire RSA générée une seule fois pour toute la suite (2048 bits coûte ~0,2 s)."""
    if not _TEST_KEYS:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        _TEST_KEYS["private"] = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode("utf-8")
        _TEST_KEYS["public"] = key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8")
    return _TEST_KEYS["private"], _TEST_KEYS["public"]


def makuta_test_settings(**overrides) -> dict:
    private_pem, _public_pem = _test_key_pair()
    config = {
        "BASE_URL": "https://makuta.invalid",
        "PRIVATE_KEY_PEM": private_pem,
        "PRIVATE_KEY_PATH": "",
        "PRIVATE_KEY_PASSPHRASE": "",
        "SIGNATURE_HEADER": "X-Makuta-Signature",
        "CALLBACK_PUBLIC_KEY_PEM": "",          # non fournie par Wolf Technologies à ce jour
        "CALLBACK_SIGNATURE_HEADER": "X-Makuta-Signature",
        "CALLBACK_REFERENCE_FIELD": "reference",
        "STATUS_FIELD": "status",
        "STATUS_CONFIRMED": ["SUCCESS"],
        "STATUS_REFUSED": ["FAILED"],
        "STATUS_PENDING": ["PENDING"],
        "PROVIDER_REFERENCE_FIELD": "transactionId",
        "OPERATIONS": {
            "MM_COLLECT": {
                "path": "/fixture/collect",
                "body": {"amount": "{amount}", "currency": "{currency}",
                         "msisdn": "{counterparty}", "partnerReference": "{reference}"},
                "status_path": "/fixture/transactions/{reference}",
            },
            "MM_PAYOUT": {
                "path": "/fixture/payout",
                "body": {"amount": "{amount}", "currency": "{currency}",
                         "msisdn": "{counterparty}", "partnerReference": "{reference}"},
                "status_path": "/fixture/transactions/{reference}",
            },
        },
    }
    config.update(overrides)
    return config


class _FakeHttpResponse:
    def __init__(self, status_code=200, payload=None, unreadable=False):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self._unreadable = unreadable

    def json(self):
        if self._unreadable:
            raise ValueError("réponse non JSON")
        return self._payload


class PaymentOrderMixin:
    def _wallet(self, sub, balance="0", kyc_level="T3"):
        from accounts.models import FintechUser
        from compliance.kyc_levels import LEVEL_LIMITS
        from compliance.models import KycProfile
        self.login(role="client", sub=sub)
        self.client.get("/api/rbac/me")  # provisioning JIT
        user = FintechUser.objects.get(sub=sub)
        if kyc_level:
            KycProfile.objects.get_or_create(
                user=user,
                defaults={"kyc_level": kyc_level, "monthly_limit": LEVEL_LIMITS[kyc_level]},
            )
        return ClientWallet.objects.create(user=user, currency="USD", balance=Decimal(balance))

    def _order(self, wallet, *, direction="COLLECTION", operation="MM_COLLECT",
               amount="100", key="pay-1", by="u"):
        from . import payments
        return payments.create_payment_order(
            wallet_id=wallet.pk, direction=direction, operation=operation, amount=amount,
            counterparty="+243900000000", idempotency_key=key, by=by,
        )


class PaymentStateMachineTests(AuthedAPITestCase):
    def test_terminal_states_have_no_outgoing_transition(self):
        from .models import PaymentOrder
        from .payments import TRANSITIONS
        for terminal in PaymentOrder.SETTLED_STATUSES:
            self.assertEqual(TRANSITIONS[terminal], frozenset(), terminal)

    def test_indeterminate_can_only_be_resolved_by_reading_an_outcome(self):
        """Un ordre indéterminé ne revient JAMAIS à PENDING : ce serait autoriser le rejeu."""
        from .models import PaymentOrder
        from .payments import TRANSITIONS
        self.assertNotIn(PaymentOrder.Status.PENDING, TRANSITIONS[PaymentOrder.Status.INDETERMINATE])
        self.assertNotIn(PaymentOrder.Status.SENT, TRANSITIONS[PaymentOrder.Status.INDETERMINATE])

    def test_confirmed_cannot_become_refused(self):
        from .models import PaymentOrder
        from .payments import TRANSITIONS
        self.assertNotIn(PaymentOrder.Status.REFUSED, TRANSITIONS[PaymentOrder.Status.CONFIRMED])


@override_settings(MAKUTA=makuta_test_settings())
class PaymentCollectionTests(PaymentOrderMixin, AuthedAPITestCase):
    def test_creation_never_credits_the_wallet(self):
        wallet = self._wallet("pay-c1")
        order = self._order(wallet, key="c1")
        wallet.refresh_from_db()
        self.assertEqual(order.status, "PENDING")
        self.assertIsNone(order.movement_id)
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_same_idempotency_key_creates_one_order_only(self):
        from .models import PaymentOrder
        wallet = self._wallet("pay-c2")
        self._order(wallet, key="c2")
        with self.assertRaises(IdempotentReplay):
            self._order(wallet, key="c2")
        self.assertEqual(PaymentOrder.objects.filter(wallet=wallet).count(), 1)

    def test_transport_error_leaves_order_indeterminate_without_crediting(self):
        from . import payments
        wallet = self._wallet("pay-c3")
        order = self._order(wallet, key="c3")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")) as post:
            order = payments.dispatch_payment_order(reference=order.reference, by="u")
        self.assertEqual(post.call_count, 1)
        self.assertEqual(order.status, "INDETERMINATE")
        self.assertIsNone(order.movement_id)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_double_send_pays_only_once(self):
        """Le second envoi est REFUSÉ, pas rejoué : le test qui protège du double paiement."""
        from . import payments
        wallet = self._wallet("pay-c4")
        order = self._order(wallet, key="c4")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")) as post:
            payments.dispatch_payment_order(reference=order.reference, by="u")
            with self.assertRaises(ConflictError):
                payments.dispatch_payment_order(reference=order.reference, by="u")
            self.assertEqual(post.call_count, 1)  # une seule requête est partie

    def test_provider_refusal_does_not_credit(self):
        from . import payments
        wallet = self._wallet("pay-c5")
        order = self._order(wallet, key="c5")
        refusal = _FakeHttpResponse(status_code=402, payload={"message": "solde insuffisant"})
        with patch("common.makuta.requests.post", return_value=refusal):
            order = payments.dispatch_payment_order(reference=order.reference, by="u")
        self.assertEqual(order.status, "REFUSED")
        self.assertIsNone(order.movement_id)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_unreadable_status_is_not_a_confirmation(self):
        """200 OK ne vaut pas confirmation : sans statut interprétable, rien n'est crédité."""
        from . import payments
        wallet = self._wallet("pay-c6")
        order = self._order(wallet, key="c6")
        ok = _FakeHttpResponse(payload={"status": "QUELQUE_CHOSE_DE_NOUVEAU"})
        with patch("common.makuta.requests.post", return_value=ok):
            order = payments.dispatch_payment_order(reference=order.reference, by="u")
        self.assertEqual(order.status, "AWAITING_CONFIRMATION")
        self.assertIsNone(order.movement_id)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_confirmation_credits_exactly_once(self):
        from . import payments
        wallet = self._wallet("pay-c7")
        order = self._order(wallet, amount="250", key="c7")
        ok = _FakeHttpResponse(payload={"status": "SUCCESS", "transactionId": "MK-123"})
        with patch("common.makuta.requests.post", return_value=ok):
            order = payments.dispatch_payment_order(reference=order.reference, by="u")
        self.assertEqual(order.status, "CONFIRMED")
        self.assertEqual(order.provider_reference, "MK-123")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("250.00"))
        self.assertEqual(wallet.movements.count(), 1)

    def test_reconciliation_of_indeterminate_order_that_actually_succeeded(self):
        """Le scénario coûteux : le réseau a coupé, mais l'argent est bien parti chez Makuta.
        La relecture confirme et crédite UNE fois — sans jamais réémettre le paiement."""
        from . import payments
        wallet = self._wallet("pay-c8")
        order = self._order(wallet, amount="300", key="c8")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            order = payments.dispatch_payment_order(reference=order.reference, by="u")
        self.assertEqual(order.status, "INDETERMINATE")

        read = _FakeHttpResponse(payload={"status": "SUCCESS", "transactionId": "MK-999"})
        with patch("common.makuta.requests.get", return_value=read) as get, \
                patch("common.makuta.requests.post") as post:
            order = payments.reconcile_payment_order(
                reference=order.reference, motive="Ordre indéterminé depuis 20 min.", by="agent-1")
        self.assertEqual(get.call_count, 1)
        self.assertEqual(post.call_count, 0)  # réconcilier n'est PAS rejouer
        self.assertEqual(order.status, "CONFIRMED")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("300.00"))
        self.assertEqual(wallet.movements.count(), 1)

    def test_reconciliation_that_reads_nothing_usable_keeps_the_alarm(self):
        """Une relecture illisible ne lève pas le doute : elle le confirme. L'ordre reste
        INDETERMINATE et donc dans la file de réconciliation."""
        from . import payments
        wallet = self._wallet("pay-c15")
        order = self._order(wallet, key="c15")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            payments.dispatch_payment_order(reference=order.reference, by="u")
        read = _FakeHttpResponse(payload={"status": "MYSTERE"})
        with patch("common.makuta.requests.get", return_value=read):
            order = payments.reconcile_payment_order(
                reference=order.reference, motive="Vérification quotidienne.", by="agent-1")
        self.assertEqual(order.status, "INDETERMINATE")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_reconciliation_requires_a_motive(self):
        from . import payments
        wallet = self._wallet("pay-c9")
        order = self._order(wallet, key="c9")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            payments.dispatch_payment_order(reference=order.reference, by="u")
        with self.assertRaises(ValidationFailed):
            payments.reconcile_payment_order(reference=order.reference, motive="", by="agent-1")

    def test_reconciliation_of_a_settled_order_is_refused(self):
        from . import payments
        wallet = self._wallet("pay-c10")
        order = self._order(wallet, key="c10")
        ok = _FakeHttpResponse(payload={"status": "SUCCESS"})
        with patch("common.makuta.requests.post", return_value=ok):
            payments.dispatch_payment_order(reference=order.reference, by="u")
        with self.assertRaises(ConflictError):
            payments.reconcile_payment_order(reference=order.reference, motive="Doute.", by="agent-1")

    def test_unknown_operation_is_refused_before_any_write(self):
        from common.makuta import MakutaConfigurationError
        from .models import PaymentOrder
        wallet = self._wallet("pay-c11")
        with self.assertRaises(MakutaConfigurationError):
            self._order(wallet, operation="OPERATION_INVENTEE", key="c11")
        self.assertEqual(PaymentOrder.objects.filter(wallet=wallet).count(), 0)

    def test_indeterminate_queue_lists_every_open_order(self):
        from . import payments
        wallet = self._wallet("pay-c12")
        order = self._order(wallet, key="c12")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            payments.dispatch_payment_order(reference=order.reference, by="u")
        references = [o.reference for o in payments.indeterminate_orders()]
        self.assertIn(order.reference, references)

    def test_events_journal_is_append_only(self):
        wallet = self._wallet("pay-c13")
        order = self._order(wallet, key="c13")
        event = order.events.first()
        event.motive = "réécriture"
        with self.assertRaises(RuntimeError):
            event.save()
        with self.assertRaises(RuntimeError):
            event.delete()

    def test_force_settle_demands_a_circumstantiated_motive(self):
        from . import payments
        wallet = self._wallet("pay-c14")
        order = self._order(wallet, key="c14")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            payments.dispatch_payment_order(reference=order.reference, by="u")
        with self.assertRaises(ValidationFailed):
            payments.force_settle(reference=order.reference, outcome="CONFIRMED", motive="ok", by="dg-1")
        order = payments.force_settle(
            reference=order.reference, outcome="CONFIRMED",
            motive="Relevé opérateur MM du 12/07 ligne 44 : encaissement effectif.", by="dg-1")
        self.assertEqual(order.status, "CONFIRMED")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("100.00"))


@override_settings(MAKUTA=makuta_test_settings(BASE_URL="", PRIVATE_KEY_PEM=""))
class PaymentUnconfiguredProviderTests(PaymentOrderMixin, AuthedAPITestCase):
    def test_missing_credentials_leave_the_order_pending_and_send_nothing(self):
        """Sous `test`, la configuration Makuta est neutralisée : rien ne peut partir. L'ordre
        doit revenir à PENDING — un ordre « envoyé » qui ne l'a jamais été pollue la file de
        réconciliation avec un faux doute."""
        from common.makuta import MakutaConfigurationError
        from . import payments
        wallet = self._wallet("pay-u1")
        order = self._order(wallet, key="u1")
        with patch("common.makuta.requests.post") as post:
            with self.assertRaises(MakutaConfigurationError):
                payments.dispatch_payment_order(reference=order.reference, by="u")
            self.assertEqual(post.call_count, 0)
        order.refresh_from_db()
        self.assertEqual(order.status, "PENDING")


@override_settings(MAKUTA=makuta_test_settings())
class PaymentPayoutTests(PaymentOrderMixin, AuthedAPITestCase):
    def test_payout_reserves_the_funds_at_creation(self):
        wallet = self._wallet("pay-p1", balance="500")
        order = self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="200", key="p1")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("300.00"))
        self.assertIsNotNone(order.movement_id)

    def test_payout_without_funds_is_refused(self):
        wallet = self._wallet("pay-p2", balance="50")
        with self.assertRaises(InsufficientFundsError):
            self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="200", key="p2")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("50.00"))

    def test_payout_refusal_gives_the_funds_back(self):
        from . import payments
        wallet = self._wallet("pay-p3", balance="500")
        order = self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="200", key="p3")
        refusal = _FakeHttpResponse(status_code=400, payload={"message": "numéro invalide"})
        with patch("common.makuta.requests.post", return_value=refusal):
            order = payments.dispatch_payment_order(reference=order.reference, by="u")
        self.assertEqual(order.status, "REFUSED")
        self.assertIsNotNone(order.reversal_movement_id)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("500.00"))

    def test_payout_indeterminate_keeps_the_funds_reserved(self):
        """Tant que l'issue est inconnue, on NE rend PAS les fonds : si le paiement a abouti,
        les rendre les ferait dépenser deux fois."""
        from . import payments
        wallet = self._wallet("pay-p4", balance="500")
        order = self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="200", key="p4")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            order = payments.dispatch_payment_order(reference=order.reference, by="u")
        self.assertEqual(order.status, "INDETERMINATE")
        self.assertIsNone(order.reversal_movement_id)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("300.00"))

    def test_cancel_before_send_gives_the_funds_back(self):
        from . import payments
        wallet = self._wallet("pay-p5", balance="500")
        order = self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="200", key="p5")
        order = payments.cancel_payment_order(reference=order.reference, motive="Erreur de saisie.",
                                              by="agent-1")
        self.assertEqual(order.status, "CANCELLED")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("500.00"))

    def test_cannot_cancel_once_sent(self):
        from . import payments
        wallet = self._wallet("pay-p6", balance="500")
        order = self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="200", key="p6")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            payments.dispatch_payment_order(reference=order.reference, by="u")
        with self.assertRaises(ConflictError):
            payments.cancel_payment_order(reference=order.reference, motive="Trop tard.", by="agent-1")


class PaymentCallbackTests(PaymentOrderMixin, AuthedAPITestCase):
    URL = "/api/caisses/payments/callback"

    def _signed(self, payload: dict) -> tuple[bytes, str]:
        """Signe avec la clé PRIVÉE de test comme le ferait Makuta avec la sienne."""
        import base64
        import json
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        private_pem, _ = _test_key_pair()
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        key = serialization.load_pem_private_key(private_pem.encode("utf-8"), password=None)
        signature = base64.b64encode(key.sign(body, padding.PKCS1v15(), hashes.SHA256())).decode("ascii")
        return body, signature

    @override_settings(MAKUTA=makuta_test_settings())
    def test_callback_is_refused_while_no_provider_public_key_is_configured(self):
        """État réel du projet : Wolf Technologies ne nous a pas donné sa clé publique. Tant
        qu'elle manque, l'endpoint refuse TOUT — c'est le comportement correct."""
        wallet = self._wallet("cb-1")
        order = self._order(wallet, key="cb1")
        body, signature = self._signed({"reference": order.reference, "status": "SUCCESS"})
        res = self.client.post(self.URL, data=body, content_type="application/json",
                               HTTP_X_MAKUTA_SIGNATURE=signature)
        self.assertEqual(res.status_code, 503)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    @override_settings(MAKUTA=makuta_test_settings(CALLBACK_PUBLIC_KEY_PEM=_test_key_pair()[1]))
    def test_unsigned_callback_is_rejected_and_credits_nothing(self):
        wallet = self._wallet("cb-2")
        order = self._order(wallet, key="cb2")
        body, _ = self._signed({"reference": order.reference, "status": "SUCCESS"})
        res = self.client.post(self.URL, data=body, content_type="application/json")
        self.assertEqual(res.status_code, 401)
        order.refresh_from_db()
        wallet.refresh_from_db()
        self.assertEqual(order.status, "PENDING")
        self.assertEqual(wallet.balance, Decimal("0.00"))

    @override_settings(MAKUTA=makuta_test_settings(CALLBACK_PUBLIC_KEY_PEM=_test_key_pair()[1]))
    def test_badly_signed_callback_is_rejected_and_credits_nothing(self):
        wallet = self._wallet("cb-3")
        order = self._order(wallet, key="cb3")
        body, _ = self._signed({"reference": order.reference, "status": "SUCCESS"})
        res = self.client.post(self.URL, data=body, content_type="application/json",
                               HTTP_X_MAKUTA_SIGNATURE="c2lnbmF0dXJlIGJpZG9u")
        self.assertEqual(res.status_code, 401)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    @override_settings(MAKUTA=makuta_test_settings(CALLBACK_PUBLIC_KEY_PEM=_test_key_pair()[1]))
    def test_tampered_body_invalidates_the_signature(self):
        """Le corps est signé : le modifier après coup casse la vérification."""
        wallet = self._wallet("cb-4")
        order = self._order(wallet, key="cb4")
        body, signature = self._signed({"reference": order.reference, "status": "SUCCESS"})
        tampered = body.replace(b"SUCCESS", b"SUCCESZ")
        res = self.client.post(self.URL, data=tampered, content_type="application/json",
                               HTTP_X_MAKUTA_SIGNATURE=signature)
        self.assertEqual(res.status_code, 401)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    @override_settings(MAKUTA=makuta_test_settings(CALLBACK_PUBLIC_KEY_PEM=_test_key_pair()[1]))
    def test_correctly_signed_callback_confirms_and_credits_once(self):
        from . import payments
        wallet = self._wallet("cb-5")
        order = self._order(wallet, amount="150", key="cb5")
        with patch("common.makuta.requests.post",
                   return_value=_FakeHttpResponse(payload={"status": "PENDING"})):
            payments.dispatch_payment_order(reference=order.reference, by="u")

        body, signature = self._signed({"reference": order.reference, "status": "SUCCESS",
                                        "transactionId": "MK-77"})
        first = self.client.post(self.URL, data=body, content_type="application/json",
                                 HTTP_X_MAKUTA_SIGNATURE=signature)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data["status"], "CONFIRMED")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("150.00"))

        # Rappel rejoué (les fournisseurs réémettent) — aucun second crédit.
        second = self.client.post(self.URL, data=body, content_type="application/json",
                                  HTTP_X_MAKUTA_SIGNATURE=signature)
        self.assertEqual(second.status_code, 200)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("150.00"))
        self.assertEqual(wallet.movements.count(), 1)

    @override_settings(MAKUTA=makuta_test_settings(CALLBACK_PUBLIC_KEY_PEM=_test_key_pair()[1]))
    def test_signed_callback_on_unknown_reference_is_refused(self):
        self._wallet("cb-6")
        body, signature = self._signed({"reference": "AGCinconnue", "status": "SUCCESS"})
        res = self.client.post(self.URL, data=body, content_type="application/json",
                               HTTP_X_MAKUTA_SIGNATURE=signature)
        self.assertEqual(res.status_code, 404)


@override_settings(MAKUTA=makuta_test_settings())
class PaymentApiTests(PaymentOrderMixin, AuthedAPITestCase):
    def test_client_creates_an_order_without_sending_it(self):
        self._wallet("api-p1")
        res = self.client.post("/api/caisses/wallets/mine/payment-orders", {
            "direction": "COLLECTION", "operation": "MM_COLLECT", "amount": "120",
            "counterparty": "+243900000001", "currency": "USD", "idempotencyKey": "api-p1",
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "PENDING")
        self.assertEqual(res.data["amount"], "120.00")  # chaîne, jamais un float
        self.assertIs(res.data["awaitingReconciliation"], False)

    def test_client_cannot_read_another_clients_order(self):
        wallet = self._wallet("api-p2")
        order = self._order(wallet, key="api-p2")
        self.login(role="client", sub="api-p3")
        self.client.get("/api/rbac/me")
        res = self.client.get(f"/api/caisses/payments/{order.reference}")
        self.assertEqual(res.status_code, 404)

    def test_reconciliation_queue_is_closed_to_clients(self):
        self._wallet("api-p4")
        res = self.client.get("/api/caisses/payments/indeterminate")
        self.assertEqual(res.status_code, 403)

    def test_staff_sees_the_reconciliation_queue_and_the_journal(self):
        from . import payments
        wallet = self._wallet("api-p5")
        order = self._order(wallet, key="api-p5")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            payments.dispatch_payment_order(reference=order.reference, by="u")

        self.login(role="gest_caisse", sub="api-staff1")
        queue = self.client.get("/api/caisses/payments/indeterminate")
        self.assertEqual(queue.status_code, 200)
        self.assertEqual(queue.data["count"], 1)
        detail = self.client.get(f"/api/caisses/payments/{order.reference}")
        self.assertEqual(detail.status_code, 200)
        kinds = [e["kind"] for e in detail.data["events"]]
        self.assertIn("CREATED", kinds)
        self.assertIn("TRANSPORT_ERROR", kinds)

    def test_client_cannot_reconcile(self):
        wallet = self._wallet("api-p6")
        order = self._order(wallet, key="api-p6")
        res = self.client.post(f"/api/caisses/payments/{order.reference}/reconcile",
                               {"motive": "je veux mon argent"}, format="json")
        self.assertEqual(res.status_code, 403)


# ═══════════════════════════════════════ « UNE SEULE PORTE » : DÉPÔT/RETRAIT ↔ MAKUTA
#
# Le portefeuille est le seul point de contact avec l'extérieur : SEULS le dépôt et le retrait
# externes appellent Makuta. Un dépôt externe n'est jamais crédité avant confirmation ; un
# retrait externe n'est versé qu'après l'approbation humaine et le débit du portefeuille.

DEPOSIT_URL = "/api/caisses/wallets/mine/deposit"


@override_settings(MAKUTA=makuta_test_settings(BASE_URL="", PRIVATE_KEY_PEM=""))
class DepositChannelRoutingTests(PaymentOrderMixin, AuthedAPITestCase):
    """Makuta VOLONTAIREMENT non configuré (pas d'URL/clé) — l'état réel du projet aujourd'hui."""

    def test_internal_channel_credits_directly_and_returns_movement_kind(self):
        wallet = self._wallet("dch-1")
        res = self.client.post(DEPOSIT_URL, {"amount": "100", "currency": "USD", "channel": "agent",
                                             "idempotencyKey": "dch-1"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["kind"], "movement")
        self.assertEqual(res.data["detail"], "Dépôt effectué.")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("100.00"))

    def test_empty_channel_defaults_to_internal(self):
        """Compatibilité : l'ancien dépôt ne portait pas de canal — reste un dépôt interne."""
        wallet = self._wallet("dch-2")
        res = self.client.post(DEPOSIT_URL, {"amount": "50", "currency": "USD",
                                             "idempotencyKey": "dch-2"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["kind"], "movement")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("50.00"))

    def test_unknown_channel_is_rejected_422(self):
        self._wallet("dch-3")
        res = self.client.post(DEPOSIT_URL, {"amount": "10", "currency": "USD", "channel": "crypto",
                                             "idempotencyKey": "dch-3"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "unknown_channel")

    def test_external_channel_without_counterparty_is_rejected_422(self):
        self._wallet("dch-4")
        res = self.client.post(DEPOSIT_URL, {"amount": "10", "currency": "USD", "channel": "mobile_money",
                                             "idempotencyKey": "dch-4"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "counterparty_required")

    def test_external_deposit_unconfigured_stays_pending_and_credits_nothing(self):
        """Dégradation gracieuse : Makuta non branché → l'ordre est créé, PENDING, RIEN n'est
        envoyé et le portefeuille reste intact. Le dépôt ne casse pas, il attend."""
        wallet = self._wallet("dch-5")
        with patch("common.makuta.requests.post") as post:
            res = self.client.post(DEPOSIT_URL, {"amount": "100", "currency": "USD",
                                                 "channel": "mobile_money", "counterparty": "+243900000005",
                                                 "idempotencyKey": "dch-5"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["kind"], "payment_order")
        self.assertEqual(res.data["status"], "PENDING")
        self.assertEqual(post.call_count, 0)  # rien n'est parti
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_external_deposit_is_idempotent_one_order_only(self):
        from .models import PaymentOrder
        wallet = self._wallet("dch-6")
        body = {"amount": "100", "currency": "USD", "channel": "mobile_money",
                "counterparty": "+243900000006", "idempotencyKey": "dch-6"}
        first = self.client.post(DEPOSIT_URL, body, format="json")
        second = self.client.post(DEPOSIT_URL, body, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)  # rejeu idempotent
        self.assertEqual(second.data["kind"], "payment_order")
        self.assertEqual(second.data["reference"], first.data["reference"])
        self.assertEqual(PaymentOrder.objects.filter(wallet=wallet).count(), 1)

    def test_external_deposit_locks_the_wallet_row(self):
        """Verrou-espion : le dépôt externe verrouille la ligne portefeuille (`select_for_update`)
        avant toute écriture — la protection contre le double débit/crédit concurrent."""
        from django.db.models.query import QuerySet
        wallet = self._wallet("dch-7")
        locked_models: list[str] = []
        original = QuerySet.select_for_update

        def spy(self, *args, **kwargs):
            locked_models.append(self.model.__name__)
            return original(self, *args, **kwargs)

        with patch.object(QuerySet, "select_for_update", spy):
            res = self.client.post(DEPOSIT_URL, {"amount": "100", "currency": "USD",
                                                 "channel": "mobile_money", "counterparty": "+243900000007",
                                                 "idempotencyKey": "dch-7"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertIn("ClientWallet", locked_models)


@override_settings(MAKUTA=makuta_test_settings())
class ExternalDepositConfirmationTests(PaymentOrderMixin, AuthedAPITestCase):
    """Makuta configuré : le dépôt externe est transmis, mais le portefeuille n'est crédité
    qu'à la confirmation du fournisseur — jamais avant."""

    def test_awaiting_confirmation_does_not_credit(self):
        wallet = self._wallet("edc-1")
        with patch("common.makuta.requests.post",
                   return_value=_FakeHttpResponse(payload={"status": "PENDING"})):
            res = self.client.post(DEPOSIT_URL, {"amount": "100", "currency": "USD",
                                                 "channel": "mobile_money", "counterparty": "+243900000010",
                                                 "idempotencyKey": "edc-1"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["kind"], "payment_order")
        self.assertEqual(res.data["status"], "AWAITING_CONFIRMATION")
        self.assertIs(res.data["awaitingReconciliation"], True)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_provider_confirmation_credits_exactly_once(self):
        wallet = self._wallet("edc-2")
        with patch("common.makuta.requests.post",
                   return_value=_FakeHttpResponse(payload={"status": "SUCCESS", "transactionId": "MK-D2"})):
            res = self.client.post(DEPOSIT_URL, {"amount": "250", "currency": "USD",
                                                 "channel": "mobile_money", "counterparty": "+243900000011",
                                                 "idempotencyKey": "edc-2"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["kind"], "payment_order")
        self.assertEqual(res.data["status"], "CONFIRMED")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("250.00"))
        self.assertEqual(wallet.movements.count(), 1)

    def test_force_settle_confirms_a_pending_external_deposit_and_credits(self):
        """L'ordre est accusé (AWAITING) sans issue lisible, puis réglé par le staff sur preuve
        externe (relevé opérateur) — le crédit ne survient qu'à ce moment."""
        from . import payments
        wallet = self._wallet("edc-3")
        with patch("common.makuta.requests.post",
                   return_value=_FakeHttpResponse(payload={"status": "PENDING"})):
            res = self.client.post(DEPOSIT_URL, {"amount": "80", "currency": "USD",
                                                 "channel": "mobile_money", "counterparty": "+243900000012",
                                                 "idempotencyKey": "edc-3"}, format="json")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

        order = payments.force_settle(
            reference=res.data["reference"], outcome="CONFIRMED",
            motive="Relevé opérateur MM du 23/07 ligne 12 : encaissement effectif.", by="agent-1")
        self.assertEqual(order.status, "CONFIRMED")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("80.00"))


@override_settings(MAKUTA=makuta_test_settings(BASE_URL="", PRIVATE_KEY_PEM=""))
class ExternalWithdrawalSettlementTests(PaymentOrderMixin, AuthedAPITestCase):
    """Makuta non configuré : le décaissement est CRÉÉ au règlement (PENDING) mais non envoyé.
    On vérifie qu'il n'apparaît qu'APRÈS l'approbation, sans jamais re-débiter le portefeuille."""

    def test_above_threshold_creates_disbursement_only_after_approval(self):
        from . import withdrawal_tiers
        from .models import PaymentOrder
        wallet = self._wallet("xw-1", balance="10000")
        req = withdrawal_tiers.create_withdrawal_request(
            wallet_id=wallet.pk, amount="1000", idempotency_key="xw-1", by="xw-1",
            channel="mobile_money", counterparty="+243900000020")
        self.assertEqual(req.status, "pending_validation")
        self.assertIsNone(req.payout_order_id)
        self.assertEqual(PaymentOrder.objects.filter(wallet=wallet).count(), 0)  # aucun ordre avant approbation
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("10000.00"))  # pas encore débité

        req = withdrawal_tiers.approve(request_id=req.pk, approver_sub="mgr1", approver_role="gest_caisse")
        self.assertEqual(req.status, "posted")
        req.refresh_from_db()
        self.assertIsNotNone(req.payout_order_id)
        payout = PaymentOrder.objects.get(pk=req.payout_order_id)
        self.assertEqual(payout.direction, "PAYOUT")
        self.assertEqual(payout.status, "PENDING")  # non configuré -> non dispatché
        self.assertEqual(payout.amount, Decimal("1000.00"))
        self.assertEqual(payout.movement_id, req.movement_id)  # RÉUTILISE le mouvement de retrait
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("9000.00"))  # débité UNE fois
        self.assertEqual(wallet.movements.count(), 1)

    def test_auto_tier_external_creates_payout_at_settlement_without_double_debit(self):
        from . import withdrawal_tiers
        wallet = self._wallet("xw-2", balance="10000")
        req = withdrawal_tiers.create_withdrawal_request(
            wallet_id=wallet.pk, amount="100", idempotency_key="xw-2", by="xw-2",
            channel="mobile_money", counterparty="+243900000021")
        self.assertEqual(req.status, "posted")
        self.assertIsNotNone(req.payout_order_id)
        self.assertEqual(req.payout_order.direction, "PAYOUT")
        self.assertEqual(req.payout_order.movement_id, req.movement_id)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("9900.00"))
        self.assertEqual(wallet.movements.count(), 1)  # un seul débit

    def test_internal_withdrawal_creates_no_payout(self):
        from . import withdrawal_tiers
        from .models import PaymentOrder
        wallet = self._wallet("xw-3", balance="10000")
        req = withdrawal_tiers.create_withdrawal_request(
            wallet_id=wallet.pk, amount="100", idempotency_key="xw-3", by="xw-3")
        self.assertEqual(req.status, "posted")
        self.assertIsNone(req.payout_order_id)
        self.assertEqual(PaymentOrder.objects.filter(wallet=wallet).count(), 0)

    def test_external_withdrawal_via_api_without_counterparty_is_422(self):
        self._wallet("xw-4", balance="10000")
        res = self.client.post("/api/caisses/wallets/mine/withdraw",
                               {"amount": "100", "currency": "USD", "channel": "mobile_money",
                                "idempotencyKey": "xw-4"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "counterparty_required")

    def test_external_withdrawal_on_unconfigured_operation_is_503_without_debit(self):
        """Canal externe dont l'opération n'est pas au catalogue (`bank` → BANK_PAYOUT absent
        des fixtures) : refus propre (503) AVANT tout débit — on ne règle pas un retrait qu'on
        ne saura jamais verser."""
        wallet = self._wallet("xw-5", balance="10000")
        res = self.client.post("/api/caisses/wallets/mine/withdraw",
                               {"amount": "100", "currency": "USD", "channel": "bank",
                                "counterparty": "CD12-0001", "idempotencyKey": "xw-5"}, format="json")
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["code"], "external_withdrawal_unavailable")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("10000.00"))


@override_settings(MAKUTA=makuta_test_settings())
class ExternalWithdrawalDispatchTests(PaymentOrderMixin, AuthedAPITestCase):
    """Makuta configuré : au règlement, le décaissement est réellement transmis (post-commit)."""

    def test_settlement_dispatches_the_payout_when_makuta_is_configured(self):
        from . import withdrawal_tiers
        wallet = self._wallet("xwd-1", balance="10000")
        with patch("common.makuta.requests.post",
                   return_value=_FakeHttpResponse(payload={"status": "PENDING", "transactionId": "MK-P1"})) as post, \
                self.captureOnCommitCallbacks(execute=True):
            req = withdrawal_tiers.create_withdrawal_request(
                wallet_id=wallet.pk, amount="100", idempotency_key="xwd-1", by="xwd-1",
                channel="mobile_money", counterparty="+243900000030")
        self.assertEqual(post.call_count, 1)  # le décaissement a bien été envoyé
        payout = req.payout_order
        payout.refresh_from_db()
        self.assertEqual(payout.status, "AWAITING_CONFIRMATION")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("9900.00"))  # débit unique, pas de re-débit à l'envoi

    def test_refused_disbursement_returns_the_funds_to_the_wallet(self):
        """Décaissement externe refusé définitivement → contre-passation : les fonds débités
        au retrait reviennent au portefeuille (P3, append-only : un mouvement en plus, pas une
        rature). Le versement n'a pas eu lieu, le client est rendu entier."""
        from . import withdrawal_tiers
        wallet = self._wallet("xwd-2", balance="10000")
        refusal = _FakeHttpResponse(status_code=400, payload={"message": "numéro invalide"})
        with patch("common.makuta.requests.post", return_value=refusal), \
                self.captureOnCommitCallbacks(execute=True):
            req = withdrawal_tiers.create_withdrawal_request(
                wallet_id=wallet.pk, amount="100", idempotency_key="xwd-2", by="xwd-2",
                channel="mobile_money", counterparty="+243900000031")
        payout = req.payout_order
        payout.refresh_from_db()
        self.assertEqual(payout.status, "REFUSED")
        self.assertIsNotNone(payout.reversal_movement_id)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("10000.00"))  # débit rendu
        self.assertEqual(wallet.movements.count(), 2)  # WITHDRAW + REVERSAL


# ═══════════════════════════════════════ CAS LIMITES DE CRÉATION D'UN ORDRE
#
# Un ordre de paiement mal formé qui atteint la base est une dette de réconciliation : il
# faudra un humain pour décider de son sort. Tout ce qui peut être refusé AVANT écriture doit
# l'être avant écriture — d'où cette série, qui vérifie systématiquement les deux faces :
# l'exception est levée ET rien n'a été écrit (ni ordre, ni mouvement, ni solde touché).

@override_settings(MAKUTA=makuta_test_settings())
class PaymentOrderEdgeCaseTests(PaymentOrderMixin, AuthedAPITestCase):
    def _nothing_was_written(self, wallet, balance="0.00"):
        from .models import PaymentOrder
        wallet.refresh_from_db()
        self.assertEqual(PaymentOrder.objects.filter(wallet=wallet).count(), 0)
        self.assertEqual(wallet.movements.count(), 0)
        self.assertEqual(wallet.balance, Decimal(balance))

    def test_zero_amount_is_refused(self):
        wallet = self._wallet("edge-1")
        with self.assertRaises(ValidationFailed):
            self._order(wallet, amount="0", key="edge-1")
        self._nothing_was_written(wallet)

    def test_negative_amount_is_refused(self):
        """Un montant négatif sur un encaissement serait un débit déguisé."""
        wallet = self._wallet("edge-2", balance="500")
        with self.assertRaises(ValidationFailed):
            self._order(wallet, amount="-50", key="edge-2")
        self._nothing_was_written(wallet, balance="500.00")

    def test_negative_payout_cannot_inflate_a_wallet(self):
        wallet = self._wallet("edge-3", balance="500")
        with self.assertRaises(ValidationFailed):
            self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="-200",
                        key="edge-3")
        self._nothing_was_written(wallet, balance="500.00")

    def test_unreadable_amount_never_becomes_an_order(self):
        """`to_decimal` est tolérant et rend 0 sur une saisie illisible : c'est le contrôle
        « strictement positif » qui empêche « abc » de devenir un ordre à zéro."""
        wallet = self._wallet("edge-4")
        with self.assertRaises(ValidationFailed):
            self._order(wallet, amount="abc", key="edge-4")
        self._nothing_was_written(wallet)

    def test_amount_is_quantized_at_creation_and_never_a_float(self):
        """P4 : le montant est quantizé À LA CRÉATION — la référence, l'empreinte
        d'idempotence et le corps signé portent tous le même « 120.00 »."""
        from . import payments
        wallet = self._wallet("edge-5")
        order = self._order(wallet, amount="120.004", key="edge-5")
        self.assertEqual(order.amount, Decimal("120.00"))
        self.assertIsInstance(order.amount, Decimal)
        body = payments.payment_payload(order)
        self.assertEqual(body["amount"], "120.00")
        self.assertNotIsInstance(body["amount"], float)

    def test_treasury_account_in_another_currency_is_refused(self):
        """Devise incohérente : aucune conversion implicite dans un ordre de paiement."""
        from . import payments
        wallet = self._wallet("edge-6")
        TreasuryAccount.objects.create(code="MM-CDF", name="MM Congo", currency="CDF",
                                       balance=Decimal("0"))
        with self.assertRaises(ValidationFailed):
            payments.create_payment_order(
                wallet_id=wallet.pk, direction="COLLECTION", operation="MM_COLLECT",
                amount="100", counterparty="+243900000000", treasury_account_code="MM-CDF",
                idempotency_key="edge-6", by="u")
        self._nothing_was_written(wallet)

    def test_unknown_treasury_account_code_is_refused_instead_of_ignored(self):
        """Trou corrigé côté versement externe : un code inconnu était silencieusement
        remplacé par `None`, ce qui faisait perdre le rattachement du flux sans témoin."""
        from common.exceptions import NotFoundError
        from . import payments
        wallet = self._wallet("edge-7")
        with self.assertRaises(NotFoundError):
            payments.create_payment_order(
                wallet_id=wallet.pk, direction="COLLECTION", operation="MM_COLLECT",
                amount="100", counterparty="+243900000000", treasury_account_code="INEXISTANT",
                idempotency_key="edge-7", by="u")
        self._nothing_was_written(wallet)

    def test_operation_and_direction_must_agree(self):
        """Un « encaissement » posté sur le chemin de décaissement enverrait de l'argent en
        croyant en recevoir. Le sens et l'opération doivent raconter la même histoire."""
        wallet = self._wallet("edge-8", balance="500")
        with self.assertRaises(ValidationFailed):
            self._order(wallet, direction="COLLECTION", operation="MM_PAYOUT", key="edge-8")
        self._nothing_was_written(wallet, balance="500.00")

    def test_payout_direction_on_a_collect_operation_is_refused(self):
        wallet = self._wallet("edge-9", balance="500")
        with self.assertRaises(ValidationFailed):
            self._order(wallet, direction="PAYOUT", operation="MM_COLLECT", key="edge-9")
        self._nothing_was_written(wallet, balance="500.00")

    def test_unknown_direction_is_refused(self):
        wallet = self._wallet("edge-10")
        with self.assertRaises(ValidationFailed):
            self._order(wallet, direction="VIREMENT_MAGIQUE", key="edge-10")
        self._nothing_was_written(wallet)

    def test_counterparty_is_required(self):
        from . import payments
        wallet = self._wallet("edge-11")
        with self.assertRaises(ValidationFailed):
            payments.create_payment_order(
                wallet_id=wallet.pk, direction="COLLECTION", operation="MM_COLLECT",
                amount="100", counterparty="", idempotency_key="edge-11", by="u")
        self._nothing_was_written(wallet)

    def test_overlong_counterparty_is_refused_rather_than_truncated(self):
        """SQLite tronquerait en silence : un numéro Mobile Money tronqué, c'est un versement
        à quelqu'un d'autre."""
        from . import payments
        wallet = self._wallet("edge-12")
        with self.assertRaises(ValidationFailed):
            payments.create_payment_order(
                wallet_id=wallet.pk, direction="COLLECTION", operation="MM_COLLECT",
                amount="100", counterparty="+" + "9" * 90, idempotency_key="edge-12", by="u")
        self._nothing_was_written(wallet)

    def test_metadata_that_is_not_an_object_is_refused_at_creation(self):
        """Sinon le rendu du gabarit échouerait À L'ENVOI, sur un ordre déjà créé."""
        from . import payments
        wallet = self._wallet("edge-13")
        with self.assertRaises(ValidationFailed):
            payments.create_payment_order(
                wallet_id=wallet.pk, direction="COLLECTION", operation="MM_COLLECT",
                amount="100", counterparty="+243900000000", metadata="pas-un-objet",
                idempotency_key="edge-13", by="u")
        self._nothing_was_written(wallet)

    def test_blocked_wallet_accepts_no_payment_order(self):
        wallet = self._wallet("edge-14", balance="500")
        wallet.status = ClientWallet.Status.BLOQUE
        wallet.save(update_fields=["status"])
        with self.assertRaises(ConflictError):
            self._order(wallet, key="edge-14")
        self._nothing_was_written(wallet, balance="500.00")

    def test_two_payouts_cannot_spend_the_same_balance_twice(self):
        """Le solde est relu sous verrou à chaque réservation : deux décaissements de 60 sur
        un solde de 100 ne peuvent pas passer tous les deux."""
        wallet = self._wallet("edge-15", balance="100")
        self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="60", key="edge-15a")
        with self.assertRaises(InsufficientFundsError):
            self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="60",
                        key="edge-15b")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("40.00"))
        self.assertEqual(wallet.movements.count(), 1)

    def test_payout_creation_and_dispatch_lock_the_rows_they_move(self):
        """Verrou-espion : la réservation verrouille le portefeuille, l'envoi verrouille
        l'ordre. C'est ce qui interdit qu'un second envoi concurrent parte en parallèle."""
        from django.db.models.query import QuerySet
        from . import payments
        wallet = self._wallet("edge-16", balance="500")
        locked: list[str] = []
        original = QuerySet.select_for_update

        def spy(self, *args, **kwargs):
            locked.append(self.model.__name__)
            return original(self, *args, **kwargs)

        with patch.object(QuerySet, "select_for_update", spy):
            order = self._order(wallet, direction="PAYOUT", operation="MM_PAYOUT", amount="100",
                                key="edge-16")
            self.assertIn("ClientWallet", locked)
            locked.clear()
            with patch("common.makuta.requests.post",
                       return_value=_FakeHttpResponse(payload={"status": "PENDING"})):
                payments.dispatch_payment_order(reference=order.reference, by="u")
        self.assertIn("PaymentOrder", locked)


@override_settings(MAKUTA=makuta_test_settings())
class PaymentChannelEdgeCaseTests(PaymentOrderMixin, AuthedAPITestCase):
    WITHDRAW_URL = "/api/caisses/wallets/mine/withdraw"

    def test_unknown_channel_on_withdrawal_is_422(self):
        self._wallet("chan-1", balance="500")
        res = self.client.post(self.WITHDRAW_URL, {"amount": "10", "currency": "USD",
                                                   "channel": "pigeon-voyageur",
                                                   "idempotencyKey": "chan-1"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "unknown_channel")

    def test_unknown_channel_on_withdrawal_debits_nothing(self):
        wallet = self._wallet("chan-2", balance="500")
        self.client.post(self.WITHDRAW_URL, {"amount": "10", "currency": "USD",
                                             "channel": "pigeon-voyageur",
                                             "idempotencyKey": "chan-2"}, format="json")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("500.00"))
        self.assertEqual(wallet.movements.count(), 0)

    def test_external_withdrawal_without_counterparty_is_422(self):
        self._wallet("chan-3", balance="500")
        res = self.client.post(self.WITHDRAW_URL, {"amount": "10", "currency": "USD",
                                                   "channel": "mobile_money",
                                                   "idempotencyKey": "chan-3"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "counterparty_required")

    def test_internal_channel_has_no_external_operation(self):
        """`collect_operation("agent")` levait un `KeyError` (500 opaque) : c'est désormais un
        refus métier nommé."""
        from . import channels
        with self.assertRaises(ValidationFailed):
            channels.collect_operation("agent")
        with self.assertRaises(ValidationFailed):
            channels.payout_operation("")

    def test_the_operation_catalogue_and_the_channels_stay_in_step(self):
        """Principe 6 : la liste que `check_makuta` déroule est DÉRIVÉE des canaux, jamais
        recopiée. Ce test tombe si quelqu'un ajoute un canal externe sans son opération."""
        from . import channels
        required = channels.required_operations()
        self.assertEqual(set(required), {"MM_COLLECT", "MM_PAYOUT", "BANK_COLLECT", "BANK_PAYOUT"})
        for channel in channels.EXTERNAL_CHANNELS:
            self.assertIn(channels.collect_operation(channel), required)
            self.assertIn(channels.payout_operation(channel), required)


# ═══════════════════════════════════════ RÉCONCILIATION AUTOMATISÉE (EN LOT)
#
# La règle qui tient tout : la commande RELIT, elle ne décide pas. Ces tests vérifient les
# deux moitiés — qu'elle applique fidèlement ce que le fournisseur affirme, et qu'elle laisse
# intact tout ce dont le fournisseur ne dit rien de lisible.

@override_settings(MAKUTA=makuta_test_settings())
class BatchReconciliationTests(PaymentOrderMixin, AuthedAPITestCase):
    def _indeterminate(self, wallet, *, amount="300", key="rec", direction="COLLECTION",
                       operation="MM_COLLECT"):
        from . import payments
        order = self._order(wallet, amount=amount, key=key, direction=direction,
                            operation=operation)
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            return payments.dispatch_payment_order(reference=order.reference, by="u")

    def test_batch_confirms_what_the_provider_confirms_and_credits_once(self):
        from . import payments
        wallet = self._wallet("bat-1")
        order = self._indeterminate(wallet, amount="300", key="bat-1")
        read = _FakeHttpResponse(payload={"status": "SUCCESS", "transactionId": "MK-1"})
        with patch("common.makuta.requests.get", return_value=read), \
                patch("common.makuta.requests.post") as post:
            report = payments.reconcile_open_orders(by="ops-1")
        self.assertEqual(post.call_count, 0)  # réconcilier n'est JAMAIS rejouer
        self.assertEqual(report["totals"], {"CONFIRMED": 1})
        order.refresh_from_db()
        wallet.refresh_from_db()
        self.assertEqual(order.status, "CONFIRMED")
        self.assertEqual(wallet.balance, Decimal("300.00"))
        self.assertEqual(wallet.movements.count(), 1)

    def test_running_the_batch_twice_credits_once(self):
        """Idempotence : un ordre résolu quitte la file, un second passage ne le revoit pas."""
        from . import payments
        wallet = self._wallet("bat-2")
        self._indeterminate(wallet, amount="150", key="bat-2")
        read = _FakeHttpResponse(payload={"status": "SUCCESS"})
        with patch("common.makuta.requests.get", return_value=read) as get:
            payments.reconcile_open_orders(by="ops-1")
            second = payments.reconcile_open_orders(by="ops-1")
        self.assertEqual(get.call_count, 1)  # le second passage ne relit même pas
        self.assertEqual(second["results"], [])
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("150.00"))
        self.assertEqual(wallet.movements.count(), 1)

    def test_unreadable_status_leaves_the_order_for_a_human(self):
        """Principe 2 : ce que le paramétrage ne sait pas lire n'est PAS tranché par l'outil."""
        from . import payments
        wallet = self._wallet("bat-3")
        order = self._indeterminate(wallet, key="bat-3")
        with patch("common.makuta.requests.get",
                   return_value=_FakeHttpResponse(payload={"status": "MYSTERE"})):
            report = payments.reconcile_open_orders(by="ops-1")
        self.assertEqual(report["totals"], {"UNREADABLE_STATUS": 1})
        order.refresh_from_db()
        wallet.refresh_from_db()
        self.assertEqual(order.status, "INDETERMINATE")
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_provider_refusal_read_in_batch_gives_the_funds_back(self):
        from . import payments
        wallet = self._wallet("bat-4", balance="500")
        order = self._indeterminate(wallet, amount="200", key="bat-4", direction="PAYOUT",
                                    operation="MM_PAYOUT")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("300.00"))  # fonds réservés
        with patch("common.makuta.requests.get",
                   return_value=_FakeHttpResponse(payload={"status": "FAILED"})):
            report = payments.reconcile_open_orders(by="ops-1")
        self.assertEqual(report["totals"], {"REFUSED": 1})
        order.refresh_from_db()
        wallet.refresh_from_db()
        self.assertEqual(order.status, "REFUSED")
        self.assertIsNotNone(order.reversal_movement_id)
        self.assertEqual(wallet.balance, Decimal("500.00"))

    def test_an_unreachable_provider_does_not_stop_the_batch(self):
        """Une coupure sur un ordre ne doit pas priver les suivants de leur relecture."""
        from . import payments
        wallet = self._wallet("bat-5")
        first = self._indeterminate(wallet, amount="100", key="bat-5a")
        second = self._indeterminate(wallet, amount="200", key="bat-5b")
        responses = [requests.ConnectionError("coupure"),
                     _FakeHttpResponse(payload={"status": "SUCCESS"})]
        with patch("common.makuta.requests.get", side_effect=responses):
            report = payments.reconcile_open_orders(by="ops-1")
        self.assertEqual(report["totals"], {"UNREACHABLE": 1, "CONFIRMED": 1})
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.status, "INDETERMINATE")  # inchangé
        self.assertEqual(second.status, "CONFIRMED")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("200.00"))

    def test_dry_run_reads_nothing_and_writes_nothing(self):
        from . import payments
        wallet = self._wallet("bat-6")
        order = self._indeterminate(wallet, key="bat-6")
        events_before = order.events.count()
        with patch("common.makuta.requests.get") as get, patch("common.makuta.requests.post") as post:
            report = payments.reconcile_open_orders(by="ops-1", dry_run=True)
        self.assertEqual(get.call_count, 0)
        self.assertEqual(post.call_count, 0)
        self.assertEqual(report["totals"], {"WOULD_READ": 1})
        order.refresh_from_db()
        self.assertEqual(order.status, "INDETERMINATE")
        self.assertEqual(order.events.count(), events_before)

    def test_a_named_reference_that_is_already_settled_is_reported_not_replayed(self):
        from . import payments
        wallet = self._wallet("bat-7")
        order = self._order(wallet, key="bat-7")
        with patch("common.makuta.requests.post",
                   return_value=_FakeHttpResponse(payload={"status": "SUCCESS"})):
            payments.dispatch_payment_order(reference=order.reference, by="u")
        with patch("common.makuta.requests.get") as get:
            report = payments.reconcile_open_orders(references=[order.reference], by="ops-1")
        self.assertEqual(get.call_count, 0)
        self.assertEqual(report["totals"], {"NOT_OPEN": 1})

    def test_an_unknown_reference_is_reported_not_swallowed(self):
        from . import payments
        report = payments.reconcile_open_orders(references=["AGC-INEXISTANTE"], by="ops-1")
        self.assertEqual(report["totals"], {"NOT_FOUND": 1})

    def test_the_batch_journals_every_reading_with_its_motive(self):
        """P3 : chaque relecture laisse une trace, motif compris — « l'ordre est passé de
        INDETERMINATE à CONFIRMED » sans auteur ni motif n'est pas une preuve."""
        from . import payments
        wallet = self._wallet("bat-8")
        order = self._indeterminate(wallet, key="bat-8")
        with patch("common.makuta.requests.get",
                   return_value=_FakeHttpResponse(payload={"status": "SUCCESS"})):
            payments.reconcile_open_orders(by="ops-9")
        confirmation = order.events.filter(kind="CONFIRMED").first()
        self.assertIsNotNone(confirmation)
        self.assertEqual(confirmation.source, "RECONCILIATION")
        self.assertEqual(confirmation.actor, "ops-9")
        self.assertIn("relecture", confirmation.motive.lower())

    def test_status_filter_narrows_the_queue(self):
        from . import payments
        wallet = self._wallet("bat-9")
        self._indeterminate(wallet, key="bat-9")
        report = payments.reconcile_open_orders(status="AWAITING_CONFIRMATION", dry_run=True)
        self.assertEqual(report["results"], [])


@override_settings(MAKUTA=makuta_test_settings(OPERATIONS={
    "MM_COLLECT": {"path": "/fixture/collect",
                   "body": {"amount": "{amount}", "partnerReference": "{reference}"}},
}))
class BatchReconciliationWithoutStatusPathTests(PaymentOrderMixin, AuthedAPITestCase):
    """Cas RÉEL tant que Wolf Technologies n'a pas fourni son chemin de relecture : on peut
    émettre un paiement mais pas en relire l'issue. L'outil doit le dire, pas le masquer."""

    def test_missing_status_path_is_named_not_guessed(self):
        from . import payments
        wallet = self._wallet("nsp-1")
        order = self._order(wallet, key="nsp-1")
        with patch("common.makuta.requests.post", side_effect=requests.ConnectionError("coupure")):
            payments.dispatch_payment_order(reference=order.reference, by="u")
        with patch("common.makuta.requests.get") as get:
            report = payments.reconcile_open_orders(by="ops-1")
        self.assertEqual(get.call_count, 0)  # on ne devine aucun chemin
        self.assertEqual(report["totals"], {"CONTRACT_MISSING": 1})
        order.refresh_from_db()
        self.assertEqual(order.status, "INDETERMINATE")


@override_settings(MAKUTA=makuta_test_settings(BASE_URL="", PRIVATE_KEY_PEM=""))
class BatchReconciliationUnconfiguredTests(PaymentOrderMixin, AuthedAPITestCase):
    """État actuel du projet : Makuta n'est pas branché. La commande doit le DIRE et ne
    toucher à rien — un outil qui explose sur une intégration absente n'apprend rien."""

    def test_nothing_is_touched_and_the_degradation_is_explicit(self):
        from . import payments
        wallet = self._wallet("unc-1")
        order = self._order(wallet, key="unc-1")
        order.status = "INDETERMINATE"
        order.save(update_fields=["status"])
        events_before = order.events.count()
        with patch("common.makuta.requests.get") as get, patch("common.makuta.requests.post") as post:
            report = payments.reconcile_open_orders(by="ops-1")
        self.assertFalse(report["configured"])
        self.assertEqual(get.call_count, 0)
        self.assertEqual(post.call_count, 0)
        self.assertIn("non configurée", report["degradation"])
        self.assertIn("check_makuta", report["degradation"])
        self.assertEqual(report["scanned"], 1)
        order.refresh_from_db()
        self.assertEqual(order.status, "INDETERMINATE")
        self.assertEqual(order.events.count(), events_before)
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, Decimal("0.00"))

    def test_the_command_runs_and_reports_the_degradation(self):
        from django.core.management import call_command
        out = StringIO()
        call_command("reconcile_payment_orders", stdout=out)
        printed = out.getvalue()
        self.assertIn("non configurée", printed)
        self.assertIn("check_makuta", printed)


# ═══════════════════════════════════════ DIAGNOSTIC DU CONTRAT FOURNISSEUR
#
# `check_makuta` n'a qu'une obligation morale : ne rien inventer. Un chemin absent reste
# absent — il n'est jamais « probablement /api/collect ». Ces tests protègent cette promesse.

def makuta_complete_settings(**overrides) -> dict:
    """Contrat fournisseur COMPLET — la cible, pas l'état actuel. Sert à vérifier que le
    diagnostic sait aussi dire « rien ne manque »."""
    _private, public = _test_key_pair()
    operation = {
        "path": "/api/op", "method": "POST",
        "body": {"amount": "{amount}", "msisdn": "{counterparty}", "partnerRef": "{reference}"},
        "status_path": "/api/transactions/{reference}",
    }
    config = makuta_test_settings(
        CALLBACK_PUBLIC_KEY_PEM=public,
        CALLBACK_SIGNATURE_HEADER="X-Makuta-Signature",
        OPERATIONS={name: dict(operation) for name in
                    ("MM_COLLECT", "MM_PAYOUT", "BANK_COLLECT", "BANK_PAYOUT")},
    )
    config.update(overrides)
    return config


class MakutaDiagnosticsTests(AuthedAPITestCase):
    def _item(self, report: dict, key: str) -> dict:
        for section in report["sections"]:
            for item in section["items"]:
                if item["key"] == key:
                    return item
        self.fail(f"Point de contrôle « {key} » absent du diagnostic.")

    @override_settings(MAKUTA={})
    def test_an_empty_configuration_names_every_missing_operation(self):
        from . import makuta_diagnostics
        report = makuta_diagnostics.diagnose()
        self.assertFalse(report["operational"])
        keys = {item["key"] for section in report["sections"] for item in section["items"]}
        for operation in ("MM_COLLECT", "MM_PAYOUT", "BANK_COLLECT", "BANK_PAYOUT"):
            self.assertIn(f"{operation}.*", keys)
        self.assertGreater(report["counts"]["blocking"], 0)
        self.assertTrue(report["questions"])

    @override_settings(MAKUTA={})
    def test_the_diagnostic_invents_no_value(self):
        """Aucun chemin n'est proposé quand rien n'est configuré : le diagnostic liste des
        MANQUES, il ne remplit pas les blancs."""
        from . import makuta_diagnostics
        report = makuta_diagnostics.diagnose()
        details = " ".join(item["detail"] for section in report["sections"]
                           for item in section["items"]
                           if item["state"] == makuta_diagnostics.MISSING)
        self.assertNotIn("/api/", details)

    @override_settings(MAKUTA=makuta_complete_settings())
    def test_a_complete_contract_has_no_blocking_point(self):
        from . import makuta_diagnostics
        report = makuta_diagnostics.diagnose()
        blocking = [item["key"] for section in report["sections"] for item in section["items"]
                    if item["state"] in makuta_diagnostics.BLOCKING_STATES]
        self.assertEqual(blocking, [])
        self.assertTrue(report["operational"])

    @override_settings(MAKUTA=makuta_complete_settings(OPERATIONS={
        "MM_COLLECT": {"path": "/api/op", "method": "POST",
                       "body": {"amount": "{amount}"},
                       "status_path": "/api/transactions/{reference}"},
    }))
    def test_a_body_without_our_reference_is_flagged_as_a_gap(self):
        """Sans notre référence dans la requête, aucun rappel ni relevé n'est rattachable :
        c'est la réconciliation qui devient impossible."""
        from . import makuta_diagnostics
        report = makuta_diagnostics.diagnose()
        self.assertEqual(self._item(report, "MM_COLLECT.body")["state"], makuta_diagnostics.GAP)

    @override_settings(MAKUTA=makuta_complete_settings(OPERATIONS={
        "MM_COLLECT": {"path": "/api/op", "method": "POST",
                       "body": {"partnerRef": "{reference}"},
                       "status_path": "/api/transactions"},
    }))
    def test_a_status_path_without_an_identifier_is_flagged_as_a_gap(self):
        from . import makuta_diagnostics
        report = makuta_diagnostics.diagnose()
        self.assertEqual(self._item(report, "MM_COLLECT.status_path")["state"],
                         makuta_diagnostics.GAP)

    @override_settings(MAKUTA=makuta_complete_settings(OPERATIONS={
        "MM_COLLECT": {"path": "/api/op", "method": "PATCH",
                       "body": {"partnerRef": "{reference}"},
                       "status_path": "/api/transactions/{reference}"},
    }))
    def test_a_method_the_connector_cannot_emit_is_flagged_as_a_gap(self):
        from . import makuta_diagnostics
        report = makuta_diagnostics.diagnose()
        self.assertEqual(self._item(report, "MM_COLLECT.method")["state"], makuta_diagnostics.GAP)


class CheckMakutaCommandTests(AuthedAPITestCase):
    @override_settings(MAKUTA={})
    def test_the_command_runs_unconfigured_and_prints_the_checklist(self):
        from django.core.management import call_command
        out = StringIO()
        call_command("check_makuta", stdout=out)
        printed = out.getvalue()
        self.assertIn("DIAGNOSTIC MAKUTA", printed)
        self.assertIn("A DEMANDER A WOLF TECHNOLOGIES", printed)
        for operation in ("MM_COLLECT", "MM_PAYOUT", "BANK_COLLECT", "BANK_PAYOUT"):
            self.assertIn(operation, printed)
        self.assertIn("[MANQUE]", printed)

    @override_settings(MAKUTA={})
    def test_json_output_is_machine_readable(self):
        import json
        from django.core.management import call_command
        out = StringIO()
        call_command("check_makuta", "--format", "json", stdout=out)
        report = json.loads(out.getvalue())
        self.assertFalse(report["operational"])
        self.assertGreater(report["counts"]["blocking"], 0)

    @override_settings(MAKUTA={})
    def test_strict_mode_exits_non_zero_while_a_blocking_point_remains(self):
        from django.core.management import call_command
        with self.assertRaises(SystemExit):
            call_command("check_makuta", "--strict", stdout=StringIO())

    @override_settings(MAKUTA=makuta_complete_settings())
    def test_strict_mode_is_silent_when_the_contract_is_complete(self):
        from django.core.management import call_command
        out = StringIO()
        call_command("check_makuta", "--strict", stdout=out)
        self.assertIn("Aucun point bloquant", out.getvalue())

    @override_settings(MAKUTA={})
    def test_the_command_makes_no_network_call(self):
        from django.core.management import call_command
        with patch("common.makuta.requests.get") as get, patch("common.makuta.requests.post") as post:
            call_command("check_makuta", stdout=StringIO())
        self.assertEqual(get.call_count, 0)
        self.assertEqual(post.call_count, 0)

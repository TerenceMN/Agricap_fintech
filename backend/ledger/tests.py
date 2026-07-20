from __future__ import annotations

from datetime import date

from common.exceptions import ValidationFailed
from common.testing import AuthedAPITestCase

from . import services
from .models import ChartAccount


class LedgerServiceTests(AuthedAPITestCase):
    def setUp(self):
        # Codes suffixés "T" (test) pour ne pas entrer en collision avec les comptes
        # SYSCOHADA réels 501/701 amorcés par la migration 0002 (code unique en base).
        self.caisse = ChartAccount.objects.create(code="501T", name="Caisse", class_no=5)
        self.produit = ChartAccount.objects.create(code="701T", name="Produits", class_no=7)

    def test_post_balanced_entry(self):
        entry = services.post_journal_entry(
            date=date(2026, 1, 1), piece_ref="P-1", code="JCA", currency="USD",
            lines=[{"account": "501T", "debit": "100", "credit": "0"},
                   {"account": "701T", "debit": "0", "credit": "100"}],
            idempotency_key="j1", by="u",
        )
        self.assertEqual(entry.lines.count(), 2)

    def test_unbalanced_entry_rejected(self):
        with self.assertRaises(ValidationFailed):
            services.post_journal_entry(
                date=date(2026, 1, 1), piece_ref="P-2", code="JCA", currency="USD",
                lines=[{"account": "501T", "debit": "100", "credit": "0"},
                       {"account": "701T", "debit": "0", "credit": "50"}],
                idempotency_key="j2", by="u",
            )

    def test_duplicate_piece_ref_rejected(self):
        services.post_journal_entry(
            date=date(2026, 1, 1), piece_ref="P-3", code="JCA", currency="USD",
            lines=[{"account": "501T", "debit": "40", "credit": "0"},
                   {"account": "701T", "debit": "0", "credit": "40"}],
            idempotency_key="j3", by="u",
        )
        with self.assertRaises(ValidationFailed):
            services.post_journal_entry(
                date=date(2026, 1, 1), piece_ref="P-3", code="JCA", currency="USD",
                lines=[{"account": "501T", "debit": "1", "credit": "0"},
                       {"account": "701T", "debit": "0", "credit": "1"}],
                idempotency_key="j4", by="u",
            )

    def test_trial_balance_reflects_postings(self):
        services.post_journal_entry(
            date=date(2026, 1, 1), piece_ref="P-5", code="JCA", currency="USD",
            lines=[{"account": "501T", "debit": "40", "credit": "0"},
                   {"account": "701T", "debit": "0", "credit": "40"}],
            idempotency_key="j5", by="u",
        )
        row = next(r for r in services.trial_balance() if r["code"] == "501T")
        self.assertEqual(row["debit"], 40.0)


class FinancialStatementsTests(AuthedAPITestCase):
    """Scénario réaliste sur les vrais comptes SYSCOHADA amorcés par la migration 0002/0003
    (pas des codes de test) : dépôt client Orange Money, décaissement de crédit, commission
    bancaire, intérêts perçus — vérifie Bilan/Résultat/SIG/Flux de trésorerie ensemble."""

    def setUp(self):
        # Dépôt client via Orange Money : la trésorerie augmente, la dette envers le client aussi.
        services.post_journal_entry(
            date=date(2026, 1, 1), piece_ref="FS-1", code="JMM", currency="USD",
            lines=[{"account": "5382", "debit": "1000", "credit": "0"},
                   {"account": "4111", "debit": "0", "credit": "1000"}],
            idempotency_key="fs1", by="u",
        )
        # Décaissement d'un crédit depuis la caisse.
        services.post_journal_entry(
            date=date(2026, 1, 2), piece_ref="FS-2", code="JCR", currency="USD",
            lines=[{"account": "4121", "debit": "500", "credit": "0"},
                   {"account": "571", "debit": "0", "credit": "500"}],
            idempotency_key="fs2", by="u",
        )
        # Commission bancaire prélevée par Orange Money.
        services.post_journal_entry(
            date=date(2026, 1, 3), piece_ref="FS-3", code="JMM", currency="USD",
            lines=[{"account": "631", "debit": "20", "credit": "0"},
                   {"account": "5382", "debit": "0", "credit": "20"}],
            idempotency_key="fs3", by="u",
        )
        # Intérêts perçus sur un crédit, encaissés en caisse.
        services.post_journal_entry(
            date=date(2026, 1, 4), piece_ref="FS-4", code="JCR", currency="USD",
            lines=[{"account": "571", "debit": "100", "credit": "0"},
                   {"account": "771", "debit": "0", "credit": "100"}],
            idempotency_key="fs4", by="u",
        )

    def test_bilan_splits_class4_by_nature_not_by_class(self):
        bilan = services.financial_statements(kind="bilan")
        actif_codes = {r["code"] for r in bilan["actif"]}
        passif_codes = {r["code"] for r in bilan["passif"]}
        # 4121 (Crédits à court terme) est un compte de tiers ACTIF -> doit être à l'actif,
        # pas mécaniquement rangé en passif au seul motif qu'il est en classe 4.
        self.assertIn("4121", actif_codes)
        self.assertIn("5382", actif_codes)
        self.assertIn("571", actif_codes)
        self.assertIn("4111", passif_codes)  # dette envers le client (compte épargne)
        self.assertNotIn("4121", passif_codes)

        orange_money = next(r for r in bilan["actif"] if r["code"] == "5382")
        self.assertEqual(orange_money["balance"], 980.0)  # 1000 - 20 de commission

    def test_resultat_net_matches_produits_moins_charges(self):
        resultat = services.financial_statements(kind="resultat")
        total_charges = sum(r["balance"] for r in resultat["charges"])
        total_produits = sum(r["balance"] for r in resultat["produits"])
        self.assertEqual(total_charges, 20.0)
        self.assertEqual(total_produits, 100.0)

    def test_sig_cascade_reconciles_with_simple_resultat(self):
        sig = services.financial_statements(kind="sig")
        rows = {r["label"]: r["amount"] for r in sig["rows"]}
        # 631 (frais Mobile Money) est déduit des commissions nettes, pas de la marge
        # financière (classe 67 seule) — reflète la structure d'un établissement de crédit.
        self.assertEqual(rows["Marge financière"], 100.0)  # 771 seul, 67 non posté
        self.assertEqual(rows["Commissions nettes (transactions, Mobile Money)"], -20.0)
        # Le résultat net de la cascade doit reconcilier avec le calcul simple (produits
        # moins charges), quel que soit le chemin emprunté par la cascade intermédiaire.
        self.assertEqual(rows["Résultat net de l'exercice"], 80.0)

    def test_cashflow_variation_matches_treasury_balance_delta(self):
        cashflow = services.financial_statements(kind="cashflow")
        trial = {r["code"]: r for r in services.trial_balance()}
        treasury_delta = trial["5382"]["balance"] + trial["571"]["balance"]
        self.assertEqual(cashflow["variationTresorerie"], treasury_delta)

    def test_provisions_report_lists_depreciation_accounts_even_unposted(self):
        provisions = services.financial_statements(kind="provisions")
        codes = {r["code"] for r in provisions["rows"]}
        self.assertIn("491", codes)  # Dépréciations des comptes clients — jamais posté ici
        row_491 = next(r for r in provisions["rows"] if r["code"] == "491")
        self.assertEqual(row_491["balance"], 0.0)

    def test_creances_report_flags_doubtful_account(self):
        creances = services.financial_statements(kind="creances")
        codes = {r["code"] for r in creances["rows"]}
        self.assertIn("411", codes)
        self.assertIn("4121", codes)
        row_416 = next(r for r in creances["rows"] if r["code"] == "416")
        self.assertTrue(row_416["risque"])


class ChartAccountCoreActivityTests(AuthedAPITestCase):
    """Vérifie que le plan comptable distingue bien l'activité réelle d'AGRICAP FINTECH
    (prêteur bi-monnaie) des comptes présents uniquement pour la conformité SYSCOHADA."""

    def test_lending_and_treasury_accounts_are_core(self):
        for code in ("5382", "4111", "4121", "571", "631", "771", "411", "491"):
            account = ChartAccount.objects.get(code=code)
            self.assertTrue(account.is_core_activity, f"{code} devrait être core_activity=True")

    def test_immobilisations_stocks_and_hao_are_not_core(self):
        for code in ("21", "31", "83"):  # classes 2, 3, 8
            account = ChartAccount.objects.get(code=code)
            self.assertFalse(account.is_core_activity, f"{code} devrait être core_activity=False")

    def test_trading_specific_accounts_are_not_core(self):
        for code in ("601", "701", "72", "73"):
            account = ChartAccount.objects.get(code=code)
            self.assertFalse(account.is_core_activity, f"{code} devrait être core_activity=False")


class LedgerAccountLinesApiTests(AuthedAPITestCase):
    def test_account_lines_running_balance(self):
        ChartAccount.objects.create(code="501L", name="Caisse L", class_no=5)
        ChartAccount.objects.create(code="701L", name="Produits L", class_no=7)
        services.post_journal_entry(
            date=date(2026, 1, 1), piece_ref="PL-1", code="JCA", currency="USD",
            lines=[{"account": "501L", "debit": "100", "credit": "0"},
                   {"account": "701L", "debit": "0", "credit": "100"}],
            idempotency_key="jl1", by="u",
        )
        services.post_journal_entry(
            date=date(2026, 1, 2), piece_ref="PL-2", code="JCA", currency="USD",
            lines=[{"account": "701L", "debit": "30", "credit": "0"},
                   {"account": "501L", "debit": "0", "credit": "30"}],
            idempotency_key="jl2", by="u",
        )
        self.login(role="dg", sub="u-ledger")
        res = self.client.get("/api/ledger/accounts/501L/lines")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 2)
        self.assertEqual(res.data[0]["balance"], 100.0)
        self.assertEqual(res.data[1]["balance"], 70.0)

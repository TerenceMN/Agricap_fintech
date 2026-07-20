from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest.mock import Mock, patch

from common.exceptions import ValidationFailed
from common.testing import AuthedAPITestCase

from . import services

# Extrait représentatif du format réel bcc.cd : une ligne par devise, colonnes
# acheteur/vendeur masquées en commentaire HTML, seul le « Cours indicatif » est visible.
_BCC_HTML_SAMPLE = """
<table class="table">
<tbody>
<tr class=""><th scope="row">1</th><td>AOA</td><td>KWANZA  ANGOLAIS</td>
<!-- <td>2,4037</td> --><td>2,4592</td><!-- <td>2,5146</td>--></tr>
<tr class="table-info"><th scope="row">1</th><td>USD</td><td>DOLLAR AMERICAIN</td>
<!-- <td>2 201,4948</td> --><td>2 252,2900</td><!-- <td>2 303,0852</td>--></tr>
<tr class=""><th scope="row">1</th><td>EUR</td><td>EURO</td>
<!-- <td>2 510,0860</td> --><td>2 568,0014</td><!-- <td>2 625,9167</td>--></tr>
</tbody>
</table>
"""


class FxServiceTests(AuthedAPITestCase):
    def test_client_margin_below_1_5_percent_rejected(self):
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=date(2026, 1, 1), by="u")
        with self.assertRaises(ValidationFailed):
            services.set_rate(tier="CLIENT", currency="USD", buy="2795", sell="2805",  # marge < 1.5%
                               effective_date=date(2026, 1, 1), by="u")

    def test_client_margin_ok(self):
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=date(2026, 1, 1), by="u")
        rate = services.set_rate(tier="CLIENT", currency="USD", buy="2800", sell="2850",
                                  effective_date=date(2026, 1, 1), by="u")
        self.assertEqual(rate.tier, "CLIENT")

    def test_sell_must_exceed_buy(self):
        with self.assertRaises(ValidationFailed):
            services.set_rate(tier="BCC", currency="USD", buy="2800", sell="2800",
                               effective_date=date(2026, 1, 1), by="u")

    def test_convert_cdf_to_usd_and_back(self):
        services.set_rate(tier="CLIENT", currency="USD", buy="2780", sell="2820",
                           effective_date=date(2026, 1, 1), by="u")
        usd = services.convert(amount="28200", from_currency="CDF", to_currency="USD", tier="CLIENT",
                                on=date(2026, 1, 1))
        self.assertEqual(usd, Decimal("10.00"))
        cdf = services.convert(amount="10", from_currency="USD", to_currency="CDF", tier="CLIENT",
                                on=date(2026, 1, 1))
        self.assertEqual(cdf, Decimal("27800.00"))


class BccSyncTests(AuthedAPITestCase):
    @patch("fx.services.requests.get")
    def test_fetch_bcc_rates_parses_indicative_rate_per_currency(self, mock_get):
        mock_get.return_value = Mock(status_code=200, text=_BCC_HTML_SAMPLE)
        rates = services.fetch_bcc_rates(by="u")
        by_currency = {r.currency: r for r in rates}
        self.assertEqual(set(by_currency), {"USD", "EUR"})  # AOA hors ExchangeRate.Currency
        usd = by_currency["USD"]
        self.assertEqual(usd.tier, "BCC")
        midpoint = (usd.buy_rate + usd.sell_rate) / 2
        self.assertAlmostEqual(float(midpoint), 2252.29, places=1)
        self.assertLess(usd.buy_rate, usd.sell_rate)  # contrainte sell > buy respectée

    @patch("fx.services.time.sleep")  # évite d'attendre les délais réels entre tentatives
    @patch("fx.services.requests.get")
    def test_fetch_bcc_rates_raises_on_unreachable_site(self, mock_get, mock_sleep):
        import requests
        mock_get.side_effect = requests.RequestException("timeout")
        with self.assertRaises(ValidationFailed):
            services.fetch_bcc_rates(by="u")
        self.assertEqual(mock_get.call_count, services.BCC_MAX_ATTEMPTS)  # a bien re-essayé

    @patch("fx.services.time.sleep")
    @patch("fx.services.requests.get")
    def test_fetch_bcc_rates_retries_then_succeeds(self, mock_get, mock_sleep):
        import requests
        mock_get.side_effect = [
            requests.RequestException("timeout"),
            Mock(status_code=200, text=_BCC_HTML_SAMPLE),
        ]
        rates = services.fetch_bcc_rates(by="u")
        self.assertEqual(mock_get.call_count, 2)
        self.assertTrue(rates)

    @patch("fx.services.requests.get")
    def test_fetch_bcc_rates_raises_on_unrecognized_page_format(self, mock_get):
        mock_get.return_value = Mock(status_code=200, text="<html>page changée, aucun tableau</html>")
        with self.assertRaises(ValidationFailed):
            services.fetch_bcc_rates(by="u")

    @patch("fx.services.requests.get")
    def test_fetch_bcc_rates_ignores_out_of_bounds_value_but_keeps_others(self, mock_get):
        html = """
        <table class="table"><tbody>
        <tr><td>USD</td><td>DOLLAR AMERICAIN</td><td>2 252,2900</td></tr>
        <tr><td>EUR</td><td>EURO</td><td>99999999,0000</td></tr>
        </tbody></table>
        """
        mock_get.return_value = Mock(status_code=200, text=html)
        rates = services.fetch_bcc_rates(by="u")
        currencies = {r.currency for r in rates}
        self.assertEqual(currencies, {"USD"})  # EUR hors bornes plausibles, ignoré sans tout bloquer

    @patch("fx.services.requests.get")
    def test_sync_bcc_endpoint_requires_config_capability(self, mock_get):
        mock_get.return_value = Mock(status_code=200, text=_BCC_HTML_SAMPLE)
        self.login(role="agent_terrain", sub="u1")  # pas de capacité config
        res = self.client.post("/api/fx/rates/sync-bcc", {}, format="json")
        self.assertEqual(res.status_code, 403)
        mock_get.assert_not_called()

    def test_sync_bcc_endpoint_with_config_capability(self):
        # `self.login()` patche `requests.get` pour /userinfo — même module partagé que
        # fx.services (un seul `sys.modules['requests']`). La requête POST déclenche ENCORE
        # un appel /userinfo (jeton pas encore mis en cache) EN PLUS de l'appel BCC : un seul
        # mock actif doit donc distinguer les deux par URL plutôt que d'écraser bêtement.
        self.login(role="admin_it", sub="u2")  # capacité config=True

        def fake_get(url, *a, **kw):
            if url == services.BCC_RATES_URL:
                return Mock(status_code=200, text=_BCC_HTML_SAMPLE)
            return Mock(status_code=200, json=lambda: {"sub": "u2", "role": "admin_it", "email": "u2@test.local"})

        with patch("fx.services.requests.get", side_effect=fake_get):
            res = self.client.post("/api/fx/rates/sync-bcc", {}, format="json")
        self.assertEqual(res.status_code, 200)
        currencies = {r["currency"] for r in res.data}
        self.assertEqual(currencies, {"USD", "EUR"})

        # Le formulaire manuel reste utilisable en parallèle (fallback si BCC est en panne).
        manual = self.client.post("/api/fx/rates", {
            "tier": "BCC", "currency": "GBP", "buy": "3000", "sell": "3010",
            "effectiveDate": date.today().isoformat(),
        }, format="json")
        self.assertEqual(manual.status_code, 201)

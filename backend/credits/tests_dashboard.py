"""
Tests des trois dettes du tableau de bord crédits (CLAUDE.md §7.2, §4.6, §7.1).

Un test par correctif :
  1. agrégat multi-devises RÉELLEMENT converti (et non nommé « Usd ») ;
  2. base servie sous chaque pourcentage, et pourcentage nommé pour ce qu'il mesure ;
  3. `sub` effectivement utilisé pour restreindre le périmètre des vues agent et agence.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from accounts.models import FintechUser
from agencies.models import Agency
from credits.dashboard import get_dashboard
from credits.models import CreditApplication
from fx.models import ExchangeRate
from portfolio.models import Loan
from rbac.models import StaffProfile

#: Taux BCC posé en base pour rendre les conversions vérifiables à la main.
TAUX_VENTE = Decimal("2500.000000")


def _user(sub: str) -> FintechUser:
    user, _ = FintechUser.objects.get_or_create(sub=sub, defaults={"full_name": sub})
    return user


def _app(sub: str, *, status: str = "active", currency: str = "USD",
         disbursed: str = "0", agent: str = "", **extra) -> CreditApplication:
    return CreditApplication.objects.create(
        client=_user(sub),
        initiated_by_sub=agent or sub,
        status=status,
        currency=currency,
        amount_requested=Decimal(disbursed),
        disbursed_amount=Decimal(disbursed),
        disbursed_at=timezone.now() if status == "active" else None,
        code=f"CRED-DASH-{CreditApplication.objects.count():04d}",
        **extra,
    )


def _taux_bcc() -> None:
    ExchangeRate.objects.create(
        tier=ExchangeRate.Tier.BCC, currency=ExchangeRate.Currency.USD,
        buy_rate=TAUX_VENTE - 1, sell_rate=TAUX_VENTE,
        effective_date=datetime.date(2026, 7, 1),
    )


# ── Correctif 1 : agrégats multi-devises convertis ────────────────────────────

class AgregatConvertiTests(TestCase):
    """`Sum("disbursed_amount")` sur un queryset USD **et** CDF additionnait des
    unités différentes et appelait le résultat `totalEncoursUsd`. Le suffixe était
    un nom, pas une conversion."""

    def setUp(self):
        _taux_bcc()
        _app("cli-usd", currency="USD", disbursed="1000")
        _app("cli-cdf", currency="CDF", disbursed="2500000")  # = 1 000 USD à 2 500

    def test_admin_convertit_reellement_et_ne_somme_pas_les_devises(self):
        res = get_dashboard(sub="sub-admin", roles={"admin"})
        fin = res["financials"]

        # Somme brute (le bug) : 1 000 + 2 500 000 = 2 501 000.
        # Somme convertie (attendu) : 1 000 + 2 500 000/2 500 = 2 000.
        self.assertEqual(fin["totalEncoursUsd"], 2000.0)
        self.assertNotEqual(fin["totalEncoursUsd"], 2501000.0)

    def test_le_detail_par_devise_et_le_taux_sont_servis(self):
        """§7.2 : « devise et taux sur tout montant converti ». Un total converti
        dont on ne peut pas reconstituer les composantes n'est pas auditable."""
        detail = get_dashboard(sub="sub-admin", roles={"admin"})["financials"]["totalEncoursDetail"]

        self.assertEqual(detail["parDevise"], {"USD": 1000.0, "CDF": 2500000.0})
        self.assertEqual(detail["taux"]["cdfParUsd"], float(TAUX_VENTE))
        self.assertEqual(detail["taux"]["date"], "2026-07-01")
        self.assertFalse(detail["taux"]["secours"])

    def test_sans_taux_en_base_le_repli_est_signale_pas_masque(self):
        ExchangeRate.objects.all().delete()
        detail = get_dashboard(sub="sub-admin", roles={"admin"})["financials"]["totalEncoursDetail"]

        self.assertTrue(detail["taux"]["secours"])
        self.assertIsNone(detail["taux"]["date"])

    def test_encours_par_filiere_converti_et_total_rows_servi(self):
        res = get_dashboard(sub="sub-dir", roles={"dir_ops"})
        lignes = res["activeByValueChain"]
        self.assertTrue(lignes)
        # Les deux dossiers sont sans filière : une seule ligne, encours converti.
        self.assertEqual(lignes[0]["encours"], 2000.0)
        self.assertEqual(lignes[0]["total_rows"], 1)


# ── Correctif 2 : base servie sous chaque pourcentage ─────────────────────────

class BasePourcentageTests(TestCase):
    """« Pas de pourcentage sans base » (§4.6) — et un pourcentage porte le nom de
    ce qu'il mesure."""

    def setUp(self):
        _taux_bcc()
        _app("cli-a", status="active", disbursed="1000")
        _app("cli-b", status="closed", disbursed="1000")
        _app("cli-c", status="rejected")
        _app("cli-d", status="rejected")

    def test_le_taux_de_rejet_porte_son_vrai_nom_et_sa_base(self):
        """L'ancien `defaultRatePct` valait rejetés ÷ résolus : une sélectivité
        d'instruction, pas une sinistralité. Il est servi sous son vrai nom."""
        s = get_dashboard(sub="sub-admin", roles={"admin"})["financials"]

        self.assertEqual(s["rejectionRatePct"], 50.0)          # 2 / 4
        self.assertEqual(s["rejectionRateBase"]["rejected"], 2)
        self.assertEqual(s["rejectionRateBase"]["resolved"], 4)
        self.assertTrue(s["rejectionRateBase"]["computable"])

    def test_le_taux_de_defaut_vient_du_portefeuille_pas_des_rejets(self):
        """Un dossier refusé à l'instruction n'a jamais été décaissé : il ne peut
        pas être en défaut. La sinistralité se lit sur `portfolio.Loan`."""
        for i, statut in enumerate((Loan.Status.EN_COURS, Loan.Status.EN_COURS,
                                    Loan.Status.DEFAUT, Loan.Status.REJETE)):
            Loan.objects.create(reference=f"CRD-T-{i}", operator="x", status=statut)

        s = get_dashboard(sub="sub-admin", roles={"admin"})["financials"]

        # 1 défaut sur 3 prêts décaissés (le REJETE n'entre pas au dénominateur).
        self.assertEqual(s["defaultRatePct"], round(1 / 3 * 100, 1))
        self.assertEqual(s["defaultRateBase"]["loansInDefault"], 1)
        self.assertEqual(s["defaultRateBase"]["loansDisbursed"], 3)
        # …et surtout : ce n'est PAS le taux de rejet.
        self.assertNotEqual(s["defaultRatePct"], s["rejectionRatePct"])

    def test_sans_pret_le_taux_de_defaut_se_declare_non_calculable(self):
        """0 % sur une base vide serait un mensonge par omission : la base le dit."""
        s = get_dashboard(sub="sub-admin", roles={"admin"})["financials"]

        self.assertEqual(s["defaultRateBase"]["loansDisbursed"], 0)
        self.assertFalse(s["defaultRateBase"]["computable"])


# ── Correctif 3 : le `sub` reçu est effectivement utilisé ─────────────────────

class PerimetreAgentTests(TestCase):
    """`_agent_dashboard(sub)` ignorait son `sub` : le serveur servait
    l'institution entière sous l'étiquette « mes dossiers » (§7.1)."""

    def setUp(self):
        _taux_bcc()
        _app("cli-1", status="submitted", agent="agent-moi")
        _app("cli-2", status="submitted", agent="agent-moi")
        _app("cli-3", status="submitted", agent="agent-autre")
        _app("cli-4", status="submitted", agent="agent-autre")
        _app("cli-5", status="submitted", agent="agent-autre")

    def test_un_agent_ne_voit_que_ses_dossiers(self):
        res = get_dashboard(sub="agent-moi", roles={"agent_terrain"})

        self.assertEqual(res["summary"]["totalApplications"], 2)
        self.assertEqual(res["scope"]["type"], "own")

    def test_un_gestionnaire_credit_est_restreint_lui_aussi(self):
        res = get_dashboard(sub="agent-autre", roles={"gest_credit"})
        self.assertEqual(res["summary"]["totalApplications"], 3)

    def test_un_auditeur_garde_la_lecture_transverse(self):
        """Restreindre l'auditeur serait le bug symétrique : son métier EST la
        lecture transverse (§7.1.8). Le périmètre servi est déclaré."""
        res = get_dashboard(sub="aud-1", roles={"aud_fin"})

        self.assertEqual(res["summary"]["totalApplications"], 5)
        self.assertEqual(res["scope"]["type"], "institution")

    def test_un_sub_vide_ne_rouvre_pas_le_perimetre(self):
        """La garde qui compte : `Q(initiated_by_sub="")` matcherait tous les
        dossiers dont le champ est blanc — l'inverse exact du filtre demandé."""
        res = get_dashboard(sub="", roles={"agent_terrain"})
        self.assertEqual(res["summary"]["totalApplications"], 0)


class PerimetreAgenceTests(TestCase):
    """`_branch_dashboard(sub)` ignorait son `sub` : un responsable de zone lisait
    les chiffres de l'institution comme si c'étaient ceux de son agence."""

    def setUp(self):
        _taux_bcc()
        self.agence = Agency.objects.create(code="AG-01", name="Goma Centre")
        self.autre = Agency.objects.create(code="AG-02", name="Bukavu")

        for sub, agence in (("chef-goma", self.agence), ("agent-goma", self.agence),
                            ("agent-bukavu", self.autre)):
            StaffProfile.objects.create(user=_user(sub), assignment=agence)

        _app("cli-g1", status="in_analysis", agent="chef-goma")
        _app("cli-g2", status="in_analysis", agent="agent-goma")
        _app("cli-b1", status="in_analysis", agent="agent-bukavu")
        _app("cli-b2", status="in_analysis", agent="agent-bukavu")

    def test_le_responsable_ne_voit_que_les_dossiers_de_son_agence(self):
        res = get_dashboard(sub="chef-goma", roles={"gest_zone"})

        self.assertEqual(res["summary"]["totalApplications"], 2)
        self.assertEqual(res["scope"]["type"], "branch")
        self.assertIn("Goma Centre", res["scope"]["libelle"])

    def test_sans_affectation_le_perimetre_elargi_est_DIT_pas_maquille(self):
        """Servir l'institution en la présentant comme une agence serait le bug
        d'origine. On sert l'institution ET on le déclare."""
        res = get_dashboard(sub="chef-sans-agence", roles={"gest_zone"})

        self.assertEqual(res["summary"]["totalApplications"], 4)
        self.assertEqual(res["scope"]["type"], "institution")
        self.assertIn("avertissement", res["scope"])

    def test_le_gerant_nomme_sans_profil_est_rattache_par_manager_sub(self):
        Agency.objects.filter(pk=self.agence.pk).update(manager_sub="chef-nomme")
        res = get_dashboard(sub="chef-nomme", roles={"gest_zone"})

        self.assertEqual(res["scope"]["type"], "branch")

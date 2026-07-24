from __future__ import annotations

import ast
import inspect
import textwrap
from datetime import date
from decimal import Decimal

from django.test import SimpleTestCase, TestCase

from common.testing import AuthedAPITestCase

from . import schedule as schedule_module
from . import services
from .models import Loan
from .schedule import build_schedule, schedule_totals

D = Decimal


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


# =============================================================================
# ÉCHÉANCIER RÉEL — le calendrier que le client rembourse effectivement.
#
# Hiérarchie d'exigence du module (CLAUDE.md §5) :
#   1. non-régression financière — cas chiffré reproduit au centime, et ÉGALITÉ
#      avec l'échéancier prévisionnel `credits/echeancier.py` à paramètres
#      équivalents (c'est sur lui que le dossier a été scoré) ;
#   2. invariants — CRD final rigoureusement nul, Σ principal = capital amorti,
#      chaque échéance = principal + intérêts ;
#   3. discipline `Decimal` — un `float` qui réapparaît fait échouer la suite.
# =============================================================================

DEBUT = date(2026, 1, 15)


class CasChiffreEcheancierReelTests(SimpleTestCase):
    """C = 1 330 USD · 1,5 %/mois (= 18 %/an) · 8 mois · mensuel · sans différé.

    Mêmes paramètres économiques que le cas de référence A.2 du prévisionnel, au
    différé près (que ce moteur ne gère pas — écart de méthode documenté).
    """

    CAPITAL = D("1330")
    TAUX_MENSUEL = D("1.5")
    DUREE = 8

    def test_ligne_a_ligne(self):
        rows = build_schedule(self.CAPITAL, self.TAUX_MENSUEL, self.DUREE, "monthly", DEBUT, "USD")
        attendu = [
            # n, date, principal, intérêts, total, solde
            (1, "2026-02-15", "166.25", "19.95", "186.20", "1163.75"),
            (2, "2026-03-15", "166.25", "17.46", "183.71", "997.50"),
            (3, "2026-04-15", "166.25", "14.96", "181.21", "831.25"),
            (4, "2026-05-15", "166.25", "12.47", "178.72", "665.00"),
            (5, "2026-06-15", "166.25", "9.98", "176.23", "498.75"),
            (6, "2026-07-15", "166.25", "7.48", "173.73", "332.50"),
            (7, "2026-08-15", "166.25", "4.99", "171.24", "166.25"),
            (8, "2026-09-15", "166.25", "2.49", "168.74", "0.00"),
        ]
        self.assertEqual(len(rows), len(attendu))
        for row, (n, jour, cap, ints, total, solde) in zip(rows, attendu):
            with self.subTest(echeance=n):
                self.assertEqual(row["number"], n)
                self.assertEqual(row["date"], jour)
                self.assertEqual(row["principal"], D(cap))
                self.assertEqual(row["interest"], D(ints))
                self.assertEqual(row["total"], D(total))
                self.assertEqual(row["balance"], D(solde))
                self.assertEqual(row["currency"], "USD")   # aucun montant nu

    def test_totaux(self):
        rows = build_schedule(self.CAPITAL, self.TAUX_MENSUEL, self.DUREE, "monthly", DEBUT, "USD")
        totaux = schedule_totals(rows, self.DUREE, "USD")
        self.assertEqual(totaux["total_principal"], D("1330.00"))
        self.assertEqual(totaux["total_interest"], D("89.78"))
        self.assertEqual(totaux["total_payments"], D("1419.78"))
        self.assertEqual(totaux["final_balance"], D("0.00"))
        self.assertEqual(totaux["currency"], "USD")

    def test_apr_est_un_taux_moyen_annuel_pas_un_taeg(self):
        """Contrôle de sens explicite sur `apr` (affiché « TAEG » côté front).

        89,78 / 1 330 sur 8/12 d'année = 10,13 %, alors que le prêt porte 18 %/an
        nominal : c'est mécanique (le capital s'amortit, l'encours moyen vaut à peu
        près la moitié du capital), mais un TAEG ne peut JAMAIS être inférieur au
        taux nominal. Le libellé du front est donc faux — fait remonté, pas masqué.
        """
        rows = build_schedule(self.CAPITAL, self.TAUX_MENSUEL, self.DUREE, "monthly", DEBUT, "USD")
        self.assertEqual(schedule_totals(rows, self.DUREE, "USD")["apr"], D("10.13"))


class CoherenceAvecLePrevisionnelTests(SimpleTestCase):
    """Le calendrier PAYÉ doit coïncider avec le calendrier SCORÉ.

    À paramètres équivalents — mensuel, sans différé, taux mensuel = taux annuel / 12 —
    `portfolio.schedule` et `credits.echeancier` décrivent le même prêt : tout écart
    de centime entre les deux est un litige client en puissance.
    """

    CAS = [
        (D("1330"), D("18"), 8),
        (D("10000"), D("7.5"), 5),
        (D("333.33"), D("8.5"), 4),
        (D("7777.77"), D("6"), 12),
        (D("50000"), D("22.6"), 36),     # taux mensuel non terminant (22,6/12)
        (D("1000"), D("0"), 3),          # taux nul
        (D("0.03"), D("18"), 3),         # capital dérisoire : 3 centimes sur 3 mois
    ]

    def test_memes_chiffres_que_l_echeancier_previsionnel(self):
        from credits.echeancier import construire_echeancier

        for capital, taux_annuel, duree in self.CAS:
            with self.subTest(capital=capital, taux_annuel=taux_annuel, duree=duree):
                reel = build_schedule(
                    capital, taux_annuel / D("12"), duree, "monthly", DEBUT, "USD")
                prevu = construire_echeancier(capital, taux_annuel, duree, 0)
                self.assertEqual(len(reel), len(prevu))
                for row, ligne in zip(reel, prevu):
                    self.assertEqual(row["principal"], ligne["capital"])
                    self.assertEqual(row["interest"], ligne["interets"])
                    self.assertEqual(row["total"], ligne["echeance"])
                    self.assertEqual(row["balance"], ligne["crd"])

    def test_memes_totaux_que_l_echeancier_previsionnel(self):
        from credits.echeancier import construire_echeancier, totaux_echeancier

        for capital, taux_annuel, duree in self.CAS:
            with self.subTest(capital=capital, duree=duree):
                reel = schedule_totals(
                    build_schedule(capital, taux_annuel / D("12"), duree, "monthly", DEBUT, "USD"),
                    duree, "USD",
                )
                prevu = totaux_echeancier(construire_echeancier(capital, taux_annuel, duree, 0))
                self.assertEqual(reel["total_principal"], prevu["capital_rembourse"])
                self.assertEqual(reel["total_interest"], prevu["interets_payes"])
                self.assertEqual(reel["total_payments"], prevu["service_dette"])
                self.assertEqual(reel["final_balance"], prevu["crd_final"])


class InvariantsEcheancierReelTests(SimpleTestCase):
    """Propriétés vraies pour TOUT jeu de paramètres valide."""

    CAS = [
        # capital, taux mensuel %, durée, périodicité
        (D("1330"), D("1.5"), 8, "monthly"),
        (D("1000"), D("1"), 3, "monthly"),
        (D("5000"), D("1.5"), 12, "quarterly"),
        (D("5000"), D("1.5"), 8, "quarterly"),      # durée non multiple du pas
        (D("12345.67"), D("2.25"), 24, "monthly"),
        (D("9999.99"), D("1.75"), 7, "monthly"),    # capital indivisible par la durée
        (D("30000"), D("1.9"), 24, "annual"),
        (D("7000"), D("2"), 6, "bullet"),
        (D("250"), D("0.05"), 2, "monthly"),
        (D("800"), D("0"), 4, "monthly"),           # taux nul
        (D("0.05"), D("3"), 5, "monthly"),          # 5 centimes sur 5 échéances
    ]

    def _rows(self, cas):
        capital, taux, duree, freq = cas
        return build_schedule(capital, taux, duree, freq, DEBUT, "USD")

    def test_crd_final_rigoureusement_nul(self):
        for cas in self.CAS:
            with self.subTest(cas=cas):
                rows = self._rows(cas)
                self.assertEqual(rows[-1]["balance"], D("0.00"))

    def test_somme_du_principal_egale_le_capital(self):
        for cas in self.CAS:
            with self.subTest(cas=cas):
                rows = self._rows(cas)
                somme = sum((r["principal"] for r in rows), D("0.00"))
                self.assertEqual(somme, cas[0].quantize(D("0.01")))
                self.assertEqual(
                    schedule_totals(rows, cas[2], "USD")["total_principal"],
                    cas[0].quantize(D("0.01")),
                )

    def test_chaque_echeance_egale_principal_plus_interets(self):
        for cas in self.CAS:
            with self.subTest(cas=cas):
                for row in self._rows(cas):
                    self.assertEqual(row["total"], row["principal"] + row["interest"])

    def test_total_des_paiements_egale_principal_plus_interets(self):
        for cas in self.CAS:
            with self.subTest(cas=cas):
                totaux = schedule_totals(self._rows(cas), cas[2], "USD")
                self.assertEqual(
                    totaux["total_payments"],
                    totaux["total_principal"] + totaux["total_interest"],
                )

    def test_solde_decroissant_et_jamais_negatif(self):
        for cas in self.CAS:
            with self.subTest(cas=cas):
                rows = self._rows(cas)
                precedent = cas[0]
                for row in rows:
                    self.assertLessEqual(row["balance"], precedent)
                    self.assertGreaterEqual(row["balance"], D("0.00"))
                    precedent = row["balance"]

    def test_interets_calcules_sur_le_solde_de_debut_de_periode(self):
        """Le premier intérêt porte sur le capital ENTIER, pas sur le solde après paiement."""
        rows = build_schedule(D("2400"), D("1.25"), 12, "monthly", DEBUT, "USD")
        self.assertEqual(rows[0]["interest"], D("30.00"))       # 2 400 × 1,25 %

    def test_bullet_ne_produit_qu_une_echeance_qui_solde_tout(self):
        rows = build_schedule(D("7000"), D("2"), 6, "bullet", DEBUT, "USD")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["principal"], D("7000.00"))
        self.assertEqual(rows[0]["interest"], D("840.00"))      # 7 000 × 2 % × 6 mois
        self.assertEqual(rows[0]["balance"], D("0.00"))

    def test_dossier_non_configure_ne_produit_pas_d_echeancier_best_effort(self):
        self.assertEqual(build_schedule(D("0"), D("1.5"), 12, "monthly", DEBUT), [])
        self.assertEqual(build_schedule(D("1000"), D("1.5"), 0, "monthly", DEBUT), [])
        self.assertEqual(schedule_totals([], 0)["total_payments"], D("0.00"))


class RegressionArrondiFlottantTests(SimpleTestCase):
    """Les deux défauts que la version `float` + `round()` produisait réellement.

    Ils sont figés ici : c'est la preuve chiffrée de ce que la conversion corrige.
    """

    def test_arrondi_du_centime_et_non_arrondi_bancaire(self):
        """250 × 0,05 %/mois = 0,125 → 0,13 (règle du centime).

        `round(0.125, 2)` rendait 0,12 : `round()` arrondit au pair le plus proche.
        Un centime perdu par échéance, en faveur du client ou de l'institution
        selon la parité — c'est-à-dire arbitrairement.
        """
        rows = build_schedule(D("250"), D("0.05"), 2, "monthly", DEBUT, "USD")
        self.assertEqual(rows[0]["interest"], D("0.13"))

    def test_le_capital_amorti_ne_perd_plus_de_centime(self):
        """1 000 sur 3 échéances : 333,33 + 333,33 + 333,34 = 1 000,00.

        La version `float` publiait 333,33 trois fois (Σ = 999,99) : le résidu
        d'arrondi n'était porté par aucune ligne et le client soldait un prêt en
        ayant remboursé un centime de moins que le capital décaissé.
        """
        rows = build_schedule(D("1000"), D("1"), 3, "monthly", DEBUT, "USD")
        self.assertEqual([r["principal"] for r in rows],
                         [D("333.33"), D("333.33"), D("333.34")])
        self.assertEqual(sum((r["principal"] for r in rows), D("0.00")), D("1000.00"))
        self.assertEqual(rows[-1]["balance"], D("0.00"))


def _sources_interdites(node) -> list[str]:
    """`float(...)`, `round(...)` et littéraux flottants trouvés dans un arbre AST."""
    fautes = []
    for element in ast.walk(node):
        if (isinstance(element, ast.Call) and isinstance(element.func, ast.Name)
                and element.func.id in {"float", "round"}):
            fautes.append(f"appel {element.func.id}() ligne {element.lineno}")
        if isinstance(element, ast.Constant) and isinstance(element.value, float):
            fautes.append(f"littéral flottant {element.value!r} ligne {element.lineno}")
    return fautes


class DisciplineDecimalTests(SimpleTestCase):
    """Garde-fou : si un `float` réapparaît sur le chemin de l'échéancier, ça casse ici.

    Trois barrières indépendantes — le code source, les valeurs produites, et les
    valeurs acceptées en entrée — parce qu'un `float` peut se réintroduire par
    n'importe laquelle des trois.
    """

    def test_le_module_schedule_ne_contient_ni_float_ni_round(self):
        source = inspect.getsource(schedule_module)
        fautes = _sources_interdites(ast.parse(source))
        self.assertEqual(fautes, [], f"portfolio/schedule.py : {fautes}")

    def test_schedule_for_ne_reconvertit_pas_en_float(self):
        source = textwrap.dedent(inspect.getsource(services.schedule_for))
        fautes = _sources_interdites(ast.parse(source))
        self.assertEqual(fautes, [], f"portfolio.services.schedule_for : {fautes}")

    def test_toutes_les_valeurs_produites_sont_des_decimal(self):
        rows = build_schedule(D("12345.67"), D("1.45"), 9, "monthly", DEBUT, "USD")
        for row in rows:
            for cle in ("principal", "interest", "total", "balance"):
                with self.subTest(echeance=row["number"], champ=cle):
                    self.assertIsInstance(row[cle], Decimal)
                    self.assertNotIsInstance(row[cle], float)
                    # Quantize effectif : jamais plus de deux décimales publiées.
                    self.assertLessEqual(-row[cle].as_tuple().exponent, 2)
        totaux = schedule_totals(rows, 9, "USD")
        for cle in ("total_principal", "total_interest", "total_payments", "apr", "final_balance"):
            with self.subTest(champ=cle):
                self.assertIsInstance(totaux[cle], Decimal)

    def test_un_float_en_entree_est_refuse_bruyamment(self):
        for kwargs in ({"principal": 1330.0}, {"monthly_rate_pct": 1.5}):
            with self.subTest(**kwargs):
                appel = {"principal": D("1330"), "monthly_rate_pct": D("1.5"), **kwargs}
                with self.assertRaises(TypeError) as ctx:
                    build_schedule(duration_months=8, frequency="monthly", start_date=DEBUT, **appel)
                self.assertIn("float", str(ctx.exception))


class ScheduleForDecimalTests(TestCase):
    """Le service qui alimente l'API : de la base au dernier centime, sans `float`."""

    def _loan(self, **kwargs) -> Loan:
        defaults = dict(
            reference="CRD-2026-900", operator="Coopérative Test", category="Maïs",
            amount_approved=D("1330"), rate=D("1.5"), duration_months=8,
            frequency="monthly", start_date=DEBUT, currency="USD",
        )
        defaults.update(kwargs)
        return Loan.objects.create(**defaults)

    def test_echeancier_du_dossier_est_en_decimal_et_solde_a_zero(self):
        data = services.schedule_for(self._loan())
        self.assertEqual(len(data["schedule"]), 8)
        self.assertEqual(data["schedule"][0]["total"], D("186.20"))
        self.assertEqual(data["schedule"][-1]["balance"], D("0.00"))
        self.assertEqual(data["totals"]["total_principal"], D("1330.00"))
        self.assertEqual(data["currency"], "USD")
        for row in data["schedule"]:
            self.assertNotIsInstance(row["principal"], float)
            self.assertEqual(row["currency"], "USD")

    def test_la_devise_du_dossier_est_portee_par_chaque_echeance(self):
        data = services.schedule_for(self._loan(reference="CRD-2026-901", currency="CDF"))
        self.assertTrue(all(r["currency"] == "CDF" for r in data["schedule"]))
        self.assertEqual(data["totals"]["currency"], "CDF")

    def test_le_montant_approuve_prime_sur_le_montant_demande(self):
        loan = self._loan(reference="CRD-2026-902",
                          amount_requested=D("5000"), amount_approved=D("1330"))
        self.assertEqual(services.schedule_for(loan)["totals"]["total_principal"], D("1330.00"))

    def test_progression_arrondie_au_centieme_superieur(self):
        """`progress` : 50,5 % doit donner 51, pas 50 (arrondi bancaire de `round`)."""
        loan = self._loan(reference="CRD-2026-903", amount_approved=D("1000"))
        loan.transactions.create(kind="REPAYMENT", amount=D("-505"), currency="USD")
        self.assertEqual(loan.progress, 51)

from __future__ import annotations

import ast
import inspect
import textwrap
from datetime import date
from decimal import Decimal

from django.test import SimpleTestCase, TestCase

from common.testing import AuthedAPITestCase

from . import rates
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


# =============================================================================
# UNITÉ DU TAUX — le garde-fou du facteur 12.
#
# `Loan.rate` est MENSUEL, `credits/echeancier.py` raisonne en ANNUEL, et rien ne
# le disait : un « 18 % » de dossier scoré reporté tel quel produisait un prêt à
# 216 %/an, sans erreur, sans alerte, sans trace. Ces tests figent le refus.
# =============================================================================

TAUX_USURAIRE_MENSUEL = D("18")     # « 18 % » du dossier scoré, saisi en mensuel
TAUX_ANNUEL_DOSSIER = D("18")       # le même 18, dans sa vraie unité


class TauxUsuraireRefuseTests(TestCase):
    """Un taux annuel saisi tel quel dans le champ mensuel ne passe JAMAIS."""

    def _loan(self, **kwargs) -> Loan:
        defaults = dict(
            reference="CRD-2026-910", operator="Coopérative Test",
            amount_approved=D("1330"), duration_months=8, currency="USD",
        )
        defaults.update(kwargs)
        return Loan.objects.create(**defaults)

    def test_le_modele_refuse_un_taux_mensuel_usuraire(self):
        with self.assertRaises(rates.TauxMensuelImplausible) as ctx:
            self._loan(rate=TAUX_USURAIRE_MENSUEL)
        message = str(ctx.exception)
        self.assertIn("MENSUEL", message)
        self.assertIn("216", message)          # l'annualisation est dite en clair
        self.assertIn("annualRate", message)   # et la voie correcte est donnée
        self.assertFalse(Loan.objects.filter(reference="CRD-2026-910").exists())

    def test_le_service_de_configuration_refuse_un_taux_mensuel_usuraire(self):
        loan = self._loan(reference="CRD-2026-911", rate=D("1.5"))
        with self.assertRaises(rates.TauxMensuelImplausible):
            services.apply_config(loan, {"rate": "18"}, by="agent")
        loan.refresh_from_db()
        self.assertEqual(loan.rate, D("1.500000"))     # rien n'a bougé
        self.assertEqual(loan.annual_rate, D("18.000"))

    def test_la_creation_manuelle_refuse_un_taux_mensuel_usuraire(self):
        with self.assertRaises(rates.TauxMensuelImplausible):
            services.create_loan({"operator": "X", "amountApproved": "1000",
                                  "rate": "18"}, by="agent")

    def test_l_echeancier_usuraire_n_existe_pas(self):
        """Preuve chiffrée de ce qui était produit avant : 12 × les intérêts."""
        legitime = build_schedule(D("1330"), D("1.5"), 8, "monthly", DEBUT, "USD")
        usuraire = build_schedule(D("1330"), D("18"), 8, "monthly", DEBUT, "USD")
        self.assertEqual(schedule_totals(legitime, 8, "USD")["total_interest"], D("89.78"))
        self.assertEqual(schedule_totals(usuraire, 8, "USD")["total_interest"], D("1077.32"))
        # 1 077,32 d'intérêts sur 1 330 de capital en 8 mois : c'est ce qu'aucun
        # contrôle n'empêchait d'enregistrer.
        with self.assertRaises(rates.TauxMensuelImplausible):
            self._loan(reference="CRD-2026-912", rate=D("18"))

    def test_un_taux_annuel_est_accepte_dans_le_champ_annuel(self):
        loan = services.create_loan({"operator": "X", "amountApproved": "1330",
                                     "annualRate": "18", "duration": 8,
                                     "startDate": DEBUT.isoformat()}, by="agent")
        self.assertEqual(loan.annual_rate, D("18.000"))
        self.assertEqual(loan.rate, D("1.500000"))
        self.assertEqual(services.schedule_for(loan)["totals"]["total_interest"], D("89.78"))

    def test_le_plafond_laisse_passer_toute_tarification_plausible(self):
        """25 %/an — le haut de la grille AGRICAP — passe sans friction."""
        loan = services.create_loan({"operator": "X", "amountApproved": "1000",
                                     "annualRate": "25"}, by="agent")
        self.assertEqual(loan.annual_rate, D("25.000"))
        loan2 = services.create_loan({"operator": "Y", "amountApproved": "1000",
                                      "rate": "2.5"}, by="agent")   # 30 %/an
        self.assertEqual(loan2.annual_rate, D("30.000"))

    def test_un_taux_negatif_est_refuse(self):
        with self.assertRaises(rates.TauxInvalide):
            self._loan(reference="CRD-2026-913", rate=D("-1"))

    def test_les_deux_champs_ne_peuvent_pas_se_contredire(self):
        loan = self._loan(reference="CRD-2026-914", annual_rate=D("22.6"))
        self.assertEqual(loan.rate, D("1.883333"))      # projection d'affichage
        loan.rate = D("3")                               # saisie mensuelle directe
        loan.save()
        loan.refresh_from_db()
        self.assertEqual(loan.annual_rate, D("36.000"))  # l'annuel a suivi

    def test_le_taux_annuel_pilote_le_calcul_en_pleine_precision(self):
        """22,6 %/an : le douzième n'est pas décimal fini — l'échéancier PAYÉ doit
        malgré tout tomber au centime sur l'échéancier SCORÉ."""
        from credits.echeancier import construire_echeancier

        loan = self._loan(reference="CRD-2026-915", annual_rate=D("22.6"),
                          amount_approved=D("50000"), duration_months=36,
                          start_date=DEBUT)
        reel = services.schedule_for(loan)["schedule"]
        prevu = construire_echeancier(D("50000"), D("22.6"), 36, 0)
        self.assertEqual(len(reel), len(prevu))
        for ligne_reelle, ligne_prevue in zip(reel, prevu):
            self.assertEqual(ligne_reelle["interest"], ligne_prevue["interets"])
            self.assertEqual(ligne_reelle["balance"], ligne_prevue["crd"])

    def test_un_dossier_herite_reste_sauvegardable(self):
        """Un taux déjà en base n'est pas requalifié rétroactivement : on ne bloque
        pas la clôture d'un dossier existant, on bloque la SAISIE d'un nouveau."""
        loan = self._loan(reference="CRD-2026-916", rate=D("1.5"))
        Loan.objects.filter(pk=loan.pk).update(rate=D("18"), annual_rate=None)
        herite = Loan.objects.get(pk=loan.pk)
        herite.status = Loan.Status.CLOTURE
        herite.save()                                    # ne lève pas
        herite.refresh_from_db()
        self.assertEqual(herite.status, Loan.Status.CLOTURE)
        self.assertEqual(herite.annual_rate, D("216.000"))   # rendu VISIBLE


class TauxRepriseDeLAnalyseTests(TestCase):
    """Le taux ne se retape pas : il se recopie, dans son unité d'origine."""

    def _application(self, *, taux_annuel=D("18"), taux_propose=None, duree=8):
        """Dossier d'instruction minimal porteur d'une analyse.

        L'`AnalyseCredit` réelle exige un lignage complet (`needs_source`,
        `referentiel`) ; ce test n'a besoin que du contrat de lecture — un objet
        qui porte les mêmes attributs le fournit sans dupliquer tout le module
        `credits` (dont ce lot n'est pas propriétaire).
        """
        class _Analyse:
            pk = 42
            duree_mois = duree
            differe_mois = 0
            mode_differe = "interets_seuls"

        analyse = _Analyse()
        analyse.taux_annuel = taux_annuel
        analyse.taux_propose = taux_propose

        class _App:
            code = "APP-2026-001"
            status = "approved"
            amount_requested = D("1500")
            amount_approved = D("1330")
            guarantee_type = "morale"
            score_result = {"score": 72}
            client = type("C", (), {"full_name": "Coopérative KIVU"})()
            value_chain = type("V", (), {"label": "Maïs"})()
            id = None

        app = _App()
        app._analyse = analyse
        return app, analyse

    def _patch(self, app, analyse):
        """Branche `derniere_analyse` sur l'analyse du dossier factice."""
        original = services.derniere_analyse
        services.derniere_analyse = lambda a: analyse if a is app else None
        self.addCleanup(lambda: setattr(services, "derniere_analyse", original))

    def test_le_taux_annuel_de_l_analyse_est_recopie_en_annuel(self):
        app, analyse = self._application(taux_annuel=D("18"))
        self._patch(app, analyse)
        taux, provenance, avertissement = services._taux_de_l_analyse(app)
        self.assertEqual(taux, D("18"))
        self.assertIn("taux d'analyse", provenance)
        self.assertEqual(avertissement, "")

    def test_le_taux_propose_prime_et_l_ecart_est_signale(self):
        app, analyse = self._application(taux_annuel=D("18"), taux_propose=D("21"))
        self._patch(app, analyse)
        taux, provenance, avertissement = services._taux_de_l_analyse(app)
        self.assertEqual(taux, D("21"))
        self.assertIn("taux proposé", provenance)
        self.assertIn("DSCR", avertissement)     # le dossier a été scoré à 18

    def test_sans_analyse_aucun_taux_n_est_devine(self):
        taux, provenance, avertissement = services._taux_de_l_analyse(None)
        self.assertIsNone(taux)
        self.assertEqual(provenance, "")

    def test_le_report_du_taux_annuel_dans_le_champ_mensuel_est_reconnu(self):
        """Le contrôle qui attrape AUSSI les petits taux : 7 %/an saisi 7 %/mois
        (= 84 %/an) passerait sous n'importe quel plafond de plausibilité."""
        with self.assertRaises(rates.TauxAnnuelSaisiCommeMensuel) as ctx:
            rates.valider_taux_mensuel(D("7"), taux_annuel_dossier=D("7"))
        message = str(ctx.exception)
        self.assertIn("douze fois", message)
        self.assertIn("0.583333", message)       # l'équivalent mensuel est donné

    def test_le_meme_taux_dans_la_bonne_unite_passe(self):
        self.assertEqual(
            rates.valider_taux_mensuel(D("0.583333"), taux_annuel_dossier=D("7")),
            D("0.583333"))


class ConversionTauxTests(SimpleTestCase):
    """Les conversions, isolées : c'est le seul endroit où le 12 a le droit d'exister."""

    def test_mensuel_exact_ne_quantize_pas(self):
        self.assertEqual(rates.mensuel_exact(D("22.6")) * D("12"), D("22.6"))
        self.assertEqual(rates.mensuel_exact(D("18")), D("1.5"))

    def test_aller_retour_stable_sur_un_taux_mensuel_a_six_decimales(self):
        for mensuel in (D("1.5"), D("0.75"), D("2.083333"), D("0")):
            with self.subTest(mensuel=mensuel):
                annuel = rates.annuel_depuis_mensuel(mensuel)
                self.assertEqual(rates.mensuel_stocke(annuel), rates.q6(mensuel))

    def test_les_conversions_ne_passent_jamais_par_un_float(self):
        source = inspect.getsource(rates)
        fautes = _sources_interdites(ast.parse(source))
        self.assertEqual(fautes, [], f"portfolio/rates.py : {fautes}")

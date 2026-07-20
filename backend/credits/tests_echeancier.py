"""Tests de l'échéancier prévisionnel (SPEC Moteur d'analyse, annexe A).

Hiérarchie d'exigence du module :
  1. non-régression financière — le cas de référence A.2 reproduit au centime ;
  2. invariants — CRD final = 0, Σ principal = capital à amortir ;
  3. cas limites — différé nul, différé maximal, taux nul, paramètres refusés.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import SimpleTestCase

from credits.echeancier import (
    EcheancierError,
    MODE_FRANCHISE_TOTALE,
    MODE_INTERETS_SEULS,
    construire_echeancier,
    serialiser_echeancier,
    totaux_echeancier,
)

D = Decimal


class CasDeReferenceA2Tests(SimpleTestCase):
    """C = 1 330 USD · 18 %/an · D = 8 · F = 5 — le cas chiffré de la SPEC."""

    CAPITAL = D("1330")
    TAUX = D("18")
    DUREE = 8
    DIFFERE = 5

    def test_interets_seuls_ligne_a_ligne(self):
        lignes = construire_echeancier(
            self.CAPITAL, self.TAUX, self.DUREE, self.DIFFERE, MODE_INTERETS_SEULS,
        )
        attendu = [
            # mois, capital, intérêts, échéance, solde
            (1, "0.00", "19.95", "19.95", "1330.00"),
            (2, "0.00", "19.95", "19.95", "1330.00"),
            (3, "0.00", "19.95", "19.95", "1330.00"),
            (4, "0.00", "19.95", "19.95", "1330.00"),
            (5, "0.00", "19.95", "19.95", "1330.00"),
            (6, "443.33", "19.95", "463.28", "886.67"),
            (7, "443.33", "13.30", "456.63", "443.34"),
            (8, "443.34", "6.65", "449.99", "0.00"),
        ]
        self.assertEqual(len(lignes), len(attendu))
        for ligne, (mois, cap, ints, ech, crd) in zip(lignes, attendu):
            with self.subTest(mois=mois):
                self.assertEqual(ligne["mois"], mois)
                self.assertEqual(ligne["capital"], D(cap))
                self.assertEqual(ligne["interets"], D(ints))
                self.assertEqual(ligne["echeance"], D(ech))
                self.assertEqual(ligne["crd"], D(crd))

    def test_interets_seuls_totaux(self):
        lignes = construire_echeancier(
            self.CAPITAL, self.TAUX, self.DUREE, self.DIFFERE, MODE_INTERETS_SEULS,
        )
        totaux = totaux_echeancier(lignes)
        # Les deux chiffres publiés par la SPEC.
        self.assertEqual(totaux["interets_payes"], D("139.65"))
        self.assertEqual(totaux["service_dette"], D("1469.65"))
        self.assertEqual(totaux["capital_rembourse"], self.CAPITAL)
        self.assertEqual(totaux["crd_final"], D("0.00"))

    def test_franchise_totale_ligne_a_ligne(self):
        lignes = construire_echeancier(
            self.CAPITAL, self.TAUX, self.DUREE, self.DIFFERE, MODE_FRANCHISE_TOTALE,
        )
        # Différé : rien n'est payé, le solde enfle jusqu'à 1 432,78.
        soldes_differe = ["1349.95", "1370.20", "1390.75", "1411.61", "1432.78"]
        for i, solde in enumerate(soldes_differe):
            with self.subTest(mois=i + 1):
                self.assertEqual(lignes[i]["echeance"], D("0.00"))
                self.assertEqual(lignes[i]["crd"], D(solde))

        attendu = [
            (6, "477.59", "21.49", "499.08", "955.19"),
            (7, "477.59", "14.33", "491.92", "477.60"),
            (8, "477.60", "7.16", "484.76", "0.00"),
        ]
        for ligne, (mois, cap, ints, ech, crd) in zip(lignes[5:], attendu):
            with self.subTest(mois=mois):
                self.assertEqual(ligne["capital"], D(cap))
                self.assertEqual(ligne["interets"], D(ints))
                self.assertEqual(ligne["echeance"], D(ech))
                self.assertEqual(ligne["crd"], D(crd))

        totaux = totaux_echeancier(lignes)
        self.assertEqual(totaux["service_dette"], D("1475.76"))
        self.assertEqual(totaux["crd_final"], D("0.00"))

    def test_la_franchise_totale_coute_plus_cher_que_les_interets_seuls(self):
        """Contrôle de sens : capitaliser les intérêts alourdit le service de la dette."""
        seuls = totaux_echeancier(construire_echeancier(
            self.CAPITAL, self.TAUX, self.DUREE, self.DIFFERE, MODE_INTERETS_SEULS))
        franchise = totaux_echeancier(construire_echeancier(
            self.CAPITAL, self.TAUX, self.DUREE, self.DIFFERE, MODE_FRANCHISE_TOTALE))
        self.assertGreater(franchise["service_dette"], seuls["service_dette"])


class InvariantsTests(SimpleTestCase):
    """Propriétés vraies pour TOUT jeu de paramètres valide."""

    CAS = [
        (D("1330"), D("18"), 8, 5, MODE_INTERETS_SEULS),
        (D("1330"), D("18"), 8, 5, MODE_FRANCHISE_TOTALE),
        (D("10000"), D("7.5"), 5, 0, MODE_INTERETS_SEULS),
        (D("333.33"), D("8.5"), 4, 1, MODE_INTERETS_SEULS),
        (D("7777.77"), D("6"), 12, 11, MODE_INTERETS_SEULS),
        (D("50000"), D("22.6"), 36, 6, MODE_FRANCHISE_TOTALE),
        (D("1000"), D("0"), 3, 0, MODE_INTERETS_SEULS),
        (D("0.03"), D("18"), 3, 0, MODE_INTERETS_SEULS),
    ]

    def test_crd_final_rigoureusement_nul(self):
        for capital, taux, duree, differe, mode in self.CAS:
            with self.subTest(capital=capital, duree=duree, differe=differe, mode=mode):
                lignes = construire_echeancier(capital, taux, duree, differe, mode)
                self.assertEqual(lignes[-1]["crd"], D("0.00"))

    def test_somme_du_principal_egale_le_capital_a_amortir(self):
        for capital, taux, duree, differe, mode in self.CAS:
            with self.subTest(capital=capital, mode=mode):
                lignes = construire_echeancier(capital, taux, duree, differe, mode)
                totaux = totaux_echeancier(lignes)
                # En franchise totale le capital amorti inclut les intérêts capitalisés.
                attendu = capital + totaux["interets_capitalises"]
                self.assertEqual(totaux["capital_rembourse"], attendu)

    def test_service_dette_egale_principal_plus_interets_payes(self):
        for capital, taux, duree, differe, mode in self.CAS:
            with self.subTest(capital=capital, mode=mode):
                totaux = totaux_echeancier(
                    construire_echeancier(capital, taux, duree, differe, mode))
                self.assertEqual(
                    totaux["service_dette"],
                    totaux["capital_rembourse"] + totaux["interets_payes"],
                )

    def test_nombre_de_lignes_et_phases(self):
        lignes = construire_echeancier(D("5000"), D("12"), 10, 4)
        self.assertEqual(len(lignes), 10)
        self.assertEqual(sum(1 for l in lignes if l["phase"] == "differe"), 4)
        self.assertEqual(sum(1 for l in lignes if l["phase"] == "amortissement"), 6)

    def test_solde_strictement_decroissant_pendant_l_amortissement(self):
        lignes = construire_echeancier(D("9000"), D("15"), 12, 3)
        amort = [l for l in lignes if l["phase"] == "amortissement"]
        for precedent, suivant in zip(amort, amort[1:]):
            self.assertLess(suivant["crd"], precedent["crd"])

    def test_mensualite_decroissante_en_amortissement(self):
        """C'est la définition du « dégressif » : l'intérêt suit le solde."""
        lignes = construire_echeancier(D("9000"), D("15"), 12, 3)
        amort = [l for l in lignes if l["phase"] == "amortissement"]
        for precedent, suivant in zip(amort, amort[1:-1]):
            self.assertLessEqual(suivant["echeance"], precedent["echeance"])


class CasLimitesTests(SimpleTestCase):

    def test_sans_differe(self):
        lignes = construire_echeancier(D("1200"), D("12"), 3, 0)
        self.assertTrue(all(l["phase"] == "amortissement" for l in lignes))
        self.assertEqual(lignes[0]["interets"], D("12.00"))    # 1200 × 1 %
        self.assertEqual(lignes[-1]["crd"], D("0.00"))

    def test_taux_nul_ne_produit_aucun_interet(self):
        totaux = totaux_echeancier(construire_echeancier(D("900"), D("0"), 3, 0))
        self.assertEqual(totaux["interets_payes"], D("0.00"))
        self.assertEqual(totaux["service_dette"], D("900.00"))

    def test_differe_maximal_amortit_tout_sur_le_dernier_mois(self):
        lignes = construire_echeancier(D("1000"), D("12"), 6, 5)
        self.assertEqual(lignes[-1]["capital"], D("1000.00"))
        self.assertEqual(lignes[-1]["crd"], D("0.00"))

    def test_differe_egal_a_la_duree_est_refuse(self):
        with self.assertRaises(EcheancierError) as ctx:
            construire_echeancier(D("1000"), D("12"), 6, 6)
        self.assertEqual(ctx.exception.code, "DIFFERE_TROP_LONG")

    def test_parametres_invalides(self):
        cas = [
            ((D("0"), D("12"), 6, 0), "CAPITAL_INVALIDE"),
            ((D("-5"), D("12"), 6, 0), "CAPITAL_INVALIDE"),
            ((D("1000"), D("-1"), 6, 0), "TAUX_INVALIDE"),
            ((D("1000"), D("12"), 0, 0), "DUREE_INVALIDE"),
            ((D("1000"), D("12"), 6, -1), "DIFFERE_INVALIDE"),
        ]
        for args, code in cas:
            with self.subTest(code=code), self.assertRaises(EcheancierError) as ctx:
                construire_echeancier(*args)
            self.assertEqual(ctx.exception.code, code)

    def test_mode_differe_inconnu_est_refuse(self):
        with self.assertRaises(EcheancierError) as ctx:
            construire_echeancier(D("1000"), D("12"), 6, 2, "capitalisation_partielle")
        self.assertEqual(ctx.exception.code, "MODE_DIFFERE_INCONNU")

    def test_serialisation_sans_flottant(self):
        lignes = serialiser_echeancier(construire_echeancier(D("1330"), D("18"), 8, 5))
        self.assertEqual(lignes[0]["echeance"], "19.95")
        self.assertEqual(lignes[-1]["crd"], "0.00")
        for ligne in lignes:
            for cle in ("capital", "interets", "echeance", "crd"):
                self.assertIsInstance(ligne[cle], str)

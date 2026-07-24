"""Verrous sur la correspondance des deux nomenclatures de filières (CLAUDE.md §6)."""
from __future__ import annotations

from django.test import SimpleTestCase

from common import filieres


class TableEpingleeTests(SimpleTestCase):
    """La table épinglée est un VERROU, pas une source de vérité : elle doit rester
    d'accord avec la détection par signaux de `referentiel/chains.py`."""

    def test_chaque_code_epingle_est_retrouve_par_les_signaux_du_catalogue(self):
        """Si ce test tombe, quelqu'un a retouché les `keywords` de `chains.py` et déplacé
        une filière de famille. Ce n'est pas la table épinglée qu'il faut alors corriger en
        premier : c'est le déplacement qu'il faut valider métier."""
        for alphabetique, attendu in filieres.CORRESPONDANCES_EPINGLEES.items():
            with self.subTest(filiere=alphabetique):
                trouve = filieres._par_mots_cles(filieres._normaliser(alphabetique))
                self.assertIsNotNone(trouve, f"aucun signal ne rattache {alphabetique}")
                self.assertEqual(trouve[0].code, attendu)

    def test_les_codes_epingles_existent_dans_le_catalogue(self):
        for alphabetique, numerique in filieres.CORRESPONDANCES_EPINGLEES.items():
            with self.subTest(filiere=alphabetique):
                self.assertTrue(filieres.est_numero(numerique))

    def test_la_relation_est_N_vers_1_pas_une_bijection(self):
        """Maïs et riz sont deux cultures de la MÊME famille « Céréales ». C'est la raison
        de fond pour laquelle les deux nomenclatures ne peuvent pas fusionner."""
        self.assertEqual(filieres.numero_pour("MAIS"), "01")
        self.assertEqual(filieres.numero_pour("RIZ"), "01")
        self.assertEqual(filieres.codes_par_numero()["01"], ("MAIS", "RIZ"))


class NormalisationDuNumeroTests(SimpleTestCase):
    def test_zero_de_tete_accepte_en_entree_jamais_absent_en_sortie(self):
        self.assertEqual(filieres.normaliser_numero("1"), "01")
        self.assertEqual(filieres.normaliser_numero(" 09 "), "09")
        self.assertEqual(filieres.normaliser_numero("14"), "14")

    def test_hors_catalogue_refuse(self):
        for valeur in ("15", "00", "99", "", "MAIS", None):
            with self.subTest(valeur=valeur):
                self.assertEqual(filieres.normaliser_numero(valeur), "")


class ResolutionTests(SimpleTestCase):
    def test_un_code_numerique_traverse_sans_dommage(self):
        trouve = filieres.resoudre("09")
        self.assertEqual(trouve.code_numerique, "09")
        self.assertEqual(trouve.origine, "numerique")
        self.assertEqual(trouve.specialite, "elevage")

    def test_un_slug_technique_est_reconnu(self):
        trouve = filieres.resoudre("aquaculture")
        self.assertEqual((trouve.code_numerique, trouve.origine), ("11", "slug"))

    def test_un_code_alphabetique_seede_est_rattache_a_sa_famille(self):
        trouve = filieres.resoudre("MANIOC")
        self.assertEqual(trouve.code_numerique, "03")
        self.assertEqual(trouve.libelle, "Tubercules & racines")
        self.assertEqual(trouve.origine, "epinglee")

    def test_une_filiere_inconnue_du_verrou_est_rattachee_par_signal(self):
        """Le référentiel alphabétique n'est pas borné par le code (il vient d'un classeur
        uploadé) : une filière ajoutée demain doit se rattacher sans redéploiement."""
        trouve = filieres.resoudre("PATATE_DOUCE")
        self.assertEqual(trouve.code_numerique, "03")
        self.assertEqual(trouve.origine, "mot_cle")
        self.assertEqual(trouve.indice, "patate douce")

    def test_le_libelle_sert_de_recours_quand_le_code_est_opaque(self):
        trouve = filieres.resoudre("VC_2026_A", libelle="Tilapia en étang")
        self.assertEqual(trouve.code_numerique, "11")
        self.assertEqual(trouve.indice, "tilapia")

    def test_accents_et_casse_ne_changent_rien(self):
        for entree in ("MAIS", "maïs", "Maïs", "mais"):
            with self.subTest(entree=entree):
                self.assertEqual(filieres.numero_pour(entree), "01")

    def test_le_signal_le_plus_specifique_gagne(self):
        """Un « moulin à maïs » est de la Transformation (14), pas de la culture de
        céréales (01) : `moulin` est un signal plus long donc plus spécifique que `mais`."""
        self.assertEqual(filieres.numero_pour("MOULIN_MAIS"), "14")

    def test_une_filiere_non_rattachable_ne_recoit_AUCUNE_famille_par_defaut(self):
        """Substituer un référentiel par défaut ferait scorer un dossier contre les plages
        d'une autre filière — un faux plus dangereux qu'une absence (principe 10)."""
        self.assertIsNone(filieres.resoudre("ZZZ_INCONNU"))
        self.assertEqual(filieres.numero_pour("ZZZ_INCONNU"), "")
        self.assertEqual(filieres.numero_pour(""), "")

    def test_la_resolution_porte_son_lignage(self):
        """« Chaque chiffre a une provenance » : l'analyste doit pouvoir dire pourquoi un
        dossier a été rapproché de telle famille, et avec quelle autorité."""
        self.assertEqual(filieres.resoudre("01").origine, "numerique")
        self.assertEqual(filieres.resoudre("MAIS").origine, "epinglee")
        self.assertEqual(filieres.resoudre("cereales").origine, "slug")
        self.assertEqual(filieres.resoudre("SORGHO").origine, "mot_cle")


class RattachementDesLecteursExistantsTests(SimpleTestCase):
    """Le pont sert d'abord à réparer une jointure qui ne matche qu'en test.

    `credits/referentiel_loader.py` écrit du numérique dans
    `ReferentielFiliere.value_chain_code` ; `credits/analyse.py` et
    `credits/dataio_simulator.py` l'interrogent avec `ValueChain.code`, alphabétique. Ce
    test documente la traduction que ces lecteurs devront appliquer — le raccordement
    lui-même appartient au lot `credits`.
    """

    def test_les_cinq_filieres_seedees_se_traduisent_toutes(self):
        seedees = {
            "CAFE_ARABICA": "Café Arabica",
            "MAIS": "Maïs",
            "MANIOC": "Manioc",
            "HARICOT": "Haricot",
            "RIZ": "Riz",
        }
        for code, label in seedees.items():
            with self.subTest(filiere=code):
                numero = filieres.numero_pour(code, libelle=label)
                self.assertTrue(
                    filieres.est_numero(numero),
                    f"{code} ne se rattache à aucune chaîne 01–14",
                )

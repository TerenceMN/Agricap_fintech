"""Garde-fou du mapping des rubriques — le défaut le plus coûteux du moteur.

Ce qui s'est passé
------------------
`rubrique_to_module` rendait `None` aussi bien pour la ligne TOTAL (à sauter)
que pour une rubrique qu'il ne savait pas classer, et `referentiel_loader`
traitait les deux par le même `continue`. Les simulateurs institutionnels
renomment librement leurs rubriques selon la filière (« Alimentation » pour du
poulet, « Substrat & blanc de champignon » pour des pleurotes) : sept sur
quatorze portaient des libellés qu'aucun fragment ne reconnaissait, et leurs
coûts n'entraient dans AUCUN module.

L'effet n'est pas une perte symétrique, c'est une ASYMÉTRIE : le classeur du
demandeur suit le template officiel et se lit en entier, la référence de sa
filière était amputée. Sur le poulet de chair, « Alimentation » — 2 920 USD, le
premier poste du cycle — manquait d'un seul côté de la comparaison : 77,8 % de
la référence, donc un faux « surcoût » systématique sur toute la filière.

Ce que ces tests verrouillent
-----------------------------
* les libellés relevés se classent, et se classent au bon endroit ;
* « Maintenance & pièces » ne part plus en main-d'œuvre — un poste MAL classé
  fausse le poids du module autant qu'un poste absent ;
* aucun simulateur institutionnel ne perd plus qu'un seuil de ses coûts ;
* et surtout : tout libellé non classé doit être un cas CONNU et arbitré. Un
  libellé nouveau fait échouer le garde-fou au lieu de disparaître.
"""
from __future__ import annotations

import glob
import os
import shutil
import tempfile
from decimal import Decimal
from io import StringIO
from unittest import skipUnless

from django.conf import settings
from django.core.management import call_command
from django.test import TestCase, override_settings

from credits.needs_sheet import (
    RUBRIQUES_AMBIGUES,
    analyser_couverture_rubriques,
    est_ambigue,
    normalize,
    rubrique_to_module,
)
from credits.referentiel_loader import charger_depuis_simulateur, simulateurs_disponibles

SIM_GLOB = os.path.join(
    settings.DOCUMENT_EXCEL_DIR, "Agricap FIN simulateur Par Chaine",
    "AGRICAP_FIN_SIM_*.xlsx",
)

#: Part maximale des coûts d'un classeur qui peut échapper au mapping.
#:
#: Ce n'est pas une tolérance de confort : c'est le plafond au-delà duquel une
#: référence cesse de décrire sa filière. À 5 %, un dossier comparé à cette
#: référence est jugé sur au moins 95 % des coûts réels. Le garde-fou principal
#: reste néanmoins l'assertion suivante — TOUT libellé non classé doit être un
#: cas connu — parce qu'un seuil laisse passer les petites pertes silencieuses,
#: et qu'une petite perte non expliquée est déjà un mapping incomplet.
SEUIL_PERTE_MAPPING_PCT = Decimal("5")


class MappingRubriquesTest(TestCase):
    """Les libellés locaux des simulateurs, un par un."""

    def test_les_libelles_releves_se_classent(self):
        attendus = {
            # Intrants — le cheptel de départ, l'aliment, le substrat, les plants
            "Alimentation": "semences",
            "Poussins & produits vétérinaires": "semences",
            "Alevins & intrants d'élevage": "semences",
            "Géniteurs & substrats": "semences",
            "Colonies & consommables apicoles": "semences",
            "Substrat & blanc de champignon": "semences",
            "Plants & investissements agroforestiers": "semences",
            "Consommables d'exploitation": "semences",
            # Opérations de production
            "Conduite du rucher": "mecanisation",
            "Conduite de production": "mecanisation",
            "Opérations de bande": "mecanisation",
            "Fonctionnement du moulin": "mecanisation",
            "Préparation & stérilisation": "mecanisation",
            # Aval de production
            "Pêche & conditionnement": "postrecolte",
            "Transformation & qualité": "postrecolte",
            "Récolte & extraction": "postrecolte",
            # Les rubriques du template officiel restent inchangées
            "Semences & Intrants": "semences",
            "Opérations mécanisées": "mecanisation",
            "Main d'œuvre": "maindoeuvre",
            "Équipement & petit matériel": "equipements",
            "Récolte & post-récolte": "postrecolte",
            "Logistique": "logistique",
            "Commercialisation": "commercialisation",
            "Réserve d'exploitation": "reserve",
        }
        for libelle, module in attendus.items():
            self.assertEqual(rubrique_to_module(libelle), module, libelle)

    def test_la_ligature_oe_ne_fait_plus_echouer_le_fragment(self):
        """« Main d'œuvre » ne contenait PAS la chaîne « oeuvre »."""
        self.assertIn("oeuvre", normalize("Main d'œuvre"))
        self.assertEqual(rubrique_to_module("Main d'œuvre"), "maindoeuvre")
        self.assertEqual(rubrique_to_module("Main d'œuvre & énergie"), "maindoeuvre")
        self.assertEqual(rubrique_to_module("Main d'oeuvre"), "maindoeuvre")

    def test_maintenance_n_est_plus_prise_pour_de_la_main_d_oeuvre(self):
        """Le fragment « main » attrapait « Maintenance » : 360 USD d'entretien
        comptés en salaires. Mal classer n'est pas moins grave qu'omettre."""
        self.assertIsNone(rubrique_to_module("Maintenance & pièces"))
        self.assertTrue(est_ambigue("Maintenance & pièces"))

    def test_commercialisation_prime_sur_conditionnement(self):
        """L'ordre des fragments décide : « Commercialisation & conditionnement »
        est du commercial, « Pêche & conditionnement » de la post-récolte."""
        self.assertEqual(
            rubrique_to_module("Commercialisation & conditionnement"), "commercialisation")
        self.assertEqual(rubrique_to_module("Pêche & conditionnement"), "postrecolte")

    def test_la_ligne_total_n_est_pas_une_rubrique_inconnue(self):
        self.assertIsNone(rubrique_to_module("TOTAL GÉNÉRAL"))
        self.assertFalse(est_ambigue("TOTAL GÉNÉRAL"))

    def test_une_seule_table_pour_les_trois_chemins_de_lecture(self):
        """Principe 6 : `needs_parser` et `dataio_simulator` portaient chacun
        leur copie, aux fragments divergents."""
        from credits.dataio_simulator import _rubrique_to_module as via_simulateur
        from credits.needs_parser import _rubrique_to_module as via_parseur

        for libelle in ("Alimentation", "Fonctionnement du moulin",
                        "Maintenance & pièces", "Main d'œuvre"):
            self.assertEqual(via_parseur(libelle), rubrique_to_module(libelle), libelle)
            self.assertEqual(via_simulateur(libelle), rubrique_to_module(libelle), libelle)


class CouvertureBruyanteTest(TestCase):
    """Un coût qu'on ne sait pas classer est une information, pas un zéro."""

    def test_mesure_la_part_non_reconnue(self):
        couverture = analyser_couverture_rubriques([
            ("Semences & Intrants", Decimal("800")),
            ("Rubrique exotique", Decimal("200")),
            ("TOTAL GÉNÉRAL", Decimal("1000")),
        ])
        self.assertEqual(couverture["total"], Decimal("1000.00"))
        self.assertEqual(couverture["totalClasse"], Decimal("800.00"))
        self.assertEqual(couverture["totalNonReconnu"], Decimal("200.00"))
        self.assertEqual(couverture["partNonReconnuePct"], Decimal("20.00"))
        self.assertEqual(len(couverture["nonReconnues"]), 1)
        self.assertEqual(couverture["nonReconnues"][0]["rubrique"], "Rubrique exotique")
        self.assertFalse(couverture["nonReconnues"][0]["arbitrageEnAttente"])

    def test_journalise_ce_qui_echappe_au_mapping(self):
        with self.assertLogs("credits.needs_sheet", level="WARNING") as journal:
            analyser_couverture_rubriques([("Rubrique exotique", Decimal("200"))],
                                          origine="classeur-test.xlsx")
        trace = " ".join(journal.output)
        self.assertIn("Rubrique exotique", trace)
        self.assertIn("classeur-test.xlsx", trace)

    def test_une_couverture_complete_ne_bruite_pas(self):
        couverture = analyser_couverture_rubriques([
            ("Semences & Intrants", Decimal("800")),
            ("Logistique", Decimal("200")),
        ])
        self.assertEqual(couverture["nonReconnues"], [])
        self.assertEqual(couverture["partNonReconnuePct"], Decimal("0.00"))

    def test_une_ambiguite_connue_est_signalee_comme_telle(self):
        couverture = analyser_couverture_rubriques([
            ("Maintenance & pièces", Decimal("360")),
        ])
        self.assertTrue(couverture["nonReconnues"][0]["arbitrageEnAttente"])


@skipUnless(len(glob.glob(SIM_GLOB)) > 0, f"Classeurs simulateurs absents ({SIM_GLOB}).")
class ReferenceNonAmputeeTest(TestCase):
    """Le garde-fou qui aurait attrapé le défaut : sur les classeurs RÉELS."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media = tempfile.mkdtemp(prefix="agricap-test-couverture-")
        cls._override = override_settings(MEDIA_ROOT=cls._media)
        cls._override.enable()
        call_command("ingest_simulateurs", stdout=StringIO(), verbosity=0)

    @classmethod
    def tearDownClass(cls):
        cls._override.disable()
        shutil.rmtree(cls._media, ignore_errors=True)
        super().tearDownClass()

    def _couvertures(self):
        for source in simulateurs_disponibles():
            spec = charger_depuis_simulateur(source)
            yield source.original_name, spec["_lignage"]["couvertureRubriques"]

    def test_aucun_simulateur_ne_perd_plus_que_le_seuil(self):
        examines = 0
        for nom, couverture in self._couvertures():
            examines += 1
            self.assertLessEqual(
                couverture["partNonReconnuePct"], SEUIL_PERTE_MAPPING_PCT,
                f"{nom} : {couverture['partNonReconnuePct']} % des coûts "
                f"n'entrent dans aucun module ({couverture['totalNonReconnu']} "
                f"sur {couverture['total']}). La référence de cette filière est "
                f"amputée et tout dossier comparé à elle paraîtra surcoté. "
                f"Rubriques en cause : {couverture['nonReconnues']}",
            )
        self.assertGreaterEqual(examines, 14, "Les 14 simulateurs doivent être lus.")

    def test_tout_libelle_non_classe_est_un_cas_connu_et_arbitre(self):
        """Le vrai garde-fou : un libellé NOUVEAU ne passe pas en silence.

        Un seuil laisse filer les petites pertes ; cette assertion n'en laisse
        filer aucune. Ajouter un classeur dont une rubrique est inconnue fait
        échouer ce test — soit on complète le mapping, soit on inscrit
        l'ambiguïté dans `RUBRIQUES_AMBIGUES` avec sa justification.
        """
        inconnus: list[str] = []
        for nom, couverture in self._couvertures():
            for entree in couverture["nonReconnues"]:
                if not entree["arbitrageEnAttente"]:
                    inconnus.append(f"{nom} : « {entree['rubrique']} » "
                                    f"({entree['montant']} USD)")
        self.assertEqual(
            inconnus, [],
            "Rubriques non classées et non arbitrées — elles sortent de la "
            "référence de leur filière sans que personne ne l'ait décidé :\n  "
            + "\n  ".join(inconnus),
        )

    def test_l_ambiguite_documentee_est_la_seule_perte_restante(self):
        """Contrôle de non-régression sur l'inventaire lui-même : si une
        ambiguïté est tranchée, ce test rappelle de la retirer de la liste."""
        restantes = {
            entree["rubrique"]
            for _, couverture in self._couvertures()
            for entree in couverture["nonReconnues"]
        }
        self.assertEqual(restantes, {"Maintenance & pièces"})
        self.assertEqual(RUBRIQUES_AMBIGUES, ("maintenance",))

    def test_la_somme_des_modules_egale_le_total_classe(self):
        """Invariant : rien ne se perd ENTRE le classement et la référence.

        Deux rubriques d'un même module (« Poussins » et « Alimentation » sont
        toutes deux des intrants) s'additionnent ; l'écriture directe gardait la
        dernière et perdait la première. Ce test l'attrape sans dépendre d'un
        classeur particulier : il compare, pour chacun, la somme des coûts
        modules ramenée au cycle au total réellement classé.
        """
        for source in simulateurs_disponibles():
            spec = charger_depuis_simulateur(source)
            lignage = spec["_lignage"]
            quantite = Decimal(lignage["quantiteReference"])
            somme = sum(
                (Decimal(bloc["ref"]) * quantite for bloc in spec["couts_modules"].values()),
                Decimal("0"),
            )
            attendu = Decimal(lignage["couvertureRubriques"]["totalClasse"])
            # Tolérance d'arrondi : chaque `ref` est quantizé au centime avant
            # d'être remultiplié par la quantité de référence.
            ecart = abs(somme - attendu)
            self.assertLessEqual(
                ecart, quantite * Decimal("0.01") * len(spec["couts_modules"]),
                f"{source.original_name} : Σ modules = {somme}, classé = {attendu}",
            )

    def test_l_alimentation_entre_enfin_dans_la_reference_avicole(self):
        """Le cas qui a motivé le lot, vérifié de bout en bout."""
        source = next(
            s for s in simulateurs_disponibles()
            if "_09_" in (s.original_name or "")
        )
        spec = charger_depuis_simulateur(source)
        couverture = spec["_lignage"]["couvertureRubriques"]
        self.assertEqual(couverture["totalNonReconnu"], Decimal("0.00"))
        # 1 020 (poussins) + 2 920 (alimentation) = 3 940 d'intrants, là où la
        # référence n'en portait aucun.
        quantite = Decimal(spec["_lignage"]["quantiteReference"])
        self.assertEqual(
            Decimal(spec["couts_modules"]["semences"]["ref"]),
            (Decimal("3940") / quantite).quantize(Decimal("0.01")),
        )

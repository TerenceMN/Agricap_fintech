"""
Tests de l'ingestion des simulateurs par chaîne (`ingest_simulateurs`) et de leur
lecture par `referentiel_loader.charger_depuis_simulateur`.

Exigence de la mission (Volet 1) : les 14 filières sont ingérées, et chacune
PRODUIT un référentiel LU depuis son classeur OU est refusée proprement — jamais
complétée par une valeur inventée (principe 1).

RÈGLE MÉTIER CHANGÉE — modèle « hectare » généralisé (lot moteur unifié)
-----------------------------------------------------------------------
Ces tests verrouillaient le fait que le loader ne lisait QUE des hectares et
REFUSAIT les cinq filières hors-sol (08 ruches, 09 sujets, 10 m² de bioconversion,
13 sacs de substrat, 14 tonnes usinées). C'était le comportement correct tant que
le modèle n'avait qu'une unité : inventer une superficie aurait fabriqué des
coûts/ha faux, donc un score technique faux sur 25 % de la note.

Le modèle porte désormais une unité de référence quelconque, lue dans le classeur
lui-même. Les cinq filières refusées deviennent scorables, et 5 filières sur 14
(36 % du référentiel institutionnel) sortent de l'angle mort. Les assertions qui
décrivaient l'ANCIENNE règle sont donc réécrites pour décrire la NOUVELLE — pas
supprimées, et en gagnant en exigence :

  - l'ancien `test_split_lecture_conforme_au_modele_hectare` vérifiait QUELLES
    filières sont lues ; il devient `test_chaque_filiere_produit_un_referentiel_
    dans_son_unite`, qui vérifie en plus DANS QUELLE UNITÉ chacune est lue —
    une filière en hectares étiquetée « ruche » (ou l'inverse) échoue ;
  - le garde-fou anti-invention (`test_les_couts_lus_sont_derives_du_classeur_
    pas_inventes`) est INCHANGÉ dans sa logique et s'applique maintenant aux 14
    classeurs au lieu de 9 : chaque coût reste `total_rubrique ÷ quantité de
    référence`, relu des `DataRecord` ;
  - le refus reste testé (`test_refus_explicite_quand_la_dimension_est_illisible`),
    sur le seul cas qui subsiste : un classeur sans dimension nommée.

Ces tests lisent les classeurs réels du dépôt (`DOCUMENT_EXCEL_DIR/« Agricap FIN
simulateur Par Chaine »`) : sans eux, ils sont sautés proprement.
"""
from __future__ import annotations

import glob
import os
import re
import shutil
import tempfile
from decimal import Decimal
from io import StringIO
from unittest import skipUnless

from django.conf import settings
from django.core.management import call_command
from django.test import TestCase, override_settings

from credits.needs_sheet import rubrique_to_module
from credits.referentiel_loader import (
    ReferentielIntrouvable,
    charger_depuis_simulateur,
    simulateurs_disponibles,
)
from dataio.models import KIND_SIMULATEUR, STATUS_COMMITTED, DataSource

SIM_DIR = os.path.join(settings.DOCUMENT_EXCEL_DIR, "Agricap FIN simulateur Par Chaine")
SIM_GLOB = os.path.join(SIM_DIR, "AGRICAP_FIN_SIM_*.xlsx")

#: Unité de référence ATTENDUE pour chaque filière, telle que son classeur la
#: nomme en « 2_Identification_Projet ». C'est la table de vérité du modèle
#: généralisé : le loader doit lire les 14, chacune dans SON unité.
#:
#:   01–07, 12 → « Superficie exploitée (ha) » / « Superficie totale … (ha) »
#:   08        → « Nombre de ruches »
#:   09        → « Effectif (nombre de sujets) »
#:   10        → « Surface de bioconversion (m²) »
#:   11        → « Superficie en eau (ha) » — pisciculture, bien en hectares
#:   13        → « Nombre de sacs de substrat »
#:   14        → « Volume usiné sur le cycle (t) »
UNITE_ATTENDUE = {
    "01": "ha", "02": "ha", "03": "ha", "04": "ha", "05": "ha", "06": "ha",
    "07": "ha", "08": "ruche", "09": "sujet", "10": "m2", "11": "ha",
    "12": "ha", "13": "sac", "14": "t",
}

#: Les cinq filières que l'ancien modèle refusait, et que le nouveau doit lire.
#: Nommées explicitement : c'est le gain fonctionnel du lot, il mérite son test.
NUMEROS_HORS_HECTARE = {"08", "09", "10", "13", "14"}


def _fichiers_simulateurs() -> list[str]:
    return sorted(glob.glob(SIM_GLOB))


def _numero(nom: str) -> str:
    return os.path.basename(nom).split("_")[3]


_DISPO = len(_fichiers_simulateurs()) > 0


@skipUnless(_DISPO, f"Classeurs simulateurs absents ({SIM_GLOB}).")
class IngestionSimulateursTests(TestCase):
    """Ingestion réelle des simulateurs par chaîne, une fois pour toute la classe."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media = tempfile.mkdtemp(prefix="agricap-test-sim-media-")
        cls._override = override_settings(MEDIA_ROOT=cls._media)
        cls._override.enable()
        cls._fichiers = _fichiers_simulateurs()
        cls._out = StringIO()
        call_command("ingest_simulateurs", stdout=cls._out, verbosity=1)

    @classmethod
    def tearDownClass(cls):
        cls._override.disable()
        shutil.rmtree(cls._media, ignore_errors=True)
        super().tearDownClass()

    # ── Présence et ingestion (les 14, unité-agnostique) ──────────────────────
    def test_les_14_classeurs_sont_presents(self):
        """Les 8 nouveaux (07–14) doivent exister à côté des 6 premiers."""
        numeros = sorted(_numero(f) for f in self._fichiers)
        for attendu in [f"{n:02d}" for n in range(1, 15)]:
            self.assertIn(
                attendu, numeros,
                f"Simulateur {attendu} absent du dossier {SIM_DIR}.",
            )

    def test_chaque_classeur_est_ingere_comme_simulateur_courant(self):
        """L'ingestion dataio est générique : les 14 passent, unité de référence
        indifférente (une feuille = une table)."""
        for path in self._fichiers:
            name = os.path.basename(path)
            src = (DataSource.objects
                   .filter(original_name=name, is_current=True, status=STATUS_COMMITTED)
                   .first())
            self.assertIsNotNone(src, f"{name} n'a pas été ingéré comme source courante.")
            self.assertEqual(src.kind, KIND_SIMULATEUR, f"{name} mal typé : {src.kind}.")
            self.assertEqual(len(src.sha256), 64, f"{name} sans SHA-256.")
            self.assertGreaterEqual(src.tables.count(), 3, f"{name} : trop peu de tables.")

    # ── Lecture du référentiel : lire OU refuser, jamais inventer ─────────────
    def test_chaque_filiere_produit_un_referentiel_dans_son_unite(self):
        """Les 14 filières sont lues, chacune dans l'unité que SON classeur nomme.

        Remplace `test_split_lecture_conforme_au_modele_hectare`, qui verrouillait
        l'ancienne règle (« 9 lues en hectares, 5 refusées »). L'assertion est plus
        forte qu'avant : elle ne dit plus seulement QUELLES filières sont lisibles,
        elle épingle l'UNITÉ de chacune. Une filière en hectares qui se mettrait à
        sortir en « ruche » — le vrai risque d'une détection générique — échoue ici.
        """
        lues: dict[str, str] = {}
        for source in simulateurs_disponibles():
            num = _numero(source.original_name)
            spec = charger_depuis_simulateur(source)   # ne doit plus lever
            lues[num] = spec["unite_reference"]
            # Invariants de provenance sur ce qui EST lu.
            self.assertEqual(spec["source"], "indicatif", source.original_name)
            self.assertEqual(spec["n_cas_reels"], 0, source.original_name)
            self.assertTrue(spec["couts_modules"], f"{source.original_name} sans coûts.")
            self.assertRegex(spec["value_chain_code"], r"^\d{2}$", source.original_name)
            # La dimension lue est tracée : quantité, unité ET libellé source.
            lignage = spec["_lignage"]
            self.assertGreater(Decimal(lignage["quantiteReference"]), 0,
                               source.original_name)
            self.assertTrue(lignage["libelleDimension"], source.original_name)

        self.assertEqual(
            lues, UNITE_ATTENDUE,
            "L'unité de référence lue ne correspond plus au classeur : une "
            "détection générique qui se trompe d'unité fausserait tous les coûts "
            "de la filière (ref × quantité).",
        )

    def test_les_cinq_filieres_hors_sol_sont_desormais_scorables(self):
        """Le gain fonctionnel du lot, nommé : 5 filières sortent de l'angle mort.

        Elles étaient refusées faute d'unité dans le modèle — 36 % du référentiel
        institutionnel inscorable. Chacune doit maintenant produire des coûts par
        unité STRICTEMENT positifs, sinon le référentiel existerait sans rien
        pouvoir comparer.
        """
        vues = set()
        for source in simulateurs_disponibles():
            num = _numero(source.original_name)
            if num not in NUMEROS_HORS_HECTARE:
                continue
            vues.add(num)
            spec = charger_depuis_simulateur(source)
            self.assertNotEqual(spec["unite_reference"], "ha", source.original_name)
            self.assertIn(spec["unite_reference"], ("ruche", "sujet", "m2", "sac", "t"))
            for module, cfg in spec["couts_modules"].items():
                self.assertGreater(
                    Decimal(cfg["ref"]), 0,
                    f"{source.original_name}/{module} : coût unitaire nul.")
        self.assertEqual(vues, NUMEROS_HORS_HECTARE)

    def test_refus_explicite_quand_la_dimension_est_illisible(self):
        """Le refus subsiste, mais seulement là où il est mérité.

        Un classeur dont la feuille d'identification ne nomme aucune dimension
        (ni unité entre parenthèses, ni « ruches / sujets / sacs ») n'est pas
        complété par une valeur devinée : il est refusé, avec un message qui dit
        quoi chercher. C'est le dernier cas de `ReferentielIntrouvable` — et il
        doit le rester.
        """
        source = simulateurs_disponibles()[0]
        table = source.tables.filter(name="2_Identification_Projet").first()
        self.assertIsNotNone(table)
        for rec in table.records.all():
            valeurs = dict(rec.values)
            if "Rubrique" in valeurs:
                valeurs["Rubrique"] = "Ligne sans dimension nommée"
                rec.values = valeurs
                rec.save(update_fields=["values"])

        with self.assertRaises(ReferentielIntrouvable) as ctx:
            charger_depuis_simulateur(source)
        message = str(ctx.exception)
        self.assertIn("Dimension de référence", message)
        # Le message nomme les unités attendues : l'admin sait quoi corriger.
        self.assertIn("ruches", message)

    def test_les_couts_lus_sont_derives_du_classeur_pas_inventes(self):
        """Cœur anti-invention : chaque coût/module = total_rubrique ÷ quantité de
        référence, relu DIRECTEMENT des DataRecord de la feuille 5 (la source que le
        loader lit).

        Logique INCHANGÉE par la généralisation des unités — seul le diviseur
        s'appelle désormais « quantité de référence » au lieu de « superficie ». La
        couverture passe de 9 à 14 classeurs : le garde-fou s'applique maintenant
        aussi aux filières hors-sol, qu'il ne protégeait pas puisqu'elles étaient
        refusées.

        PORTÉE ÉLARGIE (dette §6, « créer les simulateurs manquants ») : les
        classeurs ajoutés (riz, manioc, café arabica) partagent leur NUMÉRO de
        chaîne avec un classeur existant — « 01 » désigne désormais le maïs ET le
        riz. Compter les classeurs vérifiés et les comparer à 14 devenait donc
        faux dès le premier ajout, alors que l'exigence, elle, n'a pas bougé :
        TOUS les classeurs disponibles passent le garde-fou, et les 14 chaînes
        institutionnelles sont couvertes. C'est ce qu'on assère maintenant —
        nommer les chaînes attendues vaut mieux que compter les fichiers.
        """
        verifies: set[str] = set()
        for source in simulateurs_disponibles():
            spec = charger_depuis_simulateur(source)
            quantite = Decimal(spec["_lignage"]["quantiteReference"])
            superficie = quantite
            self.assertGreater(superficie, 0, source.original_name)

            table = source.tables.filter(name="5_Synthese_Besoins").first()
            self.assertIsNotNone(table, f"{source.original_name} sans feuille 5.")
            totaux_module: dict[str, Decimal] = {}
            for rec in table.records.order_by("row_index"):
                module = rubrique_to_module(rec.values.get("Rubrique"))
                if module is None:
                    continue
                brut = rec.values.get("Total rubrique")
                if brut in (None, ""):
                    continue
                # SOMME et non affectation : un classeur peut porter plusieurs
                # rubriques d'un même module (un cycle avicole a « Poussins &
                # produits vétérinaires » ET « Alimentation », deux intrants).
                # L'affectation directe gardait la dernière — l'attendu du test
                # reproduisait alors exactement le défaut du code qu'il vérifie.
                totaux_module[module] = (
                    totaux_module.get(module, Decimal(0))
                    + Decimal(str(brut).replace(",", "."))
                )

            self.assertEqual(
                set(spec["couts_modules"]), set(totaux_module),
                f"{source.original_name} : modules du référentiel ≠ modules du classeur.",
            )
            for module, attendu_total in totaux_module.items():
                attendu_ref = (attendu_total / superficie).quantize(Decimal("0.01"))
                obtenu_ref = Decimal(spec["couts_modules"][module]["ref"])
                self.assertEqual(
                    obtenu_ref, attendu_ref,
                    f"{source.original_name}/{module} : {obtenu_ref} ≠ {attendu_ref} "
                    "(le coût doit être relu du classeur, jamais inventé).",
                )
            verifies.add(_numero(source.original_name))
        self.assertEqual(
            verifies, set(UNITE_ATTENDUE),
            "Les 14 chaînes doivent passer le contrôle de dérivation — aucune ne "
            "doit sortir du garde-fou anti-invention, et aucun classeur ne doit "
            "porter un numéro de chaîne inconnu du référentiel.",
        )

    def test_le_mais_ne_reproduit_pas_la_fiction_historique_des_semences(self):
        """Garde-fou nommé : la répartition inventée (850 USD/ha de semences pour un
        classeur qui en donne bien moins) ne doit jamais réapparaître."""
        src = (DataSource.objects
               .filter(original_name__icontains="SIM_01_", is_current=True)
               .first())
        if src is None:
            self.skipTest("Classeur maïs (01) non ingéré.")
        spec = charger_depuis_simulateur(src)
        semences = spec["couts_modules"].get("semences")
        self.assertIsNotNone(semences, "Le maïs doit porter un coût de semences.")
        self.assertNotEqual(
            Decimal(semences["ref"]), Decimal("850"),
            "La valeur inventée 850 USD/ha de semences est réapparue.",
        )

    def test_le_rapport_de_commande_dit_l_unite_de_chaque_filiere(self):
        """Le rapport d'ingestion rend la dimension VISIBLE, filière par filière.

        Il annonçait « N filière(s) hors modèle hectare » — un aveu de couverture
        manquante. Il annonce désormais l'unité retenue pour chacune : c'est ce que
        l'admin doit pouvoir vérifier d'un coup d'œil, parce qu'une unité mal lue
        se voit dans le rapport avant de se voir dans un score.
        """
        sortie = self._out.getvalue()
        self.assertIn("par unité de référence", sortie)
        self.assertIn("0 sans dimension de reference lisible", sortie)
        for num, unite in UNITE_ATTENDUE.items():
            self.assertRegex(
                sortie, rf"SIM_{num}_[^\n]*\s{re.escape(unite)}\s",
                f"La filière {num} n'est pas rapportée avec son unité « {unite} ».",
            )

    # ── Idempotence ───────────────────────────────────────────────────────────
    def test_reingestion_ne_cree_pas_de_revision_inutile(self):
        avant = DataSource.objects.filter(kind=KIND_SIMULATEUR).count()
        out = StringIO()
        call_command("ingest_simulateurs", stdout=out, verbosity=1)
        apres = DataSource.objects.filter(kind=KIND_SIMULATEUR).count()
        self.assertEqual(avant, apres, "Une ré-ingestion à l'identique a créé des doublons.")
        self.assertIn("inchangé", out.getvalue())
        self.assertFalse(
            DataSource.objects.filter(
                kind=KIND_SIMULATEUR, is_current=True, revision__gt=1).exists(),
            "Des révisions ont été créées alors que les classeurs sont inchangés.",
        )

    def test_mode_check_ne_touche_pas_la_base(self):
        avant = DataSource.objects.count()
        out = StringIO()
        call_command("ingest_simulateurs", "--check", stdout=out, verbosity=1)
        self.assertEqual(DataSource.objects.count(), avant)
        self.assertIn("Vérification du chargement du référentiel", out.getvalue())

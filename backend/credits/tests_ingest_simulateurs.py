"""
Tests de l'ingestion des simulateurs par chaîne (`ingest_simulateurs`) et de leur
lecture par `referentiel_loader.charger_depuis_simulateur`.

Exigence de la mission (Volet 1) : les 14 filières sont ingérées, et chacune
PRODUIT un référentiel LU depuis son classeur OU est refusée proprement — jamais
complétée par une valeur inventée (principe 1).

Constat de structure (documenté, pas contourné) : le loader construit un
référentiel PAR HECTARE (il ramène les coûts à la superficie de référence). Neuf
filières se mesurent en hectares (01–07, 11 « superficie en eau », 12) ; cinq ne
s'y mesurent pas (08 ruches, 09 sujets, 10 m² de bioconversion, 13 sacs de
substrat, 14 tonnes usinées). Pour ces cinq, le loader lève `ReferentielIntrouvable`
au lieu d'inventer une superficie — comportement CORRECT que ces tests verrouillent.
Étendre le modèle « par hectare » aux unités alternatives touche le moteur de
scoring (`analyse.scorer_technique` multiplie `ref × superficie = area_ha`) : c'est
un chantier moteur, signalé au coordinateur, hors de ce lot.

Ces tests lisent les classeurs réels du dépôt (`DOCUMENT_EXCEL_DIR/« Agricap FIN
simulateur Par Chaine »`) : sans eux, ils sont sautés proprement.
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

from credits.needs_sheet import rubrique_to_module
from credits.referentiel_loader import (
    ReferentielIntrouvable,
    charger_depuis_simulateur,
    simulateurs_disponibles,
)
from dataio.models import KIND_SIMULATEUR, STATUS_COMMITTED, DataSource

SIM_DIR = os.path.join(settings.DOCUMENT_EXCEL_DIR, "Agricap FIN simulateur Par Chaine")
SIM_GLOB = os.path.join(SIM_DIR, "AGRICAP_FIN_SIM_*.xlsx")

#: Numéros de filière dont la référence est une superficie en hectares : le loader
#: DOIT les lire. Les autres (08, 09, 10, 13, 14) se mesurent en une autre unité :
#: le loader DOIT les refuser sans inventer.
NUMEROS_PAR_HECTARE = {"01", "02", "03", "04", "05", "06", "07", "11", "12"}
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
    def test_split_lecture_conforme_au_modele_hectare(self):
        """Chaque simulateur courant est SOIT lu (filière par hectare), SOIT refusé
        proprement (filière hors modèle hectare). Aucun cas intermédiaire — donc
        aucune superficie inventée pour forcer une lecture."""
        lus, refuses = set(), {}
        for source in simulateurs_disponibles():
            num = _numero(source.original_name)
            try:
                spec = charger_depuis_simulateur(source)
            except ReferentielIntrouvable as exc:
                refuses[num] = str(exc)
                continue
            lus.add(num)
            # Invariants de provenance sur ce qui EST lu.
            self.assertEqual(spec["source"], "indicatif", source.original_name)
            self.assertEqual(spec["n_cas_reels"], 0, source.original_name)
            self.assertEqual(spec["unite_reference"], "ha", source.original_name)
            self.assertTrue(spec["couts_modules"], f"{source.original_name} sans coûts.")
            self.assertRegex(spec["value_chain_code"], r"^\d{2}$", source.original_name)

        self.assertEqual(
            lus, NUMEROS_PAR_HECTARE,
            "Le jeu de filières lues par hectare a changé — vérifier qu'aucune "
            "superficie n'est inventée et qu'aucune filière hectare n'a régressé.",
        )
        self.assertEqual(
            set(refuses), NUMEROS_HORS_HECTARE,
            f"Filières refusées inattendues : {set(refuses)} vs {NUMEROS_HORS_HECTARE}.",
        )
        # Le refus est explicite sur la superficie manquante (message précis, pas
        # générique) — c'est ce qui distingue « signalé » de « inventé ».
        for num, message in refuses.items():
            self.assertIn("uperficie", message, f"Refus non explicite pour {num} : {message}")

    def test_les_couts_lus_sont_derives_du_classeur_pas_inventes(self):
        """Cœur anti-invention : chaque coût/module = total_rubrique ÷ superficie,
        relu DIRECTEMENT des DataRecord de la feuille 5 (la source que le loader lit)."""
        verifies = 0
        for source in simulateurs_disponibles():
            try:
                spec = charger_depuis_simulateur(source)
            except ReferentielIntrouvable:
                continue  # filière hors modèle hectare — testée ailleurs
            superficie = Decimal(spec["_lignage"]["superficieReference"])
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
                totaux_module[module] = Decimal(str(brut).replace(",", "."))

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
            verifies += 1
        self.assertEqual(
            verifies, len(NUMEROS_PAR_HECTARE),
            "Toutes les filières par hectare doivent passer le contrôle de dérivation.",
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

    def test_le_rapport_de_commande_signale_les_filieres_non_couvertes(self):
        """La commande DIT quelles filières sont hors modèle hectare, sans les
        présenter comme corrompues."""
        sortie = self._out.getvalue()
        self.assertIn("hors modèle hectare", sortie)
        for num in NUMEROS_HORS_HECTARE:
            self.assertRegex(
                sortie, rf"SIM_{num}_.*uperficie",
                f"La filière {num} n'est pas signalée dans le rapport.",
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

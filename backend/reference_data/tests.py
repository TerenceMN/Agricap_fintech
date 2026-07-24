"""Tests du diff de référentiel — `reference_data.services._compute_diff`.

Le diff est la seule pièce que le checker lit avant d'activer un classeur : un
champ non comparé est un champ que le maker modifie sans contrôle. Ces tests
verrouillent la dette CLAUDE.md §6 (« coûts/ha et poids modules non détectés »)
et, plus largement, l'exhaustivité du diff sur tous les champs que
`activate_file` écrira.
"""
from __future__ import annotations

import copy

from django.test import TestCase
from django.utils import timezone

from reference_data.models import ReferenceFileUpload, ValueChain
from reference_data.services import _compute_diff

BASE_ROW = {
    "code": "MAIS",
    "label": "Maïs",
    "active": True,
    "cycle_months": 5,
    "cost_per_hectare_usd": "1200.00",
    "cost_per_hectare_cdf": "3360000.00",
    "module_weights": {
        "semences": 25, "mecanisation": 15, "maindoeuvre": 25,
        "equipements": 5, "postrecolte": 12, "logistique": 8,
        "commercialisation": 5, "reserve": 5,
    },
    "risk_factor": "1.000",
    "min_score_required": 55,
    "base_rate": "7.50",
    "harvest_months": [1, 7],
    "eligible_guarantees": ["epargne", "morale"],
}


def _row(**overrides) -> dict:
    row = copy.deepcopy(BASE_ROW)
    row.update(overrides)
    return row


class DiffTestsBase(TestCase):
    """Un référentiel actif d'une seule filière, servant de « avant » au diff."""

    def setUp(self) -> None:
        self.active_upload = ReferenceFileUpload.objects.create(
            file="reference_data/actif.xlsx",
            file_type=ReferenceFileUpload.FileType.VALUE_CHAINS,
            version="v1",
            uploaded_by="maker-1",
            activated_by="checker-2",
            activated_at=timezone.now(),
            status=ReferenceFileUpload.Status.ACTIVE,
            row_count=1,
        )
        ValueChain.objects.create(source_file=self.active_upload, **copy.deepcopy(BASE_ROW))

    def diff_after(self, **overrides) -> dict:
        """Diff obtenu en déposant un classeur identique, sauf `overrides`."""
        return _compute_diff([_row(**overrides)])

    def changes_for(self, diff: dict, code: str = "MAIS") -> list[str]:
        entry = next((m for m in diff["modified"] if m["code"] == code), None)
        self.assertIsNotNone(entry, f"« {code} » absent des filières modifiées : {diff}")
        return entry["changes"]

    def fields_for(self, diff: dict, code: str = "MAIS") -> dict:
        entry = next(m for m in diff["modified"] if m["code"] == code)
        return {f["field"]: f for f in entry["fields"]}


class DetteCoutsEtPoidsTests(DiffTestsBase):
    """Dette §6 : les deux familles de champs qui gouvernent le scoring.

    Ce sont les seuls tests que la dette exige littéralement ; les autres classes
    couvrent le reste du contrat de `_compute_diff`.
    """

    def test_changement_cout_par_hectare_apparait_dans_le_diff(self):
        diff = self.diff_after(cost_per_hectare_usd="4800.00")

        self.assertEqual(diff["modified"] and diff["modified"][0]["code"], "MAIS")
        self.assertEqual(diff["unchanged"], 0)
        changes = self.changes_for(diff)
        self.assertTrue(
            any("coût/ha" in c and "1200" in c and "4800" in c for c in changes),
            f"le coût/ha USD n'apparaît pas dans le diff : {changes}",
        )
        self.assertTrue(self.fields_for(diff)["cost_per_hectare_usd"]["scoring"])
        self.assertEqual(diff["scoringImpacted"], ["MAIS"])

    def test_changement_poids_modules_apparait_dans_le_diff(self):
        poids = dict(BASE_ROW["module_weights"], semences=40, maindoeuvre=10)
        diff = self.diff_after(module_weights=poids)

        changes = self.changes_for(diff)
        self.assertTrue(
            any("poids semences" in c and "25" in c and "40" in c for c in changes),
            f"le poids « semences » n'apparaît pas dans le diff : {changes}",
        )
        self.assertTrue(
            any("poids maindoeuvre" in c and "25" in c and "10" in c for c in changes),
            f"le poids « maindoeuvre » n'apparaît pas dans le diff : {changes}",
        )
        # Seuls les deux postes déplacés sont signalés : un diff bavard ne se lit pas.
        self.assertEqual(len([c for c in changes if c.startswith("poids ")]), 2)
        self.assertTrue(self.fields_for(diff)["module_weights"]["scoring"])

    def test_les_deux_changements_ensemble_sont_tous_deux_soumis_au_checker(self):
        """Le cas de la dette : coût/ha ET poids modifiés dans le même dépôt."""
        poids = dict(BASE_ROW["module_weights"], reserve=10, logistique=3)
        diff = self.diff_after(cost_per_hectare_usd="2400.00", module_weights=poids)

        changes = self.changes_for(diff)
        self.assertTrue(any("coût/ha" in c for c in changes), changes)
        self.assertTrue(any("poids reserve" in c for c in changes), changes)
        self.assertTrue(any("poids logistique" in c for c in changes), changes)
        self.assertTrue(self.fields_for(diff)["cost_per_hectare_usd"]["scoring"])
        self.assertTrue(self.fields_for(diff)["module_weights"]["scoring"])

    def test_cout_cdf_seul_est_detecte(self):
        diff = self.diff_after(cost_per_hectare_cdf="9999999.00")
        self.assertTrue(
            any("CDF" in c for c in self.changes_for(diff)),
            self.changes_for(diff),
        )

    def test_poste_de_poids_ajoute_ou_retire_est_nomme(self):
        poids = dict(BASE_ROW["module_weights"])
        poids.pop("reserve")
        poids["irrigation"] = 5
        changes = self.changes_for(self.diff_after(module_weights=poids))

        self.assertTrue(any("poids reserve retiré" in c for c in changes), changes)
        self.assertTrue(any("poids irrigation ajouté" in c for c in changes), changes)


class DiffExhaustifTests(DiffTestsBase):
    """Tout champ que `activate_file` écrira doit être comparable par le checker."""

    def test_champs_deja_couverts_restent_detectes(self):
        diff = self.diff_after(
            cycle_months=8, risk_factor="1.400",
            min_score_required=70, base_rate="12.00",
        )
        changes = self.changes_for(diff)
        for fragment in ("cycle", "risk_factor", "score_min", "taux"):
            self.assertTrue(any(fragment in c for c in changes),
                            f"« {fragment} » absent de {changes}")

    def test_libelle_mois_de_recolte_et_garanties_sont_detectes(self):
        diff = self.diff_after(
            label="Maïs grain",
            harvest_months=[2, 8],
            eligible_guarantees=["epargne", "foncier"],
        )
        changes = self.changes_for(diff)
        self.assertTrue(any("libellé" in c for c in changes), changes)
        self.assertTrue(any("mois de récolte" in c for c in changes), changes)
        self.assertTrue(any("garanties éligibles" in c for c in changes), changes)
        # Un changement de libellé seul ne prétend pas impacter le scoring.
        self.assertTrue(self.fields_for(diff)["harvest_months"]["scoring"] is False)

    def test_changement_de_libelle_seul_n_impacte_pas_le_scoring(self):
        diff = self.diff_after(label="Maïs grain")
        self.assertEqual(diff["scoringImpacted"], [])
        self.assertFalse(diff["modified"][0]["impactsScoring"])

    def test_classeur_identique_ne_produit_aucune_modification(self):
        diff = self.diff_after()
        self.assertEqual(diff["modified"], [])
        self.assertEqual(diff["added"], [])
        self.assertEqual(diff["removed"], [])
        self.assertEqual(diff["unchanged"], 1)
        self.assertEqual(diff["scoringImpacted"], [])

    def test_ecriture_numerique_equivalente_n_est_pas_un_changement(self):
        """`0.850` et `0.85` sont le même facteur de risque — pas un faux positif."""
        diff = self.diff_after(
            risk_factor="1.0", base_rate="7.5", cost_per_hectare_usd="1200",
            module_weights={k: float(v) for k, v in BASE_ROW["module_weights"].items()},
        )
        self.assertEqual(diff["modified"], [], diff["modified"])

    def test_ordre_des_listes_n_est_pas_un_changement(self):
        diff = self.diff_after(
            harvest_months=[7, 1], eligible_guarantees=["morale", "epargne"],
        )
        self.assertEqual(diff["modified"], [], diff["modified"])

    def test_ajout_et_retrait_de_filiere(self):
        diff = _compute_diff([_row(code="RIZ", label="Riz")])
        self.assertEqual(diff["added"], ["RIZ"])
        self.assertEqual(diff["removed"], ["MAIS"])
        self.assertEqual(diff["totalNew"], 1)

    def test_seules_les_filieres_du_referentiel_actif_servent_de_reference(self):
        """Une filière d'un dépôt archivé n'est pas le « avant » du diff."""
        archived = ReferenceFileUpload.objects.create(
            file="reference_data/vieux.xlsx",
            file_type=ReferenceFileUpload.FileType.VALUE_CHAINS,
            version="v0",
            uploaded_by="maker-1",
            status=ReferenceFileUpload.Status.ARCHIVED,
        )
        ValueChain.objects.create(
            source_file=archived, **_row(code="HARICOT", label="Haricot"),
        )
        diff = self.diff_after()
        self.assertEqual(diff["removed"], [])
        self.assertEqual(diff["modified"], [])

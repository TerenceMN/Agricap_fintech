"""Anti-gaming du parseur hérité de la feuille de besoins (principe 7).

La fuite corrigée : le contrôle de cohérence renvoyait au CLIENT, dans le même
payload que son upload, le coût de référence par hectare de sa filière, le ratio
exact de son plan à ce coût, et le poids modules standard. En trois uploads, un
demandeur apprenait la grille contre laquelle il est scoré — et pouvait caler
son dossier juste sous la borne.

Ces tests verrouillent la frontière : le client garde le FAIT sur ses propres
données et l'action attendue ; la référence, le ratio et le seuil ne sortent que
vers le staff. Et les quatre seuils du contrôle vivent en base (principe 8).
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from credits.models import AnalysisRule
from credits.needs_parser import (
    REGLE_COHERENCE,
    SEUILS_COHERENCE_DEFAUT,
    _controler_coherence_referentiel,
    _seuils_coherence,
)


def _chain(*, cout_ha="1000", poids=None):
    from reference_data.models import ReferenceFileUpload, ValueChain

    upload = ReferenceFileUpload.objects.first() or ReferenceFileUpload.objects.create(
        file_type=ReferenceFileUpload.FileType.VALUE_CHAINS,
        uploaded_by="sub-test", status=ReferenceFileUpload.Status.ACTIVE,
    )
    chain, _ = ValueChain.objects.get_or_create(
        code="MAIS",
        defaults={
            "label": "Céréales — Maïs", "source_file": upload, "cycle_months": 8,
            "cost_per_hectare_usd": Decimal(cout_ha),
            "cost_per_hectare_cdf": Decimal("0"),
            "module_weights": poids if poids is not None else {"semences": 25},
            "risk_factor": Decimal("0.3"), "min_score_required": 50,
            "base_rate": Decimal("18.00"), "harvest_months": [6],
            "eligible_guarantees": ["epargne", "morale"],
        },
    )
    return chain


class PayloadClientSansBaremeTest(TestCase):
    """Le client voit son écart, jamais la valeur contre laquelle il est mesuré."""

    def test_total_trop_eleve_ne_divulgue_ni_reference_ni_ratio(self):
        chain = _chain(cout_ha="1000")           # référence = 1 000 × 3 ha = 3 000
        client, staff = _controler_coherence_referentiel(
            value_chain=chain, area_ha=Decimal("3"), currency="USD",
            grand_total=6000.0, total_by_module={"semences": 6000.0},
        )

        self.assertTrue(client)
        message = " ".join(client)
        # Le coût de référence (3 000) et le ratio (2,0) n'ont rien à y faire.
        for interdit in ("3 000", "3,000", "3000", "2.0×", "2.0x", "1.30", "1,30"):
            self.assertNotIn(interdit, message)
        # …mais le fait sur SES données reste dit, ainsi que l'action attendue.
        self.assertIn("6,000", message.replace(" ", ","))
        self.assertIn("justificatif", message)

    def test_le_staff_recoit_la_reference_le_ratio_et_le_seuil(self):
        chain = _chain(cout_ha="1000")
        _, staff = _controler_coherence_referentiel(
            value_chain=chain, area_ha=Decimal("3"), currency="USD",
            grand_total=6000.0, total_by_module={"semences": 6000.0},
        )
        entree = next(e for e in staff if e["code"] == "TOTAL_AU_DESSUS_REFERENCE")
        self.assertEqual(entree["totalReference"], 3000.0)
        self.assertEqual(entree["ratio"], 2.0)
        self.assertEqual(entree["seuil"], 1.30)
        self.assertEqual(entree["devise"], "USD")

    def test_total_trop_bas_ne_divulgue_pas_la_reference(self):
        chain = _chain(cout_ha="1000")
        client, staff = _controler_coherence_referentiel(
            value_chain=chain, area_ha=Decimal("3"), currency="USD",
            grand_total=1000.0, total_by_module={"semences": 1000.0},
        )
        message = " ".join(client)
        self.assertNotIn("3 000", message)
        self.assertNotIn("3000", message)
        self.assertNotIn("0.70", message)
        self.assertIn("exhaustivité", message)
        self.assertEqual(staff[0]["code"], "TOTAL_SOUS_REFERENCE")

    def test_poids_module_atypique_ne_divulgue_pas_le_poids_standard(self):
        chain = _chain(cout_ha="1000", poids={"semences": 20})
        client, staff = _controler_coherence_referentiel(
            value_chain=chain, area_ha=Decimal("3"), currency="USD",
            grand_total=3000.0, total_by_module={"semences": 2700.0},
        )
        message = " ".join(client)
        self.assertIn("semences", message)
        self.assertIn("90 %", message)          # SON pourcentage, qu'il sait calculer
        self.assertNotIn("20 %", message)       # le poids standard, jamais
        self.assertNotIn("standard :", message)

        entree = next(e for e in staff if e["code"] == "POIDS_MODULE_ATYPIQUE")
        self.assertEqual(entree["poidsReferencePct"], 20.0)
        self.assertEqual(entree["poidsObservePct"], 90.0)

    def test_module_marginal_du_referentiel_ne_declenche_rien(self):
        """Sous le plancher, un écart relatif est du bruit, pas un signal."""
        chain = _chain(cout_ha="1000", poids={"reserve": 3})
        client, staff = _controler_coherence_referentiel(
            value_chain=chain, area_ha=Decimal("3"), currency="USD",
            grand_total=3000.0, total_by_module={"reserve": 900.0},
        )
        self.assertEqual(client, [])
        self.assertEqual(staff, [])

    def test_dossier_conforme_ne_produit_aucune_anomalie(self):
        chain = _chain(cout_ha="1000", poids={"semences": 50})
        client, staff = _controler_coherence_referentiel(
            value_chain=chain, area_ha=Decimal("3"), currency="USD",
            grand_total=3000.0, total_by_module={"semences": 1500.0},
        )
        self.assertEqual(client, [])
        self.assertEqual(staff, [])


class SeuilsEnBaseTest(TestCase):
    """Principe 8 : 1,30 / 0,70 / 1,8 / 5 % ne vivent plus dans le code."""

    def test_seuils_lus_depuis_la_regle_active(self):
        AnalysisRule.objects.create(
            rule_id=REGLE_COHERENCE, name="Cohérence besoins vs référentiel",
            thresholds={"ratio_max": "1.10", "ratio_min": "0.90",
                        "poids_facteur_max": "1.2", "poids_plancher_pct": "2"},
            active=True,
        )
        seuils = _seuils_coherence()
        self.assertEqual(seuils["ratio_max"], 1.10)
        self.assertEqual(seuils["ratio_min"], 0.90)
        self.assertEqual(seuils["poids_facteur_max"], 1.2)
        self.assertEqual(seuils["poids_plancher_pct"], 2.0)

    def test_un_seuil_resserre_en_base_change_le_verdict(self):
        AnalysisRule.objects.create(
            rule_id=REGLE_COHERENCE, name="Cohérence", active=True,
            thresholds={"ratio_max": "1.05"},
        )
        chain = _chain(cout_ha="1000")
        client, _ = _controler_coherence_referentiel(
            value_chain=chain, area_ha=Decimal("3"), currency="USD",
            grand_total=3300.0, total_by_module={"semences": 3300.0},
        )
        # 1,10 passait sous l'ancien 1,30 ; il déclenche sous le nouveau 1,05.
        self.assertTrue(client)

    def test_regle_absente_replie_avec_avertissement(self):
        with self.assertLogs("credits.needs_parser", level="WARNING") as journal:
            seuils = _seuils_coherence()
        self.assertEqual(seuils, SEUILS_COHERENCE_DEFAUT)
        self.assertTrue(any("secours" in ligne for ligne in journal.output))

    def test_seuil_illisible_replie_sur_le_defaut(self):
        AnalysisRule.objects.create(
            rule_id=REGLE_COHERENCE, name="Cohérence", active=True,
            thresholds={"ratio_max": "beaucoup"},
        )
        with self.assertLogs("credits.needs_parser", level="WARNING"):
            seuils = _seuils_coherence()
        self.assertEqual(seuils["ratio_max"], SEUILS_COHERENCE_DEFAUT["ratio_max"])

    def test_regle_desactivee_est_ignoree(self):
        AnalysisRule.objects.create(
            rule_id=REGLE_COHERENCE, name="Cohérence", active=False,
            thresholds={"ratio_max": "9.99"},
        )
        with self.assertLogs("credits.needs_parser", level="WARNING"):
            seuils = _seuils_coherence()
        self.assertEqual(seuils["ratio_max"], SEUILS_COHERENCE_DEFAUT["ratio_max"])

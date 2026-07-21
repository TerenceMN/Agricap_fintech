"""
Barèmes de score éditables par le comité (`BaremeScore`) — édition maker-checker
avec prévisualisation d'impact sur le golden set AVANT activation (principe 8).

Couvre : validation du contenu, proposition append-only + preview figée,
activation maker ≠ checker, bascule du barème actif, immuabilité de l'historique,
et un cas d'impact CHIFFRÉ sur une analyse réelle du golden set.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from accounts.models import FintechUser
from audit.models import AuditEntry
from credits import baremes as bs
from credits.models import (
    AnalyseCredit, BaremeRevision, BaremeScore, CreditApplication,
    ImmutableBaremeRevision, ReferentielFiliere,
)

_ANCIENNE = [{"x": "0.5", "y": "0"}, {"x": "1.0", "y": "50"}, {"x": "1.5", "y": "100"}]
_NOUVELLE = [{"x": "0.5", "y": "50"}, {"x": "1.0", "y": "100"}, {"x": "1.5", "y": "100"}]


def _dscr_bareme(points=None) -> BaremeScore:
    return BaremeScore.objects.create(
        code="DSCR", libelle="Capacité de remboursement",
        points=points or _ANCIENNE, version=1, actif=True,
    )


class ContenuValidationTest(TestCase):
    def test_courbe_exige_deux_points(self):
        with self.assertRaises(bs.BaremeContenuInvalide):
            bs.valider_contenu("DSCR", [{"x": "1.0", "y": "50"}], {})

    def test_score_hors_bornes_refuse(self):
        with self.assertRaises(bs.BaremeContenuInvalide):
            bs.valider_contenu("DSCR", [{"x": "0", "y": "0"}, {"x": "1", "y": "150"}], {})

    def test_abscisses_dupliquees_refusees(self):
        with self.assertRaises(bs.BaremeContenuInvalide):
            bs.valider_contenu("DSCR", [{"x": "1", "y": "0"}, {"x": "1", "y": "50"}], {})

    def test_decision_exige_des_parametres(self):
        with self.assertRaises(bs.BaremeContenuInvalide):
            bs.valider_contenu("DECISION", [], {})


class PreviewSansGoldenSetTest(TestCase):
    def test_grille_echantillon_lisible_meme_sans_dossier(self):
        bareme = _dscr_bareme()
        preview = bs.previsualiser_impact(bareme, points=_NOUVELLE)
        self.assertEqual(preview["baremeCode"], "DSCR")
        self.assertEqual(preview["type"], "courbe")
        self.assertEqual(preview["goldenSet"]["nbEvalues"], 0)
        self.assertTrue(preview["sampleGrid"])   # non vide même base fraîche
        # x=1.0 : 50 → 100 sous la nouvelle courbe.
        point = next(p for p in preview["sampleGrid"] if p["x"] == 1.0)
        self.assertEqual(point["scoreAvant"], 50.0)
        self.assertEqual(point["scoreApres"], 100.0)


class ProposeActivateTest(TestCase):
    def setUp(self):
        self.bareme = _dscr_bareme()

    def test_proposition_cree_un_brouillon_sans_activer(self):
        rev = bs.proposer_revision(
            code="DSCR", points=_NOUVELLE, comment="durcir le bas de courbe",
            proposed_by_sub="sub-dg-1")
        self.assertEqual(rev.status, BaremeRevision.Status.DRAFT)
        self.assertEqual(rev.version, 2)
        self.bareme.refresh_from_db()
        # Le barème ACTIF n'a pas bougé — la proposition n'active rien.
        self.assertEqual(self.bareme.points, _ANCIENNE)
        self.assertEqual(self.bareme.version, 1)
        # L'impact est figé dans la révision.
        self.assertIn("resume", rev.impact_preview)

    def test_proposition_est_journalisee(self):
        rev = bs.proposer_revision(code="DSCR", points=_NOUVELLE,
                                   proposed_by_sub="sub-dg-1")
        self.assertEqual(
            AuditEntry.objects.filter(
                entity_type="BaremeRevision", entity_id=str(rev.pk),
                action="credits.bareme.propose").count(), 1)

    def test_une_seule_revision_en_attente(self):
        bs.proposer_revision(code="DSCR", points=_NOUVELLE, proposed_by_sub="sub-dg-1")
        with self.assertRaises(bs.BaremeRevisionEtat):
            bs.proposer_revision(code="DSCR", points=_ANCIENNE, proposed_by_sub="sub-dg-1")

    def test_activation_par_le_proposeur_refusee(self):
        rev = bs.proposer_revision(code="DSCR", points=_NOUVELLE,
                                   proposed_by_sub="sub-dg-1")
        with self.assertRaises(bs.BaremeMakerChecker):
            bs.activer_revision(revision_id=rev.pk, activated_by_sub="sub-dg-1")

    def test_activation_par_un_second_membre_bascule_le_bareme(self):
        rev = bs.proposer_revision(code="DSCR", points=_NOUVELLE,
                                   proposed_by_sub="sub-dg-1")
        bs.activer_revision(revision_id=rev.pk, activated_by_sub="sub-dg-2")

        self.bareme.refresh_from_db()
        self.assertEqual(self.bareme.points, _NOUVELLE)
        self.assertEqual(self.bareme.version, 2)
        rev.refresh_from_db()
        self.assertEqual(rev.status, BaremeRevision.Status.ACTIVE)
        self.assertEqual(rev.decided_by_sub, "sub-dg-2")
        self.assertEqual(
            AuditEntry.objects.filter(
                entity_type="BaremeRevision", entity_id=str(rev.pk),
                action="credits.bareme.activate").count(), 1)

    def test_activation_archive_la_revision_precedente(self):
        rev1 = bs.proposer_revision(code="DSCR", points=_NOUVELLE,
                                    proposed_by_sub="sub-dg-1")
        bs.activer_revision(revision_id=rev1.pk, activated_by_sub="sub-dg-2")
        rev2 = bs.proposer_revision(code="DSCR", points=_ANCIENNE,
                                    proposed_by_sub="sub-dg-1")
        bs.activer_revision(revision_id=rev2.pk, activated_by_sub="sub-dg-2")

        rev1.refresh_from_db()
        self.assertEqual(rev1.status, BaremeRevision.Status.ARCHIVED)
        self.bareme.refresh_from_db()
        self.assertEqual(self.bareme.version, 3)

    def test_reactivation_d_une_revision_active_refusee(self):
        rev = bs.proposer_revision(code="DSCR", points=_NOUVELLE,
                                   proposed_by_sub="sub-dg-1")
        bs.activer_revision(revision_id=rev.pk, activated_by_sub="sub-dg-2")
        with self.assertRaises(bs.BaremeRevisionEtat):
            bs.activer_revision(revision_id=rev.pk, activated_by_sub="sub-dg-3")

    def test_contenu_de_revision_immuable(self):
        rev = bs.proposer_revision(code="DSCR", points=_NOUVELLE,
                                   proposed_by_sub="sub-dg-1")
        rev.points = _ANCIENNE
        with self.assertRaises(ImmutableBaremeRevision):
            rev.save()

    def test_bareme_introuvable(self):
        with self.assertRaises(bs.BaremeIntrouvable):
            bs.proposer_revision(code="INEXISTANT", points=_NOUVELLE,
                                 proposed_by_sub="sub-dg-1")


class GoldenSetImpactTest(TestCase):
    """Impact CHIFFRÉ d'un changement de courbe DSCR sur une analyse réelle."""

    def _golden_analyse(self):
        from dataio.models import KIND_FEUILLE_BESOINS, STATUS_COMMITTED, DataSource

        client, _ = FintechUser.objects.get_or_create(
            sub="sub-gold", defaults={"full_name": "Gold", "phone": "+243000000001"})
        app = CreditApplication.objects.create(
            client=client, status="in_analysis", currency="USD",
            amount_requested=Decimal("30000"), code="CRED-GOLD-0001",
        )
        source = DataSource.objects.create(
            original_name="fb-gold.xlsx", dataset_key="fb__gold",
            credit_application=app, kind=KIND_FEUILLE_BESOINS,
            status=STATUS_COMMITTED, sha256="g" * 64, revision=1, is_current=True,
        )
        ref = ReferentielFiliere.objects.create(
            code="REF_GOLD_TEST", filiere="Test", actif=True)
        return AnalyseCredit.objects.create(
            application=app, needs_source=source, needs_source_revision=1,
            needs_source_sha256="g" * 64, referentiel=ref,
            duree_mois=8, differe_mois=0, taux_annuel=Decimal("18.000"),
            capital=Decimal("30000.00"), devise="USD",
            criteres={
                "technique": {"score": 40.0, "poids": 25, "points": 10.0},
                "dscr": {"score": 50.0, "poids": 20, "points": 10.0},
                "stress": {"score": 0.0, "poids": 10, "points": 0.0},
                "comportemental": {"score": 50.0, "poids": 30, "points": 15.0},
                "garanties": {"score": 60.0, "poids": 15, "points": 9.0},
            },
            dscr=Decimal("1.000"), dscr_stress=Decimal("0.500"),
            score_global=Decimal("44.0"), recommandation="refus",
            indicateurs_hors_plage=[], echeancier=[],
        )

    def test_impact_dscr_est_chiffre_et_fait_basculer_la_reco(self):
        _dscr_bareme()
        self._golden_analyse()

        preview = bs.previsualiser_impact(
            BaremeScore.objects.get(code="DSCR"), points=_NOUVELLE)

        self.assertEqual(preview["goldenSet"]["nbEvalues"], 1)
        impact = preview["impacts"][0]
        self.assertEqual(impact["scoreGlobalAvant"], 44.0)
        self.assertEqual(impact["scoreGlobalApres"], 59.0)   # +20 dscr, +5 stress
        self.assertEqual(impact["deltaScore"], 15.0)
        self.assertEqual(impact["recommandationAvant"], "refus")
        self.assertEqual(impact["recommandationApres"], "revue")
        self.assertTrue(impact["recommandationChange"])
        self.assertEqual(impact["lettreAvant"], "D")
        self.assertEqual(impact["lettreApres"], "C")

        resume = preview["resume"]
        self.assertEqual(resume["nbRecommandationFlip"], 1)
        self.assertEqual(resume["deltaScoreMax"], 15.0)

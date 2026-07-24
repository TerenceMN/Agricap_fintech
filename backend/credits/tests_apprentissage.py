"""Boucle d'apprentissage des référentiels (principe 10).

Ce que ces tests verrouillent :

* un dossier clôturé **incrémente** `n_cas_reels` — la promesse du principe 10,
  qui n'avait jusqu'ici aucun mécanisme derrière elle ;
* la clôture est **motivée** et ne s'atteint que depuis `active` ;
* **aucune substitution silencieuse** : franchir le seuil ne bascule pas
  `source` en « appris », il produit une candidature à instruire ;
* un dossier dont la ventilation vient du **référentiel lui-même** n'entre pas
  dans N — sinon la filière apprendrait de ses propres estimations ;
* le seuil N vit **en base**, pas dans le code, et son absence se signale.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from credits.apprentissage import (
    N_MIN_DEFAUT,
    candidats_a_l_apprentissage,
    enregistrer_cloture,
    seuil_n_min,
    statistiques_filiere,
)
from credits.models import (
    AnalysisRule,
    CreditApplication,
    ModuleAllocation,
    ObservationFiliere,
    ReferentielFiliere,
)
from credits.workflow import WorkflowError, close


def _referentiel(code: str = "AGRICAP_FIN_SIM_01_Cereales_Mais") -> ReferentielFiliere:
    ref, _ = ReferentielFiliere.objects.update_or_create(
        code=code,
        defaults={
            "filiere": "Céréales — Maïs",
            "value_chain_code": "MAIS",
            "unite_reference": "ha",
            "couts_modules": {"semences": {"ref": "850.00", "tol_inf": "0.30", "tol_sup": "0.40"}},
            "rendement_ref": {"qte_unite": "4.5", "prix_unitaire": "380.00", "unite": "t"},
            "n_cas_reels": 0,
            "source": ReferentielFiliere.Source.INDICATIF,
            "actif": True,
        },
    )
    return ref


def _value_chain(code: str = "MAIS"):
    from reference_data.models import ReferenceFileUpload, ValueChain

    upload = ReferenceFileUpload.objects.first() or ReferenceFileUpload.objects.create(
        file_type=ReferenceFileUpload.FileType.VALUE_CHAINS,
        uploaded_by="sub-test", status=ReferenceFileUpload.Status.ACTIVE,
    )
    chain, _ = ValueChain.objects.get_or_create(
        code=code,
        defaults={
            "label": "Céréales — Maïs",
            "source_file": upload,
            "cycle_months": 6,
            "cost_per_hectare_usd": Decimal("1200"),
            "cost_per_hectare_cdf": Decimal("3360000"),
            "module_weights": {},
            "risk_factor": Decimal("0.3"),
            "harvest_months": [6],
            "eligible_guarantees": ["epargne", "morale"],
            "base_rate": Decimal("18"),
            "min_score_required": 60,
            "active": True,
        },
    )
    return chain


def _dossier_actif(sub: str, *, origine: str = "needs_sheet",
                   chain=None) -> CreditApplication:
    from accounts.models import FintechUser

    client, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": sub, "phone": "+243900000001"},
    )
    app = CreditApplication.objects.create(
        client=client, initiated_by_sub=sub, status="active",
        amount_requested=Decimal("3000"), amount_approved=Decimal("3000"),
        disbursed_amount=Decimal("3000"), currency="USD",
        area_ha=Decimal("2.50"), value_chain=chain or _value_chain(),
        code=f"CRED-APP-{CreditApplication.objects.count():04d}",
    )
    ModuleAllocation.objects.create(
        application=app, module="semences", cost=Decimal("2000"),
        financing_pct=Decimal("80"), amount_financed=Decimal("1600"), source=origine,
    )
    ModuleAllocation.objects.create(
        application=app, module="maindoeuvre", cost=Decimal("1000"),
        financing_pct=Decimal("80"), amount_financed=Decimal("800"), source=origine,
    )
    return app


class ClotureAlimenteLaFiliereTest(TestCase):

    def setUp(self):
        self.ref = _referentiel()
        self.app = _dossier_actif("sub-app-01")

    def test_un_dossier_cloture_incremente_n_cas_reels(self):
        self.assertEqual(self.ref.n_cas_reels, 0)

        observation = close(self.app, closer_sub="sub-gest", comment="Soldé à l'échéance")

        self.ref.refresh_from_db()
        self.assertEqual(self.ref.n_cas_reels, 1)
        self.assertTrue(observation.contributive)
        self.assertEqual(observation.referentiel_id, self.ref.pk)
        self.assertEqual(observation.cout_total, Decimal("3000.00"))
        self.assertEqual(observation.couts_modules["semences"], "2000.00")
        self.assertEqual(observation.unite_reference, "ha")
        self.assertEqual(observation.quantite_reference, Decimal("2.500"))

    def test_la_cloture_passe_le_dossier_en_closed_et_journalise_son_motif(self):
        close(self.app, closer_sub="sub-gest", comment="Remboursement anticipé")
        self.app.refresh_from_db()
        self.assertEqual(self.app.status, "closed")
        self.assertIsNotNone(self.app.closed_at)
        self.assertEqual(self.app.closed_by_sub, "sub-gest")
        self.assertEqual(self.app.closure_comment, "Remboursement anticipé")

    def test_cloture_sans_motif_refusee(self):
        with self.assertRaises(WorkflowError):
            close(self.app, closer_sub="sub-gest", comment="   ")
        self.app.refresh_from_db()
        self.assertEqual(self.app.status, "active")

    def test_un_dossier_non_actif_ne_se_cloture_pas(self):
        self.app.status = "approved"
        self.app.save(update_fields=["status"])
        with self.assertRaises(WorkflowError):
            close(self.app, closer_sub="sub-gest", comment="Soldé")

    def test_deuxieme_enregistrement_ne_recompte_pas(self):
        close(self.app, closer_sub="sub-gest", comment="Soldé")
        enregistrer_cloture(self.app, par="sub-gest")
        self.ref.refresh_from_db()
        self.assertEqual(self.ref.n_cas_reels, 1)
        self.assertEqual(ObservationFiliere.objects.count(), 1)


class AucuneSubstitutionSilencieuseTest(TestCase):
    """Le seuil franchi produit une CANDIDATURE, jamais une bascule."""

    def setUp(self):
        self.ref = _referentiel()
        AnalysisRule.objects.update_or_create(
            rule_id="apprentissage_referentiel",
            defaults={"name": "Boucle d'apprentissage — effectif minimal",
                      "thresholds": {"n_min_cas_reels": 3}, "active": True},
        )

    def _clore(self, n: int):
        for i in range(n):
            app = _dossier_actif(f"sub-app-seuil-{i}")
            close(app, closer_sub="sub-gest", comment="Soldé")

    def test_le_referentiel_reste_indicatif_au_dela_du_seuil(self):
        self._clore(4)
        self.ref.refresh_from_db()
        self.assertEqual(self.ref.n_cas_reels, 4)
        self.assertEqual(self.ref.source, ReferentielFiliere.Source.INDICATIF)
        self.assertTrue(self.ref.est_indicatif)

    def test_le_seuil_franchi_produit_une_candidature(self):
        self._clore(3)
        candidats = candidats_a_l_apprentissage()
        self.assertEqual(len(candidats), 1)
        self.assertEqual(candidats[0]["referentiel"], self.ref.code)
        self.assertTrue(candidats[0]["eligibleApprentissage"])
        self.assertEqual(candidats[0]["seuilApprentissage"], 3)

    def test_sous_le_seuil_aucune_candidature(self):
        self._clore(2)
        self.assertEqual(candidats_a_l_apprentissage(), [])


class QualiteDeNTest(TestCase):
    """Ce que N compte est nommé — et ne se laisse pas gonfler."""

    def setUp(self):
        self.ref = _referentiel()

    def test_un_dossier_derive_du_referentiel_n_apprend_rien(self):
        app = _dossier_actif("sub-app-circulaire", origine="referential")
        observation = close(app, closer_sub="sub-gest", comment="Soldé")

        self.ref.refresh_from_db()
        self.assertFalse(observation.contributive)
        self.assertEqual(observation.origine_couts, "referential")
        # L'observation existe (la clôture est un fait), mais N ne bouge pas.
        self.assertEqual(ObservationFiliere.objects.count(), 1)
        self.assertEqual(self.ref.n_cas_reels, 0)

    def test_les_non_contributifs_sont_comptes_a_part(self):
        close(_dossier_actif("sub-q-1"), closer_sub="g", comment="Soldé")
        close(_dossier_actif("sub-q-2", origine="referential"), closer_sub="g", comment="Soldé")

        stats = statistiques_filiere(self.ref)
        self.assertEqual(stats["nCasReels"], 1)
        self.assertEqual(stats["nNonContributifs"], 1)
        self.assertEqual(stats["devise"], "USD")
        self.assertEqual(stats["coutTotalMedian"], 3000.0)
        self.assertEqual(stats["effectifParModule"]["semences"], 1)

    def test_statistiques_refusent_d_agreger_deux_devises(self):
        close(_dossier_actif("sub-q-usd"), closer_sub="g", comment="Soldé")
        app_cdf = _dossier_actif("sub-q-cdf")
        app_cdf.currency = "CDF"
        app_cdf.save(update_fields=["currency"])
        close(app_cdf, closer_sub="g", comment="Soldé")

        stats = statistiques_filiere(self.ref)
        self.assertTrue(stats["devisesMelangees"])
        self.assertIsNone(stats["devise"])
        self.assertIsNone(stats["coutTotalMedian"])
        self.assertEqual(stats["coutsModulesMedians"], {})


class SeuilParametrableTest(TestCase):
    """Principe 8 : le seuil vit en base, et son absence se signale."""

    def test_seuil_lu_en_base(self):
        AnalysisRule.objects.update_or_create(
            rule_id="apprentissage_referentiel",
            defaults={"name": "Effectif minimal",
                      "thresholds": {"n_min_cas_reels": 50}, "active": True},
        )
        self.assertEqual(seuil_n_min(), 50)

    def test_seuil_absent_replie_avec_avertissement(self):
        with self.assertLogs("credits.apprentissage", level="WARNING") as journal:
            self.assertEqual(seuil_n_min(), N_MIN_DEFAUT)
        self.assertTrue(any("valeur de secours" in ligne for ligne in journal.output))


class ImmuabiliteObservationTest(TestCase):

    def test_une_observation_ne_se_reecrit_pas(self):
        from credits.models import ImmutableObservation

        _referentiel()
        app = _dossier_actif("sub-app-immuable")
        observation = close(app, closer_sub="g", comment="Soldé")

        relue = ObservationFiliere.objects.get(pk=observation.pk)
        relue.cout_total = Decimal("99999")
        with self.assertRaises(ImmutableObservation):
            relue.save()


class ClotureSansReferentielTest(TestCase):
    """Une clôture ne doit pas échouer parce que la boucle n'a rien où déverser."""

    def test_cloture_valide_sans_referentiel_actif(self):
        ReferentielFiliere.objects.all().delete()
        app = _dossier_actif("sub-app-sans-ref")

        with self.assertLogs("credits.apprentissage", level="WARNING"):
            observation = close(app, closer_sub="g", comment="Soldé")

        self.assertIsNone(observation)
        app.refresh_from_db()
        self.assertEqual(app.status, "closed")
        self.assertEqual(ObservationFiliere.objects.count(), 0)

"""Tests des garanties opposables — gage sur actif et éligibilité par filière.

Couverture :
  - les 5 règles bloquantes de la pose d'un gage (SPEC §2.4)
  - la valeur retenue après décote fait foi, jamais la valeur déclarée
  - le gage effectif n'a lieu qu'à la confirmation, sous verrou
  - éligibilité du type vs `ValueChain.eligible_guarantees`, à la pose ET au submit
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from credits.tests import _ensure_scoring_criteria, _make_app, _make_user
from credits.workflow import WorkflowError, submit


def _verified_asset(owner_sub: str, categorie: str = "materiel",
                    valeur: Decimal = Decimal("10000")):
    """Actif vérifié par un agent, donc mobilisable en garantie."""
    from assets.models import Asset
    from assets.services import verify_asset
    asset = Asset.objects.create(
        user=_make_user(owner_sub), name="Tracteur", type=categorie,
        value=valeur, currency="USD",
    )
    verify_asset(asset, verifier_sub="sub-agent-terrain", valeur_verifiee=valeur)
    asset.refresh_from_db()
    return asset


def _chain(code: str, eligible: list[str]):
    from reference_data.models import ReferenceFileUpload, ValueChain
    upload, _ = ReferenceFileUpload.objects.get_or_create(
        version=f"test-{code}",
        defaults={
            "file": "reference_data/test.xlsx",
            "file_type": "value_chains",
            "uploaded_by": "test",
            "status": "active",
        },
    )
    return ValueChain.objects.create(
        code=code, label=code.title(), active=True, cycle_months=6,
        cost_per_hectare_usd=Decimal("1000"), cost_per_hectare_cdf=Decimal("2800000"),
        module_weights={"semences": 100}, risk_factor=Decimal("1.0"),
        min_score_required=55, base_rate=Decimal("8.00"),
        harvest_months=[6], eligible_guarantees=eligible, source_file=upload,
    )


class AssetGuaranteeRulesTest(TestCase):
    """Les 5 règles bloquantes de la pose d'un gage sur actif."""

    def setUp(self):
        self.app = _make_app("sub-p1", "sub-p1", status="draft")

    def _place(self, asset_id):
        from credits.guarantees import place_asset_guarantee
        return place_asset_guarantee(self.app, asset_id=asset_id,
                                     registered_by_sub="sub-p1")

    def test_regle1_actif_d_un_autre_client_refuse(self):
        from credits.guarantees import GuaranteeError
        autre = _verified_asset("sub-etranger")
        with self.assertRaises(GuaranteeError):
            self._place(autre.pk)

    def test_regle2_actif_non_verifie_refuse(self):
        from assets.models import Asset
        from credits.guarantees import GuaranteeError
        brut = Asset.objects.create(
            user=_make_user("sub-p1"), name="Non verifie",
            type=Asset.Type.MATERIEL, value=Decimal("9000"),
        )
        with self.assertRaises(GuaranteeError):
            self._place(brut.pk)

    def test_regle2_actif_deja_gage_refuse(self):
        from assets.services import pledge_asset
        from credits.guarantees import GuaranteeError
        asset = _verified_asset("sub-p1")
        autre_dossier = _make_app("sub-p1", "sub-p1", status="draft")
        pledge_asset(asset.pk, autre_dossier)
        with self.assertRaises(GuaranteeError):
            self._place(asset.pk)

    def test_regle3_categorie_autre_refusee(self):
        from assets.models import Asset
        from credits.guarantees import GuaranteeError
        asset = _verified_asset("sub-p1")
        Asset.objects.filter(pk=asset.pk).update(type=Asset.Type.AUTRE)
        with self.assertRaises(GuaranteeError):
            self._place(asset.pk)

    def test_regle5_sans_valeur_retenue_refuse(self):
        from assets.models import Asset
        from credits.guarantees import GuaranteeError
        asset = _verified_asset("sub-p1")
        Asset.objects.filter(pk=asset.pk).update(valeur_retenue=None)
        with self.assertRaises(GuaranteeError):
            self._place(asset.pk)

    def test_pose_nominale_cree_une_garantie_pending(self):
        from credits.models import CreditGuarantee
        asset = _verified_asset("sub-p1")
        guarantee = self._place(asset.pk)
        self.assertEqual(guarantee.status, CreditGuarantee.Status.PENDING)
        self.assertEqual(guarantee.guarantee_type, "materiel")
        # Le montant couvert est la valeur RETENUE, pas la valeur declaree
        self.assertEqual(guarantee.covered_amount, asset.valeur_retenue)
        self.assertLess(guarantee.covered_amount, asset.value)

    def test_la_pose_ne_gage_pas_encore_l_actif(self):
        """Le gage effectif n'a lieu qu'a la confirmation par un agent."""
        from assets.models import Asset
        asset = _verified_asset("sub-p1")
        self._place(asset.pk)
        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.Status.VERIFIE)
        self.assertIsNone(asset.gage_application_id)

    def test_confirmation_gage_l_actif(self):
        from assets.models import Asset
        from credits.guarantees import confirm_asset_guarantee
        from credits.models import CreditGuarantee
        asset = _verified_asset("sub-p1")
        guarantee = self._place(asset.pk)
        confirm_asset_guarantee(guarantee, confirmer_sub="sub-agent")
        asset.refresh_from_db()
        guarantee.refresh_from_db()
        self.assertEqual(asset.status, Asset.Status.GAGE)
        self.assertEqual(asset.gage_application_id, self.app.pk)
        self.assertEqual(guarantee.status, CreditGuarantee.Status.ACTIVE)

    def test_liberation_libere_l_actif(self):
        from assets.models import Asset
        from credits.guarantees import _do_release, confirm_asset_guarantee
        asset = _verified_asset("sub-p1")
        guarantee = self._place(asset.pk)
        confirm_asset_guarantee(guarantee, confirmer_sub="sub-agent")
        _do_release(guarantee)
        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.Status.LIBERE)
        self.assertIsNone(asset.gage_application_id)

    def test_couverture_calculee_sur_les_garanties_actives(self):
        from credits.guarantees import confirm_asset_guarantee, get_guarantee_summary
        asset = _verified_asset("sub-p1")
        guarantee = self._place(asset.pk)

        # Tant que la garantie est PENDING, elle ne couvre rien
        summary = get_guarantee_summary(self.app)
        self.assertEqual(summary["coverage"]["retainedTotal"], 0.0)

        confirm_asset_guarantee(guarantee, confirmer_sub="sub-agent")
        summary = get_guarantee_summary(self.app)
        self.assertEqual(summary["coverage"]["retainedTotal"], float(asset.valeur_retenue))
        self.assertEqual(summary["coverage"]["activeCount"], 1)


class GuaranteeEligibilityTest(TestCase):
    """Regle 4 : le type doit figurer dans ValueChain.eligible_guarantees."""

    def _app_with_chain(self, sub: str, code: str, eligible: list[str]):
        chain = _chain(code, eligible)
        app = _make_app(sub, sub, status="draft")
        app.value_chain = chain
        app.area_ha = Decimal("2")
        app.save(update_fields=["value_chain", "area_ha"])
        return app, chain

    def test_type_non_admis_refuse(self):
        from credits.guarantees import GuaranteeTypeNotEligible, place_asset_guarantee
        app, _ = self._app_with_chain("sub-q1", "CAFE_TEST", ["epargne", "morale"])
        asset = _verified_asset("sub-q1")
        with self.assertRaises(GuaranteeTypeNotEligible):
            place_asset_guarantee(app, asset_id=asset.pk, registered_by_sub="sub-q1")

    def test_type_admis_accepte(self):
        from credits.guarantees import place_asset_guarantee
        app, _ = self._app_with_chain(
            "sub-q2", "MANIOC_TEST", ["epargne", "morale", "materiel"],
        )
        asset = _verified_asset("sub-q2")
        guarantee = place_asset_guarantee(app, asset_id=asset.pk,
                                          registered_by_sub="sub-q2")
        self.assertEqual(guarantee.guarantee_type, "materiel")

    def test_referentiel_vide_n_invente_pas_de_restriction(self):
        from credits.guarantees import place_asset_guarantee
        app, _ = self._app_with_chain("sub-q3", "RIZ_TEST", [])
        asset = _verified_asset("sub-q3")
        self.assertIsNotNone(
            place_asset_guarantee(app, asset_id=asset.pk, registered_by_sub="sub-q3")
        )

    def test_submit_rebloque_un_type_devenu_ineligible(self):
        """Defense en profondeur : le referentiel a change depuis la pose."""
        from credits.guarantees import place_asset_guarantee
        from reference_data.models import ValueChain
        _ensure_scoring_criteria()
        app, chain = self._app_with_chain(
            "sub-q4", "MAIS_TEST", ["epargne", "morale", "materiel"],
        )
        asset = _verified_asset("sub-q4")
        place_asset_guarantee(app, asset_id=asset.pk, registered_by_sub="sub-q4")

        # Le comite retire `materiel` des garanties admises pour la filiere
        ValueChain.objects.filter(pk=chain.pk).update(
            eligible_guarantees=["epargne", "morale"],
        )
        app.refresh_from_db()

        with self.assertRaises(WorkflowError):
            submit(app, submitter_sub="sub-q4")

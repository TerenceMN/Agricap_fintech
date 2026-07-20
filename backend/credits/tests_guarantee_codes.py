"""Chaque règle de refus d'un gage porte son propre code d'erreur (SPEC §2.4).

Signalé par l'agent `front-garanties` : les cinq règles levaient un
`GuaranteeError` générique, aplati par la vue en `ASSET_GUARANTEE_REFUSED`. Le
front en était réduit à deviner la règle par une regex sur le texte du message —
toute reformulation cassait silencieusement la traduction.

Ces tests verrouillent le contrat : **le code est stable, le message est libre.**
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from assets.models import Asset
from credits.guarantees import (
    AssetAlreadyPledged,
    AssetCategoryMismatch,
    AssetNoRetainedValue,
    AssetNotOwned,
    AssetNotVerified,
    GuaranteeError,
    GuaranteeTypeNotEligible,
    place_asset_guarantee,
)
from credits.models import CreditApplication


def _user(sub: str):
    from accounts.models import FintechUser
    user, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": sub, "phone": f"+243{sub[-9:].zfill(9)}"},
    )
    return user


class AssetGuaranteeErrorCodeTests(TestCase):

    def setUp(self):
        self.client_user = _user("sub-proprietaire")
        self.app = CreditApplication.objects.create(
            code="CRED-TEST-GAR-0001",
            client=self.client_user,
            amount_requested=Decimal("5000"),
            currency="USD",
            status=CreditApplication.Status.DRAFT,
        )

    def _asset(self, owner_sub="sub-proprietaire", **kwargs) -> Asset:
        defaults = {
            "name": "Tracteur Kubota",
            "type": Asset.Type.MATERIEL,
            "value": Decimal("10000"),
            "currency": "USD",
            "status": Asset.Status.VERIFIE,
            "valeur_retenue": Decimal("7000"),
        }
        defaults.update(kwargs)
        return Asset.objects.create(user=_user(owner_sub), **defaults)

    def _refus(self, asset_id: int) -> GuaranteeError:
        with self.assertRaises(GuaranteeError) as ctx:
            place_asset_guarantee(self.app, asset_id=asset_id, registered_by_sub="sub-agent")
        return ctx.exception

    def test_asset_not_owned_actif_inexistant(self):
        exc = self._refus(999999)
        self.assertIsInstance(exc, AssetNotOwned)
        self.assertEqual(exc.code, "ASSET_NOT_OWNED")

    def test_asset_not_owned_actif_d_un_autre_client(self):
        autre = self._asset(owner_sub="sub-voisin")
        exc = self._refus(autre.pk)
        self.assertEqual(exc.code, "ASSET_NOT_OWNED")

    def test_asset_not_verified(self):
        asset = self._asset(status=Asset.Status.DECLARE, valeur_retenue=None)
        exc = self._refus(asset.pk)
        self.assertIsInstance(exc, AssetNotVerified)
        self.assertEqual(exc.code, "ASSET_NOT_VERIFIED")

    def test_asset_already_pledged(self):
        autre_dossier = CreditApplication.objects.create(
            code="CRED-TEST-GAR-0002", client=self.client_user,
            amount_requested=Decimal("100"), currency="USD",
        )
        asset = self._asset(status=Asset.Status.GAGE, gage_application=autre_dossier)
        exc = self._refus(asset.pk)
        self.assertIsInstance(exc, AssetAlreadyPledged)
        self.assertEqual(exc.code, "ASSET_ALREADY_PLEDGED")

    def test_asset_category_mismatch(self):
        asset = self._asset(type=Asset.Type.AUTRE)
        exc = self._refus(asset.pk)
        self.assertIsInstance(exc, AssetCategoryMismatch)
        self.assertEqual(exc.code, "ASSET_CATEGORY_MISMATCH")

    def test_asset_no_retained_value(self):
        asset = self._asset(valeur_retenue=None)
        exc = self._refus(asset.pk)
        self.assertIsInstance(exc, AssetNoRetainedValue)
        self.assertEqual(exc.code, "ASSET_NO_RETAINED_VALUE")

    def test_asset_no_retained_value_sur_valeur_nulle(self):
        asset = self._asset(valeur_retenue=Decimal("0"))
        self.assertEqual(self._refus(asset.pk).code, "ASSET_NO_RETAINED_VALUE")

    def test_guarantee_type_not_eligible(self):
        from credits.tests_guarantees import _chain

        chain = _chain("TEST_MAIS", ["epargne", "morale"])
        self.app.value_chain = chain
        self.app.save(update_fields=["value_chain"])

        asset = self._asset()
        exc = self._refus(asset.pk)
        self.assertIsInstance(exc, GuaranteeTypeNotEligible)
        self.assertEqual(exc.code, "GUARANTEE_TYPE_NOT_ELIGIBLE")

    def test_les_six_codes_sont_distincts_et_stables(self):
        """Le front branche dessus : ils font partie du contrat d'API."""
        codes = [
            AssetNotOwned.code, AssetNotVerified.code, AssetAlreadyPledged.code,
            AssetCategoryMismatch.code, AssetNoRetainedValue.code,
            GuaranteeTypeNotEligible.code,
        ]
        self.assertEqual(len(set(codes)), 6)
        self.assertEqual(sorted(codes), [
            "ASSET_ALREADY_PLEDGED", "ASSET_CATEGORY_MISMATCH", "ASSET_NOT_OWNED",
            "ASSET_NOT_VERIFIED", "ASSET_NO_RETAINED_VALUE",
            "GUARANTEE_TYPE_NOT_ELIGIBLE",
        ])
        # Toutes restent des GuaranteeError : un `except GuaranteeError` unique
        # dans la vue suffit à toutes les relayer avec leur code.
        for exc_class in (AssetNotOwned, AssetNotVerified, AssetAlreadyPledged,
                          AssetCategoryMismatch, AssetNoRetainedValue,
                          GuaranteeTypeNotEligible):
            self.assertTrue(issubclass(exc_class, GuaranteeError))

    def test_pose_nominale_reussit(self):
        asset = self._asset()
        guarantee = place_asset_guarantee(
            self.app, asset_id=asset.pk, registered_by_sub="sub-agent")
        self.assertEqual(guarantee.guarantee_type, "materiel")
        self.assertEqual(guarantee.covered_amount, Decimal("7000"))

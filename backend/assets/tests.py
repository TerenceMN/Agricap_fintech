"""Tests du registre d'actifs gageables.

Couverture :
  - cycle de vie : declare → verifie / rejete → gage → libere
  - décote appliquée par le serveur, jamais fournie par l'agent
  - anti double-gage (verrou atomique)
  - étanchéité : le client ne peut pas écrire son propre statut
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from assets.models import Asset
from assets.services import (
    AssetAlreadyPledged,
    AssetError,
    pledge_asset,
    reject_asset,
    release_asset,
    valeur_apres_decote,
    verify_asset,
)


def _user(sub: str):
    from accounts.models import FintechUser
    user, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": sub, "phone": f"+243{sub[-9:].zfill(9)}"},
    )
    return user


def _asset(sub: str = "sub-owner", **kwargs) -> Asset:
    defaults = {
        "name": "Tracteur Kubota",
        "type": Asset.Type.MATERIEL,
        "value": Decimal("10000"),
        "currency": "USD",
    }
    defaults.update(kwargs)
    return Asset.objects.create(user=_user(sub), **defaults)


def _application(client_sub: str = "sub-owner"):
    from credits.models import CreditApplication
    return CreditApplication.objects.create(
        client=_user(client_sub),
        initiated_by_sub=client_sub,
        status="draft",
        amount_requested=Decimal("5000"),
        currency="USD",
        code=f"CRED-ASSET-{CreditApplication.objects.count():04d}",
    )


# ── Cycle de vie ──────────────────────────────────────────────────────────────

class AssetLifecycleTest(TestCase):

    def test_un_actif_est_cree_declare_et_non_gageable(self):
        asset = _asset()
        self.assertEqual(asset.status, Asset.Status.DECLARE)
        self.assertFalse(asset.is_pledgeable)
        self.assertIsNone(asset.valeur_retenue)

    def test_verification_applique_la_decote(self):
        asset = _asset()
        verify_asset(asset, verifier_sub="sub-agent", valeur_verifiee=Decimal("10000"))
        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.Status.VERIFIE)
        # Décote par défaut 30 % → 7 000
        self.assertEqual(asset.valeur_retenue, Decimal("7000.00"))
        self.assertTrue(asset.is_pledgeable)

    def test_valeur_retenue_est_inferieure_a_la_valeur_declaree(self):
        """Invariant : la couverture ne s'appuie jamais sur le déclaratif."""
        self.assertLess(valeur_apres_decote(Decimal("10000")), Decimal("10000"))

    def test_verification_refuse_une_valeur_nulle(self):
        asset = _asset()
        with self.assertRaises(AssetError):
            verify_asset(asset, verifier_sub="sub-agent", valeur_verifiee=Decimal("0"))

    def test_categorie_autre_non_verifiable(self):
        asset = _asset(type=Asset.Type.AUTRE)
        with self.assertRaises(AssetError):
            verify_asset(asset, verifier_sub="sub-agent", valeur_verifiee=Decimal("500"))

    def test_rejet_exige_un_motif(self):
        asset = _asset()
        with self.assertRaises(AssetError):
            reject_asset(asset, verifier_sub="sub-agent", motif="   ")

    def test_rejet_efface_la_valeur_retenue(self):
        asset = _asset()
        verify_asset(asset, verifier_sub="sub-agent", valeur_verifiee=Decimal("10000"))
        asset.status = Asset.Status.DECLARE       # re-soumission après modification
        asset.save(update_fields=["status"])
        reject_asset(asset, verifier_sub="sub-agent", motif="Facture non probante")
        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.Status.REJETE)
        self.assertIsNone(asset.valeur_retenue)
        self.assertFalse(asset.is_pledgeable)

    def test_mapping_categorie_vers_type_de_garantie(self):
        cases = {
            Asset.Type.MATERIEL: "materiel",
            Asset.Type.VEHICULE: "materiel",
            Asset.Type.STOCK: "materiel",
            Asset.Type.FONCIER: "foncier",
            Asset.Type.AUTRE: "",
        }
        for categorie, attendu in cases.items():
            with self.subTest(categorie=categorie):
                self.assertEqual(_asset(type=categorie).guarantee_type, attendu)


# ── Gage et double gage ───────────────────────────────────────────────────────

class AssetPledgeTest(TestCase):

    def setUp(self):
        self.asset = _asset()
        verify_asset(self.asset, verifier_sub="sub-agent", valeur_verifiee=Decimal("10000"))
        self.asset.refresh_from_db()
        self.app_a = _application()
        self.app_b = _application()

    def test_un_actif_declare_ne_peut_pas_etre_gage(self):
        brut = _asset(name="Non vérifié")
        with self.assertRaises(AssetError):
            pledge_asset(brut.pk, self.app_a)

    def test_gage_nominal(self):
        pledge_asset(self.asset.pk, self.app_a)
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.status, Asset.Status.GAGE)
        self.assertEqual(self.asset.gage_application_id, self.app_a.pk)
        self.assertFalse(self.asset.is_pledgeable)

    def test_double_gage_refuse(self):
        """Invariant : un actif ne peut pas être gagé deux fois."""
        pledge_asset(self.asset.pk, self.app_a)
        with self.assertRaises(AssetAlreadyPledged):
            pledge_asset(self.asset.pk, self.app_b)

    def test_gage_idempotent_sur_le_meme_dossier(self):
        pledge_asset(self.asset.pk, self.app_a)
        pledge_asset(self.asset.pk, self.app_a)   # ne lève pas
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.gage_application_id, self.app_a.pk)

    def test_liberation_rend_l_actif_mobilisable(self):
        pledge_asset(self.asset.pk, self.app_a)
        self.asset.refresh_from_db()
        release_asset(self.asset)
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.status, Asset.Status.LIBERE)
        self.assertIsNone(self.asset.gage_application_id)
        self.assertTrue(self.asset.is_pledgeable)

    def test_actif_libere_peut_etre_regage_ailleurs(self):
        pledge_asset(self.asset.pk, self.app_a)
        self.asset.refresh_from_db()
        release_asset(self.asset)
        self.asset.refresh_from_db()
        pledge_asset(self.asset.pk, self.app_b)
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.gage_application_id, self.app_b.pk)


# ── Étanchéité de l'API client ────────────────────────────────────────────────

class AssetClientWriteTest(TestCase):
    """Le client décrit son actif ; il ne décide jamais de son statut."""

    def test_status_absent_des_champs_modifiables(self):
        from assets.views import CLIENT_WRITABLE
        for interdit in ("status", "valeur_retenue", "gage_application",
                         "verifie_par_sub", "verifie_le", "user"):
            self.assertNotIn(interdit, CLIENT_WRITABLE)

    def test_modification_invalide_la_verification(self):
        """Modifier un actif vérifié le remet en file de vérification.

        Le test appelle la MÊME fonction que la vue PATCH. La version précédente
        recopiait la condition de la vue en dur : elle validait sa propre copie
        du code, pas le comportement du serveur — c'est ce qui a laissé passer
        le cas `libere` ci-dessous.
        """
        from assets.services import invalidate_verification

        asset = _asset()
        verify_asset(asset, verifier_sub="sub-agent", valeur_verifiee=Decimal("10000"))
        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.Status.VERIFIE)

        asset.value = Decimal("50000")
        self.assertTrue(invalidate_verification(asset))
        asset.save()

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.Status.DECLARE)
        self.assertIsNone(asset.valeur_retenue)
        self.assertEqual(asset.verifie_par_sub, "")
        self.assertIsNone(asset.verifie_le)
        self.assertFalse(asset.is_pledgeable)

    def test_modification_d_un_actif_libere_le_remet_aussi_en_verification(self):
        """Signalé par `front-garanties` : un actif `libere` est `is_pledgeable`
        et conserve sa valeur retenue. Sans remise en file, un gage levé puis
        l'actif redésigné restait mobilisable avec une valeur certifiée sur un
        bien qui a changé depuis le contrôle terrain."""
        from assets.services import invalidate_verification

        asset = _asset()
        verify_asset(asset, verifier_sub="sub-agent", valeur_verifiee=Decimal("10000"))
        asset.refresh_from_db()
        asset.status = Asset.Status.LIBERE
        asset.save(update_fields=["status"])
        self.assertTrue(asset.is_pledgeable)          # état de départ du scénario

        asset.name = "Groupe électrogène (remplacé)"
        asset.type = Asset.Type.VEHICULE
        self.assertTrue(invalidate_verification(asset))
        asset.save()

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.Status.DECLARE)
        self.assertIsNone(asset.valeur_retenue)
        self.assertFalse(asset.is_pledgeable)

    def test_un_actif_declare_ou_rejete_n_a_rien_a_invalider(self):
        from assets.services import invalidate_verification

        for statut in (Asset.Status.DECLARE, Asset.Status.REJETE):
            with self.subTest(statut=statut):
                asset = _asset(status=statut)
                self.assertFalse(invalidate_verification(asset))
                self.assertEqual(asset.status, statut)

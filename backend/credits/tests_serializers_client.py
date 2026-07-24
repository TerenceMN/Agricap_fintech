"""Ce que le CLIENT reçoit — pièce d'identité du garant et référentiel filière.

Deux fuites de nature différente, même frontière :

* **Donnée personnelle d'un tiers** — le résumé des garanties servait au
  titulaire du dossier la pièce d'identité COMPLÈTE de son garant, saisie par un
  agent et dont le demandeur n'a aucun usage.
* **Barème (principe 7)** — le préremplissage servait au demandeur le coût de
  référence par hectare de chaque filière, les poids modules, le score minimum
  requis et le taux de base : la grille contre laquelle il va être scoré, servie
  avant même qu'il dépose son dossier.

Les deux se testent ici parce qu'ils répondent à la même question : « qui lit
ce payload, et qu'a-t-il le droit d'y voir ? »
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from credits.guarantees import get_guarantee_summary, masquer_piece_identite
from credits.models import CreditApplication, CreditGuarantee
from credits.prefill import (
    CHAMPS_FILIERE_CLIENT,
    CHAMPS_FILIERE_RETENUS,
    _get_active_value_chains,
)


def _upload():
    from reference_data.models import ReferenceFileUpload

    return ReferenceFileUpload.objects.first() or ReferenceFileUpload.objects.create(
        file_type=ReferenceFileUpload.FileType.VALUE_CHAINS,
        uploaded_by="sub-test", status=ReferenceFileUpload.Status.ACTIVE,
    )


def _chain(code="MAIS"):
    from reference_data.models import ValueChain

    chain, _ = ValueChain.objects.get_or_create(
        code=code,
        defaults={
            "label": "Céréales — Maïs", "source_file": _upload(), "cycle_months": 8,
            "cost_per_hectare_usd": Decimal("1234.56"),
            "cost_per_hectare_cdf": Decimal("3456789.00"),
            "module_weights": {"semences": 25, "maindoeuvre": 30},
            "risk_factor": Decimal("0.3"), "min_score_required": 62,
            "base_rate": Decimal("18.00"), "harvest_months": [6, 7],
            "eligible_guarantees": ["epargne", "morale"],
        },
    )
    return chain


class MasquagePieceIdentiteTest(TestCase):

    def test_ne_laisse_que_la_fin(self):
        self.assertEqual(masquer_piece_identite("CD-CNI-99887766"), "••••7766")

    def test_piece_courte_masquee_entierement(self):
        # Montrer « les quatre derniers » d'un numéro de quatre caractères, ce
        # n'est pas masquer : c'est publier.
        self.assertEqual(masquer_piece_identite("1234"), "••••")
        self.assertEqual(masquer_piece_identite("12"), "••")

    def test_piece_absente_reste_vide(self):
        self.assertEqual(masquer_piece_identite(""), "")
        self.assertEqual(masquer_piece_identite(None), "")


class CniDuGarantTest(TestCase):

    def setUp(self):
        from accounts.models import FintechUser

        client, _ = FintechUser.objects.get_or_create(
            sub="sub-titulaire", defaults={"full_name": "Titulaire",
                                           "phone": "+243900000010"},
        )
        self.app = CreditApplication.objects.create(
            client=client, initiated_by_sub="sub-titulaire", status="submitted",
            amount_requested=Decimal("1000"), currency="USD",
            code="CRED-CNI-0001",
        )
        CreditGuarantee.objects.create(
            application=self.app,
            guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
            status=CreditGuarantee.Status.PENDING_CONSENT,
            guarantor_name="Grand Frère", guarantor_phone="+243900000011",
            guarantor_id_number="CD-CNI-99887766",
            covered_amount=Decimal("500"),
        )

    def test_le_titulaire_ne_voit_pas_la_piece_de_son_garant(self):
        item = get_guarantee_summary(self.app)["items"][0]
        self.assertEqual(item["guarantorIdNumber"], "••••7766")
        self.assertNotIn("99887766", str(item))
        # Ce qui lui est UTILE reste dit : la pièce a bien été renseignée.
        self.assertTrue(item["guarantorIdProvided"])

    def test_le_defaut_est_le_masquage(self):
        """Un appelant qui ne précise pas son audience obtient la vue fermée."""
        from credits.workflow import serialize_application

        data = serialize_application(self.app)
        self.assertNotIn("99887766", str(data))

    def test_l_instruction_voit_la_piece_en_clair(self):
        item = get_guarantee_summary(self.app, pour_staff=True)["items"][0]
        self.assertEqual(item["guarantorIdNumber"], "CD-CNI-99887766")

        from credits.workflow import serialize_application
        data = serialize_application(self.app, pour_staff=True)
        self.assertIn("CD-CNI-99887766", str(data))

    def test_une_caution_sans_piece_ne_ment_pas(self):
        CreditGuarantee.objects.update(guarantor_id_number="")
        item = get_guarantee_summary(self.app)["items"][0]
        self.assertEqual(item["guarantorIdNumber"], "")
        self.assertFalse(item["guarantorIdProvided"])


class PrefillSansBaremeTest(TestCase):

    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.chain = _chain()

    def test_le_client_ne_recoit_aucun_chiffre_du_bareme(self):
        chains = _get_active_value_chains()
        self.assertEqual(len(chains), 1)
        for champ in CHAMPS_FILIERE_RETENUS:
            self.assertNotIn(champ, chains[0])
        # Aucune des valeurs non plus, sous quelque forme que ce soit.
        rendu = str(chains[0])
        for interdit in ("1234.56", "3456789", "18.00", "62", "semences"):
            self.assertNotIn(interdit, rendu)

    def test_le_client_recoit_ce_dont_il_a_besoin_pour_choisir(self):
        chains = _get_active_value_chains()
        self.assertEqual(set(chains[0]), set(CHAMPS_FILIERE_CLIENT))
        self.assertEqual(chains[0]["code"], "MAIS")
        self.assertEqual(chains[0]["label"], "Céréales — Maïs")
        self.assertEqual(chains[0]["cycle_months"], 8)
        self.assertEqual(chains[0]["harvest_months"], [6, 7])
        self.assertEqual(chains[0]["eligible_guarantees"], ["epargne", "morale"])

    def test_le_payload_de_prefill_complet_ne_fuit_pas(self):
        from accounts.models import FintechUser
        from credits.prefill import get_prefill_data

        FintechUser.objects.get_or_create(
            sub="sub-prefill", defaults={"full_name": "Demandeur",
                                         "phone": "+243900000012"},
        )
        data = get_prefill_data("sub-prefill", "sub-prefill")
        rendu = str(data)
        for interdit in ("cost_per_hectare", "module_weights",
                         "min_score_required", "base_rate", "1234.56"):
            self.assertNotIn(interdit, rendu)

    def test_le_cache_client_ne_sert_jamais_la_forme_staff(self):
        """Deux formes, deux clés : le cache staff ne doit pas fuir chez le client."""
        from django.core.cache import cache

        # Un écran de backoffice chauffe le cache du référentiel COMPLET…
        cache.set(
            "reference_data:value_chains:active",
            [{"code": "MAIS", "cost_per_hectare_usd": 1234.56,
              "module_weights": {"semences": 25}, "min_score_required": 62}],
            300,
        )
        # …le parcours client n'en voit rien.
        chains = _get_active_value_chains()
        self.assertNotIn("cost_per_hectare_usd", chains[0])

    def test_une_nouvelle_activation_change_la_cle_de_cache(self):
        """Le cache client n'attend pas d'être invalidé par une autre app."""
        from reference_data.models import ReferenceFileUpload, ValueChain

        premier = _get_active_value_chains()
        self.assertEqual(len(premier), 1)

        nouvel_upload = ReferenceFileUpload.objects.create(
            file_type=ReferenceFileUpload.FileType.VALUE_CHAINS,
            uploaded_by="sub-test-2", status=ReferenceFileUpload.Status.ACTIVE,
        )
        ValueChain.objects.create(
            code="RIZ", label="Céréales — Riz", source_file=nouvel_upload,
            cycle_months=5, cost_per_hectare_usd=Decimal("900"),
            cost_per_hectare_cdf=Decimal("0"), module_weights={},
            risk_factor=Decimal("0.2"), min_score_required=55,
            base_rate=Decimal("17.00"), harvest_months=[4],
            eligible_guarantees=["epargne"], active=True,
        )
        codes = {c["code"] for c in _get_active_value_chains()}
        self.assertEqual(codes, {"MAIS", "RIZ"})

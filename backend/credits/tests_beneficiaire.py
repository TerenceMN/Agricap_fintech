
from common.testing import AuthedAPITestCase


class BeneficiaireInterneTests(AuthedAPITestCase):
    URL = "/api/credits/applications/"
    PAYLOAD = {"amount_requested": 1000, "value_chain_code": "MAIS"}

    def test_un_membre_interne_ne_peut_pas_creer_un_credit_pour_lui_meme(self):
        self.login(role="admin", sub="staff-1")
        res = self.client.post(self.URL, self.PAYLOAD, format="json")

        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data.get("code"), "BENEFICIAIRE_INTERNE")

    def test_le_message_dit_QUOI_FAIRE_et_pas_seulement_le_refus(self):
        """Un refus qui n'indique pas la sortie transforme une règle en impasse."""
        self.login(role="gest_credit", sub="staff-2")
        res = self.client.post(self.URL, self.PAYLOAD, format="json")

        detail = res.data.get("detail", "")
        self.assertIn("client_sub", detail)          # la voie de sortie est nommée
        self.assertIn("gest_credit", detail)         # le rôle en cause est nommé

    def test_tous_les_roles_internes_sont_couverts_pas_seulement_admin(self):
        """`is_staff_role` dérive du registre RBAC : tout rôle non-Client est
        interne. La règle ne doit pas se limiter au rôle `admin` historique."""
        # Rôles RÉELLEMENT présents au registre. « auditeur » et « caissier »
        # n'y sont PAS : `get_role()` les fait retomber en silence sur
        # « client », alors que la barre latérale leur sert un menu interne.
        # Divergence signalée séparément — ne pas la masquer ici.
        for role in ("gest_port", "agent_terrain", "aud_fin", "gest_caisse"):
            with self.subTest(role=role):
                self.login(role=role, sub=f"{role}-x")
                res = self.client.post(self.URL, self.PAYLOAD, format="json")
                self.assertEqual(res.data.get("code"), "BENEFICIAIRE_INTERNE")

    def test_un_client_cree_normalement_sa_demande(self):
        """La règle ne doit fermer la porte à personne d'autre : un demandeur
        légitime passe (le dossier peut ensuite échouer sur d'autres règles,
        mais jamais sur celle-ci)."""
        self.login(role="client", sub="demandeur-1")
        res = self.client.post(self.URL, self.PAYLOAD, format="json")

        self.assertNotEqual(res.data.get("code"), "BENEFICIAIRE_INTERNE")

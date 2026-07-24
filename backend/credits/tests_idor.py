"""Cloisonnement des dossiers de crédit — le membre A n'atteint pas le dossier de B.

Ce module couvre une classe de faille précise, et une seule : la **référence directe à
un objet** (IDOR). Elle n'a rien à voir avec le rôle de l'appelant, et c'est ce qui la
rend invisible aux gardes de capacité :

* `HasCapability("read")` / `_require_read` répondent à « cet utilisateur a-t-il le droit
  de LIRE ? » — et la réponse est oui pour tout membre, `client`, `agri_op`, `invest` et
  `partner` portant tous `read=True` dans `rbac.role_registry` ;
* personne ne répondait à « a-t-il le droit de lire CE dossier-là ? ».

Le code d'un dossier suit `CRED-AAAAMMJJ-NNNN` : il s'énumère. Une vue qui résout un
dossier par son code sans vérifier `ViewContextService.can_read_app` est donc lisible par
tous, pour tous. Les quatre vues testées ici l'étaient.

Le refus attendu est **404 et non 403** : un 403 confirmerait l'existence du dossier
sondé, et l'oracle suffit à reconstituer la production quotidienne de l'institution.
"""
from __future__ import annotations

from decimal import Decimal

from common.testing import AuthedAPITestCase
from credits.models import CreditApplication, CreditGuarantee, DisbursementRequest
from credits.tests import _make_app, _make_user

BASE = "/api/credits/applications"


class CloisonnementDossierTests(AuthedAPITestCase):
    """Alice a un dossier, Bob n'y a aucun droit — et le personnel, si."""

    def setUp(self):
        self.alice = _make_user("sub-alice-idor")
        self.bob = _make_user("sub-bob-idor")
        self.app = _make_app("sub-alice-idor", "sub-alice-idor", status="approved",
                             amount=Decimal("4200"))

        # Une caution morale nominative : c'est CE contenu que l'IDOR livrait —
        # nom, téléphone et numéro de pièce d'identité d'un tiers.
        self.garant = _make_user("sub-garant-idor")
        self.caution = CreditGuarantee.objects.create(
            application=self.app,
            guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
            status=CreditGuarantee.Status.CONSENTED,
            guarantor=self.garant,
            guarantor_name="Mama Kabila",
            guarantor_phone="+243970000001",
            guarantor_id_number="CD-CNI-99887766",
            covered_amount=Decimal("4200"),
        )
        # Un décaissement demandé : maker, checker et référence comptable.
        self.decaissement = DisbursementRequest.objects.create(
            application=self.app, amount=Decimal("4200"), currency="USD",
            requested_by_sub="sub-agent-maker", confirmed_by_sub="sub-caissier-checker",
            journal_entry_id=4242, notes="Remis en espèces au guichet de Goma.",
        )

    # ── C1 — GET .../guarantees/ ──────────────────────────────────────────────

    def test_c1_un_tiers_ne_lit_pas_les_garanties_d_un_autre_dossier(self):
        self.login(role="client", sub=self.bob.pk)
        r = self.client.get(f"{BASE}/{self.app.code}/guarantees/")
        self.assertEqual(r.status_code, 404)

    def test_c1_le_refus_ne_divulgue_pas_l_identite_du_garant(self):
        """Le corps du refus ne doit contenir AUCUN fragment de la réponse protégée —
        un 404 qui fuiterait le nom du garant ne protégerait rien."""
        self.login(role="client", sub=self.bob.pk)
        corps = self.client.get(f"{BASE}/{self.app.code}/guarantees/").content.decode()
        for secret in ("Mama Kabila", "+243970000001", "CD-CNI-99887766"):
            self.assertNotIn(secret, corps)

    def test_c1_un_investisseur_non_plus_malgre_sa_capacite_read(self):
        """`invest` porte `read=True` : c'est le rôle exact sur lequel un garde de
        capacité seul aurait laissé passer."""
        self.login(role="invest", sub=self.bob.pk)
        self.assertEqual(
            self.client.get(f"{BASE}/{self.app.code}/guarantees/").status_code, 404)

    def test_c1_le_titulaire_lit_ses_propres_garanties(self):
        """Non-régression du droit légitime : cloisonner ne doit pas fermer au titulaire."""
        self.login(role="client", sub=self.alice.pk)
        r = self.client.get(f"{BASE}/{self.app.code}/guarantees/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["count"], 1)

    def test_c1_le_personnel_lit_le_dossier_de_n_importe_quel_membre(self):
        self.login(role="gest_credit", sub="sub-analyste-idor")
        r = self.client.get(f"{BASE}/{self.app.code}/guarantees/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["items"][0]["guarantorName"], "Mama Kabila")

    # ── C2 — GET .../disbursement/ ────────────────────────────────────────────

    def test_c2_un_tiers_ne_lit_pas_le_decaissement_d_un_autre_dossier(self):
        self.login(role="client", sub=self.bob.pk)
        self.assertEqual(
            self.client.get(f"{BASE}/{self.app.code}/disbursement/").status_code, 404)

    def test_c2_le_titulaire_voit_son_decaissement_sans_la_chaine_interne(self):
        """Le bénéficiaire a droit au statut, au montant et aux dates de SON argent.
        Il n'a pas à connaître l'agent qui a demandé, celui qui a confirmé, ni la
        référence d'écriture comptable — c'est la paire maker/checker d'un mouvement
        réel, et un point d'entrée pour solliciter quelqu'un hors procédure."""
        self.login(role="client", sub=self.alice.pk)
        r = self.client.get(f"{BASE}/{self.app.code}/disbursement/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["amount"], 4200.0)
        self.assertEqual(r.data["status"], DisbursementRequest.Status.PENDING)
        for champ in ("requestedBySub", "confirmedBySub", "journalEntryId", "notes"):
            self.assertNotIn(champ, r.data)

    def test_c2_le_personnel_conserve_la_chaine_complete(self):
        self.login(role="gest_caisse", sub="sub-caisse-idor")
        r = self.client.get(f"{BASE}/{self.app.code}/disbursement/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["requestedBySub"], "sub-agent-maker")
        self.assertEqual(r.data["journalEntryId"], 4242)

    # ── Confirmation d'une caution par un tiers ───────────────────────────────

    def test_un_tiers_ne_confirme_pas_la_caution_d_un_autre_dossier(self):
        """Rendre une caution opposable au nom d'autrui est l'inverse exact de ce que
        le consentement établit."""
        self.login(role="client", sub=self.bob.pk)
        r = self.client.post(
            f"{BASE}/{self.app.code}/guarantees/{self.caution.pk}/confirm/", {}, format="json")
        self.assertEqual(r.status_code, 404)
        self.caution.refresh_from_db()
        self.assertEqual(self.caution.status, CreditGuarantee.Status.CONSENTED)

    def test_le_titulaire_ne_confirme_pas_sa_propre_caution(self):
        """Se porter garant de soi-même : le dossier lui appartient (donc 403, pas 404),
        mais la confirmation reste l'acte de l'agent ou du garant."""
        self.login(role="client", sub=self.alice.pk)
        r = self.client.post(
            f"{BASE}/{self.app.code}/guarantees/{self.caution.pk}/confirm/", {}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["code"], "CONFIRMATION_NON_AUTORISEE")

    def test_le_garant_designe_confirme_sa_propre_caution(self):
        self.login(role="client", sub=self.garant.pk)
        r = self.client.post(
            f"{BASE}/{self.app.code}/guarantees/{self.caution.pk}/confirm/", {}, format="json")
        self.assertEqual(r.status_code, 200)
        self.caution.refresh_from_db()
        self.assertEqual(self.caution.status, CreditGuarantee.Status.ACTIVE)

    def test_l_agent_instructeur_confirme_la_caution(self):
        self.login(role="agent_terrain", sub="sub-agent-idor")
        r = self.client.post(
            f"{BASE}/{self.app.code}/guarantees/{self.caution.pk}/confirm/", {}, format="json")
        self.assertEqual(r.status_code, 200)

    # ── Consentement client ───────────────────────────────────────────────────

    def test_un_tiers_ne_sonde_pas_l_existence_d_un_dossier_via_le_consentement(self):
        """`record_client_consent` refusait déjà l'acte, mais son message (« Seul le
        client bénéficiaire… ») confirmait que le dossier existe. Le cloisonnement doit
        répondre avant la règle métier."""
        self.login(role="client", sub=self.bob.pk)
        r = self.client.post(f"{BASE}/{self.app.code}/client-consent/", {}, format="json")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.data["detail"], "Dossier introuvable.")

    # ── Le code inexistant et le code interdit répondent PAREIL ───────────────

    def test_dossier_interdit_et_dossier_inexistant_sont_indiscernables(self):
        """La seule défense contre l'énumération de `CRED-AAAAMMJJ-NNNN` : les deux
        réponses doivent être identiques, statut ET corps."""
        self.login(role="client", sub=self.bob.pk)
        interdit = self.client.get(f"{BASE}/{self.app.code}/guarantees/")
        inexistant = self.client.get(f"{BASE}/CRED-20260101-9999/guarantees/")
        self.assertEqual(interdit.status_code, inexistant.status_code)
        self.assertEqual(interdit.data, inexistant.data)


class CloisonnementListeDossiersTests(AuthedAPITestCase):
    """Rappel de la garantie amont : la liste ne laisse même pas voir le code d'autrui.

    Sans elle, les tests ci-dessus protégeraient une porte dont l'adresse est publique.
    """

    def setUp(self):
        _make_app("sub-alice-liste", "sub-alice-liste")
        _make_app("sub-bob-liste", "sub-bob-liste")

    def test_un_client_ne_voit_que_ses_dossiers(self):
        self.login(role="client", sub="sub-bob-liste")
        r = self.client.get(f"{BASE}/")
        self.assertEqual(r.status_code, 200)
        codes = {ligne["code"] for ligne in r.data}
        attendus = set(
            CreditApplication.objects.filter(client__sub="sub-bob-liste")
            .values_list("code", flat=True)
        )
        self.assertEqual(codes, attendus)

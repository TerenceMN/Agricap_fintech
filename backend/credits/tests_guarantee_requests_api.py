"""Surface HTTP du garant — contrat publié dans `docs/status-fragments/lot6-backend.md`.

Ces tests verrouillent ce qu'un agent front consomme sans pouvoir le vérifier :
la forme exacte des réponses, les statuts HTTP, et surtout le fait que **le rôle
ne donne aucun droit ici**. Consentir à la place de quelqu'un annulerait
précisément ce que le consentement établit ; un admin ne doit donc pas pouvoir le
faire, et c'est le seul endroit du module où c'est vrai.
"""
from __future__ import annotations

from decimal import Decimal

from django.utils import timezone

from common.testing import AuthedAPITestCase
from credits.models import CreditApplication, CreditGuarantee
from credits.tests_guarantor import _app, _designate, _group, _savings, _user

LIST_URL = "/api/credits/guarantee-requests/"


def _consent_url(pk: int) -> str:
    return f"/api/credits/guarantee-requests/{pk}/consent/"


class GuaranteeRequestsApiTests(AuthedAPITestCase):

    def setUp(self):
        from referentiel.models import InstitutionConfig
        InstitutionConfig.objects.all().delete()
        InstitutionConfig.objects.create(is_active=True)

        self.demandeur = _user("sub-api-demandeur", "Marie Kabemba")
        self.garant = _user("sub-api-garant", "Jean Mukendi")
        _group("AVEC Kabare API", self.demandeur, self.garant)
        _savings(self.garant, "5000")
        self.app = _app(self.demandeur, "1200")
        self.guarantee = _designate(self.app, self.garant, montant="400")

    # ── GET /guarantee-requests/ ──────────────────────────────────────────────

    def test_liste_exige_authentification(self):
        self.assertEqual(self.client.get(LIST_URL).status_code, 401)

    def test_le_garant_voit_sa_demande_avec_la_forme_du_contrat(self):
        self.login(role="client", sub=str(self.garant.pk))
        res = self.client.get(LIST_URL)
        self.assertEqual(res.status_code, 200)

        self.assertEqual(res.data["total_rows"], 1)
        self.assertEqual(res.data["consent_window_hours"], 72)

        item = res.data["items"][0]
        self.assertEqual(item["id"], self.guarantee.pk)
        self.assertEqual(item["status"], "pending_consent")
        self.assertEqual(item["applicationCode"], self.app.code)
        self.assertEqual(item["applicant"]["displayName"], "Marie Kabemba")
        self.assertEqual(item["loanAmount"], 1200.0)
        self.assertEqual(item["loanCurrency"], "USD")
        self.assertEqual(item["coveredAmount"], 400.0)
        self.assertEqual(item["coveredCurrency"], "USD")
        self.assertIsNotNone(item["consentExpiresAt"])
        self.assertIsNone(item["consentedAt"])
        self.assertFalse(item["isExpired"])

    def test_le_groupe_commun_justifie_la_demande(self):
        self.login(role="client", sub=str(self.garant.pk))
        groups = self.client.get(LIST_URL).data["items"][0]["applicant"]["sharedGroups"]
        self.assertEqual([g["name"] for g in groups], ["AVEC Kabare API"])

    def test_le_demandeur_ne_voit_pas_la_demande_de_son_garant(self):
        self.login(role="client", sub=str(self.demandeur.pk))
        self.assertEqual(self.client.get(LIST_URL).data["total_rows"], 0)

    def test_un_admin_ne_voit_pas_les_demandes_des_autres(self):
        """Aucun rôle n'élargit ce périmètre : c'est la liste de SES engagements."""
        _user("sub-api-admin")
        self.login(role="admin", sub="sub-api-admin")
        self.assertEqual(self.client.get(LIST_URL).data["total_rows"], 0)

    def test_les_expirees_sont_servies_et_marquees(self):
        """Le front doit lire l'expiration, pas l'inférer d'une date passée."""
        CreditGuarantee.objects.filter(pk=self.guarantee.pk).update(
            consent_expires_at=timezone.now() - timezone.timedelta(hours=1),
        )
        self.login(role="client", sub=str(self.garant.pk))
        item = self.client.get(LIST_URL).data["items"][0]
        self.assertTrue(item["isExpired"])
        self.assertEqual(item["status"], "pending_consent")

    def test_filtre_par_statut(self):
        self.login(role="client", sub=str(self.garant.pk))
        self.assertEqual(
            self.client.get(LIST_URL + "?status=declined").data["total_rows"], 0,
        )
        self.assertEqual(
            self.client.get(LIST_URL + "?status=pending_consent").data["total_rows"], 1,
        )

    def test_la_liste_n_expose_ni_decote_ni_plafonds(self):
        """Principe 7 — le garant est un tiers, pas un analyste."""
        self.login(role="client", sub=str(self.garant.pk))
        blob = str(self.client.get(LIST_URL).data)
        for interdit in ("retainedCoverage", "haircut", "decote", "ceiling",
                         "multiple", "maxPledges", "scoreResult"):
            self.assertNotIn(interdit, blob)

    # ── POST /guarantee-requests/<id>/consent/ ────────────────────────────────

    def test_acceptation_renvoie_l_item_a_jour(self):
        self.login(role="client", sub=str(self.garant.pk))
        res = self.client.post(_consent_url(self.guarantee.pk), {"accept": True},
                               format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["item"]["status"], "consented")
        self.assertIsNotNone(res.data["item"]["consentedAt"])

    def test_refus_renvoie_declined(self):
        self.login(role="client", sub=str(self.garant.pk))
        res = self.client.post(_consent_url(self.guarantee.pk), {"accept": False},
                               format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["item"]["status"], "declined")
        self.assertIsNotNone(res.data["item"]["declinedAt"])

    def test_ip_journalisee_dans_la_preuve(self):
        self.login(role="client", sub=str(self.garant.pk))
        self.client.post(_consent_url(self.guarantee.pk), {"accept": True},
                         format="json", HTTP_X_FORWARDED_FOR="41.243.1.1, 10.0.0.1")
        self.guarantee.refresh_from_db()
        self.assertEqual(self.guarantee.consent_meta["ip"], "41.243.1.1")

    def test_accept_manquant_refuse(self):
        self.login(role="client", sub=str(self.garant.pk))
        res = self.client.post(_consent_url(self.guarantee.pk), {}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "ACCEPT_REQUIRED")

    def test_accept_non_booleen_refuse(self):
        self.login(role="client", sub=str(self.garant.pk))
        res = self.client.post(_consent_url(self.guarantee.pk), {"accept": "oui"},
                               format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "ACCEPT_REQUIRED")

    def test_le_demandeur_ne_peut_pas_consentir_a_la_place_du_garant(self):
        self.login(role="client", sub=str(self.demandeur.pk))
        res = self.client.post(_consent_url(self.guarantee.pk), {"accept": True},
                               format="json")
        self.assertEqual(res.status_code, 403)
        self.guarantee.refresh_from_db()
        self.assertEqual(self.guarantee.status, CreditGuarantee.Status.PENDING_CONSENT)

    def test_un_admin_ne_peut_pas_consentir_a_la_place_du_garant(self):
        """Le seul endpoint du module où le rôle ne donne aucun droit."""
        _user("sub-api-admin2")
        self.login(role="admin", sub="sub-api-admin2")
        res = self.client.post(_consent_url(self.guarantee.pk), {"accept": True},
                               format="json")
        self.assertEqual(res.status_code, 403)

    def test_l_agent_qui_a_monte_le_dossier_ne_peut_pas_consentir(self):
        _user("sub-api-agent")
        self.login(role="agent_terrain", sub="sub-api-agent")
        res = self.client.post(_consent_url(self.guarantee.pk), {"accept": True},
                               format="json")
        self.assertEqual(res.status_code, 403)

    def test_demande_inexistante_renvoie_404_sans_code(self):
        """404 plutôt que 403 : le code d'erreur ne renseigne pas sur l'existence."""
        self.login(role="client", sub=str(self.garant.pk))
        res = self.client.post(_consent_url(999999), {"accept": True}, format="json")
        self.assertEqual(res.status_code, 404)
        self.assertNotIn("code", res.data)

    def test_double_reponse_refusee(self):
        self.login(role="client", sub=str(self.garant.pk))
        self.client.post(_consent_url(self.guarantee.pk), {"accept": True},
                         format="json")
        res = self.client.post(_consent_url(self.guarantee.pk), {"accept": False},
                               format="json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "GUARANTOR_ALREADY_ANSWERED")

    def test_consentement_expire_renvoie_410(self):
        CreditGuarantee.objects.filter(pk=self.guarantee.pk).update(
            consent_expires_at=timezone.now() - timezone.timedelta(hours=1),
        )
        self.login(role="client", sub=str(self.garant.pk))
        res = self.client.post(_consent_url(self.guarantee.pk), {"accept": True},
                               format="json")
        self.assertEqual(res.status_code, 410)
        self.assertEqual(res.data["code"], "GUARANTOR_CONSENT_EXPIRED")
        self.assertEqual(res.data["errors"][0]["code"], "GUARANTOR_CONSENT_EXPIRED")

    def test_capacite_revérifiee_renvoie_422_avec_le_code_de_la_regle(self):
        from savings.models import SavingsPlan
        SavingsPlan.objects.filter(user=self.garant).update(balance=Decimal("10"))
        self.login(role="client", sub=str(self.garant.pk))
        res = self.client.post(_consent_url(self.guarantee.pk), {"accept": True},
                               format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "GUARANTOR_OVEREXTENDED")

    def test_toutes_les_erreurs_portent_l_enveloppe_structuree(self):
        self.login(role="client", sub=str(self.garant.pk))
        res = self.client.post(_consent_url(self.guarantee.pk), {}, format="json")
        self.assertEqual(set(res.data), {"detail", "code", "errors"})
        self.assertEqual(set(res.data["errors"][0]), {"code", "message"})


class MoralGuaranteePlacementApiTests(AuthedAPITestCase):
    """Pose de la caution — codes de refus relayés tels quels par la vue."""

    def setUp(self):
        from referentiel.models import InstitutionConfig
        InstitutionConfig.objects.all().delete()
        InstitutionConfig.objects.create(is_active=True)

        self.demandeur = _user("sub-pose-demandeur", "Client Pose")
        self.garant = _user("sub-pose-garant", "Garant Pose")
        _savings(self.garant, "5000")
        self.app = _app(self.demandeur, "1000")

    def _url(self) -> str:
        return f"/api/credits/applications/{self.app.code}/guarantees/moral/"

    def _payload(self, **over):
        data = {
            "guarantor_name": "Garant Pose",
            "guarantor_phone": "+243900000000",
            "guarantor_id_number": "CNI-9",
            "guarantor_sub": str(self.garant.pk),
            "montant_couvert": "400",
        }
        data.update(over)
        return data

    def test_pose_nominale_par_un_agent(self):
        _group("AVEC Pose", self.demandeur, self.garant)
        _user("sub-pose-agent")
        self.login(role="agent_terrain", sub="sub-pose-agent")
        res = self.client.post(self._url(), self._payload(), format="json")
        self.assertEqual(res.status_code, 201)
        guarantee = CreditGuarantee.objects.get(application=self.app)
        self.assertEqual(guarantee.status, CreditGuarantee.Status.PENDING_CONSENT)
        self.assertEqual(guarantee.covered_amount, Decimal("400"))

    def test_refus_hors_groupe_relaye_son_code_en_422(self):
        _user("sub-pose-agent2")
        self.login(role="agent_terrain", sub="sub-pose-agent2")
        res = self.client.post(self._url(), self._payload(), format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "GUARANTOR_NOT_IN_GROUP")
        self.assertEqual(res.data["errors"][0]["code"], "GUARANTOR_NOT_IN_GROUP")

    def test_permissions_de_la_pose_inchangees(self):
        """Décision de gouvernance non tranchée ici : la pose reste `CAN_INSTRUCT`."""
        self.login(role="client", sub=str(self.demandeur.pk))
        res = self.client.post(self._url(), self._payload(), format="json")
        self.assertEqual(res.status_code, 403)

    def test_caution_purement_declarative_refusee(self):
        _user("sub-pose-agent3")
        self.login(role="agent_terrain", sub="sub-pose-agent3")
        res = self.client.post(self._url(), self._payload(guarantor_sub=""),
                               format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "GUARANTOR_UNKNOWN")
        self.assertFalse(
            CreditGuarantee.objects.filter(application=self.app).exists()
        )

"""
Rattachement dossier ↔ agence (`CreditApplication.agency`).

Trois questions, une classe de tests chacune :

1. **Le champ est-il renseigné sans jamais être inventé ?** Il vient de l'agent
   qui monte le dossier, jamais du payload, et il reste VIDE quand il est
   indéterminable — une agence par défaut gonflerait un portefeuille qui n'a
   jamais vu le dossier.
2. **Le périmètre d'agence dit-il ce qu'il vaut ?** Un dossier portant l'agence
   est rattaché exactement ; un dossier sans agence l'est par approximation (les
   personnes intervenues) ; `scope.rattachement` dit lequel des deux régimes
   compose la vue.
3. **Un dossier SANS agence disparaît-il de quelque part ?** C'est le risque
   principal du lot : introduire un rattachement, c'est risquer que tout ce qui
   n'en a pas devienne invisible. Aucune vue ne doit en perdre un seul.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from accounts.models import FintechUser
from agencies.models import Agency
from common.testing import AuthedAPITestCase
from credits.dashboard import get_dashboard
from credits.models import CreditApplication, resolve_agency_for_sub
from credits.view_context import ViewContextService
from credits.workflow import serialize_application
from rbac.models import StaffProfile

URL = "/api/credits/applications/"


def _user(sub: str, role: str = "client") -> FintechUser:
    user, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": sub, "role": role, "phone": "+243900000000"},
    )
    return user


def _staff(sub: str, agence: Agency | None, role: str = "gest_credit") -> FintechUser:
    user = _user(sub, role=role)
    StaffProfile.objects.update_or_create(user=user, defaults={"assignment": agence})
    return user


def _app(client_sub: str, *, agent: str = "", agence: Agency | None = None,
         status: str = "in_analysis", montant: str = "1000",
         currency: str = "USD") -> CreditApplication:
    return CreditApplication.objects.create(
        code=f"CRED-AGY-{CreditApplication.objects.count():04d}",
        client=_user(client_sub),
        initiated_by_sub=agent or client_sub,
        agency=agence,
        status=status,
        currency=currency,
        amount_requested=Decimal(montant),
        disbursed_amount=Decimal(montant) if status == "active" else Decimal("0"),
        disbursed_at=timezone.now() if status == "active" else None,
    )


# ── 1. Renseignement à la création ────────────────────────────────────────────

class RattachementALaCreationTests(AuthedAPITestCase):
    """Le dossier prend l'agence de l'agent qui le monte — et rien d'autre."""

    def setUp(self):
        self.goma = Agency.objects.create(code="AG-01", name="Goma Centre")
        self.bukavu = Agency.objects.create(code="AG-02", name="Bukavu")
        _user("client-1")

    def _creer(self, **payload):
        corps = {"amount_requested": 1000, "client_sub": "client-1", **payload}
        return self.client.post(URL, corps, format="json")

    def test_le_dossier_prend_l_agence_de_l_agent_qui_le_cree(self):
        _staff("agent-goma", self.goma)
        self.login(role="gest_credit", sub="agent-goma")

        res = self._creer()

        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["agency"], {"code": "AG-01", "name": "Goma Centre"})
        self.assertEqual(
            CreditApplication.objects.get(code=res.data["code"]).agency, self.goma,
        )

    def test_le_gerant_nomme_sans_affectation_est_rattache_par_manager_sub(self):
        """`resolve_agency_for_sub` est la MÊME règle que celle du tableau de
        bord : un gérant nommé sans `StaffProfile.assignment` est rattaché ici
        exactement comme il l'est là-bas, sinon son dossier tomberait hors de son
        propre périmètre."""
        Agency.objects.filter(pk=self.bukavu.pk).update(manager_sub="chef-bukavu")
        _staff("chef-bukavu", None, role="gest_zone")
        self.login(role="gest_zone", sub="chef-bukavu")

        res = self._creer()

        self.assertEqual(res.data["agency"]["code"], "AG-02")

    def test_le_payload_ne_peut_pas_imposer_une_agence(self):
        """Une agence acceptée depuis le corps de la requête rendrait le
        périmètre déclaratif : l'agent choisirait le portefeuille dans lequel son
        dossier atterrit."""
        _staff("agent-goma", self.goma)
        self.login(role="gest_credit", sub="agent-goma")

        res = self._creer(agency="AG-02", agency_id=self.bukavu.pk)

        self.assertEqual(res.data["agency"]["code"], "AG-01")

    def test_un_client_qui_depose_lui_meme_ne_recoit_AUCUNE_agence(self):
        """Un client n'a pas d'affectation, et n'a pas à en avoir. Le champ reste
        vide — il ne retombe pas sur la première agence venue."""
        self.login(role="client", sub="client-1")

        res = self.client.post(URL, {"amount_requested": 1000}, format="json")

        self.assertEqual(res.status_code, 201)
        self.assertIsNone(res.data["agency"])
        self.assertIsNone(CreditApplication.objects.get(code=res.data["code"]).agency)

    def test_un_agent_sans_affectation_laisse_le_champ_vide(self):
        _staff("agent-orphelin", None)
        self.login(role="gest_credit", sub="agent-orphelin")

        res = self._creer()

        self.assertEqual(res.status_code, 201)
        self.assertIsNone(res.data["agency"])

    def test_la_regle_de_resolution_est_unique_pour_tout_le_module(self):
        """Principe 6 : deux résolutions parallèles divergeraient, et un dossier
        serait « dans » l'agence pour l'écran et « hors » d'elle pour le filtre."""
        _staff("agent-goma", self.goma)

        self.assertEqual(resolve_agency_for_sub("agent-goma"), self.goma)
        self.assertIsNone(resolve_agency_for_sub("inconnu"))
        self.assertIsNone(resolve_agency_for_sub(""))


# ── 2. Exposition (sérialisation, filtre) ─────────────────────────────────────

class ExpositionAgenceTests(TestCase):
    """`agency` est servi tel qu'il est en base — y compris quand il est vide."""

    def setUp(self):
        self.goma = Agency.objects.create(code="AG-01", name="Goma Centre")
        self.rattache = _app("client-1", agence=self.goma)
        self.orphelin = _app("client-2")

    def test_le_dossier_rattache_porte_le_code_et_le_nom_de_son_agence(self):
        data = serialize_application(self.rattache)
        self.assertEqual(data["agency"], {"code": "AG-01", "name": "Goma Centre"})

    def test_le_dossier_sans_agence_sert_None_et_pas_un_substitut(self):
        """`None` DIT le trou. Une agence de repli le rendrait indétectable, alors
        que c'est lui qui fait basculer un périmètre en régime approché."""
        self.assertIsNone(serialize_application(self.orphelin)["agency"])

    def test_le_client_voit_l_agence_mais_toujours_pas_le_moteur(self):
        """Décision explicite (`_CLIENT_VISIBLE_BY_DESIGN`) : l'agence est le
        guichet du client, pas un paramètre du moteur (principe 7)."""
        from credits.view_context import _CLIENT_HIDDEN_FIELDS, _CLIENT_VISIBLE_BY_DESIGN

        self.assertFalse(_CLIENT_VISIBLE_BY_DESIGN & _CLIENT_HIDDEN_FIELDS)

        vcs = ViewContextService(sub="client-1", roles=["client"])
        data = vcs.serialize_for_role(self.rattache)

        self.assertEqual(data["agency"]["code"], "AG-01")
        self.assertNotIn("scoreResult", data)
        self.assertNotIn("initiatedBySub", data)


class FiltreAgenceAPITests(AuthedAPITestCase):
    """`GET /credits/applications/?agency=` — un filtre de lecture, réservé au
    personnel, qui refuse plutôt que de rendre un vide trompeur."""

    def setUp(self):
        self.goma = Agency.objects.create(code="AG-01", name="Goma Centre")
        self.bukavu = Agency.objects.create(code="AG-02", name="Bukavu")
        self.a_goma = _app("client-1", agence=self.goma)
        self.a_bukavu = _app("client-2", agence=self.bukavu)
        self.sans = _app("client-3")

    def _codes(self, res) -> set[str]:
        return {ligne["code"] for ligne in res.data}

    def test_sans_filtre_tous_les_dossiers_sont_servis_agence_ou_pas(self):
        """Anti-régression : introduire un rattachement ne doit rien retirer de
        la liste par défaut."""
        self.login(role="admin", sub="staff-1")
        res = self.client.get(URL)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            self._codes(res), {self.a_goma.code, self.a_bukavu.code, self.sans.code},
        )

    def test_le_filtre_par_code_ne_sert_que_cette_agence(self):
        self.login(role="admin", sub="staff-1")
        res = self.client.get(URL, {"agency": "AG-01"})

        self.assertEqual(self._codes(res), {self.a_goma.code})

    def test_la_sentinelle_none_ouvre_la_population_sans_agence(self):
        """Cette population doit rester ATTEIGNABLE : c'est elle qu'un
        responsable doit pouvoir lister pour la faire corriger."""
        self.login(role="admin", sub="staff-1")
        res = self.client.get(URL, {"agency": "none"})

        self.assertEqual(self._codes(res), {self.sans.code})

    def test_un_code_inconnu_est_refuse_et_ne_rend_pas_une_liste_vide(self):
        """« 0 dossier » et « cette agence n'existe pas » ne portent pas la même
        information — et la première se lit comme une agence sans activité."""
        self.login(role="admin", sub="staff-1")
        res = self.client.get(URL, {"agency": "AG-INEXISTANTE"})

        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "AGENCY_NOT_FOUND")

    def test_le_filtre_est_refuse_au_client(self):
        self.login(role="client", sub="client-1")
        res = self.client.get(URL, {"agency": "AG-01"})

        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "AGENCY_FILTER_STAFF_ONLY")

    def test_le_client_garde_sa_liste_intacte_sans_filtre(self):
        self.login(role="client", sub="client-3")
        res = self.client.get(URL)

        self.assertEqual(self._codes(res), {self.sans.code})


# ── 3. Périmètre d'agence : exact vs approché ─────────────────────────────────

class PerimetreExactOuApprocheTests(TestCase):
    """Le lien direct tranche quand il existe ; l'ancienne heuristique par les
    personnes ne survit QUE pour les dossiers sans agence."""

    def setUp(self):
        self.goma = Agency.objects.create(code="AG-01", name="Goma Centre")
        self.bukavu = Agency.objects.create(code="AG-02", name="Bukavu")
        _staff("chef-goma", self.goma, role="gest_zone")
        _staff("agent-goma", self.goma)
        _staff("agent-bukavu", self.bukavu)

    def _vue(self):
        return get_dashboard(sub="chef-goma", roles={"gest_zone"})

    def test_un_dossier_portant_l_agence_est_rattache_exactement(self):
        _app("cli-1", agent="agent-goma", agence=self.goma)

        scope = self._vue()["scope"]

        self.assertEqual(scope["type"], "branch")
        self.assertEqual(scope["rattachement"], "exact")
        self.assertEqual(scope["dossiers"], {"exact": 1, "approche": 0})
        self.assertNotIn("avertissement", scope)

    def test_un_dossier_sans_agence_reste_rattache_par_approximation(self):
        """Sans ce repli, tous les dossiers antérieurs au champ disparaîtraient
        de la vue agence du jour au lendemain."""
        _app("cli-2", agent="agent-goma")

        res = self._vue()

        self.assertEqual(res["summary"]["totalApplications"], 1)
        self.assertEqual(res["scope"]["rattachement"], "approche")
        self.assertEqual(res["scope"]["dossiers"], {"exact": 0, "approche": 1})
        self.assertIn("approximation", res["scope"]["avertissement"])

    def test_les_deux_populations_cohabitent_et_le_scope_le_dit(self):
        _app("cli-1", agent="agent-goma", agence=self.goma)
        _app("cli-2", agent="agent-goma")

        res = self._vue()

        self.assertEqual(res["summary"]["totalApplications"], 2)
        self.assertEqual(res["scope"]["rattachement"], "mixte")
        self.assertEqual(res["scope"]["dossiers"], {"exact": 1, "approche": 1})

    def test_le_lien_direct_prime_sur_l_intervention_d_un_collegue(self):
        """Un dossier rattaché à une AUTRE agence n'entre pas dans le périmètre,
        même si un membre de l'équipe y est intervenu. C'est exactement ce que le
        lien direct vient trancher — sinon il ne servirait à rien."""
        _app("cli-3", agent="agent-goma", agence=self.bukavu)

        res = self._vue()

        self.assertEqual(res["summary"]["totalApplications"], 0)
        self.assertEqual(res["scope"]["dossiers"], {"exact": 0, "approche": 0})

    def test_un_dossier_de_l_agence_compte_meme_sans_intervenant_connu(self):
        """Le rattachement exact ne dépend plus de la présence d'un membre de
        l'équipe dans les champs d'intervention : un dossier repris par un
        collègue d'une autre agence restait invisible sous l'ancienne
        heuristique."""
        _app("cli-4", agent="agent-bukavu", agence=self.goma)

        res = self._vue()

        self.assertEqual(res["summary"]["totalApplications"], 1)
        self.assertEqual(res["scope"]["rattachement"], "exact")

    def test_sans_affectation_le_regime_est_declare_indetermine(self):
        """Le périmètre le plus large de tous ne doit pas être le seul à ne rien
        annoncer : un front qui lit `scope.rattachement` trouve une valeur."""
        _app("cli-1", agent="agent-goma", agence=self.goma)

        res = get_dashboard(sub="chef-sans-agence", roles={"gest_zone"})

        self.assertEqual(res["scope"]["type"], "institution")
        self.assertEqual(res["scope"]["rattachement"], "indetermine")
        self.assertNotIn("dossiers", res["scope"])


# ── 4. Anti-régression : un dossier sans agence ne disparaît de nulle part ────

class DossierSansAgenceVisiblePartoutTests(TestCase):
    """Le risque principal du lot. Introduire un rattachement, c'est risquer que
    tout ce qui n'en a pas devienne invisible : les dossiers antérieurs au champ
    et ceux déposés par les clients eux-mêmes. Chaque vue est vérifiée."""

    def setUp(self):
        self.goma = Agency.objects.create(code="AG-01", name="Goma Centre")
        _staff("chef-goma", self.goma, role="gest_zone")
        _staff("agent-goma", self.goma)
        # Un dossier sans agence, monté par un membre de l'agence.
        self.sans = _app("cli-sans", agent="agent-goma", montant="50000")

    def test_vue_client(self):
        res = get_dashboard(sub="cli-sans", roles={"client"})
        self.assertEqual(res["summary"]["totalApplications"], 1)

    def test_vue_agent(self):
        res = get_dashboard(sub="agent-goma", roles={"gest_credit"})
        self.assertEqual(res["summary"]["totalApplications"], 1)

    def test_vue_agence(self):
        res = get_dashboard(sub="chef-goma", roles={"gest_zone"})
        self.assertEqual(res["summary"]["totalApplications"], 1)

    def test_vue_comite(self):
        res = get_dashboard(sub="dg-1", roles={"dg"}, view="committee")
        self.assertEqual(res["summary"]["pendingReview"], 1)

    def test_vue_direction(self):
        res = get_dashboard(sub="dir-1", roles={"dir_ops"})
        self.assertEqual(res["summary"]["totalApplications"], 1)

    def test_vue_admin(self):
        res = get_dashboard(sub="adm-1", roles={"admin"})
        self.assertEqual(res["counts"]["total"], 1)

    def test_liste_et_detail_par_le_queryset_de_role(self):
        """`ViewContextService.filter_qs` ne connaît pas l'agence : ni le staff ni
        le client ne doivent perdre un dossier parce qu'il n'en a pas."""
        for sub, roles in (("agent-goma", ["gest_credit"]), ("cli-sans", ["client"])):
            with self.subTest(sub=sub):
                vcs = ViewContextService(sub=sub, roles=roles)
                qs = vcs.filter_qs(CreditApplication.objects.all())
                self.assertIn(self.sans.code, set(qs.values_list("code", flat=True)))

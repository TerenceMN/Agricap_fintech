"""Migration des gardes de `credits/views.py` du CORPS vers `permission_classes`.

Ce module ne teste pas une fonctionnalité : il teste une **non-régression de
périmètre**. La dette qu'il accompagne est décrite dans `credits/permissions.py`
et dans §5 du prompt système — « `permission_classes` déclaratives sur CHAQUE
vue ; toute vue sans permission explicite est un bug ». Une vingtaine de vues du
module crédit posaient leur garde en première ligne de corps (`_require_read`,
`_require_group`) : la règle fonctionnait, mais elle n'était lisible ni sur la
signature de la vue, ni pour un audit mécanique, et une ligne oubliée à la
création d'une vue l'ouvrait sans que rien ne le signale.

Le risque de CETTE migration n'est pas d'oublier un verrou : c'est d'en déplacer
un de travers, et de fermer une porte légitime. Chaque test ci-dessous vérifie
donc les DEUX sens sur le même endpoint :

  * l'autorisé passe (et le refus, s'il y en a un, ne vient pas du garde d'entrée) ;
  * l'interdit est refusé, **avec le statut et le code d'origine**.

Convention de lecture : un endpoint qui répond 401 sans jeton prouve que la
permission déclarative s'exécute — le corps de ces vues n'est jamais atteint.
"""
from __future__ import annotations

from decimal import Decimal

from common.testing import AuthedAPITestCase
from credits.models import CreditApplication, CreditGuarantee, DisbursementRequest
from credits.tests import _make_app, _make_user

BASE = "/api/credits"
APPS = f"{BASE}/applications"


class EntreeAuthentifieeTests(AuthedAPITestCase):
    """Les vues dont le garde d'entrée était `_require_read`.

    `_require_read` ne vérifiait rien d'autre que « authentifié avec un `sub` » —
    or `sub` est la clé primaire de `FintechUser` : le prédicat est exactement
    `IsAuthenticated`. La migration ne change donc pas le public ; ce qui change,
    c'est que la règle s'exécute dans `initial()`, avant le corps.

    ⚠️ Ces vues ne sont PAS ouvertes pour autant : leur cloisonnement réel est
    un contrôle d'OBJET (« ce dossier est-il le sien ? »), qui ne peut pas monter
    sur le décorateur et reste dans le corps. `tests_idor.py` le couvre ; les
    deux tests de rappel en fin de classe vérifient qu'il n'a pas été emporté.
    """

    def setUp(self):
        self.alice = _make_user("sub-alice-decl")
        self.bob = _make_user("sub-bob-decl")
        self.app = _make_app("sub-alice-decl", "sub-alice-decl", status="approved",
                             amount=Decimal("3000"))
        self.caution = CreditGuarantee.objects.create(
            application=self.app,
            guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
            status=CreditGuarantee.Status.CONSENTED,
            guarantor=_make_user("sub-garant-decl"),
            guarantor_name="Nsimba Lelo",
            guarantor_phone="+243970000009",
            guarantor_id_number="CD-CNI-11223344",
            covered_amount=Decimal("3000"),
        )
        DisbursementRequest.objects.create(
            application=self.app, amount=Decimal("3000"), currency="USD",
            requested_by_sub="sub-maker-decl",
        )

    def _endpoints(self) -> list[tuple[str, str]]:
        c = self.app.code
        return [
            ("get", f"{BASE}/application/prefill/"),
            ("post", f"{BASE}/needs-sheet/parse/"),
            ("post", f"{BASE}/simulate/"),
            ("get", f"{BASE}/dashboard/"),
            ("get", f"{APPS}/"),
            ("post", f"{APPS}/"),
            ("get", f"{APPS}/{c}/"),
            ("post", f"{APPS}/{c}/submit/"),
            ("post", f"{APPS}/{c}/client-consent/"),
            ("get", f"{APPS}/{c}/guarantees/"),
            ("post", f"{APPS}/{c}/guarantees/asset/"),
            ("post", f"{APPS}/{c}/guarantees/{self.caution.pk}/confirm/"),
            ("get", f"{APPS}/{c}/disbursement/"),
            ("get", f"{APPS}/{c}/analyse-resume/"),
        ]

    # ── Le garde déclaratif s'exécute AVANT le corps ──────────────────────────

    def test_sans_jeton_toutes_ces_vues_repondent_401(self):
        """401 et non 403 : c'est la signature d'un refus prononcé par
        `permission_classes` dans `initial()`, jamais par le corps de la vue —
        lequel renvoyait un 403 générique. Le SPA rafraîchit son jeton sur 401."""
        for methode, url in self._endpoints():
            with self.subTest(url=url, methode=methode):
                reponse = getattr(self.client, methode)(url, {}, format="json")
                self.assertEqual(reponse.status_code, 401, url)

    # ── L'autorisé passe : aucune de ces vues ne refuse un membre à l'entrée ──

    def test_le_titulaire_franchit_l_entree_de_chacune_de_ses_vues(self):
        """Le titulaire du dossier n'est refusé par AUCUN garde d'entrée. Les
        réponses varient (200, 404 sur une analyse absente, 409 sur un statut
        incompatible, 400 sur un payload vide) — ce qui compte est qu'aucune ne
        soit un 401/403, seuls statuts que le garde d'entrée sait produire.

        `guarantees/<id>/confirm/` est exclu : le titulaire y est légitimement
        refusé (se porter garant de soi-même), et c'est un garde d'OBJET, vérifié
        pour lui-même plus bas."""
        self.login(role="client", sub=self.alice.pk)
        exclus = f"{APPS}/{self.app.code}/guarantees/{self.caution.pk}/confirm/"
        for methode, url in self._endpoints():
            if url == exclus:
                continue
            with self.subTest(url=url, methode=methode):
                reponse = getattr(self.client, methode)(url, {}, format="json")
                self.assertNotIn(reponse.status_code, (401, 403), f"{url} → {reponse.data}")

    def test_l_agent_instructeur_franchit_la_meme_entree(self):
        """Symétrique : la migration n'a pas non plus fermé la porte au personnel."""
        self.login(role="agent_terrain", sub="sub-agent-decl")
        for methode, url in self._endpoints():
            with self.subTest(url=url, methode=methode):
                reponse = getattr(self.client, methode)(url, {}, format="json")
                self.assertNotIn(reponse.status_code, (401, 403), f"{url} → {reponse.data}")

    # ── Ce qui NE monte pas sur le décorateur reste vérifié dans le corps ─────

    def test_le_cloisonnement_par_dossier_survit_a_la_migration(self):
        """`IsAuthenticated` ne dit rien du dossier visé : sans le contrôle
        d'objet resté dans le corps, la migration transformerait chacune de ces
        vues en IDOR. 404 et non 403 — un 403 confirmerait l'existence du code."""
        self.login(role="client", sub=self.bob.pk)
        c = self.app.code
        for url in (f"{APPS}/{c}/guarantees/", f"{APPS}/{c}/disbursement/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(
            self.client.post(f"{APPS}/{c}/client-consent/", {}, format="json").status_code,
            404,
        )

    def test_le_garde_de_payload_survit_a_la_migration(self):
        """Préremplir ou simuler POUR UN TIERS exige `CAN_INSTRUCT`. Ce garde
        dépend du `client_sub` reçu : une permission de vue ne connaît pas le
        payload, il reste donc dans le corps — et il refuse toujours en 403."""
        self.login(role="client", sub=self.bob.pk)
        self.assertEqual(
            self.client.get(f"{BASE}/application/prefill/?client_sub={self.alice.pk}")
            .status_code, 403)
        self.assertEqual(
            self.client.post(f"{BASE}/simulate/", {"client_sub": self.alice.pk},
                             format="json").status_code, 403)

    def test_un_client_ne_filtre_pas_la_liste_par_agence(self):
        """Le filtre `?agency=` est un garde de QUERY PARAM, pas de vue : il ne
        s'applique qu'en lecture et laisse passer la création. Il conserve son
        403 et son code — le front branche dessus."""
        self.login(role="client", sub=self.alice.pk)
        reponse = self.client.get(f"{APPS}/?agency=GOMA")
        self.assertEqual(reponse.status_code, 403)
        self.assertEqual(reponse.data["code"], "AGENCY_FILTER_STAFF_ONLY")

    def test_le_titulaire_ne_confirme_toujours_pas_sa_propre_caution(self):
        """Garde d'objet le plus fin du module : « le garant désigné de CETTE
        caution ». Statut ET code inchangés."""
        self.login(role="client", sub=self.alice.pk)
        reponse = self.client.post(
            f"{APPS}/{self.app.code}/guarantees/{self.caution.pk}/confirm/", {},
            format="json")
        self.assertEqual(reponse.status_code, 403)
        self.assertEqual(reponse.data["code"], "CONFIRMATION_NON_AUTORISEE")

    def test_le_depot_de_dossier_reste_ouvert_au_client(self):
        """Le piège de cette migration : `CapaciteSelonMethode(POST="create")`
        aurait paru le garde naturel d'un POST — et aurait fermé le dépôt de
        dossier à `client`, `agri_op` et `partner`, qui ne portent pas `create`
        au registre RBAC. Le garde d'origine était `_require_read` ; il le reste."""
        for role in ("client", "agri_op", "partner"):
            with self.subTest(role=role):
                self.login(role=role, sub=f"sub-depot-{role}")
                reponse = self.client.post(
                    f"{APPS}/", {"amount_requested": "1500"}, format="json")
                self.assertEqual(reponse.status_code, 201, reponse.data)
                self.assertEqual(
                    CreditApplication.objects.get(code=reponse.data["code"]).client_id,
                    f"sub-depot-{role}")

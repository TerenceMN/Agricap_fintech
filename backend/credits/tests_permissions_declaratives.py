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


class GardeDeGroupeTests(AuthedAPITestCase):
    """Les vues dont le garde d'entrée était `_require_group(<groupe>)`.

    Une par une : le rôle admis passe, le rôle exclu est refusé **avec le même
    statut et le même `code` qu'avant la migration**. La matrice ci-dessous EST
    la spécification d'accès du module — ce qu'un auditeur devait auparavant
    reconstituer en dépliant vingt corps de vue.

    Le rôle exclu de chaque ligne n'est pas pris au hasard : c'est le voisin le
    plus proche du groupe, celui qu'une migration approximative aurait laissé
    passer (`aud_fin` lit tout mais n'exécute rien ; `agent_terrain` instruit
    mais ne décide pas ; `gest_credit` décide mais ne siège pas au comité ; le
    maker et le checker d'un décaissement ne sont pas le même groupe).
    """

    def setUp(self):
        self.titulaire = _make_user("sub-client-groupe")
        self.app = _make_app("sub-client-groupe", "sub-client-groupe",
                             status="in_analysis", amount=Decimal("2500"))
        self.caution = CreditGuarantee.objects.create(
            application=self.app,
            guarantee_type=CreditGuarantee.GuaranteeType.EPARGNE,
            status=CreditGuarantee.Status.ACTIVE,
            covered_amount=Decimal("500"),
        )

    def _matrice(self) -> list[tuple]:
        """(méthode, url, rôle admis, rôle exclu, code de refus attendu)."""
        c = self.app.code
        return [
            # ── Instruction (`CAN_INSTRUCT`) ─────────────────────────────────
            ("post", f"{APPS}/{c}/score/", "gest_credit", "aud_fin", None),
            ("post", f"{APPS}/{c}/start-analysis/", "gest_credit", "aud_fin", None),
            ("post", f"{APPS}/{c}/adjourn/", "gest_credit", "aud_fin", None),
            ("post", f"{APPS}/{c}/reopen-analysis/", "gest_credit", "aud_fin", None),
            ("post", f"{APPS}/{c}/renew-consent/", "gest_credit", "aud_fin",
             "PERMISSION_REFUSEE"),
            ("post", f"{APPS}/{c}/guarantees/savings/", "agent_terrain", "aud_fin", None),
            ("post", f"{APPS}/{c}/guarantees/moral/", "agent_terrain", "aud_fin", None),
            ("post", f"{APPS}/{c}/guarantees/{self.caution.pk}/release/",
             "agent_terrain", "aud_fin", None),
            ("post", f"{APPS}/{c}/analyse/justifier/", "gest_credit", "aud_fin",
             "INSTRUCTION_REQUISE"),
            ("post", f"{APPS}/{c}/reanalyser/", "gest_credit", "aud_fin",
             "INSTRUCTION_REQUISE"),
            ("post", f"{APPS}/{c}/analysis-report/", "gest_credit", "aud_fin", None),
            # ── Décision (`CAN_DECIDE`) : l'agent de terrain instruit, il ne
            #    décide pas — la frontière la plus facile à effacer par mégarde.
            ("post", f"{APPS}/{c}/approve/", "gest_credit", "agent_terrain", None),
            ("post", f"{APPS}/{c}/reject/", "gest_credit", "agent_terrain", None),
            # ── Décaissement : maker et checker sont deux groupes DISTINCTS ──
            ("post", f"{APPS}/{c}/disbursement/request/", "agent_terrain",
             "gest_caisse", None),
            ("post", f"{APPS}/{c}/disbursement/cancel/", "agent_terrain",
             "gest_caisse", None),
            ("post", f"{APPS}/{c}/disbursement/confirm/", "gest_caisse",
             "gest_credit", None),
            # ── Comité et audit ──────────────────────────────────────────────
            ("get", f"{APPS}/{c}/committee-votes/", "aud_fin", "gest_credit", None),
            ("post", f"{APPS}/{c}/committee-vote/", "dg", "gest_credit", None),
            # ── Barèmes : lecture staff, écriture comité (principes 7 et 8) ──
            ("get", f"{BASE}/baremes/", "gest_credit", "client", None),
            ("get", f"{BASE}/baremes/DSCR/", "gest_credit", "client", None),
            ("post", f"{BASE}/baremes/DSCR/", "dg", "gest_credit", None),
            ("post", f"{BASE}/baremes/DSCR/preview/", "dg", "gest_credit", None),
            ("post", f"{BASE}/baremes/revisions/1/activate/", "dg", "gest_credit", None),
            # ── Analyse staff (`STAFF_ROLES`) ────────────────────────────────
            ("get", f"{APPS}/{c}/analyse/", "gest_credit", "client", "STAFF_REQUIS"),
        ]

    def test_le_role_exclu_est_refuse_en_403_avec_son_code_d_origine(self):
        for methode, url, _admis, exclu, code in self._matrice():
            with self.subTest(url=url, role=exclu):
                self.login(role=exclu, sub=f"sub-exclu-{exclu}")
                reponse = getattr(self.client, methode)(url, {}, format="json")
                self.assertEqual(reponse.status_code, 403, f"{url} → {reponse.data}")
                if code is not None:
                    self.assertEqual(reponse.data.get("code"), code, url)

    def test_le_role_admis_franchit_le_garde(self):
        """« Franchir » ≠ « réussir » : plusieurs de ces routes répondent ensuite
        400 (payload vide), 404 (analyse ou barème absents) ou 409 (statut
        incompatible). Seul compte qu'aucune ne rende 401/403 — les deux seuls
        statuts que `permission_classes` sait produire."""
        for methode, url, admis, _exclu, _code in self._matrice():
            with self.subTest(url=url, role=admis):
                self.login(role=admis, sub=f"sub-admis-{admis}")
                reponse = getattr(self.client, methode)(url, {}, format="json")
                self.assertNotIn(reponse.status_code, (401, 403),
                                 f"{url} → {reponse.data}")

    def test_sans_jeton_le_garde_de_groupe_repond_401_et_non_403(self):
        """`IsAuthenticated` est déclaré AVANT le garde de groupe : un appel sans
        jeton produit le 401 sur lequel le SPA rafraîchit, jamais le 403 du
        groupe — qui laisserait croire le jeton valide et le rôle insuffisant."""
        for methode, url, _admis, _exclu, _code in self._matrice():
            with self.subTest(url=url):
                self.assertEqual(
                    getattr(self.client, methode)(url, {}, format="json").status_code,
                    401, url)

    def test_un_profil_staff_suspendu_perd_le_groupe(self):
        """Non-régression d'une garantie qui vivait dans `_require_group` via
        `roles_of` : suspendre un membre depuis Users.jsx doit le sortir du
        groupe immédiatement. La migration ne devait pas la perdre en route."""
        from rbac.models import StaffProfile

        url = f"{APPS}/{self.app.code}/start-analysis/"
        self.login(role="gest_credit", sub="sub-suspendu")
        self.assertNotEqual(self.client.post(url, {}, format="json").status_code, 403)

        StaffProfile.objects.filter(user_id="sub-suspendu").update(locked=True)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 403)

    def test_l_audit_lit_le_proces_verbal_mais_ne_vote_pas(self):
        """La distinction qu'un garde « staff » unique aurait effacée."""
        self.login(role="aud_fin", sub="sub-auditeur-pv")
        c = self.app.code
        self.assertEqual(self.client.get(f"{APPS}/{c}/committee-votes/").status_code, 200)
        self.assertEqual(
            self.client.post(f"{APPS}/{c}/committee-vote/", {"decision": "approve"},
                             format="json").status_code, 403)

    def test_le_lecteur_de_bareme_n_en_est_pas_l_editeur(self):
        """Une seule route, deux publics : `GroupeSelonMethode` porte la matrice
        sur le décorateur au lieu d'un `if request.method` de corps."""
        self.login(role="gest_credit", sub="sub-gest-bareme")
        self.assertNotEqual(self.client.get(f"{BASE}/baremes/DSCR/").status_code, 403)
        self.assertEqual(
            self.client.post(f"{BASE}/baremes/DSCR/", {}, format="json").status_code, 403)


def _nom_de_decorateur(noeud) -> str:
    """`@api_view(["GET"])` comme `@api_view` → « api_view »."""
    import ast

    cible = noeud.func if isinstance(noeud, ast.Call) else noeud
    return getattr(cible, "id", "") or getattr(cible, "attr", "")


class ToutesLesVuesSontDeclarativesTests(AuthedAPITestCase):
    """Le test qui rend §5 AUDITABLE, et non plus seulement respectée.

    C'est la raison d'être du lot. Une garde posée dans un corps ne se vérifie
    qu'en relisant vingt fonctions, et rien ne signale celle qu'on a oubliée : le
    contrôle est une propriété du texte, pas de la structure. Une garde
    déclarative, elle, se LIT — y compris par une machine.

    Ce test lit donc `credits/views.py` en AST et exige un `@permission_classes`
    sur toute fonction portant `@api_view`. Comparer les CLASSES déclarées au
    défaut global ne dirait rien d'utile : `[IsAuthenticated]` est identique au
    défaut et reste pourtant une décision explicite. Ce qui distingue la décision
    de l'oubli, c'est la présence du décorateur — c'est exactement ce qu'on
    mesure.

    Une vue ajoutée demain sans décorateur fait tomber la suite : c'est le seul
    mécanisme qui empêche la dette de se réinstaller vue par vue.
    """

    def test_toute_vue_de_credits_declare_ses_permissions(self):
        import ast
        import inspect

        from credits import views

        arbre = ast.parse(inspect.getsource(views))
        manquantes = []
        for noeud in arbre.body:
            if not isinstance(noeud, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            decorateurs = {_nom_de_decorateur(d) for d in noeud.decorator_list}
            if "api_view" not in decorateurs:
                continue          # helper de module, pas un endpoint
            if "permission_classes" not in decorateurs:
                manquantes.append(noeud.name)

        self.assertEqual(
            manquantes, [],
            "Vues `@api_view` sans `@permission_classes` : leur règle d'accès "
            "n'est lisible ni sur la signature ni pour un audit — « toute vue "
            "sans permission explicite est un bug » (CLAUDE.md §5). En cause : "
            + ", ".join(manquantes))

    def test_l_audit_statique_couvre_bien_toutes_les_routes_servies(self):
        """L'audit AST ne vaut que s'il voit tout ce qui est servi : une vue
        déclarée hors de `credits/views.py` et routée par `credits/urls.py`
        échapperait au test précédent sans que rien ne le dise."""
        from credits import urls as credits_urls, views

        connues = {id(getattr(views, nom)) for nom in dir(views)}
        for route in credits_urls.urlpatterns:
            with self.subTest(route=str(route.pattern)):
                self.assertIn(id(route.callback), connues)

    def test_la_route_publique_l_est_explicitement(self):
        """Une liste vide est une DÉCISION ; une absence de décorateur est un
        oubli. Le test refuse qu'on confonde les deux."""
        from credits import views

        self.assertEqual(views.download_needs_sheet_template.cls.permission_classes, [])
        self.assertEqual(
            self.client.get(f"{BASE}/needs-sheet-template/").status_code, 503,
            "sans template actif : 503 TEMPLATE_NOT_CONFIGURED, jamais 401")

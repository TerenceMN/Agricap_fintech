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


class ClotureDuDossierTests(AuthedAPITestCase):
    """`POST /applications/<code>/close/` — la porte qui manquait.

    `workflow.close()` existait, testée, et **aucun endpoint ne l'atteignait**.
    Conséquence : un dossier décaissé restait `active` indéfiniment, la boucle
    d'apprentissage (principe 10) n'avait aucun déclencheur en production, et
    `n_cas_reels` serait resté à zéro pour toutes les filières — donc chaque
    analyse aurait continué d'annoncer « référentiel indicatif, fiabilité
    limitée » quel que soit le nombre de dossiers réellement bouclés.

    Un mécanisme sans porte n'est pas un mécanisme : c'est ce que ces tests
    verrouillent.
    """

    def setUp(self):
        self.titulaire = _make_user("sub-client-cloture")
        self.app = _make_app("sub-client-cloture", "sub-client-cloture",
                             status="active", amount=Decimal("1330"))
        self.url = f"{APPS}/{self.app.code}/close/"

    def test_un_gestionnaire_clot_un_dossier_actif_avec_motif(self):
        self.login(role="gest_credit", sub="sub-gestionnaire-cloture")
        reponse = self.client.post(
            self.url, {"comment": "Soldé à l'échéance, dernier remboursement reçu."},
            format="json")
        self.assertEqual(reponse.status_code, 200, reponse.data)
        self.app.refresh_from_db()
        self.assertEqual(self.app.status, "closed")
        self.assertIsNotNone(self.app.closed_at)
        self.assertEqual(self.app.closed_by_sub, "sub-gestionnaire-cloture")

    def test_la_reponse_dit_si_la_cloture_a_capitalise(self):
        """Une clôture qui n'apprend rien (filière sans référentiel actif) est
        légitime — mais elle doit se VOIR : sinon `n_cas_reels` stagne et
        personne ne sait pourquoi. Pas de moyenne sans effectif (§4.6)."""
        self.login(role="gest_credit", sub="sub-gestionnaire-cloture")
        reponse = self.client.post(self.url, {"comment": "Remboursement anticipé."},
                                   format="json")
        cloture = reponse.data["closure"]
        self.assertEqual(
            set(cloture) >= {"closedAt", "comment", "capitalisee", "observationId",
                             "referentiel", "contributive"}, True, cloture)
        self.assertEqual(cloture["comment"], "Remboursement anticipé.")
        self.assertIsInstance(cloture["capitalisee"], bool)

    def test_le_motif_est_obligatoire(self):
        """« Deux ans plus tard, c'est cette phrase qui explique la fin du
        dossier » — chaque décision exige son motif (§7.2)."""
        self.login(role="gest_credit", sub="sub-gestionnaire-cloture")
        reponse = self.client.post(self.url, {"comment": "   "}, format="json")
        self.assertEqual(reponse.status_code, 422, reponse.data)
        self.app.refresh_from_db()
        self.assertEqual(self.app.status, "active")

    def test_un_agent_de_terrain_ne_solde_pas_une_dette(self):
        """`CAN_DECIDE` et non `CAN_INSTRUCT` : clore, c'est aussi passer un
        « abandon de créance ». Même frontière qu'à l'approbation, appliquée à
        la sortie du cycle."""
        self.login(role="agent_terrain", sub="sub-terrain-cloture")
        self.assertEqual(
            self.client.post(self.url, {"comment": "Soldé."}, format="json").status_code,
            403)
        self.app.refresh_from_db()
        self.assertEqual(self.app.status, "active")

    def test_le_titulaire_ne_clot_pas_son_propre_credit(self):
        self.login(role="client", sub=self.titulaire.pk)
        self.assertEqual(
            self.client.post(self.url, {"comment": "Soldé."}, format="json").status_code,
            403)

    def test_sans_jeton_la_cloture_repond_401(self):
        self.assertEqual(
            self.client.post(self.url, {"comment": "Soldé."}, format="json").status_code,
            401)

    def test_on_ne_clot_pas_un_dossier_qui_n_est_pas_actif(self):
        """La machine à états tranche, pas la vue : `workflow.close` refuse tout
        statut autre qu'`active` et porte lui-même son code et son 409."""
        brouillon = _make_app("sub-client-cloture", "sub-client-cloture", status="draft")
        self.login(role="gest_credit", sub="sub-gestionnaire-cloture")
        reponse = self.client.post(f"{APPS}/{brouillon.code}/close/",
                                   {"comment": "Soldé."}, format="json")
        self.assertEqual(reponse.status_code, 409, reponse.data)

    def test_la_cloture_est_servie_en_vue_staff(self):
        """Endpoint `CAN_DECIDE` : la réponse est celle de l'instruction."""
        garant = _make_user("sub-garant-cloture")
        CreditGuarantee.objects.create(
            application=self.app,
            guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
            status=CreditGuarantee.Status.ACTIVE, guarantor=garant,
            guarantor_name="Kalala Mutombo", guarantor_phone="+243970000077",
            guarantor_id_number="CD-CNI-55443322", covered_amount=Decimal("1330"),
        )
        self.login(role="gest_credit", sub="sub-gestionnaire-cloture")
        reponse = self.client.post(self.url, {"comment": "Soldé à l'échéance."},
                                   format="json")
        item = reponse.data["guarantees"]["items"][0]
        self.assertEqual(item["guarantorIdNumber"], "CD-CNI-55443322")


class PieceIdentiteDuGarantTests(AuthedAPITestCase):
    """`pour_staff` : l'instruction voit la pièce, le demandeur ne la voit pas.

    Le défaut de `get_guarantee_summary` est le MASQUAGE — une vue qui oublie de
    préciser son audience doit se tromper du côté prudent. Restait à brancher les
    endpoints staff, faute de quoi un agent d'instruction voyait la CNI du garant
    masquée : gêne visible et réversible, préférable à une fuite invisible.

    Le vrai risque de ce branchement est l'inverse : poser `pour_staff=True` en
    dur sur une vue à audience MIXTE enverrait la pièce d'identité d'un tiers au
    demandeur. Les deux sens sont donc testés sur les mêmes routes.
    """

    PIECE = "CD-CNI-90817263"

    def setUp(self):
        self.titulaire = _make_user("sub-client-piece")
        self.app = _make_app("sub-client-piece", "sub-client-piece",
                             status="submitted", amount=Decimal("900"))
        self.garant = _make_user("sub-garant-piece")
        CreditGuarantee.objects.create(
            application=self.app,
            guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
            status=CreditGuarantee.Status.CONSENTED, guarantor=self.garant,
            guarantor_name="Bosco Ilunga", guarantor_phone="+243970000088",
            guarantor_id_number=self.PIECE, covered_amount=Decimal("900"),
        )
        self.url = f"{APPS}/{self.app.code}/guarantees/"

    def test_l_agent_d_instruction_voit_la_piece_en_clair(self):
        """C'est l'objet du branchement : la CNI est la preuve qu'un agent a vu
        la pièce, et cette preuve appartient à l'instruction."""
        self.login(role="gest_credit", sub="sub-agent-piece")
        reponse = self.client.get(self.url)
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.data["items"][0]["guarantorIdNumber"], self.PIECE)

    def test_le_titulaire_ne_voit_toujours_pas_la_piece_de_son_garant(self):
        """Donnée personnelle d'un TIERS, dont le demandeur n'a aucun usage.
        `guarantorIdProvided` lui dit ce qui lui est utile — la caution est
        complète — sans livrer le contenu."""
        self.login(role="client", sub=self.titulaire.pk)
        item = self.client.get(self.url).data["items"][0]
        self.assertNotEqual(item["guarantorIdNumber"], self.PIECE)
        self.assertNotIn(self.PIECE, self.client.get(self.url).content.decode())
        self.assertTrue(item["guarantorIdProvided"])

    def test_le_garant_lui_meme_ne_recolte_pas_les_pieces_du_dossier(self):
        """`confirm_guarantee` admet un non-staff : le garant désigné. Un
        `pour_staff=True` en dur sur cette route lui aurait livré les pièces des
        AUTRES garants du dossier."""
        self.login(role="client", sub=self.garant.pk)
        corps = self.client.get(self.url).content.decode()
        self.assertNotIn(self.PIECE, corps)

    def test_les_transitions_staff_servent_la_piece(self):
        """`serialize_application` embarque le résumé des garanties : les
        transitions réservées au personnel doivent la porter aussi, sinon
        l'agent la perd dès qu'il agit sur le dossier."""
        instruction = _make_app("sub-client-piece", "sub-client-piece",
                                status="in_analysis")
        CreditGuarantee.objects.create(
            application=instruction,
            guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
            status=CreditGuarantee.Status.CONSENTED, guarantor=self.garant,
            guarantor_name="Bosco Ilunga", guarantor_phone="+243970000088",
            guarantor_id_number=self.PIECE, covered_amount=Decimal("900"),
        )
        self.login(role="gest_credit", sub="sub-agent-piece")
        reponse = self.client.post(
            f"{APPS}/{instruction.code}/adjourn/",
            {"comment": "Feuille de besoins incomplète, à re-déposer."},
            format="json")
        self.assertEqual(reponse.status_code, 200, reponse.data)
        self.assertEqual(
            reponse.data["guarantees"]["items"][0]["guarantorIdNumber"], self.PIECE)

    def test_une_transition_a_audience_mixte_ne_fuit_pas_au_titulaire(self):
        """`submit` est ouvert au titulaire ET à l'agent : `pour_staff` s'y
        CALCULE. C'est la ligne où un `True` en dur aurait fuité."""
        brouillon = _make_app("sub-client-piece", "sub-client-piece", status="draft")
        CreditGuarantee.objects.create(
            application=brouillon,
            guarantee_type=CreditGuarantee.GuaranteeType.MORALE,
            status=CreditGuarantee.Status.CONSENTED, guarantor=self.garant,
            guarantor_name="Bosco Ilunga", guarantor_phone="+243970000088",
            guarantor_id_number=self.PIECE, covered_amount=Decimal("500"),
        )
        self.login(role="client", sub=self.titulaire.pk)
        corps = self.client.post(f"{APPS}/{brouillon.code}/submit/", {},
                                 format="json").content.decode()
        self.assertNotIn(self.PIECE, corps)


class FeuilleDeBesoinsDAutruiTests(AuthedAPITestCase):
    """Faille TROUVÉE en cartographiant les gardes de corps — sans lien avec la
    migration, et qu'aucune `permission_classes` n'aurait pu couvrir.

    `POST /applications/` acceptait `needs_sheet_id` sans vérifier à qui la
    feuille appartient. `NeedsSheet.pk` étant un entier séquentiel, tout membre
    pouvait rattacher à SON dossier la feuille de besoins d'un autre, puis la
    lire par la porte de devant : `GET /applications/<son code>/analysis-report/`
    sert `serialize_analysis_report(app.needs_sheet)`, c'est-à-dire les lignes du
    classeur d'autrui — libellés, quantités, prix, écarts — et les commentaires
    internes de l'analyste.

    L'étanchéité de `analysis-report` ne pouvait rien voir : le dossier
    interrogé appartient bien à l'appelant. C'est la référence ENTRANTE qui
    n'était pas vérifiée. `simulate_scoring`, dans le même fichier, filtrait
    pourtant déjà sur `uploaded_by` — l'intention existait, une seule des deux
    portes l'appliquait.
    """

    def setUp(self):
        from credits.models import NeedsSheet

        self.victime = _make_user("sub-victime-ns")
        self.curieux = _make_user("sub-curieux-ns")
        self.feuille = NeedsSheet.objects.create(
            uploaded_by="sub-victime-ns", currency="USD", parsed_ok=True,
            grand_total=Decimal("1330"),
            total_by_module={"semences": "400", "engrais": "930"},
        )

    def test_un_tiers_ne_rattache_pas_la_feuille_d_un_autre_a_son_dossier(self):
        self.login(role="client", sub=self.curieux.pk)
        reponse = self.client.post(
            f"{APPS}/", {"amount_requested": "1000", "needs_sheet_id": self.feuille.pk},
            format="json")
        self.assertEqual(reponse.status_code, 404)
        self.assertEqual(reponse.data["detail"], "Feuille de besoins introuvable.")

    def test_le_refus_est_indiscernable_d_un_identifiant_inexistant(self):
        """Sinon la réponse compte les feuilles en base et signale celles
        d'autrui — le même oracle que les codes `CRED-AAAAMMJJ-NNNN`."""
        self.login(role="client", sub=self.curieux.pk)
        corps = {"amount_requested": "1000"}
        interdit = self.client.post(
            f"{APPS}/", {**corps, "needs_sheet_id": self.feuille.pk}, format="json")
        inexistant = self.client.post(
            f"{APPS}/", {**corps, "needs_sheet_id": 999_999}, format="json")
        self.assertEqual(interdit.status_code, inexistant.status_code)
        self.assertEqual(interdit.data, inexistant.data)

    def test_le_titulaire_rattache_sa_propre_feuille(self):
        """Non-régression du parcours normal : le client qui a téléversé sa
        feuille la rattache à son dossier."""
        self.login(role="client", sub=self.victime.pk)
        reponse = self.client.post(
            f"{APPS}/", {"amount_requested": "1000", "needs_sheet_id": self.feuille.pk},
            format="json")
        self.assertEqual(reponse.status_code, 201, reponse.data)
        self.assertEqual(
            CreditApplication.objects.get(code=reponse.data["code"]).needs_sheet_id,
            self.feuille.pk)

    def test_l_agent_rattache_la_feuille_qu_il_a_televersee_pour_le_client(self):
        """`parse_needs_sheet_view` pose `uploaded_by` = sub du DÉPOSANT : quand
        l'agent téléverse pour le client, la feuille porte le sub de l'agent.
        Filtrer sur le seul `client_sub` aurait cassé ce parcours — c'est le
        durcissement de trop qu'il fallait éviter."""
        from credits.models import NeedsSheet

        feuille_agent = NeedsSheet.objects.create(
            uploaded_by="sub-agent-ns", currency="USD", parsed_ok=True,
            grand_total=Decimal("2000"), total_by_module={"semences": "2000"},
        )
        self.login(role="agent_terrain", sub="sub-agent-ns")
        reponse = self.client.post(
            f"{APPS}/",
            {"amount_requested": "2000", "client_sub": self.victime.pk,
             "needs_sheet_id": feuille_agent.pk},
            format="json")
        self.assertEqual(reponse.status_code, 201, reponse.data)
        self.assertEqual(
            CreditApplication.objects.get(code=reponse.data["code"]).needs_sheet_id,
            feuille_agent.pk)

    def test_la_fuite_par_analysis_report_est_refermee(self):
        """Le test de bout en bout : c'est la lecture, pas le rattachement, qui
        faisait le dommage."""
        self.login(role="client", sub=self.curieux.pk)
        self.client.post(
            f"{APPS}/", {"amount_requested": "1000", "needs_sheet_id": self.feuille.pk},
            format="json")
        dossier = CreditApplication.objects.filter(client_id=self.curieux.pk).first()
        if dossier is not None:                      # le dossier n'est pas créé (404)
            self.assertIsNone(dossier.needs_sheet_id)
        self.assertFalse(
            CreditApplication.objects.filter(needs_sheet=self.feuille)
            .exclude(client_id=self.victime.pk).exists())


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

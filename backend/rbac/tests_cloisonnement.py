"""Balayage transverse : aucun rôle de type « Client » n'atteint un endpoint interne.

Ce module est le filet de sécurité de la règle énoncée dans `rbac.permissions` :

    `HasCapability("read")` ne signifie pas « interne ».

Dans `rbac.role_registry`, `client`, `agri_op`, `invest`, `investor` et `partner` portent
tous `read=True` — c'est ce qui leur donne accès à LEURS données. Un endpoint qui sert la
comptabilité, la trésorerie, le KYC de tiers, les agrégats institution ou un référentiel
chiffré doit donc cumuler `accounts.permissions.IsStaff`. Vingt et un endpoints ne le
faisaient pas.

Trois familles de tests, dans cet ordre d'importance :

1. **Le refus** — chaque endpoint interne répond 403 à un `client` ET à un `invest`.
   Les deux rôles sont testés : `invest` porte en plus `create`, et c'est le rôle sur
   lequel un garde de capacité mal choisi passe inaperçu le plus longtemps.
2. **La non-régression** — les endpoints laissés ouverts aux membres le restent, parce
   qu'ils servent la donnée de l'appelant. Fermer un accès client légitime serait un
   dégât plus grand que la faille corrigée.
3. **L'écriture** — un endpoint de lecture ne devient pas un endpoint d'écriture parce
   que la méthode change : la capacité dépend de la MÉTHODE.

Le test décrit les endpoints par leur URL et non par leur vue : c'est le contrat réel, et
c'est ce qu'un attaquant appelle.
"""
from __future__ import annotations

from common.testing import AuthedAPITestCase

#: Rôles de type « Client » du registre. `partner` et `agri_op` sont inclus : ils ne sont
#: pas moins « externes » parce qu'ils sont rares.
ROLES_CLIENTS = ("client", "agri_op", "invest", "investor", "partner")

#: Endpoints servant une donnée de l'INSTITUTION. Aucun ne doit répondre autre chose que
#: 403 à un membre — pas même 404 : un 404 signifierait que le garde a laissé entrer et
#: que c'est la donnée qui manquait.
ENDPOINTS_INTERNES = (
    # ── Grand livre et états financiers ──
    ("GET", "/api/ledger/accounts"),
    ("GET", "/api/ledger/entries"),
    ("GET", "/api/ledger/accounts/501/lines"),
    ("GET", "/api/ledger/trial-balance"),
    ("GET", "/api/ledger/statements/bilan"),
    # ── Transactions (flux de validation, tous émetteurs) ──
    ("GET", "/api/transactions/"),
    ("GET", "/api/transactions/1"),
    ("GET", "/api/transactions/supervision"),
    # ── KYC / AML de tiers ──
    ("GET", "/api/compliance/kyc"),
    # ── Trésorerie de l'institution ──
    ("GET", "/api/caisses/accounts"),
    ("GET", "/api/caisses/accounts/CAISSE-1"),
    ("GET", "/api/caisses/accounts/CAISSE-1/register-sessions"),
    # ── Épargne : back-office ──
    ("GET", "/api/savings/plans"),
    ("GET", "/api/savings/groups/1"),
    ("GET", "/api/savings/groups/1/audit"),
    # ── Agences ──
    ("GET", "/api/agencies/"),
    ("GET", "/api/agencies/AG-1"),
    ("GET", "/api/agencies/AG-1/compliance-score"),
    ("GET", "/api/agencies/reconciliations"),
    # ── Supervision, agrégats, référentiels, tiers ──
    ("GET", "/api/alerts/"),
    ("GET", "/api/analytics/overview"),
    ("GET", "/api/analytics/compliance-score"),
    ("GET", "/api/partners/"),
    ("GET", "/api/partners/1/logs"),
    ("GET", "/api/suppliers/"),
    ("GET", "/api/reference-data/value-chains/"),
    ("GET", "/api/fx/rates"),
    ("GET", "/api/fx/rates/pending"),
    ("GET", "/api/support/dashboard/stats"),
)

#: Écritures qui étaient à la portée de `read`. Chacune modifie l'état financier ou le
#: référentiel de l'institution ; aucune n'est un acte de membre.
ECRITURES_INTERNES = (
    ("POST", "/api/ledger/entries", {"idempotencyKey": "x", "lines": []}),
    ("POST", "/api/ledger/accounts", {"code": "999", "name": "Compte pirate"}),
    ("POST", "/api/transactions/", {"idempotencyKey": "x", "amount": "1"}),
    ("POST", "/api/savings/groups", {"name": "Groupe pirate", "rate": "99"}),
    ("POST", "/api/suppliers/", {"name": "Fournisseur pirate"}),
    ("POST", "/api/agencies/", {"code": "AG-PIRATE", "name": "Agence pirate"}),
)

#: Endpoints délibérément LAISSÉS ouverts aux membres : ils servent la donnée de
#: l'appelant, filtrée par propriétaire dans la requête. Les verrouiller aurait cassé le
#: parcours client — un dégât plus grand que la faille.
ENDPOINTS_MEMBRE = (
    "/api/caisses/wallets/mine",
    "/api/caisses/wallets/mine/movements",
    "/api/savings/plans/mine",
    "/api/savings/groups",           # catalogue des groupes à rejoindre (ligne réduite)
    "/api/savings/groups/mine",
    "/api/compliance/kyc/mine",
    "/api/compliance/documents/mine",
    "/api/credits/applications/",
    "/api/credits/guarantee-requests/",
)


class RefusDesEndpointsInternesTests(AuthedAPITestCase):
    def test_aucun_role_client_n_atteint_un_endpoint_interne(self):
        for role in ROLES_CLIENTS:
            self.login(role=role, sub=f"membre-{role}")
            for methode, url in ENDPOINTS_INTERNES:
                with self.subTest(role=role, url=url):
                    reponse = self.client.generic(methode, url)
                    self.assertEqual(
                        reponse.status_code, 403,
                        f"{methode} {url} répond {reponse.status_code} au rôle « {role} » "
                        f"— attendu 403. Un 404 signifierait que le garde a laissé entrer.",
                    )

    def test_aucun_role_client_n_ecrit_dans_la_comptabilite_ni_le_referentiel(self):
        for role in ROLES_CLIENTS:
            self.login(role=role, sub=f"scribe-{role}")
            for methode, url, corps in ECRITURES_INTERNES:
                with self.subTest(role=role, url=url):
                    reponse = self.client.generic(
                        methode, url, self.client._encode_json(corps, "json"),
                        content_type="application/json")
                    self.assertEqual(
                        reponse.status_code, 403,
                        f"{methode} {url} répond {reponse.status_code} au rôle « {role} ».",
                    )

    def test_un_profil_verrouille_perd_l_acces_meme_avec_un_role_interne(self):
        """`IsStaff` ne regarde que le TYPE du rôle et ignore la suspension : c'est
        `HasCapability` qui vérifie `StaffProfile.locked`. Les deux gardes sont CUMULÉS,
        jamais substitués — ce test tomberait si quelqu'un remplaçait la capacité par
        `IsStaff` seul, croyant simplifier."""
        from rbac.models import StaffProfile

        self.login(role="gest_credit", sub="agent-suspendu")
        self.assertEqual(self.client.get("/api/ledger/trial-balance").status_code, 200)

        StaffProfile.objects.update_or_create(
            user_id="agent-suspendu", defaults={"locked": True})
        self.assertEqual(self.client.get("/api/ledger/trial-balance").status_code, 403)


class AccesLegitimeDuMembreTests(AuthedAPITestCase):
    """Le durcissement ne doit RIEN fermer de ce qui appartient à l'appelant."""

    def test_les_endpoints_de_donnees_personnelles_restent_ouverts(self):
        self.login(role="client", sub="membre-legitime")
        for url in ENDPOINTS_MEMBRE:
            with self.subTest(url=url):
                self.assertNotEqual(
                    self.client.get(url).status_code, 403,
                    f"{url} refuse un membre : c'est SA donnée, le filtre doit être dans "
                    f"la requête (`user=request.user`), pas dans le garde.",
                )


class AccesDuPersonnelTests(AuthedAPITestCase):
    """Contrôle positif : le durcissement n'a pas fermé le backoffice non plus.

    Sans ce test, « tout répond 403 » validerait la suite précédente à 100 %.
    """

    def test_le_personnel_franchit_les_gardes_de_lecture(self):
        self.login(role="dg", sub="dg-cloisonnement")
        for methode, url in ENDPOINTS_INTERNES:
            with self.subTest(url=url):
                self.assertNotEqual(
                    self.client.generic(methode, url).status_code, 403,
                    f"{methode} {url} refuse le Directeur Général.",
                )

    def test_un_auditeur_lit_mais_n_ecrit_pas(self):
        """`aud_fin` porte `read` + `audit`, jamais `create` ni `config` : il consulte le
        grand livre et ne poste rien. La capacité dépend de la MÉTHODE."""
        self.login(role="aud_fin", sub="auditeur-cloisonnement")
        self.assertNotEqual(self.client.get("/api/ledger/entries").status_code, 403)
        self.assertEqual(
            self.client.post("/api/ledger/entries", {"idempotencyKey": "x"},
                             format="json").status_code, 403)
        self.assertEqual(
            self.client.post("/api/ledger/accounts", {"code": "999"},
                             format="json").status_code, 403)

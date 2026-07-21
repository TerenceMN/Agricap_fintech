"""Tests du référentiel — principalement l'ANTI-GAMING (principe 7).

Ces endpoints servent les règles du moteur : seuils DSCR, couverture minimale,
score global minimum, les cinq poids du scoring, et les plages min/max par
chaîne. Ils étaient tous ouverts à `IsAuthenticated`, donc à n'importe quel
utilisateur connecté — le rôle ``client`` porte la capacité ``read``.

Conséquence : un demandeur pouvait lire les règles exactes de sa propre
évaluation. Ce n'est pas une fuite théorique — c'est précisément ce que le
principe 7 nomme « anti-gaming par asymétrie d'information » : qui connaît le
barème calibre son dossier pour franchir la barre, pas pour réussir son projet.

Le CLAUDE.md §5 exige ce test nominativement : « Anti-gaming : test qui vérifie
qu'aucun serializer client n'expose barèmes/seuils/plages ». Il n'existait pas.
"""
from common.testing import AuthedAPITestCase


class AntiGamingReferentielTests(AuthedAPITestCase):
    """Un client ne doit atteindre AUCUN paramètre du moteur."""

    #: Endpoints portant des règles de décision — jamais accessibles au client.
    SENSIBLES = (
        "/api/referentiel/config",    # seuils + les 5 poids du scoring
        "/api/referentiel/ranges",    # plages min/max par chaîne
        "/api/referentiel/versions",  # historique des versions du référentiel
    )

    def test_un_client_ne_lit_aucun_parametre_du_moteur(self):
        self.login(role="client", sub="demandeur-1")
        for url in self.SENSIBLES:
            with self.subTest(url=url):
                res = self.client.get(url)
                self.assertEqual(
                    res.status_code, 403,
                    f"{url} est accessible au client : il peut lire les règles "
                    f"de sa propre évaluation (principe 7).")

    def test_investisseur_et_partenaire_non_plus(self):
        """`investor` et `partner` sont des rôles de niveau client (registre RBAC) :
        ils ne sont pas du personnel qui instruit, ils n'ont rien à savoir des
        barèmes."""
        for role in ("investor", "partner"):
            for url in self.SENSIBLES:
                with self.subTest(role=role, url=url):
                    self.login(role=role, sub=f"{role}-1")
                    self.assertEqual(self.client.get(url).status_code, 403)

    def test_le_personnel_conserve_l_acces(self):
        """La transparence visée par ce module est celle du PERSONNEL qui
        instruit : le resserrage ne doit pas la lui retirer."""
        self.login(role="admin", sub="staff-1")
        for url in self.SENSIBLES:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_le_catalogue_des_chaines_reste_ouvert(self):
        """`chains` sert le catalogue des cultures (code, libellé, spécialité) —
        aucune règle de décision. Le fermer n'apporterait rien et casserait un
        futur parcours client légitime (choisir sa filière)."""
        self.login(role="client", sub="demandeur-2")
        self.assertEqual(self.client.get("/api/referentiel/chains").status_code, 200)

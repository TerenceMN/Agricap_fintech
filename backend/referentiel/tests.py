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
from decimal import Decimal

from django.test import TestCase

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


class ConfigDecoteExpositionTests(AuthedAPITestCase):
    """`config` expose la décote de garantie au PERSONNEL (file de vérification
    des actifs), et à lui seul."""

    def test_le_personnel_lit_la_decote_de_garantie(self):
        """La file de vérification (agent terrain) a besoin du taux de décote en
        vigueur pour l'afficher ; le serveur le sert dans `config` sous la garde
        `IsStaff`."""
        from referentiel.models import InstitutionConfig

        InstitutionConfig.objects.create(is_active=True, decote_garantie=Decimal("0.35"))
        self.login(role="admin", sub="staff-decote")
        res = self.client.get("/api/referentiel/config")
        self.assertEqual(res.status_code, 200)
        self.assertIn("decote_garantie", res.data)
        # Égalité EXACTE, pas `assertAlmostEqual` : c'est tout l'objet du passage
        # en `Decimal` — 0,35 vaut 0,35, pas 0,34999999999999997779…
        self.assertEqual(res.data["decote_garantie"], Decimal("0.35"))

    def test_le_client_ne_lit_pas_la_decote(self):
        """Le taux de décote est un paramètre du moteur : un demandeur ne l'atteint
        pas (l'endpoint entier est refusé en 403, principe 7)."""
        self.login(role="client", sub="demandeur-decote")
        self.assertEqual(self.client.get("/api/referentiel/config").status_code, 403)

    def test_le_json_sert_toujours_un_nombre(self):
        """Contrat de sortie : `AssetVerification.tsx` teste
        `typeof cfg.decote_garantie === 'number'` avant d'afficher le taux.

        Le passage en `Decimal` ne doit PAS transformer la réponse en chaîne :
        le rendu JSON de DRF sérialise un `Decimal` en nombre. Ce test verrouille
        ce contrat — le jour où quelqu'un branchera un serializer DRF sur cet
        endpoint (`COERCE_DECIMAL_TO_STRING` vaut `True` par défaut), l'écran de
        vérification des actifs cesserait d'afficher la décote en silence.
        """
        import json

        from referentiel.models import InstitutionConfig

        InstitutionConfig.objects.create(is_active=True, decote_garantie=Decimal("0.35"))
        self.login(role="admin", sub="staff-json")
        res = self.client.get("/api/referentiel/config")
        payload = json.loads(res.content)
        self.assertIsInstance(payload["decote_garantie"], (int, float))
        self.assertIsInstance(payload["poids"]["technique"], (int, float))


class ParametresMoteurDecimalTests(TestCase):
    """Principe 4 — les paramètres que le moteur relit sont des `Decimal`.

    `credits/analyse.py` raisonne en `Decimal` de bout en bout et convertit ce
    qu'il lit (`Decimal(str(cfg.poids_technique))`). Tant que la colonne était un
    `FloatField`, cette conversion partait d'une valeur déjà abîmée : 0,30 stocké
    valait 0,29999999999999998889776975374843. L'écart est infime — et c'est
    précisément le problème : il se propage dans la somme pondérée des cinq
    critères, où 0,1 point autour d'une frontière de recommandation fait changer
    la recommandation.
    """

    #: (champ, valeur saisie, valeur exacte attendue en base).
    SEUILS = [
        ("seuil_dscr", Decimal("1.15"), Decimal("1.150")),
        ("seuil_dscr_stresse", Decimal("0.95"), Decimal("0.950")),
        ("couverture_min", Decimal("1.20"), Decimal("1.200")),
        ("score_global_min", Decimal("45.10"), Decimal("45.10")),
        ("taux_interet_annuel", Decimal("0.1875"), Decimal("0.1875")),
        ("decote_garantie", Decimal("0.30"), Decimal("0.3000")),
        ("decote_caution_morale", Decimal("0.70"), Decimal("0.7000")),
        ("caution_ratio_epargne", Decimal("1.5"), Decimal("1.500")),
        ("plafond_delegue", Decimal("25000.00"), Decimal("25000.00")),
    ]

    def test_un_seuil_relu_en_base_est_un_decimal_exact(self):
        from referentiel.models import InstitutionConfig

        cfg = InstitutionConfig.objects.create(
            is_active=True, **{champ: saisi for champ, saisi, _ in self.SEUILS})
        cfg.refresh_from_db()
        for champ, _, attendu in self.SEUILS:
            with self.subTest(champ=champ):
                valeur = getattr(cfg, champ)
                self.assertIsInstance(valeur, Decimal, f"{champ} n'est pas un Decimal")
                self.assertEqual(valeur, attendu)

    def test_les_defauts_de_secours_sont_deja_des_decimal(self):
        """`InstitutionConfig.active()` renvoie une instance NON sauvegardée quand
        aucune config n'a été importée : ses valeurs sont les défauts du modèle.
        Elles doivent être exactes elles aussi — c'est la configuration qui
        s'applique tant que le comité n'a rien arrêté."""
        from referentiel.models import InstitutionConfig

        InstitutionConfig.objects.all().delete()
        cfg = InstitutionConfig.active()
        self.assertEqual(cfg.pk, None)
        for champ in ("seuil_dscr", "score_global_min", "decote_garantie",
                      "taux_interet_annuel", "plafond_delegue", "poids_technique"):
            with self.subTest(champ=champ):
                self.assertIsInstance(getattr(cfg, champ), Decimal)
        self.assertEqual(cfg.taux_echantillon, Decimal("1.00"))

    def test_la_somme_des_poids_vaut_exactement_100(self):
        """Invariant CLAUDE.md §5 : « somme des poids = 100 ». En `float`, une
        pondération 33,33 / 33,33 / 33,34 pouvait sommer à 99,99999999999999 et
        faire retomber le moteur sur ses poids de secours SANS que le comité ne
        comprenne pourquoi sa pondération n'était pas appliquée."""
        from referentiel.models import InstitutionConfig

        cfg = InstitutionConfig.objects.create(
            is_active=True,
            poids_technique=Decimal("33.33"), poids_financier=Decimal("33.33"),
            poids_stress=Decimal("33.34"), poids_comportemental=Decimal("0"),
            poids_garanties=Decimal("0"),
        )
        cfg.refresh_from_db()
        somme = (cfg.poids_technique + cfg.poids_financier + cfg.poids_stress
                 + cfg.poids_comportemental + cfg.poids_garanties)
        self.assertEqual(somme, Decimal(100))

    def test_le_moteur_lit_bien_des_decimal(self):
        """Lecture de NON-RÉGRESSION du consommateur réel : `poids_effectifs()`
        (`credits/analyse.py`) est LA fonction qui lit cette table à chaque
        analyse. On vérifie ici qu'elle reçoit des `Decimal` exacts et applique
        la pondération du comité — au lieu de retomber sur ses poids de secours.

        `credits/` n'est pas modifié par ce lot : ce test le prend tel quel.
        """
        from credits.analyse import poids_effectifs
        from referentiel.models import InstitutionConfig

        InstitutionConfig.objects.all().delete()
        InstitutionConfig.objects.create(
            is_active=True,
            poids_technique=Decimal("33.33"), poids_financier=Decimal("33.33"),
            poids_stress=Decimal("33.34"), poids_comportemental=Decimal("0"),
            poids_garanties=Decimal("0"),
        )
        poids = poids_effectifs()
        for critere, valeur in poids.items():
            with self.subTest(critere=critere):
                self.assertIsInstance(valeur, Decimal)
        self.assertEqual(poids["technique"], Decimal("33.33"))
        self.assertEqual(sum(poids.values()), Decimal(100))


class ParsingExactFeuille16Tests(TestCase):
    """La feuille 16 est du TEXTE français : « 1,20 », « 8 % », « 1,15–1,25 ».

    Le lire en `float` puis convertir en `Decimal` ne rattrape rien — la perte a
    déjà eu lieu. `to_decimal_range` parse le texte directement en `Decimal`.
    """

    def test_une_virgule_decimale_devient_un_decimal_exact(self):
        from referentiel.range_parser import to_decimal, to_decimal_range

        self.assertEqual(to_decimal("1,20"), Decimal("1.20"))
        self.assertEqual(to_decimal_range("1,20"), (Decimal("1.20"), Decimal("1.20")))
        # Le chemin `float` historique produisait, lui, une valeur inexacte.
        self.assertNotEqual(Decimal(float("1.15")), Decimal("1.15"))
        self.assertEqual(to_decimal("1,15"), Decimal("1.15"))

    def test_un_pourcentage_devient_une_fraction_exacte(self):
        from referentiel.range_parser import to_decimal_range

        self.assertEqual(to_decimal_range("8 %"), (Decimal("0.08"), Decimal("0.08")))
        self.assertEqual(to_decimal_range("7,5 %"), (Decimal("0.075"), Decimal("0.075")))

    def test_une_plage_rend_ses_deux_bornes_ordonnees(self):
        from referentiel.range_parser import to_decimal_range

        self.assertEqual(to_decimal_range("1,25–1,15"), (Decimal("1.15"), Decimal("1.25")))
        self.assertEqual(to_decimal_range("illisible"), (None, None))
        self.assertEqual(to_decimal_range(None), (None, None))

    def test_l_ingestion_ecrit_des_decimal_dans_la_config(self):
        """Bout en bout : une feuille 16 éditée en base → `InstitutionConfig`.
        C'est le chemin d'écriture réel (onglet Référence du backoffice)."""
        from referentiel.ingest import rebuild_config_from_records
        from referentiel.models import InstitutionConfig, ReferentielVersion

        version = ReferentielVersion.objects.create(label="v-test-decimal")
        entetes = ["Paramètre", "Valeur"]
        lignes = [
            {"Paramètre": "Seuil DSCR (avis favorable)", "Valeur": "1,15"},
            {"Paramètre": "Seuil DSCR stressé", "Valeur": "0,95"},
            {"Paramètre": "Couverture des garanties", "Valeur": "1,20"},
        ]
        self.assertTrue(rebuild_config_from_records(version, entetes, lignes))

        cfg = InstitutionConfig.active()
        self.assertEqual(cfg.seuil_dscr, Decimal("1.150"))
        self.assertEqual(cfg.seuil_dscr_stresse, Decimal("0.950"))
        self.assertEqual(cfg.couverture_min, Decimal("1.200"))
        self.assertIsInstance(cfg.seuil_dscr, Decimal)

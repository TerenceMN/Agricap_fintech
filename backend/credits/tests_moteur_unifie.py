"""
Tests de l'UNIFICATION des moteurs de scoring — un seul moteur, un seul taux.

Ce que ces tests verrouillent, et qui n'existait dans aucun test avant ce lot :

  1. **Une seule grille de taux.** `credits.scoring` proposait +2,5 sur la bande
     [55, 70[ quand `credits.dataio_simulator` proposait +2,0 : deux taux pour un
     même client selon l'écran. L'arbitrage (+2,0) est testé avec son CAS CHIFFRÉ,
     et l'égalité simulation / instruction est testée directement.
  2. **Une seule nomenclature de critères** : `technique`, `dscr`, `stress`,
     `comportemental`, `garanties`. Les codes `fiabilite` / `behavioral` /
     `guarantees` du simulateur et les cinq critères legacy de `scoring.py`
     (`repayment_history`, `kyc_seniority`…) ne doivent plus apparaître nulle part.
  3. **`credits.scoring` ne score plus** : il projette la dernière `AnalyseCredit`.
     Sans analyse, il ne fabrique pas de score — il le dit.
  4. **Modèle « hectare » généralisé** : un référentiel peut porter n'importe
     quelle unité, et le moteur REFUSE de comparer des ruches à des hectares au
     lieu de multiplier l'un par l'autre.
  5. **Les seuils vivent en base** (principe 8) : recalibrer la grille en base
     change le taux servi, sans redéploiement — et ne réécrit pas les analyses
     déjà exécutées (principe 3).
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from credits.analyse import (
    DimensionIncoherente,
    GRILLE_TAUX_DEFAUT,
    executer_analyse,
    proposer_taux,
    projeter_cash_flows,
    regles_taux,
    resoudre_quantite_reference,
    scorer_technique,
    serialiser_analyse_resume,
    serialiser_analyse_staff,
)
from credits.echeancier import construire_echeancier, totaux_echeancier
from credits.models import AnalyseCredit, BaremeScore, ReferentielFiliere
from credits.scoring import CreditScoringEngine, taux_pour_score
from credits.tests_analyse import (
    TOTAUX_REFERENCE,
    _app,
    _chain,
    _referentiel,
    _seed,
    _source,
    _user,
)

#: Référentiel apicole : coûts PAR RUCHE, pas par hectare. Valeurs de l'ordre de
#: grandeur du classeur 08 (2 450 USD pour 30 ruches), arrondies pour la lisibilité
#: du cas chiffré — ces tests testent le MOTEUR, pas le chargement du classeur
#: (couvert par `tests_ingest_simulateurs`).
REFERENTIEL_RUCHES = {
    "code": "AGRICAP_FIN_SIM_08_Apiculture_RuchesKenyanes",
    "filiere": "Apiculture — Miel toutes fleurs",
    "value_chain_code": "08",
    "unite_reference": "ruche",
    "devise": "USD",
    "couts_modules": {
        "equipements": {"ref": "40.00", "tol_inf": "0.40", "tol_sup": "0.40"},
        "maindoeuvre": {"ref": "20.00", "tol_inf": "0.30", "tol_sup": "0.40"},
    },
    "rendement_ref": {"qte_unite": "0.008", "prix_unitaire": "8000", "unite": "t"},
    "n_cas_reels": 0,
    "source": ReferentielFiliere.Source.INDICATIF,
}


# ── 1. Grille de taux unique et son arbitrage ────────────────────────────────

class GrilleTauxTests(TestCase):
    """La grille de tarification : une seule, en base, et chiffrée."""

    def setUp(self):
        _seed()

    def test_les_quatre_bandes_de_la_grille(self):
        """Cas chiffré sur un taux de base de 18 %/an, bande par bande."""
        base = Decimal("18")
        self.assertEqual(proposer_taux(Decimal("92"), base)["taux"], 16.0)   # −2,0
        self.assertEqual(proposer_taux(Decimal("85"), base)["taux"], 16.0)   # borne
        self.assertEqual(proposer_taux(Decimal("72"), base)["taux"], 18.0)   #  0,0
        self.assertEqual(proposer_taux(Decimal("60"), base)["taux"], 20.0)   # +2,0
        self.assertEqual(proposer_taux(Decimal("40"), base)["taux"], 23.0)   # +5,0

    def test_arbitrage_de_la_bande_55_70_documente_et_chiffre(self):
        """L'écart +2,5 / +2,0 tranché : **+2,0**, et voici ce qu'il coûtait.

        Sur le cas de référence de la SPEC (1 330 USD, 8 mois, différé 5, intérêts
        seuls), un dossier scoré 60/100 sur une base de 18 % paie :
            à 20,0 % → 155,19 USD d'intérêts (service 1 485,19)
            à 20,5 % → 159,04 USD d'intérêts (service 1 489,04)
        soit 3,85 USD de plus pour le même dossier, selon l'écran qui l'a tarifé.
        Sur un dossier médian (5 000 USD, 12 mois, différé 3), l'écart est de
        16,68 USD.

        Le montant n'est pas le sujet : le sujet est qu'un client se voyait
        annoncer 20,0 % à la simulation puis facturer 20,5 % à l'instruction.
        """
        taux = proposer_taux(Decimal("60"), Decimal("18"))
        self.assertEqual(taux["taux"], 20.0)
        self.assertEqual(taux["ajustement"], 2.0)
        self.assertEqual(taux["bandeScoreMin"], 55.0)

        retenu = totaux_echeancier(
            construire_echeancier(Decimal("1330"), Decimal("20.0"), 8, 5))
        ecarte = totaux_echeancier(
            construire_echeancier(Decimal("1330"), Decimal("20.5"), 8, 5))
        self.assertEqual(retenu["interets_payes"], Decimal("155.19"))
        self.assertEqual(ecarte["interets_payes"], Decimal("159.04"))
        self.assertEqual(ecarte["interets_payes"] - retenu["interets_payes"],
                         Decimal("3.85"))

        median_20 = totaux_echeancier(
            construire_echeancier(Decimal("5000"), Decimal("20.0"), 12, 3))
        median_205 = totaux_echeancier(
            construire_echeancier(Decimal("5000"), Decimal("20.5"), 12, 3))
        self.assertEqual(median_205["interets_payes"] - median_20["interets_payes"],
                         Decimal("16.68"))

    def test_plancher_de_bonification(self):
        """La bonification ne descend pas sous 70 % du taux de base."""
        taux = proposer_taux(Decimal("95"), Decimal("2.5"))
        self.assertEqual(taux["tauxAvantPlancher"], 0.5)
        self.assertEqual(taux["plancher"], 1.75)
        self.assertEqual(taux["taux"], 1.75)
        self.assertTrue(taux["plancherApplique"])

    def test_la_grille_vit_en_base_et_se_recalibre_sans_redeploiement(self):
        """Principe 8 : le comité passe de +2,0 à +2,5 SANS toucher au code."""
        bareme = BaremeScore.objects.get(code="TAUX")
        self.assertEqual(proposer_taux(Decimal("60"), Decimal("18"),
                                       regles_taux(bareme))["taux"], 20.0)

        bareme.parametres = {
            "grille": [{"score_min": "85", "ajustement": "-2.0"},
                       {"score_min": "70", "ajustement": "0.0"},
                       {"score_min": "55", "ajustement": "2.5"},
                       {"score_min": "0", "ajustement": "5.0"}],
            "plancher_ratio_base": "0.7",
        }
        bareme.save(update_fields=["parametres"])
        bareme.refresh_from_db()
        self.assertEqual(proposer_taux(Decimal("60"), Decimal("18"),
                                       regles_taux(bareme))["taux"], 20.5)

    def test_repli_loggue_quand_la_grille_manque(self):
        """Barème absent → grille de secours documentée, jamais un taux nul."""
        BaremeScore.objects.filter(code="TAUX").delete()
        with self.assertLogs("credits.analyse", level="WARNING") as logs:
            regles = regles_taux(None)
        self.assertIn("TAUX", "".join(logs.output))
        self.assertEqual(regles["grille"], GRILLE_TAUX_DEFAUT["grille"])
        self.assertEqual(proposer_taux(Decimal("60"), Decimal("18"), regles)["taux"],
                         20.0)

    def test_grille_sans_bande_basse_ne_laisse_pas_un_dossier_sans_taux(self):
        """Une grille tronquée ne doit pas tarifer à 0 en silence."""
        regles = {"grille": [{"score_min": "80", "ajustement": "-1.0"}]}
        with self.assertLogs("credits.analyse", level="WARNING"):
            taux = proposer_taux(Decimal("40"), Decimal("18"), regles)
        self.assertEqual(taux["taux"], 18.0)      # taux de base, aucun ajustement
        self.assertIsNone(taux["bandeScoreMin"])


# ── 2. Le taux est figé avec l'analyse ───────────────────────────────────────

class TauxFigeDansAnalyseTests(TestCase):

    def setUp(self):
        _seed()
        self.app = _app()
        _source(self.app, TOTAUX_REFERENCE)

    def test_le_taux_est_persiste_et_trace(self):
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        self.assertIsNotNone(analyse.taux_propose)

        fige = analyse.baremes_appliques["_tarification"]
        self.assertEqual(fige["tauxBase"], 18.0)         # base_rate de la filière
        attendu = proposer_taux(analyse.score_global, Decimal("18"))
        self.assertEqual(float(analyse.taux_propose), attendu["taux"])
        self.assertEqual(fige["ajustement"], attendu["ajustement"])

    def test_un_recalibrage_ne_reecrit_pas_une_analyse_passee(self):
        """Principe 3 : le taux qu'un analyste a lu ne change pas rétroactivement."""
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        avant = analyse.taux_propose

        bareme = BaremeScore.objects.get(code="TAUX")
        bareme.parametres = {"grille": [{"score_min": "0", "ajustement": "9.0"}]}
        bareme.save(update_fields=["parametres"])

        analyse.refresh_from_db()
        self.assertEqual(analyse.taux_propose, avant)
        self.assertEqual(serialiser_analyse_staff(analyse)["tarification"]["tauxPropose"],
                         float(avant))

        # Une NOUVELLE analyse, elle, applique la nouvelle grille.
        nouvelle = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        self.assertEqual(float(nouvelle.taux_propose), 27.0)

    def test_le_taux_de_base_ne_derive_pas_a_chaque_reanalyse(self):
        """L'assiette est le taux de la FILIÈRE, jamais le taux proposé précédent.

        Sinon un dossier faible verrait son taux grimper de 5 points à chaque
        ré-analyse (18 → 23 → 28…) sans qu'aucune donnée n'ait changé.
        """
        a1 = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        a2 = executer_analyse(self.app, duree_mois=8, differe_mois=5,
                              taux_annuel=a1.taux_propose)
        self.assertEqual(a1.taux_propose, a2.taux_propose)

    def test_la_tarification_ne_fuit_jamais_vers_le_client(self):
        """Principe 7 : le client ne voit ni grille, ni bande, ni ajustement."""
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        resume = serialiser_analyse_resume(analyse)
        brut = str(resume)
        for interdit in ("tarification", "ajustement", "bandeScore", "tauxBase",
                         "plancher"):
            self.assertNotIn(interdit, brut)


# ── 3. `credits.scoring` : un adaptateur, pas un moteur ──────────────────────

class AdaptateurScoreResultTests(TestCase):

    def setUp(self):
        _seed()
        self.app = _app()
        _source(self.app, TOTAUX_REFERENCE)

    def test_sans_analyse_aucun_score_n_est_fabrique(self):
        """Pas d'analyse = pas de score. Et surtout : pas de clé `score` nulle.

        `credits.disbursement` fait `int(score_result.get("score", 0))` : une clé
        présente mais nulle le ferait échouer. L'ABSENCE de clé est le contrat.
        """
        resultat = CreditScoringEngine(self.app).compute()
        self.assertFalse(resultat["analyseDisponible"])
        self.assertNotIn("score", resultat)
        self.assertNotIn("proposedRate", resultat)
        self.assertFalse(resultat["eligible"])
        self.assertEqual(resultat["unavailable"]["code"], "ANALYSE_REQUISE")
        # Les consommateurs aval retombent sur leurs défauts explicites.
        self.assertEqual(int(resultat.get("score", 0)), 0)

    def test_avec_analyse_le_score_est_celui_du_moteur(self):
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        resultat = CreditScoringEngine(self.app).compute()

        self.assertTrue(resultat["analyseDisponible"])
        self.assertEqual(resultat["score"], float(analyse.score_global))
        self.assertEqual(resultat["proposedRate"], float(analyse.taux_propose))
        self.assertEqual(resultat["analyse"]["id"], analyse.pk)
        self.assertEqual(resultat["analyse"]["recommandation"], analyse.recommandation)

    def test_la_derniere_analyse_fait_foi(self):
        executer_analyse(self.app, duree_mois=8, differe_mois=5)
        recente = executer_analyse(self.app, duree_mois=12, differe_mois=0)
        resultat = CreditScoringEngine(self.app).compute()
        self.assertEqual(resultat["analyse"]["id"], recente.pk)
        self.assertEqual(len(resultat["scheduleDraft"]), 12)

    def test_la_somme_des_points_du_breakdown_fait_le_score(self):
        """Invariant CLAUDE.md §5.2, que l'ancien format ne respectait pas.

        Il servait `points = score /100` par critère et `maxPoints = 100` : la
        colonne affichée ne s'additionnait pas au total affiché.
        """
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        resultat = CreditScoringEngine(self.app).compute()
        somme = sum(Decimal(str(b["points"])) for b in resultat["breakdown"])
        self.assertEqual(somme, analyse.score_global)
        self.assertEqual(
            sum(Decimal(str(b["maxPoints"])) for b in resultat["breakdown"]),
            Decimal("100"))

    def test_nomenclature_canonique_des_criteres(self):
        """Principe 6 : plus aucun code legacy, ni ici ni ailleurs."""
        executer_analyse(self.app, duree_mois=8, differe_mois=5)
        codes = [b["code"] for b in CreditScoringEngine(self.app).compute()["breakdown"]]
        self.assertEqual(codes, ["technique", "dscr", "stress", "comportemental",
                                 "garanties"])
        for legacy in ("repayment_history", "needs_coherence", "debt_ratio",
                       "kyc_seniority", "sector_risk", "fiabilite", "behavioral",
                       "guarantees"):
            self.assertNotIn(legacy, codes)

    def test_echeancier_projete_identique_a_celui_de_l_analyse(self):
        """Une seule formule d'amortissement : celle de `credits.echeancier`."""
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        schedule = CreditScoringEngine(self.app).compute()["scheduleDraft"]
        self.assertEqual(len(schedule), len(analyse.echeancier))
        self.assertEqual(schedule[-1]["balance"], 0.0)   # CRD final nul
        self.assertEqual(
            Decimal(str(schedule[0]["interest"])),
            Decimal(analyse.echeancier[0]["interets"]))

    def test_analyse_sans_taux_ne_sert_aucun_taux(self):
        """Analyse antérieure à la grille unique : pas de taux inventé après coup."""
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        AnalyseCredit.objects.filter(pk=analyse.pk).update(taux_propose=None)
        with self.assertLogs("credits.scoring", level="WARNING"):
            resultat = CreditScoringEngine(self.app).compute()
        self.assertNotIn("proposedRate", resultat)
        self.assertIn("score", resultat)          # le score, lui, reste valable


# ── 4. Simulation indicative alignée sur le moteur ───────────────────────────

class SimulateurAligneTests(TestCase):
    """Le simulateur et l'instruction ne peuvent plus diverger sur les RÈGLES."""

    def setUp(self):
        _seed()
        self.chain = _chain()
        self.client_user = _user("sub-simulation", "Jean Simulateur")

    def _simuler(self, **kwargs):
        from credits.dataio_simulator import dataio_simulate
        params = dict(
            client=self.client_user,
            value_chain_code=self.chain.code,
            ns_totals={k: float(v) for k, v in TOTAUX_REFERENCE.items()},
            area_ha=1.0,
            amount_requested=1330.0,
        )
        params.update(kwargs)
        return dataio_simulate(**params)

    def test_les_codes_de_criteres_sont_ceux_du_moteur(self):
        codes = [b["code"] for b in self._simuler()["breakdown"]]
        self.assertEqual(codes, ["technique", "dscr", "stress", "comportemental",
                                 "garanties"])

    def test_meme_score_meme_taux_que_l_instruction(self):
        """LE test de la mission : un score donné produit UN taux, partout."""
        resultat = self._simuler()
        attendu = taux_pour_score(resultat["score"], 18.0)
        self.assertEqual(resultat["proposedRate"], attendu["taux"])
        self.assertEqual(resultat["tarification"]["ajustement"],
                         attendu["ajustement"])

    def test_le_recalibrage_de_la_grille_suit_aussi_en_simulation(self):
        """Une grille modifiée en base change le taux SIMULÉ, pas seulement le
        taux instruit — sinon la divergence renaîtrait par le haut."""
        avant = self._simuler()["proposedRate"]
        bareme = BaremeScore.objects.get(code="TAUX")
        bareme.parametres = {"grille": [{"score_min": "0", "ajustement": "7.0"}],
                             "plancher_ratio_base": "0.7"}
        bareme.save(update_fields=["parametres"])
        self.assertEqual(self._simuler()["proposedRate"], 25.0)
        self.assertNotEqual(avant, 25.0)

    def test_la_fiabilite_technique_est_celle_du_moteur(self):
        """Même référentiel, même écart moyen, même courbe → même score."""
        ref = _referentiel()
        resultat = self._simuler()
        ligne = next(b for b in resultat["breakdown"] if b["code"] == "technique")

        bloc = scorer_technique(
            {k: Decimal(v) for k, v in TOTAUX_REFERENCE.items()},
            ref, Decimal("1.00"),
            BaremeScore.objects.get(code="ECART_TECHNIQUE"), Decimal("25"), "ha")
        self.assertTrue(ligne["calculable"])
        self.assertEqual(Decimal(str(ligne["score"])), bloc["score"])
        self.assertEqual(Decimal(str(ligne["points"])), bloc["points"])

    def test_criteres_non_calculables_exclus_et_dits(self):
        """Sans référentiel : la fiabilité technique sort de la note, motif à l'appui.

        Elle n'est PAS notée 50 — un demi-score inventé déplacerait la note vers un
        faux milieu sans que personne ne sache pourquoi.
        """
        ReferentielFiliere.objects.all().delete()
        resultat = self._simuler()
        ligne = next(b for b in resultat["breakdown"] if b["code"] == "technique")
        self.assertFalse(ligne["calculable"])
        self.assertIsNone(ligne["points"])
        self.assertIn("non calculable", ligne["detail"])

    def test_la_couverture_de_la_note_est_annoncee(self):
        """Une note renormalisée le DIT : sinon elle paraît meilleure qu'elle n'est.

        Sans DSCR estimable, la simulation note sur 70 points de barème et
        renormalise : 21,4/100 là où l'instruction, capable de calculer le DSCR,
        donnera moins. L'écart vient des DONNÉES, pas des règles — encore faut-il
        que l'écran puisse le dire.
        """
        ReferentielFiliere.objects.all().delete()
        couverture = self._simuler()["scoreCouverture"]
        self.assertEqual(couverture["poidsTotal"], 100.0)
        self.assertLess(couverture["poidsCalculable"], 100.0)
        self.assertGreaterEqual(couverture["nbCriteresExclus"], 1)
        self.assertTrue(couverture["renormalise"])

    def test_la_somme_des_points_calculables_est_coherente_avec_le_score(self):
        """Renormalisation sur les poids restants — « pas de moyenne sans effectif »."""
        resultat = self._simuler()
        lignes = [b for b in resultat["breakdown"] if b["calculable"]]
        points = sum(Decimal(str(b["points"])) for b in lignes)
        poids = sum(Decimal(str(b["maxPoints"])) for b in lignes)
        attendu = (points * Decimal(100) / poids).quantize(Decimal("0.1"))
        self.assertEqual(Decimal(str(resultat["score"])), attendu)

    def test_l_echeancier_simule_solde_le_pret(self):
        """Le simulateur amortit avec `credits.echeancier` : CRD final nul.

        Sa boucle `float` laissait un solde résiduel — le client voyait un
        échéancier qui ne soldait pas son prêt.
        """
        resultat = self._simuler()
        self.assertTrue(resultat["scheduleDraft"])
        self.assertEqual(resultat["scheduleDraft"][-1]["balance"], 0.0)
        self.assertEqual(
            round(resultat["scheduleTotals"]["totalPrincipal"], 2),
            round(resultat["montantDemandeAjuste"] or 1330.0, 2))


# ── 5. Modèle « hectare » généralisé ─────────────────────────────────────────

class UniteDeReferenceTests(TestCase):

    def setUp(self):
        _seed(avec_referentiel=False)
        self.ruches = _referentiel(**REFERENTIEL_RUCHES)

    def test_quantite_et_unite_du_dossier_priment_sur_la_superficie(self):
        app = _app(area="0.00")
        app.quantite_reference = Decimal("30")
        app.unite_reference = "ruche"
        app.save(update_fields=["quantite_reference", "unite_reference"])
        quantite, unite = resoudre_quantite_reference(app, self.ruches)
        self.assertEqual(quantite, Decimal("30"))
        self.assertEqual(unite, "ruche")

    def test_un_dossier_en_hectares_ne_se_compare_pas_a_un_referentiel_en_ruches(self):
        """Le cœur du risque financier : 30 ruches ne sont pas 30 hectares.

        Le refus est explicite et structuré — jamais une multiplication muette
        qui produirait un coût de référence faux d'un facteur arbitraire.
        """
        app = _app(area="5.00")
        with self.assertRaises(DimensionIncoherente) as ctx:
            resoudre_quantite_reference(app, self.ruches)
        self.assertEqual(ctx.exception.code, "DIMENSION_INCOHERENTE")
        self.assertIn("ruche", str(ctx.exception))
        self.assertEqual(ctx.exception.as_errors()[0]["code"], "DIMENSION_INCOHERENTE")

    def test_unites_differentes_declarees_refusees(self):
        app = _app(area="0.00")
        app.quantite_reference = Decimal("100")
        app.unite_reference = "m2"
        app.save(update_fields=["quantite_reference", "unite_reference"])
        with self.assertRaises(DimensionIncoherente):
            resoudre_quantite_reference(app, self.ruches)

    def test_l_analyse_refuse_un_dossier_mal_dimensionne(self):
        """Bout en bout : le refus remonte du moteur, pas d'un score de 0."""
        chain = _chain(code="08", label="Apiculture — Miel toutes fleurs")
        app = _app(chain=False, area="5.00")
        app.value_chain = chain
        app.save(update_fields=["value_chain"])
        _source(app, TOTAUX_REFERENCE)
        with self.assertRaises(DimensionIncoherente):
            executer_analyse(app, duree_mois=12, differe_mois=6)
        self.assertEqual(AnalyseCredit.objects.filter(application=app).count(), 0)

    def test_scoring_technique_par_ruche_cas_chiffre(self):
        """30 ruches × 40 USD/ruche = 1 200 USD d'équipement attendus.

        Le plan en déclare 1 100 → écart −8,3 %, dans la tolérance de 40 %.
        Main-d'œuvre : 30 × 20 = 600 attendus, 300 déclarés → −50 %, HORS
        tolérance de 30 %. Écart moyen |−0,083| + |−0,500| ÷ 2 = 0,292.
        """
        bloc = scorer_technique(
            {"equipements": Decimal("1100"), "maindoeuvre": Decimal("300")},
            self.ruches, Decimal("30"),
            BaremeScore.objects.get(code="ECART_TECHNIQUE"), Decimal("25"), "ruche")

        details = bloc["details"]
        self.assertEqual(details["totalReferentiel"], 1800.0)   # 1 200 + 600
        self.assertEqual(details["uniteReference"], "ruche")
        self.assertEqual(details["quantiteReference"], 30.0)
        # `superficieHa` reste nul hors filières en hectares : afficher « 30 ha »
        # pour 30 ruches tromperait l'analyste.
        self.assertIsNone(details["superficieHa"])
        self.assertEqual(details["ecartMoyenPct"], 29.2)
        self.assertEqual([e["module"] for e in bloc["hors_plage"]], ["maindoeuvre"])

    def test_cash_flows_projetes_par_unite_de_reference(self):
        """0,008 t de miel par ruche × 8 000 USD/t × 30 ruches = 1 920 USD."""
        flux, hypothese = projeter_cash_flows(
            self.ruches, Decimal("30"), Decimal("1400"), 12, 6, "ruche")
        self.assertEqual(hypothese["revenuBrut"], 1920.0)
        self.assertEqual(hypothese["margeNetteCycle"], 520.0)
        self.assertEqual(hypothese["uniteReference"], "ruche")
        self.assertIsNone(hypothese["superficieHa"])
        self.assertEqual(len(flux), 12)
        self.assertEqual(sum(flux[:6]), Decimal("0"))       # rien avant la récolte

    def test_dimension_absente_est_dite_et_non_devinee(self):
        bloc = scorer_technique(
            {"equipements": Decimal("1100")}, self.ruches, None,
            BaremeScore.objects.get(code="ECART_TECHNIQUE"), Decimal("25"), "ruche")
        self.assertEqual(bloc["score"], Decimal("0.0"))
        self.assertIn("ruche", bloc["details"]["commentaire"])
        self.assertIsNone(bloc["details"]["quantiteReference"])

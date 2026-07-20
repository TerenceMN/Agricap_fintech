"""
Tests du moteur d'analyse technico-économique (SPEC Moteur).

Hiérarchie d'exigence de CLAUDE.md §5 :
  1. non-régression financière — le cas de référence de la SPEC §2 ;
  2. propriétés invariantes — Σ points = score global, Σ poids = 100, CRD final = 0 ;
  3. permissions — chaque route, autorisée ET interdite ;
  4. anti-gaming — un test qui ÉCHOUE si `analyse-resume` laisse fuir un barème,
     un seuil, une tolérance ou une plage du référentiel.

Écart documenté et verrouillé ici : les scores DSCR 19,1 et stress 14,3 de
l'exemple de la SPEC §2 ne se déduisent PAS des barèmes de sa propre §5, qui
donnent 19,7 et 6,4 pour DSCR 0,636 / 0,477. Le cas de référence est donc testé
au niveau où la mission le pose — l'agrégation des cinq scores — et l'écart de
barème est testé explicitement pour qu'il reste visible.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from common.testing import AuthedAPITestCase
from credits.analyse import (
    CRITERES,
    POIDS_DEFAUT,
    AnalyseError,
    BaremeAbsent,
    ReferentielAbsent,
    SourceBesoinsAbsente,
    _points,
    calculer_dscr,
    charger_baremes,
    executer_analyse,
    justifier_indicateur,
    poids_effectifs,
    projeter_cash_flows,
    recommander,
    score_lettre,
    scorer_comportemental,
    scorer_garanties,
    scorer_technique,
    serialiser_analyse_resume,
    serialiser_analyse_staff,
)
from credits.echeancier import construire_echeancier, totaux_echeancier
from credits.models import (
    AnalyseCredit,
    BaremeScore,
    CreditApplication,
    ImmutableAnalyse,
    ReferentielFiliere,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

_SEQ = {"n": 0}


#: Référentiel de TEST — valeurs choisies pour exercer les branches de tolérance,
#: PAS une reproduction du classeur maïs réel.
#:
#: `seed_analyse` ne crée plus de référentiel écrit à la main : il les lit dans
#: les simulateurs ingérés (`credits.referentiel_loader`), correctif juste d'un
#: défaut que j'avais signalé — mes coûts par module étaient répartis à la main
#: pour retomber sur un total, avec un facteur 6,7 sur les semences.
#:
#: Conséquence pour les tests : sans classeur simulateur ingéré, la commande ne
#: seede aucun référentiel — c'est délibéré (on n'invente pas ce qui manque).
#: Les tests du moteur fabriquent donc le leur. Ils testent le MOTEUR, pas le
#: chargement du référentiel : la couverture du loader appartient à son lot.
REFERENTIEL_TEST = {
    "code": "AGRICAP_FIN_SIM_01_Cereales_Mais",
    "filiere": "Céréales — Maïs",
    "value_chain_code": "01",
    "unite_reference": "ha",
    "devise": "USD",
    "couts_modules": {
        # 600 déclarés vs 850 → −29,4 %, DANS la tolérance de 30 %.
        "semences":          {"ref": "850",  "tol_inf": "0.30", "tol_sup": "0.40"},
        # 450 déclarés vs 1 200 → −62,5 %, HORS tolérance.
        "mecanisation":      {"ref": "1200", "tol_inf": "0.30", "tol_sup": "0.40"},
        "maindoeuvre":       {"ref": "1450", "tol_inf": "0.30", "tol_sup": "0.40"},
        "equipements":       {"ref": "1100", "tol_inf": "0.40", "tol_sup": "0.40"},
        "postrecolte":       {"ref": "1350", "tol_inf": "0.30", "tol_sup": "0.40"},
        "logistique":        {"ref": "1000", "tol_inf": "0.30", "tol_sup": "0.40"},
        "commercialisation": {"ref": "1150", "tol_inf": "0.30", "tol_sup": "0.40"},
        "reserve":           {"ref": "1011", "tol_inf": "0.50", "tol_sup": "0.40"},
    },
    "rendement_ref": {"qte_unite": "4.5", "prix_unitaire": "380", "unite": "t"},
    "n_cas_reels": 0,
    "source": ReferentielFiliere.Source.INDICATIF,
}


def _referentiel(**overrides):
    """Référentiel filière de test, indépendant de tout classeur ingéré."""
    donnees = {**REFERENTIEL_TEST, **overrides}
    ref, _ = ReferentielFiliere.objects.update_or_create(
        code=donnees.pop("code"), defaults={**donnees, "actif": True})
    return ref


def _seed(avec_referentiel: bool = True):
    """Barèmes via la commande (leur seule source), référentiel via la fixture."""
    from django.core.management import call_command
    call_command("seed_analyse", verbosity=0)
    if avec_referentiel:
        _referentiel()


def _user(sub: str, name: str = ""):
    from accounts.models import FintechUser
    user, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": name or sub, "phone": f"+243{sub[-9:].zfill(9)}"},
    )
    return user


def _chain(code: str = "01", label: str = "Céréales — Maïs"):
    from reference_data.models import ReferenceFileUpload, ValueChain
    upload = ReferenceFileUpload.objects.first() or ReferenceFileUpload.objects.create(
        file_type=ReferenceFileUpload.FileType.VALUE_CHAINS,
        uploaded_by="sub-test", status=ReferenceFileUpload.Status.ACTIVE,
    )
    chain, _ = ValueChain.objects.get_or_create(
        code=code,
        defaults={
            "label": label, "source_file": upload, "cycle_months": 8,
            "cost_per_hectare_usd": Decimal("9111"), "cost_per_hectare_cdf": Decimal("0"),
            "module_weights": {}, "risk_factor": Decimal("0.3"),
            "min_score_required": 50, "base_rate": Decimal("18.00"),
            "harvest_months": [6], "eligible_guarantees": ["epargne", "morale"],
        },
    )
    return chain


def _source(app, totaux: dict, revision: int = 1, sha: str = "a" * 64):
    """`DataSource` COMMITTED avec la feuille 5 ingérée en `DataRecord`.

    On écrit de vraies lignes plutôt que de mocker `extract_module_totals` :
    c'est précisément le chemin « ce qui est scoré = ce qui est en base » que le
    principe 1 exige, et le mocker reviendrait à ne pas le tester.
    """
    from credits.needs_sheet import MODULE_LABELS, SHEET_SYNTHESE
    from dataio.models import (
        KIND_FEUILLE_BESOINS, STATUS_COMMITTED, DataColumn, DataRecord,
        DataSource, DataTable,
    )

    _SEQ["n"] += 1
    source = DataSource.objects.create(
        original_name=f"fb-{_SEQ['n']}.xlsx", dataset_key=f"fb__{app.code}",
        credit_application=app, kind=KIND_FEUILLE_BESOINS,
        status=STATUS_COMMITTED, sha256=sha, revision=revision, is_current=True,
    )
    table = DataTable.objects.create(source=source, name=SHEET_SYNTHESE, position=0)
    DataColumn.objects.create(table=table, name="Rubrique", position=0)
    DataColumn.objects.create(table=table, name="Total rubrique", position=1)
    for i, (module, montant) in enumerate(totaux.items()):
        DataRecord.objects.create(
            table=table, row_index=i,
            values={"Rubrique": MODULE_LABELS[module], "Total rubrique": str(montant)},
        )
    app.needs_source = source
    app.save(update_fields=["needs_source", "updated_at"])
    return source


def _app(client_user=None, montant: str = "1330", area: str = "1.00", chain=True):
    _SEQ["n"] += 1
    return CreditApplication.objects.create(
        code=f"CRED-TEST-ANA-{_SEQ['n']:04d}",
        client=client_user or _user("sub-analyse-client", "Marie Kabemba"),
        value_chain=_chain() if chain else None,
        area_ha=Decimal(area), amount_requested=Decimal(montant), currency="USD",
        status=CreditApplication.Status.IN_ANALYSIS,
    )


#: Feuille du cas de référence : 1 330 USD au total, très en dessous du
#: référentiel maïs (9 111 USD/ha) — c'est ce qui produit le score technique de 0.
TOTAUX_REFERENCE = {
    "semences": "600", "mecanisation": "450", "maindoeuvre": "280",
    "equipements": "0", "postrecolte": "0", "logistique": "0",
    "commercialisation": "0", "reserve": "0",
}


# ── 1. Cas de référence (SPEC §2) ────────────────────────────────────────────

class CasDeReferenceTests(TestCase):
    """Le cas chiffré de la SPEC §2 — bloque le merge s'il dérive (CLAUDE.md §5)."""

    def setUp(self):
        _seed()
        self.poids = dict(POIDS_DEFAUT)

    def test_agregation_du_cas_de_reference(self):
        """0 · 19,1 · 14,3 · 50 · 60 → 29,2/100 et « refus ».

        C'est l'assemblage exact du tableau de la SPEC §2, points compris.
        """
        scores = {
            "technique": Decimal("0.0"), "dscr": Decimal("19.1"),
            "stress": Decimal("14.3"), "comportemental": Decimal("50.0"),
            "garanties": Decimal("60.0"),
        }
        points = {k: _points(v, self.poids[k]) for k, v in scores.items()}

        self.assertEqual(points["technique"], Decimal("0.0"))
        self.assertEqual(points["dscr"], Decimal("3.8"))
        self.assertEqual(points["stress"], Decimal("1.4"))
        self.assertEqual(points["comportemental"], Decimal("15.0"))
        self.assertEqual(points["garanties"], Decimal("9.0"))

        score_global = sum(points.values(), Decimal("0"))
        self.assertEqual(score_global, Decimal("29.2"))
        self.assertEqual(
            recommander(score_global, Decimal("0.636"), hors_plage=[]), "refus")

    def test_arrondi_critere_par_critere_et_non_a_la_fin(self):
        """29,25 arrondi à la fin donnerait 29,3 — la SPEC annonce 29,2.

        La différence n'est pas cosmétique : c'est la colonne « points » que
        l'analyste additionne de tête à l'écran. Un total qui ne tombe pas juste
        détruit la confiance dans tout le tableau.
        """
        brut = (Decimal("19.1") * Decimal("20") + Decimal("14.3") * Decimal("10")
                + Decimal("50") * Decimal("30") + Decimal("60") * Decimal("15")) / 100
        self.assertEqual(brut, Decimal("29.25"))  # arrondi HALF_UP → 29,3
        self.assertEqual(
            sum((_points(s, p) for s, p in [
                (Decimal("0"), Decimal("25")), (Decimal("19.1"), Decimal("20")),
                (Decimal("14.3"), Decimal("10")), (Decimal("50"), Decimal("30")),
                (Decimal("60"), Decimal("15"))]), Decimal("0")),
            Decimal("29.2"))

    def test_echeancier_du_cas_de_reference(self):
        """1 330 USD / 18 % / 8 mois / différé 5 → service de dette 1 469,65."""
        lignes = construire_echeancier(Decimal("1330"), Decimal("18"), 8, 5)
        totaux = totaux_echeancier(lignes)
        self.assertEqual(totaux["service_dette"], Decimal("1469.65"))
        self.assertEqual(totaux["interets_payes"], Decimal("139.65"))
        self.assertEqual(totaux["crd_final"], Decimal("0.00"))

    def test_dscr_du_cas_de_reference(self):
        """Cash-flows 935 sur un service de 1 469,65 → DSCR 0,636."""
        lignes = construire_echeancier(Decimal("1330"), Decimal("18"), 8, 5)
        flux = [Decimal("935") / Decimal(8)] * 8
        self.assertEqual(calculer_dscr(flux, lignes), Decimal("0.636"))

    def test_franchise_totale_reproduit_l_annexe_A2(self):
        """Mode `franchise_totale` — SPEC annexe A.2, au centime.

        Ce mode n'avait AUCUN test alors qu'il est atteignable par l'API
        (`POST /reanalyser/` accepte `mode_differe`). Écrit une fois, jamais
        gardé : c'est la catégorie de code qui casse sans que rien ne rougisse.

        Le piège propre à ce mode est que le capital à amortir n'est plus `C`
        mais le CRD gonflé des intérêts capitalisés — le pseudo-code de la SPEC
        §4, qui calcule la tranche avant le différé, ne solderait pas le prêt.
        """
        lignes = construire_echeancier(
            Decimal("1330"), Decimal("18"), 8, 5, "franchise_totale")

        # Fin de différé : le capital a grossi des intérêts capitalisés.
        self.assertEqual(lignes[4]["crd"], Decimal("1432.78"))
        self.assertEqual(lignes[4]["echeance"], Decimal("0.00"))   # rien n'est payé
        self.assertEqual(lignes[4]["interets"], Decimal("0.00"))
        self.assertEqual(lignes[4]["interets_capitalises"], Decimal("21.17"))

        # Tranche calculée sur le CRD gonflé : 1 432,78 / 3 = 477,59.
        self.assertEqual(lignes[5]["capital"], Decimal("477.59"))

        totaux = totaux_echeancier(lignes)
        self.assertEqual(totaux["service_dette"], Decimal("1475.76"))
        self.assertEqual(totaux["interets_capitalises"], Decimal("102.78"))
        self.assertEqual(totaux["crd_final"], Decimal("0.00"))

    def test_franchise_degrade_le_dscr_davantage_que_les_interets_seuls(self):
        """SPEC A.2 : « la franchise totale ne doit être proposée que si les
        cash-flows sont strictement nuls avant récolte ». Le service passe de
        1 469,65 à 1 475,76 — à cash-flows égaux, le DSCR baisse."""
        flux = [Decimal("935") / Decimal(8)] * 8
        interets = construire_echeancier(Decimal("1330"), Decimal("18"), 8, 5)
        franchise = construire_echeancier(
            Decimal("1330"), Decimal("18"), 8, 5, "franchise_totale")
        self.assertLess(calculer_dscr(flux, franchise), calculer_dscr(flux, interets))

    def test_ecart_documente_entre_les_scores_et_les_baremes_de_la_spec(self):
        """⚠ Les barèmes de la SPEC §5 NE produisent PAS 19,1 et 14,3.

        Pour DSCR 0,636 la courbe `0.4→0 · 0.7→25` donne 19,7 ; pour le DSCR
        stressé 0,477 elle donne 6,4. Ce test fige l'écart au lieu de le masquer
        en recalibrant la courbe pour retomber sur les chiffres de l'exemple :
        un barème tordu pour reproduire une illustration serait un barème faux
        pour tous les autres dossiers.
        """
        dscr_bareme = BaremeScore.objects.get(code="DSCR")
        self.assertEqual(dscr_bareme.evaluer(Decimal("0.636")), Decimal("19.7"))
        self.assertEqual(dscr_bareme.evaluer(Decimal("0.477")), Decimal("6.4"))


# ── 2. Invariants ─────────────────────────────────────────────────────────────

class InvariantsTests(TestCase):

    def setUp(self):
        _seed()

    def test_somme_des_poids_vaut_cent(self):
        self.assertEqual(sum(poids_effectifs().values()), Decimal("100"))
        self.assertEqual(sum(POIDS_DEFAUT.values()), Decimal("100"))

    def test_poids_incoherents_repliés_avec_warning(self):
        """Une pondération qui ne somme pas à 100 rendrait le score inintelligible."""
        from referentiel.models import InstitutionConfig
        InstitutionConfig.objects.all().delete()
        InstitutionConfig.objects.create(is_active=True, poids_technique=40.0)
        with self.assertLogs("credits.analyse", level="WARNING") as logs:
            poids = poids_effectifs()
        self.assertEqual(poids, POIDS_DEFAUT)
        self.assertTrue(any("100" in m for m in logs.output))

    def test_somme_des_points_egale_le_score_global(self):
        app = _app()
        _source(app, TOTAUX_REFERENCE)
        analyse = executer_analyse(app, duree_mois=8, differe_mois=5,
                                   taux_annuel=Decimal("18"))
        somme = sum((Decimal(str(c["points"])) for c in analyse.criteres.values()),
                    Decimal("0"))
        self.assertEqual(somme, analyse.score_global)

    def test_les_cinq_criteres_sont_toujours_presents(self):
        app = _app()
        _source(app, TOTAUX_REFERENCE)
        analyse = executer_analyse(app, duree_mois=8, differe_mois=5)
        self.assertEqual(set(analyse.criteres), set(CRITERES))

    def test_crd_final_nul_sur_l_echeancier_stocke(self):
        app = _app()
        _source(app, TOTAUX_REFERENCE)
        analyse = executer_analyse(app, duree_mois=8, differe_mois=5)
        self.assertEqual(Decimal(analyse.echeancier[-1]["crd"]), Decimal("0.00"))

    def test_aucun_float_dans_les_montants_de_l_echeancier_stocke(self):
        """Les montants stockés restent des chaînes décimales (principe 4)."""
        app = _app()
        _source(app, TOTAUX_REFERENCE)
        analyse = executer_analyse(app, duree_mois=8, differe_mois=5)
        for ligne in analyse.echeancier:
            for cle in ("capital", "interets", "echeance", "crd"):
                self.assertIsInstance(ligne[cle], str, f"{cle} sérialisé en {type(ligne[cle])}")


# ── 3. Scoreurs ───────────────────────────────────────────────────────────────

class ScoreursTests(TestCase):

    def setUp(self):
        _seed()
        self.baremes = charger_baremes()
        self.ref = ReferentielFiliere.objects.get(code="AGRICAP_FIN_SIM_01_Cereales_Mais")

    def test_technique_plan_tres_inferieur_au_referentiel(self):
        totaux = {k: Decimal(v) for k, v in TOTAUX_REFERENCE.items()}
        res = scorer_technique(totaux, self.ref, Decimal("1"),
                               self.baremes["ECART_TECHNIQUE"], Decimal("25"))
        self.assertEqual(res["score"], Decimal("0.0"))
        self.assertEqual(res["points"], Decimal("0.0"))
        indicateurs = {h["indicateur"] for h in res["hors_plage"]}
        # −100 % : rien n'est prévu pour ces postes sur un cycle maïs complet.
        self.assertIn("cout_module:equipements", indicateurs)
        # 450 vs 1 200 = −62,5 %, hors de la tolérance basse de 30 %.
        self.assertIn("cout_module:mecanisation", indicateurs)
        # 600 vs 850 = −29,4 %, DANS la tolérance : un écart toléré n'ouvre pas
        # de canal de justification, sinon l'analyste en traiterait huit à chaque
        # dossier et n'en lirait plus aucun.
        self.assertNotIn("cout_module:semences", indicateurs)
        self.assertIn("indicatif", res["details"]["commentaire"])

    def test_technique_sans_superficie_ne_compare_rien(self):
        """Comparer un plan à un référentiel de 0 produirait un écart de fiction."""
        res = scorer_technique({}, self.ref, None,
                               self.baremes["ECART_TECHNIQUE"], Decimal("25"))
        self.assertEqual(res["hors_plage"], [])
        self.assertIn("pas calculable", res["details"]["commentaire"])

    def test_comportemental_neutre_avec_mention_explicite(self):
        """50/100 sans historique — et la mention est un CHAMP, pas une phrase."""
        res = scorer_comportemental(_user("sub-sans-historique"), None, Decimal("30"))
        self.assertEqual(res["score"], Decimal("50.0"))
        self.assertEqual(res["points"], Decimal("15.0"))
        self.assertIs(res["details"]["historiqueDisponible"], False)
        self.assertIn("non disponible", res["details"]["commentaire"])

    # ── C4 avec historique — branche longtemps NON TESTÉE ────────────────────
    #
    # Elle était classée « pas calibrable faute de dossier réel ». C'est vrai des
    # COEFFICIENTS (60 % taux de remboursement / 40 % part soldée / −20 par
    # incident), qui appellent une décision du comité. Ce n'est pas vrai du
    # CHEMIN DE CODE : rien n'empêchait de vérifier qu'il s'exécute et produit
    # des valeurs sensées. « Non calibrable » et « non vérifié » avaient été
    # confondus, sur le critère qui pèse 30 % du score.

    def _pret(self, user, *, approuve: str, rembourse: str, statut):
        from portfolio.models import Loan, LoanTransaction
        _SEQ["n"] += 1
        pret = Loan.objects.create(
            reference=f"CRD-TEST-{_SEQ['n']:04d}", operator=user.full_name,
            borrower_sub=str(user.pk), amount_approved=Decimal(approuve),
            status=statut,
        )
        LoanTransaction.objects.create(
            loan=pret, kind=LoanTransaction.Kind.DISBURSEMENT,
            amount=Decimal(approuve))
        if Decimal(rembourse) > 0:
            LoanTransaction.objects.create(
                loan=pret, kind=LoanTransaction.Kind.REPAYMENT,
                amount=-Decimal(rembourse))
        return pret

    def test_comportemental_credit_solde_integralement(self):
        from portfolio.models import Loan
        user = _user("sub-bon-payeur", "Bon Payeur")
        self._pret(user, approuve="1000", rembourse="1000", statut=Loan.Status.CLOTURE)

        res = scorer_comportemental(user, None, Decimal("30"))
        self.assertIs(res["details"]["historiqueDisponible"], True)
        self.assertEqual(res["details"]["nbCredits"], 1)
        self.assertEqual(res["details"]["nbClotures"], 1)
        self.assertEqual(res["details"]["nbDefauts"], 0)
        self.assertEqual(res["details"]["tauxRemboursement"], 1.0)
        # 1,0 × 60 + 1,0 × 40 = 100, aucun incident.
        self.assertEqual(res["score"], Decimal("100.0"))
        self.assertEqual(res["points"], Decimal("30.0"))

    def test_comportemental_defaut_penalise_et_reste_dans_les_bornes(self):
        from portfolio.models import Loan
        user = _user("sub-defaut", "Mauvais Payeur")
        self._pret(user, approuve="1000", rembourse="100", statut=Loan.Status.DEFAUT)

        res = scorer_comportemental(user, None, Decimal("30"))
        self.assertIs(res["details"]["historiqueDisponible"], True)
        self.assertEqual(res["details"]["nbDefauts"], 1)
        # 0,1 × 60 + 0 × 40 − 20 = −14 → borné à 0, jamais négatif : un score
        # négatif ferait baisser le total en dessous de la somme des autres
        # critères et casserait l'invariant Σ points = score global.
        self.assertEqual(res["score"], Decimal("0.0"))
        self.assertEqual(res["points"], Decimal("0.0"))

    def test_comportemental_borne_haute_meme_si_surrembourse(self):
        """Un remboursement supérieur au capital (pénalités, frais) ne dépasse pas 100."""
        from portfolio.models import Loan
        user = _user("sub-surpaye", "Sur Payeur")
        self._pret(user, approuve="1000", rembourse="1400", statut=Loan.Status.CLOTURE)
        res = scorer_comportemental(user, None, Decimal("30"))
        self.assertLessEqual(res["score"], Decimal("100.0"))
        self.assertEqual(res["points"], Decimal("30.0"))

    def test_comportemental_historique_d_un_autre_client_n_est_pas_lu(self):
        """Le rapprochement se fait sur `borrower_sub` — pas de fuite entre clients."""
        from portfolio.models import Loan
        autre = _user("sub-voisin", "Voisin")
        self._pret(autre, approuve="1000", rembourse="1000", statut=Loan.Status.CLOTURE)

        vierge = _user("sub-sans-rien", "Sans Historique")
        res = scorer_comportemental(vierge, None, Decimal("30"))
        self.assertIs(res["details"]["historiqueDisponible"], False)
        self.assertEqual(res["score"], Decimal("50.0"))

    def test_garanties_sans_garantie_plafonnees(self):
        app = _app()
        res = scorer_garanties(app, self.baremes["COUVERTURE_GARANTIES"], Decimal("15"))
        self.assertLessEqual(res["score"], Decimal("60"))
        self.assertIs(res["details"]["constituees"], False)

    def test_garanties_utilisent_la_valeur_retenue_apres_decote(self):
        """Jamais la valeur déclarée (principe 9)."""
        from credits.models import CreditGuarantee
        app = _app(montant="1000")
        CreditGuarantee.objects.create(
            application=app, guarantee_type=CreditGuarantee.GuaranteeType.EPARGNE,
            status=CreditGuarantee.Status.ACTIVE, covered_amount=Decimal("500"),
        )
        res = scorer_garanties(app, self.baremes["COUVERTURE_GARANTIES"], Decimal("15"))
        self.assertEqual(Decimal(str(res["details"]["couvertureRetenue"])), Decimal("500"))
        self.assertEqual(Decimal(str(res["details"]["ratioCouverture"])), Decimal("0.5"))
        self.assertIs(res["details"]["constituees"], True)

    def test_projection_cash_flows_sans_rendement_est_annoncee(self):
        ref = ReferentielFiliere.objects.create(
            code="SANS_RENDEMENT", filiere="Test", couts_modules={}, rendement_ref={})
        flux, hypothese = projeter_cash_flows(ref, Decimal("1"), Decimal("100"), 8, 5)
        self.assertEqual(sum(flux), Decimal("0"))
        self.assertIn("ne porte pas de rendement", hypothese["commentaire"])


# ── 4. Recommandation — le moteur recommande, l'humain décide ────────────────

class RecommandationTests(TestCase):

    def test_dscr_sous_un_n_approuve_jamais(self):
        """Règle de sûreté prioritaire sur le score (SPEC §4, principe 2).

        Le cas dangereux : un score de 100 porté par un historique parfait
        (30 % du total) sur un dossier qui ne dégage pas de quoi payer.
        """
        for score in (Decimal("100"), Decimal("80"), Decimal("60")):
            for dscr in (Decimal("0.99"), Decimal("0.5"), Decimal("0")):
                reco = recommander(score, dscr, hors_plage=[])
                self.assertNotIn(reco, ("approbation", "approbation_cond"),
                                 f"score={score} dscr={dscr} → {reco}")

    def test_approbation_exige_score_dscr_et_aucun_ecart(self):
        self.assertEqual(
            recommander(Decimal("80"), Decimal("1.3"), []), "approbation")
        # Un seul écart hors plage suffit à faire retomber en conditionnelle.
        self.assertEqual(
            recommander(Decimal("80"), Decimal("1.3"), [{"indicateur": "x"}]),
            "approbation_cond")

    def test_quatre_niveaux(self):
        self.assertEqual(recommander(Decimal("65"), Decimal("1.1"), []), "approbation_cond")
        self.assertEqual(recommander(Decimal("50"), Decimal("1.5"), []), "revue")
        self.assertEqual(recommander(Decimal("20"), Decimal("1.5"), []), "refus")

    def test_lettre_de_score(self):
        for score, lettre in [("90", "A"), ("85", "B"), ("75", "B"),
                              ("70", "C"), ("60", "C"), ("50", "D"), ("0", "D")]:
            self.assertEqual(score_lettre(Decimal(score)), lettre, score)

    def test_analyse_ne_change_pas_le_statut_du_dossier(self):
        """Le moteur ne déclenche AUCUNE transition (principe 2)."""
        _seed()
        app = _app()
        _source(app, TOTAUX_REFERENCE)
        executer_analyse(app, duree_mois=8, differe_mois=5)
        app.refresh_from_db()
        self.assertEqual(app.status, CreditApplication.Status.IN_ANALYSIS)


# ── 5. Immuabilité et lignage (principe 3) ───────────────────────────────────

class ImmuabiliteTests(TestCase):

    def setUp(self):
        _seed()
        self.app = _app()
        self.source = _source(self.app, TOTAUX_REFERENCE)

    def test_reanalyse_cree_une_ligne_et_n_en_modifie_aucune(self):
        a1 = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        a2 = executer_analyse(self.app, duree_mois=8, differe_mois=2)
        self.assertNotEqual(a1.pk, a2.pk)
        self.assertEqual(AnalyseCredit.objects.filter(application=self.app).count(), 2)
        a1.refresh_from_db()
        self.assertEqual(a1.differe_mois, 5)

    def test_modification_d_une_analyse_refusee(self):
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        relue = AnalyseCredit.objects.get(pk=analyse.pk)
        relue.score_global = Decimal("99.9")
        with self.assertRaises(ImmutableAnalyse):
            relue.save()

    def test_justification_append_only(self):
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        indicateur = analyse.indicateurs_hors_plage[0]["indicateur"]
        justifier_indicateur(analyse, indicateur=indicateur,
                             justification="Semences fournies par la coopérative.",
                             agent="sub-agent")
        analyse.refresh_from_db()
        self.assertEqual(len(analyse.justifications), 1)

        relue = AnalyseCredit.objects.get(pk=analyse.pk)
        relue.justifications = []
        with self.assertRaises(ImmutableAnalyse):
            relue.save()

    def test_justification_d_un_indicateur_inconnu_refusee(self):
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        with self.assertRaises(AnalyseError) as ctx:
            justifier_indicateur(analyse, indicateur="cout_module:inexistant",
                                 justification="…", agent="sub-agent")
        self.assertEqual(ctx.exception.as_errors()[0]["code"], "INDICATEUR_INCONNU")

    def test_lignage_fige_pour_comparer_deux_analyses(self):
        """`needs_source + revision + sha256` : sans eux, un écart entre deux
        analyses ne dirait pas si c'est le moteur ou le fichier qui a bougé."""
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        self.assertEqual(analyse.needs_source_id, self.source.pk)
        self.assertEqual(analyse.needs_source_revision, self.source.revision)
        self.assertEqual(analyse.needs_source_sha256, self.source.sha256)

    def test_execution_journalisee(self):
        from audit.models import AuditEntry
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5,
                                   execute_par="sub-analyste")
        entree = AuditEntry.objects.filter(
            action="credits.analyse.execute", entity_id=str(analyse.pk)).first()
        self.assertIsNotNone(entree)
        self.assertEqual(entree.details["applicationCode"], self.app.code)
        self.assertEqual(entree.details["needsSourceSha256"], self.source.sha256)

    def test_justification_journalisee(self):
        from audit.models import AuditEntry
        analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)
        indicateur = analyse.indicateurs_hors_plage[0]["indicateur"]
        justifier_indicateur(analyse, indicateur=indicateur,
                             justification="Justification.", agent="sub-agent")
        self.assertTrue(AuditEntry.objects.filter(
            action="credits.analyse.justifier", entity_id=str(analyse.pk)).exists())


# ── 6. Refus explicites plutôt que « best effort » ───────────────────────────

class RefusExplicitesTests(TestCase):

    def test_sans_feuille_de_besoins(self):
        _seed()
        app = _app()
        with self.assertRaises(SourceBesoinsAbsente) as ctx:
            executer_analyse(app, duree_mois=8)
        self.assertEqual(ctx.exception.code, "SOURCE_BESOINS_ABSENTE")

    def test_sans_referentiel_actif(self):
        _seed()
        ReferentielFiliere.objects.update(actif=False)
        app = _app()
        _source(app, TOTAUX_REFERENCE)
        with self.assertRaises(ReferentielAbsent):
            executer_analyse(app, duree_mois=8)

    def test_sans_bareme(self):
        _seed()
        BaremeScore.objects.filter(code="DSCR").delete()
        app = _app()
        _source(app, TOTAUX_REFERENCE)
        with self.assertRaises(BaremeAbsent) as ctx:
            executer_analyse(app, duree_mois=8)
        self.assertEqual(ctx.exception.as_errors()[0]["code"], "BAREME_ABSENT")


# ── 7. Commande de seed ───────────────────────────────────────────────────────

class SeedTests(TestCase):

    def test_idempotente(self):
        _seed()
        _seed()
        self.assertEqual(BaremeScore.objects.filter(code="DSCR").count(), 1)
        self.assertEqual(
            ReferentielFiliere.objects.filter(
                code="AGRICAP_FIN_SIM_01_Cereales_Mais").count(), 1)

    def test_sans_simulateur_ingere_aucun_referentiel_n_est_invente(self):
        """La commande ne fabrique plus de référentiel de repli — et c'est voulu.

        Elle les lit dans les simulateurs ingérés (`referentiel_loader`). Sans
        classeur en base, elle seede les barèmes et s'arrête là. Un référentiel
        deviné scorerait 25 % du dossier contre des chiffres que personne n'a
        validés — c'est ce défaut qui a été corrigé, et ce test empêche qu'il
        revienne par la porte d'un « repli pratique ».
        """
        from django.core.management import call_command
        call_command("seed_analyse", verbosity=0)
        self.assertEqual(BaremeScore.objects.filter(actif=True).count(), 4)
        self.assertEqual(ReferentielFiliere.objects.count(), 0)

    def test_le_moteur_refuse_d_analyser_sans_referentiel(self):
        """Conséquence directe : pas de simulateur ingéré = pas d'analyse.

        Le refus est explicite (`REFERENTIEL_ABSENT`, 422) et non un score
        technique de 0 — un refus de crédit fabriqué par une configuration
        manquante ne doit jamais ressembler à un refus mérité.
        """
        _seed(avec_referentiel=False)
        app = _app()
        _source(app, TOTAUX_REFERENCE)
        with self.assertRaises(ReferentielAbsent) as ctx:
            executer_analyse(app, duree_mois=8, differe_mois=5)
        self.assertEqual(ctx.exception.code, "REFERENTIEL_ABSENT")

    def test_ne_reecrit_pas_un_recalibrage_du_comite(self):
        _seed()
        bareme = BaremeScore.objects.get(code="DSCR")
        bareme.points = [{"x": "0.0", "y": "0"}, {"x": "2.0", "y": "100"}]
        bareme.save()
        _seed()
        bareme.refresh_from_db()
        self.assertEqual(bareme.points[-1]["x"], "2.0")

    def test_les_trois_baremes_de_la_spec_sont_seedes(self):
        _seed()
        codes = set(BaremeScore.objects.values_list("code", flat=True))
        self.assertTrue({"DSCR", "ECART_TECHNIQUE", "COUVERTURE_GARANTIES"} <= codes)


# ── 8. API — permissions et contrat ──────────────────────────────────────────

class ApiAnalyseTests(AuthedAPITestCase):

    def setUp(self):
        _seed()
        self.client_user = _user("sub-api-client-analyse", "Marie Kabemba")
        self.app = _app(self.client_user)
        _source(self.app, TOTAUX_REFERENCE)
        self.analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5,
                                        taux_annuel=Decimal("18"))
        self.url = f"/api/credits/applications/{self.app.code}/analyse/"
        self.url_resume = f"/api/credits/applications/{self.app.code}/analyse-resume/"
        self.url_justifier = f"/api/credits/applications/{self.app.code}/analyse/justifier/"
        self.url_reanalyser = f"/api/credits/applications/{self.app.code}/reanalyser/"

    # ── Permissions ──────────────────────────────────────────────────────────

    def test_analyse_exige_authentification(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_analyse_interdite_au_client_meme_proprietaire(self):
        """Le titulaire du dossier n'accède PAS à la vue analyste (principe 7)."""
        self.login(role="client", sub=str(self.client_user.pk))
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "STAFF_REQUIS")

    def test_analyse_ouverte_au_staff(self):
        self.login(role="gest_credit", sub="sub-analyste")
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_analyse_ouverte_a_l_audit_en_lecture(self):
        self.login(role="aud_fin", sub="sub-auditeur")
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_reanalyser_interdit_au_client(self):
        self.login(role="client", sub=str(self.client_user.pk))
        res = self.client.post(self.url_reanalyser, {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_reanalyser_interdit_a_l_auditeur(self):
        """L'audit lit, il n'exécute pas — le journal serait pollué d'analyses."""
        self.login(role="aud_fin", sub="sub-auditeur")
        res = self.client.post(self.url_reanalyser, {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_justifier_interdit_au_client(self):
        self.login(role="client", sub=str(self.client_user.pk))
        res = self.client.post(self.url_justifier,
                               {"indicateur": "x", "justification": "y"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_resume_interdit_a_un_autre_client(self):
        autre = _user("sub-autre-client", "Autre")
        self.login(role="client", sub=str(autre.pk))
        self.assertEqual(self.client.get(self.url_resume).status_code, 403)

    def test_resume_ouvert_au_titulaire(self):
        self.login(role="client", sub=str(self.client_user.pk))
        self.assertEqual(self.client.get(self.url_resume).status_code, 200)

    # ── Convention d'absence ─────────────────────────────────────────────────

    def test_absence_d_analyse_repond_404_avec_code(self):
        vierge = _app(self.client_user)
        self.login(role="gest_credit", sub="sub-analyste")
        res = self.client.get(f"/api/credits/applications/{vierge.code}/analyse/")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.data["code"], "ANALYSE_ABSENTE")

    # ── Contrat front (`src/types/api.ts`) ───────────────────────────────────

    def test_forme_de_la_reponse_staff(self):
        self.login(role="gest_credit", sub="sub-analyste")
        data = self.client.get(self.url).data

        for cle in ("id", "reference", "referentiel", "parametres", "scoreGlobal",
                    "recommandation", "dscr", "dscrStress", "criteres",
                    "indicateursHorsPlage", "justifications", "echeancier",
                    "executeLe", "versionMoteur"):
            self.assertIn(cle, data, f"clé de contrat manquante : {cle}")

        self.assertEqual(set(data["parametres"]) >= {"dureeMois", "differeMois",
                                                     "tauxAnnuel"}, True)
        self.assertEqual(data["parametres"]["dureeMois"], 8)
        self.assertEqual(data["parametres"]["differeMois"], 5)
        self.assertEqual(set(data["criteres"]),
                         {"technique", "dscr", "stress", "comportemental", "garanties"})
        for bloc in data["criteres"].values():
            self.assertEqual(set(bloc) >= {"score", "poids", "points", "details"}, True)

    def test_echeancier_au_format_du_contrat(self):
        """Nombres et phases accentuées — `echeancier.py` stocke des chaînes."""
        self.login(role="gest_credit", sub="sub-analyste")
        lignes = self.client.get(self.url).data["echeancier"]
        self.assertEqual(len(lignes), 8)
        self.assertEqual(lignes[0]["phase"], "différé")
        self.assertEqual(lignes[-1]["phase"], "amortissement")
        for ligne in lignes:
            for cle in ("capital", "interets", "echeance", "crd"):
                self.assertIsInstance(ligne[cle], float, f"{cle} n'est pas un number")
        self.assertEqual(lignes[-1]["crd"], 0.0)

    def test_les_grandeurs_numeriques_sortent_en_number(self):
        """`poidsAppliques` typé `Record<string, number>` dans `api.ts`.

        Il sortait en chaînes (`"25.0"`) alors que `criteres.<x>.poids` sortait
        en nombre : la même grandeur dans deux types selon l'endroit du payload.
        Invisible au build (`checkJs: false`) et invisible à l'écran jusqu'au
        premier calcul ou tri côté front.
        """
        self.login(role="gest_credit", sub="sub-analyste")
        data = self.client.get(self.url).data
        for cle, valeur in data["poidsAppliques"].items():
            self.assertIsInstance(valeur, float, f"poidsAppliques.{cle} = {valeur!r}")
        self.assertEqual(sum(data["poidsAppliques"].values()), 100.0)
        for nom, bloc in data["criteres"].items():
            self.assertIsInstance(bloc["poids"], float, nom)
            self.assertEqual(bloc["poids"], data["poidsAppliques"][nom])

    def test_phase_franchise_traduite_pour_le_contrat_front(self):
        """`franchise_totale` doit sortir la phase `"franchise"`, pas `"différé"`.

        Le contrat type `phase: 'différé' | 'amortissement' | 'franchise'`. La
        traduction vit dans `_PHASES_API` et n'était exercée que sur la branche
        `interets_seuls` : une entrée manquante du mapping serait retombée en
        silence sur l'identifiant de stockage `"differe"` (sans accent), valeur
        hors union que le front n'aurait indexée dans aucune classe CSS. Le
        tableau se serait affiché sans style, sans erreur.

        Le front n'a aucun test (cf. `moteur-front-analyse`) : cette garde est
        donc la seule du chemin.
        """
        self.login(role="gest_credit", sub="sub-analyste")
        res = self.client.post(self.url_reanalyser,
                               {"duree_mois": 8, "differe_mois": 5,
                                "mode_differe": "franchise_totale"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["parametres"]["modeDiffere"], "franchise_totale")

        lignes = res.data["echeancier"]
        phases = [l["phase"] for l in lignes]
        self.assertEqual(phases[:5], ["franchise"] * 5)
        self.assertEqual(phases[5:], ["amortissement"] * 3)
        # Toute phase servie appartient à l'union du contrat.
        self.assertTrue(set(phases) <= {"différé", "amortissement", "franchise"})

        # Les intérêts capitalisés sont portés, et l'invariant tient.
        self.assertEqual(lignes[4]["interetsCapitalises"], 21.17)
        self.assertEqual(lignes[-1]["crd"], 0.0)
        self.assertEqual(res.data["totaux"]["serviceDette"], 1475.76)

    def test_mode_differe_inconnu_refuse(self):
        """Un mode inventé ne produit pas un échéancier « best effort »."""
        self.login(role="gest_credit", sub="sub-analyste")
        res = self.client.post(self.url_reanalyser,
                               {"duree_mois": 8, "differe_mois": 5,
                                "mode_differe": "differe_partiel"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "PARAMETRES_INVALIDES")

    def test_totaux_servis_par_le_serveur(self):
        self.login(role="gest_credit", sub="sub-analyste")
        totaux = self.client.get(self.url).data["totaux"]
        self.assertEqual(totaux["serviceDette"], 1469.65)
        self.assertEqual(totaux["totalInterets"], 139.65)
        self.assertEqual(totaux["crdFinal"], 0.0)

    def test_diagnostic_dscr_porte_facteur_dominant_et_levier(self):
        self.login(role="gest_credit", sub="sub-analyste")
        details = self.client.get(self.url).data["criteres"]["dscr"]["details"]
        self.assertIn("Différé de 5 mois", details["facteurDominant"])
        self.assertIn("DSCR", details["levier"])

    def test_statut_du_referentiel_expose_au_staff(self):
        self.login(role="gest_credit", sub="sub-analyste")
        info = self.client.get(self.url).data["referentielInfo"]
        self.assertEqual(info["source"], "indicatif")
        self.assertIs(info["estIndicatif"], True)

    def test_justifier_retourne_l_analyse_complete(self):
        self.login(role="gest_credit", sub="sub-analyste")
        indicateur = self.analyse.indicateurs_hors_plage[0]["indicateur"]
        res = self.client.post(self.url_justifier,
                               {"indicateur": indicateur,
                                "justification": "Semences fournies par la coopérative."},
                               format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["justifications"]), 1)
        self.assertEqual(res.data["justifications"][0]["indicateur"], indicateur)
        self.assertEqual(res.data["id"], self.analyse.pk)

    def test_justification_vide_refusee_par_erreur_structuree(self):
        self.login(role="gest_credit", sub="sub-analyste")
        res = self.client.post(self.url_justifier,
                               {"indicateur": "cout_module:semences", "justification": ""},
                               format="json")
        self.assertEqual(res.status_code, 422)
        self.assertIn("JUSTIFICATION_REQUISE", [e["code"] for e in res.data["errors"]])

    def test_reanalyser_cree_une_nouvelle_analyse(self):
        self.login(role="gest_credit", sub="sub-analyste")
        res = self.client.post(self.url_reanalyser,
                               {"duree_mois": 8, "differe_mois": 2}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertNotEqual(res.data["id"], self.analyse.pk)
        self.assertEqual(res.data["parametres"]["differeMois"], 2)
        self.assertEqual(AnalyseCredit.objects.filter(application=self.app).count(), 2)

    def test_reanalyser_avec_parametres_invalides(self):
        self.login(role="gest_credit", sub="sub-analyste")
        res = self.client.post(self.url_reanalyser,
                               {"duree_mois": 8, "differe_mois": 8}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "PARAMETRES_INVALIDES")


# ── 9. Anti-gaming (principe 7) — le test qui doit ÉCHOUER en cas de fuite ───

class AntiGamingTests(AuthedAPITestCase):
    """Vérifie que la vue client ne laisse fuir AUCUN paramètre du moteur.

    Ce test est écrit en liste noire ET en liste blanche : la liste noire attrape
    les fuites de valeurs, la liste blanche attrape l'ajout d'une clé nouvelle.
    Une seule des deux ne suffirait pas — un champ ajouté sans réflexion passerait
    la liste noire s'il ne contient pas un mot interdit.
    """

    #: Toute clé, à n'importe quelle profondeur, dont la présence est une fuite.
    CLES_INTERDITES = {
        "bareme", "baremes", "baremesAppliques", "poids", "poidsAppliques",
        "points", "score", "scoreGlobal", "seuil", "seuils", "tolerance",
        "tol_inf", "tol_sup", "dscr", "dscrStress", "criteres", "referentiel",
        "referentielInfo", "recommandation", "indicateursHorsPlage",
        "ecartsHorsPlage", "ecartMoyenPct", "totalReferentiel", "parModule",
        "ratioCouverture", "plage", "plages", "lettres", "echeancier",
    }

    #: Le contrat `CreditAnalyseResume` — rien de plus.
    CLES_ATTENDUES = {"reference", "scoreLettre", "pointsForts",
                      "pointsAAmeliorer", "analyseLe"}

    def setUp(self):
        _seed()
        self.client_user = _user("sub-antigaming", "Marie Kabemba")
        self.app = _app(self.client_user)
        _source(self.app, TOTAUX_REFERENCE)
        self.analyse = executer_analyse(self.app, duree_mois=8, differe_mois=5)

    def _cles_profondes(self, obj, chemin="") -> list[tuple[str, str]]:
        trouvees = []
        if isinstance(obj, dict):
            for cle, valeur in obj.items():
                trouvees.append((cle, f"{chemin}.{cle}"))
                trouvees += self._cles_profondes(valeur, f"{chemin}.{cle}")
        elif isinstance(obj, (list, tuple)):
            for i, v in enumerate(obj):
                trouvees += self._cles_profondes(v, f"{chemin}[{i}]")
        return trouvees

    def test_resume_client_ne_porte_que_les_cles_du_contrat(self):
        resume = serialiser_analyse_resume(self.analyse)
        self.assertEqual(set(resume), self.CLES_ATTENDUES)

    def test_resume_client_ne_laisse_fuir_aucun_parametre_du_moteur(self):
        resume = serialiser_analyse_resume(self.analyse)
        fuites = [chemin for cle, chemin in self._cles_profondes(resume)
                  if cle in self.CLES_INTERDITES]
        self.assertEqual(fuites, [], f"Fuite anti-gaming (principe 7) : {fuites}")

    def test_resume_client_ne_contient_aucune_valeur_chiffree_du_moteur(self):
        """Ni score, ni DSCR, ni référence chiffrée dans les textes servis."""
        import json
        resume = serialiser_analyse_resume(self.analyse)
        texte = json.dumps(resume, ensure_ascii=False)
        for interdit in (str(self.analyse.score_global), str(self.analyse.dscr),
                         self.analyse.referentiel.code, self.analyse.recommandation,
                         "9111", "0.30", "tolérance"):
            self.assertNotIn(interdit, texte,
                             f"« {interdit} » ne doit pas atteindre le client.")

    def test_resume_sur_http_ne_fuit_pas_davantage(self):
        """La vue staff et la vue client ne partagent aucun sérialiseur."""
        self.login(role="client", sub=str(self.client_user.pk))
        res = self.client.get(f"/api/credits/applications/{self.app.code}/analyse-resume/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(set(res.data), self.CLES_ATTENDUES)
        fuites = [c for cle, c in self._cles_profondes(res.data)
                  if cle in self.CLES_INTERDITES]
        self.assertEqual(fuites, [])

    def test_absence_d_historique_n_est_jamais_un_point_fort(self):
        """Le moteur ne félicite pas un client pour une donnée qu'il n'a pas.

        Régression réelle : avec un `>=` sur la médiane, le score neutre de 50
        du critère comportemental sans historique tombait dans « points forts »,
        et le client lisait « votre historique avec AGRICAP joue en votre
        faveur » alors qu'il n'a aucun crédit antérieur. Trompeur pour lui, et
        faux pour l'institution.
        """
        resume = serialiser_analyse_resume(self.analyse)
        self.assertIs(
            self.analyse.criteres["comportemental"]["details"]["historiqueDisponible"],
            False)
        self.assertNotIn(
            "Votre historique avec AGRICAP joue en votre faveur.",
            resume["pointsForts"])
        self.assertTrue(
            any("historique de remboursement" in p for p in resume["pointsAAmeliorer"]),
            "L'absence d'historique doit être une piste actionnable.")

    def test_pistes_client_sont_des_actions_pas_des_seuils(self):
        resume = serialiser_analyse_resume(self.analyse)
        self.assertTrue(resume["pointsAAmeliorer"])
        for piste in resume["pointsAAmeliorer"]:
            self.assertFalse(any(c.isdigit() for c in piste),
                             f"Une piste client ne cite aucun chiffre : « {piste} »")

    def test_la_vue_staff_expose_bien_ce_que_la_vue_client_retient(self):
        """Contre-épreuve : sans elle, un résumé vide passerait le test de fuite."""
        staff = serialiser_analyse_staff(self.analyse)
        self.assertIn("criteres", staff)
        self.assertIn("ecartsHorsPlage", staff["criteres"]["technique"]["details"])
        self.assertIn("poidsAppliques", staff)

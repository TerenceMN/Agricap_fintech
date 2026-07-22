"""Tests du provisionnement PAR (principe 6 de HAZINA) — CAS CHIFFRÉ EXÉCUTÉ.

Le dossier de référence, repris dans tout le fichier :

    Capital approuvé et décaissé .... 1 200,00 USD
    Taux ........................... 1,5 % par mois (intérêt simple sur le solde)
    Durée / fréquence .............. 12 mois, mensuel
    Départ ......................... 01/01/2026 (1re échéance le 01/02/2026)

    Échéance   Date         Capital   Intérêts   Total     CRD
    1          01/02/2026    100,00     18,00    118,00   1 100,00
    2          01/03/2026    100,00     16,50    116,50   1 000,00
    3          01/04/2026    100,00     15,00    115,00     900,00
    4          01/05/2026    100,00     13,50    113,50     800,00
    5          01/06/2026    100,00     12,00    112,00     700,00
    …
    12         01/01/2027    100,00      1,50    101,50       0,00

Trois arrêtés successifs au 30/06/2026, 31/07/2026 puis 31/08/2026 déroulent la
mécanique complète : classement → déclassement B5 → dotation B6 → reprise B7.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase

from common.exceptions import ConflictError, ValidationFailed
from portfolio.models import Loan, LoanTransaction

from . import catalogue, provisions, services
from .models import ArreteProvision, ClasseRisque, ClassementCredit, PieceComptable

DEBUT = date(2026, 1, 1)
ARRETE_1 = date(2026, 6, 30)
ARRETE_2 = date(2026, 7, 31)
ARRETE_3 = date(2026, 8, 31)


def _creer_credit(*, reference="CRD-2026-001", montant="1200", devise="USD",
                  taux="1.500", duree=12) -> Loan:
    return Loan.objects.create(
        reference=reference,
        date=DEBUT,
        operator="Coopérative Maïs Kabare",
        amount_requested=Decimal(montant),
        amount_approved=Decimal(montant),
        currency=devise,
        duration_months=duree,
        rate=Decimal(taux),
        frequency=Loan.Frequency.MONTHLY,
        start_date=DEBUT,
        status=Loan.Status.EN_COURS,
    )


def _decaisser(loan: Loan, montant="1200", jour=DEBUT) -> None:
    LoanTransaction.objects.create(
        loan=loan, date=jour, kind=LoanTransaction.Kind.DISBURSEMENT,
        amount=Decimal(montant), currency=loan.currency,
        status=LoanTransaction.Status.VALIDE,
    )


def _rembourser(loan: Loan, montant, jour) -> None:
    """Les remboursements sont stockés NÉGATIFS dans `portfolio` (cf. `LoanTransaction`)."""
    LoanTransaction.objects.create(
        loan=loan, date=jour, kind=LoanTransaction.Kind.REPAYMENT,
        amount=-Decimal(montant), currency=loan.currency,
        status=LoanTransaction.Status.VALIDE,
    )


class ProvisionsTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_accounting", verbosity=0)


# ------------------------------------------------------------------ GRILLE PAR

class GrillePARTests(ProvisionsTestCase):
    def test_grille_amorcee_par_le_seed(self):
        codes = list(ClasseRisque.objects.values_list("code", flat=True))
        self.assertEqual(sorted(codes), ["DOUTEUX", "PAR30", "PAR90", "SAIN"])

    def test_couverture_contigue_de_zero_a_linfini(self):
        classes = provisions.verifier_couverture()
        self.assertEqual(classes[0].jours_min, 0)
        self.assertIsNone(classes[-1].jours_max)

    def test_un_trou_dans_la_grille_est_refuse(self):
        """LE test qui protège la provision : un trou = des crédits sans classe, donc un
        risque qui disparaît des états financiers par effet de bord de paramétrage."""
        with self.assertRaises(ValidationFailed) as ctx:
            provisions.modifier_classe("PAR30", par="comite", jours_min=35)
        self.assertIn("contiguë", str(ctx.exception))
        # Rollback : la borne n'a PAS été enregistrée.
        self.assertEqual(ClasseRisque.objects.get(code="PAR30").jours_min, 30)

    def test_recouvrement_de_classes_refuse(self):
        with self.assertRaises(ValidationFailed):
            provisions.modifier_classe("SAIN", par="comite", jours_max=45)
        self.assertEqual(ClasseRisque.objects.get(code="SAIN").jours_max, 29)

    def test_taux_hors_de_zero_un_refuse(self):
        with self.assertRaises(ValidationFailed) as ctx:
            provisions.modifier_classe("PAR90", par="comite", taux_provision="25")
        self.assertIn("FRACTION", str(ctx.exception))

    def test_taux_modifiable_par_le_comite_sans_redeploiement(self):
        classe = provisions.modifier_classe("PAR90", par="comite", taux_provision="0.6000")
        self.assertEqual(classe.taux_provision, Decimal("0.6000"))
        self.assertEqual(classe.modifie_par, "comite")

    def test_rechargement_du_seed_necrase_pas_un_taux_ajuste(self):
        provisions.modifier_classe("PAR90", par="comite", taux_provision="0.6000")
        call_command("seed_accounting", verbosity=0)
        self.assertEqual(
            ClasseRisque.objects.get(code="PAR90").taux_provision, Decimal("0.6000"),
            "Un rechargement du référentiel a écrasé une décision du comité.",
        )


# ------------------------------------------------------------------ ÉCHÉANCIER

class EcheancierDecimalTests(ProvisionsTestCase):
    def setUp(self):
        self.echeances = provisions.echeancier(
            principal="1200", taux_mensuel_pct="1.5", duree_mois=12,
            frequence="monthly", date_debut=DEBUT,
        )

    def test_cas_chiffre_des_quatre_premieres_echeances(self):
        attendu = [
            (date(2026, 2, 1), "100.00", "18.00", "118.00", "1100.00"),
            (date(2026, 3, 1), "100.00", "16.50", "116.50", "1000.00"),
            (date(2026, 4, 1), "100.00", "15.00", "115.00", "900.00"),
            (date(2026, 5, 1), "100.00", "13.50", "113.50", "800.00"),
        ]
        for ligne, (jour, capital, interets, total, crd) in zip(self.echeances, attendu):
            self.assertEqual(ligne["date"], jour)
            self.assertEqual(ligne["capital"], Decimal(capital))
            self.assertEqual(ligne["interets"], Decimal(interets))
            self.assertEqual(ligne["total"], Decimal(total))
            self.assertEqual(ligne["crd"], Decimal(crd))

    def test_invariant_crd_final_nul(self):
        self.assertEqual(self.echeances[-1]["crd"], Decimal("0.00"))

    def test_invariant_somme_capital_egale_principal(self):
        total = sum((e["capital"] for e in self.echeances), Decimal("0.00"))
        self.assertEqual(total, Decimal("1200.00"))

    def test_invariant_crd_nul_meme_sur_un_principal_indivisible(self):
        """1 000 / 7 ne tombe pas juste : le résidu d'arrondi doit être absorbé par la
        dernière échéance, pas laissé sur le CRD."""
        echeances = provisions.echeancier(
            principal="1000", taux_mensuel_pct="2", duree_mois=7,
            frequence="monthly", date_debut=DEBUT,
        )
        self.assertEqual(echeances[-1]["crd"], Decimal("0.00"))
        self.assertEqual(
            sum((e["capital"] for e in echeances), Decimal("0.00")), Decimal("1000.00"),
        )

    def test_bullet_rembourse_le_capital_a_la_fin(self):
        echeances = provisions.echeancier(
            principal="500", taux_mensuel_pct="1", duree_mois=6,
            frequence="bullet", date_debut=DEBUT,
        )
        self.assertEqual(len(echeances), 1)
        self.assertEqual(echeances[0]["capital"], Decimal("500.00"))
        self.assertEqual(echeances[0]["interets"], Decimal("30.00"))  # 500 × 1 % × 6

    def test_decimal_partout_aucun_float(self):
        for echeance in self.echeances:
            for cle in ("capital", "interets", "total", "crd"):
                self.assertIsInstance(echeance[cle], Decimal, f"{cle} n'est pas un Decimal")


class ImputationTests(ProvisionsTestCase):
    def setUp(self):
        self.echeances = provisions.echeancier(
            principal="1200", taux_mensuel_pct="1.5", duree_mois=12,
            frequence="monthly", date_debut=DEBUT,
        )

    def test_une_echeance_reglee_impute_interets_puis_capital(self):
        resultat = provisions.imputer(self.echeances, Decimal("118.00"))
        self.assertEqual(resultat["capital_rembourse"], Decimal("100.00"))
        self.assertEqual(resultat["interets_regles"], Decimal("18.00"))
        self.assertEqual(resultat["premiere_echeance_impayee"], date(2026, 3, 1))

    def test_reglement_partiel_laisse_lecheance_impayee(self):
        """117,99 sur 118,00 : l'échéance n'est PAS réglée. Un centime manquant est un
        impayé — c'est le sens du contrôle, pas une tolérance."""
        resultat = provisions.imputer(self.echeances, Decimal("117.99"))
        self.assertEqual(resultat["premiere_echeance_impayee"], date(2026, 2, 1))
        self.assertEqual(resultat["capital_rembourse"], Decimal("99.99"))

    def test_aucun_reglement_rend_la_premiere_echeance_impayee(self):
        resultat = provisions.imputer(self.echeances, Decimal("0.00"))
        self.assertEqual(resultat["premiere_echeance_impayee"], date(2026, 2, 1))
        self.assertEqual(resultat["capital_rembourse"], Decimal("0.00"))

    def test_credit_a_jour_na_pas_dimpaye(self):
        total = sum((e["total"] for e in self.echeances), Decimal("0.00"))
        resultat = provisions.imputer(self.echeances, total)
        self.assertIsNone(resultat["premiere_echeance_impayee"])
        self.assertEqual(resultat["capital_rembourse"], Decimal("1200.00"))


# --------------------------------------------------------------- CLASSIFICATION

class ClassificationTests(ProvisionsTestCase):
    def setUp(self):
        self.loan = _creer_credit()
        _decaisser(self.loan)

    def _analyse(self, as_of=ARRETE_1) -> dict:
        donnees = provisions.analyser_portefeuille(as_of=as_of)
        return donnees["credits"][0]

    def test_cas_chiffre_une_echeance_reglee_donne_121_jours_de_retard(self):
        """118,00 réglés → la 2e échéance (01/03/2026) est la plus ancienne impayée.
        Du 01/03/2026 au 30/06/2026 : 31 + 30 + 31 + 29 = 121 jours → classe PAR90."""
        _rembourser(self.loan, "118.00", date(2026, 2, 1))
        credit = self._analyse()
        self.assertEqual(credit["jours_retard"], 121)
        self.assertEqual(credit["classe"].code, "PAR90")
        self.assertEqual(credit["encours"], Decimal("1100.00"))
        self.assertEqual(credit["provision"], Decimal("550.00"))  # 1 100 × 50 %
        self.assertTrue(credit["en_souffrance"])

    def test_credit_a_jour_est_sain(self):
        _rembourser(self.loan, "463.00", date(2026, 5, 1))  # échéances 1 à 4
        credit = self._analyse()
        self.assertEqual(credit["jours_retard"], 29)  # 01/06 → 30/06
        self.assertEqual(credit["classe"].code, "SAIN")
        self.assertEqual(credit["encours"], Decimal("800.00"))
        self.assertEqual(credit["provision"], Decimal("8.00"))  # 800 × 1 %

    def test_credit_ancien_bascule_en_douteux(self):
        credit = self._analyse(as_of=date(2026, 12, 31))
        self.assertGreaterEqual(credit["jours_retard"], 180)
        self.assertEqual(credit["classe"].code, "DOUTEUX")
        self.assertEqual(credit["provision"], Decimal("1200.00"))  # 100 %

    def test_credit_non_decaisse_est_hors_perimetre(self):
        LoanTransaction.objects.all().delete()
        self.assertEqual(provisions.analyser_portefeuille(as_of=ARRETE_1)["credits"], [])

    def test_transaction_en_attente_nest_pas_du_decaisse(self):
        """Une provision ne se calcule pas sur de l'argent dont on n'est pas sûr qu'il
        soit sorti — divergence assumée avec `Loan.disbursed`, qui les additionne."""
        LoanTransaction.objects.all().delete()
        LoanTransaction.objects.create(
            loan=self.loan, date=DEBUT, kind=LoanTransaction.Kind.DISBURSEMENT,
            amount=Decimal("1200"), status=LoanTransaction.Status.EN_ATTENTE,
        )
        self.assertEqual(provisions.analyser_portefeuille(as_of=ARRETE_1)["credits"], [])

    def test_credit_cloture_ou_rejete_sort_du_perimetre(self):
        self.loan.status = Loan.Status.CLOTURE
        self.loan.save(update_fields=["status"])
        self.assertEqual(provisions.analyser_portefeuille(as_of=ARRETE_1)["credits"], [])

    def test_devise_cdf_du_portefeuille_devient_fc_au_plan_comptable(self):
        """`portfolio` dit « CDF », l'annexe A dit « FC » — la traduction est explicite."""
        autre = _creer_credit(reference="CRD-2026-002", devise="CDF", montant="500000")
        _decaisser(autre, "500000")
        devises = {c["devise"] for c in provisions.analyser_portefeuille(as_of=ARRETE_1)["credits"]}
        self.assertEqual(devises, {"USD", "FC"})

    def test_synthese_par_devise_ne_melange_jamais_deux_monnaies(self):
        autre = _creer_credit(reference="CRD-2026-003", devise="CDF", montant="500000")
        _decaisser(autre, "500000")
        synthese = provisions.analyser_portefeuille(as_of=ARRETE_1)["synthese"]
        par_devise = {s["devise"]: s for s in synthese}
        self.assertEqual(par_devise["USD"]["encours_total"], Decimal("1200.00"))
        self.assertEqual(par_devise["FC"]["encours_total"], Decimal("500000.00"))

    def test_analyse_nécrit_aucune_ecriture(self):
        avant = PieceComptable.objects.count()
        provisions.analyser_portefeuille(as_of=ARRETE_1)
        self.assertEqual(PieceComptable.objects.count(), avant)


# ------------------------------------------------------------------- ARRÊTÉ

class ArreteProvisionTests(ProvisionsTestCase):
    """Le cas chiffré complet, de la naissance de l'encours à la reprise de provision."""

    def setUp(self):
        self.loan = _creer_credit()
        _decaisser(self.loan)
        _rembourser(self.loan, "118.00", date(2026, 2, 1))
        # L'encours doit exister AU GRAND LIVRE avant de pouvoir être déclassé :
        # B1 (décaissement 1 200) puis B2 (capital 100) → 413USD = 1 100.
        catalogue.executer_evenement(
            "B1", {"devise": "USD", "montants": {"capital": "1200"},
                   "comptes": {"$TRESORERIE": "511"}},
            reference="CRD-001-B1", date_operation=DEBUT, par="agent",
        )
        catalogue.executer_evenement(
            "B2", {"devise": "USD", "montants": {"capital": "100"},
                   "comptes": {"$TRESORERIE": "511"}},
            reference="CRD-001-B2", date_operation=date(2026, 2, 1), par="caissier",
        )

    def test_cas_chiffre_complet_declassement_puis_dotation(self):
        resultat = provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")

        # --- Déclassement B5 : 1 100 USD passent de 413 à 416 -------------------
        self.assertEqual(len(resultat["declassements"]), 1)
        declassement = resultat["declassements"][0]
        self.assertEqual(declassement["encours"], Decimal("1100.00"))
        self.assertEqual(declassement["classe"], "PAR90")
        self.assertEqual(services.solde_compte("413", devise="USD"), Decimal("0.00"))
        self.assertEqual(services.solde_compte("416", devise="USD"), Decimal("1100.00"))

        # --- Dotation B6 : 1 100 × 50 % = 550 ---------------------------------
        arrete = [a for a in resultat["arretes"] if a["devise"] == "USD"][0]
        self.assertEqual(arrete["provision_requise"], Decimal("550.00"))
        self.assertEqual(arrete["provision_anterieure"], Decimal("0.00"))
        self.assertEqual(arrete["dotation"], Decimal("550.00"))
        self.assertEqual(arrete["reprise"], Decimal("0.00"))
        self.assertEqual(services.solde_compte("137", devise="USD"), Decimal("-550.00"))
        self.assertEqual(services.solde_compte("691", devise="USD"), Decimal("550.00"))

        # --- Invariants ---------------------------------------------------------
        self.assertEqual(services.controler_integrite(), [])
        lignes = services.balance_par_devise(devise="USD")
        self.assertEqual(sum(l["debit"] for l in lignes), sum(l["credit"] for l in lignes))

    def test_arrete_trace_le_classement_de_chaque_credit(self):
        provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        classement = ClassementCredit.objects.get(loan_reference="CRD-2026-001")
        self.assertEqual(classement.classe.code, "PAR90")
        self.assertEqual(classement.jours_retard, 121)
        self.assertEqual(classement.encours, Decimal("1100.00"))
        self.assertIsNotNone(classement.piece_declassement)

    def test_classement_est_append_only(self):
        provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        classement = ClassementCredit.objects.first()
        classement.jours_retard = 0
        with self.assertRaises(ValidationFailed):
            classement.save()
        with self.assertRaises(ValidationFailed):
            classement.delete()

    def test_deuxieme_arrete_ne_declasse_pas_deux_fois(self):
        provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        resultat = provisions.arreter(date_arrete=ARRETE_2, par="chef_compta")
        self.assertEqual(resultat["declassements"], [])
        self.assertEqual(services.solde_compte("416", devise="USD"), Decimal("1100.00"))

    def test_provision_stable_ne_produit_aucune_ecriture(self):
        """Le stock 137 vaut déjà la cible : aucune écriture « de confort » n'est passée."""
        provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        avant = PieceComptable.objects.count()
        resultat = provisions.arreter(date_arrete=ARRETE_2, par="chef_compta")
        self.assertEqual(PieceComptable.objects.count(), avant)
        arrete = [a for a in resultat["arretes"] if a["devise"] == "USD"][0]
        self.assertEqual(arrete["dotation"], Decimal("0.00"))
        self.assertEqual(arrete["reprise"], Decimal("0.00"))
        self.assertIsNone(arrete["piece"])

    def test_amelioration_declenche_une_reprise_b7(self):
        """Le crédit se régularise. Arrêté au 31/07/2026, après règlement des échéances
        1 à 6 (118,00 + 116,50 + 115,00 + 113,50 + 112,00 + 110,50 = 685,50) :
        la plus ancienne impayée devient le 01/08/2026, postérieure à l'arrêté → 0 jour de
        retard → classe SAIN. Encours 1 200 − 600 = 600 ; provision cible 600 × 1 % = 6,00 ;
        stock antérieur 550,00 → REPRISE de 544,00."""
        provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        _rembourser(self.loan, "567.50", date(2026, 7, 15))  # 118,00 + 567,50 = 685,50
        resultat = provisions.arreter(date_arrete=ARRETE_2, par="chef_compta")

        arrete = [a for a in resultat["arretes"] if a["devise"] == "USD"][0]
        self.assertEqual(arrete["provision_requise"], Decimal("6.00"))
        self.assertEqual(arrete["provision_anterieure"], Decimal("550.00"))
        self.assertEqual(arrete["reprise"], Decimal("544.00"))
        self.assertEqual(arrete["dotation"], Decimal("0.00"))
        self.assertEqual(services.solde_compte("137", devise="USD"), Decimal("-6.00"))
        self.assertEqual(services.solde_compte("791", devise="USD"), Decimal("-544.00"))
        self.assertEqual(services.controler_integrite(), [])

    def test_retour_en_classe_saine_ne_reclasse_pas_416_vers_413(self):
        """DETTE ASSUMÉE ET SIGNALÉE : l'annexe B ne contient aucun schéma inverse de B5.
        Un crédit qui redevient sain reste donc en 416 au grand livre. On ne détourne pas
        la contrepassation (qui corrige une ERREUR) pour acter un événement économique :
        il manque un schéma « B17 — reclassement 416 → 413 », à arbitrer par le fondateur.
        Ce test verrouille le comportement actuel pour que l'écart soit visible."""
        provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        _rembourser(self.loan, "567.50", date(2026, 7, 15))
        provisions.arreter(date_arrete=ARRETE_2, par="chef_compta")
        classement = ClassementCredit.objects.get(date_arrete=ARRETE_2)
        self.assertEqual(classement.classe.code, "SAIN")
        self.assertFalse(classement.en_souffrance)
        self.assertEqual(services.solde_compte("416", devise="USD"), Decimal("1100.00"))
        self.assertEqual(services.solde_compte("413", devise="USD"), Decimal("0.00"))

    def test_arrete_deja_passe_a_la_meme_date_refuse(self):
        provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        with self.assertRaises(ConflictError):
            provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")

    def test_arrete_anonyme_refuse(self):
        with self.assertRaises(ValidationFailed):
            provisions.arreter(date_arrete=ARRETE_1, par="")

    def test_detail_par_classe_est_conserve(self):
        provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        arrete = ArreteProvision.objects.get(date_arrete=ARRETE_1, devise="USD")
        ligne = arrete.lignes.get()
        self.assertEqual(ligne.classe.code, "PAR90")
        self.assertEqual(ligne.encours, Decimal("1100.00"))
        self.assertEqual(ligne.taux_applique, Decimal("0.5000"))
        self.assertEqual(ligne.provision, Decimal("550.00"))

    def test_arrete_est_fige(self):
        provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        arrete = ArreteProvision.objects.get(date_arrete=ARRETE_1, devise="USD")
        arrete.dotation = Decimal("0.00")
        with self.assertRaises(ValidationFailed):
            arrete.save()
        with self.assertRaises(ValidationFailed):
            arrete.delete()

    def test_ecart_encours_comptable_vs_portefeuille_est_expose(self):
        arrete = ArreteProvision.objects.filter(devise="USD").first()
        self.assertIsNone(arrete)
        resultat = provisions.arreter(date_arrete=ARRETE_1, par="chef_compta")
        ligne = [a for a in resultat["arretes"] if a["devise"] == "USD"][0]
        # Ici les deux coïncident (1 100) parce que B1/B2 ont été passés dans le test.
        self.assertEqual(ligne["encours_portefeuille"], Decimal("1100.00"))
        self.assertEqual(ligne["encours_comptable"], Decimal("1100.00"))
        self.assertEqual(ligne["ecart_encours"], Decimal("0.00"))


class DeclassementSansEncoursComptableTests(ProvisionsTestCase):
    """Le portefeuille porte un encours que le grand livre ignore : c'est la situation
    RÉELLE aujourd'hui (les événements de crédit alimentent `ledger`, pas `accounting`).
    Le déclassement doit alors être REFUSÉ, bruyamment — jamais produire un 413 créditeur."""

    def setUp(self):
        loan = _creer_credit()
        _decaisser(loan)

    def test_declassement_refuse_si_lencours_nest_pas_comptabilise(self):
        with self.assertRaises(ValidationFailed) as ctx:
            provisions.arreter(date_arrete=date(2026, 12, 31), par="chef_compta")
        message = str(ctx.exception)
        self.assertIn("413", message)
        self.assertIn("B1/B2", message)
        self.assertEqual(PieceComptable.objects.count(), 0,
                         "Un refus doit tout annuler : aucune pièce ne doit subsister.")
        self.assertEqual(ArreteProvision.objects.count(), 0)

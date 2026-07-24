"""Tests du consommateur d'événements métier (`accounting.consommation`).

Ce que ces tests verrouillent, dans l'ordre d'importance :

1. **un événement métier produit UNE pièce ÉQUILIBRÉE** — la file n'est plus muette ;
2. **le rejeu ne produit AUCUNE écriture en double** (c'est tout l'objet de `consumed_at`) ;
3. **un échec isolé n'interrompt pas le lot** — un événement bancal ne gèle pas la compta ;
4. **un événement sans écriture définie reste NON consommé** — on ne vide pas une file en
   inventant une écriture ;
5. **le consommateur ne connaît aucune file en particulier** — crédit (B1→B4), épargne
   (B8/B9) et investissement (B10→B13) empruntent le MÊME code ; ce qui les distingue vit
   entièrement en base.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from . import consommation, services
from .definitions import SOURCE_INVESTISSEMENT
from .models import (
    Devise,
    LigneEcriture,
    PieceComptable,
    RegleConsommation,
)

JOUR = date(2026, 7, 21)


def _horodatage(jour: date = JOUR, *, minutes: int = 0):
    """Horodatage aware dans le fuseau de l'institution, pour que `timezone.localdate`
    retombe bien sur `jour` (Africa/Kinshasa = UTC+1 : un `occurred_at` naïvement en UTC
    à 23 h basculerait au lendemain)."""
    naif = datetime(jour.year, jour.month, jour.day, 10, 0) + timedelta(minutes=minutes)
    return timezone.make_aware(naif)


class ConsommationTestCase(TestCase):
    """Le référentiel (plan comptable, catalogue, règles de consommation) est chargé par la
    commande idempotente — on teste ainsi le chemin réel d'installation."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_accounting", verbosity=0)

    # -- Fabriques ---------------------------------------------------------
    def evenement(self, type_evenement, *, montant="1000", devise="USD",
                  cantonnement="419-OFF-OFF-0042", jour=JOUR, minutes=0, payload=None,
                  subscription_id=None):
        """Événement métier brut. On le crée directement plutôt que par `investments.funding`
        : le contrat entre les deux apps est la LIGNE de file, pas le chemin qui l'a écrite —
        et le consommateur doit rester testable sans monter tout un projet d'investissement."""
        from investments.models import InvestmentEvent

        return InvestmentEvent.objects.create(
            event_type=type_evenement,
            amount=Decimal(montant),
            currency=devise,
            segregation_account=cantonnement,
            occurred_at=_horodatage(jour, minutes=minutes),
            actor_sub="gestionnaire-1",
            payload=payload or {},
            subscription_id=subscription_id,
        )

    def encaisser(self, **kwargs):
        """Un encaissement de souscription consommé — brique de départ de la plupart des cas."""
        evenement = self.evenement("SUBSCRIPTION_SETTLED", **kwargs)
        piece = consommation.consommer_evenement(evenement, par="cron:compta")
        evenement.refresh_from_db()
        return evenement, piece


# ------------------------------------------------------- ÉVÉNEMENT → PIÈCE

class EvenementVersPieceTests(ConsommationTestCase):
    def test_encaissement_souscription_produit_une_piece_equilibree(self):
        evenement, piece = self.encaisser(montant="5000")

        self.assertEqual(piece.evenement, "B10")
        self.assertEqual(piece.journal, "JIN")
        self.assertEqual(piece.statut, PieceComptable.Statut.VALIDEE)
        self.assertEqual(piece.date_operation, JOUR)
        # Traçabilité dans les deux sens : la pièce désigne l'événement, l'événement la pièce.
        self.assertEqual(piece.origine_type, "investments.InvestmentEvent")
        self.assertEqual(piece.origine_id, str(evenement.pk))
        self.assertEqual(evenement.journal_reference, piece.reference)
        self.assertIsNotNone(evenement.consumed_at)

        # B10 : débit trésorerie / crédit cantonnement de l'offre — équilibré en USD.
        self.assertEqual(piece.lignes.get(compte__code="511USD").debit, Decimal("5000.00"))
        self.assertEqual(
            piece.lignes.get(compte__code="419-OFF-OFF-0042USD").credit, Decimal("5000.00"),
        )
        totaux = services.equilibre_par_devise([
            {"devise": l.devise, "debit": l.debit, "credit": l.credit} for l in piece.lignes.all()
        ])
        self.assertEqual(totaux[Devise.USD]["debit"], totaux[Devise.USD]["credit"])
        self.assertEqual(services.controler_integrite(), [])

    def test_le_cantonnement_de_loffre_est_ouvert_par_la_comptabilite(self):
        """`investments` NOMME le sous-compte (419-OFF-xxxx) ; c'est la comptabilité qui
        l'ouvre. Sans cela, l'invariant de ségrégation du principe 9 dépendrait d'un geste
        manuel préalable à chaque levée."""
        from .models import CompteComptable

        self.assertFalse(CompteComptable.objects.filter(racine="419-OFF-OFF-0042").exists())
        self.encaisser()
        self.assertEqual(
            CompteComptable.objects.filter(racine="419-OFF-OFF-0042").count(), 2,  # FC + USD
        )
        self.assertEqual(
            services.solde_compte("419-OFF-OFF-0042", devise="USD"), Decimal("-1000.00"),
        )

    def test_decaissement_projet_et_distribution(self):
        self.encaisser(montant="10000")
        rapport = consommation.consommer_lot(par="cron:compta")  # rien d'autre en file
        self.assertEqual(rapport["examines"], 0)

        self.evenement("PROJECT_DISBURSED", montant="8000", minutes=10)
        self.evenement("DISTRIBUTION_PAID", montant="300", minutes=20)
        rapport = consommation.consommer_lot(par="cron:compta")

        self.assertEqual(len(rapport["consommes"]), 2)
        self.assertEqual([c["schema"] for c in rapport["consommes"]], ["B11", "B13"])
        # 10 000 encaissés − 8 000 décaissés − 300 distribués = 1 700 encore cantonnés.
        self.assertEqual(
            services.solde_compte("419-OFF-OFF-0042", devise="USD"), Decimal("-1700.00"),
        )
        self.assertEqual(services.controler_integrite(), [])

    def test_remboursement_sans_souscription_rattachee_reste_en_file(self):
        """La contrepassation vise la pièce d'encaissement DE CETTE souscription. Sans le
        lien, on ne sait pas quoi annuler — et on n'annule pas au hasard."""
        _, piece_b10 = self.encaisser(montant="2500")
        remboursement = self.evenement("SUBSCRIPTION_REFUNDED", montant="2500", minutes=30)

        with self.assertRaises(consommation.EvenementNonConsommable):
            consommation.consommer_evenement(remboursement, par="cron:compta")

        remboursement.refresh_from_db()
        self.assertIsNone(remboursement.consumed_at)
        self.assertEqual(piece_b10.contrepassations.count(), 0)


class ContrepassationTests(ConsommationTestCase):
    """Cas complet du remboursement, avec de vraies souscriptions en base."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        from accounts.models import FintechUser
        from investments.models import Investor, Offer, Project, Subscription

        user = FintechUser.objects.create(sub="inv-1", email="inv1@agricap.cd", role="investor")
        cls.investisseur = Investor.objects.create(user=user)
        cls.projet = Project.objects.create(code="PRJ-001", title="Maïs Kwilu")
        cls.offre = Offer.objects.create(project=cls.projet, code="OFF-0042",
                                          funding_goal=Decimal("50000"))
        cls.souscription = Subscription.objects.create(
            investor=cls.investisseur, offer=cls.offre, amount=Decimal("2500"),
            allocated_amount=Decimal("2500"), settled_amount=Decimal("2500"),
        )

    def test_remboursement_annule_exactement_lencaissement(self):
        encaissement, piece = self.encaisser(
            montant="2500", subscription_id=self.souscription.pk,
        )
        remboursement = self.evenement(
            "SUBSCRIPTION_REFUNDED", montant="2500", minutes=30,
            subscription_id=self.souscription.pk, payload={"reason": "Min-funding non atteint"},
        )
        inverse = consommation.consommer_evenement(remboursement, par="cron:compta")
        remboursement.refresh_from_db()

        self.assertEqual(inverse.piece_contrepassee_id, piece.pk)
        self.assertEqual(remboursement.journal_reference, inverse.reference)
        self.assertIn("Min-funding non atteint", inverse.motif)
        # Débits et crédits permutés : le cantonnement revient exactement à zéro.
        self.assertEqual(services.solde_compte("419-OFF-OFF-0042", devise="USD"), Decimal("0.00"))
        self.assertEqual(services.solde_compte("511", devise="USD"), Decimal("0.00"))
        self.assertEqual(services.controler_integrite(), [])

    def test_remboursement_partiel_refuse(self):
        """Une contrepassation annule une pièce ENTIÈRE. Un remboursement partiel n'est pas
        une contrepassation : plutôt que d'écrire une demi-annulation, on refuse."""
        self.encaisser(montant="2500", subscription_id=self.souscription.pk)
        partiel = self.evenement("SUBSCRIPTION_REFUNDED", montant="1000", minutes=30,
                                  subscription_id=self.souscription.pk)
        with self.assertRaises(consommation.EvenementNonConsommable) as ctx:
            consommation.consommer_evenement(partiel, par="cron:compta")
        self.assertIn("TOTALITÉ", str(ctx.exception))
        partiel.refresh_from_db()
        self.assertIsNone(partiel.consumed_at)

    def test_remboursement_avant_encaissement_reste_en_file(self):
        """L'ordre chronologique fait foi : tant que l'encaissement n'est pas au grand livre,
        il n'y a rien à contrepasser — et l'événement attend, il ne se perd pas."""
        remboursement = self.evenement("SUBSCRIPTION_REFUNDED", montant="2500",
                                        subscription_id=self.souscription.pk)
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["echecs"]), 1)
        remboursement.refresh_from_db()
        self.assertIsNone(remboursement.consumed_at)

        # L'encaissement arrive : le passage suivant consomme les deux, dans l'ordre.
        self.evenement("SUBSCRIPTION_SETTLED", montant="2500", minutes=-60,
                        subscription_id=self.souscription.pk)
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["consommes"]), 2)
        self.assertEqual(rapport["echecs"], [])
        self.assertEqual(services.solde_compte("419-OFF-OFF-0042", devise="USD"), Decimal("0.00"))


# ----------------------------------------------------------------- IDEMPOTENCE

class IdempotenceTests(ConsommationTestCase):
    def test_le_rejeu_ne_produit_aucune_ecriture_en_double(self):
        self.evenement("SUBSCRIPTION_SETTLED", montant="5000")
        premier = consommation.consommer_lot(par="cron:compta")
        pieces = PieceComptable.objects.count()
        lignes = LigneEcriture.objects.count()

        for _ in range(3):
            rejeu = consommation.consommer_lot(par="cron:compta")
            self.assertEqual(rejeu["examines"], 0)
            self.assertEqual(rejeu["consommes"], [])

        self.assertEqual(len(premier["consommes"]), 1)
        self.assertEqual(PieceComptable.objects.count(), pieces)
        self.assertEqual(LigneEcriture.objects.count(), lignes)
        self.assertEqual(services.solde_compte("511", devise="USD"), Decimal("5000.00"))

    def test_un_evenement_deja_consomme_nest_jamais_rejoue(self):
        evenement, piece = self.encaisser()
        with self.assertRaises(consommation.DejaConsomme):
            consommation.consommer_evenement(evenement, par="cron:compta")
        self.assertEqual(PieceComptable.objects.count(), 1)
        evenement.refresh_from_db()
        self.assertEqual(evenement.journal_reference, piece.reference)

    def test_la_reference_de_piece_est_deterministe(self):
        evenement, piece = self.encaisser()
        self.assertEqual(piece.reference, f"INV-20260721-B10-{evenement.pk}")

    def test_reprise_apres_incident_adopte_la_piece_existante(self):
        """Pièce présente, événement non marqué (incident d'exploitation) : on ADOPTE la
        pièce et on marque, plutôt que d'en créer une seconde pour le même fait."""
        evenement, piece = self.encaisser()
        from investments.models import InvestmentEvent

        InvestmentEvent.objects.filter(pk=evenement.pk).update(
            consumed_at=None, journal_reference="",
        )
        evenement.refresh_from_db()

        reprise = consommation.consommer_evenement(evenement, par="cron:compta")
        evenement.refresh_from_db()
        self.assertEqual(reprise.pk, piece.pk)
        self.assertEqual(PieceComptable.objects.count(), 1)
        self.assertEqual(evenement.journal_reference, piece.reference)

    def test_reference_homonyme_dune_autre_origine_refusee(self):
        """Une référence déjà prise par une pièce d'une AUTRE origine est un incident, pas
        une reprise : on n'adopte pas la pièce de quelqu'un d'autre."""
        evenement = self.evenement("SUBSCRIPTION_SETTLED", montant="900")
        services.creer_sous_compte_cantonnement(offre_ref="OFF-0042")
        services.enregistrer_piece(
            reference=f"INV-20260721-B10-{evenement.pk}",
            date_operation=JOUR, journal="JIN", par="comptable",
            lignes=[
                {"compte": "511", "devise": "USD", "debit": "900", "credit": 0},
                {"compte": "419-OFF-OFF-0042", "devise": "USD", "debit": 0, "credit": "900"},
            ],
        )
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["echecs"]), 1)
        evenement.refresh_from_db()
        self.assertIsNone(evenement.consumed_at)


# ------------------------------------------------------ ROBUSTESSE DU LOT

class RobustesseDuLotTests(ConsommationTestCase):
    def test_un_echec_nempeche_pas_les_suivants(self):
        """Un événement bancal ne gèle pas la comptabilité de tous les autres."""
        bancal = self.evenement("SUBSCRIPTION_SETTLED", montant="1000", cantonnement="",
                                 minutes=1)
        bon_1 = self.evenement("SUBSCRIPTION_SETTLED", montant="2000", minutes=2)
        bon_2 = self.evenement("PROJECT_DISBURSED", montant="500", minutes=3)

        rapport = consommation.consommer_lot(par="cron:compta")

        self.assertEqual(rapport["examines"], 3)
        self.assertEqual(len(rapport["consommes"]), 2)
        self.assertEqual(len(rapport["echecs"]), 1)
        self.assertEqual(rapport["echecs"][0]["evenement_id"], bancal.pk)
        self.assertEqual(rapport["restant_en_file"], 1)

        for evenement in (bon_1, bon_2):
            evenement.refresh_from_db()
            self.assertIsNotNone(evenement.consumed_at)
        bancal.refresh_from_db()
        self.assertIsNone(bancal.consumed_at)
        self.assertEqual(bancal.journal_reference, "")
        self.assertEqual(services.controler_integrite(), [])

    def test_un_echec_ne_laisse_aucune_ecriture_partielle(self):
        """« Pièce générée + événement marqué », jamais l'un sans l'autre."""
        self.evenement("SUBSCRIPTION_SETTLED", montant="0")
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["echecs"]), 1)
        self.assertEqual(PieceComptable.objects.count(), 0)
        self.assertEqual(LigneEcriture.objects.count(), 0)

    def test_devise_inconnue_refusee(self):
        self.evenement("SUBSCRIPTION_SETTLED", montant="100", devise="EUR")
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["echecs"]), 1)
        self.assertIn("EUR", rapport["echecs"][0]["motif"])
        self.assertEqual(PieceComptable.objects.count(), 0)

    def test_le_lot_respecte_la_limite_et_lordre_chronologique(self):
        for index in range(5):
            self.evenement("SUBSCRIPTION_SETTLED", montant="100", minutes=index)
        rapport = consommation.consommer_lot(par="cron:compta", limite=2)
        self.assertEqual(rapport["examines"], 2)
        self.assertEqual(rapport["restant_en_file"], 3)

    def test_filtre_jusqu_au_ne_consomme_pas_au_dela_de_la_periode(self):
        self.evenement("SUBSCRIPTION_SETTLED", montant="100")
        self.evenement("SUBSCRIPTION_SETTLED", montant="200", jour=date(2026, 8, 5))
        rapport = consommation.consommer_lot(par="cron:compta", jusqu_au=date(2026, 7, 31))
        self.assertEqual(len(rapport["consommes"]), 1)
        self.assertEqual(rapport["restant_en_file"], 1)


# --------------------------------------------- ÉVÉNEMENTS SANS ÉCRITURE DÉFINIE

class SansEcritureDefinieTests(ConsommationTestCase):
    def test_defaut_de_projet_reste_non_consomme(self):
        """L'annexe B ne définit AUCUNE écriture pour le défaut d'un projet
        d'investissement (B6/B7 provisionnent le risque de CRÉDIT). L'événement reste donc
        en file, visible, plutôt que de recevoir une écriture inventée."""
        defaut = self.evenement("PROJECT_DEFAULTED", montant="8000")
        rapport = consommation.consommer_lot(par="cron:compta")

        self.assertEqual(rapport["consommes"], [])
        self.assertEqual(len(rapport["sans_ecriture"]), 1)
        self.assertEqual(rapport["sans_ecriture"][0]["evenement_id"], defaut.pk)
        self.assertIn("schéma de l'annexe B ne couvre le défaut",
                      rapport["sans_ecriture"][0]["motif"])
        self.assertEqual(PieceComptable.objects.count(), 0)

        defaut.refresh_from_db()
        self.assertIsNone(defaut.consumed_at)
        self.assertEqual(defaut.journal_reference, "")

        # Et il reste visible au passage suivant : la dette ne s'efface pas d'elle-même.
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["sans_ecriture"]), 1)

    def test_retour_de_projet_sans_ventilation_reste_en_file(self):
        """B12 ventile « selon l'échéancier » entre capital (419-OFF) et rendement (719).
        Cette répartition ne se déduit PAS d'un total : tant que l'événement ne la porte
        pas, aucune écriture n'est passée — un produit 719 inventé fausserait durablement
        le résultat et le rendement affiché à l'investisseur."""
        retour = self.evenement("PROJECT_RETURN_RECEIVED", montant="1200")
        rapport = consommation.consommer_lot(par="cron:compta")

        self.assertEqual(len(rapport["sans_ecriture"]), 1)
        motif = rapport["sans_ecriture"][0]["motif"]
        self.assertIn("capital_rembourse", motif)
        self.assertIn("rendement", motif)
        self.assertEqual(PieceComptable.objects.count(), 0)
        retour.refresh_from_db()
        self.assertIsNone(retour.consumed_at)

    def test_retour_de_projet_sans_total_redondant_est_consomme(self):
        """Le producteur n'a aucune raison de recalculer un total que le schéma détermine.

        `capital_rembourse` + `rendement` suffisent : `retour_total` est FORCÉ par
        l'équation d'équilibre de B12, et la valeur déduite est confrontée au montant réel
        de l'événement avant tout enregistrement. Rien n'est deviné — c'est le cas inverse
        (total connu, ventilation inconnue) qui reste un refus, et il l'est."""
        self.encaisser(montant="10000")
        self.evenement(
            "PROJECT_RETURN_RECEIVED", montant="1200", minutes=10,
            payload={"capitalRembourse": "1000", "rendement": "200"},
        )
        rapport = consommation.consommer_lot(par="cron:compta")

        self.assertEqual(len(rapport["consommes"]), 1, rapport)
        piece = PieceComptable.objects.get(evenement="B12")
        self.assertEqual(piece.lignes.get(compte__code="511USD").debit, Decimal("1200.00"))
        self.assertEqual(piece.lignes.get(compte__code="719USD").credit, Decimal("200.00"))
        self.assertEqual(services.controler_integrite(), [])

    def test_ventilation_deduite_qui_contredit_le_fait_est_refusee(self):
        """La déduction ne dispense de rien : 1 000 + 150 ≠ 1 200 encaissés, donc la pièce
        ne décrit pas le même fait et n'est pas enregistrée."""
        self.encaisser(montant="10000")
        self.evenement(
            "PROJECT_RETURN_RECEIVED", montant="1200", minutes=10,
            payload={"capital_rembourse": "1000", "rendement": "150"},
        )
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["echecs"]), 1)
        self.assertFalse(PieceComptable.objects.filter(evenement="B12").exists())

    def test_retour_de_projet_ventile_par_investments_est_consomme(self):
        """Le jour où `investments` porte la ventilation dans son payload, le même
        événement devient consommable SANS toucher au code : le contrat est la donnée."""
        self.encaisser(montant="10000")
        self.evenement(
            "PROJECT_RETURN_RECEIVED", montant="1200", minutes=10,
            payload={"retour_total": "1200", "capital_rembourse": "1000", "rendement": "200"},
        )
        rapport = consommation.consommer_lot(par="cron:compta")

        self.assertEqual(len(rapport["consommes"]), 1)
        piece = PieceComptable.objects.get(evenement="B12")
        self.assertEqual(piece.lignes.get(compte__code="511USD").debit, Decimal("1200.00"))
        self.assertEqual(
            piece.lignes.get(compte__code="419-OFF-OFF-0042USD").credit, Decimal("1000.00"),
        )
        self.assertEqual(piece.lignes.get(compte__code="719USD").credit, Decimal("200.00"))
        self.assertEqual(services.controler_integrite(), [])

    def test_ventilation_incoherente_avec_le_montat_de_levenement_refusee(self):
        """La ventilation fournie doit décrire le MÊME fait que l'événement : une pièce qui
        mouvementerait 1 500 pour un encaissement de 1 200 est refusée en bloc."""
        self.encaisser(montant="10000")
        self.evenement(
            "PROJECT_RETURN_RECEIVED", montant="1200", minutes=10,
            payload={"retour_total": "1500", "capital_rembourse": "1300", "rendement": "200"},
        )
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["echecs"]), 1)
        self.assertFalse(PieceComptable.objects.filter(evenement="B12").exists())

    def test_type_devenement_inconnu_reste_en_file(self):
        self.evenement("SOMETHING_NEW", montant="100")
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["sans_ecriture"]), 1)
        self.assertIn("Aucune règle de consommation", rapport["sans_ecriture"][0]["motif"])

    def test_regle_desactivee_suspend_la_consommation(self):
        """Débrancher un mapping est un geste de PARAMÉTRAGE : les événements s'accumulent
        en file, ils ne se perdent pas et ne s'écrivent pas de travers."""
        RegleConsommation.objects.filter(type_evenement="SUBSCRIPTION_SETTLED").update(actif=False)
        self.evenement("SUBSCRIPTION_SETTLED", montant="100")
        rapport = consommation.consommer_lot(par="cron:compta")
        self.assertEqual(len(rapport["sans_ecriture"]), 1)
        self.assertEqual(PieceComptable.objects.count(), 0)


# ----------------------------------------------------------- PARAMÉTRAGE EN BASE

class ParametrageTests(ConsommationTestCase):
    def test_le_compte_de_tresorerie_se_change_en_base(self):
        """Principe 8 : le choix 501/511/53x que l'annexe B laisse ouvert se tranche en
        base, sans redéploiement."""
        RegleConsommation.objects.filter(type_evenement="SUBSCRIPTION_SETTLED").update(
            compte_tresorerie="501",
        )
        _, piece = self.encaisser(montant="700")
        self.assertEqual(piece.lignes.get(compte__code="501USD").debit, Decimal("700.00"))
        self.assertFalse(piece.lignes.filter(compte__code="511USD").exists())

    def test_levenement_peut_designer_son_canal_reel(self):
        """Un événement qui SAIT par quel canal l'argent est passé (mobile money) l'emporte
        sur le défaut de la règle — sans quoi tous les flux atterriraient en banque."""
        _, piece = self.encaisser(montant="300", payload={"compteTresorerie": "533"})
        self.assertEqual(piece.lignes.get(compte__code="533USD").debit, Decimal("300.00"))

    def test_les_regles_damorce_sont_idempotentes(self):
        avant = RegleConsommation.objects.count()
        call_command("seed_accounting", verbosity=0)
        self.assertEqual(RegleConsommation.objects.count(), avant)

    def test_le_rechargement_necrase_pas_un_mapping_ajuste(self):
        RegleConsommation.objects.filter(type_evenement="SUBSCRIPTION_SETTLED").update(
            compte_tresorerie="531",
        )
        call_command("seed_accounting", verbosity=0)
        regle = RegleConsommation.objects.get(type_evenement="SUBSCRIPTION_SETTLED")
        self.assertEqual(regle.compte_tresorerie, "531")


# ------------------------------------------------------------------- SIMULATION

class SimulationTests(ConsommationTestCase):
    def test_la_simulation_necrit_aucune_piece(self):
        self.evenement("SUBSCRIPTION_SETTLED", montant="4000")
        rapport = consommation.simuler_lot()
        self.assertEqual(len(rapport["plans"]), 1)
        self.assertEqual(rapport["plans"][0]["schema"], "B10")
        self.assertEqual(PieceComptable.objects.count(), 0)

    def test_la_commande_en_simulation_ne_laisse_rien(self):
        from io import StringIO

        from .models import CompteComptable

        self.evenement("SUBSCRIPTION_SETTLED", montant="4000")
        sortie = StringIO()
        call_command("consume_investment_events", "--simulation", stdout=sortie)

        self.assertIn("SIMULATION", sortie.getvalue())
        self.assertEqual(PieceComptable.objects.count(), 0)
        # Pas même les sous-comptes de cantonnement ouverts par la résolution.
        self.assertFalse(CompteComptable.objects.filter(racine="419-OFF-OFF-0042").exists())

    def test_la_commande_exige_une_identite(self):
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError):
            call_command("consume_investment_events", verbosity=0)

    def test_la_commande_consomme_et_rend_compte(self):
        from io import StringIO

        evenement = self.evenement("SUBSCRIPTION_SETTLED", montant="4000")
        self.evenement("PROJECT_DEFAULTED", montant="100", minutes=5)
        sortie = StringIO()
        call_command("consume_investment_events", "--par", "cron:compta", stdout=sortie)

        texte = sortie.getvalue()
        self.assertIn("1 consommé(s)", texte)
        self.assertIn("SANS ÉCRITURE DÉFINIE", texte)
        evenement.refresh_from_db()
        self.assertEqual(evenement.journal_reference, f"INV-20260721-B10-{evenement.pk}")


# ------------------------------------------------------------------ JOURNALISATION

class JournalisationTests(ConsommationTestCase):
    def test_chaque_consommation_est_journalisee(self):
        from audit.models import AuditEntry

        evenement, piece = self.encaisser(montant="1500")
        trace = AuditEntry.objects.filter(
            action="accounting.evenement_consomme", entity_id=str(evenement.pk),
        ).first()
        self.assertIsNotNone(trace)
        self.assertEqual(trace.actor, "cron:compta")
        self.assertEqual(trace.details["piece"], piece.reference)
        self.assertEqual(trace.details["schema"], "B10")
        self.assertEqual(trace.details["montant"], "1500.00")


# ======================================================================
#  PLURI-SOURCES — le consommateur ne connaît aucune file en particulier
# ======================================================================
#
# Ces tests sont la preuve que « brancher une file est un geste de paramétrage » n'est pas
# une intention de docstring : crédit (B1→B4) et épargne (B8/B9) empruntent EXACTEMENT le
# même code que l'investissement, et rien dans `consommation.py` ne les nomme.


class ContratDesFilesProductricesTests(ConsommationTestCase):
    """Le contrat entre une app productrice et la comptabilité est vérifié ICI, une fois,
    plutôt que découvert en production sur le premier événement d'un lot."""

    def test_les_constantes_de_source_ne_divergent_pas_des_producteurs(self):
        """`accounting` duplique volontairement le nom de chaque file plutôt que d'importer
        l'app productrice au chargement. Le prix de ce choix est ce test : si un producteur
        renomme sa file, il casse ici — pas six mois plus tard, sur une file muette."""
        from credits.events import SOURCE_CREDIT
        from savings.events import SOURCE_EPARGNE

        from .definitions import SOURCE_CREDIT as CREDIT_COMPTA
        from .definitions import SOURCE_EPARGNE as EPARGNE_COMPTA

        self.assertEqual(SOURCE_CREDIT, CREDIT_COMPTA)
        self.assertEqual(SOURCE_EPARGNE, EPARGNE_COMPTA)

    def test_chaque_file_declaree_respecte_le_contrat_de_consommation(self):
        from .models import SourceEvenements

        declarees = list(SourceEvenements.objects.filter(actif=True))
        self.assertTrue(declarees, "Aucune file déclarée : la comptabilité serait aveugle.")
        for declaration in declarees:
            with self.subTest(source=declaration.code):
                modele = consommation._modele_evenement(declaration.code)
                champs = {champ.name for champ in modele._meta.get_fields()}
                for nom in consommation.CONTRAT_FILE:
                    self.assertIn(nom, champs)

    def test_aucun_type_devenement_produit_nest_orphelin_de_regle(self):
        """Un type qu'un producteur peut émettre et que la comptabilité ne mappe pas est un
        fait monétaire qui n'atteindrait JAMAIS le grand livre. Le seul cas toléré est une
        règle explicitement `SANS_ECRITURE` — un choix, pas un oubli."""
        from credits.models import CreditEvent
        from investments.models import InvestmentEvent
        from savings.models import SavingsEvent

        from .definitions import SOURCE_CREDIT, SOURCE_EPARGNE

        for source, modele in (
            (SOURCE_INVESTISSEMENT, InvestmentEvent),
            (SOURCE_CREDIT, CreditEvent),
            (SOURCE_EPARGNE, SavingsEvent),
        ):
            mappes = set(
                RegleConsommation.objects.filter(source=source)
                .values_list("type_evenement", flat=True)
            )
            for valeur in modele.Type.values:
                with self.subTest(source=source, type=valeur):
                    self.assertIn(valeur, mappes)


class FileCreditTests(ConsommationTestCase):
    """B1→B4 — le métier principal entre enfin au grand livre.

    Aucun de ces événements ne porte de cantonnement d'offre, et c'est tout l'enjeu : la
    version « investissement » du consommateur résolvait `$CANTONNEMENT` pour TOUS les
    schémas, et aurait bloqué 100 % de cette file avant son premier événement.
    """

    def evenement_credit(self, type_evenement, *, montant="1000", devise="USD",
                         minutes=0, payload=None):
        from credits.models import CreditEvent

        return CreditEvent.objects.create(
            event_type=type_evenement,
            amount=Decimal(montant),
            currency=devise,
            occurred_at=_horodatage(minutes=minutes),
            actor_sub="agent-1",
            payload=payload or {},
        )

    def consommer(self):
        from .definitions import SOURCE_CREDIT

        return consommation.consommer_lot(par="cron:compta", source=SOURCE_CREDIT)

    def test_decaissement_de_credit_fait_naitre_lencours_413(self):
        evenement = self.evenement_credit("CREDIT_DISBURSED", montant="2500")
        rapport = self.consommer()

        self.assertEqual(len(rapport["consommes"]), 1, rapport)
        piece = PieceComptable.objects.get(evenement="B1")
        self.assertEqual(piece.journal, "JCR")
        self.assertEqual(piece.lignes.get(compte__code="413USD").debit, Decimal("2500.00"))
        self.assertEqual(piece.lignes.get(compte__code="511USD").credit, Decimal("2500.00"))
        # La référence porte le préfixe de SA file : deux files peuvent numéroter pareil.
        self.assertEqual(piece.reference, f"CRE-20260721-B1-{evenement.pk}")
        evenement.refresh_from_db()
        self.assertEqual(evenement.journal_reference, piece.reference)
        self.assertEqual(services.controler_integrite(), [])

    def test_une_echeance_encaissee_produit_deux_pieces_distinctes(self):
        """Capital et intérêts ne mouvementent ni les mêmes comptes ni les mêmes classes :
        le producteur émet DEUX événements, la comptabilité passe DEUX pièces."""
        self.evenement_credit("CREDIT_PRINCIPAL_REPAID", montant="100", minutes=1)
        self.evenement_credit("CREDIT_INTEREST_COLLECTED", montant="18", minutes=2)
        rapport = self.consommer()

        self.assertEqual([c["schema"] for c in rapport["consommes"]], ["B2", "B3"])
        capital = PieceComptable.objects.get(evenement="B2")
        self.assertEqual(capital.lignes.get(compte__code="413USD").credit, Decimal("100.00"))
        interets = PieceComptable.objects.get(evenement="B3")
        self.assertEqual(interets.lignes.get(compte__code="701USD").credit, Decimal("18.00"))
        self.assertEqual(services.solde_compte("511", devise="USD"), Decimal("118.00"))
        self.assertEqual(services.controler_integrite(), [])

    def test_commission_encaissee_alimente_le_702(self):
        self.evenement_credit("CREDIT_COMMISSION_COLLECTED", montant="45")
        self.consommer()
        piece = PieceComptable.objects.get(evenement="B4")
        self.assertEqual(piece.lignes.get(compte__code="702USD").credit, Decimal("45.00"))

    def test_le_franc_congolais_du_portefeuille_est_traduit(self):
        """`portfolio` et `credits` disent « CDF », l'annexe A dit « FC » : la traduction
        est centralisée, jamais devinée ligne à ligne."""
        self.evenement_credit("CREDIT_DISBURSED", montant="500000", devise="CDF")
        self.consommer()
        piece = PieceComptable.objects.get(evenement="B1")
        self.assertEqual(piece.lignes.get(compte__code="413FC").debit, Decimal("500000.00"))

    def test_le_canal_reel_de_lencaissement_lemporte_sur_le_defaut(self):
        """Un remboursement encaissé par Airtel Money ne doit pas atterrir en banque parce
        que c'est le défaut de la règle."""
        self.evenement_credit("CREDIT_PRINCIPAL_REPAID", montant="60000", devise="CDF",
                              payload={"compteTresorerie": "531"})
        self.consommer()
        piece = PieceComptable.objects.get(evenement="B2")
        self.assertEqual(piece.lignes.get(compte__code="531FC").debit, Decimal("60000.00"))

    def test_une_file_ne_consomme_pas_les_evenements_dune_autre(self):
        """Chaque file a son lot, son compteur et son préfixe. Un passage sur le crédit ne
        doit ni consommer ni comptabiliser les événements d'investissement en attente."""
        self.evenement("SUBSCRIPTION_SETTLED", montant="4000")
        self.evenement_credit("CREDIT_DISBURSED", montant="2500", minutes=5)

        rapport = self.consommer()
        self.assertEqual(rapport["examines"], 1)
        self.assertEqual(rapport["restant_en_file"], 0)
        self.assertEqual(PieceComptable.objects.count(), 1)

        rapport = consommation.consommer_lot(par="cron:compta")  # file investissement
        self.assertEqual(rapport["examines"], 1)
        self.assertEqual(PieceComptable.objects.count(), 2)


class FileEpargneTests(ConsommationTestCase):
    """B8/B9 — le branchement est FAIT, l'écriture ne l'est pas : il manque un COMPTE.

    L'argent d'un dépôt vient du portefeuille électronique du membre. Sa contrepartie est
    donc l'extinction d'une dette (passif → passif), et l'annexe A n'a pas de compte pour
    elle. Les deux échappatoires sont fausses, chacune à sa façon : une caisse compterait
    deux fois le même franc, et le transitoire 581 — un compte d'ACTIF — gonflerait le
    total du bilan des deux côtés d'un actif qui n'existe pas.

    Ces tests verrouillent donc les DEUX moitiés de la réponse : on refuse d'écrire tant
    que le compte manque, et tout le reste de la chaîne est prêt à écrire dès qu'il existe.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        from accounts.models import FintechUser
        from savings.models import SavingsPlan

        user = FintechUser.objects.create(sub="epargnant-1", email="e1@agricap.cd")
        cls.plan = SavingsPlan.objects.create(user=user, name="Campagne maïs", currency="USD")

    def evenement_epargne(self, type_evenement, *, montant="200", minutes=0):
        from savings.models import SavingsEvent

        return SavingsEvent.objects.create(
            event_type=type_evenement,
            plan=self.plan,
            amount=Decimal(montant),
            currency=self.plan.currency,
            occurred_at=_horodatage(minutes=minutes),
            actor_sub="agent-1",
            payload={"flux": "INTERNE", "contrepartieReelle": "WALLET_CLIENT"},
        )

    def consommer(self):
        from .definitions import SOURCE_EPARGNE

        return consommation.consommer_lot(par="cron:compta", source=SOURCE_EPARGNE)

    def ouvrir_le_compte_de_dette_de_portefeuille(self) -> str:
        """Simule la décision du fondateur : le compte manquant est ouvert, et les deux
        règles sont rebranchées PAR COMMANDE — sans toucher une ligne de code."""
        from .models import CompteComptable

        for devise in ("FC", "USD"):
            CompteComptable.objects.create(
                code=f"418{devise}", racine="418", devise=devise, classe=4, nature="PASSIF",
                intitule="Monnaie électronique due aux clients (portefeuilles)",
            )
        for type_evenement, schema in (("SAVINGS_DEPOSITED", "B8"),
                                       ("SAVINGS_WITHDRAWN", "B9")):
            call_command(
                "parametrer_consommation", "regle", "--source", "savings.SavingsEvent",
                "--type", type_evenement, "--mode", "PIECE", "--schema", schema,
                "--tresorerie", "418", "--par", "dg", verbosity=0,
            )
        return "418"

    def test_sans_compte_de_contrepartie_aucune_ecriture_nest_passee(self):
        """La moitié « on refuse » : le dépôt reste en file, visible, avec un motif qui dit
        CE QUI MANQUE — pas une panne, une dette de plan comptable."""
        depot = self.evenement_epargne("SAVINGS_DEPOSITED", montant="200")
        rapport = self.consommer()

        self.assertEqual(rapport["consommes"], [])
        self.assertEqual(len(rapport["sans_ecriture"]), 1)
        motif = rapport["sans_ecriture"][0]["motif"]
        self.assertIn("classe 4", motif)
        self.assertIn("PASSIF", motif)
        self.assertEqual(PieceComptable.objects.count(), 0)

        depot.refresh_from_db()
        self.assertIsNone(depot.consumed_at)
        # Et il reste visible au passage suivant : la dette ne s'efface pas d'elle-même.
        self.assertEqual(len(self.consommer()["sans_ecriture"]), 1)

    def test_aucune_ecriture_dattente_ne_gonfle_le_bilan(self):
        """Le piège écarté : imputer la contrepartie au transitoire 581 aurait « fait
        entrer l'épargne au grand livre » — au prix d'un ACTIF inexistant, gonflant le
        total du bilan des deux côtés et faussant tout ratio qui s'y adosse."""
        self.evenement_epargne("SAVINGS_DEPOSITED", montant="200")
        self.consommer()

        self.assertEqual(services.solde_compte("581", devise="USD"), Decimal("0.00"))
        self.assertEqual(services.solde_compte("412", devise="USD"), Decimal("0.00"))
        self.assertEqual(services.solde_compte("511", devise="USD"), Decimal("0.00"))

    def test_le_compte_ouvert_debloque_les_deux_sens_sans_toucher_au_code(self):
        """La moitié « tout le reste est prêt » : dès que le compte existe, la même file,
        les mêmes schémas et le même consommateur produisent les écritures attendues."""
        compte = self.ouvrir_le_compte_de_dette_de_portefeuille()
        depot = self.evenement_epargne("SAVINGS_DEPOSITED", montant="500", minutes=1)
        self.evenement_epargne("SAVINGS_WITHDRAWN", montant="120", minutes=2)
        rapport = self.consommer()

        self.assertEqual([c["schema"] for c in rapport["consommes"]], ["B8", "B9"])
        piece = PieceComptable.objects.get(evenement="B8")
        self.assertEqual(piece.journal, "JEP")
        self.assertEqual(piece.reference, f"EPA-20260721-B8-{depot.pk}")
        self.assertEqual(piece.lignes.get(compte__code="412USD").credit, Decimal("500.00"))

        retrait = PieceComptable.objects.get(evenement="B9")
        self.assertEqual(retrait.lignes.get(compte__code="412USD").debit, Decimal("120.00"))
        # 412 est un PASSIF : la dette résiduelle de 380 apparaît au crédit (donc en solde
        # négatif dans la convention « débit − crédit » de `solde_compte`).
        self.assertEqual(services.solde_compte("412", devise="USD"), Decimal("-380.00"))
        # La contrepartie est bien un PASSIF qui s'éteint, et aucun actif n'a été fabriqué.
        self.assertEqual(services.solde_compte(compte, devise="USD"), Decimal("380.00"))
        self.assertEqual(services.solde_compte("581", devise="USD"), Decimal("0.00"))
        self.assertEqual(services.controler_integrite(), [])


class DeclarationDesSourcesTests(ConsommationTestCase):
    def test_une_file_non_declaree_ne_se_lit_pas(self):
        with self.assertRaises(consommation.SansEcritureDefinie) as ctx:
            consommation.consommer_lot(par="cron:compta", source="inconnue.Machin")
        self.assertIn("n'est pas déclarée", str(ctx.exception))

    def test_une_file_desactivee_suspend_toute_lecture(self):
        from .models import SourceEvenements

        self.evenement("SUBSCRIPTION_SETTLED", montant="100")
        SourceEvenements.objects.filter(code=SOURCE_INVESTISSEMENT).update(actif=False)
        with self.assertRaises(consommation.SansEcritureDefinie):
            consommation.consommer_lot(par="cron:compta")
        self.assertEqual(PieceComptable.objects.count(), 0)

    def test_une_file_qui_designe_un_modele_absent_le_dit(self):
        from .models import SourceEvenements

        SourceEvenements.objects.create(
            code="banc.Essai", modele="nulle_part.Fantome", prefixe_reference="TST",
        )
        with self.assertRaises(consommation.SansEcritureDefinie) as ctx:
            consommation.consommer_lot(par="cron:compta", source="banc.Essai")
        self.assertIn("Django ne connaît pas", str(ctx.exception))

    def test_le_prefixe_de_reference_se_change_en_base(self):
        from .models import SourceEvenements

        SourceEvenements.objects.filter(code=SOURCE_INVESTISSEMENT).update(
            prefixe_reference="SOUS",
        )
        _, piece = self.encaisser(montant="100")
        self.assertTrue(piece.reference.startswith("SOUS-"), piece.reference)

    def test_la_commande_de_parametrage_pose_source_et_regle(self):
        """« Brancher une file est un geste de configuration » : sans chemin pour écrire ces
        deux lignes hors déploiement, la promesse serait creuse."""
        from io import StringIO

        from .models import SourceEvenements

        sortie = StringIO()
        call_command("parametrer_consommation", "source", "--code", "banc.File",
                     "--modele", "investments.InvestmentEvent", "--prefixe", "BAN",
                     "--par", "dg", stdout=sortie)
        call_command("parametrer_consommation", "regle", "--source", "banc.File",
                     "--type", "SUBSCRIPTION_SETTLED", "--schema", "B10",
                     "--tresorerie", "501", "--par", "dg", stdout=sortie)

        self.assertEqual(SourceEvenements.objects.get(code="banc.File").prefixe_reference, "BAN")
        evenement = self.evenement("SUBSCRIPTION_SETTLED", montant="700")
        rapport = consommation.consommer_lot(par="cron:compta", source="banc.File")
        self.assertEqual(len(rapport["consommes"]), 1, rapport)
        piece = PieceComptable.objects.get(reference=f"BAN-20260721-B10-{evenement.pk}")
        self.assertEqual(piece.lignes.get(compte__code="501USD").debit, Decimal("700.00"))

    def test_letat_du_parametrage_signale_une_regle_sans_file(self):
        from io import StringIO

        RegleConsommation.objects.create(
            source="fantome.File", type_evenement="X", schema="B10",
        )
        sortie = StringIO()
        call_command("parametrer_consommation", "etat", stdout=sortie)
        self.assertIn("RÈGLES SANS FILE DÉCLARÉE", sortie.getvalue())

    def test_la_commande_refuse_une_regle_sur_une_file_non_declaree(self):
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError):
            call_command("parametrer_consommation", "regle", "--source", "banc.Absente",
                         "--type", "X", "--schema", "B10", "--par", "dg", verbosity=0)

    def test_la_commande_refuse_un_schema_absent_du_catalogue(self):
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError) as ctx:
            call_command("parametrer_consommation", "regle", "--source", SOURCE_INVESTISSEMENT,
                         "--type", "X", "--schema", "B99", "--par", "dg", verbosity=0)
        self.assertIn("B99", str(ctx.exception))

    def test_la_commande_de_parametrage_exige_une_identite(self):
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError):
            call_command("parametrer_consommation", "source", "--code", "x.Y",
                         "--prefixe", "X", verbosity=0)

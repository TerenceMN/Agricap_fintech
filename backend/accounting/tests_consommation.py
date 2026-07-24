"""Tests du consommateur d'événements métier (`accounting.consommation`).

Ce que ces tests verrouillent, dans l'ordre d'importance :

1. **un événement métier produit UNE pièce ÉQUILIBRÉE** — la file n'est plus muette ;
2. **le rejeu ne produit AUCUNE écriture en double** (c'est tout l'objet de `consumed_at`) ;
3. **un échec isolé n'interrompt pas le lot** — un événement bancal ne gèle pas la compta ;
4. **un événement sans écriture définie reste NON consommé** — on ne vide pas une file en
   inventant une écriture.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from . import consommation, services
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

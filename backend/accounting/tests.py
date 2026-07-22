"""Tests du socle comptable. Les tests d'INVARIANT sont bloquants : équilibre par devise,
contrepassation/append-only, dénouement du 588FX, et le cas chiffré de l'annexe E.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase

from common.exceptions import NotFoundError, ValidationFailed

from . import catalogue, fx, services
from .models import (
    CompteComptable,
    EventEntryTemplate,
    EventEntryTemplateLine,
    LigneEcriture,
    PieceComptable,
    TauxChange,
)

JOUR = date(2026, 7, 21)


class SocleTestCase(TestCase):
    """Base commune : le référentiel est chargé par la commande idempotente, jamais à la main
    dans les tests — on teste ainsi le chemin réel d'installation."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_accounting", verbosity=0)
        cls.taux = TauxChange.objects.create(
            date_taux=JOUR,
            usage=TauxChange.Usage.OPERATIONNEL,
            devise_base="USD", devise_contre="FC",
            taux=Decimal("2800.000000"),
            source=TauxChange.Source.BCC,
            source_reference="BCC — cours indicatif du jour",
            saisi_par="tresorier", valide_par="chef_compta",
        )


# ---------------------------------------------------------------- PLAN COMPTABLE

class PlanComptableTests(SocleTestCase):
    def test_comptes_dedoubles_par_devise(self):
        for code in ("413FC", "413USD", "137FC", "137USD", "588FC", "588USD",
                     "501FC", "501USD", "412FC", "419USD"):
            self.assertTrue(
                CompteComptable.objects.filter(code=code).exists(),
                f"Compte {code} absent du plan comptable (annexe A).",
            )

    def test_comptes_non_dedoubles(self):
        for code in ("101", "421", "581", "613FX", "712FX"):
            compte = CompteComptable.objects.get(code=code)
            self.assertEqual(compte.devise, "", f"{code} ne doit pas être mono-devise.")

    def test_transitoires_marques(self):
        self.assertTrue(CompteComptable.objects.get(code="588FC").est_transitoire)
        self.assertTrue(CompteComptable.objects.get(code="581").est_transitoire)

    def test_resolution_par_racine(self):
        self.assertEqual(services.resoudre_compte("413", "USD").code, "413USD")
        self.assertEqual(services.resoudre_compte("712FX", "FC").code, "712FX")

    def test_resolution_refuse_mauvaise_devise(self):
        with self.assertRaises(ValidationFailed):
            services.resoudre_compte("531FC", "USD")

    def test_resolution_compte_inexistant(self):
        with self.assertRaises(NotFoundError):
            services.resoudre_compte("999", "FC")

    def test_seed_idempotent(self):
        avant = (CompteComptable.objects.count(),
                 EventEntryTemplate.objects.count(),
                 EventEntryTemplateLine.objects.count())
        call_command("seed_accounting", verbosity=0)
        call_command("seed_accounting", verbosity=0)
        apres = (CompteComptable.objects.count(),
                 EventEntryTemplate.objects.count(),
                 EventEntryTemplateLine.objects.count())
        self.assertEqual(avant, apres, "Le chargement du référentiel n'est pas idempotent.")

    def test_compte_mouvemente_non_supprimable(self):
        _piece_simple("PC-DEL")
        with self.assertRaises(ValidationFailed):
            CompteComptable.objects.get(code="501FC").delete()


# ------------------------------------------------------------ INVARIANT D'ÉQUILIBRE

def _piece_simple(reference: str, montant="1000.00") -> PieceComptable:
    return services.enregistrer_piece(
        reference=reference,
        date_operation=JOUR,
        journal="JCR",
        libelle="Décaissement de test",
        lignes=[
            {"compte": "413", "devise": "FC", "debit": montant, "credit": "0"},
            {"compte": "501", "devise": "FC", "debit": "0", "credit": montant},
        ],
        par="testeur",
    )


class EquilibreParDeviseTests(SocleTestCase):
    def test_piece_equilibree_est_persistee(self):
        piece = _piece_simple("PC-1")
        self.assertEqual(piece.statut, PieceComptable.Statut.VALIDEE)
        self.assertEqual(piece.lignes.count(), 2)
        self.assertIsNotNone(piece.valide_le)

    def test_piece_desequilibree_rejetee_et_rollback(self):
        with self.assertRaises(ValidationFailed):
            services.enregistrer_piece(
                reference="PC-KO", date_operation=JOUR, journal="JCR",
                lignes=[
                    {"compte": "413", "devise": "FC", "debit": "1000", "credit": "0"},
                    {"compte": "501", "devise": "FC", "debit": "0", "credit": "900"},
                ],
                par="testeur",
            )
        self.assertFalse(PieceComptable.objects.filter(reference="PC-KO").exists(),
                         "Une pièce déséquilibrée doit être annulée, pas persistée.")
        self.assertEqual(LigneEcriture.objects.count(), 0)

    def test_equilibre_global_mais_desequilibre_par_devise_rejete(self):
        """LE test qui distingue ce socle d'un moteur mono-devise : 100 FC au débit contre
        100 USD au crédit totalisent « 100 = 100 » globalement, et c'est pourtant faux."""
        with self.assertRaises(ValidationFailed) as ctx:
            services.enregistrer_piece(
                reference="PC-MIX", date_operation=JOUR, journal="JFX",
                lignes=[
                    {"compte": "501", "devise": "FC", "debit": "100", "credit": "0"},
                    {"compte": "501", "devise": "USD", "debit": "0", "credit": "100"},
                ],
                taux_change=self.taux, par="testeur",
            )
        message = str(ctx.exception)
        self.assertIn("FC", message)
        self.assertIn("USD", message)
        self.assertFalse(PieceComptable.objects.filter(reference="PC-MIX").exists())

    def test_piece_multidevise_sans_taux_refusee(self):
        with self.assertRaises(ValidationFailed) as ctx:
            services.enregistrer_piece(
                reference="PC-NOTAUX", date_operation=JOUR, journal="JFX",
                lignes=[
                    {"compte": "501", "devise": "FC", "debit": "2800", "credit": "0"},
                    {"compte": "588", "devise": "FC", "debit": "0", "credit": "2800"},
                    {"compte": "588", "devise": "USD", "debit": "1", "credit": "0"},
                    {"compte": "413", "devise": "USD", "debit": "0", "credit": "1"},
                ],
                par="testeur",
            )
        self.assertIn("taux", str(ctx.exception).lower())

    def test_ligne_debit_et_credit_refusee(self):
        with self.assertRaises(ValidationFailed):
            services.enregistrer_piece(
                reference="PC-DC", date_operation=JOUR, journal="JCR",
                lignes=[{"compte": "413", "devise": "FC", "debit": "10", "credit": "10"}],
                par="testeur",
            )

    def test_piece_vide_refusee(self):
        with self.assertRaises(ValidationFailed):
            services.enregistrer_piece(
                reference="PC-VIDE", date_operation=JOUR, journal="JCR",
                lignes=[], par="testeur",
            )

    def test_reference_dupliquee_refusee(self):
        _piece_simple("PC-DUP")
        with self.assertRaises(ValidationFailed):
            _piece_simple("PC-DUP")

    def test_controle_integrite_global_vide(self):
        _piece_simple("PC-I1")
        _piece_simple("PC-I2", montant="250.55")
        self.assertEqual(services.controler_integrite(), [])


# ----------------------------------------------------- APPEND-ONLY / CONTREPASSATION

class AppendOnlyTests(SocleTestCase):
    def test_piece_validee_immuable(self):
        piece = _piece_simple("PC-IM")
        piece.libelle = "tentative de modification"
        with self.assertRaises(ValidationFailed):
            piece.save()

    def test_delete_piece_interdit(self):
        piece = _piece_simple("PC-DL")
        with self.assertRaises(ValidationFailed):
            piece.delete()

    def test_delete_ligne_interdit(self):
        piece = _piece_simple("PC-DLL")
        with self.assertRaises(ValidationFailed):
            piece.lignes.first().delete()

    def test_ajout_ligne_sur_piece_validee_interdit(self):
        piece = _piece_simple("PC-ADD")
        with self.assertRaises(ValidationFailed):
            LigneEcriture.objects.create(
                piece=piece, compte=CompteComptable.objects.get(code="501FC"),
                devise="FC", debit=Decimal("1.00"), credit=Decimal("0.00"),
            )

    def test_contrepassation_inverse_les_sens(self):
        origine = _piece_simple("PC-CP", montant="500.00")
        inverse, rectification = services.contrepasser_piece(
            origine, motif="Erreur de compte de trésorerie", par="chef_compta",
        )
        self.assertIsNone(rectification)
        self.assertEqual(inverse.piece_contrepassee_id, origine.pk)
        self.assertEqual(inverse.statut, PieceComptable.Statut.VALIDEE)

        origine_413 = origine.lignes.get(compte__code="413FC")
        inverse_413 = inverse.lignes.get(compte__code="413FC")
        self.assertEqual(origine_413.debit, inverse_413.credit)
        self.assertEqual(origine_413.credit, inverse_413.debit)

        # Effet net nul : l'origine et son inverse s'annulent exactement.
        self.assertEqual(services.solde_compte("413", devise="FC"), Decimal("0.00"))

    def test_contrepassation_avec_rectification_lie_les_trois_pieces(self):
        origine = _piece_simple("PC-3", montant="500.00")
        inverse, rectification = services.contrepasser_piece(
            origine,
            motif="Le décaissement était en USD, pas en FC",
            par="chef_compta",
            lignes_rectificatives=[
                {"compte": "413", "devise": "USD", "debit": "500", "credit": "0"},
                {"compte": "501", "devise": "USD", "debit": "0", "credit": "500"},
            ],
        )
        self.assertEqual(inverse.piece_contrepassee_id, origine.pk)
        self.assertEqual(rectification.piece_rectifiee_id, origine.pk)
        self.assertEqual(origine.contrepassations.count(), 1)
        self.assertEqual(origine.rectifications.count(), 1)
        # Le montant FC est neutralisé, le montant USD est le bon.
        self.assertEqual(services.solde_compte("413", devise="FC"), Decimal("0.00"))
        self.assertEqual(services.solde_compte("413", devise="USD"), Decimal("500.00"))

    def test_double_contrepassation_refusee(self):
        origine = _piece_simple("PC-CP2")
        services.contrepasser_piece(origine, motif="première", par="u")
        with self.assertRaises(ValidationFailed):
            services.contrepasser_piece(origine, motif="seconde", par="u")

    def test_contrepassation_sans_motif_refusee(self):
        origine = _piece_simple("PC-CP3")
        with self.assertRaises(ValidationFailed):
            services.contrepasser_piece(origine, motif="   ", par="u")

    def test_contrepassation_dune_piece_brouillon_refusee(self):
        piece = services.enregistrer_piece(
            reference="PC-BR", date_operation=JOUR, journal="JCR",
            lignes=[
                {"compte": "413", "devise": "FC", "debit": "10", "credit": "0"},
                {"compte": "501", "devise": "FC", "debit": "0", "credit": "10"},
            ],
            par="u", valider=False,
        )
        self.assertEqual(piece.statut, PieceComptable.Statut.BROUILLON)
        with self.assertRaises(ValidationFailed):
            services.contrepasser_piece(piece, motif="x", par="u")


# ---------------------------------------------------------------------- CATALOGUE

class CatalogueTests(SocleTestCase):
    def test_les_seize_schemas_sont_en_base(self):
        codes = set(EventEntryTemplate.objects.values_list("code", flat=True))
        self.assertEqual(codes, {f"B{n}" for n in range(1, 17)})

    def test_b1_decaissement_credit(self):
        piece = catalogue.executer_evenement(
            "B1",
            {"devise": "USD",
             "montants": {"capital": "1500"},
             "comptes": {"$TRESORERIE": "511"}},
            reference="EV-B1", date_operation=JOUR, par="agent",
        )
        self.assertEqual(piece.evenement, "B1")
        self.assertEqual(piece.journal, "JCR")
        self.assertEqual(piece.lignes.get(compte__code="413USD").debit, Decimal("1500.00"))
        self.assertEqual(piece.lignes.get(compte__code="511USD").credit, Decimal("1500.00"))

    def test_b5_declassement_par90(self):
        catalogue.executer_evenement(
            "B1", {"devise": "FC", "montants": {"capital": "800"},
                   "comptes": {"$TRESORERIE": "501"}},
            reference="EV-B1b", date_operation=JOUR, par="agent",
        )
        catalogue.executer_evenement(
            "B5", {"devise": "FC", "montants": {"encours": "800"}},
            reference="EV-B5", date_operation=JOUR, par="agent",
        )
        self.assertEqual(services.solde_compte("413", devise="FC"), Decimal("0.00"))
        self.assertEqual(services.solde_compte("416", devise="FC"), Decimal("800.00"))

    def test_b10_exige_le_compte_de_cantonnement(self):
        with self.assertRaises(ValidationFailed) as ctx:
            catalogue.executer_evenement(
                "B10", {"devise": "USD", "montants": {"souscription": "5000"},
                        "comptes": {"$TRESORERIE": "511"}},
                reference="EV-B10-KO", date_operation=JOUR, par="agent",
            )
        self.assertIn("$CANTONNEMENT", str(ctx.exception))

    def test_b10_avec_cantonnement_par_offre(self):
        services.creer_sous_compte_cantonnement(offre_ref="0042")
        piece = catalogue.executer_evenement(
            "B10",
            {"devise": "USD",
             "montants": {"souscription": "5000"},
             "comptes": {"$TRESORERIE": "511", "$CANTONNEMENT": "419-OFF-0042"}},
            reference="EV-B10", date_operation=JOUR, par="agent",
        )
        self.assertEqual(
            piece.lignes.get(compte__code="419-OFF-0042USD").credit, Decimal("5000.00"),
        )
        # Ségrégation : l'argent de l'offre 0042 est identifiable en propre.
        self.assertEqual(
            services.solde_compte("419-OFF-0042", devise="USD"), Decimal("-5000.00"),
        )

    def test_b12_omet_la_ligne_de_rendement_nul(self):
        services.creer_sous_compte_cantonnement(offre_ref="0043")
        piece = catalogue.executer_evenement(
            "B12",
            {"devise": "USD",
             "montants": {"retour_total": "1000", "capital_rembourse": "1000", "rendement": "0"},
             "comptes": {"$TRESORERIE": "511", "$CANTONNEMENT": "419-OFF-0043"}},
            reference="EV-B12", date_operation=JOUR, par="agent",
        )
        self.assertEqual(piece.lignes.count(), 2)
        self.assertFalse(piece.lignes.filter(compte__code="719USD").exists())

    def test_montant_absent_du_contexte_refuse(self):
        with self.assertRaises(ValidationFailed):
            catalogue.executer_evenement(
                "B1", {"devise": "FC", "montants": {}, "comptes": {"$TRESORERIE": "501"}},
                reference="EV-KO", date_operation=JOUR, par="agent",
            )

    def test_schema_inconnu(self):
        with self.assertRaises(NotFoundError):
            catalogue.executer_evenement(
                "B99", {"devise": "FC", "montants": {}},
                reference="EV-B99", date_operation=JOUR, par="agent",
            )


# ------------------------------------------------------- TAUX DE CHANGE GOUVERNÉ

class TauxChangeTests(SocleTestCase):
    def test_un_seul_taux_par_jour_et_par_usage(self):
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            TauxChange.objects.create(
                date_taux=JOUR, usage=TauxChange.Usage.OPERATIONNEL,
                devise_base="USD", devise_contre="FC", taux=Decimal("2900"),
            )

    def test_usages_distincts_coexistent(self):
        cloture = TauxChange.objects.create(
            date_taux=JOUR, usage=TauxChange.Usage.CLOTURE,
            devise_base="USD", devise_contre="FC", taux=Decimal("2810"),
            source=TauxChange.Source.BCC,
        )
        self.assertNotEqual(cloture.pk, self.taux.pk)
        self.assertEqual(
            fx.taux_du_jour(date_taux=JOUR, usage=TauxChange.Usage.CLOTURE).taux,
            Decimal("2810.000000"),
        )

    def test_absence_de_taux_bloque_sans_retombee_sur_la_veille(self):
        with self.assertRaises(NotFoundError):
            fx.taux_du_jour(date_taux=date(2026, 7, 22))

    def test_conversion_dans_les_deux_sens(self):
        self.assertEqual(fx.convertir(100, de="USD", vers="FC", taux=self.taux),
                         Decimal("280000.00"))
        self.assertEqual(fx.convertir(280000, de="FC", vers="USD", taux=self.taux),
                         Decimal("100.00"))


# ------------------------------------------------- MÉCANISME 588FX — ANNEXE E

class MecanismeFXTests(SocleTestCase):
    """Reproduction littérale de l'exemple chiffré de l'annexe E."""

    def _reglement(self, reference: str, montant_fc):
        return fx.enregistrer_reglement_fx(
            reference=reference,
            date_operation=JOUR,
            montant_source=montant_fc, devise_source="FC",
            montant_cible="100", devise_cible="USD",
            compte_tresorerie_source="501",
            compte_contrepartie_cible="413",
            taux=self.taux,
            par="caissier",
        )

    def test_annexe_e_cas_de_gain(self):
        """285 000 FC apportés / 100 USD dus / taux 2 800 → gain de change de 5 000 FC."""
        piece = self._reglement("FX-GAIN", "285000")

        # Jambe 1 (B14)
        self.assertEqual(piece.lignes.get(compte__code="501FC").debit, Decimal("285000.00"))
        # Jambe 2 (B15)
        self.assertEqual(piece.lignes.get(compte__code="588USD").debit, Decimal("100.00"))
        self.assertEqual(piece.lignes.get(compte__code="413USD").credit, Decimal("100.00"))
        # Constat (B16) — l'excédent de 5 000 FC est un GAIN
        self.assertEqual(piece.lignes.get(compte__code="712FX").credit, Decimal("5000.00"))
        self.assertFalse(piece.lignes.filter(compte__code="613FX").exists())

        # 588FC : crédité de 285 000 (jambe 1), débité de 5 000 (constat)
        lignes_588fc = piece.lignes.filter(compte__code="588FC")
        self.assertEqual(sum(l.credit for l in lignes_588fc), Decimal("285000.00"))
        self.assertEqual(sum(l.debit for l in lignes_588fc), Decimal("5000.00"))

        # INVARIANT : équilibre par devise
        totaux = services.equilibre_par_devise([
            {"devise": l.devise, "debit": l.debit, "credit": l.credit} for l in piece.lignes.all()
        ])
        self.assertEqual(totaux["FC"]["debit"], Decimal("290000.00"))
        self.assertEqual(totaux["FC"]["credit"], Decimal("290000.00"))
        self.assertEqual(totaux["USD"]["debit"], Decimal("100.00"))
        self.assertEqual(totaux["USD"]["credit"], Decimal("100.00"))

        # INVARIANT : le transitoire FX est dénoué (résidu nul en contre-valeur)
        self.assertEqual(fx.residu_transitoire_fx(piece), Decimal("0.00"))
        self.assertEqual(
            fx.position_transitoire_fx(piece),
            {"FC": Decimal("-280000.00"), "USD": Decimal("100.00")},
        )

    def test_annexe_e_cas_de_perte(self):
        """275 000 FC apportés pour 100 USD dus → perte de change de 5 000 FC."""
        piece = self._reglement("FX-PERTE", "275000")

        self.assertEqual(piece.lignes.get(compte__code="501FC").debit, Decimal("275000.00"))
        self.assertEqual(piece.lignes.get(compte__code="613FX").debit, Decimal("5000.00"))
        self.assertFalse(piece.lignes.filter(compte__code="712FX").exists())
        self.assertEqual(
            sum(l.credit for l in piece.lignes.filter(compte__code="588FC")),
            Decimal("280000.00"),
        )
        self.assertEqual(fx.residu_transitoire_fx(piece), Decimal("0.00"))

    def test_change_sans_ecart_ne_produit_pas_de_ligne_de_resultat(self):
        piece = self._reglement("FX-PILE", "280000")
        self.assertEqual(piece.lignes.count(), 4)
        self.assertFalse(piece.lignes.filter(compte__code__in=["712FX", "613FX"]).exists())
        self.assertEqual(fx.residu_transitoire_fx(piece), Decimal("0.00"))

    def test_une_seule_piece_indivisible_pour_les_trois_jambes(self):
        piece = self._reglement("FX-UNE", "285000")
        self.assertEqual(PieceComptable.objects.filter(reference__startswith="FX-UNE").count(), 1)
        self.assertEqual(piece.evenement, "B14+B15+B16")
        self.assertEqual(piece.taux_change_id, self.taux.pk)

    def test_solde_global_588fx_tend_vers_zero(self):
        """Le solde du transitoire, converti au taux, se solde exactement après dénouement."""
        self._reglement("FX-S1", "285000")
        self._reglement("FX-S2", "275000")
        solde_fc = fx.solde_global_transitoire_fx(devise="FC")
        solde_usd = fx.solde_global_transitoire_fx(devise="USD")
        contre_valeur = solde_fc + fx.convertir(solde_usd, de="USD", vers="FC", taux=self.taux)
        self.assertEqual(contre_valeur, Decimal("0.00"))

    def test_gain_et_perte_se_lisent_en_comptes_de_resultat(self):
        self._reglement("FX-R1", "285000")
        self._reglement("FX-R2", "275000")
        # 712FX est un produit (solde créditeur → signé négatif), 613FX une charge.
        self.assertEqual(services.solde_compte("712FX", devise="FC"), Decimal("-5000.00"))
        self.assertEqual(services.solde_compte("613FX", devise="FC"), Decimal("5000.00"))

    def test_reglement_mono_devise_refuse(self):
        with self.assertRaises(ValidationFailed):
            fx.enregistrer_reglement_fx(
                reference="FX-MONO", date_operation=JOUR,
                montant_source="100", devise_source="USD",
                montant_cible="100", devise_cible="USD",
                compte_tresorerie_source="501", compte_contrepartie_cible="413",
                taux=self.taux, par="u",
            )

    def test_job_de_controle_ne_signale_rien_sur_une_operation_denouee(self):
        self._reglement("FX-OK", "285000")
        self.assertEqual(fx.pieces_fx_non_denouees(age_heures=0), [])

    def test_job_de_controle_detecte_un_transitoire_qui_traine(self):
        """Une OD manuelle qui laisse du 588FX ouvert doit remonter dans le job quotidien."""
        piece = services.enregistrer_piece(
            reference="FX-TRAINE", date_operation=JOUR, journal="JFX",
            libelle="OD laissant le transitoire ouvert",
            lignes=[
                {"compte": "501", "devise": "FC", "debit": "280000", "credit": "0"},
                {"compte": "588", "devise": "FC", "debit": "0", "credit": "280000"},
            ],
            taux_change=self.taux, par="u",
        )
        anomalies = fx.pieces_fx_non_denouees(age_heures=0)
        self.assertEqual([a["reference"] for a in anomalies], [piece.reference])
        self.assertEqual(anomalies[0]["residu"], Decimal("-280000.00"))

    def test_contrepassation_dune_operation_fx_conserve_lequilibre(self):
        piece = self._reglement("FX-CP", "285000")
        inverse, _ = services.contrepasser_piece(
            piece, motif="Taux erroné appliqué au guichet", par="chef_compta",
        )
        self.assertEqual(services.solde_compte("413", devise="USD"), Decimal("0.00"))
        self.assertEqual(services.solde_compte("712FX", devise="FC"), Decimal("0.00"))
        self.assertEqual(fx.residu_transitoire_fx(inverse), Decimal("0.00"))
        self.assertEqual(services.controler_integrite(), [])


# ------------------------------------------------------------------------ BALANCE

class BalanceTests(SocleTestCase):
    def test_balance_est_equilibree_par_devise(self):
        _piece_simple("BAL-1", montant="1000")
        catalogue.executer_evenement(
            "B3", {"devise": "USD", "montants": {"interets": "42.50"},
                   "comptes": {"$TRESORERIE": "511"}},
            reference="BAL-2", date_operation=JOUR, par="agent",
        )
        for devise in ("FC", "USD"):
            lignes = services.balance_par_devise(devise=devise)
            total_debit = sum(l["debit"] for l in lignes)
            total_credit = sum(l["credit"] for l in lignes)
            self.assertEqual(total_debit, total_credit,
                             f"Balance déséquilibrée en {devise}.")

    def test_brouillon_exclu_des_soldes(self):
        services.enregistrer_piece(
            reference="BAL-BR", date_operation=JOUR, journal="JCR",
            lignes=[
                {"compte": "413", "devise": "FC", "debit": "999", "credit": "0"},
                {"compte": "501", "devise": "FC", "debit": "0", "credit": "999"},
            ],
            par="u", valider=False,
        )
        self.assertEqual(services.solde_compte("413", devise="FC"), Decimal("0.00"))
        self.assertEqual(services.balance_par_devise(devise="FC"), [])

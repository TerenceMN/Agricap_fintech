"""Tests de l'API comptable — permissions, maker ≠ checker, et forme des réponses.

Trois familles d'exigences, dans cet ordre de priorité :

1. **Anti-gaming (principe 7 de MKOPO)** : aucun rôle de type « Client » ne doit voir la
   comptabilité. Le piège est réel — `client`, `agri_op` et `invest` portent `read=True`
   dans `rbac.role_registry` : sans le garde `IsStaff` cumulé, `HasCapability("read")` seul
   ouvrirait le grand livre à un investisseur.
2. **Maker ≠ checker** sur toute OD et tout ajout de compte, vérifié CÔTÉ SERVEUR.
3. **Aucun montant en `float`** dans le JSON servi : les montants sortent en chaîne.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.core.management import call_command

from common.testing import AuthedAPITestCase

from . import services
from .models import CompteComptable, DemandeCompteComptable, PieceComptable
from .tests import publier_taux_fx

BASE = "/api/accounting"
JOUR = date(2026, 7, 21)


def _lignes_od():
    return [
        {"compte": "641", "devise": "FC", "debit": "150000", "credit": "0",
         "libelle": "Salaires juillet"},
        {"compte": "501", "devise": "FC", "debit": "0", "credit": "150000"},
    ]


class ApiComptableTestCase(AuthedAPITestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_accounting", verbosity=0)
        publier_taux_fx(jour=JOUR)
        publier_taux_fx(jour=JOUR, usage="CLOTURE", pivot="2810")
        services.enregistrer_piece(
            reference="API-B1", date_operation=JOUR, journal="JCR",
            libelle="Décaissement de référence",
            lignes=[
                {"compte": "413", "devise": "FC", "debit": "500000", "credit": "0"},
                {"compte": "501", "devise": "FC", "debit": "0", "credit": "500000"},
            ],
            par="agent",
        )


# ------------------------------------------------------------------- ANTI-GAMING

class CloisonnementClientTests(ApiComptableTestCase):
    CHEMINS = (
        f"{BASE}/comptes",
        f"{BASE}/pieces",
        f"{BASE}/balance?devise=FC",
        f"{BASE}/journaux",
        f"{BASE}/grand-livre?compte=413&devise=FC",
        f"{BASE}/controles/integrite",
        f"{BASE}/provisions/classification",
        f"{BASE}/etats/bilan?devise=FC",
        f"{BASE}/taux",
    )

    def test_un_client_ne_voit_rien_de_la_comptabilite(self):
        self.login(role="client", sub="membre-1")
        for chemin in self.CHEMINS:
            with self.subTest(chemin=chemin):
                self.assertEqual(self.client.get(chemin).status_code, 403)

    def test_un_investisseur_non_plus_malgre_sa_capacite_read(self):
        """`invest` porte `read=True` : c'est exactement le cas où un garde de capacité
        seul aurait laissé passer."""
        self.login(role="invest", sub="investisseur-1")
        for chemin in self.CHEMINS:
            with self.subTest(chemin=chemin):
                self.assertEqual(self.client.get(chemin).status_code, 403)

    def test_un_anonyme_est_refuse(self):
        self.assertIn(self.client.get(f"{BASE}/comptes").status_code, (401, 403))


# ------------------------------------------------------------------ PLAN COMPTABLE

class PlanComptableApiTests(ApiComptableTestCase):
    def setUp(self):
        self.login(role="gest_credit", sub="comptable-1")

    def test_liste_paginee_avec_total_rows(self):
        reponse = self.client.get(f"{BASE}/comptes?limit=5")
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(len(reponse.data["results"]), 5)
        self.assertGreater(reponse.data["total_rows"], 5)

    def test_filtre_par_classe_et_recherche(self):
        reponse = self.client.get(f"{BASE}/comptes?classe=5&q=caisse")
        codes = {c["code"] for c in reponse.data["results"]}
        self.assertEqual(codes, {"501FC", "501USD"})

    def test_detail_expose_les_soldes_en_chaine(self):
        reponse = self.client.get(f"{BASE}/comptes/413FC")
        self.assertEqual(reponse.status_code, 200)
        self.assertTrue(reponse.data["mouvemente"])
        solde = reponse.data["soldes"][0]
        self.assertEqual(solde["solde"], "500000.00")
        self.assertIsInstance(solde["solde"], str, "Un montant ne sort jamais en float.")

    def test_suppression_dun_compte_est_refusee_avec_la_regle(self):
        self.login(role="admin_it", sub="admin-1")
        reponse = self.client.delete(f"{BASE}/comptes/413FC/suppression")
        self.assertEqual(reponse.status_code, 409)
        self.assertIn("append-only", reponse.data["detail"])


class OuvertureDeCompteTests(ApiComptableTestCase):
    PAYLOAD = {
        "code": "6185", "racine": "6185", "intitule": "Frais bancaires",
        "classe": 6, "nature": "CHARGE",
        "justification": "Distinguer les frais bancaires des services extérieurs.",
    }

    def test_maker_cree_une_demande_sans_creer_le_compte(self):
        self.login(role="gest_credit", sub="comptable-1")
        reponse = self.client.post(f"{BASE}/comptes/demandes", self.PAYLOAD, format="json")
        self.assertEqual(reponse.status_code, 201)
        self.assertEqual(reponse.data["statut"], "EN_ATTENTE")
        self.assertFalse(CompteComptable.objects.filter(code="6185").exists())

    def test_checker_distinct_cree_reellement_le_compte(self):
        self.login(role="gest_credit", sub="comptable-1")
        demande = self.client.post(f"{BASE}/comptes/demandes", self.PAYLOAD, format="json").data

        self.login(role="admin_it", sub="dsi-1")
        reponse = self.client.post(
            f"{BASE}/comptes/demandes/{demande['id']}/decision",
            {"approuver": True, "motif": "Conforme au plan"}, format="json",
        )
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.data["statut"], "APPROUVEE")
        compte = CompteComptable.objects.get(code="6185")
        self.assertEqual(compte.nature, "CHARGE")

    def test_le_maker_ne_peut_pas_etre_son_propre_checker(self):
        """`dg` porte à la fois `create` et `config` : les capacités suffiraient, c'est
        l'IDENTITÉ qui bloque."""
        self.login(role="dg", sub="dg-1")
        demande = self.client.post(f"{BASE}/comptes/demandes", self.PAYLOAD, format="json").data
        reponse = self.client.post(
            f"{BASE}/comptes/demandes/{demande['id']}/decision",
            {"approuver": True}, format="json",
        )
        self.assertEqual(reponse.status_code, 400)
        self.assertIn("Maker ≠ checker", reponse.data["detail"])
        self.assertFalse(CompteComptable.objects.filter(code="6185").exists())

    def test_decider_exige_la_capacite_config(self):
        self.login(role="gest_credit", sub="comptable-1")
        demande = self.client.post(f"{BASE}/comptes/demandes", self.PAYLOAD, format="json").data
        self.login(role="gest_credit", sub="comptable-2")
        reponse = self.client.post(
            f"{BASE}/comptes/demandes/{demande['id']}/decision",
            {"approuver": True}, format="json",
        )
        self.assertEqual(reponse.status_code, 403)

    def test_demande_sans_justification_refusee(self):
        self.login(role="gest_credit", sub="comptable-1")
        reponse = self.client.post(
            f"{BASE}/comptes/demandes", {**self.PAYLOAD, "justification": "  "}, format="json",
        )
        self.assertEqual(reponse.status_code, 400)

    def test_rejet_sans_motif_refuse(self):
        self.login(role="gest_credit", sub="comptable-1")
        demande = self.client.post(f"{BASE}/comptes/demandes", self.PAYLOAD, format="json").data
        self.login(role="admin_it", sub="dsi-1")
        reponse = self.client.post(
            f"{BASE}/comptes/demandes/{demande['id']}/decision",
            {"approuver": False}, format="json",
        )
        self.assertEqual(reponse.status_code, 400)

    def test_rejet_motive_laisse_une_trace(self):
        self.login(role="gest_credit", sub="comptable-1")
        demande = self.client.post(f"{BASE}/comptes/demandes", self.PAYLOAD, format="json").data
        self.login(role="admin_it", sub="dsi-1")
        reponse = self.client.post(
            f"{BASE}/comptes/demandes/{demande['id']}/decision",
            {"approuver": False, "motif": "611 suffit"}, format="json",
        )
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.data["statut"], "REJETEE")
        self.assertFalse(CompteComptable.objects.filter(code="6185").exists())
        self.assertTrue(DemandeCompteComptable.objects.filter(statut="REJETEE").exists())


# --------------------------------------------------------------------- OD

class SaisieODTests(ApiComptableTestCase):
    def _creer_od(self, sub="comptable-1", **surcharge):
        self.login(role="gest_credit", sub=sub)
        charge = {
            "dateOperation": JOUR.isoformat(),
            "journal": "JOD",
            "libelle": "Salaires du mois de juillet",
            "lignes": _lignes_od(),
        }
        charge.update(surcharge)
        return self.client.post(f"{BASE}/pieces/od", charge, format="json")

    def test_une_od_nait_en_brouillon(self):
        reponse = self._creer_od()
        self.assertEqual(reponse.status_code, 201)
        self.assertEqual(reponse.data["statut"], "BROUILLON")
        self.assertTrue(reponse.data["saisieManuelle"])
        self.assertEqual(reponse.data["creePar"], "comptable-1")
        # Tant qu'elle n'est pas validée, elle ne pèse rien au grand livre.
        self.assertEqual(services.solde_compte("641", devise="FC"), Decimal("0.00"))

    def test_le_maker_ne_peut_pas_valider_sa_propre_od(self):
        reference = self._creer_od().data["reference"]
        reponse = self.client.post(f"{BASE}/pieces/{reference}/validation", {}, format="json")
        self.assertEqual(reponse.status_code, 400)
        self.assertIn("Maker ≠ checker", reponse.data["detail"])
        self.assertEqual(
            PieceComptable.objects.get(reference=reference).statut, "BROUILLON",
        )

    def test_un_checker_distinct_valide_et_lecriture_entre_au_grand_livre(self):
        reference = self._creer_od().data["reference"]
        self.login(role="gest_credit", sub="chef-compta")
        reponse = self.client.post(f"{BASE}/pieces/{reference}/validation", {}, format="json")
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.data["statut"], "VALIDEE")
        self.assertEqual(reponse.data["validePar"], "chef-compta")
        self.assertEqual(services.solde_compte("641", devise="FC"), Decimal("150000.00"))

    def test_valider_exige_la_capacite_validate(self):
        reference = self._creer_od().data["reference"]
        self.login(role="agent_terrain", sub="agent-1")  # read + create, PAS validate
        reponse = self.client.post(f"{BASE}/pieces/{reference}/validation", {}, format="json")
        self.assertEqual(reponse.status_code, 403)

    def test_saisir_exige_la_capacite_create(self):
        self.login(role="aud_fin", sub="auditeur-1")  # read + audit, PAS create
        reponse = self.client.post(
            f"{BASE}/pieces/od",
            {"journal": "JOD", "libelle": "x", "lignes": _lignes_od()}, format="json",
        )
        self.assertEqual(reponse.status_code, 403)

    def test_od_hors_journal_des_operations_diverses_refusee(self):
        """Une OD sur JCR permettrait d'écrire un décaissement de crédit à la main —
        exactement ce que le catalogue d'événements existe pour empêcher."""
        reponse = self._creer_od(journal="JCR")
        self.assertEqual(reponse.status_code, 400)
        self.assertIn("catalogue", reponse.data["detail"])

    def test_od_desequilibree_refusee_et_rien_nest_persiste(self):
        lignes = _lignes_od()
        lignes[1]["credit"] = "149999"
        avant = PieceComptable.objects.count()
        reponse = self._creer_od(lignes=lignes)
        self.assertEqual(reponse.status_code, 400)
        self.assertIn("déséquilibrée", reponse.data["detail"])
        self.assertEqual(PieceComptable.objects.count(), avant)

    def test_od_sans_libelle_refusee(self):
        self.assertEqual(self._creer_od(libelle="   ").status_code, 400)

    def test_od_multidevise_applique_le_taux_gouverne_du_jour(self):
        """Le taux ne se choisit pas dans le formulaire : c'est celui de `fx` pour la date
        d'opération, et l'écriture est refusée s'il n'est pas publié."""
        reponse = self._creer_od(lignes=[
            {"compte": "501", "devise": "FC", "debit": "280000", "credit": "0"},
            {"compte": "588", "devise": "FC", "debit": "0", "credit": "280000"},
            {"compte": "588", "devise": "USD", "debit": "100", "credit": "0"},
            {"compte": "413", "devise": "USD", "debit": "0", "credit": "100"},
        ])
        self.assertEqual(reponse.status_code, 201)
        self.assertEqual(reponse.data["tauxChange"]["taux"], "2800.000000")

    def test_od_multidevise_refusee_si_aucun_taux_nest_publie(self):
        reponse = self._creer_od(
            dateOperation="2026-07-22",
            lignes=[
                {"compte": "501", "devise": "FC", "debit": "280000", "credit": "0"},
                {"compte": "588", "devise": "FC", "debit": "0", "credit": "280000"},
                {"compte": "588", "devise": "USD", "debit": "100", "credit": "0"},
                {"compte": "413", "devise": "USD", "debit": "0", "credit": "100"},
            ],
        )
        self.assertEqual(reponse.status_code, 404)


class ContrepassationApiTests(ApiComptableTestCase):
    def test_contrepassation_exige_un_motif(self):
        self.login(role="gest_credit", sub="chef-compta")
        reponse = self.client.post(
            f"{BASE}/pieces/API-B1/contrepassation", {"motif": "  "}, format="json",
        )
        self.assertEqual(reponse.status_code, 400)

    def test_contrepassation_produit_la_piece_inverse_et_annule_le_solde(self):
        self.login(role="gest_credit", sub="chef-compta")
        reponse = self.client.post(
            f"{BASE}/pieces/API-B1/contrepassation",
            {"motif": "Compte de trésorerie erroné"}, format="json",
        )
        self.assertEqual(reponse.status_code, 201)
        self.assertEqual(reponse.data["contrepassation"]["pieceContrepassee"], "API-B1")
        self.assertEqual(services.solde_compte("413", devise="FC"), Decimal("0.00"))

    def test_contrepasser_exige_la_capacite_validate(self):
        self.login(role="agent_terrain", sub="agent-1")
        reponse = self.client.post(
            f"{BASE}/pieces/API-B1/contrepassation", {"motif": "x"}, format="json",
        )
        self.assertEqual(reponse.status_code, 403)


# ------------------------------------------------------------------ RESTITUTIONS

class RestitutionsApiTests(ApiComptableTestCase):
    def setUp(self):
        self.login(role="aud_fin", sub="auditeur-1")

    def test_pieces_filtrables_et_paginees(self):
        reponse = self.client.get(f"{BASE}/pieces?journal=JCR&devise=FC&lignes=true")
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.data["total_rows"], 1)
        piece = reponse.data["results"][0]
        self.assertEqual(piece["reference"], "API-B1")
        self.assertEqual(piece["totaux"][0]["debit"], "500000.00")
        self.assertTrue(piece["totaux"][0]["equilibre"])

    def test_detail_de_piece_expose_les_lignes(self):
        reponse = self.client.get(f"{BASE}/pieces/API-B1")
        self.assertEqual(reponse.status_code, 200)
        comptes = {l["compte"] for l in reponse.data["lignes"]}
        self.assertEqual(comptes, {"413FC", "501FC"})

    def test_piece_inconnue_donne_404(self):
        self.assertEqual(self.client.get(f"{BASE}/pieces/INEXISTANTE").status_code, 404)

    def test_balance_exige_une_devise(self):
        reponse = self.client.get(f"{BASE}/balance")
        self.assertEqual(reponse.status_code, 400)
        self.assertIn("devise", reponse.data["detail"])

    def test_balance_est_equilibree_et_en_chaines(self):
        reponse = self.client.get(f"{BASE}/balance?devise=FC")
        self.assertEqual(reponse.status_code, 200)
        self.assertTrue(reponse.data["equilibree"])
        self.assertEqual(reponse.data["totalDebit"], reponse.data["totalCredit"])
        self.assertIsInstance(reponse.data["results"][0]["solde"], str)

    def test_grand_livre_avec_report_et_solde_progressif(self):
        reponse = self.client.get(f"{BASE}/grand-livre?compte=413&devise=FC")
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.data["report"], "0.00")
        self.assertEqual(reponse.data["mouvements"][0]["solde"], "500000.00")
        self.assertEqual(reponse.data["solde"], "500000.00")

    def test_grand_livre_report_a_nouveau_sur_periode_partielle(self):
        reponse = self.client.get(
            f"{BASE}/grand-livre?compte=413&devise=FC&debut=2026-08-01",
        )
        self.assertEqual(reponse.data["report"], "500000.00")
        self.assertEqual(reponse.data["mouvements"], [])
        self.assertEqual(reponse.data["solde"], "500000.00")

    def test_grand_livre_sans_compte_refuse(self):
        self.assertEqual(self.client.get(f"{BASE}/grand-livre?devise=FC").status_code, 400)

    def test_journaux_auxiliaires_equilibres(self):
        reponse = self.client.get(f"{BASE}/journaux")
        self.assertEqual(reponse.status_code, 200)
        jcr = [j for j in reponse.data["results"] if j["journal"] == "JCR"][0]
        self.assertEqual(jcr["nombrePieces"], 1)
        self.assertTrue(jcr["devises"][0]["equilibre"])

    def test_controle_integrite_conforme(self):
        reponse = self.client.get(f"{BASE}/controles/integrite")
        self.assertTrue(reponse.data["conforme"])
        self.assertEqual(reponse.data["total_rows"], 0)

    def test_controle_fx_expose_lage_et_la_contre_valeur(self):
        reponse = self.client.get(f"{BASE}/controles/fx?ageHeures=0")
        self.assertEqual(reponse.status_code, 200)
        self.assertIn("positionContreValeur", reponse.data)
        self.assertEqual(reponse.data["devisePivot"], "FC")

    def test_catalogue_expose_les_seize_schemas(self):
        reponse = self.client.get(f"{BASE}/catalogue")
        self.assertEqual(reponse.data["total_rows"], 16)


# --------------------------------------------------------------- TAUX (LECTURE)

class TauxApiTests(ApiComptableTestCase):
    def test_lecture_seule_avec_provenance_fx(self):
        self.login(role="aud_fin", sub="auditeur-1")
        # La projection n'existe qu'une fois le taux consommé par la comptabilité.
        from . import fx

        fx.taux_du_jour(date_taux=JOUR)
        reponse = self.client.get(f"{BASE}/taux")
        self.assertEqual(reponse.status_code, 200)
        ligne = reponse.data["results"][0]
        self.assertEqual(ligne["taux"], "2800.000000")
        self.assertIsNotNone(ligne["provenance"]["origineFx"])
        self.assertIn("/api/fx/rates", reponse.data["saisie"])

    def test_saisie_dun_taux_renvoie_la_regle(self):
        self.login(role="dg", sub="dg-1")
        reponse = self.client.post(f"{BASE}/taux/saisie", {"taux": "2900"}, format="json")
        self.assertEqual(reponse.status_code, 409)
        self.assertIn("fx.ExchangeRate", reponse.data["detail"])


# ------------------------------------------------------------------- PROVISIONS

class ProvisionsApiTests(ApiComptableTestCase):
    def test_grille_lisible_et_couverture_validee(self):
        self.login(role="aud_fin", sub="auditeur-1")
        reponse = self.client.get(f"{BASE}/provisions/classes")
        self.assertEqual(reponse.status_code, 200)
        self.assertTrue(reponse.data["couvertureValide"])
        self.assertEqual(reponse.data["total_rows"], 4)
        self.assertEqual(reponse.data["results"][0]["tauxProvision"], "0.0100")

    def test_modifier_un_taux_exige_la_capacite_config(self):
        self.login(role="gest_credit", sub="comptable-1")
        reponse = self.client.patch(
            f"{BASE}/provisions/classes/PAR90", {"tauxProvision": "0.6"}, format="json",
        )
        self.assertEqual(reponse.status_code, 403)

    def test_le_comite_ajuste_un_taux_sans_redeploiement(self):
        self.login(role="dg", sub="dg-1")
        reponse = self.client.patch(
            f"{BASE}/provisions/classes/PAR90", {"tauxProvision": "0.6"}, format="json",
        )
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.data["tauxProvision"], "0.6000")
        self.assertEqual(reponse.data["modifiePar"], "dg-1")

    def test_une_borne_qui_creerait_un_trou_est_refusee(self):
        self.login(role="dg", sub="dg-1")
        reponse = self.client.patch(
            f"{BASE}/provisions/classes/PAR30", {"joursMin": 35}, format="json",
        )
        self.assertEqual(reponse.status_code, 400)
        self.assertIn("contiguë", reponse.data["detail"])

    def test_classification_est_une_lecture(self):
        self.login(role="aud_fin", sub="auditeur-1")
        avant = PieceComptable.objects.count()
        reponse = self.client.get(f"{BASE}/provisions/classification?as_of=2026-07-21")
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.data["asOf"], "2026-07-21")
        self.assertEqual(PieceComptable.objects.count(), avant)

    def test_arrete_exige_la_capacite_validate(self):
        self.login(role="agent_terrain", sub="agent-1")
        reponse = self.client.post(
            f"{BASE}/provisions/arretes", {"dateArrete": "2026-07-31"}, format="json",
        )
        self.assertEqual(reponse.status_code, 403)

    def test_arrete_sur_portefeuille_vide_ne_produit_rien(self):
        self.login(role="gest_credit", sub="chef-compta")
        reponse = self.client.post(
            f"{BASE}/provisions/arretes", {"dateArrete": "2026-07-31"}, format="json",
        )
        self.assertEqual(reponse.status_code, 201)
        self.assertEqual(reponse.data["declassements"], [])
        self.assertEqual(reponse.data["arretes"], [])


# --------------------------------------------------------------- ÉTATS FINANCIERS

class EtatsFinanciersApiTests(ApiComptableTestCase):
    def setUp(self):
        self.login(role="aud_fin", sub="auditeur-1")

    def test_bilan_boucle(self):
        reponse = self.client.get(f"{BASE}/etats/bilan?devise=FC")
        self.assertEqual(reponse.status_code, 200)
        self.assertTrue(reponse.data["boucle"], reponse.data["ecartBouclage"])
        self.assertEqual(reponse.data["ecartBouclage"], "0.00")

    def test_bilan_reflete_les_ecritures_reelles(self):
        """Le bilan est un regroupement de la balance, pas une constante : 500 000 FC de
        413 (actif) contre 501 créditeur de 500 000 (actif négatif) → total actif nul."""
        reponse = self.client.get(f"{BASE}/etats/bilan?devise=FC")
        postes = {p["code"]: p["montant"] for p in reponse.data["actif"]}
        self.assertEqual(postes["413FC"], "500000.00")
        self.assertEqual(postes["501FC"], "-500000.00")
        self.assertEqual(reponse.data["totalActif"], "0.00")

    def test_compte_de_resultat_vide_sur_un_portefeuille_sans_produit(self):
        reponse = self.client.get(f"{BASE}/etats/resultat?devise=FC")
        self.assertEqual(reponse.data["resultat"], "0.00")

    def test_consolide_exige_une_date_darrete(self):
        reponse = self.client.get(f"{BASE}/etats/consolide")
        self.assertEqual(reponse.status_code, 400)

    def test_consolide_reference_le_taux_de_cloture_et_boucle(self):
        reponse = self.client.get(f"{BASE}/etats/consolide?as_of={JOUR.isoformat()}")
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(reponse.data["tauxCloture"]["usage"], "CLOTURE")
        self.assertEqual(reponse.data["tauxCloture"]["taux"], "2810.000000")
        self.assertIsNotNone(reponse.data["tauxCloture"]["provenance"]["origineFx"])
        self.assertTrue(reponse.data["consolide"]["boucle"])

    def test_consolide_refuse_sans_taux_de_cloture_publie(self):
        """Pas de valeur par défaut : un consolidé sans taux gouverné n'existe pas."""
        reponse = self.client.get(f"{BASE}/etats/consolide?as_of=2026-07-22")
        self.assertEqual(reponse.status_code, 404)

"""Le client propose, l'agent valide — et une proposition ne pèse RIEN.

Ce que ces tests verrouillent, et pourquoi :

  - **une proposition n'est pas une garantie.** C'est la propriété centrale du
    lot : tant qu'un agent n'a pas validé, la couverture du dossier et le score
    du critère « garanties » sont rigoureusement ceux d'un dossier sans
    proposition. Le test compare des dictionnaires entiers, pas un champ choisi :
    un futur contributeur qui ferait entrer les propositions dans la couverture
    « pour afficher une prévision » le casserait immédiatement (principe 9).

  - **la fuite de données d'un tiers.** Les cinq règles de capacité portent sur
    la situation financière du GARANT — son épargne, ses cautions en cours, ses
    incidents. Le demandeur ne doit jamais en apprendre quoi que ce soit. Les
    tests de fuite cherchent les NOMS de champs *et* les VALEURS : un sérialiseur
    peut renommer un champ, il ne peut pas changer le solde d'épargne du garant.

  - **le sondage.** Un plafond explicite, dit à l'utilisateur, et journalisé.
    Un blocage silencieux serait pire que pas de blocage : personne ne saurait
    qu'un demandeur passe ses journées à tester les membres de son groupe.

  - **la réutilisation.** La validation doit produire EXACTEMENT ce que produit
    `register_moral_guarantee` — même statut, même fenêtre, même boîte de
    réception du garant. S'il existait un second chemin vers une caution, ce
    test passerait quand même : c'est pourquoi il vérifie aussi que la caution
    apparaît dans `GET /guarantee-requests/`, la surface qui existait déjà.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from common.testing import AuthedAPITestCase
from credits.models import (
    CreditApplication, CreditGuarantee, GuaranteeProposal,
    ImmutableGuaranteeProposal,
)
from credits.tests_guarantor import _app, _config, _group, _savings, _user

PROPOSALS_URL = "/api/credits/guarantee-proposals/"
QUEUE_URL = "/api/credits/guarantee-proposals/queue/"


def _propositions_url(code: str) -> str:
    return f"/api/credits/applications/{code}/guarantee-proposals/"


def _candidates_url(code: str) -> str:
    return f"/api/credits/applications/{code}/guarantee-proposals/candidates/"


def _validate_url(pk: int) -> str:
    return f"/api/credits/guarantee-proposals/{pk}/validate/"


def _refuse_url(pk: int) -> str:
    return f"/api/credits/guarantee-proposals/{pk}/refuse/"


def _propose(app, proposer, guarantor, montant: str = "400", message: str = ""):
    from credits.guarantee_proposals import propose
    return propose(
        application=app, proposer=proposer, guarantor_sub=str(guarantor.pk),
        covered_amount=Decimal(montant), message=message,
    )


# ══ 1. Une proposition ne compte pour rien (principe 9) ═══════════════════════

class ProposalIsNotAGuaranteeTests(TestCase):

    def setUp(self):
        _config()
        self.demandeur = _user("sub-prop-demandeur", "Marie Kabemba")
        self.garant = _user("sub-prop-garant", "Jean Mukendi")
        _group("AVEC Prop", self.demandeur, self.garant)
        _savings(self.garant, "5000")
        self.app = _app(self.demandeur, "1000")

    def test_une_proposition_ne_cree_aucune_garantie(self):
        _propose(self.app, self.demandeur, self.garant)
        self.assertEqual(self.app.guarantees.count(), 0)

    def test_une_proposition_ne_bouge_pas_la_couverture_d_un_centime(self):
        from credits.guarantees import get_guarantee_summary

        avant = get_guarantee_summary(self.app)["coverage"]
        _propose(self.app, self.demandeur, self.garant, montant="900")
        apres = get_guarantee_summary(self.app)["coverage"]

        self.assertEqual(avant, apres)
        self.assertEqual(apres["retainedTotal"], 0.0)
        self.assertEqual(apres["activeCount"], 0)

    def test_une_proposition_ne_change_pas_le_score_des_garanties(self):
        """Le critère C5 lit `application.guarantees`, jamais les propositions."""
        from credits.analyse import scorer_garanties
        from credits.models import BaremeScore

        bareme = BaremeScore.objects.create(
            code="COUVERTURE_GARANTIES_TEST",
            points=[{"x": "0", "y": "0"}, {"x": "1", "y": "100"}],
        )
        avant = scorer_garanties(self.app, bareme, Decimal("15"))
        _propose(self.app, self.demandeur, self.garant, montant="1000")
        apres = scorer_garanties(self.app, bareme, Decimal("15"))

        self.assertEqual(avant, apres)
        self.assertEqual(apres["details"]["couvertureRetenue"], 0.0)

    def test_une_proposition_ne_notifie_pas_le_garant_pressenti(self):
        """Tant qu'un agent n'a pas validé, la personne n'a rien à répondre."""
        from notifications.models import Notification

        _propose(self.app, self.demandeur, self.garant)
        self.assertEqual(Notification.objects.filter(user=self.garant).count(), 0)

    def test_une_proposition_n_apparait_pas_dans_la_boite_du_garant(self):
        from credits.guarantees import guarantee_requests_for

        _propose(self.app, self.demandeur, self.garant)
        self.assertEqual(guarantee_requests_for(self.garant).count(), 0)

    def test_une_proposition_ne_bloque_pas_la_capacite_du_garant(self):
        """Elle n'immobilise rien : seule une désignation engage."""
        from credits.guarantor import capacity_snapshot

        avant = capacity_snapshot(self.garant)["committed"]
        _propose(self.app, self.demandeur, self.garant, montant="900")
        self.assertEqual(capacity_snapshot(self.garant)["committed"], avant)


# ══ 2. Contrôles de la proposition ════════════════════════════════════════════

class ProposalRulesTests(TestCase):

    def setUp(self):
        _config()
        self.demandeur = _user("sub-regle-demandeur", "Titulaire")
        self.garant = _user("sub-regle-garant", "Garant Regle")
        self.tiers = _user("sub-regle-tiers", "Tiers Inconnu")
        _group("AVEC Regle", self.demandeur, self.garant)
        _savings(self.garant, "5000")
        self.app = _app(self.demandeur, "1000")

    def _refus(self, **kwargs):
        from credits.guarantee_proposals import ProposalError
        from credits.guarantor import GuarantorError
        from credits.guarantee_proposals import propose
        with self.assertRaises((ProposalError, GuarantorError)) as ctx:
            propose(**kwargs)
        return ctx.exception

    def test_nominal(self):
        proposal = _propose(self.app, self.demandeur, self.garant, message="Mon oncle")
        self.assertEqual(proposal.status, GuaranteeProposal.Status.PROPOSED)
        self.assertEqual(proposal.covered_amount, Decimal("400.00"))
        self.assertEqual(proposal.currency, "USD")
        self.assertEqual(proposal.message, "Mon oncle")

    def test_seul_le_titulaire_propose(self):
        autre = _user("sub-regle-autre", "Voisin Curieux")
        exc = self._refus(application=self.app, proposer=autre,
                          guarantor_sub=str(self.garant.pk))
        self.assertEqual(exc.code, "NOT_APPLICATION_OWNER")
        self.assertEqual(exc.http_status, 403)

    def test_un_sub_arbitraire_hors_groupe_est_refuse(self):
        """Un `guarantor_sub` quelconque n'atteint pas n'importe quel membre."""
        _savings(self.tiers, "50000")
        exc = self._refus(application=self.app, proposer=self.demandeur,
                          guarantor_sub=str(self.tiers.pk))
        self.assertEqual(exc.code, "GUARANTOR_NOT_IN_GROUP")

    def test_un_sub_inexistant_est_refuse(self):
        exc = self._refus(application=self.app, proposer=self.demandeur,
                          guarantor_sub="sub-qui-n-existe-pas")
        self.assertEqual(exc.code, "GUARANTOR_UNKNOWN")

    def test_auto_caution_refusee(self):
        exc = self._refus(application=self.app, proposer=self.demandeur,
                          guarantor_sub=str(self.demandeur.pk))
        self.assertEqual(exc.code, "GUARANTOR_IS_APPLICANT")

    def test_montant_nul_refuse(self):
        exc = self._refus(application=self.app, proposer=self.demandeur,
                          guarantor_sub=str(self.garant.pk),
                          covered_amount=Decimal("0"))
        self.assertEqual(exc.code, "INVALID_PROPOSAL_AMOUNT")

    def test_montant_par_defaut_celui_du_dossier(self):
        from credits.guarantee_proposals import propose
        proposal = propose(application=self.app, proposer=self.demandeur,
                           guarantor_sub=str(self.garant.pk))
        self.assertEqual(proposal.covered_amount, Decimal("1000.00"))

    def test_dossier_approuve_n_accepte_plus_de_proposition(self):
        self.app.status = CreditApplication.Status.APPROVED
        self.app.save(update_fields=["status"])
        exc = self._refus(application=self.app, proposer=self.demandeur,
                          guarantor_sub=str(self.garant.pk))
        self.assertEqual(exc.code, "APPLICATION_NOT_OPEN_FOR_GUARANTEE")
        self.assertEqual(exc.http_status, 409)

    def test_meme_personne_deux_fois_refusee(self):
        _propose(self.app, self.demandeur, self.garant)
        exc = self._refus(application=self.app, proposer=self.demandeur,
                          guarantor_sub=str(self.garant.pk))
        self.assertEqual(exc.code, "DUPLICATE_PROPOSAL")

    def test_les_regles_financieres_ne_sont_pas_evaluees_a_la_proposition(self):
        """Un garant sans un dollar d'épargne peut être PROPOSÉ.

        C'est délibéré : évaluer sa capacité ici obligerait à en dire quelque
        chose au demandeur. Ce qui n'est pas calculé ne peut pas fuir. L'agent,
        lui, verra le blocage dans sa file.
        """
        pauvre = _user("sub-regle-pauvre", "Sans Epargne")
        _group("AVEC Pauvre", self.demandeur, pauvre)
        proposal = _propose(self.app, self.demandeur, pauvre, montant="900")
        self.assertEqual(proposal.status, GuaranteeProposal.Status.PROPOSED)


# ══ 3. Anti-sondage : plafonds explicites et journalisés ══════════════════════

class ProposalQuotaTests(TestCase):

    def setUp(self):
        _config()
        self.demandeur = _user("sub-quota-demandeur", "Sondeur")
        self.app = _app(self.demandeur, "1000")
        self.groupe_membres = []
        for i in range(6):
            membre = _user(f"sub-quota-membre-{i}", f"Membre {i}")
            _savings(membre, "5000")
            self.groupe_membres.append(membre)
        _group("AVEC Quota", self.demandeur, *self.groupe_membres)

    def test_plafond_de_propositions_simultanees(self):
        from credits.guarantee_proposals import max_open_proposals

        plafond = max_open_proposals()
        for membre in self.groupe_membres[:plafond]:
            _propose(self.app, self.demandeur, membre)

        from credits.guarantee_proposals import TooManyOpenProposals
        with self.assertRaises(TooManyOpenProposals) as ctx:
            _propose(self.app, self.demandeur, self.groupe_membres[plafond])
        self.assertEqual(ctx.exception.code, "TOO_MANY_OPEN_PROPOSALS")

    def test_le_blocage_est_journalise_jamais_silencieux(self):
        from audit.models import AuditEntry
        from credits.guarantee_proposals import (
            TooManyOpenProposals, max_open_proposals,
        )

        for membre in self.groupe_membres[:max_open_proposals()]:
            _propose(self.app, self.demandeur, membre)
        with self.assertRaises(TooManyOpenProposals):
            _propose(self.app, self.demandeur, self.groupe_membres[-1])

        entree = AuditEntry.objects.filter(
            action="credit.guarantee.proposal_blocked",
        ).first()
        self.assertIsNotNone(entree)
        self.assertEqual(entree.details["reason"], "TOO_MANY_OPEN_PROPOSALS")
        self.assertEqual(entree.details["applicationCode"], self.app.code)

    def test_une_decision_libere_une_place(self):
        from credits.guarantee_proposals import max_open_proposals, refuse

        plafond = max_open_proposals()
        premieres = [
            _propose(self.app, self.demandeur, m)
            for m in self.groupe_membres[:plafond]
        ]
        refuse(premieres[0], agent_sub="sub-agent", reason_code="autre",
               comment="Pièce non présentée.")
        # La place libérée permet une nouvelle proposition, la file ne se bloque
        # pas définitivement sur une proposition abandonnée.
        self.assertIsNotNone(
            _propose(self.app, self.demandeur, self.groupe_membres[plafond]),
        )


# ══ 4. Validation par l'agent — réutilisation, pas seconde voie ══════════════

class ProposalValidationTests(TestCase):

    def setUp(self):
        _config()
        self.demandeur = _user("sub-val-demandeur", "Marie Kabemba")
        self.garant = _user("sub-val-garant", "Jean Mukendi")
        _group("AVEC Val", self.demandeur, self.garant)
        _savings(self.garant, "5000")
        self.app = _app(self.demandeur, "1000")
        self.proposal = _propose(self.app, self.demandeur, self.garant, montant="400")

    def _valider(self, **over):
        from credits.guarantee_proposals import validate
        kwargs = {
            "agent_sub": "sub-val-agent",
            "comment": "Pièce d'identité vue en agence, lien de groupe vérifié.",
            "guarantor_id_number": "CNI-4242",
        }
        kwargs.update(over)
        return validate(self.proposal, **kwargs)

    def test_validation_produit_une_caution_en_attente_de_consentement(self):
        self._valider()
        garantie = CreditGuarantee.objects.get(application=self.app)
        self.assertEqual(garantie.status, CreditGuarantee.Status.PENDING_CONSENT)
        self.assertEqual(garantie.guarantor_id, self.garant.pk)
        self.assertEqual(garantie.covered_amount, Decimal("400.00"))
        self.assertIsNotNone(garantie.consent_expires_at)

    def test_la_caution_atterrit_dans_la_boite_existante_du_garant(self):
        """Preuve qu'il n'existe pas une seconde voie parallèle (principe 6)."""
        from credits.guarantees import guarantee_requests_for

        self._valider()
        demandes = list(guarantee_requests_for(self.garant))
        self.assertEqual(len(demandes), 1)
        self.assertEqual(demandes[0].status, CreditGuarantee.Status.PENDING_CONSENT)

    def test_le_garant_est_notifie_a_la_validation_pas_avant(self):
        from notifications.models import Notification

        self.assertEqual(Notification.objects.filter(user=self.garant).count(), 0)
        self._valider()
        self.assertEqual(Notification.objects.filter(user=self.garant).count(), 1)

    def test_la_proposition_pointe_sur_la_caution_creee(self):
        self._valider()
        self.proposal.refresh_from_db()
        self.assertEqual(self.proposal.status, GuaranteeProposal.Status.VALIDATED)
        self.assertIsNotNone(self.proposal.guarantee_id)
        self.assertEqual(self.proposal.guarantee.application_id, self.app.pk)

    def test_motif_obligatoire(self):
        from credits.guarantee_proposals import DecisionReasonRequired
        with self.assertRaises(DecisionReasonRequired):
            self._valider(comment="   ")

    def test_piece_d_identite_obligatoire(self):
        from credits.guarantee_proposals import GuarantorIdentityRequired
        with self.assertRaises(GuarantorIdentityRequired):
            self._valider(guarantor_id_number="")

    def test_l_agent_peut_ajuster_le_montant_et_l_ecart_est_journalise(self):
        from audit.models import AuditEntry

        self._valider(covered_amount=Decimal("250"))
        garantie = CreditGuarantee.objects.get(application=self.app)
        self.assertEqual(garantie.covered_amount, Decimal("250.00"))

        entree = AuditEntry.objects.filter(
            action="credit.guarantee.proposal_validated").first()
        self.assertTrue(entree.details["amountAdjusted"])
        self.assertEqual(entree.details["proposedAmount"], "400.00")
        self.assertEqual(entree.details["coveredAmount"], "250.00")

    def test_une_regle_de_capacite_bloque_la_validation_avec_son_code(self):
        from credits.guarantor import GuarantorOverextended
        from savings.models import SavingsPlan

        SavingsPlan.objects.filter(user=self.garant).update(balance=Decimal("10"))
        with self.assertRaises(GuarantorOverextended) as ctx:
            self._valider()
        self.assertEqual(ctx.exception.code, "GUARANTOR_OVEREXTENDED")
        # Rien n'a été créé : une validation refusée ne laisse pas de caution.
        self.assertEqual(self.app.guarantees.count(), 0)
        self.proposal.refresh_from_db()
        self.assertEqual(self.proposal.status, GuaranteeProposal.Status.PROPOSED)

    def test_une_seule_caution_vivante_a_la_fois(self):
        from credits.guarantee_proposals import MoralGuaranteeAlreadyLive

        autre = _user("sub-val-garant2", "Second Garant")
        _group("AVEC Val 2", self.demandeur, autre)
        _savings(autre, "5000")
        seconde = _propose(self.app, self.demandeur, autre, montant="300")

        self._valider()
        from credits.guarantee_proposals import validate
        with self.assertRaises(MoralGuaranteeAlreadyLive) as ctx:
            validate(seconde, agent_sub="sub-val-agent", comment="Motif.",
                     guarantor_id_number="CNI-1")
        self.assertEqual(ctx.exception.http_status, 409)
        # La première caution est intacte : on ne libère personne en silence.
        self.assertEqual(
            CreditGuarantee.objects.filter(
                application=self.app,
                status=CreditGuarantee.Status.PENDING_CONSENT).count(),
            1,
        )

    def test_une_proposition_deja_tranchee_ne_se_rejoue_pas(self):
        from credits.guarantee_proposals import ProposalAlreadyDecided

        self._valider()
        with self.assertRaises(ProposalAlreadyDecided) as ctx:
            self._valider()
        self.assertEqual(ctx.exception.code, "PROPOSAL_ALREADY_DECIDED")

    def test_la_couverture_ne_bouge_qu_a_la_constitution(self):
        """Validée ≠ consentie ≠ constituée. Seule `active` couvre (principe 9)."""
        from credits.guarantees import (
            confirm_moral_guarantee, get_guarantee_summary, record_guarantor_consent,
        )

        self._valider()
        self.assertEqual(
            get_guarantee_summary(self.app)["coverage"]["retainedTotal"], 0.0)

        garantie = CreditGuarantee.objects.get(application=self.app)
        record_guarantor_consent(garantie, responder_sub=str(self.garant.pk),
                                 accept=True)
        self.assertEqual(
            get_guarantee_summary(self.app)["coverage"]["retainedTotal"], 0.0)

        garantie.refresh_from_db()
        confirm_moral_guarantee(garantie, confirmer_sub="sub-val-agent")
        # 400 × (1 − 0,70) = 120,00
        self.assertEqual(
            get_guarantee_summary(self.app)["coverage"]["retainedTotal"], 120.0)


# ══ 5. Refus par l'agent — motivé, conservé, non-divulguant ═══════════════════

class ProposalRefusalTests(TestCase):

    def setUp(self):
        _config()
        self.demandeur = _user("sub-ref-demandeur", "Demandeur")
        self.garant = _user("sub-ref-garant", "Garant")
        _group("AVEC Ref", self.demandeur, self.garant)
        _savings(self.garant, "5000")
        self.app = _app(self.demandeur, "1000")
        self.proposal = _propose(self.app, self.demandeur, self.garant)

    def _refuser(self, **over):
        from credits.guarantee_proposals import refuse
        kwargs = {
            "agent_sub": "sub-ref-agent",
            "reason_code": "garant_indisponible",
            "comment": "Le garant porte déjà trois cautions vivantes.",
        }
        kwargs.update(over)
        return refuse(self.proposal, **kwargs)

    def test_refus_conserve_la_proposition(self):
        self._refuser()
        self.proposal.refresh_from_db()
        self.assertEqual(self.proposal.status, GuaranteeProposal.Status.REFUSED)
        self.assertTrue(GuaranteeProposal.objects.filter(pk=self.proposal.pk).exists())

    def test_refus_journalise(self):
        from audit.models import AuditEntry

        self._refuser()
        entree = AuditEntry.objects.filter(
            action="credit.guarantee.proposal_refused").first()
        self.assertIsNotNone(entree)
        self.assertEqual(entree.details["reasonCode"], "garant_indisponible")
        self.assertEqual(entree.actor, "sub-ref-agent")

    def test_motif_libre_obligatoire(self):
        from credits.guarantee_proposals import DecisionReasonRequired
        with self.assertRaises(DecisionReasonRequired):
            self._refuser(comment="")

    def test_code_de_motif_hors_vocabulaire_refuse(self):
        from credits.guarantee_proposals import RefusalReasonInvalid
        with self.assertRaises(RefusalReasonInvalid):
            self._refuser(reason_code="parce_que")

    def test_refus_ne_cree_aucune_caution(self):
        self._refuser()
        self.assertEqual(self.app.guarantees.count(), 0)

    def test_une_proposition_refusee_ne_se_rejoue_pas(self):
        from credits.guarantee_proposals import ProposalAlreadyDecided
        self._refuser()
        with self.assertRaises(ProposalAlreadyDecided):
            self._refuser()


# ══ 6. Append-only : le contenu proposé est figé (principe 3) ════════════════

class ProposalImmutabilityTests(TestCase):

    def setUp(self):
        _config()
        self.demandeur = _user("sub-imm-demandeur", "Demandeur")
        self.garant = _user("sub-imm-garant", "Garant")
        _group("AVEC Imm", self.demandeur, self.garant)
        _savings(self.garant, "5000")
        self.app = _app(self.demandeur, "1000")
        self.proposal = _propose(self.app, self.demandeur, self.garant)

    def test_le_montant_propose_est_fige(self):
        proposal = GuaranteeProposal.objects.get(pk=self.proposal.pk)
        proposal.covered_amount = Decimal("999")
        with self.assertRaises(ImmutableGuaranteeProposal):
            proposal.save()

    def test_le_garant_propose_est_fige(self):
        autre = _user("sub-imm-autre", "Autre")
        proposal = GuaranteeProposal.objects.get(pk=self.proposal.pk)
        proposal.guarantor = autre
        with self.assertRaises(ImmutableGuaranteeProposal):
            proposal.save()

    def test_la_decision_reste_ecrivable(self):
        from credits.guarantee_proposals import refuse
        proposal = GuaranteeProposal.objects.get(pk=self.proposal.pk)
        refuse(proposal, agent_sub="sub-agent", reason_code="autre",
               comment="Motif.")
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, GuaranteeProposal.Status.REFUSED)


# ══ 7. Étanchéité des sérialiseurs — la fuite d'un tiers ═════════════════════

class ProposalLeakTests(TestCase):
    """Le demandeur n'apprend RIEN de la situation financière de son garant."""

    def setUp(self):
        _config()
        self.demandeur = _user("sub-fuite-demandeur", "Demandeur")
        self.garant = _user("sub-fuite-garant", "Garant Fortune")
        _group("AVEC Fuite", self.demandeur, self.garant)
        # Des valeurs reconnaissables : si l'une d'elles apparaît dans la charge
        # servie au demandeur, le test doit tomber, quel que soit le nom du champ.
        _savings(self.garant, "7777")
        self.app = _app(self.demandeur, "1000")
        self.proposal = _propose(self.app, self.demandeur, self.garant)

    def test_aucun_champ_de_capacite_dans_la_vue_du_demandeur(self):
        from credits.guarantee_proposals import serialize_for_applicant

        blob = str(serialize_for_applicant(self.proposal))
        for interdit in ("savings", "epargne", "ceiling", "plafond", "committed",
                         "livePledges", "maxPledges", "multiple", "capacity",
                         "blockingRule", "decisionComment", "haircut", "decote"):
            self.assertNotIn(interdit, blob, f"champ interdit servi : {interdit}")

    def test_aucune_valeur_de_capacite_dans_la_vue_du_demandeur(self):
        """Renommer un champ ne suffit pas : les VALEURS sont cherchées aussi."""
        from credits.guarantee_proposals import serialize_for_applicant

        blob = str(serialize_for_applicant(self.proposal))
        for valeur in ("7777", "15554"):        # épargne, puis plafond k × épargne
            self.assertNotIn(valeur, blob)

    def test_un_refus_pour_incapacite_ne_dit_pas_pourquoi(self):
        from credits.guarantee_proposals import refuse, serialize_for_applicant

        refuse(self.proposal, agent_sub="sub-agent",
               reason_code="garant_indisponible",
               comment="Épargne 7777 USD, déjà 3 cautions actives, un impayé.")
        self.proposal.refresh_from_db()

        vue = serialize_for_applicant(self.proposal)
        self.assertEqual(vue["state"], "refused_by_agent")
        self.assertEqual(
            vue["refusalReason"],
            "Cette personne ne peut pas se porter caution en ce moment.",
        )
        blob = str(vue)
        for fuite in ("7777", "cautions", "impayé", "Épargne"):
            self.assertNotIn(fuite, blob)

    def test_le_personnel_voit_le_detail(self):
        """L'asymétrie fonctionne dans les deux sens : l'agent doit pouvoir juger."""
        from credits.guarantee_proposals import serialize_for_staff

        vue = serialize_for_staff(self.proposal, with_capacity=True)
        self.assertEqual(vue["capacity"]["savings"], "7777.00")
        self.assertEqual(vue["capacity"]["ceiling"], "15554.00")
        self.assertIn("livePledges", vue["capacity"])

    def test_le_personnel_voit_la_regle_qui_bloquerait(self):
        from credits.guarantee_proposals import serialize_for_staff
        from savings.models import SavingsPlan

        SavingsPlan.objects.filter(user=self.garant).update(balance=Decimal("10"))
        vue = serialize_for_staff(self.proposal, with_capacity=True)
        self.assertEqual(vue["blockingRule"]["code"], "GUARANTOR_OVEREXTENDED")

    def test_les_candidats_ne_revelent_aucune_capacite(self):
        """La liste de choix ne doit pas dire qui du groupe a de l'épargne."""
        from credits.guarantee_proposals import candidates_for

        blob = str(candidates_for(self.app))
        self.assertIn("Garant Fortune", blob)
        for fuite in ("7777", "savings", "eligible", "ceiling", "capacity"):
            self.assertNotIn(fuite, blob)


# ══ 8. Surface HTTP — contrat consommé par les trois écrans front ════════════

class ProposalApiTests(AuthedAPITestCase):

    def setUp(self):
        _config()
        self.demandeur = _user("sub-api-prop-demandeur", "Marie Kabemba")
        self.garant = _user("sub-api-prop-garant", "Jean Mukendi")
        _group("AVEC Api Prop", self.demandeur, self.garant)
        _savings(self.garant, "5000")
        self.app = _app(self.demandeur, "1000")

    def _payload(self, **over):
        data = {"guarantor_sub": str(self.garant.pk), "covered_amount": "400",
                "message": "C'est mon oncle."}
        data.update(over)
        return data

    # — Écran 1 : proposition par le client —

    def test_proposition_exige_authentification(self):
        res = self.client.post(_propositions_url(self.app.code), self._payload(),
                               format="json")
        self.assertEqual(res.status_code, 401)

    def test_le_titulaire_propose(self):
        self.login(role="client", sub=str(self.demandeur.pk))
        res = self.client.post(_propositions_url(self.app.code), self._payload(),
                               format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["state"], "proposed")
        self.assertEqual(res.data["coveredAmount"], 400.0)
        self.assertEqual(res.data["guarantor"]["displayName"], "Jean Mukendi")
        # Le `sub` du garant n'est pas nécessaire au demandeur pour suivre sa
        # demande : il ne sort pas.
        self.assertNotIn("sub", res.data["guarantor"])

    def test_un_autre_client_ne_propose_pas_sur_ce_dossier(self):
        autre = _user("sub-api-prop-autre", "Voisin")
        self.login(role="client", sub=str(autre.pk))
        res = self.client.post(_propositions_url(self.app.code), self._payload(),
                               format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["code"], "NOT_APPLICATION_OWNER")

    def test_erreurs_structurees(self):
        self.login(role="client", sub=str(self.demandeur.pk))
        res = self.client.post(_propositions_url(self.app.code),
                               self._payload(guarantor_sub="inconnu"), format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "GUARANTOR_UNKNOWN")
        self.assertEqual(set(res.data), {"detail", "code", "errors"})
        self.assertEqual(set(res.data["errors"][0]), {"code", "message"})

    def test_candidats_du_dossier(self):
        self.login(role="client", sub=str(self.demandeur.pk))
        res = self.client.get(_candidates_url(self.app.code))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["total_rows"], 1)
        candidat = res.data["items"][0]
        self.assertEqual(candidat["sub"], str(self.garant.pk))
        self.assertEqual(candidat["displayName"], "Jean Mukendi")
        self.assertEqual(candidat["sharedGroups"][0]["name"], "AVEC Api Prop")
        self.assertFalse(candidat["alreadyProposed"])

    def test_candidats_refuses_a_un_tiers(self):
        autre = _user("sub-api-prop-tiers", "Tiers")
        self.login(role="client", sub=str(autre.pk))
        self.assertEqual(
            self.client.get(_candidates_url(self.app.code)).status_code, 403)

    # — Écran 3 : suivi par le client —

    def test_suivi_du_demandeur(self):
        _propose(self.app, self.demandeur, self.garant)
        self.login(role="client", sub=str(self.demandeur.pk))
        res = self.client.get(PROPOSALS_URL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["total_rows"], 1)
        self.assertEqual(res.data["consent_window_hours"], 72)
        self.assertEqual(res.data["items"][0]["state"], "proposed")

    def test_le_suivi_est_strictement_personnel(self):
        _propose(self.app, self.demandeur, self.garant)
        self.login(role="client", sub=str(self.garant.pk))
        self.assertEqual(self.client.get(PROPOSALS_URL).data["total_rows"], 0)

    def test_un_admin_ne_voit_pas_les_propositions_des_autres_dans_ce_suivi(self):
        _propose(self.app, self.demandeur, self.garant)
        _user("sub-api-prop-admin")
        self.login(role="admin", sub="sub-api-prop-admin")
        self.assertEqual(self.client.get(PROPOSALS_URL).data["total_rows"], 0)

    def test_le_suivi_ne_fuit_aucune_donnee_du_garant(self):
        _propose(self.app, self.demandeur, self.garant)
        self.login(role="client", sub=str(self.demandeur.pk))
        blob = str(self.client.get(PROPOSALS_URL).data)
        for interdit in ("capacity", "savings", "ceiling", "livePledges",
                         "decisionComment", "5000"):
            self.assertNotIn(interdit, blob)

    # — Écran 2 : file de validation de l'agent —

    def test_file_refusee_au_client(self):
        self.login(role="client", sub=str(self.demandeur.pk))
        self.assertEqual(self.client.get(QUEUE_URL).status_code, 403)

    def test_file_refusee_a_un_role_client_porteur_de_read(self):
        """`agri_op`, `investor`, `partner` portent `read` — jamais « interne »."""
        _user("sub-api-prop-agri")
        self.login(role="agri_op", sub="sub-api-prop-agri")
        self.assertEqual(self.client.get(QUEUE_URL).status_code, 403)

    def test_file_de_l_agent(self):
        proposal = _propose(self.app, self.demandeur, self.garant)
        _user("sub-api-prop-agent")
        self.login(role="agent_terrain", sub="sub-api-prop-agent")
        res = self.client.get(QUEUE_URL)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["total_rows"], 1)
        self.assertFalse(res.data["truncated"])
        item = res.data["items"][0]
        self.assertEqual(item["id"], proposal.pk)
        self.assertEqual(item["applicationCode"], self.app.code)
        self.assertEqual(item["applicant"]["displayName"], "Marie Kabemba")
        self.assertEqual(item["guarantor"]["sub"], str(self.garant.pk))
        self.assertEqual(item["capacity"]["savings"], "5000.00")
        self.assertIsNone(item["blockingRule"])

    def test_validation_par_l_agent(self):
        proposal = _propose(self.app, self.demandeur, self.garant, montant="400")
        _user("sub-api-prop-agent2")
        self.login(role="agent_terrain", sub="sub-api-prop-agent2")
        res = self.client.post(_validate_url(proposal.pk), {
            "comment": "Pièce vue en agence.",
            "guarantor_id_number": "CNI-777",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "validated")
        self.assertEqual(res.data["guaranteeStatus"], "pending_consent")
        self.assertIsNotNone(res.data["consentExpiresAt"])

    def test_validation_refusee_au_client(self):
        proposal = _propose(self.app, self.demandeur, self.garant)
        self.login(role="client", sub=str(self.demandeur.pk))
        res = self.client.post(_validate_url(proposal.pk), {
            "comment": "Je valide moi-même.", "guarantor_id_number": "CNI-1",
        }, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.app.guarantees.count(), 0)

    def test_validation_sans_motif_refusee_avec_son_code(self):
        proposal = _propose(self.app, self.demandeur, self.garant)
        _user("sub-api-prop-agent3")
        self.login(role="agent_terrain", sub="sub-api-prop-agent3")
        res = self.client.post(_validate_url(proposal.pk),
                               {"guarantor_id_number": "CNI-1"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "DECISION_REASON_REQUIRED")

    def test_refus_par_l_agent(self):
        proposal = _propose(self.app, self.demandeur, self.garant)
        _user("sub-api-prop-agent4")
        self.login(role="agent_terrain", sub="sub-api-prop-agent4")
        res = self.client.post(_refuse_url(proposal.pk), {
            "reason_code": "garant_indisponible",
            "comment": "Déjà trois cautions en cours.",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "refused")
        self.assertEqual(res.data["refusalReasonCode"], "garant_indisponible")

    def test_le_client_ne_lit_pas_le_commentaire_de_refus_de_l_agent(self):
        """Bout en bout : ce que l'agent écrit reste à l'agence."""
        proposal = _propose(self.app, self.demandeur, self.garant)
        _user("sub-api-prop-agent5")
        self.login(role="agent_terrain", sub="sub-api-prop-agent5")
        self.client.post(_refuse_url(proposal.pk), {
            "reason_code": "garant_indisponible",
            "comment": "Son épargne est de 5000 et il porte 3 cautions.",
        }, format="json")

        self.login(role="client", sub=str(self.demandeur.pk))
        blob = str(self.client.get(PROPOSALS_URL).data)
        self.assertNotIn("épargne", blob)
        self.assertNotIn("5000", blob)
        self.assertIn("ne peut pas se porter caution", blob)

    def test_proposition_introuvable(self):
        _user("sub-api-prop-agent6")
        self.login(role="agent_terrain", sub="sub-api-prop-agent6")
        res = self.client.post(_refuse_url(999999),
                               {"reason_code": "autre", "comment": "x"},
                               format="json")
        self.assertEqual(res.status_code, 404)

    # — Vue du dossier : les deux publics, deux formes —

    def test_liste_du_dossier_pour_le_titulaire(self):
        _propose(self.app, self.demandeur, self.garant)
        self.login(role="client", sub=str(self.demandeur.pk))
        res = self.client.get(_propositions_url(self.app.code))
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("capacity", str(res.data))

    def test_liste_du_dossier_pour_le_personnel(self):
        _propose(self.app, self.demandeur, self.garant)
        _user("sub-api-prop-agent7")
        self.login(role="agent_terrain", sub="sub-api-prop-agent7")
        res = self.client.get(_propositions_url(self.app.code))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["items"][0]["applicant"]["sub"],
                         str(self.demandeur.pk))


# ══ 9. Le parcours complet, vu par le demandeur ══════════════════════════════

class ProposalLifecycleStatesTests(TestCase):
    """Les états servis au suivi client, un par un — le front n'en infère aucun."""

    def setUp(self):
        _config()
        self.demandeur = _user("sub-cycle-demandeur", "Demandeur")
        self.garant = _user("sub-cycle-garant", "Garant")
        _group("AVEC Cycle", self.demandeur, self.garant)
        _savings(self.garant, "5000")
        self.app = _app(self.demandeur, "1000")
        self.proposal = _propose(self.app, self.demandeur, self.garant, montant="400")

    def _state(self):
        from credits.guarantee_proposals import applicant_state
        self.proposal.refresh_from_db()
        return applicant_state(self.proposal)

    def _valider(self):
        from credits.guarantee_proposals import validate
        return validate(self.proposal, agent_sub="sub-agent",
                        comment="Pièce vue.", guarantor_id_number="CNI-1")

    def test_proposee(self):
        self.assertEqual(self._state(), "proposed")

    def test_refusee_par_l_agent(self):
        from credits.guarantee_proposals import refuse
        refuse(self.proposal, agent_sub="sub-agent", reason_code="autre",
               comment="Motif.")
        self.assertEqual(self._state(), "refused_by_agent")

    def test_en_attente_de_consentement(self):
        self._valider()
        self.assertEqual(self._state(), "awaiting_consent")

    def test_acceptee_par_le_garant(self):
        from credits.guarantees import record_guarantor_consent
        self._valider()
        garantie = CreditGuarantee.objects.get(application=self.app)
        record_guarantor_consent(garantie, responder_sub=str(self.garant.pk),
                                 accept=True)
        self.assertEqual(self._state(), "accepted")

    def test_refusee_par_le_garant(self):
        from credits.guarantees import record_guarantor_consent
        self._valider()
        garantie = CreditGuarantee.objects.get(application=self.app)
        record_guarantor_consent(garantie, responder_sub=str(self.garant.pk),
                                 accept=False)
        self.assertEqual(self._state(), "declined_by_guarantor")

    def test_expiree(self):
        self._valider()
        CreditGuarantee.objects.filter(application=self.app).update(
            consent_expires_at=timezone.now() - timezone.timedelta(hours=1),
        )
        self.assertEqual(self._state(), "expired")

    def test_le_compte_a_rebours_est_servi_au_demandeur(self):
        from credits.guarantee_proposals import serialize_for_applicant
        self._valider()
        self.proposal.refresh_from_db()
        self.assertIsNotNone(serialize_for_applicant(self.proposal)["consentExpiresAt"])

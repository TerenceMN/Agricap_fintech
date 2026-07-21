"""
Comité de crédit — décision collégiale à quorum.

Couvre : le quorum lu (repli documenté), un vote par membre (append-only),
maker ≠ checker, la résolution qui passe par `workflow` (jamais d'écriture directe
de statut), et la journalisation de chaque vote + du procès-verbal.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from accounts.models import FintechUser
from audit.models import AuditEntry
from credits import committee as cm
from credits.models import CommitteeVote, CreditApplication, ImmutableCommitteeVote


def _user(sub: str) -> FintechUser:
    user, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": sub, "phone": f"+243{sub[-9:].zfill(9)}"},
    )
    return user


_SEQ = {"n": 0}


def _committee_app(amount="30000", status="in_analysis") -> CreditApplication:
    """Dossier > plafond de délégation, monté par un agent distinct du comité."""
    _SEQ["n"] += 1
    return CreditApplication.objects.create(
        client=_user("sub-client"),
        submitted_by_sub="sub-agent-maker",
        initiated_by_sub="",
        status=status, currency="USD",
        amount_requested=Decimal(amount),
        code=f"CRED-CMT-{_SEQ['n']:04d}",
    )


class QuorumConfigTest(TestCase):
    def test_quorum_repli_documente(self):
        # Aucun InstitutionConfig ni settings.CREDIT_COMMITTEE_QUORUM en test :
        # repli sur la valeur de secours, jamais une exception.
        self.assertEqual(cm.committee_quorum(), cm.DEFAULT_QUORUM)

    def test_seuil_comite_est_le_plafond_agence(self):
        self.assertEqual(cm.committee_threshold_usd(), 25000.0)

    def test_dossier_sous_seuil_n_exige_pas_le_comite(self):
        app = _committee_app(amount="10000")
        self.assertFalse(cm.requires_committee(app))


class CommitteeVoteTest(TestCase):
    def test_un_vote_exige_un_motif(self):
        app = _committee_app()
        with self.assertRaises(cm.CommitteeInvalidDecision):
            cm.cast_vote(app, voter_sub="sub-dg-1", decision="approve",
                         comment="", voter_roles=["dg"])

    def test_sens_de_vote_invalide_refuse(self):
        app = _committee_app()
        with self.assertRaises(cm.CommitteeInvalidDecision):
            cm.cast_vote(app, voter_sub="sub-dg-1", decision="peutetre",
                         comment="hmm", voter_roles=["dg"])

    def test_maker_ne_vote_pas(self):
        app = _committee_app()
        with self.assertRaises(cm.CommitteeMakerChecker):
            cm.cast_vote(app, voter_sub="sub-agent-maker", decision="approve",
                         comment="je m'auto-valide", voter_roles=["dg"])

    def test_dossier_sous_seuil_refuse_le_comite(self):
        app = _committee_app(amount="10000")
        with self.assertRaises(cm.CommitteeNotRequired):
            cm.cast_vote(app, voter_sub="sub-dg-1", decision="approve",
                         comment="ok", voter_roles=["dg"])

    def test_un_membre_ne_vote_qu_une_fois(self):
        app = _committee_app()
        cm.cast_vote(app, voter_sub="sub-dg-1", decision="approve",
                     comment="favorable", voter_roles=["dg"])
        with self.assertRaises(cm.CommitteeAlreadyVoted):
            cm.cast_vote(app, voter_sub="sub-dg-1", decision="reject",
                         comment="je change d'avis", voter_roles=["dg"])
        self.assertEqual(app.committee_votes.count(), 1)

    def test_vote_est_append_only(self):
        app = _committee_app()
        cm.cast_vote(app, voter_sub="sub-dg-1", decision="approve",
                     comment="favorable", voter_roles=["dg"])
        vote = CommitteeVote.objects.get(application=app, voter_sub="sub-dg-1")
        vote.decision = "reject"
        with self.assertRaises(ImmutableCommitteeVote):
            vote.save()

    def test_chaque_vote_est_journalise(self):
        app = _committee_app()
        cm.cast_vote(app, voter_sub="sub-dg-1", decision="approve",
                     comment="favorable", voter_roles=["dg"])
        self.assertEqual(
            AuditEntry.objects.filter(
                entity_type="CreditApplication", entity_id=app.code,
                action="credits.committee.vote",
            ).count(),
            1,
        )

    def test_quorum_atteint_approuve_via_workflow(self):
        app = _committee_app()
        cm.cast_vote(app, voter_sub="sub-dg-1", decision="approve",
                     comment="favorable", voter_roles=["dg"])
        cm.cast_vote(app, voter_sub="sub-dg-2", decision="approve",
                     comment="favorable", voter_roles=["dg"])
        res = cm.cast_vote(app, voter_sub="sub-dg-3", decision="approve",
                           comment="favorable", voter_roles=["dg"])

        self.assertTrue(res["resolved"])
        self.assertEqual(res["decision"], "approve")
        app.refresh_from_db()
        self.assertEqual(app.status, "approved")
        self.assertEqual(app.amount_approved, Decimal("30000"))
        # La transition d'approbation ET le procès-verbal sont journalisés.
        self.assertEqual(
            AuditEntry.objects.filter(
                entity_type="CreditApplication", entity_id=app.code,
                action="credits.workflow.approve").count(), 1)
        self.assertEqual(
            AuditEntry.objects.filter(
                entity_type="CreditApplication", entity_id=app.code,
                action="credits.committee.resolved").count(), 1)

    def test_quorum_atteint_rejette_via_workflow(self):
        app = _committee_app()
        for i in (1, 2, 3):
            res = cm.cast_vote(app, voter_sub=f"sub-dg-{i}", decision="reject",
                               comment="risque trop élevé", voter_roles=["dg"])
        self.assertTrue(res["resolved"])
        self.assertEqual(res["decision"], "reject")
        app.refresh_from_db()
        self.assertEqual(app.status, "rejected")
        self.assertEqual(app.rejection_reason_code, "autre")

    def test_pas_de_resolution_sous_le_quorum(self):
        app = _committee_app()
        cm.cast_vote(app, voter_sub="sub-dg-1", decision="approve",
                     comment="favorable", voter_roles=["dg"])
        res = cm.cast_vote(app, voter_sub="sub-dg-2", decision="approve",
                           comment="favorable", voter_roles=["dg"])
        self.assertFalse(res["resolved"])
        app.refresh_from_db()
        self.assertEqual(app.status, "in_analysis")

    def test_vote_apres_resolution_refuse(self):
        app = _committee_app()
        for i in (1, 2, 3):
            cm.cast_vote(app, voter_sub=f"sub-dg-{i}", decision="approve",
                         comment="favorable", voter_roles=["dg"])
        app.refresh_from_db()
        with self.assertRaises(cm.CommitteeStateError):
            cm.cast_vote(app, voter_sub="sub-dg-4", decision="approve",
                         comment="trop tard", voter_roles=["dg"])

    def test_summary_expose_le_proces_verbal(self):
        app = _committee_app()
        cm.cast_vote(app, voter_sub="sub-dg-1", decision="approve",
                     comment="favorable", conditions="garantie renforcée",
                     voter_roles=["dg"])
        summary = cm.votes_summary(app)
        self.assertEqual(summary["quorum"], cm.DEFAULT_QUORUM)
        self.assertEqual(summary["tally"], {"approve": 1, "reject": 0})
        self.assertEqual(len(summary["votes"]), 1)
        self.assertEqual(summary["votes"][0]["conditions"], "garantie renforcée")
        self.assertFalse(summary["resolved"])

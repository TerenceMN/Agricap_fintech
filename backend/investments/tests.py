"""Tests du module investissement.

Hiérarchie d'exigence de `CLAUDE.md` §5 appliquée au cycle de vie :

1. **Workflow** : chaque transition autorisée ET chaque transition interdite du graphe
   P01→P13 est testée (`AllowedTransitionsTests` / `ForbiddenTransitionsTests`, dont un
   test exhaustif qui balaie le complément du graphe — aucune transition sautée ne peut
   apparaître sans casser la suite).
2. **Propriétés invariantes** : la souscription réserve sans encaisser, Σ allocations
   prorata = objectif au centime, Σ lignes de distribution = montant distribué,
   cantonnement soldé à P11.
3. **Anti-fuite** : un investisseur ne voit ni les dossiers en due diligence, ni les
   autres investisseurs.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from common.exceptions import ConflictError, ValidationFailed
from common.idempotency import IdempotentReplay
from common.testing import AuthedAPITestCase

from . import committee, funding, metrics, services, workflow
from .models import (
    AnalystObservation, BondConversion, BondWithdrawal, Collateral, Distribution,
    FinancialAnalysis, InvestmentCommitteeVote, InvestmentEvent, Investor, Offer,
    ObligationPosition, Project, ProjectQuestion, ProjectTransition, RepaymentSchedule,
    Subscription, TechnicalAnalysis,
)

S = Project.Status


# ── Fabriques ────────────────────────────────────────────────────────────────

def make_investor(sub: str) -> Investor:
    from accounts.models import FintechUser
    user = FintechUser.objects.create(sub=sub, email=f"{sub}@test.local", role="invest")
    return Investor.objects.create(user=user)


def make_project(code: str, **extra) -> Project:
    defaults = {"sector": "Maïs", "location": "Kongo-Central", "promoter": "Coop Kimbanseke",
                "funding_target": "10000"}
    defaults.update(extra)
    p = services.create_project(
        code=code, title=f"Projet {code}", sector=defaults["sector"],
        location=defaults["location"], funding_target=defaults["funding_target"],
        promoter=defaults["promoter"], manager_sub="mgr", by="mgr",
    )
    p.description = "Culture de maïs sur 12 ha en rotation."
    p.save(update_fields=["description"])
    return p


def advance_to(project: Project, target: str, *, quorum_voters=("cm1", "cm2", "cm3"),
                offer: Offer | None = None) -> Project:
    """Amène un projet jusqu'à `target` en satisfaisant CHAQUE garde — jamais en sautant."""
    order = [S.P01, S.P02, S.P03, S.P04, S.P05, S.P06]
    for etape in order:
        if project.status == target:
            return project
        if etape == S.P01:
            continue
        if etape == S.P02:
            services.transition_status(project=project, to_status=S.P02, by="mgr",
                                        reason="Dossier promoteur reçu et complet.")
        elif etape == S.P03:
            project.global_score = 72.0
            project.save(update_fields=["global_score"])
            services.transition_status(project=project, to_status=S.P03, by="mgr",
                                        reason="Analyse initiale scorée à 72.")
        elif etape == S.P04:
            TechnicalAnalysis.objects.get_or_create(project=project)
            FinancialAnalysis.objects.get_or_create(project=project)
            services.approve_analysis(project=project, kind="technical", by="ana1")
            services.approve_analysis(project=project, kind="financial", by="ana2")
            services.transition_status(project=project, to_status=S.P04, by="mgr",
                                        reason="Saisine du comité d'investissement.")
        elif etape == S.P05:
            for voter in quorum_voters:
                committee.cast_vote(project, voter_sub=voter, decision="approve",
                                     comment="Dossier solide, rendement cohérent.",
                                     conditions="Assurance récolte souscrite avant décaissement.")
            project.refresh_from_db()
            services.transition_status(project=project, to_status=S.P05, by="dg",
                                        reason="Décision favorable du comité.")
        elif etape == S.P06:
            if offer is None and not project.offers.exists():
                services.create_offer(project=project, code=f"OFR-{project.code}",
                                       coupon_rate="9.0", maturity_months=24, min_ticket="100",
                                       available_bonds=100, funding_goal="10000", by="mgr")
            services.clear_conditions(project=project, by="dg", note="Attestation reçue.")
            project.refresh_from_db()
            services.transition_status(project=project, to_status=S.P06, by="dg",
                                        reason="Conditions levées, offre publiée.")
        project.refresh_from_db()
    return project


def funded_project(code: str, investor: Investor, bonds: int = 80) -> tuple[Project, Offer, Subscription]:
    """Projet P06 doté d'une souscription ENCAISSÉE — la brique des tests de métriques.

    80 titres × 100 = 8 000 encaissés sur un objectif de 10 000 (plancher dérivé à
    7 000) : la levée est clôturable, les chiffres sont ronds et vérifiables à la main.
    """
    project = advance_to(make_project(code), S.P06)
    offer = project.offers.first()
    sub = funding.reserve(investor=investor, offer_id=offer.pk, bonds=bonds,
                           idempotency_key=f"r-{code}", by="t")
    funding.settle(subscription=sub, idempotency_key=f"s-{code}", by="caisse")
    project.refresh_from_db()
    sub.refresh_from_db()
    return project, offer, sub


def to_p10(project: Project, offer: Offer, *, amount: str = "8000", due_in_days: int = 30) -> Project:
    """Amène un projet doté jusqu'à la phase de remboursement, échéancier compris."""
    project = funding.close_fundraising(project=project, by="dg", reason="Clôture de la levée.")
    project = funding.disburse(project=project, amount=amount,
                                idempotency_key=f"d-{project.code}", by="dg")
    project = services.transition_status(project=project, to_status=S.P09, by="mgr",
                                          reason="Fonds reçus par le promoteur.")
    RepaymentSchedule.objects.create(offer=offer, due_date=date.today() + timedelta(days=due_in_days),
                                      amount_due=Decimal("8800"))
    return services.transition_status(project=project, to_status=S.P10, by="mgr",
                                       reason="Échéancier de retour démarré.")


def funded_subs(investor: Investor) -> list[Subscription]:
    return list(
        Subscription.objects.filter(investor=investor, status__in=Subscription.FUNDED_STATUSES)
        .select_related("offer__project")
    )


def settle_all(project: Project, prefix: str = "k") -> None:
    for i, sub in enumerate(Subscription.objects.filter(offer__project=project,
                                                         status=Subscription.Status.RESERVED)):
        funding.settle(subscription=sub, idempotency_key=f"{prefix}-{project.code}-{i}", by="caisse")


# ── 1. Transitions AUTORISÉES ────────────────────────────────────────────────

class AllowedTransitionsTests(AuthedAPITestCase):
    """Un test par transition autorisée du graphe P01→P13."""

    def test_p01_to_p02_dossier_promoteur_complet(self):
        p = make_project("T-0102")
        p = services.transition_status(project=p, to_status=S.P02, by="mgr", reason="Dossier complet.")
        self.assertEqual(p.status, S.P02)

    def test_p02_to_p03_analyse_initiale_scoree(self):
        p = advance_to(make_project("T-0203"), S.P02)
        p.global_score = 65.0
        p.save(update_fields=["global_score"])
        p = services.transition_status(project=p, to_status=S.P03, by="mgr", reason="Scoré.")
        self.assertEqual(p.status, S.P03)

    def test_p03_to_p04_deux_analyses_approuvees(self):
        p = advance_to(make_project("T-0304"), S.P03)
        TechnicalAnalysis.objects.create(project=p)
        FinancialAnalysis.objects.create(project=p)
        services.approve_analysis(project=p, kind="technical", by="a1")
        services.approve_analysis(project=p, kind="financial", by="a2")
        p = services.transition_status(project=p, to_status=S.P04, by="mgr", reason="Saisine comité.")
        self.assertEqual(p.status, S.P04)

    def test_p04_to_p05_quorum_favorable_et_conditions(self):
        p = advance_to(make_project("T-0405"), S.P04)
        for voter in ("cm1", "cm2", "cm3"):
            committee.cast_vote(p, voter_sub=voter, decision="approve", comment="Favorable.",
                                 conditions="Assurance récolte.")
        p.refresh_from_db()
        p = services.transition_status(project=p, to_status=S.P05, by="dg", reason="Comité favorable.")
        self.assertEqual(p.status, S.P05)

    def test_p05_to_p06_conditions_levees_et_offre_publiee(self):
        p = advance_to(make_project("T-0506"), S.P05)
        services.create_offer(project=p, code="OFR-0506", coupon_rate="9", maturity_months=24,
                               min_ticket="100", available_bonds=100, funding_goal="10000", by="mgr")
        services.clear_conditions(project=p, by="dg")
        p.refresh_from_db()
        p = services.transition_status(project=p, to_status=S.P06, by="dg", reason="Levée ouverte.")
        self.assertEqual(p.status, S.P06)

    def test_p06_to_p05_retour_arriere_suspension_motivee(self):
        """Unique retour arrière du cycle — possible tant que rien n'est encaissé."""
        p = advance_to(make_project("T-0605"), S.P06)
        p = services.transition_status(project=p, to_status=S.P05, by="dg",
                                        reason="Doute sur la garantie : levée suspendue.")
        self.assertEqual(p.status, S.P05)

    def test_p06_to_p07_cloture_min_funding_atteint(self):
        p = advance_to(make_project("T-0607"), S.P06)
        offer = p.offers.first()
        inv = make_investor("inv-0607")
        funding.reserve(investor=inv, offer_id=offer.pk, bonds=90, idempotency_key="r1", by="inv-0607")
        settle_all(p)
        p.refresh_from_db()
        p = funding.close_fundraising(project=p, by="dg", reason="Échéance atteinte.")
        self.assertEqual(p.status, S.P07)

    def test_p07_to_p08_decaissement(self):
        p = self._funded_project("T-0708")
        p = funding.disburse(project=p, amount="9000", idempotency_key="d1", by="caissier",
                              reason="Décaissement tranche unique.")
        self.assertEqual(p.status, S.P08)
        self.assertEqual(p.disbursed_amount, Decimal("9000.00"))

    def test_p08_to_p09_fonds_recus(self):
        p = self._disbursed_project("T-0809")
        p = services.transition_status(project=p, to_status=S.P09, by="mgr",
                                        reason="Fonds reçus, reporting promoteur ouvert.")
        self.assertEqual(p.status, S.P09)

    def test_p09_to_p10_echeancier_de_retour(self):
        p = self._disbursed_project("T-0910")
        p = services.transition_status(project=p, to_status=S.P09, by="mgr", reason="En cours.")
        RepaymentSchedule.objects.create(offer=p.offers.first(), due_date=date.today(),
                                          amount_due=Decimal("1000"))
        p = services.transition_status(project=p, to_status=S.P10, by="mgr",
                                        reason="Échéancier de retour actif.")
        self.assertEqual(p.status, S.P10)

    def test_p10_to_p11_cantonnement_solde(self):
        p = self._repaying_project("T-1011")
        funding.record_return(project=p, amount="9900", idempotency_key="ret1", by="caisse")
        p.refresh_from_db()
        funding.distribute(offer=p.offers.first(), amount="9900", idempotency_key="dist1", by="dg")
        p.refresh_from_db()
        self.assertEqual(workflow.segregated_balance(p), Decimal("0.00"))
        p = services.transition_status(project=p, to_status=S.P11, by="dg",
                                        reason="Capital et rendement intégralement distribués.")
        self.assertEqual(p.status, S.P11)

    def test_p08_to_p12_defaut(self):
        p = self._disbursed_project("T-0812")
        p = services.transition_status(project=p, to_status=S.P12, by="dg",
                                        reason="Promoteur injoignable, récolte perdue.")
        self.assertEqual(p.status, S.P12)
        self.assertIsNotNone(p.defaulted_at)

    def test_p09_to_p12_defaut(self):
        p = self._disbursed_project("T-0912")
        p = services.transition_status(project=p, to_status=S.P09, by="mgr", reason="En cours.")
        p = services.transition_status(project=p, to_status=S.P12, by="dg", reason="Défaut constaté.")
        self.assertEqual(p.status, S.P12)

    def test_p10_to_p12_defaut(self):
        p = self._repaying_project("T-1012")
        p = services.transition_status(project=p, to_status=S.P12, by="dg",
                                        reason="Échéances impayées depuis 120 jours.")
        self.assertEqual(p.status, S.P12)

    def test_p01_to_p13_annulation(self):
        p = make_project("T-0113")
        p = funding.cancel_project(project=p, by="mgr", reason="Promoteur s'est retiré.")
        self.assertEqual(p.status, S.P13)

    def test_p02_to_p13_annulation(self):
        p = advance_to(make_project("T-0213"), S.P02)
        p = funding.cancel_project(project=p, by="mgr", reason="Dossier abandonné.")
        self.assertEqual(p.status, S.P13)

    def test_p03_to_p13_annulation(self):
        p = advance_to(make_project("T-0313"), S.P03)
        p = funding.cancel_project(project=p, by="mgr", reason="Due diligence défavorable.")
        self.assertEqual(p.status, S.P13)

    def test_p04_to_p13_annulation_apres_rejet_du_comite(self):
        p = advance_to(make_project("T-0413"), S.P04)
        for voter in ("cm1", "cm2", "cm3"):
            committee.cast_vote(p, voter_sub=voter, decision="reject", comment="Rendement irréaliste.")
        p.refresh_from_db()
        p = funding.cancel_project(project=p, by="dg", reason="Rejet du comité d'investissement.")
        self.assertEqual(p.status, S.P13)

    def test_p05_to_p13_annulation(self):
        p = advance_to(make_project("T-0513"), S.P05)
        p = funding.cancel_project(project=p, by="dg", reason="Conditions jamais levées.")
        self.assertEqual(p.status, S.P13)

    def test_p06_to_p13_annulation_rembourse_les_souscripteurs(self):
        p = advance_to(make_project("T-0613"), S.P06)
        inv = make_investor("inv-0613")
        sub = funding.reserve(investor=inv, offer_id=p.offers.first().pk, bonds=50,
                               idempotency_key="r-0613", by="inv-0613")
        funding.settle(subscription=sub, idempotency_key="s-0613", by="caisse")
        p.refresh_from_db()
        p = funding.cancel_project(project=p, by="dg", reason="Retrait du promoteur.")
        sub.refresh_from_db()
        self.assertEqual(p.status, S.P13)
        self.assertEqual(sub.status, Subscription.Status.REFUNDED)
        self.assertEqual(sub.refunded_amount, Decimal("5000.00"))

    def test_p07_to_p13_annulation(self):
        p = self._funded_project("T-0713")
        p = funding.cancel_project(project=p, by="dg", reason="Projet abandonné avant décaissement.")
        self.assertEqual(p.status, S.P13)

    # -- helpers d'état --------------------------------------------------------

    def _funded_project(self, code: str) -> Project:
        p = advance_to(make_project(code), S.P06)
        inv = make_investor(f"inv-{code}")
        funding.reserve(investor=inv, offer_id=p.offers.first().pk, bonds=90,
                         idempotency_key=f"r-{code}", by="inv")
        settle_all(p)
        p.refresh_from_db()
        return funding.close_fundraising(project=p, by="dg", reason="Clôture.")

    def _disbursed_project(self, code: str) -> Project:
        p = self._funded_project(code)
        return funding.disburse(project=p, amount="9000", idempotency_key=f"d-{code}",
                                 by="caissier", reason="Décaissement.")

    def _repaying_project(self, code: str) -> Project:
        p = self._disbursed_project(code)
        p = services.transition_status(project=p, to_status=S.P09, by="mgr", reason="En cours.")
        RepaymentSchedule.objects.create(offer=p.offers.first(), due_date=date.today(),
                                          amount_due=Decimal("9900"))
        return services.transition_status(project=p, to_status=S.P10, by="mgr",
                                           reason="Remboursement démarré.")


# ── 2. Transitions INTERDITES ────────────────────────────────────────────────

class ForbiddenTransitionsTests(AuthedAPITestCase):
    """Un test par famille de transition interdite, plus un balayage exhaustif du
    complément du graphe : aucune transition sautée ne peut être introduite en
    silence."""

    def test_toute_transition_hors_graphe_est_refusee(self):
        """Balaie les 13×13 couples et vérifie que ceux hors graphe sont refusés."""
        tous = list(workflow.ALLOWED_TRANSITIONS)
        for i, depart in enumerate(tous):
            interdits = [c for c in tous if c not in workflow.allowed_targets(depart) and c != depart]
            p = make_project(f"F-{i:02d}")
            Project.objects.filter(pk=p.pk).update(status=depart)
            p.refresh_from_db()
            for cible in interdits:
                with self.subTest(transition=f"{depart}->{cible}"):
                    with self.assertRaises(workflow.InvalidTransition):
                        services.transition_status(project=p, to_status=cible, by="x",
                                                    reason="Tentative.")

    def test_saut_p01_vers_p06_refuse(self):
        p = make_project("F-SAUT")
        with self.assertRaises(workflow.InvalidTransition):
            services.transition_status(project=p, to_status=S.P06, by="x", reason="Raccourci.")

    def test_p02_sans_dossier_promoteur_refuse(self):
        p = services.create_project(code="F-P02", title="Sans promoteur", by="mgr")
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P02, by="mgr", reason="Trop tôt.")

    def test_p03_sans_score_refuse(self):
        p = advance_to(make_project("F-P03"), S.P02)
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P03, by="mgr", reason="Trop tôt.")

    def test_p04_sans_analyses_approuvees_refuse(self):
        p = advance_to(make_project("F-P04"), S.P03)
        TechnicalAnalysis.objects.create(project=p)
        FinancialAnalysis.objects.create(project=p)
        # Analyses présentes mais NON approuvées : la garde exige l'acte humain.
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P04, by="mgr", reason="Trop tôt.")

    def test_p05_sans_quorum_refuse(self):
        p = advance_to(make_project("F-P05"), S.P04)
        committee.cast_vote(p, voter_sub="cm1", decision="approve", comment="Favorable.")
        p.refresh_from_db()
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P05, by="dg", reason="Un seul vote.")

    def test_p05_quorum_atteint_mais_sans_conditions_refuse(self):
        p = advance_to(make_project("F-P05C"), S.P04)
        for voter in ("cm1", "cm2", "cm3"):
            committee.cast_vote(p, voter_sub=voter, decision="approve", comment="Favorable.")
        p.refresh_from_db()
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P05, by="dg", reason="Sans conditions.")

    def test_p06_sans_conditions_levees_refuse(self):
        p = advance_to(make_project("F-P06"), S.P05)
        services.create_offer(project=p, code="OFR-F06", coupon_rate="9", maturity_months=24,
                               min_ticket="100", available_bonds=10, funding_goal="1000", by="mgr")
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P06, by="dg", reason="Trop tôt.")

    def test_p06_sans_offre_publiee_refuse(self):
        p = advance_to(make_project("F-P06B"), S.P05)
        services.create_offer(project=p, code="OFR-F06B", coupon_rate="9", maturity_months=24,
                               min_ticket="100", available_bonds=10, funding_goal="1000", by="mgr")
        services.clear_conditions(project=p, by="dg")
        p.offers.update(status=Offer.Status.DRAFT)
        p.refresh_from_db()
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P06, by="dg", reason="Sans offre.")

    def test_retour_p06_vers_p05_refuse_si_argent_encaisse(self):
        p = advance_to(make_project("F-RETOUR"), S.P06)
        inv = make_investor("inv-retour")
        sub = funding.reserve(investor=inv, offer_id=p.offers.first().pk, bonds=10,
                               idempotency_key="r-retour", by="inv-retour")
        funding.settle(subscription=sub, idempotency_key="s-retour", by="caisse")
        p.refresh_from_db()
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P05, by="dg", reason="Suspension.")

    def test_p07_avec_offre_encore_ouverte_refuse(self):
        p = advance_to(make_project("F-P07"), S.P06)
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P07, by="dg", reason="Trop tôt.")

    def test_p08_sans_encaissement_refuse(self):
        """Pas de décaissement sur des réservations : une promesse ne se décaisse pas."""
        p = advance_to(make_project("F-P08"), S.P06)
        offer = p.offers.first()
        Offer.objects.filter(pk=offer.pk).update(min_funding_amount=Decimal("0"))
        inv = make_investor("inv-f08")
        funding.reserve(investor=inv, offer_id=offer.pk, bonds=90, idempotency_key="r-f08", by="inv")
        p.refresh_from_db()
        p = funding.close_fundraising(project=p, by="dg", reason="Clôture sans encaissement.")
        self.assertEqual(p.status, S.P07)
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P08, by="dg", reason="Décaissement.")

    def test_p09_sans_decaissement_enregistre_refuse(self):
        p = advance_to(make_project("F-P09"), S.P06)
        Project.objects.filter(pk=p.pk).update(status=S.P08)
        p.refresh_from_db()
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P09, by="mgr", reason="Trop tôt.")

    def test_p10_sans_echeancier_refuse(self):
        p = AllowedTransitionsTests()._disbursed_project("F-P10")
        p = services.transition_status(project=p, to_status=S.P09, by="mgr", reason="En cours.")
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P10, by="mgr", reason="Sans échéancier.")

    def test_p11_avec_cantonnement_non_solde_refuse(self):
        p = AllowedTransitionsTests()._repaying_project("F-P11")
        funding.record_return(project=p, amount="9900", idempotency_key="ret-f11", by="caisse")
        p.refresh_from_db()
        funding.distribute(offer=p.offers.first(), amount="5000", idempotency_key="d-f11", by="dg")
        p.refresh_from_db()
        self.assertNotEqual(workflow.segregated_balance(p), Decimal("0.00"))
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P11, by="dg", reason="Clôture hâtive.")

    def test_p12_sans_decaissement_refuse(self):
        p = self_project = AllowedTransitionsTests()._funded_project("F-P12")
        Project.objects.filter(pk=self_project.pk).update(status=S.P08, disbursed_amount=Decimal("0"))
        p.refresh_from_db()
        with self.assertRaises(workflow.TransitionGuardFailed):
            services.transition_status(project=p, to_status=S.P12, by="dg", reason="Défaut ?")

    def test_p13_avec_souscription_encaissee_non_remboursee_refuse(self):
        p = advance_to(make_project("F-P13"), S.P06)
        inv = make_investor("inv-f13")
        sub = funding.reserve(investor=inv, offer_id=p.offers.first().pk, bonds=10,
                               idempotency_key="r-f13", by="inv-f13")
        funding.settle(subscription=sub, idempotency_key="s-f13", by="caisse")
        p.refresh_from_db()
        with self.assertRaises(workflow.TransitionGuardFailed):
            workflow.transition(p, to_status=S.P13, actor_sub="dg", reason="Annulation sèche.")

    def test_transition_sans_motif_refusee(self):
        p = make_project("F-MOTIF")
        with self.assertRaises(workflow.ReasonRequired):
            workflow.transition(p, to_status=S.P02, actor_sub="mgr", reason="   ")

    def test_statuts_terminaux_nont_aucune_suite(self):
        for terminal in (S.P11, S.P12, S.P13):
            self.assertEqual(workflow.allowed_targets(terminal), set())


# ── 3. Journalisation append-only ────────────────────────────────────────────

class TransitionJournalTests(AuthedAPITestCase):
    def test_chaque_transition_est_journalisee_avec_acteur_motif_horodatage(self):
        from audit.models import AuditEntry

        p = make_project("J-1")
        services.transition_status(project=p, to_status=S.P02, by="mgr-7",
                                    reason="Dossier promoteur validé en agence.",
                                    actor_role="gest_zone")
        t = ProjectTransition.objects.filter(project=p).get()
        self.assertEqual((t.from_status, t.to_status), (S.P01, S.P02))
        self.assertEqual(t.actor_sub, "mgr-7")
        self.assertEqual(t.actor_role, "gest_zone")
        self.assertIn("Dossier promoteur", t.reason)
        self.assertIsNotNone(t.created_at)
        self.assertTrue(AuditEntry.objects.filter(
            entity_type="Project", entity_id=p.code,
            action="investments.project.transition").exists())

    def test_le_journal_conserve_toutes_les_transitions(self):
        p = advance_to(make_project("J-2"), S.P06)
        self.assertEqual(ProjectTransition.objects.filter(project=p).count(), 5)


# ── 4. Comité d'investissement (P04) ─────────────────────────────────────────

class CommitteeTests(AuthedAPITestCase):
    def setUp(self):
        self.project = advance_to(make_project("C-1"), S.P04)

    def test_quorum_par_defaut_herite_du_comite_de_credit(self):
        from credits.committee import committee_quorum
        self.assertEqual(committee.quorum(), committee_quorum())

    def test_quorum_specifique_investissement_prime(self):
        from .models import InvestmentConfig
        InvestmentConfig.objects.create(committee_quorum=2)
        self.assertEqual(committee.quorum(), 2)

    def test_vote_sans_motif_refuse(self):
        with self.assertRaises(committee.CommitteeInvalidDecision):
            committee.cast_vote(self.project, voter_sub="cm1", decision="approve", comment="  ")

    def test_sens_de_vote_inconnu_refuse(self):
        with self.assertRaises(committee.CommitteeInvalidDecision):
            committee.cast_vote(self.project, voter_sub="cm1", decision="peut-etre", comment="Bof.")

    def test_vote_hors_p04_refuse(self):
        p = make_project("C-2")
        with self.assertRaises(committee.CommitteeStateError):
            committee.cast_vote(p, voter_sub="cm1", decision="approve", comment="Favorable.")

    def test_maker_checker_le_gestionnaire_ne_vote_pas(self):
        with self.assertRaises(committee.CommitteeMakerChecker):
            committee.cast_vote(self.project, voter_sub="mgr", decision="approve", comment="Favorable.")

    def test_un_membre_ne_vote_quune_fois(self):
        committee.cast_vote(self.project, voter_sub="cm1", decision="approve", comment="Favorable.")
        with self.assertRaises(committee.CommitteeAlreadyVoted):
            committee.cast_vote(self.project, voter_sub="cm1", decision="reject", comment="Changement.")

    def test_quorum_atteint_resout_le_comite(self):
        for voter in ("cm1", "cm2"):
            res = committee.cast_vote(self.project, voter_sub=voter, decision="approve",
                                       comment="Favorable.")
            self.assertFalse(res["resolved"])
        res = committee.cast_vote(self.project, voter_sub="cm3", decision="approve",
                                   comment="Favorable.", conditions="Assurance récolte.")
        self.assertTrue(res["resolved"])
        self.assertEqual(res["decision"], "approve")

    def test_conditions_votees_sont_agregees_sur_le_projet(self):
        committee.cast_vote(self.project, voter_sub="cm1", decision="approve", comment="OK.",
                             conditions="Contrat d'achat signé.")
        self.project.refresh_from_db()
        self.assertIn("Contrat d'achat signé", self.project.committee_conditions)

    def test_proces_verbal_liste_chaque_vote(self):
        committee.cast_vote(self.project, voter_sub="cm1", decision="approve", comment="Solide.")
        committee.cast_vote(self.project, voter_sub="cm2", decision="reject", comment="Trop risqué.")
        pv = committee.proces_verbal(self.project)
        self.assertIn("cm1", pv)
        self.assertIn("Trop risqué", pv)

    def test_votes_sont_append_only(self):
        committee.cast_vote(self.project, voter_sub="cm1", decision="approve", comment="OK.")
        self.assertEqual(InvestmentCommitteeVote.objects.filter(project=self.project).count(), 1)


# ── 5. Réservation ≠ encaissement ────────────────────────────────────────────

class ReservationVsSettlementTests(AuthedAPITestCase):
    def setUp(self):
        self.project = advance_to(make_project("R-1"), S.P06)
        self.offer = self.project.offers.first()
        self.investor = make_investor("inv-r1")

    def test_souscrire_reserve_sans_encaisser(self):
        sub = funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=3,
                               idempotency_key="r1", by="inv-r1")
        self.offer.refresh_from_db()
        self.project.refresh_from_db()
        self.assertEqual(sub.status, Subscription.Status.RESERVED)
        self.assertEqual(sub.amount, Decimal("300.00"))
        self.assertEqual(sub.settled_amount, Decimal("0.00"))
        self.assertEqual(self.offer.reserved_amount, Decimal("300.00"))
        self.assertEqual(self.offer.funded_amount, Decimal("0.00"))
        self.assertEqual(self.project.funded_amount, Decimal("0.00"))
        self.assertEqual(self.offer.available_bonds, 97)

    def test_encaissement_alimente_le_montant_finance_et_emet_b10(self):
        sub = funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=3,
                               idempotency_key="r2", by="inv-r1")
        sub = funding.settle(subscription=sub, idempotency_key="s2", by="caisse")
        self.offer.refresh_from_db()
        self.project.refresh_from_db()
        self.assertEqual(sub.status, Subscription.Status.SETTLED)
        self.assertEqual(sub.settled_amount, Decimal("300.00"))
        self.assertIsNotNone(sub.settled_at)
        self.assertEqual(self.offer.funded_amount, Decimal("300.00"))
        self.assertEqual(self.project.funded_amount, Decimal("300.00"))
        event = InvestmentEvent.objects.get(event_type=InvestmentEvent.Type.SUBSCRIPTION_SETTLED)
        self.assertEqual(event.amount, Decimal("300.00"))
        self.assertEqual(event.segregation_account, f"419-OFF-{self.offer.code}")

    def test_double_encaissement_refuse(self):
        sub = funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=2,
                               idempotency_key="r3", by="inv-r1")
        funding.settle(subscription=sub, idempotency_key="s3", by="caisse")
        with self.assertRaises(ConflictError):
            funding.settle(subscription=sub, idempotency_key="s3-bis", by="caisse")

    def test_encaissement_superieur_a_lalloue_refuse(self):
        sub = funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=2,
                               idempotency_key="r4", by="inv-r1")
        with self.assertRaises(ValidationFailed):
            funding.settle(subscription=sub, idempotency_key="s4", by="caisse", amount="500")

    def test_replay_idempotent_ne_double_pas_la_reservation(self):
        funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=2,
                         idempotency_key="same", by="inv-r1")
        with self.assertRaises(IdempotentReplay):
            funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=2,
                             idempotency_key="same", by="inv-r1")
        self.offer.refresh_from_db()
        self.assertEqual(self.offer.available_bonds, 98)

    def test_souscription_impossible_hors_p06(self):
        services.transition_status(project=self.project, to_status=S.P05, by="dg",
                                    reason="Suspension.")
        with self.assertRaises(ConflictError):
            funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=1,
                             idempotency_key="r5", by="inv-r1")

    def test_annulation_dune_reservation_libere_les_titres(self):
        sub = funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=4,
                               idempotency_key="r6", by="inv-r1")
        funding.cancel_reservation(subscription=sub, by="inv-r1", reason="Changement d'avis.")
        self.offer.refresh_from_db()
        self.assertEqual(self.offer.available_bonds, 100)
        self.assertEqual(self.offer.reserved_amount, Decimal("0.00"))

    def test_une_souscription_encaissee_ne_sannule_pas_elle_se_rembourse(self):
        sub = funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=1,
                               idempotency_key="r7", by="inv-r1")
        funding.settle(subscription=sub, idempotency_key="s7", by="caisse")
        with self.assertRaises(ConflictError):
            funding.cancel_reservation(subscription=sub, by="inv-r1", reason="Trop tard.")

    def test_investisseur_suspendu_ne_souscrit_pas(self):
        services.investor_action(investor=self.investor, action="suspend", by="dg")
        self.investor.refresh_from_db()
        with self.assertRaises(ConflictError):
            funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=1,
                             idempotency_key="r8", by="inv-r1")

    def test_echeance_de_souscription_depassee_refuse(self):
        Offer.objects.filter(pk=self.offer.pk).update(
            subscription_deadline=timezone.localdate() - timedelta(days=1))
        with self.assertRaises(ConflictError):
            funding.reserve(investor=self.investor, offer_id=self.offer.pk, bonds=1,
                             idempotency_key="r9", by="inv-r1")


# ── 6. Sursouscription et min-funding ────────────────────────────────────────

class OversubscriptionTests(AuthedAPITestCase):
    def _project_with_policy(self, code: str, policy: str, goal: str = "1000") -> Project:
        p = advance_to(make_project(code), S.P05)
        services.create_offer(project=p, code=f"OFR-{code}", coupon_rate="9", maturity_months=24,
                               min_ticket="0", available_bonds=1000, funding_goal=goal,
                               oversubscription_policy=policy, min_funding_amount="0", by="mgr")
        services.clear_conditions(project=p, by="dg")
        p.refresh_from_db()
        return services.transition_status(project=p, to_status=S.P06, by="dg", reason="Ouvert.")

    def test_politique_reject_refuse_au_dela_de_lobjectif(self):
        p = self._project_with_policy("O-REJ", Offer.Oversubscription.REJECT)
        offer = p.offers.first()
        funding.reserve(investor=make_investor("o1"), offer_id=offer.pk, bonds=9,
                         idempotency_key="o1", by="o1")
        with self.assertRaises(ConflictError):
            funding.reserve(investor=make_investor("o2"), offer_id=offer.pk, bonds=5,
                             idempotency_key="o2", by="o2")

    def test_politique_queue_met_le_surplus_en_liste_dattente(self):
        p = self._project_with_policy("O-QUE", Offer.Oversubscription.QUEUE)
        offer = p.offers.first()
        premier = funding.reserve(investor=make_investor("q1"), offer_id=offer.pk, bonds=9,
                                   idempotency_key="q1", by="q1")
        second = funding.reserve(investor=make_investor("q2"), offer_id=offer.pk, bonds=5,
                                  idempotency_key="q2", by="q2")
        self.assertEqual(premier.status, Subscription.Status.RESERVED)
        self.assertEqual(second.status, Subscription.Status.WAITLISTED)
        self.assertEqual(second.queue_rank, 1)
        self.assertEqual(second.allocated_amount, Decimal("0.00"))

    def test_liste_dattente_non_servie_est_annulee_a_la_cloture(self):
        p = self._project_with_policy("O-QUE2", Offer.Oversubscription.QUEUE)
        offer = p.offers.first()
        funding.reserve(investor=make_investor("q3"), offer_id=offer.pk, bonds=10,
                         idempotency_key="q3", by="q3")
        attente = funding.reserve(investor=make_investor("q4"), offer_id=offer.pk, bonds=3,
                                   idempotency_key="q4", by="q4")
        settle_all(p)
        p.refresh_from_db()
        funding.close_fundraising(project=p, by="dg", reason="Clôture.")
        attente.refresh_from_db()
        self.assertEqual(attente.status, Subscription.Status.CANCELLED)

    def test_prorata_reduit_chaque_souscription_et_la_somme_egale_lobjectif(self):
        p = self._project_with_policy("O-PRO", Offer.Oversubscription.PRORATA)
        offer = p.offers.first()
        a = funding.reserve(investor=make_investor("p1"), offer_id=offer.pk, bonds=10,
                             idempotency_key="p1", by="p1")   # 1000
        b = funding.reserve(investor=make_investor("p2"), offer_id=offer.pk, bonds=5,
                             idempotency_key="p2", by="p2")   # 500
        c = funding.reserve(investor=make_investor("p3"), offer_id=offer.pk, bonds=5,
                             idempotency_key="p3", by="p3")   # 500
        funding.close_offer(offer=offer, by="dg")
        a.refresh_from_db(); b.refresh_from_db(); c.refresh_from_db()
        total = a.allocated_amount + b.allocated_amount + c.allocated_amount
        self.assertEqual(total, Decimal("1000.00"))
        self.assertEqual(a.allocated_amount, Decimal("500.00"))

    def test_prorata_encaissement_refuse_avant_cloture(self):
        p = self._project_with_policy("O-PRO2", Offer.Oversubscription.PRORATA)
        offer = p.offers.first()
        sub = funding.reserve(investor=make_investor("p4"), offer_id=offer.pk, bonds=10,
                               idempotency_key="p4", by="p4")
        with self.assertRaises(ConflictError):
            funding.settle(subscription=sub, idempotency_key="sp4", by="caisse")

    def test_min_funding_non_atteint_rembourse_et_annule(self):
        p = advance_to(make_project("O-MIN"), S.P05)
        services.create_offer(project=p, code="OFR-MIN", coupon_rate="9", maturity_months=24,
                               min_ticket="0", available_bonds=100, funding_goal="10000",
                               min_funding_amount="7000", by="mgr")
        services.clear_conditions(project=p, by="dg")
        p.refresh_from_db()
        p = services.transition_status(project=p, to_status=S.P06, by="dg", reason="Ouvert.")
        inv = make_investor("m1")
        sub = funding.reserve(investor=inv, offer_id=p.offers.first().pk, bonds=20,
                               idempotency_key="m1", by="m1")   # 2000 < 7000
        funding.settle(subscription=sub, idempotency_key="sm1", by="caisse")
        p.refresh_from_db()
        p = funding.close_fundraising(project=p, by="dg", reason="Échéance.")
        sub.refresh_from_db()
        self.assertEqual(p.status, S.P13)
        self.assertEqual(sub.status, Subscription.Status.REFUNDED)
        self.assertEqual(sub.refunded_amount, Decimal("2000.00"))
        self.assertEqual(p.funded_amount, Decimal("0.00"))
        self.assertTrue(InvestmentEvent.objects.filter(
            event_type=InvestmentEvent.Type.SUBSCRIPTION_REFUNDED).exists())

    def test_min_funding_derive_du_ratio_parametre_en_base(self):
        p = advance_to(make_project("O-RATIO"), S.P05)
        offer = services.create_offer(project=p, code="OFR-RATIO", coupon_rate="9",
                                       maturity_months=24, min_ticket="0", available_bonds=100,
                                       funding_goal="10000", by="mgr")
        self.assertEqual(offer.min_funding_amount, Decimal("7000.00"))  # ratio 0,70 par défaut


# ── 7. Décaissement, retours, distributions ──────────────────────────────────

class DisbursementAndDistributionTests(AuthedAPITestCase):
    def setUp(self):
        self.project = advance_to(make_project("D-1"), S.P06)
        self.offer = self.project.offers.first()
        self.a = make_investor("d-a")
        self.b = make_investor("d-b")
        s1 = funding.reserve(investor=self.a, offer_id=self.offer.pk, bonds=60,
                              idempotency_key="da", by="d-a")   # 6000
        s2 = funding.reserve(investor=self.b, offer_id=self.offer.pk, bonds=20,
                              idempotency_key="db", by="d-b")   # 2000
        funding.settle(subscription=s1, idempotency_key="sda", by="caisse")
        funding.settle(subscription=s2, idempotency_key="sdb", by="caisse")
        self.project.refresh_from_db()
        self.project = funding.close_fundraising(project=self.project, by="dg", reason="Clôture.")

    def test_decaissement_impossible_avant_cloture(self):
        p = advance_to(make_project("D-2"), S.P06)
        with self.assertRaises(ConflictError):
            funding.disburse(project=p, amount="100", idempotency_key="d2", by="dg")

    def test_decaissement_au_dela_du_cantonnement_refuse(self):
        with self.assertRaises(ValidationFailed):
            funding.disburse(project=self.project, amount="9000", idempotency_key="d3", by="dg")

    def test_decaissement_emet_b11_et_passe_en_p08(self):
        p = funding.disburse(project=self.project, amount="8000", idempotency_key="d4", by="dg",
                              reason="Tranche unique.")
        self.assertEqual(p.status, S.P08)
        self.assertEqual(workflow.segregated_balance(p), Decimal("0.00"))
        self.assertTrue(InvestmentEvent.objects.filter(
            event_type=InvestmentEvent.Type.PROJECT_DISBURSED, amount=Decimal("8000.00")).exists())

    def test_distribution_sans_encaissement_refusee(self):
        p = self._to_p10()
        with self.assertRaises(ConflictError):
            funding.distribute(offer=self.offer, amount="100", idempotency_key="dist0", by="dg")

    def test_distribution_au_prorata_des_montants_encaisses(self):
        p = self._to_p10()
        funding.record_return(project=p, amount="8800", idempotency_key="r1", by="caisse")
        p.refresh_from_db()
        dist = funding.distribute(offer=self.offer, amount="8800", idempotency_key="dist1", by="dg")
        lignes = {line.investor_id: line.amount for line in dist.lines.all()}
        self.assertEqual(sum(lignes.values()), Decimal("8800.00"))
        self.assertEqual(lignes[self.a.pk], Decimal("6600.00"))   # 6000/8000 × 8800
        self.assertEqual(lignes[self.b.pk], Decimal("2200.00"))   # 2000/8000 × 8800
        self.assertEqual(
            InvestmentEvent.objects.filter(
                event_type=InvestmentEvent.Type.DISTRIBUTION_PAID).count(), 2)

    def test_distribution_superieure_aux_retours_refusee(self):
        p = self._to_p10()
        funding.record_return(project=p, amount="1000", idempotency_key="r2", by="caisse")
        p.refresh_from_db()
        with self.assertRaises(ConflictError):
            funding.distribute(offer=self.offer, amount="5000", idempotency_key="dist2", by="dg")

    def test_defaut_bascule_les_souscriptions_et_emet_levenement(self):
        p = self._to_p10()
        p = services.transition_status(project=p, to_status=S.P12, by="dg",
                                        reason="Récolte détruite, promoteur insolvable.")
        self.assertTrue(Subscription.objects.filter(
            offer__project=p, status=Subscription.Status.DEFAULTED).exists())
        self.assertTrue(InvestmentEvent.objects.filter(
            event_type=InvestmentEvent.Type.PROJECT_DEFAULTED).exists())

    def test_remboursement_impossible_apres_decaissement(self):
        p = funding.disburse(project=self.project, amount="8000", idempotency_key="d5", by="dg")
        with self.assertRaises(ConflictError):
            funding.refund_project(project=p, by="dg", reason="Trop tard.")

    def _to_p10(self) -> Project:
        p = funding.disburse(project=self.project, amount="8000", idempotency_key="dp10", by="dg")
        p = services.transition_status(project=p, to_status=S.P09, by="mgr", reason="En cours.")
        RepaymentSchedule.objects.create(offer=self.offer, due_date=date.today(),
                                          amount_due=Decimal("8800"))
        return services.transition_status(project=p, to_status=S.P10, by="mgr",
                                           reason="Remboursement démarré.")


# ── 8. Métriques (Annexe D) ──────────────────────────────────────────────────

class XirrTests(AuthedAPITestCase):
    def test_xirr_cas_simple_10_pourcent_sur_un_an(self):
        flux = [(date(2025, 1, 1), Decimal("-1000")), (date(2026, 1, 1), Decimal("1100"))]
        taux = metrics.xirr(flux)
        self.assertAlmostEqual(float(taux), 0.10, places=3)

    def test_xirr_flux_irreguliers(self):
        flux = [
            (date(2025, 1, 1), Decimal("-10000")),
            (date(2025, 7, 1), Decimal("3000")),
            (date(2026, 1, 1), Decimal("8000")),
        ]
        taux = metrics.xirr(flux)
        self.assertGreater(float(taux), 0.10)
        self.assertLess(float(taux), 0.30)

    def test_xirr_indefini_sans_changement_de_signe(self):
        flux = [(date(2025, 1, 1), Decimal("-1000")), (date(2026, 1, 1), Decimal("-500"))]
        with self.assertRaises(metrics.XirrUndefined):
            metrics.xirr(flux)

    def test_xirr_indefini_avec_un_seul_flux(self):
        with self.assertRaises(metrics.XirrUndefined):
            metrics.xirr([(date(2025, 1, 1), Decimal("-1000"))])

    def test_xirr_or_none_retourne_le_motif_plutot_que_zero(self):
        taux, motif = metrics.xirr_or_none([(date(2025, 1, 1), Decimal("-1000"))])
        self.assertIsNone(taux)
        self.assertTrue(motif)


class HerfindahlTests(AuthedAPITestCase):
    def test_concentration_totale_vaut_un(self):
        self.assertEqual(metrics.herfindahl({"Maïs": Decimal("1000")}), Decimal("1.0000"))

    def test_repartition_egale_sur_quatre_axes(self):
        poids = {k: Decimal("250") for k in "abcd"}
        self.assertEqual(metrics.herfindahl(poids), Decimal("0.2500"))

    def test_base_vide_ne_donne_pas_de_concentration(self):
        self.assertEqual(metrics.herfindahl({}), Decimal("0"))


class HealthScoreTests(AuthedAPITestCase):
    def test_portefeuille_parfait_vaut_cent(self):
        res = metrics.health_score(default_rate=Decimal("0"), hhi=Decimal("0.1"), late=Decimal("0"))
        self.assertEqual(res["score"], 100.0)

    def test_penalites_appliquent_les_coefficients_de_la_base(self):
        # a=4 : 10 % de défaut → −40 points.
        res = metrics.health_score(default_rate=Decimal("0.10"), hhi=Decimal("0.1"),
                                    late=Decimal("0"))
        self.assertEqual(res["score"], 60.0)
        self.assertEqual(res["parameters"]["a"], 4.0)

    def test_score_borne_a_zero(self):
        res = metrics.health_score(default_rate=Decimal("1"), hhi=Decimal("1"), late=Decimal("1"))
        self.assertEqual(res["score"], 0.0)

    def test_coefficients_recalibrables_sans_toucher_au_code(self):
        from .models import InvestmentConfig
        InvestmentConfig.objects.create(health_coeff_default=Decimal("2"))
        res = metrics.health_score(default_rate=Decimal("0.10"), hhi=Decimal("0.1"),
                                    late=Decimal("0"))
        self.assertEqual(res["score"], 80.0)

    def test_la_formule_est_publiee_avec_le_score(self):
        res = metrics.health_score(default_rate=Decimal("0"), hhi=Decimal("0"), late=Decimal("0"))
        self.assertIn("taux_défaut", res["formula"])


class PortfolioMetricsTests(AuthedAPITestCase):
    def test_taux_de_defaut_en_valeur_et_en_nombre(self):
        sain = advance_to(make_project("M-SAIN"), S.P06)
        defaut = advance_to(make_project("M-DEF"), S.P06)
        for projet, montant, cle in ((sain, 60, "ms"), (defaut, 20, "md")):
            # Plancher neutralisé : ce test mesure le taux de défaut, pas le min-funding.
            Offer.objects.filter(project=projet).update(min_funding_amount=Decimal("0"))
            inv = make_investor(f"inv-{cle}")
            sub = funding.reserve(investor=inv, offer_id=projet.offers.first().pk, bonds=montant,
                                   idempotency_key=cle, by=cle)
            funding.settle(subscription=sub, idempotency_key=f"s{cle}", by="caisse")
            projet.refresh_from_db()
            funding.close_fundraising(project=projet, by="dg", reason="Clôture.")
        defaut.refresh_from_db()
        funding.disburse(project=defaut, amount="2000", idempotency_key="dmd", by="dg")
        defaut.refresh_from_db()
        services.transition_status(project=defaut, to_status=S.P12, by="dg", reason="Défaut.")

        res = metrics.portfolio_metrics()
        self.assertEqual(res["defaultRates"]["byValue"], 0.25)   # 2000 / 8000
        self.assertEqual(res["defaultRates"]["byCount"], 0.5)    # 1 projet sur 2
        self.assertEqual(res["defaultRates"]["defaultedProjects"], 1)

    def test_tri_indisponible_est_none_avec_son_motif_jamais_zero(self):
        p = advance_to(make_project("M-TRI"), S.P06)
        inv = make_investor("inv-tri")
        sub = funding.reserve(investor=inv, offer_id=p.offers.first().pk, bonds=10,
                               idempotency_key="mtri", by="inv-tri")
        funding.settle(subscription=sub, idempotency_key="smtri", by="caisse")
        res = metrics.investor_metrics(inv)
        self.assertIsNone(res["realizedReturn"])
        self.assertTrue(res["realizedReturnUnavailableReason"])

    def test_gain_latent_est_toujours_etiquete_latent(self):
        inv = make_investor("inv-latent")
        res = metrics.investor_metrics(inv)
        self.assertTrue(res["valuation"]["latentGainIsLatent"])
        self.assertIn("pair", res["valuation"]["method"])

    def test_total_investi_ne_compte_pas_les_reservations(self):
        p = advance_to(make_project("M-RES"), S.P06)
        inv = make_investor("inv-res")
        funding.reserve(investor=inv, offer_id=p.offers.first().pk, bonds=10,
                         idempotency_key="mres", by="inv-res")
        res = metrics.investor_metrics(inv)
        self.assertEqual(res["totalInvested"], 0.0)
        self.assertEqual(res["positionsCount"], 0)


# ── 8 bis. Annexe D : valorisation, retard, échéance, contexte des KPI ───────

class ValuationTests(AuthedAPITestCase):
    """Les trois méthodes de valorisation de l'Annexe D, chacune sur un cas chiffré."""

    def test_le_capital_restant_du_ne_diminue_que_des_remboursements_de_capital(self):
        inv = make_investor("v-cap")
        p, offer, _ = funded_project("V-CAP", inv)
        p = to_p10(p, offer)

        funding.record_return(project=p, amount="1000", idempotency_key="rc1", by="caisse")
        p.refresh_from_db()
        funding.distribute(offer=offer, amount="1000", kind=Distribution.Kind.COUPON,
                            idempotency_key="dc1", by="dg")
        val = metrics.latent_value(funded_subs(inv))
        # Un coupon rémunère le capital, il ne le rembourse pas : 8 000 restent dus.
        self.assertEqual(val["capitalOutstanding"], 8000.0)

        p.refresh_from_db()
        funding.record_return(project=p, amount="2000", idempotency_key="rc2", by="caisse")
        p.refresh_from_db()
        funding.distribute(offer=offer, amount="2000", kind=Distribution.Kind.CAPITAL,
                            idempotency_key="dc2", by="dg")
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["capitalOutstanding"], 6000.0)

    def test_interets_courus_sont_nets_des_coupons_deja_verses(self):
        inv = make_investor("v-int")
        p, offer, sub = funded_project("V-INT", inv)
        self.assertEqual(sub.coupon_rate_snapshot, Decimal("9.000"))
        Subscription.objects.filter(pk=sub.pk).update(settled_at=timezone.now() - timedelta(days=365))

        # 8 000 × 9 % × 365/365 = 720 d'intérêts courus, aucun coupon encore versé.
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["latentGain"], 720.0)
        self.assertTrue(val["latentGainIsLatent"])

        p = to_p10(p, offer)
        funding.record_return(project=p, amount="1000", idempotency_key="ri1", by="caisse")
        p.refresh_from_db()
        funding.distribute(offer=offer, amount="1000", kind=Distribution.Kind.COUPON,
                            idempotency_key="di1", by="dg")
        # 1 000 déjà encaissés > 720 courus : plus rien n'est latent, et surtout pas 720
        # une seconde fois.
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["latentGain"], 0.0)

    def test_projet_en_defaut_valorise_au_taux_de_recouvrement_constate(self):
        inv = make_investor("v-def1")
        p, offer, _ = funded_project("V-DEF1", inv)
        p = to_p10(p, offer)
        p = services.transition_status(project=p, to_status=S.P12, by="dg",
                                        reason="Promoteur insolvable, récolte perdue.")
        funding.record_return(project=p, amount="2000", idempotency_key="rd1", by="caisse")
        # 2 000 recouvrés sur 8 000 décaissés = 25 % → 8 000 × 25 % = 2 000 de valeur retenue.
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["capitalOutstanding"], 2000.0)
        self.assertIn(metrics.VALUATION_PROVISION, val["byMethod"])
        self.assertIn("recouvrement constaté", " ".join(val["methodNotes"]))

    def test_defaut_sans_recouvrement_applique_la_provision_parametree_en_base(self):
        from .models import InvestmentConfig
        InvestmentConfig.objects.create(p12_provision_rate=Decimal("0.6000"))
        inv = make_investor("v-def2")
        p, offer, _ = funded_project("V-DEF2", inv)
        p = to_p10(p, offer)
        services.transition_status(project=p, to_status=S.P12, by="dg", reason="Défaut constaté.")
        # Aucun recouvrement : provision de 60 % → 8 000 × 40 % = 3 200.
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["capitalOutstanding"], 3200.0)

    def test_defaut_provisionne_a_cent_pour_cent_par_defaut(self):
        inv = make_investor("v-def3")
        p, offer, _ = funded_project("V-DEF3", inv)
        p = to_p10(p, offer)
        services.transition_status(project=p, to_status=S.P12, by="dg", reason="Défaut constaté.")
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["capitalOutstanding"], 0.0)

    def test_titre_de_capital_valorise_par_expertise_datee(self):
        inv = make_investor("v-act")
        p, offer, _ = funded_project("V-ACT", inv)
        Offer.objects.filter(pk=offer.pk).update(type_of_title=Offer.TypeOfTitle.ACTION)
        Project.objects.filter(pk=p.pk).update(
            expert_valuation=Decimal("10000"), expert_valuation_date=date.today(),
            expert_valuation_source="Cabinet Mbuji — rapport d'évaluation 2026",
        )
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["capitalOutstanding"], 8000.0)
        self.assertEqual(val["latentGain"], 2000.0)     # 10 000 expertisés − 8 000 au pair
        self.assertEqual(val["totalValue"], 10000.0)
        self.assertIn(metrics.VALUATION_EXPERT, val["byMethod"])

    def test_expertise_perimee_retombe_au_pair_et_le_dit(self):
        inv = make_investor("v-act2")
        p, offer, _ = funded_project("V-ACT2", inv)
        Offer.objects.filter(pk=offer.pk).update(type_of_title=Offer.TypeOfTitle.ACTION)
        Project.objects.filter(pk=p.pk).update(
            expert_valuation=Decimal("10000"),
            expert_valuation_date=date.today() - timedelta(days=400),
            expert_valuation_source="Cabinet Mbuji",
        )
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["totalValue"], 8000.0)
        self.assertIn(metrics.VALUATION_PAR_NO_EXPERT, val["byMethod"])
        self.assertIn("périmée", " ".join(val["methodNotes"]))

    def test_expertise_sans_date_nest_pas_une_expertise(self):
        inv = make_investor("v-act3")
        p, offer, _ = funded_project("V-ACT3", inv)
        Offer.objects.filter(pk=offer.pk).update(type_of_title=Offer.TypeOfTitle.PART_SOCIALE)
        Project.objects.filter(pk=p.pk).update(expert_valuation=Decimal("99000"))
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["totalValue"], 8000.0)
        self.assertIn(metrics.VALUATION_PAR_NO_EXPERT, val["byMethod"])

    def test_nature_de_distribution_inconnue_refusee(self):
        inv = make_investor("v-kind")
        p, offer, _ = funded_project("V-KIND", inv)
        p = to_p10(p, offer)
        funding.record_return(project=p, amount="1000", idempotency_key="rk", by="caisse")
        p.refresh_from_db()
        with self.assertRaises(ValidationFailed):
            funding.distribute(offer=offer, amount="1000", kind="CADEAU",
                                idempotency_key="dk", by="dg")

    def test_valeur_totale_capital_plus_latent(self):
        inv = make_investor("v-tot")
        p, offer, sub = funded_project("V-TOT", inv)
        Subscription.objects.filter(pk=sub.pk).update(settled_at=timezone.now() - timedelta(days=365))
        val = metrics.latent_value(funded_subs(inv))
        self.assertEqual(val["totalValue"], val["capitalOutstanding"] + val["latentGain"])
        self.assertEqual(val["totalValue"], 8720.0)


class ExpertValuationTests(AuthedAPITestCase):
    def setUp(self):
        self.project = make_project("EV-1")

    def test_valorisation_sans_date_refusee(self):
        with self.assertRaises(ValidationFailed):
            services.set_expert_valuation(project=self.project, amount="1000",
                                           valuation_date=None, source="Cabinet", by="u")

    def test_valorisation_sans_source_refusee(self):
        with self.assertRaises(ValidationFailed):
            services.set_expert_valuation(project=self.project, amount="1000",
                                           valuation_date=date.today(), source="", by="u")

    def test_valorisation_future_refusee(self):
        with self.assertRaises(ValidationFailed):
            services.set_expert_valuation(project=self.project, amount="1000",
                                           valuation_date=date.today() + timedelta(days=1),
                                           source="Cabinet", by="u")

    def test_valorisation_enregistree_et_journalisee(self):
        from audit.models import AuditEntry
        services.set_expert_valuation(project=self.project, amount="12500.50",
                                       valuation_date=date.today(), source="Cabinet Mbuji", by="dg")
        self.project.refresh_from_db()
        self.assertEqual(self.project.expert_valuation, Decimal("12500.50"))
        self.assertTrue(AuditEntry.objects.filter(
            action="investments.project.expert_valuation", entity_id="EV-1").exists())

    def test_endpoint_reserve_au_personnel_habilite(self):
        self.login(role="invest", sub="inv-ev")
        res = self.client.post(f"/api/investments/projects/{self.project.code}/expert-valuation",
                                {"amount": "999999", "valuationDate": date.today().isoformat(),
                                 "source": "Moi-même"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_endpoint_expose_les_trois_champs_ensemble(self):
        self.login(role="gest_port", sub="staff-ev")
        res = self.client.post(f"/api/investments/projects/{self.project.code}/expert-valuation",
                                {"amount": "12500", "valuationDate": date.today().isoformat(),
                                 "source": "Cabinet Mbuji"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["expertValuation"], 12500.0)
        self.assertEqual(res.data["expertValuationDate"], date.today().isoformat())
        self.assertEqual(res.data["expertValuationSource"], "Cabinet Mbuji")


class LateAndNextPaymentTests(AuthedAPITestCase):
    def test_retard_constate_sur_les_dates_et_non_sur_un_statut_jamais_pose(self):
        inv = make_investor("l-1")
        p, offer, _ = funded_project("L-1", inv)
        p = to_p10(p, offer, due_in_days=-10)   # échéance dépassée de 10 jours
        subs = funded_subs(inv)
        # Le statut est resté PENDING : aucun producteur ne pose OVERDUE dans ce module.
        self.assertEqual(RepaymentSchedule.objects.get(offer=offer).status,
                          RepaymentSchedule.Status.PENDING)
        retard = metrics._late(subs)
        self.assertEqual(retard["share"], Decimal("1.0000"))
        self.assertEqual(retard["lateProjects"], 1)
        self.assertEqual(retard["totalProjects"], 1)

    def test_echeance_payee_nest_pas_un_retard(self):
        inv = make_investor("l-2")
        p, offer, _ = funded_project("L-2", inv)
        to_p10(p, offer, due_in_days=-10)
        RepaymentSchedule.objects.filter(offer=offer).update(status=RepaymentSchedule.Status.PAID)
        self.assertEqual(metrics.late_share(funded_subs(inv)), Decimal("0"))

    def test_absence_decheancier_est_signalee_et_ne_se_deguise_pas_en_zero_retard(self):
        inv = make_investor("l-3")
        funded_project("L-3", inv)
        retard = metrics._late(funded_subs(inv))
        self.assertEqual(retard["projectsWithSchedule"], 0)
        self.assertIsNotNone(retard["scheduleCoverageWarning"])

    def test_prochain_paiement_est_le_min_des_echeances_a_venir(self):
        inv = make_investor("n-1")
        p, offer, _ = funded_project("N-1", inv)
        to_p10(p, offer, due_in_days=60)
        RepaymentSchedule.objects.create(offer=offer, due_date=date.today() + timedelta(days=15),
                                          amount_due=Decimal("500"))
        RepaymentSchedule.objects.create(offer=offer, due_date=date.today() - timedelta(days=5),
                                          amount_due=Decimal("500"))
        res = metrics._next_payment(funded_subs(inv))
        self.assertEqual(res["nextPaymentDate"], (date.today() + timedelta(days=15)).isoformat())
        self.assertEqual(res["nextPaymentSource"], "repayment_schedule")
        self.assertEqual(res["upcomingCount"], 2)

    def test_prochain_paiement_ignore_les_echeances_deja_payees(self):
        inv = make_investor("n-2")
        p, offer, _ = funded_project("N-2", inv)
        to_p10(p, offer, due_in_days=15)
        RepaymentSchedule.objects.filter(offer=offer).update(status=RepaymentSchedule.Status.PAID)
        RepaymentSchedule.objects.create(offer=offer, due_date=date.today() + timedelta(days=90),
                                          amount_due=Decimal("500"))
        res = metrics._next_payment(funded_subs(inv))
        self.assertEqual(res["nextPaymentDate"], (date.today() + timedelta(days=90)).isoformat())

    def test_sans_echeancier_la_date_est_nulle_avec_son_motif_jamais_inventee(self):
        inv = make_investor("n-3")
        funded_project("N-3", inv)
        res = metrics._next_payment(funded_subs(inv))
        self.assertIsNone(res["nextPaymentDate"])
        self.assertIsNone(res["nextPaymentSource"])
        self.assertIsNotNone(res["unavailableReason"])


class KpiContextTests(AuthedAPITestCase):
    """« Pas de moyenne sans effectif, pas de pourcentage sans base » — vérifié."""

    def setUp(self):
        self.inv = make_investor("k-1")
        self.project, self.offer, _ = funded_project("K-1", self.inv)

    def test_metriques_investisseur_portent_periode_devise_et_effectif(self):
        res = metrics.investor_metrics(self.inv)
        self.assertEqual(res["currency"], "USD")
        self.assertIn("conversionRate", res)
        self.assertFalse(res["mixedCurrency"])
        self.assertEqual(res["period"]["flowsCount"], 1)
        self.assertIsNotNone(res["period"]["from"])
        self.assertEqual(res["positionsCount"], 1)
        self.assertEqual(res["defaultRates"]["totalProjects"], 1)
        self.assertEqual(res["concentration"]["sectorsCount"], 1)
        self.assertEqual(res["concentration"]["locationsCount"], 1)
        self.assertEqual(res["expectedCouponPositions"], 1)
        self.assertEqual(res["expectedCouponBasis"], 8000.0)

    def test_metriques_portefeuille_portent_periode_devise_et_effectif(self):
        res = metrics.portfolio_metrics()
        self.assertEqual(res["currency"], "USD")
        self.assertEqual(res["subscriptionsCount"], 1)
        self.assertEqual(res["period"]["flowsCount"], 1)
        self.assertIn("totalValue", res)
        self.assertIn("nextPayment", res)

    def test_trois_grandeurs_distinctes_investi_valeur_rendement(self):
        res = metrics.investor_metrics(self.inv)
        self.assertEqual(res["totalInvested"], 8000.0)
        self.assertEqual(res["totalValue"], res["valuation"]["totalValue"])
        # Aucune distribution : le rendement réalisé n'existe pas encore et le dit.
        self.assertIsNone(res["realizedReturn"])
        self.assertTrue(res["realizedReturnUnavailableReason"])
        # Le taux contractuel n'est PAS un rendement : grandeur séparée.
        self.assertEqual(res["expectedCouponRate"], 9.0)

    def test_devise_etrangere_est_signalee_jamais_additionnee_en_silence(self):
        p = to_p10(self.project, self.offer)
        funding.record_return(project=p, amount="1000", idempotency_key="rk1", by="caisse")
        p.refresh_from_db()
        funding.distribute(offer=self.offer, amount="1000", idempotency_key="dk1", by="dg")
        Distribution.objects.all().update(currency="CDF")
        res = metrics.portfolio_metrics()
        self.assertTrue(res["mixedCurrency"])
        self.assertIn("CDF", res["currenciesObserved"])
        self.assertIsNotNone(res["mixedCurrencyWarning"])

    def test_exposition_par_secteur_et_par_zone_est_servie(self):
        res = metrics.investor_metrics(self.inv)
        secteurs = res["concentration"]["exposureBySector"]
        self.assertEqual(len(secteurs), 1)
        self.assertEqual(secteurs[0]["key"], "Maïs")
        self.assertEqual(secteurs[0]["amount"], 8000.0)
        self.assertEqual(secteurs[0]["share"], 1.0)
        self.assertEqual(res["concentration"]["exposureByLocation"][0]["key"], "Kongo-Central")

    def test_chaque_taux_declare_son_unite(self):
        res = metrics.investor_metrics(self.inv)
        self.assertEqual(res["units"]["realizedReturn"], "fraction")
        self.assertEqual(res["units"]["expectedCouponRate"], "percent")
        self.assertEqual(res["units"]["health.score"], "points_sur_100")

    def test_detail_par_position_seulement_cote_investisseur(self):
        res = metrics.investor_metrics(self.inv)
        positions = res["valuation"]["positions"]
        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]["projectCode"], "K-1")
        self.assertEqual(positions[0]["settledAmount"], 8000.0)
        self.assertEqual(positions[0]["valuationMethod"], metrics.VALUATION_PAR)
        self.assertIsNone(positions[0]["recoveryRate"])
        # La vue institution ne déverse pas les positions de tous les investisseurs.
        self.assertNotIn("positions", metrics.portfolio_metrics()["valuation"])

    def test_position_en_defaut_porte_sa_perte_estimee(self):
        p = to_p10(self.project, self.offer)
        p = services.transition_status(project=p, to_status=S.P12, by="dg",
                                        reason="Promoteur en cessation d'activité.")
        funding.record_return(project=p, amount="2000", idempotency_key="rkd", by="caisse")
        position = metrics.investor_metrics(self.inv)["valuation"]["positions"][0]
        self.assertEqual(position["projectStatus"], "P12")
        self.assertEqual(position["recoveryRate"], 0.25)
        self.assertEqual(position["capitalOutstanding"], 2000.0)
        self.assertEqual(position["impairment"], 6000.0)   # 8 000 − 2 000 recouvrables
        self.assertIn("défaut", position["valuationNote"])

    def test_offres_ouvertes_portent_les_bornes_de_souscription(self):
        ligne = next(o for o in metrics.open_offers_summary() if o["projectCode"] == "K-1")
        self.assertEqual(ligne["minBonds"], 1)
        self.assertEqual(ligne["maxBonds"], 100)
        self.assertEqual(ligne["typeOfTitle"], "OBLIGATION")
        self.assertIn("riskScore", ligne)

    def test_dashboard_institution_porte_devise_et_effectifs(self):
        self.login(role="gest_port", sub="staff-kpi")
        res = self.client.get("/api/investments/dashboard-metrics")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["currency"], "USD")
        self.assertFalse(res.data["mixedCurrency"])
        self.assertEqual(res.data["totalInvested"], 8000.0)
        self.assertEqual(res.data["settledSubscriptionsCount"], 1)
        self.assertEqual(res.data["reservedSubscriptionsCount"], 0)

    def test_seuil_dalerte_de_defaut_vient_de_la_base(self):
        from .models import InvestmentConfig
        InvestmentConfig.objects.create(default_rate_alert=Decimal("0.0100"))
        p = to_p10(self.project, self.offer)
        services.transition_status(project=p, to_status=S.P12, by="dg", reason="Défaut.")
        res = metrics.portfolio_metrics()
        self.assertEqual(res["defaultRates"]["alertThreshold"], 0.01)
        self.assertTrue(res["defaultRates"]["alert"])


class HealthScoreNumericCaseTests(AuthedAPITestCase):
    """Cas chiffrés du score de santé — exécutés, pas décrits."""

    def test_cas_chiffre_avec_les_coefficients_par_defaut(self):
        # 100 − 4×0,05×100 − 50×(0,26−0,25)×100 − 1×0,20×100 = 100 − 20 − 50 − 20 = 10
        res = metrics.health_score(default_rate=Decimal("0.05"), hhi=Decimal("0.26"),
                                    late=Decimal("0.20"))
        self.assertEqual(res["penalties"]["default"], 20.0)
        self.assertEqual(res["penalties"]["concentration"], 50.0)
        self.assertEqual(res["penalties"]["late"], 20.0)
        self.assertEqual(res["score"], 10.0)
        self.assertFalse(res["clamped"])

    def test_le_meme_cas_recalibre_en_base_donne_un_autre_score(self):
        from .models import InvestmentConfig
        InvestmentConfig.objects.create(health_coeff_concentration=Decimal("5"))
        # 100 − 20 − 5×0,01×100 (=5) − 20 = 55
        res = metrics.health_score(default_rate=Decimal("0.05"), hhi=Decimal("0.26"),
                                    late=Decimal("0.20"))
        self.assertEqual(res["score"], 55.0)
        self.assertEqual(res["parameters"]["b"], 5.0)

    def test_le_score_publie_ses_entrees_pour_etre_refait_a_la_main(self):
        res = metrics.health_score(default_rate=Decimal("0.05"), hhi=Decimal("0.26"),
                                    late=Decimal("0.20"))
        self.assertEqual(res["inputs"]["defaultRate"], 0.05)
        self.assertEqual(res["inputs"]["herfindahl"], 0.26)
        self.assertEqual(res["inputs"]["lateShare"], 0.20)
        self.assertEqual(res["formula"], metrics.HEALTH_FORMULA)

    def test_ecretage_a_zero_est_signale(self):
        res = metrics.health_score(default_rate=Decimal("1"), hhi=Decimal("1"), late=Decimal("1"))
        self.assertEqual(res["score"], 0.0)
        self.assertTrue(res["clamped"])
        self.assertLess(res["rawScore"], 0.0)


class XirrNumericCaseTests(AuthedAPITestCase):
    """Cas chiffré du XIRR — flux datés irréguliers, résultat vérifié à 1e-4."""

    def test_cas_chiffre_flux_irreguliers(self):
        flux = [
            (date(2025, 1, 1), Decimal("-10000")),
            (date(2025, 7, 1), Decimal("2000")),
            (date(2026, 1, 1), Decimal("9500")),
        ]
        taux = metrics.xirr(flux)
        # Racine vérifiée hors module par Newton-Raphson : 0,16610954, VAN nulle à 1e-9.
        # (VAN = −10 000 + 2 000/(1+r)^(181/365) + 9 500/(1+r)^(365/365).)
        self.assertAlmostEqual(float(taux), 0.166110, places=5)
        self.assertEqual(taux, Decimal("0.166110"))

    def test_le_xirr_nest_pas_une_moyenne_ponderee_de_taux_affiches(self):
        """Même capital, même rendement nominal, dates différentes → TRI différents.

        C'est exactement ce que la « moyenne pondérée de taux » du prototype ne pouvait
        pas voir : elle aurait rendu 10 % dans les deux cas.
        """
        tot = metrics.xirr([(date(2025, 1, 1), Decimal("-1000")),
                             (date(2026, 1, 1), Decimal("1100"))])
        tard = metrics.xirr([(date(2025, 1, 1), Decimal("-1000")),
                              (date(2027, 1, 1), Decimal("1100"))])
        self.assertAlmostEqual(float(tot), 0.10, places=3)
        self.assertLess(float(tard), float(tot))

    def test_xirr_sur_les_flux_reels_dun_investisseur(self):
        inv = make_investor("x-1")
        p, offer, sub = funded_project("X-1", inv)
        Subscription.objects.filter(pk=sub.pk).update(settled_at=timezone.now() - timedelta(days=365))
        p = to_p10(p, offer)
        funding.record_return(project=p, amount="8800", idempotency_key="rx1", by="caisse")
        p.refresh_from_db()
        funding.distribute(offer=offer, amount="8800", idempotency_key="dx1", by="dg")
        flux = metrics.investor_flows(inv)
        self.assertEqual(len(flux), 2)
        res = metrics.investor_metrics(inv)
        # −8 000 il y a un an, +8 800 aujourd'hui → 10 % l'an, sur flux réels.
        self.assertAlmostEqual(res["realizedReturn"], 0.10, places=3)
        self.assertIsNone(res["realizedReturnUnavailableReason"])


# ── 9. Asymétrie d'information ───────────────────────────────────────────────

class InformationAsymmetryTests(AuthedAPITestCase):
    def setUp(self):
        self.due_diligence = advance_to(make_project("A-DD"), S.P03)
        self.ouvert = advance_to(make_project("A-OPEN"), S.P06)

    def test_investisseur_ne_voit_pas_les_dossiers_en_due_diligence(self):
        self.login(role="invest", sub="inv-asym")
        res = self.client.get("/api/investments/projects")
        codes = {row["code"] for row in res.data}
        self.assertIn("A-OPEN", codes)
        self.assertNotIn("A-DD", codes)

    def test_investisseur_ne_peut_pas_ouvrir_un_dossier_en_due_diligence(self):
        self.login(role="invest", sub="inv-asym2")
        res = self.client.get(f"/api/investments/projects/{self.due_diligence.code}")
        self.assertEqual(res.status_code, 404)

    def test_personnel_voit_tout_le_pipeline(self):
        self.login(role="gest_port", sub="staff-1")
        res = self.client.get("/api/investments/projects")
        codes = {row["code"] for row in res.data}
        self.assertIn("A-DD", codes)

    def test_pipeline_est_agrege_et_anonymise_pour_un_investisseur(self):
        self.login(role="invest", sub="inv-asym3")
        res = self.client.get("/api/investments/pipeline")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["projects"], [])
        stages = {row["stage"]: row["count"] for row in res.data["stages"]}
        self.assertEqual(stages["P03"], 1)

    def test_investisseur_ne_voit_pas_les_autres_investisseurs(self):
        make_investor("autre-1")
        self.login(role="invest", sub="inv-asym4")
        res = self.client.get("/api/investments/investors")
        self.assertEqual(res.status_code, 403)

    def test_investisseur_ne_voit_pas_les_souscriptions_dautrui(self):
        autre = make_investor("autre-2")
        funding.reserve(investor=autre, offer_id=self.ouvert.offers.first().pk, bonds=1,
                         idempotency_key="autre", by="autre-2")
        self.login(role="invest", sub="inv-asym5")
        res = self.client.get(f"/api/investments/subscriptions?investor={autre.pk}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])

    def test_investisseur_ne_voit_pas_les_mouvements_dautrui(self):
        autre = make_investor("autre-3")
        funding.reserve(investor=autre, offer_id=self.ouvert.offers.first().pk, bonds=1,
                         idempotency_key="autre3", by="autre-3")
        self.login(role="invest", sub="inv-asym6")
        res = self.client.get("/api/investments/movements")
        self.assertEqual(res.data, [])

    def test_metriques_institution_refusees_a_un_investisseur(self):
        self.login(role="invest", sub="inv-asym7")
        self.assertEqual(self.client.get("/api/investments/metrics/portfolio").status_code, 403)
        self.assertEqual(self.client.get("/api/investments/dashboard-metrics").status_code, 403)

    # --- Satellites du dossier : offre, garanties, échéancier, observations,
    # reporting. Tous étaient servis par des vues gardées par la seule capacité
    # `read` — que le rôle `invest` PORTE (rbac/role_registry.py). Connaître un code
    # projet suffisait donc à lire le montage d'un dossier en due diligence.

    def test_investisseur_ne_voit_pas_les_offres_dun_dossier_en_due_diligence(self):
        Offer.objects.create(project=self.due_diligence, code="OFR-DD", funding_goal=Decimal("50000"))
        self.login(role="invest", sub="inv-asym8")
        res = self.client.get("/api/investments/offers")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("OFR-DD", {o["code"] for o in res.data})
        cible = self.client.get(f"/api/investments/offers?project={self.due_diligence.code}")
        self.assertEqual(cible.data, [])

    def test_personnel_voit_les_offres_des_dossiers_en_instruction(self):
        Offer.objects.create(project=self.due_diligence, code="OFR-DD2", funding_goal=Decimal("50000"))
        self.login(role="gest_port", sub="staff-off")
        res = self.client.get("/api/investments/offers")
        self.assertIn("OFR-DD2", {o["code"] for o in res.data})

    def test_investisseur_ne_voit_pas_les_garanties_dun_dossier_en_due_diligence(self):
        offre = Offer.objects.create(project=self.due_diligence, code="OFR-DD3")
        Collateral.objects.create(offer=offre, debt_type="Nantissement", collateral_value="9000")
        self.login(role="invest", sub="inv-asym9")
        res = self.client.get(f"/api/investments/offers/{offre.pk}/collateral")
        self.assertEqual(res.status_code, 404)

    def test_investisseur_ne_voit_pas_les_echeanciers_dun_dossier_en_due_diligence(self):
        offre = Offer.objects.create(project=self.due_diligence, code="OFR-DD4")
        RepaymentSchedule.objects.create(offer=offre, due_date=date.today(), amount_due="1000")
        self.login(role="invest", sub="inv-asym10")
        self.assertEqual(self.client.get("/api/investments/schedules").data, [])

    def test_investisseur_ne_voit_pas_les_observations_dun_dossier_en_due_diligence(self):
        AnalystObservation.objects.create(project=self.due_diligence, risk_flag="HIGH",
                                           observation="Promoteur déjà en défaut ailleurs.")
        self.login(role="invest", sub="inv-asym11")
        res = self.client.get(f"/api/investments/observations?project={self.due_diligence.code}")
        self.assertEqual(res.data, [])

    def test_investisseur_ne_redige_pas_dobservation_danalyste(self):
        self.login(role="invest", sub="inv-asym12")
        res = self.client.post("/api/investments/observations",
                                {"projectCode": self.ouvert.code, "riskFlag": "LOW",
                                 "observation": "Tout va bien."}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertFalse(AnalystObservation.objects.filter(project=self.ouvert).exists())

    def test_investisseur_ne_voit_pas_le_reporting_dun_dossier_en_due_diligence(self):
        services.submit_performance_report(project=self.due_diligence,
                                            data={"actualRevenue": 1, "forecastRevenue": 1}, by="u")
        self.login(role="invest", sub="inv-asym13")
        self.assertEqual(self.client.get("/api/investments/performance-reports").data, [])

    def test_investisseur_ne_depose_pas_de_reporting_promoteur(self):
        self.login(role="invest", sub="inv-asym14")
        res = self.client.post("/api/investments/performance-reports",
                                {"projectCode": self.ouvert.code, "actualRevenue": 10,
                                 "forecastRevenue": 1000}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_investisseur_ne_voit_pas_les_questions_des_autres(self):
        autre = make_investor("autre-q")
        ProjectQuestion.objects.create(project=self.ouvert, investor=autre,
                                        question="Quelle est la garantie réelle ?")
        self.login(role="invest", sub="inv-asym15")
        res = self.client.get("/api/investments/questions?all=1")
        self.assertEqual(res.data, [])
        self.login(role="gest_port", sub="staff-q2")
        self.assertEqual(len(self.client.get("/api/investments/questions?all=1").data), 1)

    def test_les_metriques_dun_investisseur_ne_contiennent_que_son_argent(self):
        a = make_investor("asym-a")
        b = make_investor("asym-b")
        offre = self.ouvert.offers.first()
        Offer.objects.filter(pk=offre.pk).update(min_funding_amount=Decimal("0"))
        for inv, bonds, cle in ((a, 60, "aa"), (b, 20, "bb")):
            sub = funding.reserve(investor=inv, offer_id=offre.pk, bonds=bonds,
                                   idempotency_key=cle, by=cle)
            funding.settle(subscription=sub, idempotency_key=f"s{cle}", by="caisse")
        res = metrics.investor_metrics(a)
        self.assertEqual(res["totalInvested"], 6000.0)
        self.assertEqual(res["positionsCount"], 1)
        self.assertEqual(res["defaultRates"]["totalValue"], 6000.0)
        self.assertEqual(res["concentration"]["basisAmount"], 6000.0)
        self.assertEqual(res["scope"], "Portefeuille de cet investisseur uniquement.")

    def test_investisseur_ne_cree_pas_doffre(self):
        self.login(role="invest", sub="inv-asym16")
        res = self.client.post("/api/investments/offers",
                                {"projectCode": self.ouvert.code, "code": "OFR-PIRATE",
                                 "couponRate": "50", "fundingGoal": "1"}, format="json")
        self.assertEqual(res.status_code, 403)


# ── 10. API ──────────────────────────────────────────────────────────────────

class InvestmentsApiTests(AuthedAPITestCase):
    def test_subscribe_via_api_requires_idempotency_key(self):
        project = advance_to(make_project("API-1"), S.P06)
        self.login(role="invest", sub="inv-api1")
        res = self.client.post("/api/investments/subscriptions",
                                {"offerId": project.offers.first().pk, "bonds": 1}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_create_project_requires_create_capability(self):
        self.login(role="agri_op", sub="client-x")
        res = self.client.post("/api/investments/projects", {"code": "API-2", "title": "X"},
                                format="json")
        self.assertEqual(res.status_code, 403)

    def test_transition_via_api_exige_un_motif(self):
        p = make_project("API-3")
        self.login(role="gest_port", sub="staff-api")
        res = self.client.post(f"/api/investments/projects/{p.code}/action",
                                {"toStatus": "P02"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "TRANSITION_REASON_REQUIRED")

    def test_transition_via_api_avec_motif(self):
        p = make_project("API-4")
        self.login(role="gest_port", sub="staff-api2")
        res = self.client.post(f"/api/investments/projects/{p.code}/action",
                                {"toStatus": "P02", "reason": "Dossier complet."}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "P02")

    def test_cloture_et_decaissement_ont_leur_propre_endpoint(self):
        p = make_project("API-5")
        self.login(role="gest_port", sub="staff-api3")
        res = self.client.post(f"/api/investments/projects/{p.code}/action",
                                {"toStatus": "P08", "reason": "Décaissement."}, format="json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "USE_DEDICATED_ENDPOINT")

    def test_historique_des_transitions_expose_les_suites_possibles(self):
        p = advance_to(make_project("API-6"), S.P03)
        self.login(role="gest_port", sub="staff-api4")
        res = self.client.get(f"/api/investments/projects/{p.code}/transitions")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["currentStatus"], "P03")
        self.assertEqual(sorted(res.data["allowedTargets"]), ["P04", "P13"])
        self.assertEqual(res.data["totalRows"], 2)

    def test_vote_de_comite_via_api(self):
        p = advance_to(make_project("API-7"), S.P04)
        self.login(role="gest_port", sub="cm-api")
        res = self.client.post(f"/api/investments/projects/{p.code}/committee-votes",
                                {"decision": "approve", "comment": "Favorable.",
                                 "conditions": "Assurance."}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["tally"]["approve"], 1)

    def test_vote_de_comite_sans_motif_renvoie_le_code_du_module_credit(self):
        p = advance_to(make_project("API-8"), S.P04)
        self.login(role="gest_port", sub="cm-api2")
        res = self.client.post(f"/api/investments/projects/{p.code}/committee-votes",
                                {"decision": "approve"}, format="json")
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.data["code"], "COMMITTEE_DECISION_INVALID")

    def test_file_des_evenements_comptables_reservee_a_laudit(self):
        self.login(role="invest", sub="inv-api9")
        self.assertEqual(self.client.get("/api/investments/accounting-events").status_code, 403)
        self.login(role="aud_fin", sub="aud-1")
        res = self.client.get("/api/investments/accounting-events")
        self.assertEqual(res.status_code, 200)
        self.assertIn("totalRows", res.data)


# ── 11. Reste du module (non-régression) ─────────────────────────────────────

class PerformanceReportTests(AuthedAPITestCase):
    def test_large_deviation_flags_observation(self):
        project = make_project("PR-1")
        services.submit_performance_report(
            project=project, data={"actualRevenue": 500, "forecastRevenue": 1000}, by="u")
        self.assertTrue(AnalystObservation.objects.filter(project=project, risk_flag="HIGH").exists())

    def test_small_deviation_does_not_flag(self):
        project = make_project("PR-2")
        services.submit_performance_report(
            project=project, data={"actualRevenue": 980, "forecastRevenue": 1000}, by="u")
        self.assertFalse(AnalystObservation.objects.filter(project=project).exists())


class InvestorActionTests(AuthedAPITestCase):
    def setUp(self):
        self.investor = make_investor("inv-action-1")

    def test_suspend_then_activate(self):
        self.investor = services.investor_action(investor=self.investor, action="suspend", by="u")
        self.assertEqual(self.investor.status, "SUSPENDED")
        self.investor = services.investor_action(investor=self.investor, action="activate", by="u")
        self.assertEqual(self.investor.status, "ACTIVE")

    def test_unknown_action_rejected(self):
        with self.assertRaises(ValidationFailed):
            services.investor_action(investor=self.investor, action="delete", by="u")

    def test_action_via_api_requires_validate_capability(self):
        self.login(role="gest_port", sub="mgr-1")
        res = self.client.post(f"/api/investments/investors/{self.investor.pk}/action",
                                {"action": "suspend"}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_action_via_api_forbidden_without_capability(self):
        self.login(role="agri_op", sub="client-y")
        res = self.client.post(f"/api/investments/investors/{self.investor.pk}/action",
                                {"action": "suspend"}, format="json")
        self.assertEqual(res.status_code, 403)


class ProjectAnalysisApiTests(AuthedAPITestCase):
    def setUp(self):
        self.project = advance_to(make_project("PA-1"), S.P06)
        self.offer = self.project.offers.first()
        self.login(role="invest", sub="inv-pa")

    def test_technical_analysis_returned_when_present(self):
        TechnicalAnalysis.objects.filter(project=self.project).update(land_size=12.5)
        res = self.client.get(f"/api/investments/projects/{self.project.code}/technical-analysis")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["landSize"], 12.5)

    def test_financial_analysis_returned_when_present(self):
        FinancialAnalysis.objects.filter(project=self.project).update(irr=14.2)
        res = self.client.get(f"/api/investments/projects/{self.project.code}/financial-analysis")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["irr"], 14.2)

    def test_collateral_returned_when_present(self):
        Collateral.objects.create(offer=self.offer, debt_type="Obligation garantie",
                                   collateral_value="5000", loan_to_value="0.6")
        res = self.client.get(f"/api/investments/offers/{self.offer.pk}/collateral")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["debtType"], "Obligation garantie")

    def test_collateral_404_when_absent(self):
        res = self.client.get(f"/api/investments/offers/{self.offer.pk}/collateral")
        self.assertEqual(res.status_code, 404)


class QuestionsAndReportsApiTests(AuthedAPITestCase):
    def test_questions_filtered_by_project(self):
        project_a = advance_to(make_project("Q-A"), S.P06)
        project_b = advance_to(make_project("Q-B"), S.P06)
        investor = make_investor("inv-q")
        ProjectQuestion.objects.create(project=project_a, investor=investor, question="Q sur A")
        ProjectQuestion.objects.create(project=project_b, investor=investor, question="Q sur B")
        self.login(role="invest", sub="inv-q")
        res = self.client.get(f"/api/investments/questions?project={project_a.code}")
        self.assertEqual(len(res.data), 1)

    def test_performance_report_row_includes_full_detail(self):
        project = make_project("Q-C")
        services.submit_performance_report(
            project=project,
            data={"actualRevenue": 900, "forecastRevenue": 1000, "reportingPeriod": "T1-2026"},
            by="u")
        self.login(role="gest_port", sub="staff-q")
        res = self.client.get(f"/api/investments/performance-reports?project={project.code}")
        self.assertEqual(res.data[0]["reportingPeriod"], "T1-2026")
        self.assertIn("validationDate", res.data[0])


class ObligationApiTests(AuthedAPITestCase):
    def setUp(self):
        self.investor = make_investor("inv-ob")
        self.login(role="invest", sub="inv-ob")

    def test_subscribe_then_list(self):
        res = self.client.post("/api/investments/obligations",
                                {"name": "Plan A", "investedAmount": "1000"}, format="json")
        self.assertEqual(res.status_code, 201)
        listed = self.client.get("/api/investments/obligations")
        self.assertEqual(listed.data[0]["investedAmount"], 1000.0)

    def test_withdrawals_and_conversions_listed(self):
        position = ObligationPosition.objects.create(investor=self.investor, invested_amount="1000")
        BondWithdrawal.objects.create(position=position, amount="200", reason="Test")
        BondConversion.objects.create(position=position, coupons=4, value="1188", shares=11)
        self.assertEqual(len(self.client.get(
            f"/api/investments/obligations/{position.pk}/withdrawals").data), 1)
        self.assertEqual(self.client.get(
            f"/api/investments/obligations/{position.pk}/conversions").data[0]["shares"], 11)

    def test_cannot_list_other_investors_withdrawals(self):
        other = make_investor("inv-ob2")
        position = ObligationPosition.objects.create(investor=other, invested_amount="500")
        res = self.client.get(f"/api/investments/obligations/{position.pk}/withdrawals")
        self.assertEqual(res.status_code, 404)


class ProjectCreationTests(AuthedAPITestCase):
    def test_duplicate_code_rejected(self):
        services.create_project(code="DUP", title="A", funding_target="1", by="u")
        with self.assertRaises(ValidationFailed):
            services.create_project(code="DUP", title="B", funding_target="1", by="u")

    def test_offre_avec_plancher_superieur_a_lobjectif_refusee(self):
        p = make_project("OFF-1")
        with self.assertRaises(ValidationFailed):
            services.create_offer(project=p, code="OFR-BAD", coupon_rate="9", maturity_months=24,
                                   min_ticket="0", available_bonds=10, funding_goal="1000",
                                   min_funding_amount="2000", by="u")

    def test_politique_de_sursouscription_inconnue_refusee(self):
        p = make_project("OFF-2")
        with self.assertRaises(ValidationFailed):
            services.create_offer(project=p, code="OFR-BAD2", coupon_rate="9", maturity_months=24,
                                   min_ticket="0", available_bonds=10, funding_goal="1000",
                                   oversubscription_policy="LOTERIE", by="u")

"""
Tests d'isolation des données et de contrôle d'accès — Étape 7.

Couverture :
  - Isolation client : Client A ne peut pas voir le dossier de Client B
  - Isolation agent  : un agent voit tous les dossiers
  - Maker ≠ checker  : soumetteur ≠ approbateur, demandeur ≠ confirmateur
  - Rôles sur le tableau de bord
  - Consentement on_behalf_of : flux complet + expiration
  - Actions disponibles par statut × rôle
"""
from __future__ import annotations

import datetime
from decimal import Decimal
from unittest.mock import patch, MagicMock

from django.test import TestCase
from django.utils import timezone

from credits.models import (
    CreditApplication,
    ScoringCriterion,
    CreditGuarantee,
    DisbursementRequest,
    ModuleAllocation,
)
from credits.view_context import ViewContextService
from credits.workflow import (
    submit, start_analysis, approve, reject, WorkflowError,
    MakerCheckerError, DelegationError, ConsentError,
)
from credits.disbursement import (
    request_disbursement, confirm_disbursement, DisbursementError,
)


# ── Fixtures communes ─────────────────────────────────────────────────────────

def _make_user(sub: str, name: str = ""):
    """Crée (ou récupère) un FintechUser minimal."""
    from accounts.models import FintechUser
    user, _ = FintechUser.objects.get_or_create(
        sub=sub,
        defaults={
            "full_name": name or sub,
            "phone": f"+243{sub[-9:].zfill(9)}",
        },
    )
    return user


def _make_app(
    client_sub: str,
    initiated_by_sub: str | None = None,
    status: str = "draft",
    amount: Decimal = Decimal("5000"),
    currency: str = "USD",
) -> CreditApplication:
    client = _make_user(client_sub)
    return CreditApplication.objects.create(
        client=client,
        initiated_by_sub=initiated_by_sub or client_sub,
        status=status,
        amount_requested=amount,
        currency=currency,
        code=f"CRED-TEST-{CreditApplication.objects.count():04d}",
    )


def _ensure_scoring_criteria():
    """Crée les critères de scoring minimaux si absents."""
    defaults = [
        ("repayment_history", 30, 1.5, "repayment_history"),
        ("needs_coherence", 25, 1.2, "needs_coherence"),
        ("debt_ratio", 20, 1.0, "debt_ratio"),
        ("kyc_seniority", 15, 0.8, "kyc_seniority"),
        ("sector_risk", 10, 1.0, "sector_risk"),
    ]
    for code, pts, weight, method in defaults:
        ScoringCriterion.objects.get_or_create(
            code=code,
            defaults={
                "label": code,
                "max_points": pts,
                "weight": weight,
                "compute_method": method,
                "active": True,
            },
        )


# ── 1. Isolation Client A / Client B ─────────────────────────────────────────

class ClientIsolationTest(TestCase):
    """Client A ne peut pas voir le dossier de Client B."""

    def setUp(self):
        self.app_a = _make_app("sub-alice", "sub-alice")
        self.app_b = _make_app("sub-bob", "sub-bob")

    def test_filter_qs_client_sees_only_own(self):
        vcs = ViewContextService(sub="sub-alice", roles=["client"])
        qs = CreditApplication.objects.all()
        filtered = vcs.filter_qs(qs)
        codes = set(filtered.values_list("code", flat=True))
        self.assertIn(self.app_a.code, codes)
        self.assertNotIn(self.app_b.code, codes)

    def test_can_read_own_app(self):
        vcs = ViewContextService(sub="sub-alice", roles=["client"])
        self.assertTrue(vcs.can_read_app(self.app_a))

    def test_cannot_read_other_app(self):
        vcs = ViewContextService(sub="sub-alice", roles=["client"])
        self.assertFalse(vcs.can_read_app(self.app_b))

    def test_agent_sees_all(self):
        vcs = ViewContextService(sub="sub-agent", roles=["gest_credit"])
        qs = CreditApplication.objects.all()
        filtered = vcs.filter_qs(qs)
        codes = set(filtered.values_list("code", flat=True))
        self.assertIn(self.app_a.code, codes)
        self.assertIn(self.app_b.code, codes)

    def test_admin_sees_all(self):
        vcs = ViewContextService(sub="sub-admin", roles=["admin"])
        qs = CreditApplication.objects.all()
        self.assertEqual(vcs.filter_qs(qs).count(), CreditApplication.objects.count())


# ── 2. Sérialisation par rôle ─────────────────────────────────────────────────

class SerializeForRoleTest(TestCase):
    """Les champs internes sont masqués pour le client."""

    def setUp(self):
        self.app = _make_app("sub-carol", "sub-carol", status="in_analysis")
        self.app.submitted_by_sub = "sub-carol"
        self.app.reviewed_by_sub = "sub-agent-01"
        self.app.score_result = {
            "score": 72,
            "eligible": True,
            "valuationNote": "Dossier solide",
            "breakdown": [{"criterion": "debt_ratio", "points": 18}],
            "proposedRate": 15.0,
        }
        self.app.save()

    def test_client_hides_internal_fields(self):
        vcs = ViewContextService(sub="sub-carol", roles=["client"])
        data = vcs.serialize_for_role(self.app)
        self.assertNotIn("submittedBySub", data)
        self.assertNotIn("reviewedBySub", data)
        self.assertNotIn("prefillSnapshot", data)
        # scoreResult masqué pour le client (dans _CLIENT_HIDDEN_FIELDS)
        self.assertNotIn("scoreResult", data)

    def test_agent_sees_all_fields(self):
        vcs = ViewContextService(sub="sub-agent-01", roles=["gest_credit"])
        data = vcs.serialize_for_role(self.app)
        # Les agents voient le score détaillé
        self.assertIn("scoreResult", data)
        sr = data["scoreResult"]
        self.assertIn("breakdown", sr)

    def test_available_actions_included(self):
        vcs = ViewContextService(sub="sub-agent-01", roles=["gest_credit"])
        data = vcs.serialize_for_role(self.app)
        self.assertIn("availableActions", data)
        self.assertIsInstance(data["availableActions"], list)


# ── 3. Maker ≠ Checker — soumission / approbation ────────────────────────────

class MakerCheckerApprovalTest(TestCase):
    """L'agent qui a soumis (en fait le client, mais via sub) ne peut pas approuver."""

    def setUp(self):
        _ensure_scoring_criteria()
        self.app = _make_app("sub-david", "sub-agent-02", status="in_analysis")
        self.app.submitted_by_sub = "sub-agent-02"
        self.app.save()

    def test_submitter_cannot_approve(self):
        vcs = ViewContextService(sub="sub-agent-02", roles=["gest_credit"])
        actions = vcs.available_actions(self.app)
        self.assertNotIn("approve", actions)

    def test_different_agent_can_approve(self):
        vcs = ViewContextService(sub="sub-agent-03", roles=["gest_credit"])
        actions = vcs.available_actions(self.app)
        self.assertIn("approve", actions)

    def test_workflow_approve_raises_on_same_sub(self):
        self.app.amount_requested = Decimal("3000")
        self.app.save()
        with self.assertRaises(MakerCheckerError):
            approve(
                self.app,
                approver_sub="sub-agent-02",
                amount_approved=Decimal("3000"),
                comment="",
                approver_roles=["gest_credit"],
            )


# ── 4. Maker ≠ Checker — décaissement ────────────────────────────────────────

class MakerCheckerDisbursementTest(TestCase):
    """Le demandeur de décaissement ≠ confirmateur."""

    def setUp(self):
        self.app = _make_app("sub-eve", "sub-agent-04", status="approved")
        self.app.amount_approved = Decimal("4000")
        self.app.submitted_by_sub = "sub-agent-05"
        self.app.save()

    def test_request_disbursement_creates_pending(self):
        dr = request_disbursement(self.app, requester_sub="sub-agent-04")
        self.assertEqual(dr.status, DisbursementRequest.Status.PENDING)
        self.app.refresh_from_db()
        self.assertEqual(self.app.status, "pending_disbursement")

    def test_same_sub_cannot_confirm(self):
        request_disbursement(self.app, requester_sub="sub-agent-04")
        with self.assertRaises(DisbursementError):
            confirm_disbursement(self.app, confirmer_sub="sub-agent-04")

    def test_view_context_hides_confirm_for_requester(self):
        request_disbursement(self.app, requester_sub="sub-agent-04")
        self.app.refresh_from_db()
        vcs = ViewContextService(sub="sub-agent-04", roles=["gest_credit"])
        actions = vcs.available_actions(self.app)
        self.assertNotIn("confirm_disbursement", actions)

    def test_different_sub_can_confirm_action(self):
        """Un rôle porteur de la capacité `disburse` confirme le décaissement."""
        request_disbursement(self.app, requester_sub="sub-agent-04")
        self.app.refresh_from_db()
        vcs = ViewContextService(sub="sub-caisse-01", roles=["gest_caisse"])
        actions = vcs.available_actions(self.app)
        self.assertIn("confirm_disbursement", actions)

    def test_credit_officer_cannot_confirm_disbursement(self):
        """Séparation des tâches : instruire un dossier ≠ libérer les fonds.

        `gest_credit` porte `validate` mais pas `disburse` dans le registre RBAC :
        il demande le décaissement, il ne le confirme jamais.
        """
        request_disbursement(self.app, requester_sub="sub-agent-04")
        self.app.refresh_from_db()
        vcs = ViewContextService(sub="sub-agent-06", roles=["gest_credit"])
        actions = vcs.available_actions(self.app)
        self.assertNotIn("confirm_disbursement", actions)


# ── 5. Délégation de montant ──────────────────────────────────────────────────

class DelegationLimitTest(TestCase):
    """Un agent ne peut pas approuver au-delà de sa délégation."""

    def setUp(self):
        _ensure_scoring_criteria()
        self.app = _make_app("sub-frank", "sub-frank", status="in_analysis")
        self.app.submitted_by_sub = "sub-frank"
        self.app.amount_requested = Decimal("30000")  # > 25 000 USD (plafond gest_zone/gest_credit)
        self.app.save()

    def test_agent_cannot_approve_above_delegation(self):
        with self.assertRaises(DelegationError):
            approve(
                self.app,
                approver_sub="sub-agent-07",
                amount_approved=Decimal("30000"),
                comment="",
                approver_roles=["gest_credit"],
            )

    def test_direction_can_approve_any_amount(self):
        # dg a une délégation illimitée (None)
        # On passe juste le guard de délégation — on attend WorkflowError ou succès
        # (le scoring n'est pas obligatoire ici, on teste seulement la délégation)
        try:
            approve(
                self.app,
                approver_sub="sub-committee-01",
                amount_approved=Decimal("30000"),
                comment="",
                approver_roles=["dg"],
            )
        except DelegationError:
            self.fail("dg ne devrait pas être bloqué par la délégation")
        except Exception:
            pass  # Autre exception (ex. MakerCheckerError) acceptée — la délégation a passé


# ── 6. Consentement on_behalf_of ──────────────────────────────────────────────

class OnBehalfOfConsentTest(TestCase):
    """Dossier initié par un agent pour un client : consentement requis."""

    def setUp(self):
        self.client_user = _make_user("sub-grace", "Grace")
        # status=submitted : pending_client_consent l'exige
        self.app = _make_app("sub-grace", "sub-agent-08", status="submitted")
        self.app.submitted_by_sub = "sub-agent-08"
        self.app.client_consent_expires = timezone.now() + datetime.timedelta(hours=72)
        self.app.save()

    def test_is_on_behalf_of(self):
        self.assertTrue(self.app.is_on_behalf_of)

    def test_pending_client_consent_when_no_consent_recorded(self):
        self.assertTrue(self.app.pending_client_consent)

    def test_client_can_consent_action(self):
        vcs = ViewContextService(sub="sub-grace", roles=["client"])
        actions = vcs.available_actions(self.app)
        self.assertIn("client_consent", actions)

    def test_agent_cannot_record_client_consent(self):
        vcs = ViewContextService(sub="sub-agent-08", roles=["gest_credit"])
        actions = vcs.available_actions(self.app)
        self.assertNotIn("client_consent", actions)

    def test_consent_not_needed_after_recorded(self):
        self.app.client_consent_at = timezone.now()
        self.app.save()
        self.assertFalse(self.app.pending_client_consent)
        vcs = ViewContextService(sub="sub-grace", roles=["client"])
        actions = vcs.available_actions(self.app)
        self.assertNotIn("client_consent", actions)

    def test_expired_consent_not_pending(self):
        self.app.client_consent_expires = timezone.now() - datetime.timedelta(seconds=1)
        self.app.save()
        self.assertFalse(self.app.pending_client_consent)


# ── 7. Actions disponibles par statut ────────────────────────────────────────

class AvailableActionsTest(TestCase):
    """Vérifie que les actions disponibles correspondent au statut du dossier."""

    def setUp(self):
        self.app = _make_app("sub-henry", "sub-henry")

    def _app_at(self, status: str) -> CreditApplication:
        self.app.status = status
        self.app.submitted_by_sub = "sub-henry"
        self.app.save()
        return self.app

    def test_draft_client_can_submit(self):
        app = self._app_at("draft")
        vcs = ViewContextService(sub="sub-henry", roles=["client"])
        self.assertIn("submit", vcs.available_actions(app))

    def test_draft_no_approve_action(self):
        app = self._app_at("draft")
        vcs = ViewContextService(sub="sub-agent-09", roles=["gest_credit"])
        self.assertNotIn("approve", vcs.available_actions(app))

    def test_submitted_agent_can_start_analysis(self):
        app = self._app_at("submitted")
        vcs = ViewContextService(sub="sub-agent-09", roles=["gest_credit"])
        self.assertIn("start_analysis", vcs.available_actions(app))

    def test_client_cannot_start_analysis(self):
        app = self._app_at("submitted")
        vcs = ViewContextService(sub="sub-henry", roles=["client"])
        self.assertNotIn("start_analysis", vcs.available_actions(app))

    def test_in_analysis_agent_can_approve_reject(self):
        app = self._app_at("in_analysis")
        vcs = ViewContextService(sub="sub-agent-10", roles=["gest_credit"])
        actions = vcs.available_actions(app)
        self.assertIn("approve", actions)
        self.assertIn("reject", actions)
        self.assertIn("adjourn", actions)

    def test_active_no_workflow_actions(self):
        app = self._app_at("active")
        vcs = ViewContextService(sub="sub-agent-10", roles=["gest_credit"])
        actions = vcs.available_actions(app)
        # Aucune action de workflow disponible sur un dossier ACTIVE
        workflow_actions = {"submit", "start_analysis", "approve", "reject",
                            "adjourn", "reopen_analysis", "request_disbursement",
                            "confirm_disbursement", "cancel_disbursement"}
        self.assertTrue(set(actions).isdisjoint(workflow_actions))

    def test_adjourned_can_reopen(self):
        app = self._app_at("adjourned")
        vcs = ViewContextService(sub="sub-agent-10", roles=["gest_credit"])
        self.assertIn("reopen_analysis", vcs.available_actions(app))


# ── 8. Dashboard par rôle ─────────────────────────────────────────────────────

class DashboardTest(TestCase):
    """Vérifie que get_dashboard retourne la bonne clé 'role'."""

    def setUp(self):
        # Quelques dossiers pour avoir des stats non nulles
        _make_app("sub-ida", "sub-ida", status="active", amount=Decimal("2000"))
        _make_app("sub-jack", "sub-jack", status="in_analysis", amount=Decimal("8000"))

    def test_client_dashboard(self):
        from credits.dashboard import get_dashboard
        result = get_dashboard(sub="sub-ida", roles={"client"})
        self.assertEqual(result["role"], "client")
        self.assertIn("summary", result)
        self.assertIn("recentApplications", result)

    def test_agent_dashboard(self):
        from credits.dashboard import get_dashboard
        result = get_dashboard(sub="sub-agent-11", roles={"gest_credit"})
        self.assertEqual(result["role"], "agent")
        self.assertIn("monthlyDisbursements", result)

    def test_admin_dashboard(self):
        from credits.dashboard import get_dashboard
        result = get_dashboard(sub="sub-admin", roles={"admin"})
        self.assertEqual(result["role"], "admin")
        self.assertIn("counts", result)
        self.assertIn("alerts", result)
        self.assertIn("financials", result)

    def test_committee_dashboard(self):
        from credits.dashboard import get_dashboard
        result = get_dashboard(sub="sub-committee", roles={"dg"}, view="committee")
        self.assertEqual(result["role"], "credit_committee")
        self.assertIn("pendingApplications", result)

    def test_regional_dashboard(self):
        from credits.dashboard import get_dashboard
        result = get_dashboard(sub="sub-regional", roles={"dir_ops"})
        self.assertEqual(result["role"], "regional_director")
        self.assertIn("activeByValueChain", result)


# ── 9. Garanties — isolation ──────────────────────────────────────────────────

class GuaranteeIsolationTest(TestCase):
    """Les garanties d'un dossier ne sont accessibles qu'aux ayants droit."""

    def test_client_can_see_own_guarantee_summary(self):
        app = _make_app("sub-karen", "sub-karen", status="draft")
        vcs = ViewContextService(sub="sub-karen", roles=["client"])
        self.assertTrue(vcs.can_read_app(app))

    def test_client_cannot_read_other_guarantee(self):
        _make_app("sub-leo", "sub-leo", status="draft")
        app_other = _make_app("sub-mike", "sub-mike", status="draft")
        vcs = ViewContextService(sub="sub-leo", roles=["client"])
        self.assertFalse(vcs.can_read_app(app_other))


# ── 9. Nomenclature des rôles & autorité de délégation ────────────────────────

class DelegationAuthorityTest(TestCase):
    """L'autorité d'approbation = capacité `validate` ET présence dans la table.

    Régression protégée : avant juillet 2026, `_max_delegation_usd([])` renvoyait
    0 pour une liste vide, donc TOUTE approbation d'un montant > 0 échouait en
    `delegation_exceeded`. Et les rôles comparés (« agent », « analyst ») étaient
    fictifs — aucun ne pouvait correspondre à `accounts.FintechUser.role`.
    """

    def test_roles_sans_autorite_sont_refuses(self):
        """Y compris les agents de terrain : ils instruisent, ils n'approuvent pas."""
        from credits.roles import NoDelegationAuthority, delegation_limit
        for role in ("risk_analyst", "compliance", "admin_it", "aud_fin",
                     "support", "client", "agri_op", "gest_agents",
                     "agent_terrain", "agent_cash"):
            with self.subTest(role=role):
                with self.assertRaises(NoDelegationAuthority):
                    delegation_limit([role])

    def test_liste_vide_leve_plutot_que_retourner_zero(self):
        from credits.roles import NoDelegationAuthority, delegation_limit
        with self.assertRaises(NoDelegationAuthority):
            delegation_limit([])

    def test_plafonds_par_role(self):
        from credits.roles import delegation_limit
        self.assertEqual(delegation_limit(["gest_credit"]), 25_000)
        self.assertEqual(delegation_limit(["gest_zone"]), 25_000)
        self.assertEqual(delegation_limit(["dir_ops"]), 100_000)
        self.assertIsNone(delegation_limit(["dg"]))
        self.assertIsNone(delegation_limit(["admin"]))

    def test_le_plafond_le_plus_eleve_gagne(self):
        from credits.roles import delegation_limit
        self.assertEqual(delegation_limit(["gest_credit", "gest_zone"]), 25_000)
        self.assertIsNone(delegation_limit(["gest_credit", "dg"]))

    def test_agent_terrain_ne_peut_jamais_approuver(self):
        _ensure_scoring_criteria()
        app = _make_app("sub-n1", "sub-n1", status="in_analysis")
        app.submitted_by_sub = "sub-n1"
        app.amount_requested = Decimal("1000")
        app.save()
        with self.assertRaises(DelegationError):
            approve(app, approver_sub="sub-terrain-01",
                    amount_approved=Decimal("1000"), comment="",
                    approver_roles=["agent_terrain"])

    def test_gestionnaire_bloque_au_dela_de_son_plafond(self):
        _ensure_scoring_criteria()
        app = _make_app("sub-n2", "sub-n2", status="in_analysis")
        app.submitted_by_sub = "sub-n2"
        app.amount_requested = Decimal("30000")
        app.save()
        with self.assertRaises(DelegationError):
            approve(app, approver_sub="sub-gest-01",
                    amount_approved=Decimal("30000"), comment="",
                    approver_roles=["gest_credit"])


class DelegationHidesActionTest(TestCase):
    """Le bouton Approuver ne s'affiche pas au-dessus du plafond du rôle."""

    def setUp(self):
        _ensure_scoring_criteria()
        self.app = _make_app("sub-o1", "sub-agent-o", status="in_analysis")
        self.app.submitted_by_sub = "sub-agent-o"
        self.app.amount_requested = Decimal("30000")
        self.app.save()

    def test_role_sous_plafond_ne_voit_pas_approve(self):
        vcs = ViewContextService(sub="sub-autre", roles=["gest_credit"])
        self.assertNotIn("approve", vcs.available_actions(self.app))

    def test_direction_voit_approve(self):
        vcs = ViewContextService(sub="sub-autre", roles=["dir_ops"])
        self.assertIn("approve", vcs.available_actions(self.app))

    def test_role_sans_autorite_ne_voit_pas_approve(self):
        vcs = ViewContextService(sub="sub-autre", roles=["risk_analyst"])
        self.assertNotIn("approve", vcs.available_actions(self.app))


class RoleNomenclatureTest(TestCase):
    """Tous les rôles cités par le module crédit existent dans le registre RBAC."""

    def test_tous_les_roles_credit_existent_dans_le_registre(self):
        from rbac.role_registry import ROLE_REGISTRY
        from credits import roles as credit_roles

        groupes = [
            "CLIENT_ROLES", "FIELD_AGENT_ROLES", "CREDIT_OFFICER_ROLES",
            "BRANCH_ROLES", "CASHIER_ROLES", "DIRECTION_ROLES", "COMMITTEE_ROLES",
            "AUDIT_ROLES", "CONFIG_ROLES", "SUPERADMIN_ROLES",
        ]
        for nom in groupes:
            for role_id in getattr(credit_roles, nom):
                with self.subTest(groupe=nom, role=role_id):
                    self.assertIn(role_id, ROLE_REGISTRY)

    def test_table_de_delegation_sur_roles_reels(self):
        from django.conf import settings
        from rbac.role_registry import ROLE_REGISTRY
        for role_id in settings.CREDIT_DELEGATION_USD:
            with self.subTest(role=role_id):
                self.assertIn(role_id, ROLE_REGISTRY)

    def test_approbateurs_portent_la_capacite_validate(self):
        """Toute autorité de délégation doit s'accompagner de `validate`."""
        from django.conf import settings
        from rbac.role_registry import ROLE_REGISTRY
        for role_id in settings.CREDIT_DELEGATION_USD:
            with self.subTest(role=role_id):
                self.assertTrue(ROLE_REGISTRY[role_id].validate,
                                f"{role_id} approuve sans capacité validate")

    def test_confirmateurs_portent_la_capacite_disburse(self):
        """Séparation des tâches : confirmer un décaissement exige `disburse`."""
        from rbac.role_registry import ROLE_REGISTRY
        from credits.roles import CAN_CONFIRM_DISBURSEMENT
        for role_id in CAN_CONFIRM_DISBURSEMENT:
            with self.subTest(role=role_id):
                self.assertTrue(ROLE_REGISTRY[role_id].disburse,
                                f"{role_id} confirme un décaissement sans capacité disburse")

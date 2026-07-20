from __future__ import annotations

from datetime import timedelta
from unittest.mock import Mock, patch

from django.test import override_settings
from django.utils import timezone

from common.testing import AuthedAPITestCase

from .models import Conversation, Ticket

_SMS_CONFIGURED = {"API_URL": "https://example.test/SendSMS", "API_ID": "API1", "API_PASSWORD": "pwd",
                   "SENDER_ID": "TEST"}


class SupportTests(AuthedAPITestCase):
    def test_create_and_list_own_ticket(self):
        self.login(role="client", sub="t1")
        res = self.client.post("/api/support/tickets",
                                {"subject": "Problème mobile money", "category": "mobile-money"}, format="json")
        self.assertEqual(res.status_code, 201)
        listed = self.client.get("/api/support/tickets")
        self.assertEqual(len(listed.data), 1)

    def test_conversation_message_roundtrip(self):
        self.login(role="invest", sub="inv-1")
        conv = Conversation.objects.create(investor_sub="inv-1", manager_sub="mgr-1")
        send = self.client.post(f"/api/support/conversations/{conv.pk}/messages/send", {"text": "Bonjour"},
                                 format="json")
        self.assertEqual(send.status_code, 201)
        msgs = self.client.get(f"/api/support/conversations/{conv.pk}/messages")
        self.assertEqual(len(msgs.data), 1)

    def test_start_conversation_is_idempotent_get_or_create(self):
        self.login(role="invest", sub="inv-2")
        first = self.client.post("/api/support/conversations", {"managerSub": "mgr-2"}, format="json")
        self.assertEqual(first.status_code, 200)
        second = self.client.post("/api/support/conversations", {"managerSub": "mgr-2"}, format="json")
        self.assertEqual(second.data["id"], first.data["id"])
        self.assertEqual(Conversation.objects.filter(investor_sub="inv-2", manager_sub="mgr-2").count(), 1)

    def test_ticket_message_thread_client_and_staff(self):
        self.login(role="client", sub="c1")
        created = self.client.post("/api/support/tickets",
                                    {"subject": "Dépôt manquant", "category": "mobile-money"}, format="json")
        ticket_id = created.data["id"]
        self.client.post(f"/api/support/tickets/{ticket_id}/messages", {"text": "Bonjour, mon dépôt est absent."},
                          format="json")

        self.login(role="gest_agents", sub="agent-1")
        internal = self.client.post(f"/api/support/tickets/{ticket_id}/messages",
                                     {"text": "Vérification en cours (note interne).", "isInternal": True},
                                     format="json")
        self.assertEqual(internal.status_code, 201)
        self.assertTrue(internal.data["isInternal"])

        staff_view = self.client.get(f"/api/support/tickets/{ticket_id}/messages")
        self.assertEqual(len(staff_view.data), 2)

        self.login(role="client", sub="c1")
        client_view = self.client.get(f"/api/support/tickets/{ticket_id}/messages")
        self.assertEqual(len(client_view.data), 1)  # la note interne reste invisible au client

    def test_client_cannot_read_other_users_ticket_messages(self):
        self.login(role="client", sub="c2")
        created = self.client.post("/api/support/tickets", {"subject": "X", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        self.login(role="client", sub="c3")
        res = self.client.get(f"/api/support/tickets/{ticket_id}/messages")
        self.assertEqual(res.status_code, 403)

    def test_ticket_assignment_and_level_update(self):
        self.login(role="client", sub="c4")
        created = self.client.post("/api/support/tickets", {"subject": "Y", "category": "credit"}, format="json")
        ticket_id = created.data["id"]
        self.login(role="gest_agents", sub="agent-2")
        updated = self.client.patch(f"/api/support/tickets/{ticket_id}",
                                     {"assignedTo": "agent-2", "level": "L2", "status": "escalade"}, format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["assignedTo"], "agent-2")
        self.assertEqual(updated.data["level"], "L2")

    def test_ticket_created_with_sla_deadlines_from_priority(self):
        self.login(role="client", sub="c5")
        created = self.client.post("/api/support/tickets",
                                    {"subject": "Panne critique", "category": "technique", "priority": "critique"},
                                    format="json")
        self.assertIsNotNone(created.data["slaFirstResponseDue"])
        self.assertIsNotNone(created.data["slaResolutionDue"])
        ticket = Ticket.objects.get(pk=created.data["id"])
        delta = ticket.sla_resolution_due - ticket.created_at
        self.assertAlmostEqual(delta.total_seconds(), timedelta(hours=8).total_seconds(), delta=5)

    def test_first_staff_public_message_sets_first_response_and_transitions_status(self):
        self.login(role="client", sub="c6")
        created = self.client.post("/api/support/tickets", {"subject": "Z", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        self.assertEqual(created.data["status"], "ouvert")

        self.login(role="gest_agents", sub="agent-3")
        self.client.post(f"/api/support/tickets/{ticket_id}/messages",
                          {"text": "note interne", "isInternal": True}, format="json")
        still_open = Ticket.objects.get(pk=ticket_id)
        self.assertIsNone(still_open.first_response_at)

        self.client.post(f"/api/support/tickets/{ticket_id}/messages", {"text": "Bonjour, on regarde ça."},
                          format="json")
        ticket = Ticket.objects.get(pk=ticket_id)
        self.assertIsNotNone(ticket.first_response_at)
        self.assertEqual(ticket.status, "en-traitement")

    def test_escalate_bumps_level_and_caps_at_l3(self):
        self.login(role="client", sub="c7")
        created = self.client.post("/api/support/tickets", {"subject": "E", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        self.login(role="gest_agents", sub="agent-4")
        r1 = self.client.post(f"/api/support/tickets/{ticket_id}/escalate", {"reason": "besoin d'expertise"},
                               format="json")
        self.assertEqual(r1.data["level"], "L2")
        r2 = self.client.post(f"/api/support/tickets/{ticket_id}/escalate", {}, format="json")
        self.assertEqual(r2.data["level"], "L3")
        r3 = self.client.post(f"/api/support/tickets/{ticket_id}/escalate", {}, format="json")
        self.assertEqual(r3.status_code, 409)

    def test_client_cannot_escalate_resolve_or_reject(self):
        self.login(role="client", sub="c8")
        created = self.client.post("/api/support/tickets", {"subject": "F", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        self.assertEqual(self.client.post(f"/api/support/tickets/{ticket_id}/escalate", {}, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/support/tickets/{ticket_id}/resolve", {}, format="json").status_code, 403)
        self.assertEqual(
            self.client.post(f"/api/support/tickets/{ticket_id}/reject", {"reason": "x"}, format="json").status_code,
            403)

    def test_resolve_sets_resolved_at_and_blocks_double_resolve(self):
        self.login(role="client", sub="c9")
        created = self.client.post("/api/support/tickets", {"subject": "G", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        self.login(role="gest_agents", sub="agent-5")
        resolved = self.client.post(f"/api/support/tickets/{ticket_id}/resolve", {"resolutionNote": "Corrigé."},
                                     format="json")
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(resolved.data["status"], "resolu")
        self.assertIsNotNone(resolved.data["resolvedAt"])
        again = self.client.post(f"/api/support/tickets/{ticket_id}/resolve", {}, format="json")
        self.assertEqual(again.status_code, 409)

    def test_reject_requires_reason(self):
        self.login(role="client", sub="c10")
        created = self.client.post("/api/support/tickets", {"subject": "H", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        self.login(role="gest_agents", sub="agent-6")
        missing = self.client.post(f"/api/support/tickets/{ticket_id}/reject", {}, format="json")
        self.assertEqual(missing.status_code, 400)
        ok = self.client.post(f"/api/support/tickets/{ticket_id}/reject", {"reason": "Doublon."}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data["status"], "rejete")
        self.assertEqual(ok.data["rejectedReason"], "Doublon.")

    def test_reopen_within_window_resets_resolution_sla_then_blocked_after_window(self):
        self.login(role="client", sub="c11")
        created = self.client.post("/api/support/tickets", {"subject": "I", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        self.login(role="gest_agents", sub="agent-7")
        self.client.post(f"/api/support/tickets/{ticket_id}/resolve", {}, format="json")

        self.login(role="client", sub="c11")
        reopened = self.client.post(f"/api/support/tickets/{ticket_id}/reopen", {}, format="json")
        self.assertEqual(reopened.status_code, 200)
        self.assertEqual(reopened.data["status"], "en-traitement")
        self.assertEqual(reopened.data["reopenedCount"], 1)

        ticket = Ticket.objects.get(pk=ticket_id)
        ticket.status = Ticket.Status.RESOLU
        ticket.resolved_at = timezone.now() - timedelta(days=8)
        ticket.save(update_fields=["status", "resolved_at"])
        too_late = self.client.post(f"/api/support/tickets/{ticket_id}/reopen", {}, format="json")
        self.assertEqual(too_late.status_code, 409)

    def test_waiting_on_pauses_and_resumes_resolution_clock(self):
        self.login(role="client", sub="c12")
        created = self.client.post("/api/support/tickets", {"subject": "J", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        original_due = Ticket.objects.get(pk=ticket_id).sla_resolution_due

        self.login(role="gest_agents", sub="agent-8")
        paused = self.client.post(f"/api/support/tickets/{ticket_id}/waiting-on", {"value": "client"}, format="json")
        self.assertEqual(paused.data["waitingOn"], "client")
        ticket = Ticket.objects.get(pk=ticket_id)
        self.assertIsNotNone(ticket.sla_paused_at)
        ticket.sla_paused_at = timezone.now() - timedelta(hours=2)
        ticket.save(update_fields=["sla_paused_at"])

        resumed = self.client.post(f"/api/support/tickets/{ticket_id}/waiting-on", {"value": "agent"}, format="json")
        self.assertEqual(resumed.data["waitingOn"], "agent")
        ticket = Ticket.objects.get(pk=ticket_id)
        self.assertIsNone(ticket.sla_paused_at)
        self.assertGreater(ticket.sla_resolution_due, original_due)

    def test_rate_within_window_blocks_second_rating_and_non_owner(self):
        self.login(role="client", sub="c13")
        created = self.client.post("/api/support/tickets", {"subject": "K", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        self.login(role="gest_agents", sub="agent-9")
        self.client.post(f"/api/support/tickets/{ticket_id}/resolve", {}, format="json")

        other_client = self.client.post(f"/api/support/tickets/{ticket_id}/rate", {"rating": 5}, format="json")
        self.assertEqual(other_client.status_code, 403)

        self.login(role="client", sub="c13")
        rated = self.client.post(f"/api/support/tickets/{ticket_id}/rate", {"rating": 4, "comment": "Bien traité"},
                                  format="json")
        self.assertEqual(rated.status_code, 200)
        self.assertEqual(rated.data["satisfactionRating"], 4)
        again = self.client.post(f"/api/support/tickets/{ticket_id}/rate", {"rating": 1}, format="json")
        self.assertEqual(again.status_code, 409)

        ticket = Ticket.objects.get(pk=ticket_id)
        ticket.satisfaction_rating = None
        ticket.resolved_at = timezone.now() - timedelta(days=8)
        ticket.save(update_fields=["satisfaction_rating", "resolved_at"])
        too_late = self.client.post(f"/api/support/tickets/{ticket_id}/rate", {"rating": 3}, format="json")
        self.assertEqual(too_late.status_code, 409)

    def test_check_sla_breaches_escalates_on_overdue_first_response(self):
        from .sla import check_sla_breaches

        self.login(role="client", sub="c14")
        created = self.client.post("/api/support/tickets", {"subject": "L", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        ticket = Ticket.objects.get(pk=ticket_id)
        ticket.sla_first_response_due = timezone.now() - timedelta(hours=1)
        ticket.save(update_fields=["sla_first_response_due"])

        touched = check_sla_breaches()
        self.assertEqual(len(touched), 1)
        ticket.refresh_from_db()
        self.assertTrue(ticket.sla_breached_first_response)
        self.assertEqual(ticket.level, "L2")
        self.assertEqual(ticket.status, "escalade")


class TicketSmsNotificationTests(AuthedAPITestCase):
    """`login()` patche `accounts.authentication.requests.get` — le MÊME objet module que
    `common.sms.requests` (un seul `import requests` partagé). Patcher `common.sms.
    requests.get` en décorateur AVANT un `self.login()` ultérieur ferait écraser
    silencieusement ce patch par celui de `login()` (dernier `.start()` gagne sur le même
    attribut). Donc : toutes les connexions AVANT d'entrer le `with patch(...)`, et un
    appel authentifié "à blanc" pour peupler le cache jeton→user avant d'y entrer aussi
    (sinon la résolution d'authentification de la requête réelle appellerait elle-même
    `requests.get`, cette fois interceptée par MON mock au lieu du faux `/userinfo`)."""

    def _create_ticket_with_phone(self, sub, phone):
        self.login(role="client", sub=sub, phone_number=phone)
        created = self.client.post("/api/support/tickets", {"subject": "X", "category": "technique"}, format="json")
        return created.data["id"]

    def _login_staff_and_warm_cache(self, sub):
        self.login(role="gest_agents", sub=sub)
        self.client.get("/api/support/tickets")  # peuple le cache jeton→user pour ce sub

    @override_settings(SMS=_SMS_CONFIGURED)
    def test_first_staff_response_notifies_client_by_sms(self):
        ticket_id = self._create_ticket_with_phone("sms-c1", "+243900000001")
        self._login_staff_and_warm_cache("sms-agent1")
        with patch("common.sms.requests.get") as mock_get:
            mock_get.return_value = Mock(json=lambda: {"status": "S"})
            self.client.post(f"/api/support/tickets/{ticket_id}/messages", {"text": "Bonjour"}, format="json")
        mock_get.assert_called_once()
        self.assertEqual(mock_get.call_args.kwargs["params"]["phonenumber"], "243900000001")

    @override_settings(SMS=_SMS_CONFIGURED)
    def test_internal_note_does_not_notify_client(self):
        ticket_id = self._create_ticket_with_phone("sms-c2", "+243900000002")
        self._login_staff_and_warm_cache("sms-agent2")
        with patch("common.sms.requests.get") as mock_get:
            mock_get.return_value = Mock(json=lambda: {"status": "S"})
            self.client.post(f"/api/support/tickets/{ticket_id}/messages",
                             {"text": "Note interne", "isInternal": True}, format="json")
        mock_get.assert_not_called()

    @override_settings(SMS=_SMS_CONFIGURED)
    def test_resolve_notifies_client_by_sms(self):
        ticket_id = self._create_ticket_with_phone("sms-c3", "+243900000003")
        self._login_staff_and_warm_cache("sms-agent3")
        with patch("common.sms.requests.get") as mock_get:
            mock_get.return_value = Mock(json=lambda: {"status": "S"})
            self.client.post(f"/api/support/tickets/{ticket_id}/resolve", {}, format="json")
        mock_get.assert_called_once()
        self.assertEqual(mock_get.call_args.kwargs["params"]["phonenumber"], "243900000003")

    @override_settings(SMS=_SMS_CONFIGURED)
    def test_reject_notifies_client_by_sms(self):
        ticket_id = self._create_ticket_with_phone("sms-c4", "+243900000004")
        self._login_staff_and_warm_cache("sms-agent4")
        with patch("common.sms.requests.get") as mock_get:
            mock_get.return_value = Mock(json=lambda: {"status": "S"})
            self.client.post(f"/api/support/tickets/{ticket_id}/reject", {"reason": "Doublon."}, format="json")
        mock_get.assert_called_once()

    @override_settings(SMS=_SMS_CONFIGURED)
    def test_escalate_notifies_client_by_sms(self):
        ticket_id = self._create_ticket_with_phone("sms-c5", "+243900000005")
        self._login_staff_and_warm_cache("sms-agent5")
        with patch("common.sms.requests.get") as mock_get:
            mock_get.return_value = Mock(json=lambda: {"status": "S"})
            self.client.post(f"/api/support/tickets/{ticket_id}/escalate", {}, format="json")
        mock_get.assert_called_once()

    @override_settings(SMS=_SMS_CONFIGURED)
    def test_client_without_phone_does_not_crash_resolve(self):
        self.login(role="client", sub="sms-c6")  # pas de phone_number dans les claims
        created = self.client.post("/api/support/tickets", {"subject": "X", "category": "technique"}, format="json")
        ticket_id = created.data["id"]
        self._login_staff_and_warm_cache("sms-agent6")
        with patch("common.sms.requests.get") as mock_get:
            res = self.client.post(f"/api/support/tickets/{ticket_id}/resolve", {}, format="json")
        self.assertEqual(res.status_code, 200)
        mock_get.assert_not_called()

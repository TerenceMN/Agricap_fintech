from __future__ import annotations

from accounts.models import FintechUser
from common.testing import AuthedAPITestCase

from .models import Notification


class NotificationsTests(AuthedAPITestCase):
    def test_list_and_mark_read(self):
        FintechUser.objects.create(sub="n1", role="client")
        self.login(role="client", sub="n1")
        notif = Notification.objects.create(user_id="n1", title="Bienvenue")
        listed = self.client.get("/api/notifications/mine")
        self.assertEqual(len(listed.data), 1)
        self.assertFalse(listed.data[0]["read"])
        res = self.client.post(f"/api/notifications/{notif.pk}/read", {}, format="json")
        self.assertTrue(res.data["read"])

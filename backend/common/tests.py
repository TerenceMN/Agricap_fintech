from __future__ import annotations

from unittest.mock import Mock, patch

import requests
from django.test import TestCase, override_settings

from . import sms

_CONFIGURED = {"API_URL": "https://example.test/SendSMS", "API_ID": "API1", "API_PASSWORD": "pwd",
               "SENDER_ID": "TEST"}


class SendSmsTests(TestCase):
    @override_settings(SMS={"API_URL": "", "API_ID": "", "API_PASSWORD": "", "SENDER_ID": "TEST"})
    def test_no_credentials_configured_is_honest_not_simulated(self):
        self.assertFalse(sms.send_sms(phone="+243900000000", message="test"))

    def test_no_phone_number_returns_false(self):
        self.assertFalse(sms.send_sms(phone="", message="test"))

    @override_settings(SMS=_CONFIGURED)
    @patch("common.sms.requests.get")
    def test_success_response_returns_true_and_strips_plus(self, mock_get):
        mock_get.return_value = Mock(json=lambda: {"status": "S", "remarks": "OK"})
        ok = sms.send_sms(phone="+243900000000", message="Code : 123456")
        self.assertTrue(ok)
        _, kwargs = mock_get.call_args
        self.assertEqual(kwargs["params"]["phonenumber"], "243900000000")

    @override_settings(SMS=_CONFIGURED)
    @patch("common.sms.requests.get")
    def test_failure_response_returns_false(self, mock_get):
        mock_get.return_value = Mock(json=lambda: {"status": "F", "remarks": "Invalid sender"})
        self.assertFalse(sms.send_sms(phone="+243900000000", message="test"))

    @override_settings(SMS=_CONFIGURED)
    @patch("common.sms.requests.get")
    def test_network_error_returns_false(self, mock_get):
        mock_get.side_effect = requests.RequestException("timeout")
        self.assertFalse(sms.send_sms(phone="+243900000000", message="test"))


class SendSmsToUserTests(TestCase):
    @override_settings(SMS=_CONFIGURED)
    @patch("common.sms.requests.get")
    def test_resolves_phone_from_user_sub(self, mock_get):
        from accounts.models import FintechUser
        FintechUser.objects.create(sub="u1", phone="+243900000001")
        mock_get.return_value = Mock(json=lambda: {"status": "S"})
        self.assertTrue(sms.send_sms_to_user(user_sub="u1", message="hi"))

    def test_user_without_phone_returns_false(self):
        from accounts.models import FintechUser
        FintechUser.objects.create(sub="u2", phone="")
        self.assertFalse(sms.send_sms_to_user(user_sub="u2", message="hi"))

    def test_unknown_user_returns_false(self):
        self.assertFalse(sms.send_sms_to_user(user_sub="ghost", message="hi"))

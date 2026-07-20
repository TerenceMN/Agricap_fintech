from __future__ import annotations

from accounts.models import FintechUser
from common.testing import AuthedAPITestCase

from .models import Contract


class ContractsTests(AuthedAPITestCase):
    def test_sign_requires_agreement_and_signature(self):
        FintechUser.objects.create(sub="c1", role="client")
        self.login(role="client", sub="c1")
        contract = Contract.objects.create(user_id="c1", title="Contrat cadre")
        res = self.client.post(f"/api/contracts/mine/{contract.pk}/sign", {}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_sign_activates_contract(self):
        FintechUser.objects.create(sub="c2", role="client")
        self.login(role="client", sub="c2")
        contract = Contract.objects.create(user_id="c2", title="Contrat cadre")
        res = self.client.post(f"/api/contracts/mine/{contract.pk}/sign",
                                {"agreed": True, "signature": "Jean D."}, format="json")
        self.assertEqual(res.data["status"], "actif")

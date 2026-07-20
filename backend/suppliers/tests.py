from __future__ import annotations

from common.testing import AuthedAPITestCase

from .models import Supplier


class SuppliersTests(AuthedAPITestCase):
    def test_blacklist_action(self):
        supplier = Supplier.objects.create(name="Fournisseur Test")
        self.login(role="dg", sub="s1")
        res = self.client.post(f"/api/suppliers/{supplier.pk}/action", {"action": "blacklist"}, format="json")
        self.assertTrue(res.data["blacklisted"])

    def test_create_requires_create_capability(self):
        self.login(role="agri_op", sub="s2")  # pas de capacité create
        res = self.client.post("/api/suppliers/", {"name": "X"}, format="json")
        self.assertEqual(res.status_code, 403)

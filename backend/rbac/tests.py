from __future__ import annotations

from django.test import TestCase

from common.testing import AuthedAPITestCase


class RoleFallbackTests(TestCase):
    """Le repli sur `client` doit être BRUYANT, et les alias de nomenclature résolus.

    Le repli muet était le vrai danger : un rôle inconnu (faute de frappe, claim
    IdP obsolète, nom de vue confondu avec un rôle) faisait de son porteur un
    client lecture seule — `is_staff_role` à False, tous les gardes `IsStaff` le
    traitant en externe — sans qu'aucune ligne de log ni aucun écran ne le dise.
    """

    def test_role_inconnu_retombe_sur_client_EN_LOGGANT(self):
        from rbac.role_registry import get_role

        with self.assertLogs("rbac.role_registry", level="WARNING") as journal:
            role = get_role("chef-des-fleurs")

        self.assertEqual(role.id, "client")
        self.assertEqual(role.type, "Client")
        trace = "\n".join(journal.output)
        self.assertIn("chef-des-fleurs", trace)   # le rôle fautif est nommé
        self.assertIn("client", trace)            # la conséquence est nommée

    def test_auditeur_et_caissier_sont_des_alias_pas_des_clients(self):
        """« auditeur » et « caissier » sont des VUES de tableau de bord, pas des
        rôles. Reçus comme rôle, ils doivent résoudre vers le canonique — pas
        déclasser en client un membre du personnel."""
        from rbac.role_registry import get_role

        for entree, attendu in (("auditeur", "aud_tech"), ("caissier", "agent_cash")):
            with self.subTest(entree=entree):
                with self.assertLogs("rbac.role_registry", level="WARNING") as journal:
                    role = get_role(entree)
                self.assertEqual(role.id, attendu)
                self.assertNotEqual(role.type, "Client")
                self.assertIn(attendu, "\n".join(journal.output))

    def test_alias_caissier_ne_confere_pas_validate(self):
        """`gest_caisse` porte `validate`, pas `agent_cash`. Une chaîne dont
        personne n'a décidé le niveau ne doit pas hériter du plus élevé."""
        from rbac.role_registry import get_role

        self.assertFalse(get_role("caissier").validate)
        self.assertTrue(get_role("caissier").disburse)

    def test_role_connu_ne_logge_rien(self):
        """Le bruit n'a de valeur que s'il est rare."""
        import logging

        from rbac.role_registry import get_role

        with self.assertNoLogs("rbac.role_registry", level=logging.INFO):
            self.assertEqual(get_role("gest_credit").id, "gest_credit")


class RoleWriteValidationTests(AuthedAPITestCase):
    """`accounts.FintechUser.role` est un CharField libre : la validation doit se
    faire à l'écriture, sinon la divergence de nomenclature se réinstalle."""

    def test_patch_role_inconnu_refuse(self):
        self.login(role="gest_caisse", sub="u-40")
        self.client.get("/api/rbac/me")
        self.login(role="admin_it", sub="u-41")
        res = self.client.patch("/api/rbac/users/u-40", {"role": "chef-des-fleurs"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["code"], "ROLE_INCONNU")

    def test_patch_role_alias_est_canonicalise(self):
        self.login(role="gest_caisse", sub="u-42")
        self.client.get("/api/rbac/me")
        self.login(role="admin_it", sub="u-43")
        res = self.client.patch("/api/rbac/users/u-42", {"role": "auditeur"}, format="json")
        self.assertEqual(res.status_code, 200)
        # Stocké canonique : la chaîne « auditeur » ne survit pas en base.
        self.assertEqual(res.data["role"], "aud_tech")


class RbacMeTests(AuthedAPITestCase):
    def test_me_reflects_role_capabilities(self):
        self.login(role="gest_caisse", sub="u-1")
        res = self.client.get("/api/rbac/me")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["role"], "gest_caisse")
        self.assertTrue(res.data["capabilities"]["disburse"])
        self.assertFalse(res.data["capabilities"]["config"])
        self.assertFalse(res.data["isSupervisor"])

    def test_me_supervisor_role(self):
        self.login(role="dg", sub="u-2")
        res = self.client.get("/api/rbac/me")
        self.assertTrue(res.data["isSupervisor"])
        self.assertTrue(res.data["capabilities"]["config"])

    def test_roles_lists_all_sixteen_plus_legacy(self):
        self.login(role="admin_it", sub="u-3")
        res = self.client.get("/api/rbac/roles")
        self.assertEqual(res.status_code, 200)
        ids = {r["id"] for r in res.data}
        self.assertIn("dg", ids)
        self.assertIn("agent_cash", ids)
        self.assertIn("admin", ids)  # legacy fallback préservé

    def test_me_requires_auth(self):
        res = self.client.get("/api/rbac/me")
        self.assertEqual(res.status_code, 401)


class RbacUsersTests(AuthedAPITestCase):
    def test_users_list_requires_config_capability(self):
        self.login(role="agent_terrain", sub="u-6")  # pas de capacité config
        res = self.client.get("/api/rbac/users")
        self.assertEqual(res.status_code, 403)

    def test_admin_it_can_list_and_update_user(self):
        self.login(role="agent_terrain", sub="u-7")
        self.client.get("/api/rbac/me")  # déclenche le provisioning JIT de "u-7"
        self.login(role="admin_it", sub="u-8")  # capacité config=True
        listed = self.client.get("/api/rbac/users")
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(any(u["sub"] == "u-7" for u in listed.data))
        updated = self.client.patch("/api/rbac/users/u-7", {"role": "gest_caisse", "zone": "Kongo"}, format="json")
        self.assertEqual(updated.data["role"], "gest_caisse")
        self.assertEqual(updated.data["zone"], "Kongo")

    def test_suspend_then_locked_user_loses_all_access(self):
        self.login(role="gest_caisse", sub="u-9")
        self.client.get("/api/rbac/me")  # déclenche le provisioning JIT de "u-9"
        self.login(role="admin_it", sub="u-10")
        suspend = self.client.post("/api/rbac/users/u-9/action", {"action": "suspend"}, format="json")
        self.assertEqual(suspend.data["status"], "Suspendu")
        self.login(role="gest_caisse", sub="u-9")  # se reconnecte (même rôle, mais désormais locked)
        res = self.client.get("/api/agencies/")
        self.assertEqual(res.status_code, 403)


class RbacRoleEditingTests(AuthedAPITestCase):
    def test_edit_role_requires_config_capability(self):
        self.login(role="gest_caisse", sub="u-20")
        res = self.client.patch("/api/rbac/roles/gest_caisse", {"permissions": {"config": True}}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_edit_existing_role_overrides_factory_capabilities(self):
        self.login(role="admin_it", sub="u-21")
        res = self.client.patch("/api/rbac/roles/agent_terrain",
                                 {"permissions": {"validate": True}}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["permissions"]["validate"])
        self.assertTrue(res.data["permissions"]["read"])  # champs non fournis : conservés
        self.assertTrue(res.data["isOverridden"])

        listed = self.client.get("/api/rbac/roles")
        overridden = next(r for r in listed.data if r["id"] == "agent_terrain")
        self.assertTrue(overridden["permissions"]["validate"])

        self.login(role="agent_terrain", sub="u-22")
        gated = self.client.get("/api/rbac/me")
        self.assertTrue(gated.data["capabilities"]["validate"])

    def test_create_custom_role(self):
        self.login(role="admin_it", sub="u-23")
        res = self.client.post("/api/rbac/roles", {
            "id": "gest_zone_est", "label": "Gestionnaire Zone Est", "level": 4, "type": "Opérations",
            "permissions": {"read": True, "create": True},
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["isCustom"])

        dupe = self.client.post("/api/rbac/roles", {"id": "gest_zone_est", "label": "x"}, format="json")
        self.assertEqual(dupe.status_code, 409)

    def test_create_role_requires_config_capability(self):
        self.login(role="gest_caisse", sub="u-24")
        res = self.client.post("/api/rbac/roles", {"id": "x"}, format="json")
        self.assertEqual(res.status_code, 403)


class RbacViewOverrideAndLockTests(AuthedAPITestCase):
    def test_view_override_persists_and_rejects_unknown_view(self):
        self.login(role="gest_caisse", sub="u-30")
        self.client.get("/api/rbac/me")
        self.login(role="admin_it", sub="u-31")
        bad = self.client.patch("/api/rbac/users/u-30", {"viewOverride": "not-a-view"}, format="json")
        self.assertEqual(bad.status_code, 400)
        ok = self.client.patch("/api/rbac/users/u-30", {"viewOverride": "auditeur"}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data["viewOverride"], "auditeur")

        self.login(role="gest_caisse", sub="u-30")
        me_res = self.client.get("/api/rbac/me")
        self.assertEqual(me_res.data["viewOverride"], "auditeur")

    def test_lock_action_blocks_access_without_changing_status(self):
        self.login(role="gest_caisse", sub="u-32")
        self.client.get("/api/rbac/me")
        self.login(role="admin_it", sub="u-33")
        locked = self.client.post("/api/rbac/users/u-32/action", {"action": "lock"}, format="json")
        self.assertEqual(locked.status_code, 200)
        self.assertTrue(locked.data["security"]["locked"])
        self.assertEqual(locked.data["status"], "Actif")

        self.login(role="gest_caisse", sub="u-32")
        res = self.client.get("/api/agencies/")
        self.assertEqual(res.status_code, 403)


class RbacSupervisorsTests(AuthedAPITestCase):
    def test_supervisors_requires_audit_capability(self):
        self.login(role="agent_terrain", sub="u-11")  # ni audit ni config
        res = self.client.get("/api/rbac/supervisors")
        self.assertEqual(res.status_code, 403)

    def test_supervisors_lists_only_supervisor_roles(self):
        self.login(role="gest_caisse", sub="u-12")  # non-superviseur, provisionné
        self.client.get("/api/rbac/me")
        self.login(role="dg", sub="u-13")  # superviseur, provisionné
        self.client.get("/api/rbac/me")
        self.login(role="aud_fin", sub="u-14")  # capacité audit=True, interroge la liste
        res = self.client.get("/api/rbac/supervisors")
        self.assertEqual(res.status_code, 200)
        subs = {u["sub"] for u in res.data}
        self.assertIn("u-13", subs)
        self.assertNotIn("u-12", subs)

"""Les erreurs de workflow portent un code et se détaillent cause par cause.

Signalé par `front-garanties` : `submit` renvoyait `{detail}` sans `code`, avec
les quatre causes possibles agrégées dans une seule phrase séparée par des « | ».
Une interface ne peut rien faire de ça — et le message d'inéligibilité de
garantie, qui énumère les types admis, y était noyé.

Principe 5 : réponse structurée `{code, message}` par erreur, jamais un message
générique.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from credits.models import CreditApplication, CreditGuarantee
from credits.tests_guarantees import _chain
from credits.workflow import (
    ApplicationIncomplete,
    ConsentError,
    DelegationError,
    InvalidTransition,
    MakerCheckerError,
    WorkflowError,
    submit,
)


def _user(sub: str):
    from accounts.models import FintechUser
    user, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": sub, "phone": f"+243{sub[-9:].zfill(9)}"},
    )
    return user


class SubmitErrorCodesTests(TestCase):

    def _app(self, **kwargs) -> CreditApplication:
        defaults = {
            "code": f"CRED-TEST-WF-{CreditApplication.objects.count():04d}",
            "client": _user("sub-wf-client"),
            "currency": "USD",
            "status": CreditApplication.Status.DRAFT,
        }
        defaults.update(kwargs)
        return CreditApplication.objects.create(**defaults)

    def _submit(self, app) -> WorkflowError:
        with self.assertRaises(WorkflowError) as ctx:
            submit(app, submitter_sub="sub-wf-client")
        return ctx.exception

    def test_dossier_vide_liste_chaque_cause_separement(self):
        exc = self._submit(self._app())

        self.assertIsInstance(exc, ApplicationIncomplete)
        self.assertEqual(exc.code, "APPLICATION_INCOMPLETE")
        self.assertEqual(
            {e["code"] for e in exc.as_errors()},
            {"FILIERE_MANQUANTE", "SUPERFICIE_MANQUANTE", "MONTANT_MANQUANT"},
        )
        # Chaque entrée est exploitable telle quelle par une interface.
        for entry in exc.as_errors():
            self.assertTrue(entry["message"])
            self.assertEqual(set(entry), {"code", "message"})

    def test_une_seule_cause_ne_produit_qu_une_entree(self):
        app = self._app(
            value_chain=_chain("TEST_WF_1", ["epargne"]),
            area_ha=Decimal("2"), amount_requested=None,
        )
        exc = self._submit(app)
        self.assertEqual([e["code"] for e in exc.as_errors()], ["MONTANT_MANQUANT"])

    def test_garantie_devenue_ineligible_garde_son_code_et_ses_types_admis(self):
        """Le message énumère les types admis : le front ne peut pas le reconstituer
        (il ne connaît pas `ValueChain.eligible_guarantees`, principe 7)."""
        chain = _chain("TEST_WF_2", ["epargne", "morale"])
        app = self._app(
            value_chain=chain, area_ha=Decimal("2"),
            amount_requested=Decimal("5000"),
        )
        CreditGuarantee.objects.create(
            application=app, guarantee_type="materiel",
            status=CreditGuarantee.Status.PENDING,
        )

        exc = self._submit(app)
        errors = exc.as_errors()
        self.assertEqual([e["code"] for e in errors], ["GUARANTEE_TYPE_NOT_ELIGIBLE"])
        self.assertIn("epargne", errors[0]["message"])
        self.assertIn("morale", errors[0]["message"])

    def test_transition_invalide_porte_son_propre_code(self):
        app = self._app(
            value_chain=_chain("TEST_WF_3", ["epargne"]),
            area_ha=Decimal("2"), amount_requested=Decimal("5000"),
            status=CreditApplication.Status.SUBMITTED,
        )
        exc = self._submit(app)
        self.assertIsInstance(exc, InvalidTransition)
        self.assertEqual(exc.code, "INVALID_TRANSITION")
        self.assertEqual([e["code"] for e in exc.as_errors()], ["INVALID_TRANSITION"])

    def test_soumission_nominale_reussit(self):
        app = self._app(
            value_chain=_chain("TEST_WF_4", ["epargne"]),
            area_ha=Decimal("2"), amount_requested=Decimal("5000"),
        )
        submit(app, submitter_sub="sub-wf-client")
        self.assertEqual(app.status, "submitted")


class WorkflowErrorContractTests(TestCase):
    """Le contrat de codes est consommé par le front : il doit être stable."""

    def test_codes_distincts_et_tous_sous_workflow_error(self):
        classes = [InvalidTransition, ApplicationIncomplete, DelegationError,
                   MakerCheckerError, ConsentError]
        codes = [c.code for c in classes]
        self.assertEqual(len(set(codes)), len(codes))
        self.assertEqual(sorted(codes), [
            "APPLICATION_INCOMPLETE", "CLIENT_CONSENT_MISSING",
            "DELEGATION_EXCEEDED", "INVALID_TRANSITION", "MAKER_CHECKER_VIOLATION",
        ])
        for cls in classes:
            self.assertTrue(issubclass(cls, WorkflowError))

    def test_codes_en_majuscules_convention_du_module(self):
        """Convention unique (principe 6) : `ASSET_NOT_OWNED`, `FEUILLE_MANQUANTE`…

        Les vues `approve` / `reject` / `start-analysis` / `client-consent`
        émettent encore des codes en minuscules pour les mêmes concepts — dette
        documentée en §7quinquies du fragment de statut, migration à arbitrer
        avec les fronts. Ce test fige au moins la convention côté exceptions.
        """
        for cls in (InvalidTransition, ApplicationIncomplete, DelegationError,
                    MakerCheckerError, ConsentError, WorkflowError):
            self.assertEqual(cls.code, cls.code.upper())
            self.assertRegex(cls.code, r"^[A-Z][A-Z_]+$")

    def test_as_errors_n_est_jamais_vide(self):
        """La vue peut relayer `as_errors()` sans jamais tester le cas vide."""
        self.assertEqual(
            WorkflowError("panne générique").as_errors(),
            [{"code": "WORKFLOW_ERROR", "message": "panne générique"}],
        )

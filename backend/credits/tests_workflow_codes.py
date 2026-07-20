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
    ConsentExpired,
    DelegationError,
    InvalidTransition,
    MakerCheckerError,
    WorkflowError,
    submit,
)

ALL_ERROR_CLASSES = (
    WorkflowError, InvalidTransition, ApplicationIncomplete, DelegationError,
    MakerCheckerError, ConsentError, ConsentExpired,
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
                   MakerCheckerError, ConsentError, ConsentExpired]
        codes = [c.code for c in classes]
        self.assertEqual(len(set(codes)), len(codes))
        self.assertEqual(sorted(codes), [
            "APPLICATION_INCOMPLETE", "CLIENT_CONSENT_EXPIRED",
            "CLIENT_CONSENT_MISSING", "DELEGATION_EXCEEDED", "INVALID_TRANSITION",
            "MAKER_CHECKER_VIOLATION",
        ])
        for cls in classes:
            self.assertTrue(issubclass(cls, WorkflowError))

    def test_les_vues_n_ecrivent_plus_de_code_en_dur(self):
        """Garde anti-régression du principe 6.

        Les codes en minuscules (`delegation_exceeded`, `consent_required`…)
        vivaient dans `views.py` en parallèle de ceux des exceptions. Toute
        réapparition d'un `"code": "<minuscule>"` écrit à la main dans une
        réponse d'erreur du workflow recrée le vocabulaire parallèle.
        """
        import io
        import pathlib
        import re

        source = io.open(
            pathlib.Path(__file__).with_name("views.py"), encoding="utf-8",
        ).read()
        interdits = re.findall(r'"code":\s*"([a-z][a-z_]*)"', source)
        self.assertEqual(
            interdits, [],
            f"Codes d'erreur en minuscules écrits en dur dans views.py : {interdits}. "
            f"Utiliser le `code` porté par l'exception.",
        )

    def test_codes_en_majuscules_convention_du_module(self):
        """Convention unique (principe 6) : `ASSET_NOT_OWNED`, `FEUILLE_MANQUANTE`…

        Les vues émettaient auparavant des codes en minuscules écrits à la main
        (`delegation_exceeded`) pour ces mêmes concepts : deux vocabulaires pour
        une notion. Elles relaient désormais toutes `exc.code`.
        """
        for cls in ALL_ERROR_CLASSES:
            self.assertEqual(cls.code, cls.code.upper())
            self.assertRegex(cls.code, r"^[A-Z][A-Z_]+$")

    def test_chaque_regle_porte_son_statut_http(self):
        """Code et statut sont définis au même endroit : la règle elle-même.

        Une vue ne réécrit plus de statut ; ajouter une règle ne demande donc
        aucune modification des vues qui la relaient.
        """
        attendu = {
            WorkflowError: 422,          # refus métier par défaut
            ApplicationIncomplete: 422,  # entité non traitable
            InvalidTransition: 409,      # conflit avec l'état de la ressource
            MakerCheckerError: 409,
            ConsentError: 409,
            ConsentExpired: 410,         # la fenêtre de consentement n'existe plus
            DelegationError: 403,        # refus d'autorisation, pas de validation
        }
        for cls, status in attendu.items():
            with self.subTest(cls=cls.__name__):
                self.assertEqual(cls.http_status, status)

    def test_consentement_expire_se_distingue_du_consentement_manquant(self):
        """Les deux appellent des actions différentes : recueillir vs renouveler.

        La distinction ne tenait qu'au statut HTTP (409 vs 410), donc invisible
        pour un front découplé des statuts. Elle est désormais dans le `code`.
        """
        self.assertTrue(issubclass(ConsentExpired, ConsentError))
        self.assertNotEqual(ConsentExpired.code, ConsentError.code)
        self.assertEqual(ConsentExpired.code, "CLIENT_CONSENT_EXPIRED")
        # Un `except ConsentError` continue d'attraper les deux.
        self.assertIsInstance(ConsentExpired("expiré"), ConsentError)

    def test_decaissement_ne_deduit_plus_son_code_du_texte_du_message(self):
        """La vue faisait `is_mkck = "maker" in str(exc).lower()`.

        Reformuler le message de maker-checker — sans toucher à aucune règle —
        aurait dégradé le code en `DISBURSEMENT_ERROR` et le statut de 409 à 400,
        sur le contrôle le plus sensible du module. Le code vient maintenant de
        la classe : le message est libre.
        """
        from credits.disbursement import (
            DisbursementAlreadyDone, DisbursementAmountInvalid, DisbursementError,
            DisbursementMakerChecker, DisbursementRequestConflict,
            DisbursementRequestMissing,
        )

        # Un message qui ne contient plus le mot « maker » garde le bon code.
        exc = DisbursementMakerChecker("Séparation des tâches non respectée.")
        self.assertEqual(exc.code, "MAKER_CHECKER_VIOLATION")
        self.assertEqual(exc.http_status, 409)
        self.assertNotIn("maker", str(exc).lower())

        attendu = {
            DisbursementError: ("DISBURSEMENT_ERROR", 422),
            DisbursementMakerChecker: ("MAKER_CHECKER_VIOLATION", 409),
            DisbursementRequestMissing: ("DISBURSEMENT_REQUEST_MISSING", 404),
            DisbursementRequestConflict: ("DISBURSEMENT_REQUEST_CONFLICT", 409),
            DisbursementAlreadyDone: ("DISBURSEMENT_ALREADY_DONE", 409),
            DisbursementAmountInvalid: ("DISBURSEMENT_AMOUNT_INVALID", 422),
        }
        for cls, (code, status) in attendu.items():
            with self.subTest(cls=cls.__name__):
                self.assertEqual(cls.code, code)
                self.assertEqual(cls.http_status, status)
                self.assertTrue(issubclass(cls, DisbursementError))
                self.assertEqual(cls.code, cls.code.upper())

    def test_aucune_vue_ne_deduit_un_code_du_texte_d_une_exception(self):
        """Garde anti-régression : brancher sur `str(exc)` est le motif à bannir."""
        import io
        import pathlib
        import re

        source = io.open(
            pathlib.Path(__file__).with_name("views.py"), encoding="utf-8",
        ).read()
        suspects = re.findall(r'in str\(exc\)(?:\.lower\(\))?', source)
        self.assertEqual(
            suspects, [],
            "Une vue déduit un comportement du TEXTE d'une exception. "
            "Utiliser une sous-classe typée portant son `code`.",
        )

    def test_as_errors_n_est_jamais_vide(self):
        """La vue peut relayer `as_errors()` sans jamais tester le cas vide."""
        self.assertEqual(
            WorkflowError("panne générique").as_errors(),
            [{"code": "WORKFLOW_ERROR", "message": "panne générique"}],
        )

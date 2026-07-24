"""File d'événements comptables du crédit (annexe B, B1→B4).

Ce que ces tests verrouillent — et pourquoi :

* **Le décaissement produit son événement, dans SA transaction.** C'est
  l'invariant central : un franc sorti sans événement serait un encours
  invisible au grand livre. Le test d'échec provoqué vérifie que l'échec d'une
  étape ultérieure emporte l'événement avec le prêt.
* **Idempotence par acte métier** : rejouer une émission ne crée pas une
  seconde écriture.
* **Immuabilité** (principe 3) : un événement émis ne se réécrit pas, sauf les
  deux champs qui appartiennent au consommateur comptable.
* **Un fait, un montant** : une échéance donne B2 et B3 séparés, jamais un total
  que la comptabilité devrait ventiler au jugé.
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

from django.db import transaction
from django.test import TestCase
from django.utils import timezone

from credits.disbursement import confirm_disbursement, request_disbursement
from credits.events import (
    CreditEventError,
    SOURCE_CREDIT,
    emettre_commission,
    emettre_echeance,
    emettre_remboursement_capital,
    file_en_attente,
)
from credits.models import CreditApplication, CreditEvent, ImmutableCreditEvent


def _make_app(sub: str, *, amount: Decimal = Decimal("4000")) -> CreditApplication:
    from accounts.models import FintechUser

    client, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": sub, "phone": "+243900000000"},
    )
    return CreditApplication.objects.create(
        client=client,
        initiated_by_sub=sub,
        status="approved",
        amount_requested=amount,
        amount_approved=amount,
        currency="USD",
        code=f"CRED-EVT-{CreditApplication.objects.count():04d}",
    )


# ── B1 : le décaissement alimente la file ─────────────────────────────────────

class DecaissementEmetSonEvenementTest(TestCase):

    def setUp(self):
        self.app = _make_app("sub-evt-client")
        self.app.submitted_by_sub = "sub-evt-maker"
        self.app.save()
        request_disbursement(self.app, requester_sub="sub-evt-maker")
        self.app.refresh_from_db()

    def test_confirmation_produit_un_evenement_b1_non_consomme(self):
        confirm_disbursement(self.app, confirmer_sub="sub-evt-checker")

        evenement = CreditEvent.objects.get(event_type=CreditEvent.Type.DISBURSED)
        self.assertEqual(evenement.amount, Decimal("4000.00"))
        self.assertEqual(evenement.currency, "USD")
        self.assertEqual(evenement.reference, f"DEC-{self.app.code}")
        self.assertEqual(evenement.application_id, self.app.pk)
        self.assertEqual(evenement.actor_sub, "sub-evt-checker")
        # La comptabilité n'a rien consommé : c'est SON geste, pas le nôtre.
        self.assertIsNone(evenement.consumed_at)
        self.assertEqual(evenement.journal_reference, "")
        self.assertIn(evenement, list(file_en_attente()))

    def test_evenement_porte_la_reference_du_pret_du_portefeuille(self):
        resultat = confirm_disbursement(self.app, confirmer_sub="sub-evt-checker")
        evenement = CreditEvent.objects.get(event_type=CreditEvent.Type.DISBURSED)
        self.assertEqual(evenement.loan_reference, resultat["loanReference"])
        self.assertIsNotNone(evenement.loan_id)
        self.assertEqual(resultat["creditEventId"], evenement.pk)

    def test_un_echec_posterieur_emporte_l_evenement_avec_le_decaissement(self):
        """Même transaction : pas de décaissement sans événement, ni l'inverse."""
        with patch("credits.disbursement._create_module_allocations",
                   side_effect=RuntimeError("panne d'allocation")):
            with self.assertRaises(RuntimeError):
                confirm_disbursement(self.app, confirmer_sub="sub-evt-checker")

        self.app.refresh_from_db()
        self.assertEqual(self.app.status, "pending_disbursement")
        self.assertEqual(CreditEvent.objects.count(), 0)
        from portfolio.models import Loan
        self.assertEqual(Loan.objects.filter(application=self.app).count(), 0)


# ── Contrat d'émission ────────────────────────────────────────────────────────

class ContratEmissionTest(TestCase):

    def setUp(self):
        self.app = _make_app("sub-evt-contrat")

    def test_source_publiee_pour_la_comptabilite(self):
        self.assertEqual(SOURCE_CREDIT, "credits.CreditEvent")

    def test_emission_idempotente_par_acte(self):
        for _ in range(3):
            emettre_remboursement_capital(
                amount=Decimal("120.5"), currency="USD",
                reference="ECH-PRT-0001-03/CAP", application=self.app,
            )
        self.assertEqual(
            CreditEvent.objects.filter(
                event_type=CreditEvent.Type.PRINCIPAL_REPAID).count(), 1,
        )

    def test_montant_nul_n_emet_rien(self):
        self.assertIsNone(emettre_commission(
            amount=Decimal("0"), currency="USD", reference="COM-0001",
            application=self.app,
        ))
        self.assertEqual(CreditEvent.objects.count(), 0)

    def test_montant_negatif_refuse(self):
        with self.assertRaises(CreditEventError):
            emettre_commission(
                amount=Decimal("-10"), currency="USD", reference="COM-0002",
                application=self.app,
            )

    def test_devise_inconnue_refusee(self):
        with self.assertRaises(CreditEventError):
            emettre_remboursement_capital(
                amount=Decimal("10"), currency="EUR", reference="ECH-X/CAP",
                application=self.app,
            )

    def test_montant_quantize_a_deux_decimales(self):
        evenement = emettre_remboursement_capital(
            amount="120.456", currency="CDF", reference="ECH-Q/CAP",
            application=self.app,
        )
        self.assertEqual(evenement.amount, Decimal("120.46"))
        self.assertEqual(evenement.currency, "CDF")


class EcheanceVentileeTest(TestCase):
    """Une échéance encaissée = B2 + B3, jamais un total à ventiler."""

    def setUp(self):
        self.app = _make_app("sub-evt-echeance")

    def test_deux_evenements_de_natures_distinctes(self):
        emis = emettre_echeance(
            capital=Decimal("300"), interets=Decimal("45"), currency="USD",
            reference="ECH-PRT-0009-02", application=self.app,
            loan_reference="PRT-CRED-0009", echeance=2,
        )
        self.assertEqual(len(emis), 2)
        capital = CreditEvent.objects.get(event_type=CreditEvent.Type.PRINCIPAL_REPAID)
        interets = CreditEvent.objects.get(event_type=CreditEvent.Type.INTEREST_COLLECTED)
        self.assertEqual(capital.amount, Decimal("300.00"))
        self.assertEqual(interets.amount, Decimal("45.00"))
        self.assertEqual(capital.reference, "ECH-PRT-0009-02/CAP")
        self.assertEqual(interets.reference, "ECH-PRT-0009-02/INT")
        self.assertEqual(interets.payload["echeance"], 2)

    def test_echeance_sans_interets_n_emet_que_le_capital(self):
        emis = emettre_echeance(
            capital=Decimal("300"), interets=Decimal("0"), currency="USD",
            reference="ECH-PRT-0009-03", application=self.app,
        )
        self.assertEqual(len(emis), 1)
        self.assertEqual(emis[0].event_type, CreditEvent.Type.PRINCIPAL_REPAID)


# ── Immuabilité (principe 3) ──────────────────────────────────────────────────

class ImmuabiliteEvenementTest(TestCase):

    def setUp(self):
        self.app = _make_app("sub-evt-immuable")
        self.evenement = emettre_remboursement_capital(
            amount=Decimal("50"), currency="USD", reference="ECH-IMM/CAP",
            application=self.app,
        )

    def test_le_montant_d_un_evenement_emis_ne_se_reecrit_pas(self):
        evenement = CreditEvent.objects.get(pk=self.evenement.pk)
        evenement.amount = Decimal("500")
        with self.assertRaises(ImmutableCreditEvent):
            evenement.save()

    def test_la_comptabilite_peut_marquer_sa_consommation(self):
        evenement = CreditEvent.objects.get(pk=self.evenement.pk)
        evenement.consumed_at = timezone.now()
        evenement.journal_reference = "CRD-20260724-B2-1"
        evenement.save()   # ne lève pas : ces deux champs sont les siens
        evenement.refresh_from_db()
        self.assertEqual(evenement.journal_reference, "CRD-20260724-B2-1")
        self.assertNotIn(evenement, list(file_en_attente()))


class EmissionHorsTransactionTest(TestCase):
    """L'émission hors transaction n'est pas bloquée, mais elle LAISSE UNE TRACE."""

    def test_avertissement_hors_transaction(self):
        app = _make_app("sub-evt-hors-tx")
        with patch("credits.events.transaction.get_connection") as get_connection:
            get_connection.return_value.in_atomic_block = False
            with self.assertLogs("credits.events", level="WARNING") as journal:
                emettre_commission(
                    amount=Decimal("15"), currency="USD",
                    reference="COM-HORS-TX", application=app,
                )
        self.assertTrue(any("HORS transaction" in ligne for ligne in journal.output))

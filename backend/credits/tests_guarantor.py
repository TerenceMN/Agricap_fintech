"""Caution solidaire opposable — les sept règles, le consentement, la décote.

Ce que ces tests verrouillent, et pourquoi :

  - **chaque règle en refus ET en cas nominal.** Une règle testée seulement en
    refus peut être un `raise` inconditionnel : le test passerait et plus aucune
    caution ne serait posable. Le cas nominal est la moitié du contrat.
  - **le code d'erreur, pas le message.** Le front route sur `code` ; une
    reformulation ne doit rien casser (même discipline que `tests_guarantee_codes`).
  - **l'immuabilité de `consent_meta`** : c'est la pièce probante d'une caution
    appelée. Si elle est réécrivable, elle ne prouve rien.
"""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from credits.models import CreditApplication, CreditGuarantee, ImmutableConsentMeta


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _user(sub: str, name: str = ""):
    from accounts.models import FintechUser
    user, _ = FintechUser.objects.get_or_create(
        sub=sub, defaults={"full_name": name or sub, "phone": f"+243{sub[-9:].zfill(9)}"},
    )
    return user


def _group(name: str, *members):
    from savings.models import SavingsGroup, SavingsGroupMember
    group = SavingsGroup.objects.create(name=name)
    for m in members:
        SavingsGroupMember.objects.create(group=group, user=m)
    return group


def _savings(user, montant: str):
    from savings.models import SavingsPlan
    return SavingsPlan.objects.create(
        user=user, name=f"Plan {user.pk}", balance=Decimal(montant),
        currency="USD", status=SavingsPlan.Status.ACTIF,
    )


def _config(**overrides):
    """Config institution active — les seuils viennent de la base (principe 8)."""
    from referentiel.models import InstitutionConfig
    InstitutionConfig.objects.all().delete()
    return InstitutionConfig.objects.create(is_active=True, **overrides)


_SEQ = {"n": 0}


def _app(client_user, montant: str = "1000") -> CreditApplication:
    _SEQ["n"] += 1
    return CreditApplication.objects.create(
        code=f"CRED-TEST-CAUT-{_SEQ['n']:04d}",
        client=client_user,
        amount_requested=Decimal(montant),
        currency="USD",
        status=CreditApplication.Status.DRAFT,
    )


def _designate(app, guarantor, montant: str = "500", by: str = "sub-agent"):
    from credits.guarantees import register_moral_guarantee
    return register_moral_guarantee(
        application=app,
        guarantor_name=guarantor.full_name,
        guarantor_phone="+243900000000",
        guarantor_id_number="CNI-0001",
        registered_by_sub=by,
        guarantor_sub=str(guarantor.pk),
        montant_couvert=Decimal(montant),
    )


class GuarantorRulesTestCase(TestCase):
    """Socle : un demandeur et un garant du même groupe, garant solvable."""

    def setUp(self):
        _config()
        self.demandeur = _user("sub-demandeur", "Marie Kabemba")
        self.garant = _user("sub-garant", "Jean Mukendi")
        _group("AVEC Kabare", self.demandeur, self.garant)
        _savings(self.garant, "1000")          # plafond = 2 × 1000 = 2000
        self.app = _app(self.demandeur)

    def _refus(self, **kwargs):
        from credits.guarantor import GuarantorError
        with self.assertRaises(GuarantorError) as ctx:
            _designate(kwargs.pop("app", self.app), kwargs.pop("garant", self.garant),
                       **kwargs)
        return ctx.exception


# ── Règle 1 — appartenance au groupe ──────────────────────────────────────────

class SharedGroupRuleTests(GuarantorRulesTestCase):

    def test_nominal_meme_groupe_accepte(self):
        guarantee = _designate(self.app, self.garant)
        self.assertEqual(guarantee.status, CreditGuarantee.Status.PENDING_CONSENT)
        self.assertEqual(guarantee.guarantor_id, self.garant.pk)

    def test_refus_aucun_groupe_commun(self):
        etranger = _user("sub-etranger", "Paul Etranger")
        _savings(etranger, "5000")
        _group("AVEC Bukavu", etranger)
        exc = self._refus(garant=etranger)
        self.assertEqual(exc.code, "GUARANTOR_NOT_IN_GROUP")

    def test_refus_garant_sans_aucun_groupe(self):
        isole = _user("sub-isole")
        _savings(isole, "5000")
        self.assertEqual(self._refus(garant=isole).code, "GUARANTOR_NOT_IN_GROUP")

    def test_cooperative_compte_comme_groupe(self):
        """Un dossier porté par une coopérative accepte ses membres."""
        from savings.models import SavingsGroup
        membre = _user("sub-coop-membre")
        _savings(membre, "2000")
        coop = _group("Coop Ruzizi", self.demandeur, membre)
        SavingsGroup.objects.filter(pk=coop.pk).update(
            type=SavingsGroup.GroupType.COOPERATIVE,
        )
        self.assertIsNotNone(_designate(self.app, membre))


# ── Règle 2 — capacité d'engagement (k × épargne) ─────────────────────────────

class OverextensionRuleTests(GuarantorRulesTestCase):

    def test_nominal_sous_le_plafond(self):
        """Épargne 1000, k = 2 → plafond 2000. Une caution de 1500 passe."""
        self.assertIsNotNone(_designate(self.app, self.garant, montant="1500"))

    def test_refus_au_dessus_du_plafond(self):
        """2001 > 2 × 1000 : refus au premier centime de dépassement."""
        exc = self._refus(montant="2001")
        self.assertEqual(exc.code, "GUARANTOR_OVEREXTENDED")

    def test_le_cumul_des_cautions_vivantes_compte(self):
        """1200 + 900 = 2100 > 2000, alors que chaque caution passe isolément."""
        _designate(self.app, self.garant, montant="1200")
        exc = self._refus(app=_app(self.demandeur), montant="900")
        self.assertEqual(exc.code, "GUARANTOR_OVEREXTENDED")

    def test_k_vient_de_la_configuration_pas_du_code(self):
        """Le comité passe k à 4 : une caution refusée à k = 2 devient possible."""
        exc = self._refus(montant="3000")
        self.assertEqual(exc.code, "GUARANTOR_OVEREXTENDED")

        _config(caution_ratio_epargne=4.0)
        self.assertIsNotNone(_designate(_app(self.demandeur), self.garant,
                                        montant="3000"))

    def test_repli_logge_si_aucune_config(self):
        """Sans config active, k retombe sur 2 — mais le repli est tracé."""
        from referentiel.models import InstitutionConfig
        from credits.guarantor import savings_multiple
        InstitutionConfig.objects.all().delete()
        with self.assertLogs("credits.guarantor", level="WARNING") as logs:
            self.assertEqual(savings_multiple(), Decimal("2"))
        self.assertIn("caution_ratio_epargne", " ".join(logs.output))

    def test_provenance_distingue_un_seuil_decide_d_un_defaut_subi(self):
        """Un k = 2 non décidé fonctionne comme un k = 2 décidé, indéfiniment.

        Le seul garde-fou était un warning loggé — quelque chose que personne ne
        lit tant que rien ne va mal. Contrairement à une rupture de contrat, une
        absence de décision ne finit jamais par se voir toute seule. La
        provenance rend l'état interrogeable, donc affichable par l'onglet
        Référence du backoffice.
        """
        from referentiel.models import InstitutionConfig
        from credits.guarantor import config_provenance

        InstitutionConfig.objects.all().delete()
        subi = config_provenance()
        self.assertEqual(subi["caution_ratio_epargne"]["source"], "fallback")
        self.assertEqual(subi["caution_ratio_epargne"]["value"], Decimal("2"))

        _config(caution_ratio_epargne=1.5)
        decide = config_provenance()
        self.assertEqual(decide["caution_ratio_epargne"]["source"], "config")
        self.assertEqual(decide["caution_ratio_epargne"]["value"], 1.5)
        self.assertEqual(decide["caution_ratio_epargne"]["fallback"], Decimal("2"))

    def test_provenance_couvre_les_quatre_parametres(self):
        from credits.guarantor import CAUTION_PARAMS, config_provenance
        self.assertEqual(set(config_provenance()), set(CAUTION_PARAMS))
        self.assertEqual(len(CAUTION_PARAMS), 4)

    def test_provenance_ne_diverge_pas_de_la_valeur_appliquee(self):
        """L'écran d'administration doit montrer ce qui s'applique vraiment.

        Afficher un défaut différent de celui réellement appliqué serait un
        mensonge pire que l'absence d'écran — d'où la table `CAUTION_PARAMS`
        partagée entre `_param` et `config_provenance`.
        """
        from referentiel.models import InstitutionConfig
        from credits.guarantor import (
            config_provenance, consent_window_hours, max_live_pledges,
            moral_haircut, savings_multiple,
        )
        InstitutionConfig.objects.all().delete()
        prov = config_provenance()
        self.assertEqual(savings_multiple(),
                         Decimal(str(prov["caution_ratio_epargne"]["value"])))
        self.assertEqual(max_live_pledges(),
                         int(prov["caution_max_actives"]["value"]))
        self.assertEqual(consent_window_hours(),
                         int(prov["caution_consent_window_hours"]["value"]))
        self.assertEqual(moral_haircut(),
                         Decimal(str(prov["decote_caution_morale"]["value"])))

    def test_epargne_nulle_interdit_toute_caution(self):
        sans_epargne = _user("sub-sans-epargne")
        _group("AVEC Sans Epargne", self.demandeur, sans_epargne)
        exc = self._refus(garant=sans_epargne, montant="1")
        self.assertEqual(exc.code, "GUARANTOR_OVEREXTENDED")


# ── Règle 3 — nombre de cautions actives ──────────────────────────────────────

class PledgeCountRuleTests(GuarantorRulesTestCase):

    def setUp(self):
        super().setUp()
        _savings(self.garant, "50000")   # capacité large : on isole la règle 3

    def test_nominal_trois_cautions_passent(self):
        for _ in range(3):
            self.assertIsNotNone(_designate(_app(self.demandeur), self.garant,
                                            montant="100"))

    def test_refus_a_la_quatrieme(self):
        for _ in range(3):
            _designate(_app(self.demandeur), self.garant, montant="100")
        exc = self._refus(app=_app(self.demandeur), montant="100")
        self.assertEqual(exc.code, "GUARANTOR_TOO_MANY_PLEDGES")

    def test_une_caution_refusee_libere_une_place(self):
        cautions = [_designate(_app(self.demandeur), self.garant, montant="100")
                    for _ in range(3)]
        from credits.guarantees import record_guarantor_consent
        record_guarantor_consent(cautions[0], str(self.garant.pk), accept=False)
        self.assertIsNotNone(_designate(_app(self.demandeur), self.garant,
                                        montant="100"))

    def test_plafond_vient_de_la_configuration(self):
        _config(caution_max_actives=1)
        _designate(_app(self.demandeur), self.garant, montant="100")
        exc = self._refus(app=_app(self.demandeur), montant="100")
        self.assertEqual(exc.code, "GUARANTOR_TOO_MANY_PLEDGES")


# ── Règle 4 — défaut ──────────────────────────────────────────────────────────

class DefaultRuleTests(GuarantorRulesTestCase):

    def _loan(self, sub: str, status: str):
        from portfolio.models import Loan
        return Loan.objects.create(
            reference=f"CRD-TEST-{sub}-{status}", operator="X",
            borrower_sub=sub, status=status,
        )

    def test_nominal_pret_en_cours_n_empeche_rien(self):
        from portfolio.models import Loan
        self._loan(str(self.garant.pk), Loan.Status.EN_COURS)
        self.assertIsNotNone(_designate(self.app, self.garant))

    def test_refus_pret_en_defaut(self):
        from portfolio.models import Loan
        self._loan(str(self.garant.pk), Loan.Status.DEFAUT)
        self.assertEqual(self._refus().code, "GUARANTOR_IN_DEFAULT")

    def test_refus_pret_bloque(self):
        from portfolio.models import Loan
        self._loan(str(self.garant.pk), Loan.Status.BLOQUE)
        self.assertEqual(self._refus().code, "GUARANTOR_IN_DEFAULT")

    def test_refus_caution_appelee_non_soldee(self):
        guarantee = _designate(_app(self.demandeur), self.garant, montant="100")
        CreditGuarantee.objects.filter(pk=guarantee.pk).update(
            status=CreditGuarantee.Status.CALLED,
        )
        self.assertEqual(self._refus(app=_app(self.demandeur)).code,
                         "GUARANTOR_IN_DEFAULT")


# ── Règle 5 — caution croisée ─────────────────────────────────────────────────

class CrossGuaranteeRuleTests(GuarantorRulesTestCase):

    def test_nominal_sens_unique_autorise(self):
        self.assertIsNotNone(_designate(self.app, self.garant))

    def test_refus_reciprocite(self):
        """A cautionne B, puis B veut cautionner A : refus."""
        _savings(self.demandeur, "5000")
        _designate(self.app, self.garant, montant="200")          # garant → demandeur

        dossier_du_garant = _app(self.garant)
        from credits.guarantor import GuarantorError
        with self.assertRaises(GuarantorError) as ctx:
            _designate(dossier_du_garant, self.demandeur, montant="200")
        self.assertEqual(ctx.exception.code, "CROSS_GUARANTEE_FORBIDDEN")

    def test_caution_eteinte_ne_bloque_plus(self):
        """Une caution refusée n'est plus vivante : la réciproque redevient licite."""
        _savings(self.demandeur, "5000")
        premiere = _designate(self.app, self.garant, montant="200")
        from credits.guarantees import record_guarantor_consent
        record_guarantor_consent(premiere, str(self.garant.pk), accept=False)

        self.assertIsNotNone(_designate(_app(self.garant), self.demandeur,
                                        montant="200"))


# ── Garant ≠ demandeur, compte actif, garant inconnu ──────────────────────────

class GuarantorIdentityTests(GuarantorRulesTestCase):

    def test_refus_auto_caution(self):
        _savings(self.demandeur, "5000")
        self.assertEqual(self._refus(garant=self.demandeur).code,
                         "GUARANTOR_IS_APPLICANT")

    def test_refus_sub_inconnu(self):
        from credits.guarantees import register_moral_guarantee
        from credits.guarantor import GuarantorError
        with self.assertRaises(GuarantorError) as ctx:
            register_moral_guarantee(
                application=self.app, guarantor_name="Fantôme",
                guarantor_phone="+243900000000", guarantor_id_number="CNI-X",
                registered_by_sub="sub-agent", guarantor_sub="sub-inexistant",
            )
        self.assertEqual(ctx.exception.code, "GUARANTOR_UNKNOWN")

    def test_refus_sans_sub_garant(self):
        """Une caution purement déclarative n'est plus enregistrable."""
        from credits.guarantees import register_moral_guarantee
        from credits.guarantor import GuarantorError
        with self.assertRaises(GuarantorError) as ctx:
            register_moral_guarantee(
                application=self.app, guarantor_name="Sans compte",
                guarantor_phone="+243900000000", guarantor_id_number="CNI-Y",
                registered_by_sub="sub-agent",
            )
        self.assertEqual(ctx.exception.code, "GUARANTOR_UNKNOWN")

    def test_refus_compte_staff_suspendu(self):
        from rbac.models import StaffProfile
        StaffProfile.objects.create(user=self.garant, status=StaffProfile.Status.SUSPENDU)
        self.assertEqual(self._refus().code, "GUARANTOR_ACCOUNT_INACTIVE")


# ── Consentement ──────────────────────────────────────────────────────────────

class ConsentFlowTests(GuarantorRulesTestCase):

    def _consent(self, guarantee, accept=True, by=None, **kwargs):
        from credits.guarantees import record_guarantor_consent
        return record_guarantor_consent(
            guarantee, responder_sub=by or str(self.garant.pk),
            accept=accept, **kwargs,
        )

    def test_acceptation_horodatee_et_tracee(self):
        guarantee = _designate(self.app, self.garant)
        self._consent(guarantee, ip="41.243.1.1")
        guarantee.refresh_from_db()

        self.assertEqual(guarantee.status, CreditGuarantee.Status.CONSENTED)
        meta = guarantee.consent_meta
        self.assertEqual(meta["decision"], "accepted")
        self.assertEqual(meta["ip"], "41.243.1.1")
        self.assertEqual(meta["bySub"], str(self.garant.pk))
        self.assertEqual(meta["channel"], "app")
        self.assertTrue(meta["at"])

    def test_refus_enregistre_declined(self):
        guarantee = _designate(self.app, self.garant)
        self._consent(guarantee, accept=False)
        guarantee.refresh_from_db()
        self.assertEqual(guarantee.status, CreditGuarantee.Status.DECLINED)
        self.assertEqual(guarantee.consent_meta["decision"], "declined")

    def test_journalisation_dans_la_meme_transaction(self):
        from audit.models import AuditEntry
        guarantee = _designate(self.app, self.garant)
        self._consent(guarantee)
        self.assertTrue(
            AuditEntry.objects.filter(
                action="credit.guarantee.consent_accepted",
                entity_type="CreditGuarantee", entity_id=str(guarantee.pk),
                actor=str(self.garant.pk),
            ).exists()
        )

    def test_un_tiers_ne_consent_pas_a_la_place_du_garant(self):
        from credits.guarantor import GuarantorError
        guarantee = _designate(self.app, self.garant)
        with self.assertRaises(GuarantorError) as ctx:
            self._consent(guarantee, by=str(self.demandeur.pk))
        self.assertEqual(ctx.exception.code, "GUARANTOR_NOT_DESIGNATED")
        self.assertEqual(ctx.exception.http_status, 403)

    def test_consentement_non_rejouable(self):
        from credits.guarantor import GuarantorError
        guarantee = _designate(self.app, self.garant)
        self._consent(guarantee)
        guarantee.refresh_from_db()
        with self.assertRaises(GuarantorError) as ctx:
            self._consent(guarantee, accept=False)
        self.assertEqual(ctx.exception.code, "GUARANTOR_ALREADY_ANSWERED")

    def test_consentement_expire(self):
        from credits.guarantor import GuarantorError
        guarantee = _designate(self.app, self.garant)
        CreditGuarantee.objects.filter(pk=guarantee.pk).update(
            consent_expires_at=timezone.now() - timezone.timedelta(hours=1),
        )
        guarantee.refresh_from_db()

        with self.assertRaises(GuarantorError) as ctx:
            self._consent(guarantee)
        self.assertEqual(ctx.exception.code, "GUARANTOR_CONSENT_EXPIRED")
        self.assertEqual(ctx.exception.http_status, 410)

        guarantee.refresh_from_db()
        self.assertEqual(guarantee.status, CreditGuarantee.Status.EXPIRED)

    def test_fenetre_vient_de_la_configuration(self):
        _config(caution_consent_window_hours=24)
        guarantee = _designate(self.app, self.garant)
        delta = guarantee.consent_expires_at - guarantee.created_at
        self.assertAlmostEqual(delta.total_seconds() / 3600, 24, delta=0.1)

    def test_capacite_revérifiee_au_consentement(self):
        """La situation du garant s'est dégradée entre la désignation et son clic.

        Scénario réel : la caution est valide à la désignation (1 500 ≤ 2 × 1 000),
        puis le garant retire son épargne. Au moment où il clique, il n'a plus la
        capacité qu'on lui a prêtée. C'est le consentement qui forme
        l'engagement — c'est donc là que la capacité doit être vraie.
        """
        from credits.guarantor import GuarantorError
        from savings.models import SavingsPlan

        guarantee = _designate(self.app, self.garant, montant="1500")

        SavingsPlan.objects.filter(user=self.garant).update(balance=Decimal("500"))

        with self.assertRaises(GuarantorError) as ctx:
            self._consent(guarantee)
        self.assertEqual(ctx.exception.code, "GUARANTOR_OVEREXTENDED")

    def test_defaut_survenu_apres_la_designation_bloque_le_consentement(self):
        from credits.guarantor import GuarantorError
        from portfolio.models import Loan
        guarantee = _designate(self.app, self.garant)
        Loan.objects.create(reference="CRD-DEF-1", operator="X",
                            borrower_sub=str(self.garant.pk),
                            status=Loan.Status.DEFAUT)
        with self.assertRaises(GuarantorError) as ctx:
            self._consent(guarantee)
        self.assertEqual(ctx.exception.code, "GUARANTOR_IN_DEFAULT")

    def test_expiration_est_persistee_malgre_le_refus(self):
        """Le `raise` ne doit pas annuler le passage en `expired`.

        Régression réelle : la fonction était intégralement `@transaction.atomic`,
        donc l'écriture d'expiration était annulée par l'exception qui la suivait.
        La demande restait `pending_consent` indéfiniment.
        """
        from credits.guarantor import GuarantorError
        guarantee = _designate(self.app, self.garant)
        CreditGuarantee.objects.filter(pk=guarantee.pk).update(
            consent_expires_at=timezone.now() - timezone.timedelta(hours=1),
        )
        guarantee.refresh_from_db()
        with self.assertRaises(GuarantorError):
            self._consent(guarantee)
        self.assertEqual(
            CreditGuarantee.objects.get(pk=guarantee.pk).status,
            CreditGuarantee.Status.EXPIRED,
        )

    def test_la_caution_ne_se_compte_pas_elle_meme(self):
        """Sans `exclude_pk`, une caution à 1500 sur un plafond de 2000 se refuserait."""
        guarantee = _designate(self.app, self.garant, montant="1500")
        self._consent(guarantee)
        guarantee.refresh_from_db()
        self.assertEqual(guarantee.status, CreditGuarantee.Status.CONSENTED)

    def test_refus_ne_revérifie_pas_la_capacite(self):
        """On n'empêche jamais quelqu'un de REFUSER de s'engager."""
        guarantee = _designate(self.app, self.garant, montant="1500")
        _config(caution_ratio_epargne=0.0)     # plus aucune capacité
        self._consent(guarantee, accept=False)
        guarantee.refresh_from_db()
        self.assertEqual(guarantee.status, CreditGuarantee.Status.DECLINED)


class GuarantorNotificationTests(GuarantorRulesTestCase):
    """Un garant non joignable est un garant qui n'engagera rien.

    Signalé par l'agent front : rien ne pointait vers l'écran garant. Une
    notification sans chemin laisse la fenêtre expirer faute d'accès, pas faute
    de décision.
    """

    def test_la_designation_notifie_le_garant(self):
        from notifications.models import Notification
        _designate(self.app, self.garant, montant="400")
        notif = Notification.objects.get(user=self.garant)
        self.assertEqual(notif.title, "Demande de caution solidaire")
        self.assertFalse(notif.read)

    def test_la_notification_porte_le_chemin_de_l_ecran(self):
        from credits.guarantees import GUARANTEE_REQUESTS_PATH
        from notifications.models import Notification
        _designate(self.app, self.garant)
        self.assertIn(GUARANTEE_REQUESTS_PATH,
                      Notification.objects.get(user=self.garant).body)

    def test_la_notification_enonce_l_engagement_en_clair(self):
        """« C'est un acte juridique, pas un clic social » (SPEC §2.5)."""
        from notifications.models import Notification
        _designate(self.app, self.garant, montant="400")
        body = Notification.objects.get(user=self.garant).body
        self.assertIn("400", body)
        self.assertIn(self.demandeur.full_name, body)
        self.assertIn("solidairement", body)

    def test_le_demandeur_n_est_pas_notifie_a_la_place_du_garant(self):
        from notifications.models import Notification
        _designate(self.app, self.garant)
        self.assertFalse(Notification.objects.filter(user=self.demandeur).exists())

    def test_une_caution_refusee_a_la_pose_ne_notifie_personne(self):
        from notifications.models import Notification
        etranger = _user("sub-non-notifie")
        _savings(etranger, "9000")
        self._refus(garant=etranger)
        self.assertFalse(Notification.objects.filter(user=etranger).exists())

    def test_un_garant_staff_est_notifie_comme_un_garant_client(self):
        """Un salarié peut cautionner un membre de son groupe.

        Signalé par l'agent front : l'entrée de menu vers l'écran garant n'existe
        que pour le bucket `client`, donc un garant staff n'atteint l'écran que
        par URL. La notification in-app portant le chemin est alors son SEUL
        accès — d'où ce test, qui vérifie qu'elle lui parvient réellement au lieu
        de le supposer.
        """
        from credits.guarantees import GUARANTEE_REQUESTS_PATH
        from notifications.models import Notification
        from rbac.models import StaffProfile

        salarie = _user("sub-garant-staff", "Agent Garant")
        StaffProfile.objects.create(user=salarie, status=StaffProfile.Status.ACTIF)
        _group("AVEC Mixte", self.demandeur, salarie)
        _savings(salarie, "5000")

        _designate(_app(self.demandeur), salarie, montant="300")

        notif = Notification.objects.get(user=salarie)
        self.assertIn(GUARANTEE_REQUESTS_PATH, notif.body)


class ConsentMetaImmutabilityTests(GuarantorRulesTestCase):

    def test_consent_meta_non_reecrivable(self):
        from credits.guarantees import record_guarantor_consent
        guarantee = _designate(self.app, self.garant)
        record_guarantor_consent(guarantee, str(self.garant.pk), accept=True)

        relu = CreditGuarantee.objects.get(pk=guarantee.pk)
        relu.consent_meta = {"decision": "accepted", "ip": "0.0.0.0"}
        with self.assertRaises(ImmutableConsentMeta):
            relu.save()

    def test_consent_meta_non_effacable(self):
        from credits.guarantees import record_guarantor_consent
        guarantee = _designate(self.app, self.garant)
        record_guarantor_consent(guarantee, str(self.garant.pk), accept=True)

        relu = CreditGuarantee.objects.get(pk=guarantee.pk)
        relu.consent_meta = {}
        with self.assertRaises(ImmutableConsentMeta):
            relu.save()

    def test_autres_champs_restent_modifiables(self):
        from credits.guarantees import record_guarantor_consent
        guarantee = _designate(self.app, self.garant)
        record_guarantor_consent(guarantee, str(self.garant.pk), accept=True)

        relu = CreditGuarantee.objects.get(pk=guarantee.pk)
        relu.notes = "Pièces relevées en agence"
        relu.save()
        self.assertEqual(CreditGuarantee.objects.get(pk=guarantee.pk).notes,
                         "Pièces relevées en agence")


# ── Constitution et blocage à la soumission ───────────────────────────────────

class ConstitutionTests(GuarantorRulesTestCase):

    def test_constitution_impossible_sans_consentement(self):
        from credits.guarantees import confirm_moral_guarantee
        from credits.guarantor import GuarantorError
        guarantee = _designate(self.app, self.garant)
        with self.assertRaises(GuarantorError) as ctx:
            confirm_moral_guarantee(guarantee, confirmer_sub="sub-agent")
        self.assertEqual(ctx.exception.code, "GUARANTOR_CONSENT_MISSING")

    def test_constitution_apres_consentement(self):
        from credits.guarantees import confirm_moral_guarantee, record_guarantor_consent
        guarantee = _designate(self.app, self.garant)
        record_guarantor_consent(guarantee, str(self.garant.pk), accept=True)
        guarantee.refresh_from_db()
        confirm_moral_guarantee(guarantee, confirmer_sub="sub-agent")
        guarantee.refresh_from_db()
        self.assertEqual(guarantee.status, CreditGuarantee.Status.ACTIVE)

    def test_constitution_impossible_apres_refus(self):
        from credits.guarantees import confirm_moral_guarantee, record_guarantor_consent
        from credits.guarantor import GuarantorError
        guarantee = _designate(self.app, self.garant)
        record_guarantor_consent(guarantee, str(self.garant.pk), accept=False)
        guarantee.refresh_from_db()
        with self.assertRaises(GuarantorError) as ctx:
            confirm_moral_guarantee(guarantee, confirmer_sub="sub-agent")
        self.assertEqual(ctx.exception.code, "GUARANTOR_CONSENT_MISSING")


class SubmitGateTests(GuarantorRulesTestCase):

    def _submittable(self):
        from credits.tests import _ensure_scoring_criteria
        from credits.tests_guarantees import _chain
        _ensure_scoring_criteria()
        app = _app(self.demandeur)
        app.value_chain = _chain(f"MAIS_G{_SEQ['n']}", ["morale"])
        app.area_ha = Decimal("2")
        app.save(update_fields=["value_chain", "area_ha"])
        return app

    def _codes(self, app):
        from credits.workflow import WorkflowError, submit
        with self.assertRaises(WorkflowError) as ctx:
            submit(app, submitter_sub="sub-agent")
        return [e["code"] for e in ctx.exception.as_errors()]

    def test_submit_bloque_sur_caution_non_consentie(self):
        app = self._submittable()
        _designate(app, self.garant)
        self.assertIn("GUARANTOR_CONSENT_MISSING", self._codes(app))

    def test_submit_bloque_sur_caution_refusee(self):
        from credits.guarantees import record_guarantor_consent
        app = self._submittable()
        guarantee = _designate(app, self.garant)
        record_guarantor_consent(guarantee, str(self.garant.pk), accept=False)
        self.assertIn("GUARANTOR_CONSENT_MISSING", self._codes(app))

    def test_submit_bloque_sur_caution_expiree(self):
        app = self._submittable()
        guarantee = _designate(app, self.garant)
        CreditGuarantee.objects.filter(pk=guarantee.pk).update(
            status=CreditGuarantee.Status.EXPIRED,
        )
        self.assertIn("GUARANTOR_CONSENT_MISSING", self._codes(app))

    def test_submit_passe_apres_consentement(self):
        from credits.guarantees import record_guarantor_consent
        from credits.workflow import submit
        app = self._submittable()
        guarantee = _designate(app, self.garant)
        record_guarantor_consent(guarantee, str(self.garant.pk), accept=True)

        submit(app, submitter_sub="sub-agent")
        app.refresh_from_db()
        self.assertEqual(app.status, CreditApplication.Status.SUBMITTED)


# ── Décote de 70 % ────────────────────────────────────────────────────────────

class MoralHaircutTests(GuarantorRulesTestCase):

    def _constituted(self, montant="1000"):
        from credits.guarantees import confirm_moral_guarantee, record_guarantor_consent
        _savings(self.garant, "10000")
        guarantee = _designate(self.app, self.garant, montant=montant)
        record_guarantor_consent(guarantee, str(self.garant.pk), accept=True)
        guarantee.refresh_from_db()
        confirm_moral_guarantee(guarantee, confirmer_sub="sub-agent")
        guarantee.refresh_from_db()
        return guarantee

    def test_caution_de_1000_couvre_300(self):
        """Décote 70 % : 1 000 engagés → 300 retenus en couverture."""
        guarantee = self._constituted("1000")
        self.assertEqual(guarantee.retained_coverage, Decimal("300.00"))

    def test_couverture_du_dossier_applique_la_decote(self):
        from credits.guarantees import get_guarantee_summary
        self._constituted("1000")
        coverage = get_guarantee_summary(self.app)["coverage"]
        # Dossier de 1 000 USD couvert par une caution de 1 000 → ratio 0,3.
        self.assertEqual(coverage["retainedTotal"], 300.0)
        self.assertEqual(coverage["ratio"], 0.3)

    def test_decote_vient_de_la_configuration(self):
        _config(decote_caution_morale=0.5)
        guarantee = self._constituted("1000")
        self.assertEqual(guarantee.retained_coverage, Decimal("500.00"))

    def test_caution_non_constituee_ne_couvre_rien(self):
        from credits.guarantees import get_guarantee_summary
        _designate(self.app, self.garant, montant="1000")
        self.assertEqual(
            get_guarantee_summary(self.app)["coverage"]["retainedTotal"], 0.0,
        )


# ── Contrat des codes d'erreur ────────────────────────────────────────────────

class GuarantorErrorCodeContractTests(TestCase):
    """Le front branche sur ces codes : ils font partie du contrat d'API."""

    def test_codes_distincts_et_stables(self):
        from credits import guarantor as g
        attendus = {
            g.GuarantorUnknown: ("GUARANTOR_UNKNOWN", 422),
            g.GuarantorIsApplicant: ("GUARANTOR_IS_APPLICANT", 422),
            g.GuarantorAccountInactive: ("GUARANTOR_ACCOUNT_INACTIVE", 422),
            g.GuarantorNotInGroup: ("GUARANTOR_NOT_IN_GROUP", 422),
            g.GuarantorInvalidAmount: ("GUARANTOR_INVALID_AMOUNT", 422),
            g.GuarantorOverextended: ("GUARANTOR_OVEREXTENDED", 422),
            g.GuarantorTooManyPledges: ("GUARANTOR_TOO_MANY_PLEDGES", 422),
            g.GuarantorInDefault: ("GUARANTOR_IN_DEFAULT", 422),
            g.CrossGuaranteeForbidden: ("CROSS_GUARANTEE_FORBIDDEN", 422),
            g.GuarantorConsentMissing: ("GUARANTOR_CONSENT_MISSING", 422),
            g.GuarantorNotDesignated: ("GUARANTOR_NOT_DESIGNATED", 403),
            g.GuarantorAlreadyAnswered: ("GUARANTOR_ALREADY_ANSWERED", 409),
            g.InvalidGuaranteeState: ("INVALID_GUARANTEE_STATE", 409),
            g.GuarantorConsentExpired: ("GUARANTOR_CONSENT_EXPIRED", 410),
        }
        for cls, (code, http) in attendus.items():
            self.assertEqual(cls.code, code)
            self.assertEqual(cls.http_status, http)
            self.assertTrue(issubclass(cls, g.GuarantorError))

        codes = [c for c, _ in attendus.values()]
        self.assertEqual(len(set(codes)), len(codes))

    def test_aucune_regle_ne_sort_le_code_generique(self):
        """`GUARANTOR_ERROR` ne doit jamais atteindre le client.

        Signalé par l'agent front : un code de base intraduisible qui sort en
        production est le signe d'une règle sans identité propre. Ici, le montant
        nul en était une.
        """
        from credits import guarantor as g
        user = _user("sub-montant-nul")
        demandeur = _user("sub-montant-nul-dem")
        _group("AVEC Montant", user, demandeur)
        _savings(user, "5000")
        with self.assertRaises(g.GuarantorError) as ctx:
            g.assert_can_guarantee(_app(demandeur), user, Decimal("0"))
        self.assertNotEqual(ctx.exception.code, "GUARANTOR_ERROR")
        self.assertEqual(ctx.exception.code, "GUARANTOR_INVALID_AMOUNT")

    def test_convention_identique_a_workflow_error(self):
        """`as_errors()` — même contrat structuré que `WorkflowError` (principe 6)."""
        from credits.guarantor import GuarantorNotInGroup
        exc = GuarantorNotInGroup("pas de groupe commun")
        self.assertEqual(exc.as_errors(),
                         [{"code": "GUARANTOR_NOT_IN_GROUP",
                           "message": "pas de groupe commun"}])

    def test_les_statuts_historiques_survivent(self):
        """L'extension n'a pas cassé les codes utilisés par l'épargne et les gages."""
        for code in ("pending", "active", "released", "expired"):
            self.assertIn(code, CreditGuarantee.Status.values)
        for code in ("pending_consent", "consented", "declined", "called"):
            self.assertIn(code, CreditGuarantee.Status.values)

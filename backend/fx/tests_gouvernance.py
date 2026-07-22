"""Gouvernance du taux de change — HAZINA principe 5 (un taux par jour ET par usage,
historisé, maker ≠ checker au-delà d'un écart paramétré, source tracée, aucune retombée
silencieuse sur la veille).

CAS CHIFFRÉ DE RÉFÉRENCE (rejoué par les tests de seuil)
--------------------------------------------------------
Veille (J-1) : achat 2 790 · vente 2 800.
Seuil de maker-checker : 2 % (valeur de repli, aucun `InstitutionConfig` en test).
L'écart retenu est le MAX des écarts relatifs sur les deux jambes.

  a) Saisie du jour 2 810 / 2 828
     achat : 20 / 2 790 = 0,7168 %   vente : 28 / 2 800 = 1,0000 %
     écart retenu = 1,0000 %  ≤ 2 %          → ACTIF immédiatement, aucun second acteur.

  b) Saisie du jour 2 790 / 2 900
     achat : 0 %                     vente : 100 / 2 800 = 3,5714 %
     écart retenu = 3,5714 %  > 2 %          → EN_ATTENTE : la conversion continue
                                               d'utiliser le taux de la veille jusqu'à
                                               validation par un second acteur, avec motif.

  c) Saisie du jour 2 845,80 / 2 856 (pile au seuil)
     achat : 55,80 / 2 790 = 2,0000 %  vente : 56 / 2 800 = 2,0000 %
     écart retenu = 2,0000 %  = 2 %          → ACTIF (le seuil n'est pas DÉPASSÉ).
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import Mock, patch

from common.exceptions import ConflictError, NotFoundError, ValidationFailed
from common.testing import AuthedAPITestCase

from . import services
from .models import ExchangeRate
from .tests import _BCC_HTML_SAMPLE

VEILLE = date(2026, 3, 10)
JOUR = date(2026, 3, 11)


class SeuilMakerCheckerTests(AuthedAPITestCase):
    def _veille(self) -> ExchangeRate:
        return services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                  effective_date=VEILLE, by="maker", source="BCC")

    def test_ecart_sous_le_seuil_passe_sans_second_acteur(self):
        self._veille()
        rate = services.set_rate(tier="BCC", currency="USD", buy="2810", sell="2828",
                                  effective_date=JOUR, by="maker", source="BCC")
        self.assertEqual(rate.status, ExchangeRate.Status.ACTIF)
        self.assertEqual(rate.variation_pct, Decimal("1.0000"))
        self.assertEqual(rate.threshold_pct, Decimal("2.0"))
        self.assertEqual(services.taux_du_jour(date_taux=JOUR).pk, rate.pk)

    def test_ecart_au_dela_du_seuil_exige_un_second_acteur(self):
        veille = self._veille()
        rate = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2900",
                                  effective_date=JOUR, by="maker", source="BCC",
                                  reason="Décrochage constaté sur le marché de Kinshasa.")
        self.assertEqual(rate.status, ExchangeRate.Status.EN_ATTENTE)
        self.assertEqual(rate.variation_pct, Decimal("3.5714"))
        self.assertEqual(rate.reference_rate_id, veille.pk)

        # Tant qu'il n'est pas validé, ce taux n'existe pour AUCUNE conversion.
        with self.assertRaises(NotFoundError) as ctx:
            services.taux_du_jour(date_taux=JOUR)
        self.assertIn("EN ATTENTE", str(ctx.exception))
        self.assertEqual(services.current_rate(tier="BCC", currency="USD", on=JOUR).pk, veille.pk)

    def test_ecart_exactement_au_seuil_passe(self):
        self._veille()
        rate = services.set_rate(tier="BCC", currency="USD", buy="2845.80", sell="2856",
                                  effective_date=JOUR, by="maker", source="BCC")
        self.assertEqual(rate.variation_pct, Decimal("2.0000"))
        self.assertEqual(rate.status, ExchangeRate.Status.ACTIF)

    def test_motif_obligatoire_au_dela_du_seuil(self):
        self._veille()
        with self.assertRaises(ValidationFailed) as ctx:
            services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2900",
                               effective_date=JOUR, by="maker", source="BCC")
        self.assertIn("motif", str(ctx.exception).lower())

    def test_seuil_lu_dans_institution_config_et_non_en_dur(self):
        from referentiel.models import InstitutionConfig
        InstitutionConfig.objects.all().delete()
        InstitutionConfig.objects.create(is_active=True, raw={"fx_seuil_variation_pct": "5"})
        self._veille()
        rate = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2900",
                                  effective_date=JOUR, by="maker", source="BCC")
        # Le MÊME écart (3,5714 %) qui exigeait un checker sous un seuil de 2 % passe seul
        # sous un seuil de 5 % : le contrôle vit en base, pas dans le code (principe 8).
        self.assertEqual(rate.status, ExchangeRate.Status.ACTIF)
        self.assertEqual(rate.threshold_pct, Decimal("5"))

    def test_premier_taux_sans_reference_ne_declenche_pas_de_checker(self):
        rate = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                  effective_date=JOUR, by="maker", source="BCC")
        self.assertIsNone(rate.variation_pct)
        self.assertEqual(rate.status, ExchangeRate.Status.ACTIF)


class ValidationSecondActeurTests(AuthedAPITestCase):
    def setUp(self):
        super().setUp()
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=VEILLE, by="seed", source="BCC")
        self.en_attente = services.set_rate(
            tier="BCC", currency="USD", buy="2790", sell="2900", effective_date=JOUR,
            by="maker", source="BCC", reason="Décrochage constaté.")

    def test_maker_ne_peut_pas_valider_son_propre_taux(self):
        with self.assertRaises(ValidationFailed) as ctx:
            services.validate_rate(rate_id=self.en_attente.pk, by="maker", reason="Je confirme.")
        self.assertIn("checker", str(ctx.exception).lower())

    def test_validation_exige_un_valideur_identifie(self):
        with self.assertRaises(ValidationFailed):
            services.validate_rate(rate_id=self.en_attente.pk, by="", reason="ok")

    def test_validation_exige_un_motif(self):
        with self.assertRaises(ValidationFailed):
            services.validate_rate(rate_id=self.en_attente.pk, by="checker", reason="")

    def test_validation_par_second_acteur_active_le_taux(self):
        valide = services.validate_rate(rate_id=self.en_attente.pk, by="checker",
                                         reason="Cours confirmé sur la publication BCC du jour.")
        self.assertEqual(valide.status, ExchangeRate.Status.ACTIF)
        self.assertEqual(valide.validated_by, "checker")
        self.assertIsNotNone(valide.validated_at)
        self.assertEqual(services.taux_du_jour(date_taux=JOUR).pk, self.en_attente.pk)

    def test_rejet_laisse_le_taux_precedent_en_vigueur(self):
        rejete = services.validate_rate(
            rate_id=self.en_attente.pk, by="checker", approve=False,
            reason="Cours non confirmé par la publication officielle.")
        self.assertEqual(rejete.status, ExchangeRate.Status.REJETE)
        courant = services.current_rate(tier="BCC", currency="USD", on=JOUR)
        self.assertEqual(courant.effective_date, VEILLE)
        # Un taux rejeté reste lisible : c'est une tentative datée, pas un non-événement.
        self.assertTrue(ExchangeRate.objects.filter(pk=self.en_attente.pk).exists())

    def test_double_validation_impossible(self):
        services.validate_rate(rate_id=self.en_attente.pk, by="checker", reason="ok")
        with self.assertRaises(ConflictError):
            services.validate_rate(rate_id=self.en_attente.pk, by="checker2", reason="ok")

    def test_un_seul_taux_en_attente_a_la_fois(self):
        with self.assertRaises(ConflictError):
            services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2950",
                               effective_date=JOUR, by="maker2", source="BCC", reason="m2")


class HistorisationTests(AuthedAPITestCase):
    def test_correction_cree_une_version_et_conserve_lancienne(self):
        v1 = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                effective_date=JOUR, by="maker", source="BCC")
        v2 = services.set_rate(tier="BCC", currency="USD", buy="2795", sell="2810",
                                effective_date=JOUR, by="maker", source="BCC",
                                reason="Correction : coquille de saisie.")
        v1.refresh_from_db()
        self.assertEqual((v1.version, v2.version), (1, 2))
        self.assertEqual(v1.status, ExchangeRate.Status.REMPLACE)
        self.assertIsNotNone(v1.superseded_at)
        self.assertEqual(v2.supersedes_id, v1.pk)
        self.assertEqual(v2.status, ExchangeRate.Status.ACTIF)
        self.assertEqual(v1.sell_rate, Decimal("2800.000000"))  # l'ancienne reste lisible
        self.assertEqual(services.taux_du_jour(date_taux=JOUR).pk, v2.pk)

    def test_correction_massive_du_jour_exige_aussi_un_checker(self):
        """Une correction se mesure contre le taux QU'ELLE REMPLACE, pas contre la veille :
        sinon on remplacerait le taux du jour par n'importe quoi sans contrôle."""
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=JOUR, by="maker", source="BCC")
        v2 = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2900",
                                effective_date=JOUR, by="maker", source="BCC",
                                reason="Correction massive.")
        self.assertEqual(v2.status, ExchangeRate.Status.EN_ATTENTE)
        self.assertEqual(v2.variation_pct, Decimal("3.5714"))

    def test_saisie_identique_ne_cree_pas_de_version(self):
        v1 = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                effective_date=JOUR, by="maker", source="BCC")
        v2 = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                effective_date=JOUR, by="maker", source="BCC")
        self.assertEqual(v1.pk, v2.pk)
        self.assertEqual(ExchangeRate.objects.filter(effective_date=JOUR).count(), 1)

    def test_taux_enregistre_ne_se_modifie_pas_sur_place(self):
        rate = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                  effective_date=JOUR, by="maker", source="BCC")
        rate.sell_rate = Decimal("2900")
        with self.assertRaises(ValidationFailed):
            rate.save()

    def test_taux_ne_se_supprime_pas(self):
        rate = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                  effective_date=JOUR, by="maker", source="BCC")
        with self.assertRaises(ValidationFailed):
            rate.delete()


class UsageTests(AuthedAPITestCase):
    def test_operationnel_et_cloture_coexistent_le_meme_jour(self):
        op = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                effective_date=JOUR, by="maker", source="BCC",
                                usage=ExchangeRate.Usage.OPERATIONNEL)
        clo = services.set_rate(tier="BCC", currency="USD", buy="2800", sell="2810",
                                 effective_date=JOUR, by="maker", source="BCC",
                                 usage=ExchangeRate.Usage.CLOTURE)
        self.assertNotEqual(op.pk, clo.pk)
        self.assertEqual(services.closing_rate(on=JOUR).pk, clo.pk)
        self.assertEqual(services.taux_du_jour(date_taux=JOUR).pk, op.pk)

    def test_taux_de_cloture_absent_ne_retombe_pas_sur_loperationnel(self):
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=JOUR, by="maker", source="BCC")
        with self.assertRaises(NotFoundError):
            services.closing_rate(on=JOUR)

    def test_seuil_mesure_par_usage(self):
        """Deux séries distinctes : comparer une clôture à l'opérationnel du même jour
        déclencherait des maker-checker fantômes."""
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=VEILLE, by="maker", source="BCC")
        clo = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2900",
                                 effective_date=VEILLE, by="maker", source="BCC",
                                 usage=ExchangeRate.Usage.CLOTURE)
        self.assertIsNone(clo.variation_pct)
        self.assertEqual(clo.status, ExchangeRate.Status.ACTIF)

    def test_usage_inconnu_refuse(self):
        with self.assertRaises(ValidationFailed):
            services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                               effective_date=JOUR, by="maker", usage="MOYENNE_DU_MOIS")


class AucuneRetombeeSilencieuseTests(AuthedAPITestCase):
    def setUp(self):
        super().setUp()
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=VEILLE, by="seed", source="BCC")

    def test_lecture_stricte_refuse_la_veille(self):
        with self.assertRaises(NotFoundError):
            services.taux_du_jour(date_taux=JOUR)

    def test_lecture_tolerante_signale_la_retombee(self):
        rate, meta = services.resolve_rate(tier="BCC", currency="USD", on=JOUR)
        self.assertEqual(rate.effective_date, VEILLE)
        self.assertTrue(meta["stale"])
        self.assertEqual(meta["stalenessDays"], 1)
        self.assertEqual(meta["askedFor"], JOUR.isoformat())

    def test_retombee_refusee_au_dela_de_la_tolerance(self):
        with self.assertRaises(NotFoundError):
            services.resolve_rate(tier="BCC", currency="USD", on=JOUR, max_staleness_days=0)

    def test_absence_totale_de_taux_est_une_erreur_pas_un_defaut(self):
        with self.assertRaises(NotFoundError):
            services.resolve_rate(tier="CLIENT", currency="ZAR", on=JOUR)


class SourceTests(AuthedAPITestCase):
    def test_source_tracee_sur_chaque_taux(self):
        rate = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                  effective_date=JOUR, by="maker",
                                  source=ExchangeRate.Source.AGREGATEUR,
                                  source_reference="feed-partenaire#42")
        self.assertEqual(rate.source, "AGREGATEUR")
        self.assertEqual(rate.source_reference, "feed-partenaire#42")

    def test_source_inconnue_refusee(self):
        with self.assertRaises(ValidationFailed):
            services.set_rate(tier="BCC", currency="EUR", buy="2790", sell="2800",
                               effective_date=JOUR, by="maker", source="RUMEUR")

    @patch("fx.services.requests.get")
    def test_sync_bcc_trace_sa_source(self, mock_get):
        mock_get.return_value = Mock(status_code=200, text=_BCC_HTML_SAMPLE)
        rates = services.fetch_bcc_rates(by="job")
        self.assertTrue(all(r.source == "BCC" for r in rates))
        self.assertTrue(all(r.source_reference == services.BCC_RATES_URL for r in rates))

    @patch("fx.services.requests.get")
    def test_sync_bcc_au_dela_du_seuil_attend_un_second_acteur(self, mock_get):
        """Un mouvement violent ne s'applique pas tout seul parce qu'il vient de la BCC :
        un décrochage du franc est exactement le moment où l'institution doit décider."""
        from django.utils import timezone
        veille = timezone.localdate() - timedelta(days=1)
        services.set_rate(tier="BCC", currency="USD", buy="2000", sell="2010",
                           effective_date=veille, by="seed", source="BCC")
        mock_get.return_value = Mock(status_code=200, text=_BCC_HTML_SAMPLE)
        rates = services.fetch_bcc_rates(by="job")
        usd = next(r for r in rates if r.currency == "USD")  # 2 252 vs 2 010 → ~ +12 %
        self.assertEqual(usd.status, ExchangeRate.Status.EN_ATTENTE)
        self.assertIn(usd.pk, [r.pk for r in services.pending_rates(currency="USD")])


class ConversionTraceeTests(AuthedAPITestCase):
    """Ce que `credits` doit pouvoir appeler pour cesser d'utiliser un taux de secours."""

    def setUp(self):
        super().setUp()
        self.taux = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                                       effective_date=JOUR, by="maker", source="BCC",
                                       source_reference="bcc.cd/cours-de-change")

    def test_to_usd_convertit_et_journalise_le_taux(self):
        # 2 800 000 CDF au cours vendeur 2 800 → 1 000,00 USD.
        montant, provenance = services.to_usd("2800000", "CDF", on=JOUR)
        self.assertEqual(montant, Decimal("1000.00"))
        self.assertEqual(provenance["rateId"], self.taux.pk)
        self.assertEqual(provenance["sell"], "2800.000000")
        self.assertEqual(provenance["effectiveDate"], JOUR.isoformat())
        self.assertEqual(provenance["source"], "BCC")
        self.assertFalse(provenance["stale"])

    def test_to_usd_sur_montant_usd_ne_consomme_aucun_taux(self):
        montant, provenance = services.to_usd("1500", "USD", on=JOUR)
        self.assertEqual(montant, Decimal("1500"))
        self.assertIsNone(provenance)

    def test_to_usd_sans_taux_leve_plutot_que_dinventer(self):
        with self.assertRaises(NotFoundError):
            services.to_usd("2800000", "CDF", on=date(2026, 1, 5))

    def test_conversion_ignore_un_taux_en_attente(self):
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="3200",
                           effective_date=JOUR, by="maker", source="BCC",
                           reason="Mouvement à valider.")
        montant, _ = services.to_usd("2800000", "CDF", on=JOUR)
        self.assertEqual(montant, Decimal("1000.00"))  # toujours l'ACTIF, jamais le proposé


class FxApiGouvernanceTests(AuthedAPITestCase):
    def test_saisie_exige_la_capacite_config(self):
        self.login(role="agent_terrain", sub="a1")
        res = self.client.post("/api/fx/rates", {
            "tier": "BCC", "currency": "USD", "buy": "2790", "sell": "2800",
            "effectiveDate": JOUR.isoformat(),
        }, format="json")
        self.assertEqual(res.status_code, 403)

    def test_parcours_saisie_puis_validation_par_un_second_acteur(self):
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=VEILLE, by="seed", source="BCC")

        self.login(role="admin_it", sub="maker-1")
        cree = self.client.post("/api/fx/rates", {
            "tier": "BCC", "currency": "USD", "buy": "2790", "sell": "2900",
            "effectiveDate": JOUR.isoformat(), "usage": "OPERATIONNEL",
            "source": "BCC", "reason": "Décrochage constaté.",
        }, format="json")
        self.assertEqual(cree.status_code, 201)
        self.assertEqual(cree.data["status"], "EN_ATTENTE")
        self.assertTrue(cree.data["requiresValidation"])
        self.assertEqual(cree.data["variationPct"], "3.5714")
        rate_id = cree.data["id"]

        corbeille = self.client.get("/api/fx/rates/pending")
        self.assertEqual(corbeille.status_code, 200)
        self.assertEqual(corbeille.data["totalRows"], 1)
        self.assertEqual(corbeille.data["thresholdPct"], "2.0")

        refus = self.client.post(f"/api/fx/rates/{rate_id}/validate",
                                  {"decision": "approve", "reason": "ok"}, format="json")
        self.assertEqual(refus.status_code, 400)  # maker ≠ checker

        self.login(role="dg", sub="checker-1")
        ok = self.client.post(f"/api/fx/rates/{rate_id}/validate",
                               {"decision": "approve", "reason": "Confirmé sur bcc.cd."},
                               format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.data["status"], "ACTIF")
        self.assertEqual(ok.data["validatedBy"], "checker-1")

    def test_validation_exige_la_capacite_config(self):
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=VEILLE, by="seed", source="BCC")
        en_attente = services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2900",
                                        effective_date=JOUR, by="seed", source="BCC",
                                        reason="Décrochage.")
        self.login(role="agent_terrain", sub="a2")
        res = self.client.post(f"/api/fx/rates/{en_attente.pk}/validate",
                                {"decision": "approve", "reason": "ok"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_liste_ne_sert_que_les_taux_en_vigueur_sauf_demande_explicite(self):
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=JOUR, by="seed", source="BCC")
        services.set_rate(tier="BCC", currency="USD", buy="2795", sell="2810",
                           effective_date=JOUR, by="seed", source="BCC", reason="correction")

        self.login(role="agent_terrain", sub="lecteur")
        courant = self.client.get("/api/fx/rates?currency=USD")
        self.assertEqual([r["version"] for r in courant.data], [2])
        self.assertEqual(courant["X-Total-Rows"], "1")

        historique = self.client.get("/api/fx/rates?currency=USD&history=1")
        self.assertEqual(sorted(r["version"] for r in historique.data), [1, 2])
        self.assertEqual(historique["X-Total-Rows"], "2")

    def test_taux_courant_par_usage_et_fraicheur(self):
        services.set_rate(tier="BCC", currency="USD", buy="2790", sell="2800",
                           effective_date=VEILLE, by="seed", source="BCC")
        services.set_rate(tier="BCC", currency="USD", buy="2800", sell="2815",
                           effective_date=VEILLE, by="seed", source="BCC",
                           usage=ExchangeRate.Usage.CLOTURE)
        self.login(role="agent_terrain", sub="lecteur")

        res = self.client.get(
            f"/api/fx/rates/current?tier=BCC&currency=USD&usage=CLOTURE&on={JOUR.isoformat()}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["usage"], "CLOTURE")
        self.assertEqual(res.data["sell"], 2815.0)
        self.assertTrue(res.data["stale"])
        self.assertEqual(res.data["stalenessDays"], 1)

        absent = self.client.get("/api/fx/rates/current?tier=CLIENT&currency=ZAR&usage=CLOTURE")
        self.assertEqual(absent.status_code, 404)

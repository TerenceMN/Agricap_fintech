"""
Métriques investisseur — Annexe D du prompt HAZINA.

Une seule règle tient tout le fichier : **un chiffre est calculé sur des flux datés
réels, ou il n'est pas affiché.** Il n'y a ici ni simulation, ni lissage, ni moyenne
de taux affichés présentée comme un TRI — le `Math.random()` de la courbe de
performance du prototype est l'anti-modèle explicite.

Conséquences pratiques :

- le rendement réalisé est un **XIRR** sur les encaissements (négatifs) et les
  distributions (positifs), aux dates où ils ont réellement eu lieu ;
- quand il n'y a pas assez de flux pour qu'un XIRR existe (moins de deux flux, ou pas
  de changement de signe : de l'argent versé, rien encore reçu), la valeur retournée
  est `None` avec son motif — jamais 0, jamais une extrapolation ;
- le gain latent est étiqueté latent et porte sa méthode de valorisation ;
- chaque agrégat porte son effectif : pas de moyenne sans effectif, pas de pourcentage
  sans base.

`Decimal` partout : ces chiffres finissent dans un reporting investisseur.
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal, getcontext

from django.db.models import Sum

from .models import (
    Distribution, DistributionLine, InvestmentConfig, Investor, Offer, Project, Subscription,
)

getcontext().prec = 40

CENT = Decimal("0.01")
RATIO = Decimal("0.000001")
DAYS_PER_YEAR = Decimal("365")


def _q(value, exp: Decimal = CENT) -> Decimal:
    return Decimal(value).quantize(exp, rounding=ROUND_HALF_UP)


# ── XIRR ──────────────────────────────────────────────────────────────────────

class XirrUndefined(Exception):
    """Le XIRR n'existe pas sur ce jeu de flux — la raison est portée par le message."""


def xirr(flows: list[tuple[date, Decimal]], *, guess_low: Decimal = Decimal("-0.9999"),
         guess_high: Decimal = Decimal("100")) -> Decimal:
    """Taux de rendement interne sur flux datés irréguliers, résolu par bissection.

    `flows` = [(date, montant)] — montants signés : sortie de trésorerie de
    l'investisseur négative, encaissement positif. Le résultat est un taux annuel
    (base 365 jours réels), quantifié à 1e-6.

    La bissection est préférée à Newton-Raphson : elle ne diverge pas sur les profils
    de flux dégénérés (un gros flux tardif, des flux quasi simultanés), et 200
    itérations sur [-99,99 %, +10 000 %] valent largement la précision utile ici. Un
    TRI faux et rapide n'a aucune valeur ; un TRI juste ou rien en a une.
    """
    if len(flows) < 2:
        raise XirrUndefined("Moins de deux flux : aucun rendement n'est calculable.")
    ordered = sorted(flows, key=lambda f: f[0])
    montants = [Decimal(m) for _, m in ordered]
    if not any(m < 0 for m in montants) or not any(m > 0 for m in montants):
        raise XirrUndefined(
            "Tous les flux vont dans le même sens : le rendement n'existe pas encore "
            "(de l'argent a été investi, rien n'a encore été distribué — ou l'inverse)."
        )
    origine = ordered[0][0]
    jours = [Decimal((d - origine).days) for d, _ in ordered]

    def npv(rate: Decimal) -> Decimal:
        base = Decimal("1") + rate
        total = Decimal("0")
        for montant, j in zip(montants, jours):
            total += montant / (base ** (j / DAYS_PER_YEAR))
        return total

    lo, hi = guess_low, guess_high
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        raise XirrUndefined(
            "Aucun taux dans [-99,99 %, +10 000 %] n'annule la valeur actuelle nette "
            "de ces flux."
        )
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if f_mid == 0:
            return _q(mid, RATIO)
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return _q((lo + hi) / 2, RATIO)


def xirr_or_none(flows: list[tuple[date, Decimal]]) -> tuple[Decimal | None, str]:
    """`(taux, motif)` — `taux` à `None` quand il n'existe pas, avec la raison en clair.

    Le motif est destiné à être AFFICHÉ : « pas encore de distribution » est une
    information honnête, « 0,0 % » serait un mensonge.
    """
    try:
        return xirr(flows), ""
    except XirrUndefined as exc:
        return None, str(exc)


# ── Flux réels ────────────────────────────────────────────────────────────────

def investor_flows(investor: Investor, *, project: Project | None = None) -> list[tuple[date, Decimal]]:
    """Flux datés RÉELS d'un investisseur : encaissements négatifs, retours positifs.

    Une souscription seulement réservée n'est pas un flux : aucun argent n'a bougé.
    """
    subs = Subscription.objects.filter(investor=investor).select_related("offer__project")
    if project is not None:
        subs = subs.filter(offer__project=project)

    flux: list[tuple[date, Decimal]] = []
    for sub in subs:
        if sub.settled_at and sub.settled_amount > 0:
            flux.append((sub.settled_at.date(), -Decimal(sub.settled_amount)))
        if sub.refunded_at and sub.refunded_amount > 0:
            flux.append((sub.refunded_at.date(), Decimal(sub.refunded_amount)))

    lignes = DistributionLine.objects.filter(investor=investor).select_related("distribution__offer__project")
    if project is not None:
        lignes = lignes.filter(distribution__offer__project=project)
    for ligne in lignes:
        flux.append((ligne.distribution.value_date, Decimal(ligne.amount)))
    return flux


def portfolio_flows() -> list[tuple[date, Decimal]]:
    """Union des flux de tous les investisseurs — base du TRI pondéré du portefeuille."""
    flux: list[tuple[date, Decimal]] = []
    for sub in Subscription.objects.all():
        if sub.settled_at and sub.settled_amount > 0:
            flux.append((sub.settled_at.date(), -Decimal(sub.settled_amount)))
        if sub.refunded_at and sub.refunded_amount > 0:
            flux.append((sub.refunded_at.date(), Decimal(sub.refunded_amount)))
    for d in Distribution.objects.all():
        flux.append((d.value_date, Decimal(d.total_amount)))
    return flux


# ── Concentration ─────────────────────────────────────────────────────────────

def herfindahl(weights: dict[str, Decimal]) -> Decimal:
    """`H = Σ (partᵢ)²` sur des poids normalisés. 1 = tout sur un seul axe.

    `H > seuil` (0,25 par défaut, paramétrable) signale une concentration élevée.
    Retourne 0 quand la base est vide — un portefeuille vide n'est pas concentré,
    il est vide, et l'effectif accompagne toujours la mesure.
    """
    total = sum(weights.values(), Decimal("0"))
    if total <= 0:
        return Decimal("0")
    return _q(sum(((v / total) ** 2 for v in weights.values()), Decimal("0")), Decimal("0.0001"))


def _exposure_by(field: str, subs) -> dict[str, Decimal]:
    buckets: dict[str, Decimal] = {}
    for sub in subs:
        cle = getattr(sub.offer.project, field, "") or "(non renseigné)"
        buckets[cle] = buckets.get(cle, Decimal("0")) + Decimal(sub.settled_amount)
    return buckets


def concentration(subs) -> dict:
    """Concentration mesurée sur les axes secteur et géographie + part du plus gros
    engagement — les trois chiffres de l'Annexe D, avec leur seuil d'alerte."""
    seuil = Decimal(InvestmentConfig.active().concentration_threshold)
    secteurs = _exposure_by("sector", subs)
    zones = _exposure_by("location", subs)
    engagements: dict[str, Decimal] = {}
    for sub in subs:
        engagements[sub.offer.project.code] = engagements.get(
            sub.offer.project.code, Decimal("0")) + Decimal(sub.settled_amount)
    base = sum(engagements.values(), Decimal("0"))
    plus_gros = max(engagements.values(), default=Decimal("0"))
    h_secteur = herfindahl(secteurs)
    h_zone = herfindahl(zones)
    return {
        "herfindahlSector": float(h_secteur),
        "herfindahlGeography": float(h_zone),
        "threshold": float(seuil),
        "highConcentration": bool(h_secteur > seuil or h_zone > seuil),
        "largestExposureShare": float(_q(plus_gros / base, Decimal("0.0001"))) if base else 0.0,
        "projectsCount": len(engagements),
        "sectorsCount": len(secteurs),
    }


# ── Défaut ────────────────────────────────────────────────────────────────────

def default_rates(subs) -> dict:
    """Taux de défaut en VALEUR **et** en NOMBRE — les deux, toujours.

    Un seul projet en défaut sur trente pèse peu en nombre et peut peser énormément
    en valeur : afficher un seul des deux chiffres, c'est choisir celui qui arrange.
    """
    cfg = InvestmentConfig.active()
    total_valeur = sum((Decimal(s.settled_amount) for s in subs), Decimal("0"))
    projets = {s.offer.project.code: s.offer.project for s in subs}
    en_defaut = {c: p for c, p in projets.items() if p.status == Project.Status.P12}
    valeur_defaut = sum(
        (Decimal(s.settled_amount) for s in subs if s.offer.project.status == Project.Status.P12),
        Decimal("0"),
    )
    taux_valeur = _q(valeur_defaut / total_valeur, Decimal("0.0001")) if total_valeur else Decimal("0")
    taux_nombre = _q(Decimal(len(en_defaut)) / Decimal(len(projets)), Decimal("0.0001")) if projets else Decimal("0")
    return {
        "byValue": float(taux_valeur),
        "byCount": float(taux_nombre),
        "defaultedValue": float(_q(valeur_defaut)),
        "defaultedProjects": len(en_defaut),
        "totalProjects": len(projets),
        "totalValue": float(_q(total_valeur)),
        "alertThreshold": float(cfg.default_rate_alert),
        "alert": bool(taux_valeur > Decimal(cfg.default_rate_alert)),
    }


def late_share(subs) -> Decimal:
    """Part des projets en retard — échéance de retour dépassée sans clôture."""
    from .models import RepaymentSchedule

    projets = {s.offer.project.code: s.offer.project for s in subs}
    if not projets:
        return Decimal("0")
    en_retard = set(
        RepaymentSchedule.objects.filter(
            status=RepaymentSchedule.Status.OVERDUE,
            offer__project__code__in=list(projets),
        ).values_list("offer__project__code", flat=True)
    )
    return _q(Decimal(len(en_retard)) / Decimal(len(projets)), Decimal("0.0001"))


# ── Score de santé ────────────────────────────────────────────────────────────

def health_score(*, default_rate: Decimal, hhi: Decimal, late: Decimal) -> dict:
    """`100 − a×taux_défaut − b×max(0, H−h₀)×100 − c×part_en_retard`, borné [0, 100].

    Les coefficients a, b, c et le seuil h₀ viennent de `InvestmentConfig` : la
    formule est publiée dans l'UI avec les paramètres RÉELLEMENT appliqués, jamais
    des constantes du code (principe 8). Le retour porte donc sa formule et ses
    paramètres, pour que l'écran n'ait rien à réinventer.
    """
    cfg = InvestmentConfig.active()
    a = Decimal(cfg.health_coeff_default)
    b = Decimal(cfg.health_coeff_concentration)
    c = Decimal(cfg.health_coeff_late)
    h0 = Decimal(cfg.concentration_threshold)

    penalite_defaut = a * Decimal(default_rate) * Decimal("100")
    penalite_conc = b * max(Decimal("0"), Decimal(hhi) - h0) * Decimal("100")
    penalite_retard = c * Decimal(late) * Decimal("100")
    brut = Decimal("100") - penalite_defaut - penalite_conc - penalite_retard
    score = max(Decimal("0"), min(Decimal("100"), brut))
    return {
        "score": float(_q(score, Decimal("0.1"))),
        "formula": "100 − a×taux_défaut − b×max(0, H−h₀)×100 − c×part_projets_en_retard",
        "parameters": {"a": float(a), "b": float(b), "c": float(c), "h0": float(h0)},
        "penalties": {
            "default": float(_q(penalite_defaut, Decimal("0.1"))),
            "concentration": float(_q(penalite_conc, Decimal("0.1"))),
            "late": float(_q(penalite_retard, Decimal("0.1"))),
        },
    }


# ── Valorisation ──────────────────────────────────────────────────────────────

def latent_value(subs) -> dict:
    """Valeur courante du portefeuille — capital restant dû + gain latent ÉTIQUETÉ.

    Méthode affichée, comme l'exige l'Annexe D : au pair pour la dette saine, décote de
    100 % du non-recouvré pour un projet en défaut (aucune valorisation d'expert n'est
    disponible dans le système — on ne l'invente pas). Tant qu'aucune valorisation
    d'expert n'existe pour les titres de capital, ils sont traités au pair et c'est dit.
    """
    capital = Decimal("0")
    latent = Decimal("0")
    for sub in subs:
        encaisse = Decimal(sub.settled_amount)
        recu = Decimal(sub.total_received)
        if sub.offer.project.status == Project.Status.P12:
            projet = sub.offer.project
            recouvre = Decimal(projet.returned_amount)
            decaisse = Decimal(projet.disbursed_amount) or Decimal("1")
            taux_recouvrement = min(Decimal("1"), recouvre / decaisse)
            capital += _q(max(Decimal("0"), encaisse - recu) * taux_recouvrement)
        else:
            capital += _q(max(Decimal("0"), encaisse - recu))
            taux = Decimal(sub.coupon_rate_snapshot) / Decimal("100")
            if sub.settled_at and taux > 0:
                jours = Decimal((date.today() - sub.settled_at.date()).days)
                latent += _q(encaisse * taux * jours / DAYS_PER_YEAR)
    return {
        "capitalOutstanding": float(_q(capital)),
        "latentGain": float(_q(latent)),
        "latentGainIsLatent": True,
        "method": (
            "Dette saine valorisée au pair ; intérêts courus non échus calculés prorata "
            "temporis depuis l'encaissement au taux de coupon figé à la souscription ; "
            "projet en défaut déprécié au taux de recouvrement constaté. Aucune "
            "valorisation d'expert n'est disponible : les titres de capital sont au pair."
        ),
    }


# ── Agrégats ──────────────────────────────────────────────────────────────────

def investor_metrics(investor: Investor) -> dict:
    """Le tableau de bord d'UN investisseur — sur SON argent uniquement.

    Trois colonnes de rendement (réalisé / latent / attendu) et jamais un chiffre
    unique flatteur : le rendement réalisé est un XIRR sur flux réels, le gain latent
    est étiqueté, le rendement attendu est le taux contractuel — trois grandeurs
    différentes qui ne se confondent pas.
    """
    subs = list(
        Subscription.objects.filter(investor=investor, status__in=Subscription.FUNDED_STATUSES)
        .select_related("offer__project")
    )
    encaisse = sum((Decimal(s.settled_amount) for s in subs), Decimal("0"))
    rembourse = sum(
        (Decimal(s.refunded_amount) for s in Subscription.objects.filter(investor=investor)),
        Decimal("0"),
    )
    distribue = DistributionLine.objects.filter(investor=investor).aggregate(
        t=Sum("amount"))["t"] or Decimal("0")
    taux, motif = xirr_or_none(investor_flows(investor))
    valorisation = latent_value(subs)
    attendu = Decimal("0")
    if encaisse:
        attendu = _q(
            sum((Decimal(s.settled_amount) * Decimal(s.coupon_rate_snapshot) for s in subs),
                Decimal("0")) / encaisse,
            Decimal("0.001"),
        )
    prochaine = (
        Subscription.objects.filter(investor=investor, next_payment_date__isnull=False,
                                     status__in=Subscription.FUNDED_STATUSES)
        .order_by("next_payment_date").values_list("next_payment_date", flat=True).first()
    )
    return {
        "totalInvested": float(_q(encaisse - rembourse)),
        "totalSettled": float(_q(encaisse)),
        "totalRefunded": float(_q(rembourse)),
        "totalDistributed": float(_q(distribue)),
        "positionsCount": len(subs),
        "realizedReturn": float(taux) if taux is not None else None,
        "realizedReturnUnavailableReason": motif or None,
        "expectedCouponRate": float(attendu),
        "valuation": valorisation,
        "nextPaymentDate": prochaine.isoformat() if prochaine else None,
        "currency": "USD",
        "asOf": date.today().isoformat(),
    }


def portfolio_metrics() -> dict:
    """Vue institution : TRI pondéré, défaut, concentration, santé — avec effectifs."""
    subs = list(
        Subscription.objects.filter(status__in=Subscription.FUNDED_STATUSES)
        .select_related("offer__project")
    )
    taux, motif = xirr_or_none(portfolio_flows())
    defauts = default_rates(subs)
    conc = concentration(subs)
    retard = late_share(subs)
    hhi = Decimal(str(max(conc["herfindahlSector"], conc["herfindahlGeography"])))
    sante = health_score(default_rate=Decimal(str(defauts["byValue"])), hhi=hhi, late=retard)
    return {
        "weightedIrr": float(taux) if taux is not None else None,
        "weightedIrrUnavailableReason": motif or None,
        "defaultRates": defauts,
        "concentration": conc,
        "lateProjectsShare": float(retard),
        "health": sante,
        "investorsCount": Investor.objects.filter(status=Investor.Status.ACTIVE).count(),
        "subscriptionsCount": len(subs),
        "currency": "USD",
        "asOf": date.today().isoformat(),
    }


def anonymised_pipeline() -> list[dict]:
    """Pipeline P01→P05 vu par un investisseur : des COMPTEURS, jamais des dossiers.

    Asymétrie d'information (§5.2) : un investisseur n'a pas à savoir quels projets sont
    en due diligence — ni leur nom, ni leur promoteur, ni leur montant individuel. Il a
    en revanche le droit de savoir qu'il y a du flux dans le tuyau.
    """
    etapes = [Project.Status.P01, Project.Status.P02, Project.Status.P03,
              Project.Status.P04, Project.Status.P05]
    libelles = dict(Project.Status.choices)
    lignes = []
    for etape in etapes:
        qs = Project.objects.filter(status=etape)
        lignes.append({
            "stage": etape,
            "label": libelles[etape],
            "count": qs.count(),
            "aggregateTarget": float(_q(qs.aggregate(t=Sum("funding_target"))["t"] or Decimal("0"))),
        })
    return lignes


def open_offers_summary() -> list[dict]:
    """Offres réellement ouvertes à la souscription — le seul détail projet auquel un
    investisseur a droit avant d'engager son argent."""
    return [
        {
            "offerId": o.pk, "offerCode": o.code, "projectCode": o.project.code,
            "title": o.project.title, "sector": o.project.sector, "location": o.project.location,
            "couponRate": float(o.coupon_rate), "maturityMonths": o.maturity_months,
            "minTicket": float(o.min_ticket), "bondUnitValue": float(o.bond_unit_value),
            "availableBonds": o.available_bonds, "fundingGoal": float(o.funding_goal),
            "reservedAmount": float(o.reserved_amount), "fundedAmount": float(o.funded_amount),
            "minFundingAmount": float(o.min_funding_amount),
            "oversubscriptionPolicy": o.oversubscription_policy,
            "subscriptionDeadline": (o.subscription_deadline.isoformat()
                                      if o.subscription_deadline else None),
        }
        for o in Offer.objects.filter(status=Offer.Status.OUVERT,
                                       project__status=Project.Status.P06)
        .select_related("project")
    ]

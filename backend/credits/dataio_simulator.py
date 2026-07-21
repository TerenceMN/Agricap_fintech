"""
Simulateur de crédit agricole basé sur les données de référence ingérées (dataio).

Lit les tables du fichier SIMULATEUR courant :
  - 5_Synthese_Besoins       → totaux de référence par module
  - 10_Capacite_Remboursement → paramètres du prêt (taux, durée, DSCR, TEG)
  - 12_Analyse_Credit         → critères de scoring avec poids
  - 18_Controles_Vraisemblance → plages de référence pour vraisemblance
"""
from __future__ import annotations

import math
from typing import Any


# ── Mapping rubrique Excel → code module Python ──────────────────────────────
_RUBRIQUE_TO_MODULE: list[tuple[str, str]] = [
    ("semences",           "semences"),
    ("intrants",           "semences"),
    ("mécanis",            "mecanisation"),
    ("mécanis",            "mecanisation"),
    ("mécani",             "mecanisation"),
    ("main",               "maindoeuvre"),
    ("équipement",         "equipements"),
    ("equipement",         "equipements"),
    ("matériel",           "equipements"),
    ("récolte",            "postrecolte"),
    ("recolte",            "postrecolte"),
    ("post",               "postrecolte"),
    ("logistique",         "logistique"),
    ("commercialisation",  "commercialisation"),
    ("réserve",            "reserve"),
    ("reserve",            "reserve"),
]


def _rubrique_to_module(rubrique: str) -> str | None:
    low = rubrique.lower()
    for fragment, code in _RUBRIQUE_TO_MODULE:
        if fragment in low:
            return code
    return None


# ── Financement par module (contrat §1) ───────────────────────────────────────
# Alias de codes reçus dans `module_financing` → code canonique de `MODULE_CODES`.
# Le front envoie les codes canoniques (cf. src/components/simulateur/modules.js),
# mais on tolère les alias historiques du prototype pour ne pas perdre un pct sur
# une divergence d'orthographe (principe 6 : une seule nomenclature, le backend
# fait foi ; le mapping vit ici, pas dans un `if` d'affichage).
_MODULE_ALIASES: dict[str, str] = {
    "maindoeuvre": "maindoeuvre",
    "main_doeuvre": "maindoeuvre",
    "maindoeuvre_": "maindoeuvre",
    "main-doeuvre": "maindoeuvre",
    "maindœuvre": "maindoeuvre",
    "postrecolte": "postrecolte",
    "post_recolte": "postrecolte",
    "post-recolte": "postrecolte",
    "operations": "mecanisation",
    "mecanisation": "mecanisation",
    "intrants": "semences",
}


def _canonical_module(code) -> str | None:
    """Code module canonique (`MODULE_CODES`) d'une clé de `module_financing`.

    `None` si la clé ne correspond à aucun module connu — l'appelant l'ignore
    plutôt que d'inventer un poste (aucun coût fichier ne lui correspondrait).
    """
    from credits.needs_sheet import MODULE_CODES

    if code is None:
        return None
    raw = str(code).strip()
    if raw in MODULE_CODES:
        return raw
    import re
    import unicodedata
    nfkd = unicodedata.normalize("NFD", raw.lower())
    flat = "".join(c for c in nfkd if not unicodedata.combining(c))
    flat = re.sub(r"[^a-z]", "", flat)
    if flat in MODULE_CODES:
        return flat
    return _MODULE_ALIASES.get(raw.lower()) or _MODULE_ALIASES.get(flat)


def normalize_module_financing(raw: dict | None) -> dict[str, int]:
    """`{codeFront: pct}` → `{codeCanonique: pct}`, pct borné à [0, 100] entier.

    Les clés inconnues sont écartées (silencieusement pour le calcul, mais la vue
    peut les signaler) ; un pct hors plage est ramené aux bornes. Vide → `{}`
    (aucun financement partiel : tout est demandé à 100 %).
    """
    out: dict[str, int] = {}
    if not isinstance(raw, dict):
        return out
    for key, value in raw.items():
        module = _canonical_module(key)
        if module is None:
            continue
        try:
            pct = int(round(float(value)))
        except (TypeError, ValueError):
            continue
        out[module] = max(0, min(100, pct))
    return out


def _referentiel_filiere_totals(value_chain, area_ha) -> tuple[dict[str, float], str | None]:
    """Coûts de référence par module (absolus) depuis `ReferentielFiliere`.

    C'est LE référentiel de la filière au sens du principe 1 : celui qu'`analyse.py`
    (`resoudre_referentiel`) utilise, lu des simulateurs ingérés. Le simulateur
    indicatif s'y aligne pour que sa fiabilité technique soit calculable dès qu'un
    référentiel existe pour la filière — c'était la cause du « 50 muet ».

    `couts_modules` porte des coûts À L'HECTARE (`ref` = coût/ha) : on les ramène
    au total du dossier via la superficie. Sans superficie, on ne peut pas produire
    de totaux absolus → `({}, None)` et l'appelant tentera une autre source.

    Retourne `(totaux, code_referentiel)`.
    """
    if value_chain is None or not area_ha:
        return {}, None
    try:
        from credits.models import ReferentielFiliere
    except Exception:
        return {}, None

    qs = ReferentielFiliere.objects.filter(actif=True)
    ref = (qs.filter(value_chain_code=value_chain.code).first()
           or qs.filter(filiere__iexact=getattr(value_chain, "label", "") or "").first())
    if ref is None:
        return {}, None

    import decimal
    area = decimal.Decimal(str(area_ha))
    totals: dict[str, float] = {}
    for module, cfg in (ref.couts_modules or {}).items():
        try:
            per_ha = decimal.Decimal(str(cfg.get("ref", 0)))
        except (decimal.InvalidOperation, AttributeError):
            continue
        if per_ha > 0:
            totals[module] = float((per_ha * area).quantize(decimal.Decimal("0.01")))
    return totals, (ref.code if totals else None)


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(str(val).replace(",", ".").strip())
    except (ValueError, TypeError):
        return None


def _normalize(s: str) -> set[str]:
    """Retourne un ensemble de tokens normalisés (minuscules, sans accents, ≥ 3 lettres)."""
    import re
    import unicodedata
    nfkd = unicodedata.normalize("NFD", s.lower())
    ascii_s = "".join(c for c in nfkd if not unicodedata.combining(c))
    return set(w for w in re.split(r"[\W_]+", ascii_s) if len(w) >= 3)


def _find_source(value_chain_code: str | None = None):
    """
    Retourne le DataSource SIMULATEUR le plus adapté à la filière.

    Priorité :
      1. Simulateur spécifique à la filière (match token ≥ 1 mot commun)
      2. Simulateur générique v4
      3. N'importe quel SIMULATEUR courant
    """
    from dataio.models import DataSource

    all_sources = list(DataSource.objects.filter(kind="SIMULATEUR", is_current=True))

    if value_chain_code:
        vc_tokens = _normalize(value_chain_code)
        best_src = None
        best_score = 0
        for src in all_sources:
            name_tokens = _normalize(src.original_name)
            common = len(vc_tokens & name_tokens)
            if common > best_score:
                best_score = common
                best_src = src
        # Accepter le match seulement si au moins 1 token commun
        # et que le fichier n'est pas le simulateur générique
        if best_src and best_score >= 1 and "sim" in _normalize(best_src.original_name):
            # Bonus : rejeter le fichier v4 générique si un fichier par-filière est trouvé
            is_generic = any(tok in _normalize(best_src.original_name) for tok in ("v4", "v3", "v2", "cycle", "production"))
            if not is_generic or best_score >= 2:
                return best_src

    # Fallback : simulateur générique v4
    for keyword in ("v4", "cycle", "production", "simulateur"):
        src = next(
            (s for s in all_sources if keyword in _normalize(s.original_name)),
            None,
        )
        if src:
            return src

    return all_sources[0] if all_sources else None


def _get_records(source, name_fragment: str) -> list[dict]:
    t = source.tables.filter(name__icontains=name_fragment).first()
    if not t:
        return []
    from dataio.models import DataRecord
    return list(DataRecord.objects.filter(table=t).order_by("row_index").values_list("values", flat=True))


# ── Lecture des tables de référence ──────────────────────────────────────────

def _read_scoring_criteria(source) -> list[dict]:
    """Table 12 : critères de scoring avec poids et scores de référence."""
    criteria = []
    for row in _get_records(source, "Analyse_Credit"):
        label = row.get("Critère") or row.get("Critere") or ""
        poid  = _safe_float(row.get("Pondération") or row.get("Ponderation") or row.get("Pond\xe9ration"))
        score = _safe_float(row.get("Score /100"))
        pts   = _safe_float(row.get("Points"))
        if not label or poid is None:
            continue
        ul = label.upper()
        if "GLOBAL" in ul or "SUGGESTION" in ul or "COUVERTURE" in ul:
            continue
        criteria.append({"label": label, "weight": poid, "ref_score": score or 0, "ref_points": pts or 0})
    return criteria


def _read_reference_totals(source) -> dict[str, float]:
    """Table 5 : totaux de référence par rubrique → mappe vers codes modules."""
    totals: dict[str, float] = {}
    for row in _get_records(source, "Synthese"):
        rubrique = row.get("Rubrique", "") or ""
        total    = _safe_float(row.get("Total rubrique"))
        if not rubrique or total is None:
            continue
        if "TOTAL" in rubrique.upper():
            continue
        mod = _rubrique_to_module(rubrique)
        if mod:
            totals[mod] = totals.get(mod, 0) + total
    return totals


def _read_loan_params(source) -> dict[str, float | None]:
    """Table 10 : paramètres financiers (taux, durée, DSCR, TEG…)."""
    import unicodedata, re

    def _n(s: str) -> str:
        """Lowercase + supprime accents."""
        nfkd = unicodedata.normalize("NFD", s.lower())
        return "".join(c for c in nfkd if not unicodedata.combining(c))

    params: dict[str, Any] = {}
    for row in _get_records(source, "Capacite"):
        ind = row.get("Indicateur", "") or ""
        val = row.get("Valeur")
        n = _n(ind)

        # Taux d'intérêt annuel — doit COMMENCER par "taux" (pas "intérêts totaux")
        if re.match(r"^taux\b.*(interet|inter)", n):
            params["rate_annual"] = _safe_float(val)
        # Durée — commence par "dur" + "mois"
        elif re.match(r"^dur", n) and "mois" in n:
            params["duration_months"] = _safe_float(val)
        # Différé — commence par "diff" + "mois"
        elif re.match(r"^diff", n) and "mois" in n:
            params["deferred_months"] = _safe_float(val)
        # DSCR — contient "dscr" mais pas "stress"
        elif "dscr" in n and "stress" not in n:
            params["dscr"] = _safe_float(val)
        # EBE — commence par "ebe" ou "excedent brut"
        elif re.match(r"^ebe\b", n) or re.match(r"^excedent brut", n):
            params["ebe"] = _safe_float(val)
        # TEG — commence par "teg"
        elif re.match(r"^teg\b", n):
            params["teg"] = _safe_float(val)
        # Crédit recommandé / montant de référence
        elif re.match(r"^(credit|pret) recommande", n):
            params["ref_amount"] = _safe_float(val)
        # Service de la dette
        elif "service" in n and "dette" in n:
            params["debt_service"] = _safe_float(val)

    return params


def _read_coherence_ranges(source) -> list[dict]:
    """Table 18 : plages de référence pour contrôles de vraisemblance."""
    ranges = []
    for row in _get_records(source, "Controle"):
        ind = row.get("Indicateur", "") or ""
        ref_min = _safe_float(row.get("Réf. min") or row.get("R\xe9f. min"))
        ref_max = _safe_float(row.get("Réf. max") or row.get("R\xe9f. max"))
        verdict = row.get("Verdict final") or row.get("Verdict") or ""
        if ind and (ref_min is not None or ref_max is not None):
            ranges.append({"indicateur": ind, "min": ref_min, "max": ref_max, "verdict": verdict})
    return ranges


# ── Calcul du score par critère ───────────────────────────────────────────────

def _score_fiabilite(
    ns_totals: dict[str, float], ref_totals: dict[str, float]
) -> tuple[float | None, str, bool]:
    """
    Fiabilité technique : cohérence entre la feuille de besoins et le référentiel.
    - Pour chaque module présent dans les deux : vérifie si l'écart est ≤ 30 %.
    - Score 100 si tous OK, pondéré par la proportion de modules dans la plage.

    Retourne `(score, note, calculable)`. Quand aucun référentiel n'existe pour la
    filière (filière hors-modèle hectare — apiculture, élevage, BSF, champignons,
    transformation), le score n'est PAS calculable : on renvoie `(None, motif,
    False)` avec le motif explicite, jamais un 50 muet (contrat §1). L'ancienne
    version renvoyait « Données insuffisantes » à 50/100 dès que `ref_totals`
    était vide — un demi-score inventé qui masquait l'absence de référence et
    tirait le score global vers un faux milieu.
    """
    if not ref_totals:
        return None, (
            "Fiabilité technique non calculable : aucun référentiel de coûts "
            "n'existe pour cette filière (filière hors-modèle hectare, ou "
            "référentiel non encore importé). Le réalisme des coûts ne peut être "
            "établi sans référence — le critère est exclu du score plutôt que "
            "noté à un milieu arbitraire."
        ), False
    if not ns_totals:
        return None, (
            "Fiabilité technique non calculable : la feuille de besoins ne porte "
            "aucun montant par module à comparer au référentiel."
        ), False

    ok = 0
    ko = 0
    details = []
    grand_ns = sum(ns_totals.values()) or 1
    grand_ref = sum(ref_totals.values()) or 1

    for mod, ref_val in ref_totals.items():
        ns_val = ns_totals.get(mod, 0)
        if ref_val == 0:
            continue
        ratio = ns_val / ref_val
        if 0.70 <= ratio <= 1.30:
            ok += 1
        else:
            ko += 1
            pct = round((ratio - 1) * 100, 1)
            details.append(f"{mod} : {'+' if pct > 0 else ''}{pct}% vs référentiel")

    total_modules = ok + ko
    score = round(100 * ok / total_modules, 1) if total_modules > 0 else 60.0

    # Cohérence globale (grand total)
    ratio_global = grand_ns / grand_ref
    if ratio_global > 1.50:
        score = min(score, 60.0)
        details.insert(0, f"Total feuille {round(grand_ns):,} vs référentiel {round(grand_ref):,} ({round((ratio_global-1)*100)}% au-dessus)")
    elif ratio_global < 0.50:
        score = min(score, 50.0)
        details.insert(0, f"Total feuille {round(grand_ns):,} nettement inférieur au référentiel {round(grand_ref):,}")

    note = ", ".join(details) if details else f"{ok}/{total_modules} modules dans la plage de référence."
    return score, note, True


def _score_dscr(dscr: float | None) -> tuple[float, str]:
    """Capacité financière : DSCR → score /100."""
    if dscr is None:
        return 50.0, "DSCR non calculable."
    if dscr >= 1.8:
        s = 100.0
    elif dscr >= 1.5:
        s = 80.0 + (dscr - 1.5) / 0.3 * 20
    elif dscr >= 1.25:
        s = 60.0 + (dscr - 1.25) / 0.25 * 20
    elif dscr >= 1.0:
        s = 30.0 + (dscr - 1.0) / 0.25 * 30
    else:
        s = max(0.0, dscr / 1.0 * 30)
    return round(s, 1), f"DSCR = {dscr:.2f} ({'satisfaisante' if dscr >= 1.25 else 'limite' if dscr >= 1.0 else 'insuffisante'})"


def _score_behavioral(client) -> tuple[float, str]:
    """
    Historique comportemental : base sur les transactions du wallet et l'épargne.
    Score maximal par défaut (50/100) si pas d'historique négatif détecté.
    """
    try:
        from caisses.models import WalletTransaction
        wallet = getattr(client, "wallets", None)
        if not wallet:
            return 50.0, "Aucun historique AGRICAP détecté — score neutre."
        # Nombre de transactions réussies vs en retard
        transactions = WalletTransaction.objects.filter(
            wallet__owner=client, status__in=["COMPLETED", "FAILED"]
        )
        total = transactions.count()
        failed = transactions.filter(status="FAILED").count()
        if total == 0:
            return 50.0, "Nouveau client — score d'historique neutre (50/100)."
        ratio_ok = (total - failed) / total
        score = round(min(100, ratio_ok * 100), 1)
        return score, f"{total - failed}/{total} transactions réussies."
    except Exception:
        return 50.0, "Historique comportemental non disponible."


def _score_guarantees(guarantees_data: dict | None, amount: float) -> tuple[float, str]:
    """Garanties : couverture de l'encours."""
    if not guarantees_data or not amount:
        return 60.0, "Garanties non encore constituées — score indicatif."
    items = guarantees_data.get("items", []) if isinstance(guarantees_data, dict) else []
    total_coverage = sum(
        float(g.get("holdAmount") or g.get("valeur_estimee") or 0) for g in items
    )
    if total_coverage == 0:
        return 60.0, "Garanties non encore constituées — score indicatif."
    ratio = total_coverage / amount
    if ratio >= 1.5:
        score, note = 100.0, f"Couverture {ratio:.1f}× (excellente)"
    elif ratio >= 1.0:
        score, note = 80.0, f"Couverture {ratio:.1f}× (satisfaisante)"
    elif ratio >= 0.75:
        score, note = 55.0, f"Couverture {ratio:.1f}× (partielle)"
    else:
        score, note = 30.0, f"Couverture {ratio:.1f}× (insuffisante)"
    return score, note


# ── Tableau d'amortissement ───────────────────────────────────────────────────

def _build_schedule(amount: float, rate_annual: float, duration_months: int, deferred: int = 0) -> list[dict]:
    """Amortissement linéaire avec différé (intérêts seuls pendant le différé)."""
    if amount <= 0 or duration_months <= 0:
        return []
    repay = max(1, duration_months - deferred)
    monthly_rate = rate_annual / 12
    principal_pm = amount / repay
    balance = amount
    schedule = []
    for m in range(1, duration_months + 1):
        interest = round(balance * monthly_rate, 2)
        if m <= deferred:
            schedule.append({
                "month": m, "principal": 0.0, "interest": interest,
                "payment": interest, "balance": round(balance, 2),
            })
        else:
            principal = round(principal_pm, 2)
            balance = max(0.0, balance - principal)
            schedule.append({
                "month": m, "principal": round(principal, 2), "interest": interest,
                "payment": round(principal + interest, 2), "balance": round(balance, 2),
            })
    return schedule


def _valuation_note(score: float, eligible: bool) -> str:
    if score >= 85:
        return "Excellent dossier — accord favorable recommandé."
    if score >= 70:
        return "Bon dossier — accord favorable sous conditions standard."
    if score >= 55:
        return "Dossier à instruire — conditions supplémentaires probables."
    return "Dossier à risque élevé — analyse approfondie requise."


# ── Point d'entrée principal ─────────────────────────────────────────────────

def dataio_simulate(
    client,
    value_chain_code: str | None,
    needs_sheet=None,
    ns_totals: dict | None = None,
    area_ha: float | None = None,
    amount_requested: float | None = None,
    currency: str = "USD",
    guarantees_data: dict | None = None,
    module_financing: dict | None = None,
) -> dict:
    """
    Simulation complète à partir des données de référence (dataio).

    Paramètres :
      client           : FintechUser
      value_chain_code : code filière (ex. 'CAFE_ARABICA')
      needs_sheet      : NeedsSheet ORM (optionnel)
      ns_totals        : dict {module: montant} si déjà calculé côté frontend
      area_ha          : superficie
      amount_requested : montant demandé
      currency         : 'USD' | 'CDF'
      guarantees_data  : dict avec 'items' (liste de garanties)
      module_financing : dict {module_canonique: pct 0..100} — part demandée par
                         module (contrat §1). Absent = 100 %. Les COÛTS restent
                         lus de `ns_totals` (DataRecord), jamais du payload
                         (principe 1) ; seul le POURCENTAGE demandé vient d'ici.

    Retourne un dict compatible avec CreditSimulateResult (TypeScript).
    """

    # ── Frontière de type ────────────────────────────────────────────────────
    # Ce module calcule en `float` de bout en bout ; les vues, elles, portent
    # désormais des `Decimal` (principe 4 : aucun `float` n'entre dans un champ
    # financier). Sans cette coercition, `Decimal / float` lève un TypeError et
    # la simulation répond 500 — c'est ce qui est arrivé après la correction des
    # vues, le défaut étant simplement déplacé plutôt que résolu.
    #
    # Dette assumée et bornée : ce simulateur est INDICATIF. Le scoring qui fait
    # foi est `credits/analyse.py`, en `Decimal` du premier au dernier calcul.
    # Migrer ce module entier en `Decimal` est le correctif propre ; le faire en
    # urgence sur un chemin non couvert par des tests de vue le serait moins.
    def _f(x):
        return float(x) if x is not None else None

    amount_requested = _f(amount_requested)
    area_ha = _f(area_ha)
    if ns_totals:
        ns_totals = {k: _f(v) for k, v in ns_totals.items()}

    # ── Filière de référence (ValueChain) ────────────────────────────────────
    value_chain = None
    if value_chain_code:
        try:
            from reference_data.models import ValueChain as _VC
            value_chain = _VC.objects.filter(code=value_chain_code, active=True).first()
        except Exception:
            pass

    # ── Source SIMULATEUR dans la base ───────────────────────────────────────
    source = _find_source(value_chain_code)

    # ── Données de la feuille de besoins ──────────────────────────────────────
    if ns_totals is None:
        ns_totals = {}
    if needs_sheet and not ns_totals:
        ns_totals = needs_sheet.total_by_module or {}

    grand_total_ns = sum(ns_totals.values()) if ns_totals else (amount_requested or 0)

    # ── Données de référence depuis le simulateur ──────────────────────────────
    scoring_criteria: list[dict] = []
    ref_totals_sim: dict[str, float] = {}
    loan_params: dict = {}

    if source:
        scoring_criteria = _read_scoring_criteria(source)
        ref_totals_sim   = _read_reference_totals(source)
        loan_params      = _read_loan_params(source)

    # ── Totaux de référence par filière ───────────────────────────────────────
    # Priorité : simulateur par filière > référentiel ValueChain (module_weights × superficie)
    # On n'utilise le simulateur générique que si la filière correspond vraiment.
    source_matches_chain = False
    if source and value_chain_code:
        src_tokens = _normalize(source.original_name)
        vc_tokens  = _normalize(value_chain_code)
        source_matches_chain = bool(vc_tokens & src_tokens)

    # Référentiel filière autoritatif (`ReferentielFiliere`, principe 1) — la même
    # source que le moteur `analyse.py`. Le simulateur indicatif s'y aligne pour
    # que la fiabilité technique se calcule dès qu'un référentiel existe (§1).
    ref_filiere_totals, ref_filiere_code = _referentiel_filiere_totals(value_chain, area_ha)

    if source_matches_chain and ref_totals_sim:
        ref_totals = ref_totals_sim
    elif ref_filiere_totals:
        ref_totals = ref_filiere_totals
    elif value_chain and area_ha and getattr(value_chain, "module_weights", None):
        # Calcul des références depuis le référentiel filière (coût/ha × superficie)
        cost_per_ha = float(
            value_chain.cost_per_hectare_usd if currency == "USD"
            else getattr(value_chain, "cost_per_hectare_cdf", value_chain.cost_per_hectare_usd)
        )
        total_ref = cost_per_ha * float(area_ha)
        ref_totals = {
            mod: round(total_ref * pct / 100, 2)
            for mod, pct in value_chain.module_weights.items()
            if pct > 0
        }
    elif value_chain and grand_total_ns and getattr(value_chain, "module_weights", None):
        # Pas de superficie → utiliser les poids sur le montant demandé
        ref_totals = {
            mod: round(grand_total_ns * pct / 100, 2)
            for mod, pct in value_chain.module_weights.items()
            if pct > 0
        }
    else:
        ref_totals = ref_totals_sim  # fallback : simulateur générique

    # ── Paramètres du prêt ────────────────────────────────────────────────────
    raw_rate = loan_params.get("rate_annual")
    # Garde-fou : un taux brut > 1 est probablement en % (ex. 18.0 au lieu de 0.18)
    if raw_rate and raw_rate > 1.0:
        raw_rate = raw_rate / 100
    if raw_rate and raw_rate > 1.0:
        raw_rate = None  # valeur incohérente → fallback

    # Taux final : simulateur (si filière correspondante) > ValueChain.base_rate > 18% par défaut
    if raw_rate and source_matches_chain:
        rate_annual = raw_rate
    elif value_chain and getattr(value_chain, "base_rate", None):
        vc_rate = float(value_chain.base_rate)
        rate_annual = vc_rate / 100 if vc_rate > 1 else vc_rate
    else:
        rate_annual = raw_rate or 0.18

    # Durée : simulateur > ValueChain.cycle_months > 12 mois par défaut
    raw_duration = loan_params.get("duration_months")
    if raw_duration and source_matches_chain:
        duration_months = int(raw_duration)
    elif value_chain and getattr(value_chain, "cycle_months", None):
        duration_months = int(value_chain.cycle_months)
    else:
        duration_months = int(raw_duration or 12)

    # Différé : simulateur > 0 mois
    raw_deferred = loan_params.get("deferred_months")
    deferred_months = int(raw_deferred or 0) if source_matches_chain else 0

    ref_dscr = loan_params.get("dscr")
    ref_ebe  = loan_params.get("ebe") if source_matches_chain else None

    # ── Financement par module (contrat §1) ────────────────────────────────────
    # Coûts TOUJOURS lus des DataRecord (`ns_totals`), jamais du payload (principe
    # 1) ; seul le POURCENTAGE demandé par module vient de `module_financing`.
    #   part demandée = coût fichier × pct/100  (module absent = 100 %)
    #   montant demandé ajusté = Σ parts demandées
    # Un module à 0 dans la feuille reste à 0 (aucun financement inventable).
    from credits.needs_sheet import MODULE_CODES

    module_financing = module_financing or {}
    _mf_ordered = [m for m in MODULE_CODES if m in ns_totals]
    _mf_ordered += [m for m in ns_totals if m not in MODULE_CODES]  # postes hors nomenclature
    module_financing_rows: list[dict] = []
    montant_demande_ajuste = 0.0
    for mod in _mf_ordered:
        cout = float(ns_totals.get(mod) or 0)
        pct = module_financing.get(mod, 100)
        part = round(cout * pct / 100.0, 2)
        montant_demande_ajuste += part
        module_financing_rows.append({
            "module": mod,
            "coutFichier": round(cout, 2),
            "pct": pct,
            "partDemandee": part,
        })
    montant_demande_ajuste = round(montant_demande_ajuste, 2)

    # Montant scoré : Σ parts demandées quand un financement par module est fourni
    # (le DSCR et l'échéancier suivent ce montant ajusté, §1) ; sinon comportement
    # inchangé — montant demandé, ou grand total de la feuille.
    if module_financing:
        sim_amount = (montant_demande_ajuste
                      or float(amount_requested or 0)
                      or grand_total_ns
                      or (loan_params.get("ref_amount") or 5000))
    else:
        sim_amount = amount_requested or grand_total_ns or (loan_params.get("ref_amount") or 5000)

    # ── DSCR estimé ───────────────────────────────────────────────────────────
    estimated_dscr: float | None = None

    if ref_ebe and sim_amount and loan_params.get("ref_amount") and source_matches_chain:
        # Filière correspondante : on scale l'EBE de référence proportionnellement au montant
        ref_amount = loan_params["ref_amount"]
        scale = sim_amount / ref_amount if ref_amount else 1.0
        scaled_ebe = ref_ebe * scale
        monthly_interest = sim_amount * rate_annual / 12
        monthly_principal = sim_amount / max(duration_months - deferred_months, 1)
        monthly_service = monthly_principal + monthly_interest
        annual_service = monthly_service * 12
        if annual_service > 0:
            annual_ebe = scaled_ebe * (12 / max(duration_months, 1))
            estimated_dscr = round(annual_ebe / annual_service, 3)
            if not (0 < estimated_dscr <= 10):
                estimated_dscr = ref_dscr

    elif ref_dscr:
        # Simulateur disponible mais filière différente : utiliser le DSCR de référence
        # scalé par le rapport montant_client / montant_référence (proxy)
        ref_amount = loan_params.get("ref_amount") or sim_amount
        if ref_amount and sim_amount and ref_amount > 0:
            ratio = sim_amount / ref_amount
            # DSCR ↓ quand montant ↑ (à EBE constant), ↑ quand montant ↓
            estimated_dscr = round(ref_dscr / ratio if ratio > 0 else ref_dscr, 3)
            estimated_dscr = max(0.1, min(estimated_dscr, 5.0))  # plage raisonnable
        else:
            estimated_dscr = ref_dscr

    # ── Calcul des scores par critère ─────────────────────────────────────────
    # La fiabilité technique porte un 3e terme `calculable` : elle est exclue du
    # score global (et non notée 50) quand aucun référentiel n'existe (§1). Les
    # autres critères gardent leur repli neutre habituel (2-uplet).
    fiab_score, fiab_detail, fiab_calculable = _score_fiabilite(ns_totals, ref_totals)

    scores_map: dict[str, tuple[float, str]] = {}
    for crit in scoring_criteria:
        label_low = crit["label"].lower()
        if "capacit" in label_low or "dscr" in label_low or "financière" in label_low:
            scores_map["dscr"] = _score_dscr(estimated_dscr)
        elif "stress" in label_low or "résilience" in label_low:
            # Score résilience basé sur marge par rapport au seuil DSCR minimum
            dscr_stress = (estimated_dscr or 1.0) * 0.75  # stress -25 %
            scores_map["stress"] = _score_dscr(dscr_stress)
        elif "historique" in label_low or "comport" in label_low:
            scores_map["behavioral"] = _score_behavioral(client)
        elif "garantie" in label_low or "domiciliation" in label_low:
            scores_map["guarantees"] = _score_guarantees(guarantees_data, sim_amount)

    # Fallback si le référentiel est incomplet
    if "dscr"       not in scores_map: scores_map["dscr"]       = _score_dscr(estimated_dscr)
    if "stress"     not in scores_map: scores_map["stress"]      = (_score_dscr((estimated_dscr or 1.0) * 0.75)[0], "Stress test -25%")
    if "behavioral" not in scores_map: scores_map["behavioral"]  = _score_behavioral(client)
    if "guarantees" not in scores_map: scores_map["guarantees"]  = _score_guarantees(guarantees_data, sim_amount)

    # ── Pondération finale ────────────────────────────────────────────────────
    # Utiliser les poids du référentiel si disponibles, sinon les poids par défaut
    DEFAULT_WEIGHTS = {
        "fiabilite":  0.25,
        "dscr":       0.20,
        "stress":     0.10,
        "behavioral": 0.30,
        "guarantees": 0.15,
    }
    crit_keys = ["fiabilite", "dscr", "stress", "behavioral", "guarantees"]

    # Récupérer les poids depuis le référentiel
    weights = dict(DEFAULT_WEIGHTS)
    if len(scoring_criteria) >= 5:
        for i, key in enumerate(crit_keys):
            if i < len(scoring_criteria):
                weights[key] = scoring_criteria[i]["weight"]

    breakdown = []
    total_weighted = 0.0
    weight_calculable = 0.0
    n_non_calculable = 0
    labels_fr = {
        "fiabilite":  "Fiabilité technique",
        "dscr":       "Capacité financière (DSCR)",
        "stress":     "Résilience au stress",
        "behavioral": "Historique comportemental",
        "guarantees": "Garanties & domiciliation",
    }
    for key in crit_keys:
        w = weights[key]
        if key == "fiabilite" and not fiab_calculable:
            # Non calculable : exclu du score, jamais un 50 muet (§1). Le poids
            # sort de la base de pondération (« pas de moyenne sans effectif »).
            n_non_calculable += 1
            breakdown.append({
                "code": key,
                "label": labels_fr[key],
                "points": None,
                "maxPoints": 100,
                "weight": w,
                "weightedScore": None,
                "calculable": False,
                "detail": fiab_detail,
            })
            continue
        if key == "fiabilite":
            s, detail = fiab_score, fiab_detail
        else:
            s, detail = scores_map[key]
        weighted = round(s * w, 2)
        total_weighted += weighted
        weight_calculable += w
        breakdown.append({
            "code": key,
            "label": labels_fr[key],
            "points": round(s, 1),
            "maxPoints": 100,
            "weight": w,
            "weightedScore": weighted,
            "calculable": True,
            "detail": detail,
        })

    # Sans critère exclu, le score global est la somme pondérée (comportement
    # inchangé). Avec un critère exclu, on renormalise sur les poids restants pour
    # que la note reste sur 0–100 sans le combler par une valeur inventée.
    if n_non_calculable and weight_calculable > 0:
        final_score = round(total_weighted / weight_calculable, 1)
    else:
        final_score = round(total_weighted, 1)

    # ── Taux proposé ──────────────────────────────────────────────────────────
    # Taux de base depuis le référentiel + ajustement selon score
    base_rate = rate_annual * 100
    if final_score >= 85:
        proposed_rate = round(base_rate - 2.0, 2)
    elif final_score >= 70:
        proposed_rate = round(base_rate, 2)
    elif final_score >= 55:
        proposed_rate = round(base_rate + 2.0, 2)
    else:
        proposed_rate = round(base_rate + 5.0, 2)

    # ── Score minimal requis (depuis ValueChain ou défaut 60) ────────────────
    min_score = int(value_chain.min_score_required) if value_chain else 60

    eligible = final_score >= min_score

    # ── Tableau d'amortissement ───────────────────────────────────────────────
    schedule = _build_schedule(
        amount=sim_amount,
        rate_annual=proposed_rate / 100,
        duration_months=duration_months,
        deferred=deferred_months,
    )
    # Totaux de l'échéancier servis PAR LE SERVEUR : le front affiche un
    # échéancier complet (toutes les lignes) et sa synthèse, mais ne somme
    # jamais lui-même (règle §5 « zéro chiffre métier calculé côté client »).
    # Ce module est indicatif et calcule en float de bout en bout ; on arrondit
    # pour ne pas exposer le bruit binaire.
    schedule_totals = {
        "totalPrincipal": round(sum(r["principal"] for r in schedule), 2),
        "totalInterest":  round(sum(r["interest"] for r in schedule), 2),
        "totalPayments":  round(sum(r["payment"] for r in schedule), 2),
        "count":          len(schedule),
    }

    source_label = (
        source.original_name if source_matches_chain
        else f"Référentiel filière {value_chain_code or 'AGRICAP'}" if value_chain
        else (source.original_name if source else "N/A")
    )

    return {
        "score":            final_score,
        "breakdown":        breakdown,
        "eligible":         eligible,
        "minScoreRequired": min_score,
        "proposedRate":     proposed_rate,
        "scheduleDraft":    schedule,
        "scheduleTotals":   schedule_totals,
        "valuationNote":    _valuation_note(final_score, eligible),
        # Financement par module (contrat §1) — parts demandées et montant scoré.
        "moduleFinancing":     module_financing_rows,
        "montantDemandeAjuste": montant_demande_ajuste,
        "refData": {
            "source":          source_label,
            "sourceFile":      source.original_name if source else None,
            "sourceMatchesChain": source_matches_chain,
            "referentielFiliere": ref_filiere_code,
            "dscr":            round(estimated_dscr, 3) if estimated_dscr else None,
            "durationMonths":  duration_months,
            "deferredMonths":  deferred_months,
            "rateAnnual":      rate_annual,
            "refTotals":       ref_totals,
            "grandTotalNS":    round(grand_total_ns, 2),
        },
    }

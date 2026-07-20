# AGRICAP — Moteur d'analyse intelligente du module Crédits
## Extension du pipeline de validation : étape 2bis « Analyse technico-économique & scoring »

**Backend :** Django 5.x / DRF / PostgreSQL 16 — app `credits`, service `analyse.py`
**Référence amont :** SPEC_Pipeline_Validation_Credits_AGRICAP.md (v1.0)
**Source métier :** Moteur de crédit AGRICAP v4 (Excel) + système AGRICAP-ANALYSTE v2
**Version :** 1.0 — Juillet 2026

---

## 1. Position dans le pipeline

Le pipeline passe de 4 à 5 étapes. L'analyse s'exécute **uniquement si les étapes 1 et 2 ont réussi** (le fichier est structurellement conforme et les valeurs sont référencées) — on n'analyse jamais un fichier douteux.

```
Upload plan financier
 │
 ▼
[1] Validation structure (vs template)          ── échec → erreurs détaillées
 ▼ succès
[2] Validation valeurs (vs tables référence)    ── échec → erreurs détaillées
 ▼ succès
[2bis] ANALYSE TECHNICO-ÉCONOMIQUE & SCORING    ── produit AnalyseCredit + échéancier
 │        5 critères pondérés → score global → recommandation (barème 4 niveaux)
 ▼
[3] Vérification statut approbation             ── décision humaine éclairée par [2bis]
 ▼
[4] Traçabilité (journal append-only)           ── chaque étape, y compris l'analyse
```

Principe fondamental hérité d'AGRICAP-ANALYSTE : **le moteur recommande, l'humain décide.** Le résultat de l'analyse est stocké, journalisé et affiché à l'analyste ; la décision (étape 3) reste un acte humain avec motif obligatoire.

---

## 2. Les 5 critères et leur pondération

| # | Critère | Poids | Source de données | Score si donnée absente |
|---|---|---|---|---|
| C1 | Fiabilité technique | **25 %** | Plan financier uploadé vs référentiel filière | — (toujours calculable si étapes 1–2 OK) |
| C2 | Capacité financière (DSCR) | **20 %** | Échéancier prévisionnel + cash-flows du plan | — |
| C3 | Résilience au stress | **10 %** | DSCR recalculé sous choc de revenus | — |
| C4 | Historique comportemental | **30 %** | Wallet / remboursements antérieurs (module Transactions) | **50/100** (neutre, mention explicite) |
| C5 | Garanties & domiciliation | **15 %** | Garanties déclarées au wizard, statut de constitution | **60/100 indicatif** si non constituées |

Format de restitution :

```
Fiabilité technique        0.0/100 ×25% =  0.0 pts
Capacité financière (DSCR) 19.1/100 ×20% =  3.8 pts
Résilience au stress       14.3/100 ×10% =  1.4 pts
Historique comportemental  50.0/100 ×30% = 15.0 pts
Garanties & domiciliation  60.0/100 ×15% =  9.0 pts
─────────────────────────────────────────────────────
SCORE GLOBAL                               29.2/100 → Refus recommandé
```

---

## 3. Modèles complémentaires (`credits/models.py` — ajouts)

```python
class ReferentielFiliere(models.Model):
    """Référentiel technico-économique par filière (fichier AGRICAP_FIN_SIM_xx).
    Alimenté par le protocole de boucle d'apprentissage : plages indicatives
    substituées progressivement par les données réelles à N >= 30 dossiers."""
    code = models.CharField(max_length=60, unique=True)      # AGRICAP_FIN_SIM_01_Cereales_Mais
    filiere = models.CharField(max_length=100)               # Céréales — Maïs
    unite_reference = models.CharField(max_length=30, default="ha")
    # Coûts de référence par module et par unité :
    # {"semences": {"ref": 850, "tol_inf": 0.30, "tol_sup": 0.40},
    #  "mecanisation": {"ref": 1200, ...}, ... }
    couts_modules = models.JSONField()
    rendement_ref = models.JSONField(default=dict)   # {"qte_unite": 4.5, "prix_unitaire": 380, "unite": "t"}
    n_cas_reels = models.PositiveIntegerField(default=0)     # boucle d'apprentissage
    source = models.CharField(max_length=20,
                              choices=[("indicatif", "Indicatif"), ("appris", "Appris (N>=30)")],
                              default="indicatif")
    version = models.PositiveIntegerField(default=1)
    actif = models.BooleanField(default=True)


class BaremeScore(models.Model):
    """Barèmes de conversion valeur→score, calibrables sans redéploiement.
    Fonction affine par morceaux : [{"x": 0.5, "y": 0}, {"x": 1.0, "y": 40},
    {"x": 1.3, "y": 80}, {"x": 1.5, "y": 100}]"""
    code = models.CharField(max_length=40, unique=True)      # DSCR, STRESS, ECART_TECHNIQUE...
    points = models.JSONField()
    actif = models.BooleanField(default=True)

    def evaluer(self, x: float) -> float:
        pts = sorted(self.points, key=lambda p: p["x"])
        if x <= pts[0]["x"]:
            return pts[0]["y"]
        if x >= pts[-1]["x"]:
            return pts[-1]["y"]
        for a, b in zip(pts, pts[1:]):
            if a["x"] <= x <= b["x"]:
                t = (x - a["x"]) / (b["x"] - a["x"])
                return round(a["y"] + t * (b["y"] - a["y"]), 1)


class AnalyseCredit(models.Model):
    """Résultat complet d'une exécution du moteur d'analyse (immuable — on ré-analyse,
    on ne modifie jamais)."""
    class Recommandation(models.TextChoices):
        APPROBATION = "approbation", "Approbation recommandée"
        APPROBATION_COND = "approbation_cond", "Approbation sous conditions"
        REVUE = "revue", "Revue approfondie requise"
        REFUS = "refus", "Refus recommandé"

    demande = models.ForeignKey("DemandeCredit", on_delete=models.CASCADE,
                                related_name="analyses")
    plan = models.ForeignKey("PlanFinancierUpload", on_delete=models.PROTECT)
    referentiel = models.ForeignKey(ReferentielFiliere, on_delete=models.PROTECT)
    # Paramètres du crédit analysé
    duree_mois = models.PositiveIntegerField()
    differe_mois = models.PositiveIntegerField(default=0)
    taux_annuel = models.DecimalField(max_digits=5, decimal_places=2)   # 18.00
    # Résultats par critère : {"technique": {"score": 0.0, "poids": 25, "points": 0.0,
    #   "details": {...}}, "dscr": {...}, ...}
    criteres = models.JSONField()
    dscr = models.DecimalField(max_digits=6, decimal_places=3, null=True)      # 0.636
    dscr_stress = models.DecimalField(max_digits=6, decimal_places=3, null=True)
    score_global = models.DecimalField(max_digits=5, decimal_places=1)
    recommandation = models.CharField(max_length=20, choices=Recommandation.choices)
    # Canal de justification : indicateurs hors plage + justification de l'agent
    indicateurs_hors_plage = models.JSONField(default=list)
    justifications = models.JSONField(default=list)   # [{indicateur, justification, agent, date}]
    echeancier = models.JSONField()                   # lignes de l'échéancier prévisionnel
    execute_le = models.DateTimeField(auto_now_add=True)
    version_moteur = models.CharField(max_length=10, default="4.0")
```

---

## 4. Le moteur (`credits/services/analyse.py`)

```python
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from openpyxl import load_workbook

from credits.models import AnalyseCredit, BaremeScore, ReferentielFiliere

POIDS = {"technique": 25, "dscr": 20, "stress": 10, "comportemental": 30, "garanties": 15}
CHOC_STRESS = 0.25            # -25 % sur les revenus
SEUIL_ECART_MODULE = 0.0      # tout écart hors tolérance est listé


def _d(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ──────────────────────────────────────────────────────────────────
# ÉCHÉANCIER — intérêt dégressif sur capital restant dû, avec différé
# ──────────────────────────────────────────────────────────────────
def construire_echeancier(capital: Decimal, taux_annuel: Decimal,
                          duree_mois: int, differe_mois: int,
                          mode_differe: str = "interets_seuls") -> list[dict]:
    """
    mode_differe:
      - 'interets_seuls' : pendant le différé, le client paie les intérêts,
        le capital est intact (cas standard AGRICAP v4)
      - 'franchise_totale' : rien n'est payé, les intérêts sont capitalisés
    Amortissement : capital constant sur (duree - differe) mois,
    intérêts calculés chaque mois sur le capital restant dû (dégressif).
    """
    taux_mensuel = taux_annuel / Decimal(100) / Decimal(12)
    lignes, crd = [], capital
    n_amort = duree_mois - differe_mois
    amort_capital = _d(capital / n_amort) if n_amort > 0 else Decimal(0)

    for m in range(1, duree_mois + 1):
        interets = _d(crd * taux_mensuel)
        if m <= differe_mois:
            if mode_differe == "franchise_totale":
                crd = _d(crd + interets)
                lignes.append({"mois": m, "phase": "différé", "capital": 0.0,
                               "interets": 0.0, "interets_capitalises": float(interets),
                               "echeance": 0.0, "crd": float(crd)})
            else:
                lignes.append({"mois": m, "phase": "différé", "capital": 0.0,
                               "interets": float(interets),
                               "echeance": float(interets), "crd": float(crd)})
        else:
            cap = crd if m == duree_mois else amort_capital   # solde exact au dernier mois
            crd = _d(crd - cap)
            lignes.append({"mois": m, "phase": "amortissement", "capital": float(cap),
                           "interets": float(interets),
                           "echeance": float(_d(cap + interets)), "crd": float(crd)})
    return lignes


# ──────────────────────────────────────────────────────────────────
# C1 — FIABILITÉ TECHNIQUE (25 %)
# ──────────────────────────────────────────────────────────────────
def scorer_technique(plan_modules: dict, referentiel: ReferentielFiliere,
                     superficie: Decimal, bareme: BaremeScore) -> dict:
    """Compare chaque module du plan au référentiel filière (à l'unité de surface).
    Le score dépend de l'écart absolu moyen pondéré ; les écarts hors tolérance
    alimentent le canal de justification."""
    ecarts, hors_plage, total_plan, total_ref = [], [], Decimal(0), Decimal(0)

    for module, ref_cfg in referentiel.couts_modules.items():
        ref = Decimal(str(ref_cfg["ref"])) * superficie
        val = Decimal(str(plan_modules.get(module, {}).get("montant", 0)))
        total_plan += val
        total_ref += ref
        ecart_rel = float((val - ref) / ref) if ref else 0.0
        ecarts.append(abs(ecart_rel))
        tol_inf = ref_cfg.get("tol_inf", 0.30)
        tol_sup = ref_cfg.get("tol_sup", 0.40)
        if ecart_rel < -tol_inf or ecart_rel > tol_sup:
            hors_plage.append({
                "indicateur": f"cout_module:{module}",
                "valeur": float(val), "reference": float(ref),
                "ecart_pct": round(ecart_rel * 100, 1),
                "message": f"{module} : {ecart_rel:+.1%} vs référentiel"})

    ecart_moyen = sum(ecarts) / len(ecarts) if ecarts else 1.0
    score = bareme.evaluer(ecart_moyen)   # ex: 0%→100 ; 30%→70 ; 60%→30 ; >=80%→0
    return {
        "score": score, "poids": POIDS["technique"],
        "points": round(score * POIDS["technique"] / 100, 1),
        "details": {
            "total_plan": float(total_plan), "total_referentiel": float(total_ref),
            "ecart_moyen_pct": round(ecart_moyen * 100, 1),
            "referentiel": referentiel.code,
            "ecarts_hors_plage": hors_plage,
            "commentaire": (f"Total feuille {total_plan:,.0f} nettement inférieur au "
                            f"référentiel {total_ref:,.0f}"
                            if total_plan < total_ref * Decimal("0.5") else ""),
        },
        "hors_plage": hors_plage,
    }


# ──────────────────────────────────────────────────────────────────
# C2 — CAPACITÉ FINANCIÈRE / DSCR (20 %)
# ──────────────────────────────────────────────────────────────────
def calculer_dscr(cash_flows_mensuels: list[Decimal], echeancier: list[dict]) -> Decimal:
    """DSCR global = Σ cash-flows disponibles / Σ service de la dette
    sur la durée du crédit. Le DSCR minimum mensuel est aussi restitué en détail."""
    service_total = sum(Decimal(str(l["echeance"])) for l in echeancier)
    cf_total = sum(cash_flows_mensuels)
    return (cf_total / service_total).quantize(Decimal("0.001")) if service_total else Decimal(0)


def scorer_dscr(dscr: Decimal, bareme: BaremeScore) -> dict:
    score = bareme.evaluer(float(dscr))
    qualif = ("solide" if dscr >= Decimal("1.3") else
              "acceptable" if dscr >= Decimal("1.0") else "insuffisante")
    return {"score": score, "poids": POIDS["dscr"],
            "points": round(score * POIDS["dscr"] / 100, 1),
            "details": {"dscr": float(dscr),
                        "commentaire": f"DSCR = {dscr:.2f} ({qualif})"}}


# ──────────────────────────────────────────────────────────────────
# C3 — RÉSILIENCE AU STRESS (10 %) : revenus -25 %
# ──────────────────────────────────────────────────────────────────
def scorer_stress(cash_flows: list[Decimal], echeancier: list[dict],
                  bareme: BaremeScore) -> dict:
    cf_stress = [cf * (1 - Decimal(str(CHOC_STRESS))) for cf in cash_flows]
    dscr_s = calculer_dscr(cf_stress, echeancier)
    score = bareme.evaluer(float(dscr_s))
    return {"score": score, "poids": POIDS["stress"],
            "points": round(score * POIDS["stress"] / 100, 1),
            "details": {"dscr_stress": float(dscr_s),
                        "commentaire": f"Stress test -{int(CHOC_STRESS*100)}%"},
            "dscr_stress": dscr_s}


# ──────────────────────────────────────────────────────────────────
# C4 — HISTORIQUE COMPORTEMENTAL (30 %)
# ──────────────────────────────────────────────────────────────────
def scorer_comportemental(client, bareme: BaremeScore) -> dict:
    """Interroge le module Transactions/Wallet : crédits antérieurs, retards,
    incidents, régularité des flux. Score neutre 50 si aucun historique."""
    historique = _charger_historique(client)   # → None ou dict d'indicateurs
    if historique is None:
        return {"score": 50.0, "poids": POIDS["comportemental"], "points": 15.0,
                "details": {"commentaire": "Historique comportemental non disponible."}}
    # Indicateurs : taux de remboursement à l'heure, retard moyen (jours),
    # nb incidents, ancienneté wallet, régularité des flux entrants
    x = (historique["taux_a_lheure"] * 0.5
         + historique["regularite_flux"] * 0.3
         + historique["anciennete_norm"] * 0.2) * 100
    x -= historique["nb_incidents"] * 10
    score = max(0.0, min(100.0, round(x, 1)))
    return {"score": score, "poids": POIDS["comportemental"],
            "points": round(score * POIDS["comportemental"] / 100, 1),
            "details": historique}


def _charger_historique(client):
    """Branché sur les modèles du module Transactions dès leur migration Django.
    Retourne None tant que le client n'a ni crédit soldé ni 6 mois de wallet actif."""
    # TODO: implémentation lors du branchement au module Transactions
    return None


# ──────────────────────────────────────────────────────────────────
# C5 — GARANTIES & DOMICILIATION (15 %)
# ──────────────────────────────────────────────────────────────────
def scorer_garanties(demande, bareme: BaremeScore) -> dict:
    """Ratio de couverture = Σ valeur garanties / montant financé, ajusté par
    type (décotes) et par statut de constitution."""
    DECOTES = {"epargne": Decimal("1.0"), "immobilier": Decimal("0.7"),
               "actif": Decimal("0.6"), "Gage matériel": Decimal("0.6"),
               "Hypothèque": Decimal("0.7"), "morale": Decimal("0.3")}
    montant = demande.montant_finance or demande.montant_demande
    couverture = Decimal(0)
    constituees = True
    for g in demande.garanties:
        val = Decimal(str(g.get("value", 0)))
        couverture += val * DECOTES.get(g["type"], Decimal("0.5"))
        if not g.get("constituee", False):
            constituees = False
    ratio = float(couverture / montant) if montant else 0.0
    score = bareme.evaluer(ratio)
    commentaire = ""
    if not constituees:
        score = min(score, 60.0)   # plafond indicatif tant que non constituées
        commentaire = "Garanties non encore constituées — score indicatif."
    return {"score": score, "poids": POIDS["garanties"],
            "points": round(score * POIDS["garanties"] / 100, 1),
            "details": {"ratio_couverture": round(ratio, 2),
                        "constituees": constituees, "commentaire": commentaire}}


# ──────────────────────────────────────────────────────────────────
# BARÈME DE DÉCISION — 4 niveaux (AGRICAP-ANALYSTE v2)
# ──────────────────────────────────────────────────────────────────
def recommander(score_global: float, dscr: Decimal, hors_plage: list) -> str:
    """Règles de sûreté prioritaires sur le score :
    un DSCR < 1.0 ne peut jamais donner une approbation directe."""
    if score_global >= 75 and dscr >= Decimal("1.2") and not hors_plage:
        return "approbation"
    if score_global >= 60 and dscr >= Decimal("1.0"):
        return "approbation_cond"
    if score_global >= 45:
        return "revue"
    return "refus"


# ──────────────────────────────────────────────────────────────────
# ORCHESTRATION
# ──────────────────────────────────────────────────────────────────
def executer_analyse(demande, plan_upload, duree_mois: int, differe_mois: int,
                     taux_annuel: Decimal) -> AnalyseCredit:
    referentiel = ReferentielFiliere.objects.get(
        filiere__iexact=demande.culture, actif=True)
    baremes = {b.code: b for b in BaremeScore.objects.filter(actif=True)}
    plan_modules, cash_flows = _extraire_plan(plan_upload)   # lit l'Excel validé

    capital = demande.montant_finance or demande.montant_demande
    echeancier = construire_echeancier(capital, taux_annuel, duree_mois, differe_mois)

    c1 = scorer_technique(plan_modules, referentiel,
                          demande.superficie_ha, baremes["ECART_TECHNIQUE"])
    dscr = calculer_dscr(cash_flows, echeancier)
    c2 = scorer_dscr(dscr, baremes["DSCR"])
    c3 = scorer_stress(cash_flows, echeancier, baremes["DSCR"])
    c4 = scorer_comportemental(demande.client, baremes.get("COMPORTEMENTAL"))
    c5 = scorer_garanties(demande, baremes["COUVERTURE_GARANTIES"])

    criteres = {"technique": c1, "dscr": c2, "stress": c3,
                "comportemental": c4, "garanties": c5}
    score_global = round(sum(c["points"] for c in criteres.values()), 1)
    hors_plage = c1.get("hors_plage", [])
    reco = recommander(score_global, dscr, hors_plage)

    return AnalyseCredit.objects.create(
        demande=demande, plan=plan_upload, referentiel=referentiel,
        duree_mois=duree_mois, differe_mois=differe_mois, taux_annuel=taux_annuel,
        criteres=criteres, dscr=dscr, dscr_stress=c3["dscr_stress"],
        score_global=score_global, recommandation=reco,
        indicateurs_hors_plage=hors_plage, echeancier=echeancier)


def _extraire_plan(plan_upload) -> tuple[dict, list[Decimal]]:
    """Lit le fichier Excel DÉJÀ VALIDÉ (étape 1) : montants par module +
    cash-flows mensuels prévisionnels (feuille 'Tresorerie' du template)."""
    wb = load_workbook(plan_upload.fichier.path, data_only=True)
    tpl = plan_upload.template
    ws = wb[tpl.feuille]
    modules = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0]:
            modules[str(row[0]).strip().lower()] = {"montant": row[1] or 0}
    cash_flows = []
    if "Tresorerie" in wb.sheetnames:
        for row in wb["Tresorerie"].iter_rows(min_row=2, values_only=True):
            if isinstance(row[1], (int, float)):
                cash_flows.append(Decimal(str(row[1])))
    return modules, cash_flows
```

---

## 5. Barèmes initiaux (fixture `baremes_initiaux.json` — calibrables en base)

| Code | Points (x → y) | Lecture |
|---|---|---|
| `DSCR` | 0.4→0 · 0.7→25 · 1.0→50 · 1.3→85 · 1.5→100 | DSCR 0.64 → 19–25/100 ; 1.3 = seuil de confort |
| `ECART_TECHNIQUE` | 0.00→100 · 0.15→85 · 0.30→60 · 0.50→30 · 0.80→0 | écart moyen 80 %+ vs référentiel = 0 |
| `COUVERTURE_GARANTIES` | 0.0→0 · 0.5→40 · 1.0→75 · 1.5→100 | couverture 100 % après décotes = 75 |

Ces courbes reproduisent l'esprit de l'exemple de référence (DSCR 0.636 → ≈19/100 ; écarts −72 à −100 % → 0/100). Comme elles vivent en base (`BaremeScore`), le **comité de crédit peut les recalibrer** à mesure que la boucle d'apprentissage (N ≥ 30 dossiers réels par filière) affine les référentiels — sans toucher au code.

---

## 6. Intégration au pipeline (`pipeline.py` — ajout)

```python
# Dans PipelineValidationCredit.executer(), après l'étape 2 :
if r2.succes and upload:
    analyse = executer_analyse(
        self.demande, upload,
        duree_mois=self.demande.modules.get("duree_mois", 8),
        differe_mois=self.demande.modules.get("differe_mois", 0),
        taux_annuel=Decimal(str(self.demande.modules.get("taux_annuel", "18.0"))))
    self.demande.score = analyse.score_global
    self.demande.score_lettre = ("A" if analyse.score_global > 85 else
                                 "B" if analyse.score_global > 70 else
                                 "C" if analyse.score_global > 50 else "D")
    self.demande.save(update_fields=["score", "score_lettre", "maj_le"])
    self._journaliser("analyse", True, [], [],
                      extra={"score_global": float(analyse.score_global),
                             "dscr": float(analyse.dscr),
                             "recommandation": analyse.recommandation,
                             "analyse_id": analyse.pk})
```

Ajouter `ANALYSE = "analyse", "2bis. Analyse & scoring"` aux choix `JournalValidation.Etape`.

---

## 7. Endpoints complémentaires

| Méthode | Endpoint | Vue | Contenu |
|---|---|---|---|
| `GET` | `/api/credits/admin/demandes/{ref}/analyse/` | Admin | Analyse complète : 5 critères, écarts par module, DSCR, échéancier, recommandation, indicateurs hors plage |
| `POST` | `/api/credits/admin/demandes/{ref}/analyse/justifier/` | Admin | `{"indicateur": "cout_module:semences", "justification": "..."}` → canal de justification, journalisé |
| `POST` | `/api/credits/admin/demandes/{ref}/reanalyser/` | Admin | Ré-exécute le moteur (nouveau `AnalyseCredit`, l'ancien reste) |
| `GET` | `/api/credits/demandes/{ref}/analyse-resume/` | **Client** | Version simplifiée : score lettre, points forts / points à améliorer, **sans** les seuils internes ni les barèmes |
| `GET/POST/PATCH` | `/api/credits/admin/referentiels-filiere/` | Admin | Gestion des référentiels + suivi `n_cas_reels` (boucle d'apprentissage) |
| `GET/PATCH` | `/api/credits/admin/baremes/` | Admin (comité) | Recalibrage des courbes de score |

**Réponse `GET .../analyse/` (contrat frontend admin)** :

```json
{
  "reference": "CRD-2026-0042",
  "referentiel": "AGRICAP_FIN_SIM_01_Cereales_Mais",
  "parametres": {"duree_mois": 8, "differe_mois": 5, "taux_annuel": 18.0},
  "score_global": 29.2,
  "recommandation": "refus",
  "dscr": 0.636,
  "dscr_stress": 0.477,
  "criteres": {
    "technique": {"score": 0.0, "poids": 25, "points": 0.0,
      "details": {"total_plan": 1330, "total_referentiel": 9111,
        "ecarts_hors_plage": [
          {"indicateur": "cout_module:semences", "ecart_pct": -81.0,
           "message": "semences : -81.0% vs référentiel"},
          {"indicateur": "cout_module:equipements", "ecart_pct": -100.0,
           "message": "equipements : -100.0% vs référentiel"}
        ]}},
    "dscr": {"score": 19.1, "poids": 20, "points": 3.8,
      "details": {"commentaire": "DSCR = 0.64 (insuffisante)"}},
    "stress": {"score": 14.3, "poids": 10, "points": 1.4,
      "details": {"commentaire": "Stress test -25%"}},
    "comportemental": {"score": 50.0, "poids": 30, "points": 15.0,
      "details": {"commentaire": "Historique comportemental non disponible."}},
    "garanties": {"score": 60.0, "poids": 15, "points": 9.0,
      "details": {"commentaire": "Garanties non encore constituées — score indicatif."}}
  },
  "echeancier": [
    {"mois": 1, "phase": "différé", "capital": 0, "interets": 19.95, "echeance": 19.95, "crd": 1330.0},
    {"mois": 6, "phase": "amortissement", "capital": 443.33, "interets": 19.95, "echeance": 463.28, "crd": 886.67}
  ]
}
```

---

## 8. Impact frontend

**a) Vue client — `SimulateurIntelligent` (Credits.jsx).** Le score actuel est fictif (`Math.random()` sur les coûts, formule arbitraire). Deux options :

- *Option légère (recommandée)* : le simulateur reste indicatif côté client (pédagogique), mais le `SuccessMessage` et la page de suivi affichent le **score réel** issu de `analyse-resume` après soumission, avec la mention « score officiel après analyse ».
- *Option temps réel* : un endpoint `POST /api/credits/simuler/` exécute le moteur en mode brouillon (sans persistance d'`AnalyseCredit`) à chaque ajustement des sliders. Plus séduisant, mais expose le comportement du moteur au client — à arbitrer (risque de *gaming* du score).

**b) Vue admin — `CreditDetailsModal.jsx`.** Ajouter un onglet « Analyse » : tableau des 5 critères (score × poids = points), écarts par module avec badge rouge si hors plage, DSCR + stress, échéancier prévisionnel (le composant tableau des mouvements existant se réutilise tel quel), bandeau de recommandation coloré (vert / orange / jaune / rouge selon le barème 4 niveaux), et bouton « Justifier un indicateur » (canal de justification).

**c) Vue admin — `RateMaturityModal.jsx`.** Ce modal existant (taux/maturité) devient l'endroit où l'analyste ajuste durée / différé / taux puis clique « Ré-analyser » → `POST .../reanalyser/` → l'échéancier et le DSCR se recalculent instantanément. C'est le simulateur admin.

---

## 9. Points de vigilance spécifiques au moteur

1. **Asymétrie d'information volontaire** : le client voit son score et des recommandations d'amélioration ; il ne voit **jamais** les barèmes, tolérances ni référentiels chiffrés (anti-gaming, cohérent avec AGRICAP-ANALYSTE v2 §fraude).
2. **Immuabilité des analyses** : jamais d'UPDATE sur `AnalyseCredit` — toute ré-analyse crée une nouvelle ligne. L'écart entre deux analyses successives d'un même dossier est lui-même un signal de fraude (modification du plan entre deux uploads — comparer les hash SHA-256).
3. **Le différé coûte cher au DSCR** : avec 5 mois de différé sur 8 mois, tout le capital s'amortit sur 3 mois — c'est précisément ce qui produit un DSCR de 0.64 dans l'exemple. Le moteur doit exposer ce diagnostic à l'analyste (« un différé de 3 mois porterait le DSCR à X ») : ajout futur simple, une boucle sur `differe_mois` dans `reanalyser`.
4. **Cohérence devise** : référentiels stockés en USD ; conversion CDF via le `ExchangeRateManager` existant (module Accounting) au taux du jour de l'analyse, taux journalisé dans `AnalyseCredit.criteres`.
5. **Échantillonnage de validation humaine** (AGRICAP-ANALYSTE v2) : X % des dossiers « approbation » passent quand même en revue manuelle — un simple flag aléatoire pondéré à la création de l'analyse.

---

## 10. Ordre d'implémentation (s'ajoute au sprint pipeline)

1. Modèles `ReferentielFiliere`, `BaremeScore`, `AnalyseCredit` + fixtures (référentiel Maïs depuis AGRICAP_FIN_SIM_01, 3 barèmes) — ½ jour
2. `construire_echeancier` + tests (différé intérêts seuls, franchise totale, solde exact) — ½ jour
3. Les 5 scoreurs + orchestration + tests sur le cas réel (attendu : score ≈ 29, reco refus) — 1,5 jour
4. Endpoints analyse/justifier/reanalyser + permissions — 1 jour
5. Onglet « Analyse » dans `CreditDetailsModal` + branchement `RateMaturityModal` — 1,5 jour

**Total pipeline + moteur : ~10 jours-homme.**

---

## Annexe A — Échéancier prévisionnel : formules et exemple chiffré

### A.1 Formules

Notations : `C` capital décaissé, `t_m = taux_annuel / 12 / 100` taux mensuel, `D` durée totale (mois), `F` différé (mois), `N = D − F` mois d'amortissement, `CRD_m` capital restant dû au début du mois m.

**Phase 1 — Différé (mois 1 à F)**, deux modes :

| Mode | Principal | Intérêts payés | Mensualité | Évolution CRD |
|---|---|---|---|---|
| `interets_seuls` (standard AGRICAP v4) | 0 | `CRD_m × t_m` | intérêts seuls | constant = C |
| `franchise_totale` | 0 | 0 (capitalisés) | 0 | `CRD_{m+1} = CRD_m × (1 + t_m)` |

**Phase 2 — Amortissement (mois F+1 à D)**, capital constant, intérêt dégressif :

- Tranche de capital : `A = CRD_{F+1} / N` (en franchise totale, `CRD_{F+1} = C × (1 + t_m)^F`)
- Intérêts du mois m : `I_m = CRD_m × t_m` — **toujours calculés sur le solde de début de mois**, avant le paiement du mois
- Mensualité : `A + I_m` (décroissante — c'est le « dégressif »)
- Dernier mois : la tranche de capital est ajustée au solde exact pour absorber les centimes d'arrondi (`cap = CRD_D`), garantissant un solde final rigoureusement nul

Grandeurs dérivées : coût total du crédit = `Σ I_m` ; service de la dette = `Σ mensualités` (dénominateur du DSCR).

### A.2 Exemple chiffré — cas réel (C = 1 330 USD, 18 %/an, D = 8, F = 5)

**Mode `interets_seuls`** (t_m = 1,5 % ; A = 1 330/3 = 443,33) :

| Mois | Phase | Principal | Intérêts | Mensualité | Solde |
|---|---|---|---|---|---|
| 1 | Différé | 0,00 | 19,95 | 19,95 | 1 330,00 |
| 2 | Différé | 0,00 | 19,95 | 19,95 | 1 330,00 |
| 3 | Différé | 0,00 | 19,95 | 19,95 | 1 330,00 |
| 4 | Différé | 0,00 | 19,95 | 19,95 | 1 330,00 |
| 5 | Différé | 0,00 | 19,95 | 19,95 | 1 330,00 |
| 6 | Amortissement | 443,33 | 19,95 | 463,28 | 886,67 |
| 7 | Amortissement | 443,33 | 13,30 | 456,63 | 443,34 |
| 8 | Amortissement | 443,34 | 6,65 | 449,99 | 0,00 |

Coût total des intérêts : **139,65** · Service de la dette : **1 469,65** · Avec cash-flows ≈ 935 → **DSCR = 0,636**.

**Mode `franchise_totale`** (intérêts capitalisés — CRD gonfle à 1 432,78 fin de différé ; A = 477,59) :

| Mois | Phase | Principal | Int. capitalisés | Mensualité | Solde |
|---|---|---|---|---|---|
| 1–5 | Franchise | 0,00 | 19,95 → 21,17 | 0,00 | 1 349,95 → 1 432,78 |
| 6 | Amortissement | 477,59 | 21,49 | 499,08 | 955,19 |
| 7 | Amortissement | 477,59 | 14,33 | 491,92 | 477,60 |
| 8 | Amortissement | 477,60 | 7,16 | 484,76 | 0,00 |

Service de la dette : 1 475,76 concentré sur 3 mois → DSCR encore plus dégradé. La franchise totale ne doit être proposée que si les cash-flows agricoles sont strictement nuls avant récolte.

### A.3 ⚠ Écart détecté avec le simulateur Excel v4

Le tableau produit par `AGRICAP_FIN_SIM_01` affiche des intérêts de **25**/mois pendant le différé sur un capital de 1 330. Or 1 330 × 18 %/12 = **19,95**. Un intérêt de 25 correspond à un taux effectif d'environ 22,6 %/an. À vérifier dans le fichier Excel :

1. Une **commission mensuelle** (~0,38 %/mois) est-elle intégrée au calcul sans être affichée séparément ? Si oui, la déclarer comme ligne distincte de l'échéancier (`commission`) — exigence de transparence client et de conformité (TEG).
2. L'intérêt est-il calculé sur une **base différente** du capital décaissé (montant demandé avant ajustement ≈ 1 667 ?) ?
3. Simple **erreur de formule** (référence de cellule figée sur un autre montant) ?

Le moteur Django fait foi une fois calibré : ajouter un test de non-régression comparant sa sortie au simulateur Excel corrigé (tolérance ±0,01). Ce type d'écart est précisément ce que la famille « cohérence des flux » des contrôles de plausibilité AGRICAP-ANALYSTE doit signaler automatiquement.

### A.4 Affichage frontend

- **Admin** (`CreditDetailsModal`, onglet Analyse) : tableau complet des D lignes + totaux (intérêts, service dette) + le champ `commission` si activé.
- **Client** (page de suivi après approbation) : même tableau, présenté comme « Votre calendrier de remboursement », avec les échéances passées cochées au fil des remboursements enregistrés (rapprochement avec le journal des mouvements financiers déjà présent dans le modal).
- Les longues durées sont tronquées à l'affichage (« … n échéances supplémentaires ») avec export Excel/PDF complet via le module `export.js` existant.

# AUDIT GÉNÉRAL — AGRICAP FINTECH — 2026-07-25

> Posture : lecture seule. Aucun fichier de code modifié pendant l'audit (seul ce rapport
> est écrit). Chaque constat porte sa preuve `fichier:ligne` + commande. Les constats déjà
> présents dans la documentation d'état sont marqués « déjà déclaré ».
>
> **Couverture honnête.** L'audit a tourné en flotte read-only. Deux axes ont été traités
> par un auditeur dédié complet (A conformité, J documentation) ; les autres (B–I) par
> mesure directe de l'orchestrateur, greps reproductibles + inspection ciblée, **sans
> lecture ligne à ligne des 26 000 lignes de `credits`**. Les zones marquées « à
> approfondir » n'ont pas reçu d'inspection qualitative par occurrence.

---

## 1. Synthèse (verdict)

Le système a **nettement progressé** depuis l'audit du 25/07 matin : les 4 IDOR critiques sont
fermés, la comptabilité est branchée aux événements métier, l'échéancier réel est en `Decimal`,
la dette bloquante P1 (`request.roles`) est résorbée. **Le socle est sain et testé** (≈2 400
tests backend + 814 front, verts).

**Les trois risques dominants restants** ne sont plus des trous de correctité mais des
**écarts de gouvernance et de complétude** :
1. **Config de production permissive par défaut** (`SECRET_KEY`/`DEBUG`) — le seul risque
   réellement *bloquant* pour une mise en production.
2. **~26 endpoints backend servis sans écran** — surtout le back-office investissement (14) et
   le flux de caution proposée (9) : des fonctionnalités livrées et testées, inatteignables.
3. **Documentation d'état qui ment** — plusieurs docs se contredisent et présentent comme
   « non résolu » ce qui l'est, envoyant retravailler du fait.

**Verdict de mise en production : NON en l'état**, pour un seul motif dur (config par défaut).
Tout le reste est de la complétude ou de l'arbitrage, pas de la correctité cassée.

---

## 2. Tableau de bord — ligne de base reproduite

| Mesure | Prompt (25/07 matin) | Reproduit (25/07 soir) | Écart |
|---|---|---|---|
| `path()` dans `*/urls.py` | 335 | **335** | = |
| Endpoints (hors routage racine) | ~307 | **~307** | = |
| Pages front | 61 | **62** | +1 |
| Routes `App.jsx` | 63 | **64** | +1 |
| Tests front (vitest fichiers) | 45 | **48** | +3 |
| `localStorage`/`sessionStorage` hors tests | 24 | **13** | **−11** (retrait épargne) |
| `Math.random` (fichiers) | 7 | **6** | −1 |
| `float(` dans `*/serializers.py` | 54 | **54** | = |
| Migrations `RunPython` | 10 | **10** (8 sans `reverse_code`) | = |
| `SECRET_KEY`/`DEBUG` défaut | `dev-insecure` / `true` | **inchangé** | = |

Les écarts sont eux-mêmes des faits : le dépôt a bougé aujourd'hui (localStorage 24→13,
Math.random 7→6, +3 tests). Aucun écart ne contredit la mesure d'origine.

---

## 3. Constats par axe

### A. Conformité aux 11 principes de `CLAUDE.md` — *(auditeur dédié)*

| Principe | Verdict | Preuve |
|---|---|---|
| P1 Scoré = en base | ✅ Respecté | Front envoie `application_code` (`Credits.jsx:1359,1434`), moteur lit les `DataRecord`. Résidu : `credits/needs_parser.py` legacy présent, non emprunté |
| P2 Moteur recommande | ✅ Respecté | `approve` = `CAN_DECIDE` + délégation ; `reanalyser` ne transite pas |
| P3 Append-only | ✅ Respecté | `workflow.py::_audit_transition` ×9. **Tension** : piste d'audit épargne en `localStorage` |
| P4 Decimal | 🟠 **Partiel** | Moteur `analyse.py`/`echeancier.py` Decimal ; **chemin `simulate/` en float (38 occ. `dataio_simulator.py`)** ; `_to_usd` CDF→USD non journalisé (`workflow.py:181-197`, dette assumée) |
| P5 Valider→ingérer | ✅ Respecté | 6 contrôles 422 `{code,message}` |
| P6 Une implémentation | ✅ backend / 🟠 front | Grille de taux **unifiée** (`BaremeScore TAUX`), échéancier crédit **unifié**. Restent : **3 écrans `pages/credit/**` à grille de lettre divergente** |
| P7 Anti-gaming | ✅ serveur, 🔴 **3 fuites résiduelles** | Sérialiseur client sans barème (`analyse.py:1445`) MAIS `_filtrer_simulation` ne retire pas `points`, `detail`, `refData.referentielFiliere`/`sourceFile` (cf. axe D) |
| P8 Règles en base | ✅ Respecté, résidus | Bandes en dur dans `simulate/` ; `DISCREPANCY_TOLERANCE` **corrigé aujourd'hui** (→ `CaisseConfig`) |
| P9 Garantie opposable | ✅ Respecté | `select_for_update` anti-double-gage (`assets/services.py:125`), consentement 72 h re-vérifié |
| P10 Boucle d'apprentissage | 🟠 Partiel | Fondation présente ; `n_cas_reels` alimenté par `workflow.close()` (exposé aujourd'hui), loop N≥30 non prouvé |
| P11 Template admin | ✅ backend, résidus | `download` sert le template actif, 503 si aucun. **Fichier statique 22 Ko non supprimé + UI admin templates absente** |

### B. Câblage endpoint ↔ écran — *(mesure orchestrateur, recoupement précis)*

**307 routes, 26 servies sans écran** (chaque `<param>` traité comme joker `${...}`) :

| App | Nb | Nature |
|---|---|---|
| `investments` | 14 | **Back-office P01→P13** : `expert-valuation`, `approve-analysis`, `clear-conditions`, `close-fundraising`, `disburse`, `record-return`, `cancel`, `offers/<id>/close|distribute`, `subscriptions/<id>/settle`, `transitions`, `committee-votes`, `credit-application`, `accounting-events` |
| `credits` | 9 | **Flux caution proposée** (`guarantee-proposals/`, `queue`, `validate`, `refuse`, `candidates`, `applications/<code>/guarantee-proposals`) + `close/`, `renew-consent/`, `analysis-report/` (ce dernier en cours via page DG partielle) |
| `fx` | 2 | `rates/pending` + `rates/<id>/validate` (validation maker-checker des taux) |
| `savings` | 1 | `plans/<id>/withdraw` (retrait créé aujourd'hui) |

**Population 2 (écran → route inexistante) : néant** — la route fantôme `justifications` a été
corrigée. **Population 3 (action fantôme `toast`) : à approfondir** (non chiffrée finement ;
l'écran Caisses livré aujourd'hui a purgé ses boutons fantômes).

Sévérité : majeure (fonctionnalités payées, invisibles). Coût : ~1 écran/bloc, 2–6 h chacun.

### C. Intégrité financière — *(mesure orchestrateur)*

**54 `float(` en serializers, concentrés** : `investments` 38, `caisses` 13, `ledger`/`portfolio`/`transactions` 1 chacun. Nature : **sérialisation JSON de sortie**, pas calcul — le dépôt a tranché explicitement dans les deux sens (`payment_order_row` en `str(Decimal)` avec justification ; `account_row` en `float` assumé). **Tension à arbitrer, pas fuite** : sérialiser un montant en `float` expose à l'arrondi binaire *sur le fil* ; sans être un calcul faux, ce n'est pas conforme à la lettre du principe 4. Recommandation : sérialiser les montants en `string` (comme l'échéancier), lot ciblé sur `investments/serializers.py`.

**`FloatField` de modèle restants** (P4) : `referentiel` 8 (fractions/mortalité — hors argent mais entrent dans le scoring), `credits.financial_confidence` (score 0-100), notations `suppliers`/`agencies`/`analytics` (0-5, non monétaire). Les champs **monétaires** ont été migrés aujourd'hui (`portfolio`, `investments.PerformanceReport`, `referentiel` seuils, `alerts`).

**Invariants** (vérifiés présents + testés) : CRD final nul sur les **trois** échéanciers (`credits/echeancier.py`, `portfolio/schedule.py`, `investments/echeancier_retour.py`) ; Σ principal = capital ; devise portée par tout montant. **Dette confirmée** : `_to_usd` (`workflow.py:181-197`) convertit CDF→USD **sans journaliser taux+date** — déjà déclarée.

### D. Sécurité & permissions — *(mesure orchestrateur)*

- 🔴 **`SECRET_KEY = "dev-insecure-change-me"` + `DEBUG=true` par défaut** (`config/settings.py:33-34`), sans garde *fail-closed*. **Bloquant prod** : sans variables d'env, tracebacks exposés et clé publique connue → forge de sessions signées. Coût : ~1 h (refuser le démarrage en prod sans vraie clé).
- ✅ **Callback fournisseur** `payment_callback` en `AllowAny` (`caisses/views.py:630`) **mais signature-gated** : `handle_callback` (`payments.py:1001`) rejette sans signature RSA valide. **Choix correct**, pas une faille — un callback ne peut pas s'authentifier autrement.
- 🔴 **3 fuites P7 dans `_filtrer_simulation`** (confirmées par le lot « rapport client » ; l'agent de correction a été tué au démarrage, **toujours ouvertes**) : `points` (= `score×poids/100`, livre la pondération), `detail` (prose citant barèmes/ratios), `refData.referentielFiliere`/`sourceFile`. Majeur. Coût : ~2 h.
- ✅ **Asymétrie `account_action`** (`validate` seul) **corrigée aujourd'hui** → `[IsStaff, validate]`. Recherche d'autres cas du même type : à approfondir.
- **`permission_classes` : 0 manquant** en apparence — mais `credits/views.py` posait ~25 gardes *dans le corps* (`_require_*`), **migrées en déclaratif aujourd'hui**. Confirmé.

### E. Machines à états & maker≠checker — *(mesure orchestrateur)*

- **`portfolio /action` contourne toujours le workflow** (`portfolio/services.py`, déjà déclaré) — écriture de statut hors machine à états. Majeur, non résorbé.
- Écritures directes de `status` hors workflow : concentrées dans `agencies/services.py` et `alerts/services.py` — **domaines propres** (cycle de vie agence, cycle d'alerte), pas la machine crédit/investissement. Acceptable, à confirmer au cas par cas.
- maker≠checker **effectif** au décaissement, approbation, rejet (testé `disbursement.py:179-183`). Activation de template/`ValueChain`/barème : présent. **`ActionApproverConfig` non câblé dans les vues caisse** (déjà déclaré `MISSING.md`) — à chiffrer.

### F. Append-only & auditabilité — *(mesure orchestrateur)*

- **8 apps** ont des modèles probants qui lèvent sur `save`/`delete` : `accounting`, `audit`, `caisses`, `credits`, `fx`, `investments`, `savings`, `support`. Inviolabilité **au niveau modèle**, pas seulement par convention. ✅
- **`audit.services.record` : 39 appelants** hors app `audit`. Couverture large. À approfondir : la liste exhaustive des opérations monétaires *sans* trace (non établie finement ici).

### G. Idempotence, concurrence, migrations — *(mesure orchestrateur)*

- **Idempotence** appelée sur les chemins monétaires réels : `caisses` (payments, services, withdrawal_tiers, regularization), `credits/disbursement`, `investments/funding`+`obligations`. `common/idempotency` unique. ✅
- **`select_for_update` : 46 occurrences / 16 fichiers** — couvre double-gage (`assets`), double-débit (`caisses`, `portfolio`, `savings`), souscription (`investments`), FX. ✅
- **Tests de concurrence** : présents dans `caisses/tests.py` et `investments/tests.py` (verrous-espions ajoutés aujourd'hui). **Manque** : le test threadé du double-gage `assets` (le verrou est en code, le test est séquentiel — déjà relevé le matin). Coût : ~2 h.
- **`RunPython` : 8 des 10 sans `reverse_code`** — mais ce sont des **seeds** (`alerts`, `ledger` chart, `fx` source, `investments 0005`, `portfolio 0003`, `assets` vocab). Un seed sans reverse est un mineur, pas une irréversibilité de schéma. `ledger 0003/0004` et `credits 0005` ont leur reverse.

### H. Front — *(mesuré, qualification par occurrence à approfondir)*

- **13 `localStorage` hors tests** (était 24). Connus métier : les 5 modales `admin/savings` — **backend de persistance livré aujourd'hui**, la migration front a été faite (`c985e3f`) ; un auditeur relève encore des mentions (à requalifier : code actif vs commentaire documentant le retrait). Le reste : à trier préférence d'affichage vs donnée métier.
- **6 `Math.random`** : au moins un survivant en back-office (`AgricapComponents.jsx`, courbe décorative) relevé le matin ; front investisseur propre. À qualifier occurrence par occurrence.
- Formateur de montants unique, devise jamais en dur : **garde-fous actifs** (`noHardcodedCurrency`, `montantsEnDur` — tests verts).

### I. Tests — *(mesure orchestrateur)*

- **Zones aveugles confirmées** : `accounts` (**authentification, 3 lignes de test**) — le plus grave ; `notifications` **18 lignes**, `suppliers` **18 lignes** quasi nus ; `support` 320/2477 (fin, + 8 échecs préexistants tickets/SMS).
- Golden set de scoring : présent (`tests_analyse`, invariants poids=100, points=score). Transitions interdites testées (403/409) : oui côté crédit. Test anti-gaming des serializers client : oui (`tests_analyse`), **mais** ne couvrait pas les 3 fuites `simulate/` (axe D).

### J. Cohérence documentaire — *(auditeur dédié)*

1. 🔴 **`CREDIT_MODULE_STATUS.md` se contredit** : §4.3 « grille de taux unifiée » vs section « contradiction non arbitrée » (l.761-766). Le code tranche pour §4.3 ; la 2ᵉ section est **obsolète**.
2. **Même doc** liste comme « non résolues » `RateMaturityModal` localStorage et « pas de `permission_classes` déclaratives » — **les deux sont corrigées**.
3. **`MISSING.md` vs `GAPS_FRONTEND_BACKEND.md`** se contredisent sur le maker-checker agences.
4. **`CLAUDE.md §11` + 3 docs** pointent le fichier statique comme dette entière alors que le mécanisme est livré.
5. Fragments `docs/status-fragments/*` non fusionnés → source de vérité éclatée.

---

## 4. Top 10 priorisé (exécutable en prompts de correction)

| # | Action | Axe | Sévérité | Coût | Dépend de |
|---|---|---|---|---|---|
| 1 | Config prod fail-closed : refuser le démarrage sans `SECRET_KEY`/`DEBUG=false` réels | D | 🔴 bloquant | 1 h | — |
| 2 | Fermer les 3 fuites P7 de `_filtrer_simulation` (`points`, `detail`, `refData`) + test | D/P7 | 🔴 majeur | 2 h | — |
| 3 | Écran back-office investissement (14 endpoints P01→P13, dont `expert-valuation`) | B | majeur | 1–2 j | — |
| 4 | Écrans du flux caution proposée (9 endpoints) | B | majeur | 1 j | — |
| 5 | `portfolio /action` → passer par le workflow | E | majeur | 3 h | — |
| 6 | Journaliser taux+date dans `_to_usd` (`workflow.py:181`) | C/P4 | majeur | 1 h | — |
| 7 | Réconcilier la doc d'état (STATUS, MISSING, GAPS) au code réel | J | majeur | 3 h | — |
| 8 | Test de concurrence du double-gage `assets` (threadé) | G | mineur | 2 h | — |
| 9 | Sérialiser les montants `investments` en `string` (38 `float`) | C | mineur | 3 h | — |
| 10 | Tests de `accounts` (authentification, 3 lignes aujourd'hui) | I | majeur | 4 h | — |

---

## 5. Tensions à arbitrer (décision du fondateur, pas de recommandation unilatérale)

- **`float` de sérialisation des montants** : assumé et commenté à certains endroits, incohérent à d'autres (`account_row` float vs `payment_order_row` string). Trancher : tout en `string` (précision de bout en bout) ou tout en `float` assumé (simplicité) — mais **une seule règle**.
- **`ledger` vs `accounting`** : deux grands livres coexistent (la page Comptabilité affiche les deux en nommant leur source). Collision du compte **137**. Quel moteur fait autorité.
- **Compte de dette de portefeuille** (classe 4, passif, FC/USD) : sans lui, l'épargne des membres n'est nulle part au bilan ; B8/B9 et B10 en dépendent. Montant déjà chiffré par `montants_en_attente()`.
- **Tranches de décaissement étalées** : amortir le total depuis la date d'effet (courant) vs ré-amortir à chaque tranche — question de convention de crédit.
- **Catalogue d'opérations Makuta** : 11 points bloquants (`manage.py check_makuta` sort la checklist à envoyer à Wolf Technologies).

---

## 6. Périmètre non couvert (honnêteté §3.6)

- Aucune suite de tests ré-exécutée pendant l'audit (comptes verts pris comme acquis).
- `credits` (26 000 lignes) échantillonné, pas lu intégralement.
- Axes B (population 3 « actions fantômes »), H (qualification par occurrence des 13 localStorage / 6 Math.random) : **mesurés, non qualifiés finement** — leurs auditeurs dédiés ont été interrompus par la limite de session.
- Aucun rendu ouvert en navigateur ; aucun appel réseau réel.
- Modules hors crédit/caisses (IDP, `contracts`, `partners`) non inspectés en profondeur.

## 7. Questions qui reviennent au fondateur

1. Règle unique de sérialisation des montants (string vs float) ?
2. `ledger` ou `accounting` fait autorité — et le compte 137 ?
3. Ouvre-t-on le compte de dette de portefeuille (avec B10 dans le même mouvement) ?
4. Convention pour les décaissements en tranches étalées ?
5. Quand obtient-on le catalogue Makuta de Wolf Technologies ?

---

## Annexe — commandes de mesure (rejouables)

```bash
# Surface
grep -rh "^\s*path(" backend/*/urls.py | wc -l           # 335
find src/pages -name "*.jsx" -o -name "*.tsx" | wc -l     # 62
grep -c "<Route" src/App.jsx                              # 64
# Signaux
grep -rl "localStorage\|sessionStorage" src/ --include=*.jsx --include=*.js --include=*.ts --include=*.tsx | grep -v "\.test\." | wc -l   # 13
grep -rl "Math.random" src/ | grep -v "\.test\." | wc -l # 6
grep -rh "float(" backend/*/serializers.py | wc -l        # 54
# Concurrence / migrations
grep -rln "select_for_update" backend/*/*.py | grep -v test        # 16 fichiers
for f in $(grep -rl "RunPython" backend/*/migrations/*.py); do echo "$f $(grep -c reverse_code $f)"; done
# Config
grep -n "SECRET_KEY\s*=\|DEBUG\s*=" backend/config/settings.py
# Câblage (script Python de recoupement route↔src dans l'historique de l'audit)
```

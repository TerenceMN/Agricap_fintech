# Moteur d'analyse — backend

> Lot « moteur d'analyse technico-économique » (SPEC_Moteur_Analyse_Credits_AGRICAP).
> Périmètre : `backend/credits/` uniquement. Aucun fichier de `src/` touché.

---

## 1. Livré

| Fichier | Contenu |
|---|---|
| `backend/credits/models.py` | `ReferentielFiliere`, `BaremeScore`, `AnalyseCredit` (+ `ImmutableAnalyse`) |
| `backend/credits/migrations/0010_baremescore_referentielfiliere_analysecredit.py` | Migration — **rollback puis re-migration testés** |
| `backend/credits/analyse.py` | Les 5 scoreurs, l'orchestration, les sérialiseurs staff / client |
| `backend/credits/management/commands/seed_analyse.py` | Fixtures idempotentes (`update_or_create`) |
| `backend/credits/views.py` (fin de fichier) | 4 endpoints |
| `backend/credits/urls.py` | Routes |
| `backend/credits/tests_analyse.py` | **64 tests** |

`credits/echeancier.py` est **réutilisé tel quel**, non réécrit. La convention
d'exceptions de `credits/workflow.py` (`code`, `http_status`, `as_errors()`) est
copiée dans `AnalyseError`. Aucun rôle nouveau : tout passe par `credits/roles.py`.

**Tests** : 580 au total (baseline 516 + 64). `OK` hors les **8 échecs
préexistants de `support/`**, non touchés. Compte à jour en §5bis.

---

## 2. Écarts SPEC ↔ code réel

### 2.1 Modèles que la SPEC référence et qui n'existent pas

| SPEC | Réel | Conséquence |
|---|---|---|
| `DemandeCredit` | `CreditApplication` | `demande.culture` → `application.value_chain` ; `demande.superficie_ha` → `area_ha` ; `montant_finance` → `amount_approved or amount_requested` |
| `PlanFinancierUpload` | `dataio.DataSource` via `application.needs_source` | `_extraire_plan()` (lecture openpyxl) **supprimé** : le moteur lit `extract_module_totals()` sur les `DataRecord` — principe 1 |
| `demande.garanties` (liste de dicts) | `CreditGuarantee` | La table de décotes en dur de la SPEC est supprimée au profit de `retained_coverage` (cf. §2.4) |
| `credits/pipeline.py` (SPEC §6) | **n'existe pas** | L'intégration au pipeline n'est pas livrée — cf. §6 |

`AnalyseCredit.application` est en **PROTECT** et non `CASCADE` comme l'écrit la
SPEC : une analyse est une pièce probante, elle ne disparaît pas avec le dossier.

### 2.2 ⚠ Les cash-flows n'ont aucune source de données

La SPEC lit les cash-flows dans une feuille **`Tresorerie`** du template. Cette
feuille **n'existe pas** : `dataio.services.FEUILLE_BESOINS_SHEETS` ne commit que
`4_Besoins_Financiers` et `5_Synthese_Besoins`. Il n'y a nulle part, en base, de
trésorerie prévisionnelle déclarée par le client.

Choix retenu — `projeter_cash_flows()` :

```
revenu brut     = rendement_ref.qte_unite × prix_unitaire × superficie
marge du cycle  = revenu brut − coûts du plan
disponible/mois = marge ÷ nombre de mois d'amortissement
```

La marge est portée sur les mois d'**amortissement** (le produit de la vente
arrive après la récolte — c'est la raison d'être du différé). Les trois termes
sont restitués dans `criteres.dscr.details.diagnostic.hypotheseCashFlows` pour que
l'analyste puisse contester l'hypothèse. Quand le référentiel n'a pas de
rendement, les flux sont nuls **et le commentaire le dit** — un DSCR de 0 dû à un
référentiel incomplet doit être lisible comme tel.

**Ce que je n'ai pas pu faire** : reproduire les 935 USD de cash-flows de
l'exemple de la SPEC. Ils ne se déduisent d'aucune donnée que le système détient
(avec le référentiel maïs seedé, 1 ha donne un revenu brut de 1 710 et une marge
de 380). `executer_analyse(..., cash_flows=[...])` permet d'injecter une
trésorerie connue — c'est par là que passera la future feuille de trésorerie.

**Décision demandée** : soit on ajoute une feuille `Tresorerie` au template
(principe 11 : le schéma se dérive du template actif), soit la projection ci-dessus
devient la règle officielle et doit être validée par le comité.

### 2.3 ⚠ L'exemple de la SPEC §2 ne se déduit pas des barèmes de la SPEC §5

| Valeur | Score annoncé §2 | Score réel du barème §5 |
|---|---|---|
| DSCR 0,636 | **19,1** | **19,7** |
| DSCR stressé 0,477 | **14,3** | **6,4** |

La courbe `DSCR` (`0.4→0 · 0.7→25 · 1.0→50 …`) donne mécaniquement 19,7 et 6,4.
Les 14,3 du stress ne correspondent à aucun point de cette courbe, quelle que soit
l'interprétation du choc (le DSCR stressé 0,477 de la SPEC, lui, est bien
reproductible : 935 × 0,75 ÷ 1 469,65).

**Je n'ai pas tordu le barème pour retomber sur l'illustration** : une courbe
calibrée pour reproduire un exemple serait fausse pour tous les autres dossiers.
Le cas de référence est donc testé au niveau où la mission le pose — l'agrégation
des cinq scores (`CasDeReferenceTests.test_agregation_du_cas_de_reference`) — et
l'écart de barème est figé dans un test à part
(`test_ecart_documente_entre_les_scores_et_les_baremes_de_la_spec`).

Le reste du cas de référence est reproduit **au centime** :
service de la dette 1 469,65 · intérêts 139,65 · CRD final 0,00 · DSCR 0,636 ·
score global **29,2** · recommandation **refus**.

### 2.4 Décotes de garanties — table en dur supprimée

La SPEC §4 embarque `DECOTES = {"epargne": 1.0, "immobilier": 0.7, ...}` dans le
code. Deux problèmes : le principe 8 l'interdit, et `CreditGuarantee.retained_coverage`
applique **déjà** la décote (valeur retenue après vérification pour un actif,
montant bloqué pour l'épargne, `decote_caution_morale` d'`InstitutionConfig` pour
une caution). Deux tables auraient donné deux ratios de couverture différents pour
un même dossier selon l'écran consulté. Le scoreur lit `retained_coverage`.

### 2.5 `float` → `Decimal`

Le pseudo-code de la SPEC utilise `float` partout (`bareme.evaluer(float(dscr))`,
lignes d'échéancier en `float`, seuils de décision en littéraux). Tout est en
`Decimal` : `0.01` montants, `0.001` ratios, `0.1` scores et points, `ROUND_HALF_UP`.
`BaremeScore.evaluer()` prend et rend du `Decimal`, et les points de courbe sont
stockés **en chaînes** dans le JSON — sinon le binaire flottant rentrerait dans le
calcul par la porte de la base.

### 2.6 Ajout assumé : barème `DECISION`

La SPEC porte ses seuils de décision en dur (`>= 75`, `>= 60`, `>= 45`,
`CHOC_STRESS = 0.25`), ce que le principe 8 interdit. Un 4ᵉ `BaremeScore` de code
`DECISION` les porte dans `parametres` (le champ `points` reste vide : ce n'est pas
une courbe), avec la grille de lettres. Repli sur `REGLES_DECISION_DEFAUT` **avec
warning loggé**. Les règles appliquées sont figées dans
`AnalyseCredit.baremes_appliques["_regles"]` : un recalibrage du comité ne doit pas
changer rétroactivement la lettre affichée à un client.

Les **poids** viennent d'`InstitutionConfig` (25/20/10/30/15 par défaut), avec repli
loggé si la somme ≠ 100.

---

## 3. Contrat servi — `src/types/api.ts`

**camelCase partout.** Les clés du contrat figé sont émises telles quelles :
`scoreGlobal`, `dscrStress`, `ecartsHorsPlage`, `ecartPct`, `ecartMoyenPct`,
`totalPlan`, `totalReferentiel`, `ratioCouverture`, `dureeMois`, `differeMois`,
`tauxAnnuel`, `indicateursHorsPlage`, `executeLe`, `versionMoteur`,
`interetsCapitalises`, `scoreLettre`, `pointsForts`, `pointsAAmeliorer`, `analyseLe`.

### 3.1 Deux divergences avec le contrat, arbitrées en faveur du contrat

1. **`echeancier.py` produit des chaînes ; `CreditEcheancierLigne` attend des
   `number`.** Résolu à la frontière HTTP : `serialiser_echeancier_api()` convertit.
   La valeur **stockée** en base reste une chaîne décimale (principe 4) — vérifié
   par `test_aucun_float_dans_les_montants_de_l_echeancier_stocke`.
2. **`echeancier.py` produit `phase="differe"` (sans accent) ; le contrat type
   `'différé' | 'amortissement' | 'franchise'`.** Traduction dans `_PHASES_API`.
   En mode `franchise_totale`, la phase de différé sort en `'franchise'`.

### 3.2 Ajouts au contrat (additifs — aucune clé existante déplacée)

Demandés par `moteur-front-analyse` et servis :

| Clé | Où | Pourquoi |
|---|---|---|
| `criteres.dscr.details.facteurDominant` | racine des détails | CLAUDE.md §4.6 |
| `criteres.dscr.details.levier` | racine des détails | **calculé**, pas approximé : échéancier reconstruit à différé réduit sur les mêmes flux (`diagnostiquer_levier`) |
| `criteres.dscr.details.diagnostic.alternativesDiffere` | liste `{differeMois, dscr, serviceDette}` | matière du simulateur analyste |
| `totaux` | racine | `totalInterets`, `totalCapital`, `totalInteretsCapitalises`, `serviceDette`, `crdFinal`, `nbEcheances` |
| `devise` | racine | **`devise`, pas `currency`** — le payload est francophone (`criteres`, `parametres`, `recommandation`, `echeancier`) |
| `referentielInfo` | racine | `{code, filiere, source, estIndicatif, nCasReels, version}` — §4.6 « incertitude assumée » |
| `scoreLettre` | racine (staff) | cf. §5, sous réserve |
| `lignage` | racine | `{needsSourceId, revision, sha256}` — comparaison entre analyses |
| `poidsAppliques` | racine | auditabilité |

**Pas de `totalCommissions`** : la ligne `commission` de la SPEC §A.3 (écart 25 vs
19,95 du simulateur Excel) n'est pas tranchée. La servir à 0 laisserait croire
qu'il n'y a pas de commission — l'absence de clé est plus honnête que le zéro.

**Pas de taux de change** : aucune conversion n'est faite, l'analyse porte la devise
du dossier. La SPEC §9.4 (conversion CDF via `ExchangeRateManager`) n'est pas
implémentée.

### 3.3 Convention d'absence — arrêtée : **404**

`GET /analyse/` et `/analyse-resume/` répondent **404 + `{"code": "ANALYSE_ABSENTE"}`**
quand aucune analyse n'a été exécutée. Jamais un 200 à corps vide.

`POST /analyse/justifier/` retourne bien l'objet `CreditAnalyse` **complet** (200).
`POST /reanalyser/` retourne le `CreditAnalyse` de la nouvelle analyse en **201**.

---

## 4. Endpoints et permissions

| Route | Méthode | Autorisé | Refusé |
|---|---|---|---|
| `applications/<code>/analyse/` | GET | `STAFF_ROLES` (analyste, agent, direction, **audit**) | client même titulaire → 403 `STAFF_REQUIS` |
| `applications/<code>/analyse/justifier/` | POST | `CAN_INSTRUCT` | client, **auditeur** → 403 |
| `applications/<code>/reanalyser/` | POST | `CAN_INSTRUCT` | client, **auditeur** → 403 |
| `applications/<code>/analyse-resume/` | GET | titulaire du dossier + staff | autre client → 403 |

`permission_classes([IsAuthenticated])` déclaratif sur chaque vue + garde de groupe.
`reanalyser` et `justifier` sont **journalisés** (`audit.services.record`,
actions `credits.analyse.execute` / `credits.analyse.justifier`), dans le même
`transaction.atomic()` que l'écriture.

**`reanalyser` ne déclenche aucune transition** de la machine à états — testé
(`test_analyse_ne_change_pas_le_statut_du_dossier`). Le moteur recommande.

---

## 5. ⚠ Contradiction backend à arbitrer — je n'ai pas tranché

Signalée par `moteur-front-analyse`, **vérifiée ligne à ligne** :

| Emplacement | Bandes | 3ᵉ bande |
|---|---|---|
| `credits/scoring.py:332` (taux proposé) | 85 / 70 / **55** | **+2,5** |
| `credits/scoring.py:397` (`_valuation_note`) | 85 / 70 / **55** | — |
| `credits/dataio_simulator.py:343` (`_valuation_note`) | 85 / 70 / **55** | — |
| `credits/dataio_simulator.py:580` (taux proposé) | 85 / 70 / **55** | **+2,0** |
| `credits/analyse.py` `score_lettre` (SPEC §6) | 85 / 70 / **50** | — |
| 4 emplacements front | 85 / 70 / **50** | — |

Deux problèmes distincts :

1. **Le backend se contredit lui-même** : pour un score de 60, `scoring.py` propose
   `base + 2,5` et `dataio_simulator.py` `base + 2,0`. **Deux taux différents
   proposés à un client réel pour le même score.** C'est un écart financier, pas
   d'affichage.
2. **La bande 50–54 diverge** entre le front (3ᵉ niveau, « C ») et le backend
   (4ᵉ niveau, taux +5).

**Je n'ai pas unifié.** Choisir entre +2,5 et +2,0 change le taux proposé à des
clients : c'est un arbitrage du comité, pas une décision d'implémentation
(CLAUDE.md §8.4 — une question avant de coder, jamais après avoir livré).

`score_lettre()` de `analyse.py` lit déjà sa grille depuis
`BaremeScore.DECISION.parametres.lettres` et suit **50** (SPEC §6 et front).
Elle **ne touche pas** `scoring.py` ni `dataio_simulator.py`.

**Ce qu'il reste à faire, une fois l'arbitrage rendu** : descendre la grille de
bandes ET l'ajustement de taux dans `BaremeScore`, faire lire les deux modules
dessus, puis retirer les 4 emplacements front. Tant que ce n'est pas fait, le
`scoreLettre` que je sers est cohérent avec le front et avec la SPEC, mais pas avec
la `valuationNote` de `scoring.py` sur la bande 50–54.

---

## 5 bis. Payload réellement observé — `docs/contracts/moteur-analyse-payload-observe.json`

Le front avait branché l'onglet Analyse **d'après ma description, sans appel réel**.
J'ai donc généré la réponse HTTP effective des 4 endpoints (200 / 201) et l'ai
versionnée. **Deux défauts que seule cette confrontation a révélés :**

1. **`poidsAppliques` sortait en chaînes** (`"25.0"`) alors que `criteres.<x>.poids`
   sortait en nombre — la même grandeur dans deux types selon l'endroit du payload,
   et `api.ts` la déclare `Record<string, number>`. Corrigé : émis en `number`.
   Le **stockage** reste une chaîne (trace d'audit, pas de binaire flottant).
   Verrouillé par `test_les_grandeurs_numeriques_sortent_en_number`.

2. **Le résumé client félicitait un client pour un historique qu'il n'a pas.**
   Le score neutre de 50 du critère comportemental sans historique tombait dans
   « points forts » (comparaison `>=`), et le client lisait « Votre historique
   avec AGRICAP joue en votre faveur » sans aucun crédit antérieur. Trompeur pour
   lui, faux pour l'institution, et c'est le critère qui pèse 30 %. Corrigé :
   comparaison stricte des deux côtés, et l'absence d'historique devient une
   **piste actionnable** (« un historique de remboursement renforce un dossier »).
   Verrouillé par `test_absence_d_historique_n_est_jamais_un_point_fort`.

Aucun des deux n'aurait été rattrapé par un test de contrat : le premier passe
`checkJs: false`, le second était un texte grammaticalement correct.

**Tests : 281 sur `credits` (64 sur le moteur), 580 au total.**

### La vue client n'est branchée nulle part

Vérifié par lecture de `src/` (lecture seule — je n'y écris pas) :
`analyseResume` est déclaré dans `src/services/api.ts:201` et **aucun composant
ne l'appelle**. Les usages de `scoreLettre` sont tous sur le chemin staff
(`AnalyseTab.jsx`, `RecommendationBanner.jsx`), plus une copie locale assumée dans
`SimulationResult.jsx` pour le chemin `simulate/`.

Deux conséquences :

- le risque d'état vide sur `pointsForts` est **hypothétique**, pas réel : il n'y a
  pas encore d'écran à casser. À traiter quand le premier consommateur sera écrit ;
- **la surface anti-gaming que je livre n'est pas encore celle que voit le client.**
  Tant que `pages/credit/**` et `Credits.jsx` n'appellent pas `analyse-resume`, le
  demandeur continue de lire ce que produit le chemin historique — dont le score
  fictif du simulateur. Le principe 7 est tenu côté serveur ; il ne l'est pas encore
  bout en bout. C'est le prochain branchement utile, et il appartient à un lot front.

---

## 6. Ce que je n'ai pas fait / pas pu tester

- **Intégration au pipeline (SPEC §6)** : non livrée. `credits/pipeline.py` n'existe
  pas, et `CreditApplication` n'a ni `score_lettre` ni `JournalValidation.Etape`.
  L'analyse se déclenche par `POST /reanalyser/`, pas automatiquement après la
  validation de la feuille de besoins.
- **Cash-flows réels** : jamais testés contre une trésorerie déclarée par un client
  (elle n'existe pas — §2.2). La projection est testée sur ses propres hypothèses.
- **Critère comportemental avec historique** : `_charger_historique()` lit
  `portfolio.Loan` par `borrower_sub`. Testé uniquement dans sa branche « aucun
  historique » (50/100 neutre, `historiqueDisponible: false`). La branche avec
  historique n'a pas de dossier réel pour la calibrer — les coefficients (60 % taux
  de remboursement, 40 % part soldée, −20 par incident) sont **une proposition**,
  pas un barème validé. Ils devraient descendre dans `BaremeScore` quand un
  `COMPORTEMENTAL` sera calibré (le code le cherche déjà : `baremes.get("COMPORTEMENTAL")`).
- **Conversion de devises** (SPEC §9.4) et **échantillonnage de validation humaine**
  (SPEC §9.5) : non implémentés.
- **Endpoints d'administration** des référentiels et barèmes (SPEC §7, deux
  dernières lignes) : non livrés — le seed est en ligne de commande.
- **Référentiel — défaut signalé puis CORRIGÉ par le lot simulateur.** Je seedais
  le maïs avec des coûts par module **répartis à la main** pour retomber sur le
  total de 9 111 USD/ha, sans avoir ouvert le classeur. Le total tombait juste, la
  répartition non : 850 USD/ha de semences là où le classeur en donne 126,60 —
  facteur 6,7 sur un poste du critère qui pèse 25 %.

  `credits/referentiel_loader.py` (lot simulateur) lit désormais les référentiels
  dans les simulateurs ingérés, et `seed_analyse` ne fabrique plus rien.
  **Conséquence : sans classeur simulateur en base, aucun référentiel n'est seedé
  et le moteur refuse d'analyser** (`REFERENTIEL_ABSENT`, 422). C'est le
  comportement voulu — un référentiel deviné scorerait un quart du dossier contre
  des chiffres que personne n'a validés.

  J'ai découplé mes tests en conséquence : ils fabriquent leur propre référentiel
  (`REFERENTIEL_TEST`, valeurs choisies pour exercer les branches de tolérance et
  **explicitement pas** une reproduction du classeur réel). Deux tests neufs
  verrouillent le nouveau contrat : `test_sans_simulateur_ingere_aucun_referentiel_n_est_invente`
  et `test_le_moteur_refuse_d_analyser_sans_referentiel`.

---

## 7. Dettes croisées rencontrées

- `credits/dataio_simulator.py` : `float` sur toute la chaîne de scoring, DSCR
  estimé par règle de trois sur un EBE de référence. C'est l'anti-modèle que
  `analyse.py` remplace ; il reste branché sur `POST /simulate/`. Deux moteurs de
  score coexistent tant que le simulateur n'est pas migré.
- `credits/scoring.py` : idem, `float` + seuils en dur (§5).
- `InstitutionConfig` stocke ses seuils en `FloatField` — `analyse.py` les convertit
  par `Decimal(str(...))` à la lecture, mais la précision est déjà perdue en base.

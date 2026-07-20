# Fragment de statut — backend (MKOPO)

> Périmètre : `AGRICAP FINTECH/backend/` uniquement. `src/` n'a pas été touché.
> Dernière exécution : `./.venv/Scripts/python.exe manage.py test credits assets dataio reference_data`
> → **140 tests, OK** (baseline mesurée à 81, + 59 nouveaux).

---

## 1. Écart de baseline constaté à l'ouverture

La consigne annonçait 108 tests verts sur `credits assets dataio reference_data`.
La mesure réelle avant toute modification donne **81 tests, OK**. Je n'ai pas
cherché à expliquer l'écart (tests peut-être comptés avec d'autres apps) ; je le
signale pour que le chiffre de référence soit corrigé.

`support/` : 8 échecs (7 failures + 1 error) avant et après mes modifications —
non touché, conformément à la consigne.

---

## 2. Lot 2 — la feuille de besoins devient un DataSource : **fait**

### 2.1 Ce qui est en place

**`dataio` — modèle et services**

| Élément | Fichier |
|---|---|
| `kind = "FEUILLE_BESOINS"` | `backend/dataio/models.py` |
| FK `credit_application` → `credits.CreditApplication`, `on_delete=PROTECT` | `backend/dataio/models.py` |
| Champ `sha256` (indexé), calculé à l'`inspect()` et resécurisé au `commit()` | `backend/dataio/models.py`, `services.py` |
| Détection du kind : les 2 feuilles présentes **et** classeur ≤ 10 feuilles | `detect_kind()` |
| `commit(source, sheets=[...])` — ingestion restreinte aux feuilles 4 et 5 | `services.commit()` |
| `sheet_rows(ws)` — lecture publique partagée validation/ingestion | `services.sheet_rows()` |
| `guard_deletable()` + exception `SourceProtected` | `services.py` |
| `DELETE /api/dataio/sources/<id>` → **409** `{code, message}` | `backend/dataio/views.py` |

Le versionnage n'a pas été réécrit : `inspect`/`commit` existants sont réutilisés,
avec la clé `dataset_key = "fb__{application.code}"` — une lignée par dossier.

**`credits` — pipeline client**

- `backend/credits/needs_sheet.py` (nouveau) : `validate_needs_sheet`,
  `parse_and_ingest`, `extract_module_totals`, `needs_source_lineage`.
- `CreditApplication.needs_source` → FK `dataio.DataSource`, `PROTECT`
  (migration `credits/0008`).
- `POST /api/credits/needs-sheet/parse/` accepte `application_code` : validation
  → ingestion → rattachement, réponse `{needsSourceId, revision, sha256,
  totalByModule, grandTotal}`.
- `POST /api/credits/simulate/` accepte `application_code` : les montants par
  module sont **lus dans les `DataRecord`**, tout `ns_totals` du payload est
  ignoré. Sans feuille ingérée → **422 `NEEDS_SOURCE_MISSING`** (on ne score pas
  des montants absents).
- `POST /api/credits/applications/<code>/score/` relit les tables, passe les
  totaux au moteur (`CreditScoringEngine(app, needs_totals=…)`) et stocke
  `needsSource = {needs_source_id, revision, sha256, dataset_key, committed_at}`
  dans `score_result` → une analyse est rejouable à l'identique.

### 2.2 Les 6 contrôles, avec leur code d'erreur

Réponse **422 `{"errors": [{code, message}]}`**, jamais de message générique.
Étages successifs (principe 5) : structure → types → cohérence ; arrêt au premier
étage en échec, mais toutes les erreurs de cet étage sont collectées.

| Code | Contrôle |
|---|---|
| `FEUILLE_MANQUANTE` | `4_Besoins_Financiers` et `5_Synthese_Besoins` présentes |
| `COLONNE_MANQUANTE` | rôles Rubrique / Désignation / Quantité / Prix unitaire / Total |
| `RUBRIQUE_MANQUANTE` | les 8 rubriques + `TOTAL GÉNÉRAL` en feuille 5 |
| `TYPE_INVALIDE` | Quantité, Prix, Total numériques et ≥ 0 |
| `INCOHERENCE_INTERNE` | Σ feuille 4 par rubrique = total feuille 5 (± 0,01) |
| `TOTAL_INCOHERENT` | `TOTAL GÉNÉRAL` = Σ des 8 rubriques (± 0,01) |

Trois codes supplémentaires, non prévus par la SPEC mais nécessaires :
`CLASSEUR_ILLISIBLE`, `CLASSEUR_NON_RECONNU` (marqueurs de kind absents),
`RUBRIQUE_INCONNUE` (ligne de feuille 4 hors des 8 rubriques officielles — sinon
son montant disparaîtrait silencieusement du contrôle de cohérence).

### 2.3 Cas chiffrés exécutés (lot 2)

Classeur de référence = le modèle officiel du dépôt (1 330 USD) :

- `semences = 600,00` · `mecanisation = 450,00` · `maindoeuvre = 280,00` ·
  5 autres modules à `0,00` · **Σ = 1 330,00 = TOTAL GÉNÉRAL** (invariant testé).
- `INCOHERENCE_INTERNE` déclenché sur une feuille 5 portée à 810 alors que la
  feuille 4 somme 600 → message factuel citant les deux montants et l'écart.
- Écart de 0,004 (sous le centime) → **accepté**, pas de faux positif.
- Re-upload → `revision` 1 → 2, `is_current` bascule, `supersedes` renseigné,
  SHA-256 différents, la révision 1 reste consultable ligne à ligne.
- Fichier supprimé du disque après commit → `extract_module_totals` rend toujours
  1 330,00 (preuve que la lecture se fait sur les `DataRecord`).

### 2.4 Un bug réel trouvé grâce au modèle officiel

Le test qui valide le fichier réellement servi aux clients
(`credits/static/credits/feuille_besoins_template.xlsx`) a fait apparaître une
ligne **« TOTAL BESOINS DU CYCLE » dans la feuille 4**. Comptée comme un besoin,
elle doublait la rubrique et faisait tomber `INCOHERENCE_INTERNE` à tort sur tout
dossier conforme. Les lignes de sous-total de la feuille 4 sont désormais
ignorées, et un test verrouille le fait que **le modèle téléchargé passe la
validation** (principe 11 : le fichier livré = le fichier contre lequel on valide).

---

## 3. Moteur d'analyse — `construire_echeancier` : **fait**

`backend/credits/echeancier.py` + `tests_echeancier.py` (17 tests).

`Decimal` de bout en bout, quantize `0.01` / `ROUND_HALF_UP` sur chaque montant,
intérêts calculés sur le solde de début de mois, dernière tranche ajustée au
solde exact.

**Cas de référence A.2 reproduit au centime, ligne à ligne, dans les deux modes :**

| Mode | Intérêts totaux | Service de la dette | CRD final |
|---|---|---|---|
| `interets_seuls` (C=1 330, 18 %/an, D=8, F=5) | **139,65** | **1 469,65** | 0,00 |
| `franchise_totale` (même dossier) | capitalisés (CRD → 1 432,78) | **1 475,76** | 0,00 |

Invariants testés sur 8 jeux de paramètres (dont taux 0 %, capital 0,03,
différé maximal 11/12, 36 mois à 22,6 %) : CRD final = 0,00 ; Σ principal =
capital à amortir ; service de la dette = principal + intérêts payés ; mensualité
décroissante en phase d'amortissement.

---

## 4. Écarts SPEC / code relevés — **non tranchés en silence**

1. **Noms de modèles.** La SPEC Moteur parle de `DemandeCredit` et
   `PlanFinancierUpload` : ils n'existent pas. Les modèles réels sont
   `CreditApplication` et `NeedsSheet` (+ désormais `DataSource` pour la feuille
   ingérée). J'ai adapté ; la SPEC devrait être corrigée.

2. **`construire_echeancier`, tranche d'amortissement (bug dans le pseudo-code
   §4).** La SPEC calcule `A = capital / N` **avant** le différé. En
   `franchise_totale` les intérêts sont capitalisés : le capital à amortir n'est
   plus `C` mais le CRD de fin de différé — le pseudo-code ne solderait pas le
   prêt. L'annexe A.2 donne d'ailleurs `A = 477,59 = 1 432,78 / 3`, pas
   `1 330 / 3`. **J'ai suivi l'annexe** (calcul de la tranche après le différé).

3. **`float` dans le pseudo-code de la SPEC.** Les lignes d'échéancier y sont
   émises en `float`, ce qui contredit le principe 4. Le module conserve des
   `Decimal` ; `serialiser_echeancier()` produit des **chaînes** pour l'API.

4. **`DataTable.is_current` (SPEC §1.3.c)** n'existe pas : le versionnage porte
   sur `DataSource`, et `(source, name)` est unique. `extract_module_totals`
   filtre donc sur la source, pas sur la table.

5. **`uploaded_by` en FK utilisateur (SPEC §1.3.a)** : `DataSource.uploaded_by`
   est un `CharField` (sub IdP), cohérent avec tout le reste du projet
   (`submitted_by_sub`, `confirmed_by_sub`…). J'ai gardé le `CharField` —
   cohérence locale d'abord. À arbitrer si l'on veut la contrainte d'intégrité.

6. **Colonnes de la feuille 4.** La SPEC annonce
   `Rubrique, Désignation, Quantité, Prix unitaire, Total` ; le modèle officiel
   porte `Rubrique, Description détaillée, Quantité, Coût unitaire, Montant
   total` (+ `Fréquence`, `Période du cycle`, `Financement souhaité`…). La
   validation repère les colonnes **par rôle** avec synonymes, pas par libellé
   exact.

7. **Ordre §10 de la SPEC Moteur.** J'ai fait `construire_echeancier` (§10.2)
   avant `BaremeScore`/`AnalyseCredit` (§10.1) : l'échéancier n'a aucune
   dépendance vers ces modèles, et la consigne le désigne comme le cœur. Signalé
   pour que ce ne soit pas pris pour un oubli.

8. **Écart A.3 non résolu.** La SPEC signale que `AGRICAP_FIN_SIM_01` affiche
   25/mois d'intérêts là où 1 330 × 18 %/12 = 19,95. **Je n'ai pas investigué le
   classeur Excel** : mon échéancier produit 19,95, conforme à l'annexe A.2. La
   question (commission cachée ~0,38 %/mois ? base de calcul différente ? erreur
   de formule ?) reste ouverte et doit être tranchée avant calibrage.

---

## 5. Ce qui n'est PAS fait

- **SPEC Moteur, reste du chantier** : modèles `BaremeScore` et `AnalyseCredit`,
  fixtures des 3 barèmes, les 5 scoreurs (C1–C5), les endpoints `/analyse/` et
  `/reanalyser/`. Seul l'échéancier est livré.
- **Le front n'est pas adapté** (hors périmètre, `src/` appartient à d'autres
  agents). Conséquence : le nouveau mode SPEC de `parse/` et `simulate/` n'est
  actif **que si le client envoie `application_code`**. Sans lui, le
  comportement hérité (parse en mémoire, `ns_totals` du payload) est conservé
  pour ne pas casser l'étape 2 du simulateur. **Tant que le front n'envoie pas
  `application_code`, le principe 1 n'est pas garanti de bout en bout** — c'est
  la dette ouverte la plus importante de ce lot.
- **Contrainte d'ordonnancement non résolue** : le parcours client crée le
  dossier à l'étape 4, alors que l'upload a lieu à l'étape 2. `dataset_key`
  exigeant `application.code`, l'ingestion requiert un dossier existant. Deux
  options à arbitrer avec le métier : (a) créer le `draft` dès l'étape 1 ;
  (b) autoriser une lignée `fb__anon__{uuid}` re-clé à la création du dossier.
  **Je n'ai pas tranché.**
- **`NeedsSheet` / `NeedItem` subsistent** en parallèle du `DataSource` : le
  moteur d'analyse documentaire (`LineFinding`) en dépend. Deux représentations
  de la même feuille cohabitent — à unifier dans un lot dédié.
- **`credits/needs_parser.py`** n'a pas été supprimé (chemin hérité toujours
  utilisé sans `application_code`).

---

## 6. Ce que je n'ai pas pu tester

- **Aucun test d'API HTTP** : le dépôt n'en contient aucun (pas d'`APIClient`,
  pas de fixture d'authentification IdP). Les nouvelles vues
  (`_ingest_needs_sheet`, `_simulate_from_source`, le 409 sur `DELETE`) sont
  couvertes **au niveau service** — la validation, l'ingestion, le lignage et les
  gardes de suppression sont testés, mais **les codes HTTP et les permissions de
  ces trois vues ne le sont pas**. À combler par une base de tests d'API.
- **PostgreSQL** : la suite tourne sur SQLite. Le `select_for_update` du gage
  d'actif et le comportement `PROTECT` sous concurrence n'ont pas été vérifiés
  sur le SGBD cible.
- **Classeurs clients réels** : la validation n'a été confrontée qu'au modèle
  officiel du dépôt et à des classeurs fabriqués. Le taux de faux positifs sur
  des fichiers réellement remplis par des clients est inconnu — c'est
  exactement le genre de règle à instrumenter (principe 4.6 : une règle qui se
  déclenche sur 80 % des dossiers décrit la réalité, elle ne détecte plus rien).

---

## 7. Migrations

| Migration | Contenu | Réversibilité |
|---|---|---|
| `credits/0008_creditapplication_needs_source` | `AddField needs_source` | schéma pur, aucun `RunPython` |
| `dataio/0002_datasource_credit_application_datasource_sha256_and_more` | `AddField credit_application`, `AddField sha256`, `AlterField kind` | schéma pur, aucun `RunPython` |

**Rollback vérifié** : `migrate dataio 0001` + `migrate credits 0007`, puis
re-migration complète — OK dans les deux sens.

---

## 7bis. Signalements de `front-garanties` — 2 corrigés, 1 refusé, 1 à arbitrer

L'agent `front-garanties` a remonté trois écarts en câblant le front sur mon
backend (cf. `docs/status-fragments/front-garanties.md` §3). Deux relevaient de
mon périmètre, corrigés.

### (1) Les 5 codes d'erreur du gage — **corrigé**

`place_asset_guarantee` levait un `GuaranteeError` générique pour les cinq
règles, que la vue aplatissait en `ASSET_GUARANTEE_REFUSED`. Le front en était
réduit à retrouver la règle **par regex sur le texte du message** — toute
reformulation d'un message cassait silencieusement la traduction.

Cinq sous-classes typées portent désormais leur `code`
(`credits/guarantees.py`) : `AssetNotOwned`, `AssetNotVerified`,
`AssetAlreadyPledged`, `AssetCategoryMismatch`, `AssetNoRetainedValue` — plus
`GuaranteeTypeNotEligible` qui existait déjà. Toutes restent des
`GuaranteeError`, donc un `except` unique dans la vue les relaie toutes :

```python
except GuaranteeError as exc:
    return Response({"detail": str(exc), "code": exc.code,
                     "errors": [{"code": exc.code, "message": str(exc)}]}, status=422)
```

**Contrat désormais verrouillé par test** (`credits/tests_guarantee_codes.py`,
10 tests) : *le code est stable, le message est libre.* Le front ne doit plus
jamais brancher sur `detail`.

Non modifié : `place_savings_hold` renvoie toujours `code: "guarantee_error"`
(minuscule) et `place_savings_guarantee` / `register_moral_guarantee` restent en
400. Incohérent avec le reste, mais hors du signalement — à uniformiser dans un
lot dédié pour ne pas casser un appelant existant.

### (2) Actif `libere` modifié → pas de remise en vérification — **corrigé**

Faille réelle. Un actif `libere` est `is_pledgeable` (`assets/models.py:94`) et
conserve sa `valeur_retenue`, mais le PATCH client ne réinitialisait que le cas
`VERIFIE`. Séquence : gage levé → `libere` → le client change désignation,
catégorie ou valeur → **l'actif reste mobilisable avec une valeur retenue
certifiée sur un bien qui n'est plus celui qu'un agent a contrôlé.** C'est une
atteinte directe au principe 9 (« toute garantie est opposable ou n'est pas »).

La règle est remontée dans `assets/services.invalidate_verification()`, appelée
par la vue : `verifie` **et** `libere` retombent en `declare`, `valeur_retenue`
effacée — et désormais `verifie_par_sub` / `verifie_le` aussi (l'ancien code
laissait l'actif afficher « vérifié par X le Y » après invalidation).

**Cause racine du passage au travers** : le test existant
(`assets/tests.py::test_modification_invalide_la_verification`) **recopiait la
condition de la vue en dur** au lieu d'appeler le code de production. Il validait
sa propre copie du bug. Réécrit pour appeler le service, + 2 tests
(cas `libere`, cas sans effet sur `declare`/`rejete`).

> Leçon transférable : un test qui simule le serveur au lieu de l'appeler ne
> teste rien. À traquer ailleurs dans la suite.

### (3) `api.ts` jette le corps JSON — **pas corrigé, hors périmètre**

`src/services/api.ts:52` fait `new ApiError(status, detail)` et perd le `code`.
`src/` ne m'appartient pas, je n'y touche pas. **Conséquence à assumer : tant que
ce point n'est pas corrigé, mon travail sur (1) est invisible côté client** et le
front reste sur sa regex de contournement. C'est le correctif à prioriser —
il débloque les six codes d'un coup.

Engagement pris auprès de `front-garanties` : **je préviens avant toute
reformulation d'un message de `guarantees.py`**, tant que la traduction par
signature de texte est en place.

### (4) Question §2.5 (le client désigne-t-il son garant ?) — **non tranchée**

`register_moral_guarantee` et `place_savings_guarantee` sont derrière
`CAN_INSTRUCT` ; la SPEC §2.5 décrit le client désignant son garant à l'étape 3.
**Je n'ai pas modifié ces permissions** : ouvrir la pose de caution au client est
une décision métier à impact financier (qui engage un tiers), pas un ajustement
technique — et c'est le lot 6, qui suppose le workflow de consentement 72 h que
je n'ai pas implémenté. Ouvrir l'endpoint avant ce workflow créerait des cautions
sans consentement du garant, exactement ce que la SPEC veut empêcher.

**Question au fondateur** : à l'étape 3, le client désigne-t-il lui-même son
garant (avec consentement 72 h du garant avant validité), ou la caution reste-t-elle
saisie par l'agent ? Tant que la réponse n'est pas donnée, le front a raison de
présenter ces deux types comme « constitués avec votre agent ».

---

## 7ter. `submit` sans `code` — **corrigé** (2e passe `front-garanties`)

`front-garanties` a trouvé, en retirant sa regex de contournement, que
`POST .../submit/` renvoyait `{detail}` **sans `code`**, avec les quatre causes
possibles agrégées dans une seule phrase séparée par des « | ». Le message
d'inéligibilité de garantie — qui **énumère les types admis** — y était noyé ;
sa regex l'attrapait et le remplaçait par une phrase générique moins informative.
Le contournement dégradait donc un cas réel.

Corrigé dans `credits/workflow.py` :

- `WorkflowError` porte un `code` et une liste `errors`, avec `as_errors()`
  qui n'est **jamais vide** (la vue relaie sans tester le cas vide) ;
- sous-classes typées : `InvalidTransition`, `ApplicationIncomplete`,
  `DelegationError` → `DELEGATION_EXCEEDED`, `MakerCheckerError` →
  `MAKER_CHECKER_VIOLATION`, `ConsentError` → `CLIENT_CONSENT_MISSING` ;
- `submit()` lève `ApplicationIncomplete` avec **une entrée par cause** :
  `CLIENT_MANQUANT`, `FILIERE_MANQUANTE`, `SUPERFICIE_MANQUANTE`,
  `MONTANT_MANQUANT`, et `GUARANTEE_TYPE_NOT_ELIGIBLE` dont le message conserve
  l'énumération des types admis (le front ne peut pas la reconstituer, et ne
  doit pas connaître `ValueChain.eligible_guarantees` — principe 7).

7 tests dans `credits/tests_workflow_codes.py`.

**Statut HTTP — corrigé après découplage du front.** `front-garanties` a remplacé
son filtre par une liste `REFUSAL_STATUSES = [400, 409, 422]`, ce qui a levé mon
blocage. Vérification faite avant de bouger : **aucun consommateur de `src/` ne
branche sur le statut HTTP de `submit`** (trois appelants, tous sur
`ApiError.message` ou la liste structurée).

Choix retenu, sémantique plutôt qu'un 422 uniforme :

| Condition | Statut | Raison |
|---|---|---|
| `INVALID_TRANSITION` (dossier déjà soumis) | **409** | conflit avec l'état de la ressource — même choix que `APPLICATION_NOT_DRAFT` sur la feuille de besoins |
| `APPLICATION_INCOMPLETE` et le reste | **422** | entité non traitable (principe 5) |

L'harmonisation du reste de la surface workflow reste ouverte (cf. §7quinquies).

---

## 7quinquies. Dette que j'ai CRÉÉE : deux nomenclatures de codes d'erreur

À signaler franchement — c'est ma correction qui a introduit le problème, et
c'est exactement le motif que le projet a déjà payé cher (principe 6 : le module
a souffert de 4 vocabulaires de rôles et 2 nomenclatures de filières).

En donnant un `code` **MAJUSCULE** aux exceptions de `workflow.py`, j'ai créé un
doublon avec les codes **minuscules** que les vues émettent déjà à la main pour
les mêmes conditions :

| Concept | Émis par `submit` (nouveau) | Émis par les autres vues (existant) |
|---|---|---|
| Maker = checker | `MAKER_CHECKER_VIOLATION` | `maker_checker_violation` |
| Hors délégation | `DELEGATION_EXCEEDED` | `delegation_exceeded` |
| Consentement manquant | `CLIENT_CONSENT_MISSING` | `consent_required` |
| Consentement expiré | *(pas de sous-classe)* | `consent_expired` |

La convention du reste du module est MAJUSCULE (`ASSET_NOT_OWNED`,
`FEUILLE_MANQUANTE`, `NEEDS_SOURCE_PROTECTED`) : ce sont les minuscules qui sont
les outliers. **Mais je n'ai pas fait la migration.** Renommer un `code`
déjà consommé par un front est précisément le changement silencieux que je
reproche aux autres ; `front-garanties` a construit sa table de codes dessus.

**Proposition à arbitrer avec les deux fronts** (aucune ligne écrite) :
1. les vues workflow passent au helper unique qui émet `exc.code` + `errors[]` ;
2. ajout d'une sous-classe `ConsentExpired` (code `CLIENT_CONSENT_EXPIRED`) pour
   ne pas perdre la distinction manquant / expiré, aujourd'hui portée par le
   seul statut HTTP (409 vs 410) ;
3. période de transition avec `legacyCode` en minuscule si un front en a besoin.

En attendant, **l'état est incohérent et documenté comme tel** : `submit` émet
en majuscules, `approve` / `reject` / `start-analysis` / `client-consent` en
minuscules.

---

## 7quater. Motif à surveiller — un test qui simule le serveur ne teste rien

Suggestion de `front-garanties`, reprise ici : ce motif mérite d'être suivi comme
une classe de défaut, pas comme deux correctifs ponctuels.

**Mécanisme** : un test qui **recopie la logique de production** au lieu de
l'appeler valide sa propre copie. Il reste vert quand le code réel diverge, et
la couverture affichée est trompeuse — c'est pire que pas de test, parce qu'elle
inspire confiance.

Deux occurrences constatées dans ce dépôt :

1. `assets/tests.py::test_modification_invalide_la_verification` recopiait la
   condition `if asset.status == VERIFIE` de la vue. Le cas `libere` n'a jamais
   été testé, et la faille a vécu. Corrigé : le test appelle désormais
   `assets.services.invalidate_verification()`, la même fonction que la vue.
2. Historique (déjà documenté comme résolu dans le STATUS, § nomenclature des
   rôles) : la suite injectait `roles=["agent"]`, une valeur que
   l'authentification ne produit jamais. Les tests passaient, le workflow était
   bloqué en production.

**Faiblesse structurelle qui subsiste** : les tests construisent encore
`ViewContextService(sub=…, roles=[…])` à la main. Ils utilisent aujourd'hui les
identifiants canoniques (`gest_credit`, `admin`, `client`), donc le bug de 2)
est bien fermé — mais **rien n'empêche mécaniquement une nouvelle divergence**
entre ce que `roles_of(request)` produit et ce que les tests injectent. La garde
serait un test qui vérifie que tout rôle injecté dans la suite appartient au
registre RBAC.

> **À reporter dans `CREDIT_MODULE_STATUS.md` par qui en a la charge.** Je n'y
> écris pas (consigne explicite : risque de conflit d'édition).

---

## 8. Dettes croisées rencontrées (non corrigées, hors périmètre de la tâche)

- `credits/views.py` : `_persist_needs_sheet` avale toutes les exceptions
  (`except Exception: return None`) — un échec de persistance passe pour un
  simple « pas d'id ». Chemin hérité, non touché.
- `credits/views.py` : le chemin hérité de `parse/` acceptait `.xls`. Ramené à
  `.xlsx` seul, conformément aux standards de code (liste blanche stricte) ;
  la taille max de 5 Mo n'est **pas** encore appliquée.
- `credits/dataio_simulator.py` et `credits/scoring.py` raisonnent en `float`
  sur des montants. Hors périmètre du lot, mais contraire au principe 4 : à
  reprendre lors du chantier des 5 scoreurs.

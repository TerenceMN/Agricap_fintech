# Lot 3 — Le simulateur devient un calque strict de la feuille de besoins

**Périmètre :** branche client de `src/pages/Credits.jsx` + nouveau dossier
`src/components/simulateur/`. `renderAdminView`, `AdminCreditsDashboard` et le
ternaire `user?.role === 'admin'` n'ont pas été touchés. Aucun fichier de
`src/services/`, `src/types/`, `src/pages/credit/**`, `src/pages/admin/**`,
`src/components/admin/**` ni `backend/` n'a été modifié.

**Référence :** SPEC §1.4 (les 5 points) · CLAUDE.md principes 1, 5, 6 et
standards frontend.

---

## 1. Ce qui a été livré

### 1.1 Fichiers

| Fichier | Rôle |
|---|---|
| `src/components/simulateur/modules.js` | Les 8 codes canoniques du backend + alias d'affichage + `moduleConfig()` |
| `src/components/simulateur/needsSheetErrors.js` | Couche pédagogique par code de refus (le geste à faire dans le classeur) |
| `src/components/simulateur/NeedsSheetPanel.jsx` | Encart template / dépôt / badge révision / liste des 422 (`NeedsSheetErrorList`) |
| `src/components/simulateur/ModuleGrid.jsx` | Les 8 modules : coût en lecture seule, curseur « Financement demandé % » |
| `src/components/simulateur/SimulationResult.jsx` | Donut, détail par critère, échéancier — affichage pur de la réponse serveur |
| `src/pages/Credits.jsx` | Branche client recâblée ; `SimulateurIntelligent` passe de ~190 à ~110 lignes de logique |

### 1.2 Les 5 points de la SPEC §1.4

**1. Sans feuille : vide et désactivé.** `ModuleGrid` reçoit `costs = null` :
les 8 cartes affichent `—`, aucun curseur n'est monté (pas seulement
`disabled`), le camembert affiche un état vide explicite, et le bouton
« Simuler » est inactif avec la raison affichée. `NeedsSheetPanel` sert l'encart
en 3 étapes avec le lien `api.credits.templateUrl(vcCode)`.

**2. Après dépôt : coûts en lecture seule.** Les montants viennent de
`response.totalByModule` (extrait des `DataRecord` de `5_Synthese_Besoins` par
`extract_module_totals`). Chaque carte porte un cadenas et la mention « coût du
fichier ». Un module à 0 est grisé (`opacity-45`) avec le message « Rubrique à 0
dans votre feuille — rien à financer sur ce poste ».

**3. Un seul curseur.** « Financement demandé % » par module (pas de 5 en 5),
avec restitution immédiate du montant demandé à AGRICAP et de la part restant à
charge. `Montant total financé` = Σ (coût du fichier × part demandée), affiché à
côté du besoin total.

**4. « Simuler » sans montants.** `runSimulation()` appelle
`api.credits.simulate({ application_code })` — rien d'autre. `ns_totals`,
`amount_requested`, `area_ha`, `needs_sheet_id` et `value_chain_code` ont été
retirés du corps : le backend les ignore depuis le lot 2, les envoyer
entretenait l'illusion que le front pèse sur le score.

**5. Correction par le fichier, badge révision.** Aucun champ de saisie de coût
ne subsiste. Le panneau affiche `révision n`, le besoin total et les 12 premiers
caractères du `sha256`. Le bouton s'appelle « Remplacer le fichier ».

### 1.3 Suppressions

- **Initialisation aléatoire** : disparue avec les champs qu'elle remplissait.
  Plus aucun `Math.random()` dans le parcours client.
- **`Input` de coût et `Switch` d'activation par module** : supprimés. Les
  imports `Slider`/`Switch` de `Credits.jsx` ont suivi (`Slider` vit maintenant
  dans `ModuleGrid`).
- **`ns_totals` dans le payload de simulation** : supprimé.
- **`scoreLocal` recalculé dans un `useMemo`** : le score est lu directement sur
  `simResult.score`.
- **`needs_sheet_id: fd.nsResult?.id` dans `ensureDraft`** : lisait une clé que
  l'API n'a jamais servie (`needsSheetId`, puis `needsSourceId`) — donc toujours
  `undefined`. Le rattachement est fait côté serveur par `parse_and_ingest`.

### 1.4 Deux anomalies croisées corrigées au passage

**a) Deux modules disparaissaient des totaux.** `MODULES_CONFIG` était indexé en
camelCase (`mainDoeuvre`, `postRecolte`) alors que l'API sert les codes
canoniques (`maindoeuvre`, `postrecolte`). Le filtre `if (MODULES_CONFIG[mod])`
de l'ancien simulateur écartait donc silencieusement **la main-d'œuvre et la
post-récolte** — deux des postes les plus lourds d'un dossier agricole — du
plan de financement affiché. Même effet sur `GestionCreditsClient`, qui perdait
l'icône et le libellé de ces sous-portefeuilles après décaissement.
`modules.js` prend les codes backend comme référence (principe 6) et résout les
anciennes clés comme alias d'affichage, sur le modèle de `guaranteeConfig`.

**b) Montants au format navigateur.** Dix occurrences de `.toLocaleString()`
sans locale subsistaient dans la branche client (échéancier de remboursement,
dialogues de transfert et de rééquilibrage, contrat, transactions, message de
succès) : elles suivaient la locale du navigateur, pas `fr-FR`. Toutes migrées
sur `formatMontant` ; la date de transaction passe sur `formatDateFr`. Plus
aucun `toLocaleString` dans le fichier.

---

## 2. Erreurs de validation — toutes affichées

Le 422 de `parse/` porte **une entrée par contrôle en échec**. `guaranteeErrorList`
(réutilisé plutôt que dupliqué) les extrait toutes ; `NeedsSheetErrorList` en
fait une carte par cause :

- le **message serveur** est relayé tel quel — il chiffre déjà l'écart
  (« la feuille 5 annonce 1330,00 alors que la somme des lignes vaut 1120,00 ») ;
- un **titre** et un **conseil** sont ajoutés par code (`needsSheetErrors.js`) :
  ce qu'il faut faire dans le classeur, pas seulement ce qui a échoué ;
- l'en-tête compte les causes (« 3 points à corriger dans votre fichier ») et le
  pied rappelle de tout corriger en une fois.

Codes couverts : `FEUILLE_MANQUANTE`, `COLONNE_MANQUANTE`, `RUBRIQUE_MANQUANTE`,
`RUBRIQUE_INCONNUE`, `TYPE_INVALIDE`, `INCOHERENCE_INTERNE`, `TOTAL_INCOHERENT`,
`CLASSEUR_ILLISIBLE`, `CLASSEUR_NON_RECONNU`, `FORMAT_INVALIDE`,
`APPLICATION_NOT_DRAFT` (409), `NEEDS_SOURCE_MISSING` (422 de `simulate`).

`INCOHERENCE_INTERNE` et `TOTAL_INCOHERENT` reçoivent un traitement visuel
distinct (bordure ambre) et un texte qui nomme la cause réelle : *« un total a
été saisi ou collé à la main par-dessus la formule… un montant qui ne s'appuie
sur aucune ligne de détail ne peut pas être instruit »*. Le message reste
factuel : il décrit ce que le fichier contient, il n'accuse pas.

**Simulation périmée.** `simulate` renvoie `needsSource.revision`. Si le client
re-téléverse après avoir simulé, un bandeau ambre l'annonce (« calculée sur la
révision 2, votre feuille est en révision 3 ») plutôt que de laisser un score
obsolète à l'écran. Un nouveau dépôt réussi efface aussi `simResult`.

---

## 3. Contrainte d'ordonnancement — la solution retenue et ce qu'elle laisse ouvert

### 3.1 Le problème

`dataset_key = fb__{application_code}` exige un dossier. La SPEC place le dépôt
à l'étape 2 ; le dossier n'existait qu'à l'étape 4 (ou à l'étape 3 depuis le lot
« mobilisation d'actif », via `ensureDraft`).

### 3.2 Ce que j'ai fait — `ensureDraft` se réutilise tel quel

`ensureDraft` est appelé par `uploadNeedsSheet` : le brouillon est créé au
**premier téléversement**, réutilisé ensuite par les garanties (étape 3) et la
soumission (étape 4). Aucune duplication, aucun dossier vide semé à l'ouverture
d'un écran. C'est le même contrat qu'avant, simplement déclenché plus tôt.

### 3.3 Deux conséquences sur le parcours client — à valider

**(a) Le dépôt de la feuille quitte l'étape 1 pour l'étape 2.** Il y était en
mode « legacy » (parsing en mémoire, sans `application_code`) et pré-remplissait
`montant` avec `grandTotal`. Ce chemin ne pouvait pas être conservé : il ingérait
hors dossier, donc hors du principe 1.

**(b) Filière, superficie et montant deviennent obligatoires à l'étape 1.**
`POST /credits/applications/` refuse un `amount_requested ≤ 0` (400) et `submit`
exige ensuite `FILIERE_MANQUANTE` / `SUPERFICIE_MANQUANTE`. Comme le brouillon
est désormais créé dès l'étape 2, ces champs doivent être là avant. Le libellé du
montant devient « Montant souhaité » avec la mention que le détail chiffré
viendra du fichier. **Si le métier veut qu'un client puisse explorer le
simulateur sans déclarer de filière, cette solution est à revoir** — elle
resserre le parcours, elle ne l'assouplit pas.

**(c) Continuer vers les garanties exige la feuille.** Le bouton « Choisir mes
garanties » est désactivé tant qu'aucune feuille n'est ingérée, avec la raison
affichée. Cohérent avec le calque (sans fichier, il n'y a pas de plan de
financement à garantir), mais c'est un durcissement du parcours : **à trancher
côté métier.**

---

## 4. Limites connues — à ne pas laisser dormir

### 4.1 Le « Montant total financé » ne remonte jamais au dossier

C'est le point le plus important de ce rapport.

La SPEC (point 3) fait du curseur « Financement demandé % » ce qui produit le
« Montant total financé ». Or :

- `amount_requested` est figé à la **création** du brouillon, avec le montant
  déclaré à l'étape 1 ;
- il n'existe **aucun endpoint de mise à jour d'un dossier `draft`**
  (`credits/urls.py` : pas de `PATCH /applications/<code>/`) ;
- `_simulate_from_source` score sur `app.amount_requested`, pas sur la somme des
  parts demandées.

**Conséquence : le curseur % est aujourd'hui purement présentationnel côté
score.** Le client peut ramener chaque module à 40 % ; le moteur continuera de
scorer sur le montant qu'il a tapé à l'étape 1. Et à la soumission, le dossier
part avec ce même montant.

Trois issues possibles, aucune ne relève de mon périmètre :

1. un `PATCH /credits/applications/<code>/` sur les dossiers `draft` (montant,
   superficie, filière), que le front appellerait avant `simulate` ;
2. `simulate` et `submit` acceptent un tableau `financing_pct` par module (les
   **pourcentages** ne sont pas des montants : les envoyer ne viole pas le
   principe 1, puisque les coûts restent lus en base) et calculent eux-mêmes le
   montant financé — c'est aussi ce qui alimenterait `ModuleAllocation` ;
3. le curseur disparaît et le financement est réputé à 100 % du besoin.

**Recommandation : option 2.** Elle place le calcul du montant financé côté
serveur (donc auditable et rejouable), elle réutilise `ModuleAllocation.financing_pct`
qui existe déjà avec la bonne sémantique, et elle est la seule qui rende le
curseur honnête. **Question ouverte pour l'agent backend crédit.**

### 4.2 Le barème de la lettre de score est côté front — et il ne dit pas la même chose que le serveur

`scoreLetterOf` applique des seuils **85 / 70 / 50** codés dans
`SimulationResult.jsx`. C'est la dernière règle métier résiduelle du navigateur —
et, au sens du principe 7, un fragment de barème exposé au client.

**Vérification faite après échange avec `moteur-front-analyse` : ce n'est pas
qu'une duplication, c'est une contradiction.** Le backend applique une grille à
4 niveaux dont le troisième seuil est **55**, pas 50 :

| Emplacement | Seuils | Usage |
|---|---|---|
| `SimulationResult.jsx` (front) | 85 / 70 / **50** | lettre A / B / C / D |
| `credits/dataio_simulator.py:342` | 85 / 70 / **55** | `_valuation_note` |
| `credits/dataio_simulator.py:580` | 85 / 70 / **55** | ajustement du taux (−2 / 0 / +2 / +5) |
| `credits/scoring.py:332` | 85 / 70 / **55** | ajustement du taux (−2 / 0 / +2,5 / +5) |
| `credits/scoring.py:397` | 85 / 70 / **55** | `_valuation_note` |

Conséquence concrète sur la bande 50–54 : un score de 52 s'affiche **« C »** au
client, à côté d'une `valuationNote` (« Dossier à risque élevé — analyse
approfondie requise ») et d'un taux majoré de +5 points qui appartiennent tous
deux à la bande du **bas**. La lettre dit C, tout le reste de l'écran dit D. Ce
n'est pas un écart cosmétique : c'est le front qui contredit le moteur sur la
classe de risque d'un dossier.

À noter aussi, indépendamment du front : ces seuils sont codés en dur **dans le
Python**, et dupliqués entre `scoring.py` et `dataio_simulator.py` (avec des
ajustements de taux qui divergent déjà : +2,0 contre +2,5 sur la 3ᵉ bande).
C'est le principe 8 qui est en cause — les barèmes doivent vivre en base
(`BaremeScore`), modifiables par le comité sans redéploiement.

**Demande portée conjointement avec `moteur-front-analyse` à l'agent backend :**
que le moteur serve `scoreLettre` (ou la grille) avec le score, en la lisant
depuis `BaremeScore` plutôt que depuis une échelle `if` recopiée. Tant que ce
n'est pas fait, ajouter un 4ᵉ point de vérité côté front n'aiderait personne :
le comportement reste inchangé et le point est signalé dans le code. Je ne l'ai
pas supprimé unilatéralement — la lettre est aussi affichée dans `FicheSynthese`,
et la retirer serait une régression d'affichage sans contrepartie.

**Recensement complet côté front** (balayage `grep` de tout `src/`, après
signalement d'une 5ᵉ copie par `moteur-front-analyse`) :

| Emplacement | Sortie | État |
|---|---|---|
| `simulateur/SimulationResult.jsx` — `SCORE_BANDS` | lettre **et** couleur du donut | **dé-dupliqué** (voir ci-dessous) |
| `admin/credits/CreditRow.jsx:20` — `ScoreBadge` | couleur du badge de la **liste** | hors périmètre |
| `admin/credits/CreditDetailsModal.jsx:109` — `scoreColor` | couleur du **détail** | hors périmètre |

`Credits.jsx` n'est pas une copie : il ré-importe `scoreLetterOf`.

**Une 5ᵉ échelle se cachait dans mon propre fichier** et aucun des deux
recensements ne l'avait vue : `SimulationResult.jsx` portait *deux* ternaires
distincts pour la même règle — la lettre (ligne 18) et la couleur du donut
(ligne 41), à vingt lignes d'écart. Elles dérivent désormais d'une table unique
`SCORE_BANDS`. **Aucun seuil n'a été modifié** : c'est un dé-doublonnage à
comportement strictement identique (vérifié sur 15 cas, dont les bornes exactes
50 / 70 / 85 et les entrées `null` / `NaN`). Le front passe de 5 échelles à 3.

**Pourquoi je n'ai pas aligné 50 → 55 dans mon fichier.** Corriger la valeur ici
seul ferait diverger le simulateur du badge de liste et du modal de détail : le
même dossier changerait de couleur entre deux écrans. C'est le mode de
défaillance que ce rapport dénonce par ailleurs — le reproduire pour en réparer
une moitié serait absurde. Le réalignement (50 → 55 **et** `>` → `>=`) doit être
atomique sur les 3 fichiers restants, dont 2 sont dans `src/components/admin/**`,
hors de mon périmètre. C'est une tâche transverse à router, pas une dette
dormante — la raison du blocage est écrite en tête de `SimulationResult.jsx`.

### 4.3 Divers

- `_appToLoan` fabrique `sub.label` par `module.replace(/_/g, ' ')` ; l'affichage
  passe désormais par `moduleConfig(sub.moduleKey).label`, mais `subwalletLabel`
  (dialogues de transfert) lit encore `sub.label`. Cosmétique, non traité.
- Le lien « Télécharger le template » pointe sur
  `api.credits.templateUrl(vcCode)`, servi par `download_needs_sheet_template`.
  Celui-ci retombe encore sur le fichier statique
  `credits/static/credits/feuille_besoins_template.xlsx` — la dette du **principe
  11** (template versionné maker-checker en base) reste entière côté backend. Le
  front est prêt : il n'a qu'une URL à appeler.
- **Dette croisée, hors de mon périmètre** (signalée à `moteur-front-analyse`) :
  le barème de recommandation à 4 niveaux est défini **deux fois**, dans
  `src/components/analyse/recommandation.js` et dans
  `src/components/analyse/simulateur/format.js`, avec des valeurs déjà
  divergentes — `approbation_cond` en orange d'un côté, en lime de l'autre ;
  `revue` en yellow vs amber ; et les 4 libellés différents (« Revue manuelle »
  vs « Revue approfondie requise »). Vocabulaire parallèle au sens du principe 6.
  Aucun rapport avec `src/components/simulateur/`, qui ne porte aucune constante
  de barème. À arbitrer entre les lots analyse avant fusion.
- `src/types/api.ts` ne décrit ni `needsSource`, ni `scheduleDraft`, ni `refData`
  sur `CreditSimulateResult`, ni la forme SPEC de `NeedsParseResult`
  (`needsSourceId`, `revision`, `sha256`). Sans conséquence ici — `Credits.jsx`
  est un `.jsx` — mais tout appelant TypeScript de `simulate` sera aveugle à ces
  champs. **Fichier hors périmètre : signalé, non modifié.**

---

## 5. Vérifications

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | **0 erreur** |
| `npx vite build` | **vert** (2817 modules, build en ~7 s) |
| `Math.random` dans le parcours client | **0** (hors commentaires documentant sa suppression) |
| `localStorage` pour de la donnée métier | **0** (seule mention : un commentaire historique) |
| `toLocaleString` sur un montant | **0** — tout passe par `formatMontant` |
| Branche admin | intacte (`git diff` : aucune ligne de `renderAdminView` / `AdminCreditsDashboard` / du ternaire de rôle) |

**Ce que je n'ai pas pu observer** — pas de navigateur ni de backend lancé dans
cette session :

- aucun rendu réel n'a été vu : la mise en page des cartes de module, le
  débordement des libellés longs et le comportement responsive du camembert
  n'ont été vérifiés que par lecture ;
- le **chemin nominal complet** (créer un brouillon → téléverser un `.xlsx`
  valide → lire les 8 coûts → simuler) n'a jamais été exécuté de bout en bout.
  Il repose sur la lecture du contrat de `_ingest_needs_sheet` et de
  `_simulate_from_source`, pas sur une réponse réelle ;
- en particulier, **je n'ai pas vérifié sur une réponse réelle que les clés de
  `totalByModule` sont bien les 8 codes canoniques**. `extract_module_totals`
  les garantit par construction (`totals = {code: 0 for code in MODULE_CODES}`),
  et `canonicalModule()` absorberait une variante ; mais une clé inattendue
  serait silencieusement ignorée. Un test d'intégration front/back sur ce point
  vaudrait mieux que ma lecture ;
- les 422 ne sont affichés que sur la foi du contrat : aucun classeur invalide
  n'a été téléversé pour voir la liste s'afficher ;
- aucun test automatisé n'a été ajouté — il n'y a pas de harnais de test front
  dans le dépôt.

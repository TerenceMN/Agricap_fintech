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

### 2.1 Un échec de transport n'est pas un refus du fichier

Défaut trouvé en fin de lot, à l'occasion d'un échange avec `moteur-front-analyse`
sur le traitement des 401 — et **corrigé**, parce que la panne de transport
tombait dans le pire cadre possible.

**Ce qui se passait.** Toute exception non-422 passait par `guaranteeErrorList`,
donc par `NeedsSheetErrorList`, donc sous le titre « *N points à corriger dans
votre fichier* » et le pied « *Corrigez tous ces points dans le classeur, puis
téléversez-le à nouveau* ». Rejeu de la chaîne réelle :

| Cas | Message affiché | Cadre |
|---|---|---|
| 401 sans `detail` | « Le serveur a refusé cette opération. » | *à corriger dans votre fichier* |
| 500 | « Le serveur a refusé cette opération. » | *à corriger dans votre fichier* |
| 401 avec `detail` DRF | « Given token not valid for any token type » | *à corriger dans votre fichier* |

Une session expirée disait donc au client que **son classeur** était en cause,
et l'invitait à le modifier. Il aurait « corrigé » jusqu'à casser un document qui
n'avait rien — et la dernière ligne relayait un message technique anglais dans un
parcours client français.

**Le correctif.** `isFileValidationError()` sépare les deux familles : un refus
porte sur le contenu s'il a des `errors[]` structurés ou un statut 400 / 409 /
422 ; tout le reste (401, 403, 404, 5xx, échec réseau) est une panne de
transport. `transportErrorMessage()` nomme la cause quand le statut la donne et
reste vague sinon — jamais un motif métier inventé. Le rendu passe par
`NeedsSheetFailure`, cadre neutre distinct, sans vocabulaire de correction, avec
un bouton « Réessayer avec le même fichier » (masqué sur 401, où il faut d'abord
se reconnecter). Chaque message dit explicitement de **ne pas modifier le
classeur**. Appliqué aux deux appels de l'étape : téléversement et simulation.

Classification vérifiée sur 8 cas (422 pipeline, 409 non-draft, 400 création,
401, 403, 404, 500, échec réseau sans statut) : trois en « fichier », cinq en
« transport ».

**Portée.** Ce correctif ne traite pas la déconnexion elle-même — savoir si
l'application doit rediriger vers l'écran de connexion après un `refresh()`
échoué est transverse et hors de mon périmètre. Il traite le fait que mon écran
**désignait le mauvais coupable**, ce qui est local et m'incombe.

---

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

### 4.2 La lettre de score est recopiée côté front alors que le serveur la sert

> **Correction — cette section disait le contraire dans une version antérieure.**
> J'y écrivais que le front « contredit le moteur » et prescrivais d'aligner le
> 3ᵉ palier de 50 sur 55 et `>` sur `>=`. **C'était faux, et le correctif aurait
> introduit le bug qu'il prétendait réparer.** J'avais comparé la grille de la
> *lettre* aux échelles d'ajustement du *taux* — deux concepts distincts qui ont
> légitimement des bornes différentes. La prescription erronée ayant été relayée
> à `moteur-backend` et à `main`, elle est corrigée ici en clair plutôt que
> réécrite en silence.

**L'état réel, vérifié dans le code.**

`credits/analyse.py::score_lettre` applique la grille A>85 / B>70 / C>50 / D,
en comparaison **stricte**, lue depuis `BaremeScore.DECISION.parametres.lettres`
avec `LETTRES_DEFAUT` en secours. Les bornes strictes sont un choix documenté
(SPEC §6) et verrouillé par `test_lettre_de_score` : 85 → **B**, 70 → **C**,
50 → **D**.

`SCORE_BANDS` dans `SimulationResult.jsx` produit exactement le même résultat :
vérifié sur 15 scores, dont les bornes exactes 50 / 70 / 85. **Les chiffres du
front sont corrects.** Le défaut est la duplication, pas les valeurs.

**Ce que je comparais par erreur.** Les échelles 85 / 70 / **55** en `>=` de
`scoring.py` et `dataio_simulator.py` pilotent l'ajustement du taux (−2 / 0 /
+2 ou +2,5 / +5) et la note de valorisation. Ce sont les bandes de *tarification*,
pas la grille de *classement*. Les confondre est la même faute que
`moteur-front-analyse` a évitée sur `SimulationResult.jsx:112` (`c.points`, score
par critère) : deux échelles voisines, deux concepts. Reste vrai en revanche, et
indépendamment du front : ces deux ladders Python sont dupliqués entre les deux
modules et **divergent déjà entre eux** (+2,0 contre +2,5 sur la 3ᵉ bande). C'est
un défaut backend réel, sans rapport avec la lettre.

**Le vrai problème, qui subsiste.** Le serveur sait servir la lettre —
`scoreLettre` est exposé sur `analyse/` et `analyse-resume/` — mais **pas sur
`simulate/`**, le seul endpoint qu'utilise le parcours client. Tant que c'est le
cas, `SCORE_BANDS` reste nécessaire. Sa nocivité n'est pas de mentir aujourd'hui,
c'est de **dériver demain** : la grille est recalibrable en base par le comité
sans redéploiement (principe 8), et ce jour-là la copie front divergera en
silence, sans test rouge.

**Demande à `moteur-backend`, reformulée :** que `POST /credits/simulate/` serve
`scoreLettre` comme les endpoints d'analyse. Le front supprime alors
`SCORE_BANDS` et se contente d'afficher. C'est une extension d'un mécanisme déjà
livré, pas une conception nouvelle.

**Recensement des grilles front** (balayage
`grep -rnE "(>|>=) ?(85|70|55|50)" src`, après trois recensements incrémentaux
qui en avaient chacun manqué une) :

| Emplacement | Grille | Verdict |
|---|---|---|
| `simulateur/SimulationResult.jsx` — `SCORE_BANDS` | 85/70/50 `>` | conforme au moteur · dé-dupliqué (lettre + couleur fusionnées) |
| `admin/credits/CreditRow.jsx:20` | 85/70/50 `>` | conforme · duplication · hors périmètre |
| `admin/credits/CreditDetailsModal.jsx:109` | 85/70/50 `>` | conforme · duplication · hors périmètre |
| `pages/credit/ApplicationDetail.tsx:406` | **70/50 `>=`, 3 bandes** | **divergent** · hors périmètre |
| `pages/credit/Applications.tsx:285` | **70/50 `>=`, 3 bandes** | **divergent** · hors périmètre |
| `pages/credit/CreditAnalysis.tsx:152` | **70/50 `>=`, 3 bandes** | **divergent** · hors périmètre |

`SimulationResult.jsx:112` (`c.points >= 70 / 50`) n'est **pas** une copie :
c'est le score *par critère*, autre concept. `Credits.jsx` ré-importe
`scoreLetterOf`, ce n'est pas une copie non plus.

**La divergence réelle est donc dans `pages/credit/**`** : trois bandes au lieu
de quatre, seuils 70/50 en `>=`. Un dossier à 60 y est rouge alors qu'il est
« C » partout ailleurs ; à 90 il est premier niveau sur trois au lieu de premier
sur quatre. Ce sont les écrans d'instruction — file analyste, détail, analyse.
Ces trois-là consomment déjà `analyse/`, **donc déjà `scoreLettre`** : ils
peuvent l'afficher sans attendre quoi que ce soit du backend. Hors de mon
périmètre ; signalé à `moteur-front-analyse` et routé vers `main`.

**Ce que j'ai fait dans mon fichier, et pourquoi pas plus.** `SimulationResult.jsx`
portait *deux* échelles pour la même règle (lettre l.18, couleur du donut l.41),
à vingt lignes d'écart. Fusionnées en une table unique, **sans toucher aux
seuils** — non-régression vérifiée sur 15 cas. Je n'ai pas supprimé la copie :
`simulate/` ne sert pas encore la lettre. Je n'ai pas touché aux 5 autres
emplacements : `admin/**` et `pages/credit/**` sont hors de mon périmètre et
d'autres agents y travaillent.


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
- **`analyse-resume/` n'a aucun appelant dans le front.** Signalé à l'occasion
  d'une alerte de `moteur-front-analyse` sur `pointsForts: []` (le critère
  comportemental neutre ne tombe plus dans les points forts — le client sans
  historique ne lit plus « votre historique joue en votre faveur »). Vérification
  faite : le correctif ne peut pas se manifester ici, **parce que rien ne
  consomme cet endpoint**. `api.credits.analyseResume` existe dans `api.ts`,
  `CreditAnalyseResume` est typé dans `types/api.ts`, le backend le sert et un
  payload de référence est livré (`docs/contracts/moteur-analyse-payload-observe.json`,
  `pointsForts: []` ligne 453) — mais `grep -rn "analyseResume" src` ne remonte
  **aucun site d'appel**, seulement un commentaire.

  Conséquence : le client ne voit jamais la restitution de son analyse. C'est le
  cas « endpoint sans bouton » de CLAUDE.md §7.2, qui doit au minimum être
  documenté. C'est aussi la surface qui servirait `scoreLettre` au client (§4.2)
  et qui rendrait `SCORE_BANDS` supprimable. Hors périmètre du lot 3 — le
  simulateur n'est pas l'écran d'analyse — mais c'est un manque plus large que le
  rendu d'un tableau vide, et il n'a de propriétaire déclaré dans aucun fragment
  que j'ai lu. **À router.**
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
- ~~un échec de transport s'affichait comme un refus du fichier~~ — **corrigé**,
  voir §2.1 ci-dessous ;
- **le transport n'est pas validé** (cadrage repris de `moteur-front-analyse`,
  plus juste que le mien) : aucun appel HTTP réel n'a été émis depuis ce lot. Ne
  sont donc vérifiés ni les statuts effectivement reçus, ni le jeton, ni le
  chemin 401 → `refresh()` → rejeu. Ce dernier mérite une attention
  particulière ici : `request()` rejoue avec `{ ...opts }`, donc **le même objet
  `FormData`** pour l'upload de la feuille. Un `FormData` est en principe
  ré-émissible par `fetch` (ce n'est pas un flux consommé), mais si un jeton
  expire pendant un téléversement, ce chemin-là n'a jamais tourné. C'est le seul
  endroit du lot où une erreur de transport produirait un échec silencieux
  plutôt qu'un 422 affiché ;
- aucun test automatisé n'a été ajouté — il n'y a pas de harnais de test front
  dans le dépôt.

Ces réserves ne se lèveront qu'en exécutant l'application. Elles ne sont pas des
formalités : les trois défauts les plus intéressants de cette passe
(`pointsForts` neutre, colonne de zéros, `analyse-resume` sans appelant) avaient
tous un contrat honoré, un type correct et aucun test rouge.

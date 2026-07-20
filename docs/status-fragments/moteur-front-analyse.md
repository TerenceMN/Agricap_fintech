# Front — onglet « Analyse » du dossier de crédit (moteur de scoring)

> Fragment de statut. À fusionner dans `CREDIT_MODULE_STATUS.md` — ne pas éditer
> ce dernier depuis ce chantier.
> Auteur : MKOPO — juillet 2026.
> Périmètre : `src/components/analyse/*` (fichiers neufs, hors sous-dossier
> `simulateur/` qui appartient au chantier `RateMaturityModal`) et le branchement
> dans `src/components/admin/credits/CreditDetailsModal.jsx`.
> Références : CLAUDE.md §7.1.3 et principe 7 ; `docs/SPEC_Moteur_Analyse_Credits_AGRICAP.md`
> §2, §7, §8b, §A.4.

---

## 1. Ce qui est livré

Un onglet **Analyse** dans `CreditDetailsModal`, alimenté par
`api.credits.analyse(code)` et `api.credits.justifyIndicator(code, …)` — le
contrat `CreditAnalyse` de `src/types/api.ts` est consommé tel quel, il n'a pas
été touché.

| Fichier | Rôle |
|---|---|
| `src/components/analyse/AnalyseTab.jsx` | Orchestrateur : états, assemblage, dialogue de justification |
| `src/components/analyse/useCreditAnalyse.js` | Chargement de l'analyse ; distingue 404 / 403 / erreur |
| `src/components/analyse/RecommendationBanner.jsx` | Bandeau 4 niveaux + mention « le moteur recommande, l'humain décide » |
| `src/components/analyse/CriteriaTable.jsx` | Tableau des 5 critères, format SPEC §2 |
| `src/components/analyse/DscrPanel.jsx` | DSCR, DSCR stressé, facteur dominant, durée/différé/taux |
| `src/components/analyse/ModuleGaps.jsx` | Écarts par module, badge « hors plage », canal de justification |
| `src/components/analyse/EcheancierTable.jsx` | Échéancier prévisionnel, troncature annoncée |
| `src/components/analyse/JustifyIndicatorDialog.jsx` | `POST .../analyse/justifier/` |
| `src/components/analyse/analyseFormat.js` | Mise en forme fr-FR — délègue les montants au formateur des garanties |
| `src/components/analyse/recommandation.js` | Traduction du code de recommandation en libellé + couleur |

### 1.1 Les 5 critères — format SPEC §2

Ordre figé C1→C5 (jamais trié par score : l'analyste lit la même grille dossier
après dossier), une ligne par critère `score/100 × poids % = points`, séparateur,
puis `SCORE GLOBAL x/100`. Le commentaire du critère (`details.commentaire`)
s'affiche sous son libellé — c'est là que passent « Historique comportemental non
disponible » ou « Garanties non encore constituées — score indicatif ».

Le rendu est un vrai tableau HTML en `tabular-nums`, pas de l'ASCII monospace :
même lecture colonne par colonne, mais accessible et responsive.

### 1.2 Écarts par module et canal de justification

`ModuleGaps` fusionne **deux** sources du contrat par code d'indicateur :
`criteres.technique.details.ecartsHorsPlage` et `indicateursHorsPlage`. Aucun
indicateur n'est supprimé au passage — un indicateur présent d'un seul côté est
un signal, pas un doublon.

Chaque écart porte un badge rouge « Hors plage », son code canonique en
monospace (c'est lui qui repart au serveur, principe 6), sa valeur et sa
référence quand elles sont fournies, et un bouton « Justifier ». Les
justifications déjà enregistrées (`analyse.justifications`) sont affichées sous
leur indicateur avec agent et date.

Le dialogue envoie `{indicateur, justification}` et **remplace l'analyse par la
réponse du serveur** : aucune entrée de justification n'est fabriquée côté
client.

### 1.3 DSCR, stress, facteur dominant

`DscrPanel` affiche DSCR et DSCR stressé (2 à 3 décimales — la 3e est porteuse
près des seuils, `0,999` n'est pas `1,00`), avec durée / différé / taux à côté,
et le nombre d'échéances en phase `amortissement` **compté sur les lignes
renvoyées par le serveur**.

Si le backend fournit `criteres.dscr.details.facteurDominant` (et
`details.levier`), ils s'affichent en encart. Sinon, un message dit explicitement
que le moteur n'a pas renvoyé le diagnostic et que le levier chiffré
(« un différé de N mois porterait le DSCR à X », CLAUDE.md §4.6) viendra du
serveur — il n'est pas simulé côté client. **Ces deux clés ne sont pas encore au
contrat** : voir §3.

### 1.4 Bandeau de recommandation

4 niveaux : `approbation` vert, `approbation_cond` orange, `revue` jaune,
`refus` rouge. Un code inconnu n'est jamais rattaché au niveau le plus proche —
il s'affiche en neutre avec la mention « code non prévu par le barème ».

Le bandeau porte lui-même, en dur, la phrase « Le moteur recommande, l'humain
décide » et la précision qu'aucune transition de dossier n'est déclenchée. Cette
mention est dans le composant, pas laissée à la discrétion de l'écran qui
l'intègre.

### 1.5 États

| État | Rendu |
|---|---|
| Chargement | `Loading` (`backoffice/States`) |
| **404** | `Empty` « Analyse non encore exécutée » + bouton « Vérifier à nouveau » — **état vide, jamais rouge**. C'est le cas dominant tant que `moteur-backend` n'a pas livré. |
| 403 | `Forbidden` — décision d'autorisation, pas panne ; le front ne la contourne pas |
| Autre erreur | `ErrorPanel` + `toFieldErrors` (une ligne par erreur serveur, avec son code) |
| Réponse vide | `Empty` distinct du 404 |

L'onglet ne sollicite le moteur qu'à sa première ouverture ; le state vit dans
`useCreditAnalyse` appelé par le modal, parce que Radix démonte le contenu d'un
onglet inactif et qu'on ne veut pas re-solliciter le serveur à chaque
aller-retour entre onglets.

---

## 2. Ce que l'écran ne fait pas (et pourquoi)

- **Aucun calcul financier côté client.** Score, points par critère, score
  global, DSCR, DSCR stressé et tous les montants de l'échéancier sont affichés
  tels que le serveur les a arrêtés en `Decimal` (principe 4). En particulier :
  - la somme des points n'est **pas** recomposée pour vérifier le score global.
    Si un critère manque dans la réponse, un bandeau ambre le signale et le score
    global reste celui du serveur ;
  - **les totaux de l'échéancier ne sont pas affichés** (coût du crédit,
    service de la dette). La SPEC §A.4 les demande, mais le contrat
    `CreditAnalyse` ne les porte pas — les sommer en JavaScript créerait une
    seconde vérité financière en `float`. Voir §3.
- **Onglet staff uniquement.** Il expose barèmes, tolérances et plages du
  référentiel (principe 7). La surface est admin : `Credits.jsx` ne monte
  `AdminCreditsDashboard` → `CreditsTable` → `CreditDetailsModal` que pour
  `user.role === 'admin'`. Aucun composant de `src/components/analyse/` n'est
  importé par un écran client, et un rappel « Vue analyste — ne jamais restituer
  au client » est affiché en tête d'onglet. L'autorité reste le serveur : un 403
  s'affiche tel quel.
- **Aucune action de workflow.** Pas de bouton approuver/rejeter dans cet
  onglet : la décision se prend ailleurs, avec motif obligatoire.

---

## 3. Demandes au backend (`moteur-backend`)

Champs lus **de façon défensive** (absents = message explicite, jamais de valeur
inventée). Les aligner côté serveur ferait passer l'écran de « correct » à
« conforme §4.6 » :

1. `criteres.dscr.details.facteurDominant` (string) — la cause dominante du
   DSCR, ex. « différé 5/8 : le capital s'amortit sur 3 mois ».
2. `criteres.dscr.details.levier` (string) — le levier chiffré, ex. « différé
   3 mois → DSCR ≈ 0,95 ». Doit être **calculé par le moteur**, pas approché
   côté front.
3. **Totaux de l'échéancier** : `totalInterets`, `serviceDette` (et
   `totalCommissions` si la ligne `commission` de §A.3 est activée). Tant qu'ils
   manquent, l'écran n'affiche aucun total.
4. **Devise de l'analyse.** `CreditAnalyse` ne porte pas de devise ; l'onglet
   utilise `credit.currency` du dossier portefeuille par défaut, et affiche les
   montants sans devise si elle manque, avec la mention « devise non portée par
   la réponse d'analyse ». Un champ `currency` (+ taux et date de conversion,
   §9.4 de la SPEC) au contrat lèverait l'ambiguïté.
5. **Statut du référentiel** (`indicatif` / `appris`, `n_cas_reels`). CLAUDE.md
   §4.6 exige que l'incertitude soit assumée : une plage indicative ne doit pas
   s'afficher avec la même autorité qu'une plage apprise sur 200 dossiers.
   Aujourd'hui le front n'a que le code du référentiel.
6. **404 vs 200 vide.** L'écran traite le 404 comme « analyse non encore
   exécutée ». Si le backend préfère répondre 200 avec un corps vide, le dire —
   les deux sont gérés, mais un seul doit être la convention.
7. **La grille de classe de score dans `BaremeScore`, puis `scoreLettre` servi
   depuis là** (demande commune avec le lot 3, cf. §4.1). En deux temps, et
   l'ordre compte :
   - **Ne pas** se contenter de « servez la lettre ». Les seuils backend sont
     eux-mêmes codés en dur dans le Python et dupliqués entre `scoring.py` et
     `dataio_simulator.py`, avec des ajustements de taux qui **divergent déjà**
     (+2,5 contre +2,0 sur la 3ᵉ bande). Servir une lettre dérivée de l'une de
     ces deux échelles `if` remplacerait 4 sources de vérité par 2, sans rien
     régler.
   - La vraie demande est le **principe 8** : la grille descend dans
     `BaremeScore`, les deux modules Python la lisent, et l'API sert
     `scoreLettre` depuis là. C'est aussi ce qui permet au comité de la
     recalibrer sans redéploiement — l'objet même de la table.

   Enjeu principe 7 par-dessus : côté client, `scoreLetterOf` expose la grille de
   conversion — le client apprend qu'à 70,1 il passe de C à B.

Le contrat `src/types/api.ts` n'a **pas** été modifié (lecture seule côté
frontend) : ces ajouts sont à porter par le propriétaire du contrat.

---

## 4. Duplication du barème de recommandation — **résolue** (commit 35c3e52)

> Statut : tranché et appliqué. Conservé ici pour la trace, le diagnostic ayant
> servi à l'arbitrage.

Le chantier `RateMaturityModal` (fragment `moteur-front-reanalyse.md`) et
celui-ci portaient **deux traductions concurrentes du même barème à 4 niveaux**.
Elles avaient déjà divergé :

| code | `analyse/recommandation.js` | `analyse/simulateur/format.js` (avant) |
|---|---|---|
| `approbation` | « Approbation recommandée » · emerald | « Approbation » · emerald |
| `approbation_cond` | « Approbation sous conditions » · **orange** | « Approbation conditionnelle » · **lime** |
| `revue` | « Revue approfondie requise » · **yellow** | « Revue manuelle » · **amber** |
| `refus` | « Refus recommandé » · red | « Refus » · red |

Le lime sur `approbation_cond` n'était pas une nuance de teinte : il se lit
comme un feu vert là où l'orange signale une réserve. L'argument qui a tranché
n'est pas la cohérence visuelle mais l'usage : **le même analyste consulte les
deux écrans sur le même dossier à deux minutes d'intervalle** (l'onglet Analyse,
puis le simulateur pour tester un différé).

Résolution : `analyse/recommandation.js` est la source unique ;
`analyse/simulateur/format.js` dérive désormais `RECOMMANDATION_LABEL` et
`RECOMMANDATION_CLASS` de `RECOMMANDATION_CONFIG`. Libellés retenus : ceux de la
SPEC §3. `MODE_DIFFERE_LABEL`, `MODE_DIFFERE_AIDE` et `ecartEntre` restent
locaux au simulateur, ils lui sont propres.

> **Correction.** Une version antérieure de ce fragment reprochait aussi à
> `analyse/simulateur/format.js` de redéfinir `formatMontant`. **C'est faux** :
> ce fichier ré-exporte le formateur unique de `components/guarantees/format.js`
> et son en-tête refuse explicitement d'en créer un second. Il n'existe **aucun**
> second formateur de montants dans le dépôt. Grief retiré — signalé par le
> chantier lot 3, vérifié dans le code.

> **Correction.** Une version antérieure de ce fragment reprochait aussi à
> `analyse/simulateur/format.js` de redéfinir `formatMontant`. **C'est faux** :
> ce fichier ré-exporte le formateur unique de `components/guarantees/format.js`
> et son en-tête refuse explicitement d'en créer un second. Il n'existe **aucun**
> second formateur de montants dans le dépôt. Grief retiré — signalé par le
> chantier lot 3, vérifié dans le code.

### 4.1 Même famille, dette bien plus large : la grille de classe de score

> **Correction préalable.** Une version antérieure de ce §4.1 attribuait les
> seuils serveur à `credits/pipeline.py`. **Ce fichier n'existe pas** : il est
> *proposé* par la SPEC §6, il n'est pas écrit. J'ai cité comme code en place ce
> qui n'est qu'une intention de SPEC. Vérifié (`find backend -name pipeline.py`,
> négatif) et corrigé après signalement du lot 3. Les vrais emplacements sont
> ci-dessous.

Le front ne porte pas *une* grille divergente du backend : il en porte **deux,
incompatibles entre elles**, pour le même concept — la classe de risque d'un
score global.

| Emplacement | Grille | Opérateur | Usage |
|---|---|---|---|
| `src/components/simulateur/SimulationResult.jsx` (lot 3) | 85 / 70 / **50** | `>` | lettre A/B/C/D + couleur du donut |
| `src/pages/Credits.jsx` | ré-importe `scoreLetterOf` | `>` | lettre, vue client |
| `src/components/admin/credits/CreditDetailsModal.jsx:109` | 85 / 70 / **50** | `>` | `scoreColor` (pastille) |
| `src/components/admin/credits/CreditRow.jsx:20` | 85 / 70 / **50** | `>` | `ScoreBadge` (liste) |
| `src/pages/credit/ApplicationDetail.tsx:406` | **70 / 50**, 3 bandes | `>=` | couleur du score du dossier |
| `src/pages/credit/Applications.tsx:285` | **70 / 50**, 3 bandes | `>=` | couleur du score en liste |
| `src/pages/credit/CreditAnalysis.tsx:152` | **70 / 50**, 3 bandes | `>=` | couleur du score |
| `backend/credits/scoring.py:332` | 85 / 70 / **55** | `>=` | taux (−2 / 0 / **+2,5** / +5) |
| `backend/credits/scoring.py:397` | 85 / 70 / **55** | `>=` | `_valuation_note` |
| `backend/credits/dataio_simulator.py:343` | 85 / 70 / **55** | `>=` | `_valuation_note` |
| `backend/credits/dataio_simulator.py:580` | 85 / 70 / **55** | `>=` | taux (−2 / 0 / **+2,0** / +5) |

Ce n'est donc pas une duplication, ce sont **quatre contradictions** :

1. **Deux grilles front incompatibles.** Les écrans d'instruction
   (`pages/credit/**` — la file analyste, le détail de dossier, l'analyse)
   classent en **3 bandes 70/50** ; les écrans portefeuille et le simulateur
   classent en **4 bandes 85/70/50**. Un dossier à 90 est « vert, 1ᵉʳ niveau sur
   3 » d'un côté et « vert, 1ᵉʳ niveau sur 4 » de l'autre ; à 60, il est rouge
   dans la file analyste et jaune dans la liste portefeuille. Ce sont les écrans
   où la décision se prend.
2. **Front contre backend, sur la bande 50–54.** Un score de 52 s'affiche « C »
   en jaune, à côté d'une `valuationNote` serveur « Dossier à risque élevé —
   analyse approfondie requise » et d'un taux majoré de +5. La couleur dit 3ᵉ
   niveau, le reste de l'écran dit 4ᵉ.
3. **Opérateur `>` contre `>=`.** Un score valant **exactement 85 ou 70** tombe
   dans la bande haute pour le moteur et dans la bande suivante pour le front
   4-bandes. Bug de bord silencieux : corriger 50 → 55 sans corriger `>` → `>=`
   le laisserait intact, et il est plus discret donc plus durable. (Relevé par
   le lot 3.)
4. **Backend contre lui-même, sur la 3ᵉ bande.** `scoring.py` majore de +2,5,
   `dataio_simulator.py` de +2,0. Deux modules, deux taux pour le même score.

**Hors périmètre de ce constat, vérifié pour éviter un faux positif :**
`SimulationResult.jsx:112` (`c.points >= 70 / 50`) colore les **critères** d'un
dossier, pas le score global — `c.points` est un score sur 100 par critère.
Concept distinct, échelle légitimement différente. Ce n'est **pas** une copie de
plus.

Diagnostic initial dû au lot 3 (`CreditRow.jsx`, la 4 backend, l'opérateur) ;
les trois écrans de `pages/credit/**` et la vérification de `c.points` ajoutés
par un balayage `grep -rnE "(>|>=) ?(85|70|55|50)"` sur tout `src`.

**Pourquoi `scoreColor` n'a pas été corrigé unilatéralement.** Aligner 50 → 55
dans `CreditDetailsModal.jsx` seul ferait diverger la pastille du modal du badge
de la liste (`CreditRow.jsx`, hors de mon périmètre) : le même analyste verrait
jaune dans la liste et rouge dans le détail, sur le même dossier à dix secondes
d'intervalle. C'est très exactement le mode de défaillance qui vient d'être
arbitré au §4 — le reproduire pour corriger l'autre moitié serait absurde. Et
avec les trois écrans de `pages/credit/**`, un alignement partiel ferait pire :
il créerait une troisième grille.

Le correctif n'a de sens qu'**atomique sur les 7 emplacements front**, et il
doit porter sur les **trois** écarts à la fois — palier (50 → 55), opérateur
(`>` → `>=`), et unification des grilles 3-bandes et 4-bandes. Cela traverse
quatre périmètres d'agents (`admin/credits`, `pages/credit`, `pages/Credits.jsx`,
`components/simulateur`) : **à router comme une tâche unique**, pas à distribuer.

Demande commune au backend, reformulée en deux temps : voir §3, point 7.

### 4.2 Note de méthode

Ce recensement est passé de 3 à 7 emplacements front en trois itérations, entre
deux agents. À chaque tour, chacun a vérifié le pointeur de l'autre puis s'est
arrêté — et le tour suivant a trouvé une pièce de plus, à chaque fois **dans le
périmètre de celui qui venait de compter**. La cause est identifiable : on a
compté des *fichiers* au lieu de compter des *échelles*, et on a vérifié ce que
disait l'autre au lieu de balayer chez soi. Un `grep` unique sur tout `src` en
fin de chaîne a trouvé plus que les trois recensements successifs réunis.

Pour la prochaine dette de cette famille : balayer d'abord le dépôt entier sur
le motif, dédupliquer ensuite. L'inventaire complet coûte une commande ; le
recensement incrémental a coûté trois allers-retours et a produit deux
affirmations fausses en cours de route (cf. notes de correction ci-dessus).

---

## 5. Vérifications

- `npx tsc --noEmit` : **0 erreur**.
- `npx vite build` : **vert** (2832 modules, build en ~8 s). C'est le seul vrai
  garde-fou, `CreditDetailsModal.jsx` étant un `.jsx` non type-checké.
- `npx eslint src/components/analyse src/components/admin/credits/CreditDetailsModal.jsx` :
  6 erreurs, toutes `import/no-unresolved` sur l'alias `@/` pointant vers des
  modules `.ts` — **préexistantes** (elles frappent aussi
  `CreditDetailsModal.jsx` sur son import `@/services/api` d'origine et le
  sous-dossier `simulateur/`). Résolveur eslint à configurer, ce n'est pas une
  régression de ce lot.

### Non observé

**Aucune vérification navigateur n'a été faite** — pas de rendu réel, pas de
DevTools. N'ont donc pas été observés :

- le rendu visuel effectif de l'onglet (alignement des colonnes, couleurs des
  4 niveaux, comportement responsive du tableau des critères) ;
- l'imbrication du dialogue de justification dans le dialogue du modal (Radix la
  supporte, mais le focus trap et l'`Esc` en cascade n'ont pas été testés) ;
- le comportement réel des états 404 / 403 / erreur : les endpoints du moteur
  n'existent pas encore, aucune réponse serveur n'a été reçue. Le chemin
  « analyse chargée » n'a jamais été exercé sur des données réelles ;
- la troncature de l'échéancier au-delà de 24 lignes, faute d'échéancier ;
- la valeur réelle de `credit.applicationCode` : le modal reprend le repli
  existant `applicationCode || id` déjà utilisé par `AnalysisPanel`. Si cet id de
  prêt (`portfolio`) n'est pas une référence de dossier (`credits`), l'appel
  partira sur une mauvaise clé — à valider dès que le backend répond.

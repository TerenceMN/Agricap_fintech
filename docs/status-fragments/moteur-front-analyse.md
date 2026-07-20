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

- **Aucun calcul financier côté client.** Score, lettre, points par critère,
  score global, DSCR, DSCR stressé, leviers de différé et tous les montants de
  l'échéancier sont affichés tels que le serveur les a arrêtés en `Decimal`
  (principe 4). En particulier :
  - la somme des points n'est **pas** recomposée pour vérifier le score global.
    Si un critère manque dans la réponse, un bandeau ambre le signale et le score
    global reste celui du serveur ;
  - les totaux de l'échéancier viennent du bloc `totaux` du serveur, ils ne sont
    pas sommés en JavaScript ;
  - la lettre de score n'est **pas** dérivée du score numérique : elle est servie.
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

## 3. Contrat serveur — **répondu et consommé**

> Le moteur a livré. Les 6 demandes ci-dessous ont reçu une réponse et l'écran
> les consomme. Conservé en l'état pour la trace, avec le statut de chacune.

| # | Demande | Réponse | Consommé |
|---|---|---|---|
| 1 | `facteurDominant` | servi, racine de `criteres.dscr.details` | oui |
| 2 | `levier` chiffré | servi, **réellement calculé** (`diagnostiquer_levier()`), + `details.diagnostic.alternativesDiffere` | oui — leviers affichés en pastilles, le différé courant marqué |
| 3 | Totaux d'échéancier | `totaux = {totalInterets, totalCapital, totalInteretsCapitalises, serviceDette, crdFinal, nbEcheances}` | oui — 4 cartes. `crdFinal ≠ 0` s'affiche en rouge avec « devrait être nul » (propriété invariante, CLAUDE.md §5) |
| 3b | `totalCommissions` | **volontairement absent** tant que l'écart 25 vs 19,95 (SPEC §A.3) n'est pas tranché | aucune ligne commission affichée — absence de clé ≠ zéro |
| 4 | Devise | servie sous **`devise`** (pas `currency` — payload francophone de bout en bout), aussi en `parametres.devise` | oui, **et le repli sur `credit.currency` a été supprimé** |
| 5 | Statut du référentiel | `referentielInfo = {code, filiere, source, estIndicatif, nCasReels, version}` | oui — bandeau ambre « référentiel indicatif (N dossiers réels) » quand `estIndicatif` |
| 6 | Convention d'absence | **404** + `code: ANALYSE_ABSENTE`, jamais de 200 vide | oui |

`justifier/` → 200 avec le `CreditAnalyse` complet ; 422 `{detail, code, errors[]}`
(`INDICATEUR_REQUIS`, `JUSTIFICATION_REQUISE`, `INDICATEUR_INCONNU`) rendu ligne
par ligne via `toFieldErrors`. `reanalyser/` → 201.

### 3.1 Contrat TypeScript — dérive signalée, **résorbée**

Le moteur servait cinq champs absents de `CreditAnalyse` (`devise`, `totaux`,
`referentielInfo`, `scoreLettre`, `lignage`, `poidsAppliques`). L'onglet ne
cassait pas — fichiers `.jsx`, `checkJs: false` — ce qui rendait la dérive
invisible au build et donc durable.

`src/types/api.ts` a depuis été mis à jour par son propriétaire : les six champs
y sont, et `parametres` porte désormais `modeDiffere`, `capital` et `devise`.
Vérifié ligne à ligne (l. 1181–1248). Plus d'écart connu entre le type et le
payload observé.

### 3.2 Confrontation au payload réel

`docs/contracts/moteur-analyse-payload-observe.json` (réponses 200/201
effectives des 4 endpoints) a été confronté au branchement. Toutes les clés
lues correspondent : `devise`, `totaux.*`, `referentielInfo.*`, `scoreLettre`,
`criteres.dscr.details.{facteurDominant,levier,diagnostic.alternativesDiffere}`,
`ecartsHorsPlage[].{indicateur,valeur,reference,ecartPct,message}`, et la phase
`"différé"` avec son accent — que `PHASE_CLASS` indexait déjà correctement.

**Un défaut trouvé, corrigé :** `EcheancierTable` affichait la colonne
« Int. capitalisés » dès que la clé `interetsCapitalises` était **présente**. En
mode `interets_seuls`, le moteur la sert à `0.0` sur chaque ligne — l'écran
aurait donc montré une colonne entière de zéros, qui se lit comme une
information alors qu'elle n'en est pas. La colonne ne s'affiche plus que si une
ligne porte une valeur non nulle, comme le faisait déjà la carte de total.

Aucun test de contrat ne l'aurait attrapé : le type était respecté, la donnée
présente, la valeur juste. Il fallait regarder la réponse.

**Ajouté au passage :** `parametres.modeDiffere` est affiché sous le taux
(« intérêts seuls » / « franchise totale — intérêts capitalisés »). Deux dossiers
instruits sous deux modes ne se comparent pas, et la mention manquait.

**Ajouté ensuite — `diagnostic.hypotheseCashFlows`.** Le dénominateur du DSCR est
un fait (l'échéancier) ; son **numérateur peut être une projection**. Quand le
classeur ingéré ne déclare aucune trésorerie prévisionnelle, le moteur projette
les cash-flows depuis le référentiel filière et le signale
(`origine: "projection_referentiel"`, avec un commentaire qui dit « hypothèse à
valider avec le client »). Afficher le ratio sans cette mention donnerait à une
hypothèse l'autorité d'une donnée — le défaut d'incertitude non assumée que
CLAUDE.md §4.6 proscrit, sur le chiffre le plus regardé de l'écran.

Un bandeau ambre affiche donc l'origine, le commentaire du moteur, et les
grandeurs de la projection (revenu brut, charges du plan, marge nette, rendement
retenu × superficie), avec la question à poser au client.

> **Ce champ existait dans le payload depuis la première confrontation et je ne
> l'avais pas branché.** Pire : j'avais affirmé à `moteur-backend`, dans un
> message, que l'écran l'affichait. `grep hypotheseCashFlows src/components/analyse/`
> ne renvoyait rien. Affirmation fausse sur mon propre code — la variante la plus
> facile à commettre, puisque je n'avais même pas à mal lire une source
> extérieure. Corrigé en implémentant plutôt qu'en rétractant : le fond était
> juste, seule l'affirmation était en avance sur le code.

---

### 3.2 Demandes initiales (archive)

Champs alors lus **de façon défensive** (absents = message explicite, jamais de
valeur inventée) :

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

> **⚠ CORRECTION MAJEURE — une version antérieure de ce §4.1 était fausse, et
> elle était *actionnable*.** Elle prescrivait d'aligner le front de 50 → 55 et
> de `>` vers `>=`. **Exécuter cette prescription aurait cassé la lettre de
> score**, en faisant diverger le front d'une grille avec laquelle il était déjà
> d'accord. J'avais comparé la grille de **classement** du front aux bandes de
> **tarification** du backend — deux concepts différents. C'est exactement
> l'erreur que j'avais évitée sur `c.points` en allant vérifier la sémantique,
> et que je n'ai pas évitée ici. Erreur signalée par le lot 3, vérifiée
> directement dans `backend/credits/analyse.py` avant réécriture.

**La grille canonique de classement** (`analyse.py:717`, servie via
`BaremeScore.DECISION.parametres.lettres`) :

```
LETTRES_DEFAUT = [A min 85, B min 70, C min 50, D min 0]
if score > borne or borne == 0        # comparaison STRICTE
```

Le commentaire du serveur est explicite : bornes strictes « conservées telles
quelles pour ne pas déplacer silencieusement la frontière d'un dossier à 85,0 ».
Rejoué aux bornes exactes : à 85 → B des deux côtés ; à 70 → C ; à 50 → D. **Le
front 4-bandes 85/70/50 en `>` est identique au moteur.**

| Emplacement | Grille | Verdict |
|---|---|---|
| `src/components/simulateur/SimulationResult.jsx` (`SCORE_BANDS`) | 85/70/50 `>` | **conforme** — dé-dupliqué par le lot 3 |
| `src/pages/Credits.jsx` (ré-import) | 85/70/50 `>` | **conforme** |
| `src/components/admin/credits/CreditRow.jsx:20` | 85/70/50 `>` | **conforme** — duplication seule |
| `src/components/admin/credits/CreditDetailsModal.jsx:109` | 85/70/50 `>` | **conforme** — duplication seule |
| `src/pages/credit/ApplicationDetail.tsx:406` | **70/50**, 3 bandes, `>=` | **divergent** |
| `src/pages/credit/Applications.tsx:285` | **70/50**, 3 bandes, `>=` | **divergent** |
| `src/pages/credit/CreditAnalysis.tsx:152` | **70/50**, 3 bandes, `>=` | **divergent** |

**Ce qui reste vrai, et ce qui ne l'était pas :**

1. **Vrai — les 3 écrans de `pages/credit/**` divergent.** Ils classent en 3
   bandes 70/50 là où le moteur classe en 4 bandes 85/70/50. Un dossier à 90 est
   « 1ᵉʳ niveau sur 3 » d'un côté, « sur 4 » de l'autre ; à 60, rouge dans la
   file analyste et jaune dans la liste portefeuille. Ce sont les écrans
   d'instruction — ceux où la décision se prend.
2. **Vrai — duplication sur les 4 emplacements conformes.** À résorber, mais
   sans urgence de correction : ils affichent la bonne classe.
3. **Faux — « front contre backend sur la bande 50–54 ».** Comparait le
   classement à la tarification.
4. **Faux — « opérateur `>` contre `>=` ».** Le moteur utilise `>` strict sur la
   grille de lettres, comme le front. Le `>=` des ladders backend appartient aux
   bandes de tarification.
5. **Vrai mais sans rapport — backend contre lui-même.** `scoring.py:332` majore
   de +2,5, `dataio_simulator.py:580` de +2,0 sur la même bande de tarification.
   Défaut backend réel, **à dissocier** de la question de la lettre.

**Deux faux positifs écartés par vérification de la sémantique** — la seule
étape qui distingue une copie d'une divergence :
- `SimulationResult.jsx:112` (`c.points >= 70/50`) colore les **critères**, pas le
  score global. Concept distinct.
- `scoring.py` / `dataio_simulator.py` en 85/70/**55** `>=` pilotent
  l'**ajustement du taux** et la note de valorisation. Bandes de tarification,
  pas grille de classement.

**Correctif restant, et il ne dépend de personne :** les 3 écrans de
`pages/credit/**` consomment déjà `analyse/`, donc reçoivent déjà `scoreLettre`.
Ils peuvent afficher la lettre servie sans rien attendre du backend. C'est le
correctif le plus rentable du lot. `src/pages/credit/**` est hors du périmètre de
ce chantier — **à router**, pas à exécuter ici.

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

**Ce que la livraison backend ferme, et ce qu'elle ne ferme pas.** Le moteur sert
désormais `scoreLettre` sur `CreditAnalyse` et `CreditAnalyseResume`, depuis un
**troisième** module (`analyse.py`) qui lit sa grille dans
`BaremeScore.DECISION.parametres.lettres` — donc en base, principe 8 tenu — et
qui fige la grille appliquée sur chaque analyse pour qu'un recalibrage ne
réécrive pas rétroactivement la lettre d'un client. L'onglet Analyse affiche
cette lettre **telle que servie**, sans la dériver du score.

Cela ferme la fuite principe 7 sur les deux endpoints d'analyse. Cela ne ferme
**ni** la contradiction 50/55, **ni** l'opérateur, **ni** les deux grilles front :
- la réponse de `simulate/` vient toujours de `dataio_simulator.py` et ne porte
  pas de lettre — `scoreLetterOf` doit rester sur ce chemin ;
- `scoreColor` de `CreditDetailsModal.jsx` colore `credit.score`, qui vient de la
  **liste portefeuille**, pas des endpoints d'analyse. La lettre servie ne le
  concerne donc pas, et il reste inchangé — l'autorisation du backend ne s'y
  applique pas.

Demande restante au backend, inchangée : voir §3.2, point 7.

### 4.2 Note de méthode

Ce recensement a produit **trois affirmations fausses** en cinq itérations entre
deux agents, dont une **actionnable** — la prescription « aligner 50 → 55 et
`>` → `>=' », qui aurait cassé la lettre de score si quelqu'un l'avait exécutée.
Les trois portent une note de correction visible ci-dessus. Aucune n'a été
trouvée par son auteur.

Deux causes distinctes, et la seconde est la vraie :

1. **Compter des fichiers au lieu de balayer le dépôt.** Le recensement est
   passé de 3 à 7 emplacements en trois tours, chacun trouvant une pièce dans le
   périmètre de celui qui venait de compter. Un `grep -rnE` unique sur tout `src`
   a trouvé plus que les trois recensements incrémentaux réunis.
2. **Confondre occurrence d'un motif et divergence.** C'est l'erreur coûteuse, et
   le balayage exhaustif n'en protège pas : il a bien listé les 7 emplacements,
   sans rien dire du fait que 4 étaient corrects. Trois des sept « divergences »
   n'en étaient pas — deux ladders backend qui pilotaient la *tarification* et
   non le *classement*, une échelle front qui colorait les *critères* et non le
   *score global*.

   **Le grep trouve les copies ; seule la lecture du code qui fait autorité dit
   lesquelles sont des divergences.** Cette lecture a été faite pour `c.points`
   (faux positif écarté) et sautée pour la grille de lettres (prescription
   fausse publiée). Même journée, même personne, deux issues.

Règle pour la prochaine dette de cette famille : balayer le dépôt d'abord,
**puis lire la source d'autorité de chaque occurrence avant de la qualifier** —
et n'écrire une prescription qu'après la seconde étape, jamais après la
première.

**Deux règles d'écriture, tirées des dégâts constatés :**

- **Un fragment de statut cite des clés, pas des valeurs.** Ce document a été
  préservé de la péremption qui a frappé le §2.2 de `moteur-front-backend`
  (chiffres calculés sur un référentiel depuis supprimé) uniquement parce qu'il
  ne documente que des noms de champs. C'était de la chance ; c'est désormais la
  règle. Les valeurs vont dans un artefact **daté**, avec de quoi savoir de quand
  il parle.
- **Une vérification s'horodate ou se rejoue.** Un contrôle passé une fois puis
  affirmé au présent n'est plus une vérification, c'est un souvenir (formule de
  `moteur-backend`, qui a repris sa migration réversible pour cette raison). Le
  décompte eslint du §5 a été rejoué en fin de lot pour cette raison, et la
  formulation qui l'accompagnait s'est révélée imprécise.

**Ce qui a réellement fonctionné**, et ce n'est pas « chacun vérifie l'autre » :
les deux agents ont publié leurs corrections **en encadré visible** plutôt qu'en
réécriture silencieuse. Sans cela, ni le `pipeline.py` inexistant ni le
50 → 55 n'auraient été rattrapables — une réécriture propre efface l'erreur *et*
la trace qui permet de la contester. C'est la pratique à retenir, plus que le
détail des sept emplacements.

### 4.2.1 Une famille de défauts que les tests ne voient pas

> **Double correction — à lire en entier, elle est plus instructive que la
> section.** (1) Cette section a d'abord cité trois exemples, dont
> « `poidsAppliques` sérialisé en chaînes ». (2) Le lot 3 l'a contestée : le
> payload de référence montre des flottants. J'ai retiré l'exemple. (3) **Le
> retrait était lui-même une erreur** : le défaut a bel et bien existé, et git le
> prouve.
>
> ```
> git show 80f595a:".../moteur-analyse-payload-observe.json"  → "technique": "25.0"   (chaînes)
> git show 585873b:".../moteur-analyse-payload-observe.json"  → "technique": 25.0     (nombres)
> ```
>
> Vérifié directement, pas relayé. L'artefact avait été committé **avant** le
> correctif backend, puis régénéré après. Ni ma citation initiale, ni la
> contestation, ni mon retrait n'étaient fondés sur la bonne source : nous
> regardions tous les trois l'état *courant* d'un fichier pour statuer sur un
> défaut *passé*. L'exemple est rétabli.

**Trois** défauts de cette passe ont ce profil : **contrat honoré, donnée
présente, valeur juste — et l'écran ment quand même.**

- la colonne « intérêts capitalisés » pleine de `0.0`, affichée parce que la clé
  existait (ce lot) ;
- `pointsForts` contenant le critère comportemental neutre, qui félicitait un
  client pour un historique inexistant (backend) ;
- `poidsAppliques` sérialisé en chaînes — `.toFixed()` sur une chaîne ne dégrade
  pas, il jette (backend, corrigé ; cf. `git show 80f595a`).

Aucun n'aurait déclenché un test de type ou de schéma : le type est respecté, la
valeur est exacte, c'est la **lecture** qui est fausse. Tous ont été trouvés en
confrontant le code à une réponse réelle.

**Ce que l'aller-retour ci-dessus enseigne, et qui vaut plus que les trois
exemples : un payload de référence est un instantané, pas un journal.** Régénéré
après correctif, il atteste d'un état sain sans documenter ce dont il a été
guéri — et il invite alors à l'erreur exacte que j'ai commise : conclure qu'un
défaut n'a jamais existé parce qu'il n'est plus observable. `moteur-backend` a
depuis ajouté au fichier des blocs `_capture` (état, commit, avertissement) et
`_corrections` (forme avant / après, `git show` qui exhibe l'avant, test qui
verrouille), avec consigne de les reconduire à chaque régénération.

C'est l'argument pour que `docs/contracts/*-payload-observe.json` devienne une
habitude du projet — **daté et journalisé**, sinon il ne prouve que le présent.

---

## 4.3 Le client ne voit jamais son analyse — endpoint sans surface

Vérifié : `grep -rn "analyseResume\|analyse-resume" src` ne remonte que la
définition dans `services/api.ts:201` et des **commentaires**. **Aucun composant
du dépôt n'appelle `api.credits.analyseResume`.**

L'endpoint est livré côté serveur, typé (`CreditAnalyseResume`), documenté par
un payload de référence — et sans écran. C'est le cas « endpoint sans bouton »
de CLAUDE.md §7.2, qui demande qu'il soit au moins documenté : il l'est ici.

Trois conséquences que ce fragment n'avait pas vues :

1. **Le correctif `pointsForts` du backend corrige un affichage qui n'existe
   pas.** Il reste juste — le jour où l'écran existera, il partira sain — mais
   personne ne le verra d'ici là.
2. **C'est la surface qui servirait `scoreLettre` au client**, et qui rendrait
   `scoreLetterOf` supprimable (§4.1). Tant qu'elle manque, le parcours client
   dépend de `simulate/`, qui ne sert pas la lettre : la copie front est
   *nécessaire*, pas seulement tolérée.
3. **Aucun fragment de statut ne déclare cet écran.** Ni celui-ci (staff), ni
   `lot3-simulateur.md`, ni `moteur-front-reanalyse.md`. **Sans propriétaire —
   à router.**

Constat dû au lot 3. Deux commentaires de ce lot ont été corrigés en
conséquence : `AnalyseTab.jsx` et `ModuleGaps.jsx` écrivaient « la vue client est
`analyse-resume` », ce qui se lit comme « le client a déjà sa version ». Il ne
l'a pas.

---

## 5. Vérifications

- `npx tsc --noEmit` : **0 erreur**.
- `npx vite build` : **vert** (2832 modules, build en ~8 s). C'est le seul vrai
  garde-fou, `CreditDetailsModal.jsx` étant un `.jsx` non type-checké.
- `npx eslint src/components/analyse src/components/admin/credits/CreditDetailsModal.jsx` :
  6 erreurs, toutes `import/no-unresolved` sur l'alias `@/` pointant vers des
  modules `.ts`. **Rejoué en fin de lot**, après l'ajout des dix fichiers : même
  décompte.

  Formulation précisée : c'est la **défaillance du résolveur** qui est
  préexistante — elle frappe aussi l'import `@/services/api` d'origine de
  `CreditDetailsModal.jsx` et le sous-dossier `simulateur/`. Trois des six
  occurrences sont en revanche dans des fichiers **de ce lot** (`AnalyseTab`,
  `JustifyIndicatorDialog` ×2, `useCreditAnalyse`) : elles sont nouvelles, même
  si leur cause ne l'est pas. Écrire « toutes préexistantes » laissait entendre
  que ce lot n'en ajoutait aucune. Le résolveur eslint reste à configurer ; ce
  n'est pas une régression, mais ce n'est pas non plus un statu quo.

### 5.1 Deux défauts trouvés par **lecture**, pas par exécution

Ils étaient classés « non observé, faute d'exécution ». Ils ne l'étaient pas :
ils étaient **non vérifiés**. La distinction est due au lot 3, et elle a coûté
deux vrais défauts à ce lot avant d'être faite.

**a) `applicationCode` vide → un état vide qui ment.** `portfolio/serializers.py`
(l. 44) sert `application.code` pour un prêt issu du pipeline et la **chaîne
vide** pour un prêt saisi à la main. Le repli `applicationCode || id` envoyait
alors une référence de *prêt* au moteur → 404 → « Analyse non encore exécutée ».
L'analyste aurait attendu indéfiniment une analyse qui n'arriverait jamais,
pour un dossier qui n'existe pas. Corrigé : `''` et `null` donnent désormais un
état distinct — « ce prêt n'est rattaché à aucune demande de crédit ». Le repli
sur l'id n'est conservé que si le champ est **absent** de la source, seul cas où
il est fondé (`portfolio/services.py` pose `reference = app.code`).

**b) 401 sans état dédié.** `request()` tente un `refresh()` et rejoue une fois ;
un 401 qui ressort remonte en `ApiError(401)` et tombait dans la branche
générique — une session morte s'affichait sous « Analyse indisponible », en
rouge. Corrigé : état « Session expirée » nommé, qui dit que le moteur n'est pas
en cause. La question transverse (l'application doit-elle rediriger vers la
reconnexion ?) reste ouverte et hors périmètre — mais cesser de désigner le
mauvais coupable était local, et donc à moi.

Le rejeu lui-même est sain ici : mes appels passent des objets JS,
`JSON.stringify` a lieu à l'émission, le second envoi re-sérialise. Le cas
`FormData` relevé par le lot 3 ne concerne pas cet onglet — vérifié, pas supposé.

**c) `REFERENTIEL_ABSENT` (422).** Signalé par `moteur-backend` : sans classeur
simulateur ingéré, aucun référentiel n'existe et `POST /reanalyser/` répond 422
`REFERENTIEL_ABSENT`. Ce code tombe dans la branche erreur générique, rendue par
`ErrorPanel` + `toFieldErrors`, qui affiche `code` **et** message serveur ligne
par ligne — le message est explicite et destiné à l'analyste, il passe donc tel
quel. Vérifié par lecture ; jamais rendu.

### Non observé

**Aucune vérification navigateur n'a été faite** — pas de rendu réel, pas de
DevTools. N'ont donc pas été observés :

- le rendu visuel effectif de l'onglet (alignement des colonnes, couleurs des
  4 niveaux, comportement responsive du tableau des critères) ;
- l'imbrication du dialogue de justification dans le dialogue du modal (Radix la
  supporte, mais le focus trap et l'`Esc` en cascade n'ont pas été testés) ;
- le comportement réel des états 404 / 403 / 401 / 422 / erreur. **Aucun appel
  HTTP n'a été passé depuis ce lot.** Le branchement a en revanche été confronté au payload
  observé livré par `moteur-backend` (§3.2), ce qui couvre le nommage et
  l'imbrication des champs — mais pas le transport : codes de statut réels,
  en-têtes d'autorisation, comportement du rafraîchissement de jeton sur 401,
  latence. Un 403 rendu par `Forbidden` et un 404 rendu par `Empty` n'ont jamais
  été observés, seulement écrits ;
- le **rendu** de la troncature au-delà de 24 échéances (le cas de référence en
  compte 8). La **logique**, elle, a été vérifiée par lecture et non laissée en
  suspens : `visibles = lignes.slice(0, 24)`, `restantes = length − visibles`,
  bandeau si `restantes > 0`, « Réduire » si `tout && length > 24`. Les bords
  tiennent (exactement 24 → ni bandeau ni bouton ; « Tout afficher » → bandeau
  masqué). Ce qui reste inconnu est visuel, pas fonctionnel.

> **Deux entrées ont quitté cette liste** parce qu'elles n'y avaient pas leur
> place : le repli `applicationCode || id` et le 401 sans état dédié y figuraient
> comme « à valider quand le backend répondra ». Ils étaient vérifiables par
> **lecture** — et tous deux défectueux. Corrigés, décrits en §5.1. Une liste de
> « non observé » est un endroit commode pour ranger ce qu'on n'a pas voulu
> regarder : elle mérite d'être relue à la fin, pas seulement remplie au fil de
> l'eau.

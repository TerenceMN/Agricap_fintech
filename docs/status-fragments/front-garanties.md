# Front — actifs & garanties opposables (chantier 2, lots 1 · 4 · 5)

> Fragment de statut. À fusionner dans `CREDIT_MODULE_STATUS.md` §9.6 / « Reste à faire ».
> Auteur : MKOPO — juillet 2026. Périmètre : `AssetsInventory.jsx`, `Credits.jsx`,
> `src/components/assets/**`, `src/components/guarantees/**`.

---

## 1. Ce qui est branché

### 1.1 Nomenclature canonique (lot 1 — SPEC §2.2)

`GUARANTEE_CONFIG` a quitté `Credits.jsx` pour
[`src/components/guarantees/guaranteeConfig.js`](../../src/components/guarantees/guaranteeConfig.js).
Il porte désormais **4 codes de stockage**, ceux du backend :

| Code canonique | Libellé affiché | Adossé à |
|---|---|---|
| `epargne` | Nantissement Épargne | hold `SavingsPlan` |
| `morale` | Caution Solidaire | garant du groupe |
| `materiel` | Gage matériel | `Asset` mobilier vérifié |
| `foncier` | Hypothèque / Foncier | `Asset` immobilier vérifié |

`actif`, `immobilier`, `Gage matériel`, `Hypothèque` — ainsi que les catégories
`vehicule` et `stock` — sont réduits à des **alias d'affichage** résolus par
`canonicalGuaranteeType()` / `guaranteeConfig()`. Aucun de ces libellés n'est
plus envoyé au serveur ni stocké. Les deux points de lecture de l'ancienne
constante (`GestionCreditsClient`, `FicheSynthese`) passent par `guaranteeConfig()`.

### 1.2 `AssetsInventory.jsx` — sorti du localStorage (lot 4)

- Lecture : `api.assets.mine()` → `{ total_rows, items }`. `total_rows` est
  affiché (honnêteté d'interface), ainsi que le nombre d'actifs mobilisables.
- **Cinq statuts** rendus explicitement (`declare → verifie → gage → libere`,
  plus `rejete`) : bandeau « cycle de vie » en tête d'écran, badge coloré par
  carte, filtres par statut avec effectifs.
- **Valeur déclarée vs valeur retenue** : deux blocs distincts sur chaque carte,
  plus une phrase fixe — « seule la valeur retenue, arrêtée par l'agent après
  décote, entre dans la couverture d'un crédit ». La valeur retenue absente
  s'affiche « Non fixée », jamais 0.
- **Aucun contrôle de statut ni de valeur retenue** n'est exposé : le formulaire
  ne saisit que les champs de `CLIENT_WRITABLE` (`name`, `type`, `value`,
  `currency`, `description`, `localisation`, `documents`).
- **Actif `gage`** : boutons Modifier et Supprimer grisés, icône cadenas,
  `title` explicatif, et un encart orange sur la carte qui dit pourquoi. Si
  l'utilisateur force le passage, le 409 `ASSET_PLEDGED` est traduit.
- **Modification d'un actif vérifié** : avertissement *avant* validation, dans
  le dialogue, avec case à cocher obligatoire (« il repassera en file de
  vérification, sa valeur retenue sera effacée »). Le bouton Enregistrer reste
  désactivé tant qu'elle n'est pas cochée.
- **`motifRejet`** affiché en clair sur toute carte au statut `rejete`.
- États de chargement (skeletons), d'erreur (bandeau + Réessayer) et vide
  (deux variantes : registre vide, filtre sans résultat) sur chaque écran.

Nouveaux fichiers : `assetMeta.js`, `AssetCard.jsx`, `AssetFormDialog.jsx`.

### 1.3 `ConfigurationGaranties` — garanties opposables (lot 5)

- « Mes Actifs Enregistrés » devient « Mes actifs mobilisables », alimenté par
  `api.assets.mine({ pledgeable: true })`. Le filtre est **serveur**
  (`Asset.is_pledgeable`) : le front ne recalcule aucune éligibilité.
- **Client sans actif mobilisable** : encart explicite reprenant la formulation
  de la SPEC (« déclarez un actif dans Mes Actifs ; il devra être vérifié par un
  agent avant de servir de garantie »), lien vers `/assets`, et **aucun contrôle
  cochable** — les deux puces `Gage matériel` / `Hypothèque` s'affichent grisées
  avec le motif en `title`.
- **Pose du gage** via `api.credits.placeAssetGuarantee(code, assetId)`. Chaque
  refus devient une consigne actionnable (voir §3.1 pour la limite technique).
- **Couverture** rendue par `GuaranteeCoverage.jsx` depuis l'objet `coverage`
  (`retainedTotal`, `requestedAmount`, `ratio`, `activeCount`, `currency`), avec
  la mention « calculé sur les valeurs retenues après décote » et le rappel
  qu'une garantie `pending` ne couvre rien.
- **Épargne et caution solidaire ne sont plus cochables.** Leurs endpoints
  (`guarantees/savings/`, `guarantees/moral/`) exigent `CAN_INSTRUCT` côté
  serveur : un client recevrait 403. Elles sont présentées en cartes
  informatives « constituées avec votre agent » — CLAUDE.md §7.2, « un bouton
  sans permission serveur n'existe pas ». Cela supprime au passage le calcul
  client `formData.totalFinanced * 0.2` qui inventait un montant de nantissement.

### 1.4 Effets de bord assumés dans `Credits.jsx`

- **Création du brouillon avancée.** Poser une garantie exige un dossier
  existant. `ensureDraft()` crée le `CreditApplication` en DRAFT **à la première
  mobilisation d'actif** (pas à l'ouverture de l'étape, pour ne pas semer des
  dossiers vides), puis `submitApplication` le réutilise au lieu d'en créer un
  second. `resetProcess` remet le code à zéro.
- **`_appToLoan` corrigé.** Il lisait `app.value_chain`, `app.amount_approved`,
  `app.score_result` alors que `credits/workflow.py::serialize_application` émet
  du camelCase (`valueChain`, `amountApproved`, `scoreResult`). Ces clés ne se
  croisaient jamais : montant approuvé, filière et échéancier s'affichaient
  vides sur des données présentes. Signalé en parallèle par l'agent
  *front-backoffice* sur ses propres écrans.
- **Taux indicatif** : la formule client `((100 - score) / 10 + 8)` est
  remplacée par `simResult.proposedRate`, ou « communiqué après analyse ».
- **Montants** : passage au formateur unique `formatMontant()` (fr-FR + devise
  portée par la donnée), dans `src/components/guarantees/format.js`.
- `formData.guarantees` supprimé : l'étape 4 lit le résumé serveur des
  garanties, plus une copie locale de la sélection.

---

## 2. Vérifications faites — et ce que je n'ai pas pu tester

| Vérification | Résultat |
|---|---|
| `npx tsc --noEmit` | **0 erreur dans mon périmètre** ; 27 erreurs dans `src/pages/credit/ApplicationDetail.tsx`, apparues pendant ma session — voir l'encadré ci-dessous |
| `npx vite build` | **OK** (2 805 modules, 5,4 s) |
| `npx eslint` sur mes fichiers | 0 warning ; seule reste l'erreur `import/no-unresolved` sur `@/services/api`, **pré-existante et générale** (reproduite sur `src/pages/Contracts.jsx`, non modifié) : le resolver eslint n'attrape pas l'extension `.ts` |
| `grep localStorage` sur mes fichiers | 0 occurrence de code (2 mentions en commentaire, documentaires) |

> **Le gate `tsc` du dépôt n'est plus vert, et ce n'est pas de mon fait.**
> `src/types/api.ts` a été migré en camelCase pendant ma session (modification
> non commitée, +52/−9, horodatée 13:47). `src/pages/credit/ApplicationDetail.tsx`
> lit encore les anciennes clés snake_case et porte les **27 erreurs** ; il a été
> touché à 16:29, donc après la migration — c'est très probablement un chantier
> en cours, pas un oubli. Les deux fichiers sont en **lecture seule** dans mon
> périmètre : je ne les corrige pas, je les signale (à `front-backoffice`, qui
> travaille dessus).
> Ventilation vérifiée : `npx tsc --noEmit | sed 's/(.*//' | sort | uniq -c`
> ⇒ 27 occurrences, toutes dans `ApplicationDetail.tsx`, **aucune** dans
> `Credits.jsx`, `AssetsInventory.jsx`, `components/assets/**` ou
> `components/guarantees/**`. `npx vite build` passe (Vite ne type-checke pas).
>
> Bonne nouvelle au passage : la migration a élargi `guaranteeType` aux
> 4 codes canoniques `'epargne' | 'morale' | 'materiel' | 'foncier'` — le §3.5
> ci-dessous est donc partiellement résorbé. `coverage` et l'objet `asset` par
> garantie restent absents de `CreditGuaranteeSet`.

**Je n'ai pas de navigateur : rien de ce qui suit n'a été exécuté.** Je ne peux
pas affirmer que ces écrans fonctionnent, seulement qu'ils compilent et que les
appels correspondent aux contrats lus dans le code backend. Restent à valider en
conditions réelles :

- le rendu et la navigation de l'inventaire (filtres, dialogues, focus) ;
- le parcours complet étape 3 : création du brouillon → pose du gage →
  rafraîchissement de la liste et de la couverture ;
- les cinq refus 422 : je n'ai déclenché aucun d'eux, seulement écrit leur
  traduction ;
- le 409 `ASSET_PLEDGED` sur modification et suppression ;
- le retour visuel du 403 `FIELD_NOT_WRITABLE` (aucun contrôle ne permet plus de
  le provoquer — c'est une défense en profondeur, pas un chemin nominal) ;
- l'accessibilité clavier des nouveaux dialogues.

---

## 3. Divergences code / SPEC relevées (non corrigées — hors de mon périmètre)

### 3.1 Les 5 codes d'erreur du gage ne sortent pas du backend

`credits/guarantees.py::place_asset_guarantee` **documente** cinq codes distincts
(`ASSET_NOT_OWNED`, `ASSET_NOT_VERIFIED`, `ASSET_ALREADY_PLEDGED`,
`ASSET_CATEGORY_MISMATCH`, `ASSET_NO_RETAINED_VALUE`) mais lève un
`GuaranteeError` générique pour les cinq. `credits/views.py:992` les aplatit tous
en `code: "ASSET_GUARANTEE_REFUSED"`. Seul `GUARANTEE_TYPE_NOT_ELIGIBLE` remonte
son code propre. La SPEC §2.4 attend cinq codes distincts.

### 3.2 `ApiError` perd le champ `code`

`src/services/api.ts:52` construit `new ApiError(status, detail)` : le `code` du
corps 422/409 est **jeté avant d'arriver au front**. Aucun écran ne peut donc
router sur un code d'erreur aujourd'hui. Fichier hors de mon périmètre.

**Contournement en place** dans
[`guaranteeErrors.js`](../../src/components/guarantees/guaranteeErrors.js) : on
lit `err.code` s'il existe un jour (compatibilité ascendante), sinon on retrouve
la règle par la **signature du `detail`** backend, qui est déjà spécifique par
règle. À défaut, on relaie le `detail` tel quel — jamais « une erreur est
survenue ». C'est fonctionnel mais fragile : une reformulation d'un message
backend casse silencieusement la correspondance.

**Correctif propre, dans cet ordre** : (a) `ApiError` porte `code` et le corps
JSON complet ; (b) `place_asset_guarantee` lève des exceptions typées par règle ;
(c) `guaranteeErrors.js` supprime `DETAIL_SIGNATURES`.

### 3.3 Modifier un actif `libere` ne le renvoie pas en vérification

`assets/views.py:142` remet en `declare` et efface `valeur_retenue` **uniquement**
si `status == VERIFIE`. Un actif `libere` est pourtant `is_pledgeable` (models.py:94)
et conserve sa valeur retenue : il peut donc être modifié après coup et
re-mobilisé avec une valeur certifiée sur un bien qui a changé. La règle du §9.6
(« toute modification d'un actif déjà vérifié le remet en file de vérification »)
devrait couvrir `LIBERE` aussi. Côté front, je n'avertis que sur `verifie` —
avertir sur `libere` serait mentir sur ce que le serveur fait réellement.

### 3.4 Le client ne peut pas demander épargne / caution solidaire

Constat, pas un bug : `place_savings_guarantee` et `register_moral_guarantee`
sont derrière `CAN_INSTRUCT`. La SPEC §2.5 décrit pourtant un parcours où « le
client (étape 3) désigne un garant ». Deux lectures possibles — soit la SPEC
anticipe le lot 6 (consentement 72 h) qui ouvrira l'endpoint au client, soit la
désignation reste un acte d'agence. **Question ouverte, non tranchée ici** : j'ai
codé l'état actuel du serveur.

### 3.5 `types/api.ts` — partiellement résorbé en cours de session

État à la rédaction (migration camelCase non commitée déjà appliquée) :

- ✅ `CreditApplication` passé en camelCase, conforme à `serialize_application` ;
- ✅ `guaranteeType` élargi à `'epargne' | 'morale' | 'materiel' | 'foncier'` —
  la nomenclature canonique est désormais dans les types ;
- ❌ `CreditGuaranteeSet` n'a toujours ni `coverage` ni objet `asset` par
  garantie, et `CreditGuaranteeItem.type` reste `'epargne' | 'morale'`.

Mes écrans consomment `coverage` et `asset` malgré leur absence des types : ils
sont en `.jsx` et `checkJs: false`, donc non type-checkés. **Le vert de `tsc` ne
prouve rien sur eux** — c'est pourquoi je fais tourner `vite build` + `eslint` en
plus, et pourquoi la liste de ce qui n'a pas été testé (§2) doit être lue comme
la vraie mesure de confiance.

Fichier hors de mon périmètre comme de celui de *front-backoffice* : aucun des
deux agents n'a le droit de réparer un type qui ment. Arbitrage d'attribution
demandé à `main`.

---

## 4. `localStorage` croisés sans pouvoir les migrer

Aucun dans mes fichiers. Hors périmètre, encore présents pour de la **donnée
métier** :

| Fichier | Clé | Nature |
|---|---|---|
| `components/admin/savings/AssignGroupModal.jsx:16` | `admin_savings_groups` | Affectation de groupes d'épargne |
| `components/admin/savings/SavingsRow.jsx:25,32,49` | `admin_savings_groups` | Lecture + **écriture** des groupes |
| `components/admin/savings/SavingsRow.jsx:44` | `group_audit_<id>` | **Piste d'audit** en localStorage — contraire au principe 3 (append-only en base) |
| `components/admin/savings/GroupManagementModal.jsx:39` | `group_audit_<id>` | Idem, en lecture |
| `components/admin/savings/SavingsRateModal.jsx:28,79,123` | `savings_rate_config_<id>` | Taux d'épargne + historique de configuration |
| `components/admin/savings/SavingsAdjustmentModal.jsx:29,96` | `savings_adjust_config_<id>` | Paramètres d'ajustement |

Le plus grave est `group_audit_<id>` : une trace d'audit qui vit dans le
navigateur d'un administrateur n'est pas une trace d'audit. `RateMaturityModal.jsx`
(crédit) a déjà été migré — le commentaire ligne 159 en garde la mémoire.

---

## 5. Reste à faire

1. Lot 6 — caution solidaire : consentement garant 72 h, écran « Demandes de
   caution », 5 règles sur le garant. Rien n'existe côté front.
2. File de vérification agent (§7.1.6 de CLAUDE.md) : `api.assets.pending`,
   `verify`, `reject` sont exposés dans `api.ts` et **sans aucune UI**. C'est le
   maillon qui rend l'inventaire client utile — sans lui, tout actif reste
   `declare` et aucune garantie sur actif n'est possible en pratique.
3. Suivi des garanties côté agence : confirmation (`confirmGuarantee`) et
   libération (`releaseGuarantee`) n'ont pas d'écran. Tant qu'un agent ne peut
   pas confirmer, `coverage.retainedTotal` reste à 0 sur tous les dossiers.
4. Dépôt de fichiers de preuve : `Asset.documents` n'accepte que des références
   texte, faute d'endpoint d'upload. La fausse zone de dépôt de l'ancien
   formulaire a été retirée plutôt que maquillée.
5. Lot 3 (simulateur en calque strict) : non commencé. Les modules restent
   éditables à la main dans l'UI au lieu d'être en lecture seule depuis la
   feuille de besoins — c'est la faille que la SPEC §1.4 ferme, et elle est
   toujours ouverte.

   *Correction du STATUS* : `Math.random()` n'est plus dans `Credits.jsx`
   (l'initialisation des modules vient déjà de `nsResult.totalByModule`). En
   revanche deux chiffres métier étaient encore fabriqués côté client, dans mon
   fichier — je les ai corrigés au passage :
   - un **score de repli** `Math.min(100, 30 + ratio*40 + …)` affiché dans le
     donut tant que l'API n'avait pas répondu : le client voyait une note qui
     n'était pas la sienne. Remplacé par « — · Lancez la simulation ».
   - le **taux indicatif** `((100 − score) / 10 + 8)` en fiche de synthèse,
     remplacé par `simResult.proposedRate`.
   - au passage, `formData.scoreLetter` (fiche de synthèse) n'était jamais
     alimenté : la case Score était vide en permanence.

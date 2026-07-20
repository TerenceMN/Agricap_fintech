# Fragment de statut — Front backoffice crédit

> Auteur : MKOPO (agent front-backoffice). Juillet 2026.
> Fragment destiné à être fusionné dans `CREDIT_MODULE_STATUS.md` §8 par le mainteneur.
> Ce document ne modifie pas `CREDIT_MODULE_STATUS.md`.

---

## 1. Écrans livrés

| Écran | Route | Fichier | Endpoint(s) |
|---|---|---|---|
| File d'instruction analyste | `/credit/dossiers` | [src/pages/credit/Applications.tsx](../../src/pages/credit/Applications.tsx) | `GET /api/credits/applications/?status=` |
| Détail du dossier (réparé, cf. §4.3) | `/credit/dossiers/<code>` | [src/pages/credit/ApplicationDetail.tsx](../../src/pages/credit/ApplicationDetail.tsx) | `GET /api/credits/applications/<code>/` + transitions |
| File de vérification des actifs | `/credit/actifs` | [src/pages/credit/AssetVerification.tsx](../../src/pages/credit/AssetVerification.tsx) | `GET /api/assets/pending`, `POST /api/assets/<id>/verify`, `POST /api/assets/<id>/reject` |
| Corbeille du comité de crédit | `/credit/comite` | [src/pages/credit/Committee.tsx](../../src/pages/credit/Committee.tsx) | `GET /api/credits/dashboard/?view=committee` |
| Journal & audit (lecture seule) | `/credit/journal` | [src/pages/credit/AuditJournal.tsx](../../src/pages/credit/AuditJournal.tsx) | `GET /api/audit/entries` |

Fichiers d'appui créés :

- [src/pages/credit/wire.ts](../../src/pages/credit/wire.ts) — formes non couvertes par
  `types/api.ts` (corbeille comité, entrée d'audit), plafonds de troncature serveur,
  formateurs et libellés partagés. Les types de dossier qu'il contenait ont été **supprimés**
  après migration de `types/api.ts` en camelCase : voir §4.1.
- [src/components/backoffice/States.tsx](../../src/components/backoffice/States.tsx) —
  `Loading` / `Empty` / `ErrorPanel` / `Forbidden` / `KpiCard` / `TruncationNotice`.
  `KpiCard` exige `scope` et `period` : le §7.2 « KPI honnêtes » est rendu structurel plutôt
  que laissé à la discipline de chaque écran. `toFieldErrors` restitue les codes métier
  servis par `ApiError` (§3.4).

Routes déclarées dans [src/App.jsx](../../src/App.jsx) **sans prop `roles`**, délibérément :
`PrivateRoute roles={…}` compare via `menuKeyFor`, qui écrase les 16 rôles canoniques en
5 clés de menu. Un garde front masquerait ces écrans à `gest_zone` ou `aud_fin`, qui y ont
pourtant droit. L'autorisation est décidée par le serveur (403) et chaque écran restitue ce
refus explicitement, sans le confondre avec une panne.

### 1.1 Détail par écran

**File d'instruction** — agrège `submitted` + `in_analysis` + `adjourned` en trois requêtes
parallèles (l'API n'accepte qu'un statut par appel ; pas de filtrage client sur une liste déjà
tronquée). Tri par ancienneté (croissant/décroissant) et par montant. Badge « consentement
client en attente » / « expiré », plus un filtre pour n'afficher que ces dossiers. Ancienneté
> 7 jours signalée en ambre. Les devises présentes sont listées sans être agrégées.
Aucune action n'est proposée depuis la liste : elles vivent dans le détail du dossier, où
`availableActions` est calculé par le serveur.

**Vérification des actifs** — pour chaque actif : propriétaire (nom + téléphone), catégorie,
valeur déclarée (marquée « déclarative — non opposable »), localisation, description, nombre
de documents et présence d'une photo. Deux actes : vérifier (valeur constatée obligatoire,
> 0) et rejeter (motif obligatoire, refusé avant même l'appel réseau, et re-refusé en 422 par
le serveur). Un encart explique que **la valeur retenue est calculée par le serveur** ; elle
n'est affichée qu'après retour de l'appel, dans un journal de session qui rappelle la valeur
déclarée en regard. Le taux de décote n'est pas exposé par l'API : le front ne pourrait pas le
calculer même s'il le voulait.

**Comité** — trois KPI (dossiers en attente, volume cumulé, plafond de délégation) portant
chacun périmètre et période. La liste servie est plafonnée à 20 lignes côté serveur ; le
compteur honnête affiché est `summary.pendingReview`, avec bandeau de troncature. Un bloc
« ce que cet écran ne fait pas » énumère quorum et procès-verbal (sans endpoint) et
l'anomalie de devise du seuil (§3.2). 403 traité par un écran dédié.

**Journal & audit** — aucun bouton d'écriture. Filtres serveur : type d'entité, identifiant
d'entité, acteur, catégorie financière. Filtre de période **client-side**, explicitement
signalé comme tel. Un bandeau permanent avertit que le module d'instruction du crédit
n'alimente pas ce journal (§3.1) — sans lui, l'écran laisserait croire qu'une absence de
ligne vaut absence d'événement.

---

## 2. Actions fantômes traitées

| Action | Avant | Après |
|---|---|---|
| `block` / `suspend` / `resume` dans `RateMaturityModal.jsx` | Écriture `localStorage` + toast de succès, **aucun appel backend** | Branché sur `POST /api/portfolio/loans/<ref>/action` (`run_action`, branches `block`, `pause\|suspend`, `resume`). Relecture de `GET …/config` après coup : plus aucun état optimiste. Bouton désactivé pendant l'appel, échec affiché en toast destructif. |
| « Voir / Télécharger Contrat » (`CreditRow.jsx`) | Toast « Génération du document — à brancher (gabarit) » | **Entrée de menu retirée.** Garde-fou conservé dans `CreditsDashboard.jsx` : un appel résiduel produit un toast destructif « Fonction indisponible … rien n'a été produit ni enregistré ». |
| « Exporter Dossier » (`CreditRow.jsx`) | Idem | Idem. |

Corrections connexes dans `RateMaturityModal.jsx` :

- le basculement Suspendre/Bloquer ↔ Réactiver testait `config.status === 'Active'` alors que
  le backend renvoie des libellés français (`En cours`, `Suspendu`, `Bloqué`). La constante
  `ACTIVE_STATES`, déclarée mais morte depuis l'origine, est désormais utilisée : un prêt actif
  n'affiche plus « Réactiver » ;
- le tableau d'amortissement et les trois totaux (intérêts, total à rembourser, TAEG) sont
  calculés **dans le navigateur**. Ils ne sont pas retirés — ils cadrent une configuration
  avant enregistrement — mais sont désormais étiquetés « simulation locale, non contractuelle »
  avec renvoi vers l'échéancier serveur (`GET /api/portfolio/loans/<ref>/schedule`).
  Réserve : cela reste un chiffre métier calculé côté client, contraire au §5 « Frontend ».
  Le supprimer exigerait un endpoint de simulation d'échéancier *à paramètres non encore
  enregistrés*, qui n'existe pas (§3.3).

**Dette croisée assumée** : `/action` écrit `loan.status` sans passer par `credits/workflow.py`
— donc sans maker ≠ checker ni contrôle de délégation (§8.4 du statut). L'action est
authentiquement persistée, elle n'est pas pour autant sous le régime de séparation des tâches
du module crédit. Le bandeau de confirmation le dit à l'utilisateur.

---

## 3. Manques backend identifiés

### 3.1 Aucune décision de crédit n'est journalisée — bloquant pour l'auditabilité

`backend/credits/` ne contient **aucun** appel à `audit.services.record`, et
`credits/models.py` ne définit **aucun** modèle `JournalValidation`. Les entités journalisées
dans `audit.AuditEntry` sont au nombre de 35 ; `CreditApplication` n'en fait pas partie.

Concrètement : prise en charge, approbation, rejet (avec son `reason_code`), ajournement,
réouverture, demande et confirmation de décaissement ne laissent **aucune trace consultable**.
Seuls `assets.create|verify|reject|delete` et `portfolio.*` alimentent le journal.

Le principe 3 (« append-only sur tout ce qui est probant », `JournalValidation`) et l'objectif
« un auditeur reconstitue toute décision deux ans après » ne sont donc pas tenus, quelle que
soit la qualité de l'écran de consultation. C'est le manque le plus grave rencontré.
Correctif attendu : `audit_record(...)` sur chaque transition de `credits/workflow.py`, avec
`entity_type="CreditApplication"` et `entity_id=app.code`, dans la même `transaction.atomic()`
que la transition.

### 3.2 Corbeille comité — seuil comparé sans conversion de devise

`credits/dashboard.py::_committee_dashboard` filtre
`amount_requested__gte=branch_limit` où `branch_limit` est en **USD**, sans convertir
`amount_requested` depuis `app.currency`. Un dossier de 30 000 CDF (≈ 10 USD) franchit un
seuil de 25 000 USD et atterrit dans la corbeille du comité ; symétriquement, un vrai dossier
en CDF au-dessus du plafond peut en sortir. `credits/workflow.py::_to_usd` existe et devrait
être appliqué ici. De même, `totalVolumeUsd` somme des montants de devises hétérogènes sous
un nom qui affirme « Usd ».

### 3.3 Endpoints manquants (ordre d'utilité décroissante)

| Besoin | Endpoint attendu | Conséquence actuelle |
|---|---|---|
| Journalisation des décisions crédit | écriture `audit_record` dans `workflow.py` | §3.1 — écran d'audit structurellement incomplet |
| Consentement client expiré | champ `clientConsentExpired` dans `serialize_application` | Le front compare `clientConsentExpires` à son horloge locale (voir `wire.ts::consentState`). `pendingClientConsent=false` confond aujourd'hui « pas requis » et « expiré ». |
| Filtrage du journal par période | `?date_from=` / `?date_to=` sur `/api/audit/entries` | Filtre de période appliqué dans le navigateur sur les 500 dernières entrées seulement — signalé à l'écran |
| Pagination / `total_rows` du journal | `qs[:500]` sans compteur ni curseur | Troncature annoncée mais non résolvable par l'utilisateur |
| Pagination / `total_rows` des dossiers | `list_applications` coupe à `[:100]` et renvoie un tableau nu | La file d'instruction ne peut afficher qu'un « possiblement tronqué » heuristique (seau plein) |
| Corbeille comité complète | `_committee_dashboard` coupe à `[:20]` | Au-delà de 20 dossiers, le comité ne peut pas atteindre les suivants depuis cet écran |
| Quorum + procès-verbal du comité | aucun (`InstitutionConfig` porte le plafond, pas le quorum) | Décision collégiale du §7.1 non réalisable ; aucun bouton ne la simule |
| Génération de contrat / export de dossier | aucun | Entrées de menu retirées (§2) |
| Simulation d'échéancier à paramètres non enregistrés | aucun (`/schedule` porte sur la config **sauvegardée**) | Simulation locale conservée mais étiquetée (§2) |
| Filtre multi-statuts | `?status=a,b,c` sur `/applications/` | Trois requêtes parallèles depuis le front |

### 3.4 Couche service — ✅ RÉSOLU

> **Mise à jour.** Cette section documentait une perte d'information dans `api.ts` :
> seul le champ `detail` d'une réponse d'erreur était conservé, ce qui aplatissait les 422
> multi-erreurs et **jetait le `code` métier**. Un troisième agent a corrigé pendant le lot.

`ApiError` porte désormais `status`, `message`, `code` (code métier du backend) et
`errors[]` (`{code, message}` par erreur du pipeline de validation). Le principe 5
— « réponse 422 structurée `{code, message}` par erreur, jamais un message générique » —
est donc tenu de bout en bout, du serveur à l'écran.

**Adaptation faite de mon côté** : `toFieldErrors` fabriquait `code: String(err.status)`,
c'est-à-dire qu'il présentait « 422 » comme s'il s'agissait d'un code métier. C'était un
pis-aller acceptable tant qu'aucun code réel n'existait ; c'est devenu trompeur dès lors
qu'il en existe un. Il restitue maintenant, par ordre de précision décroissante :
`errors[]` (une ligne par erreur, chacune avec son code) → `code` + `message` → `message`
seul. **Règle posée dans le fichier : quand le backend n'envoie pas de code, on n'en invente
pas** — un statut HTTP dit que la requête a été refusée, pas pourquoi.

Retombée concrète : la file de vérification des actifs affiche désormais
`ASSET_VERIFY_REFUSED` / `ASSET_REJECT_REFUSED` en regard du message, au lieu de « 422 ».

---

## 4. Dettes croisées rencontrées

### 4.1 `types/api.ts` mentait sur le contrat `CreditApplication` — ✅ RÉSOLU

> **Mise à jour.** Le type partagé a été migré en camelCase par un tiers pendant ce lot.
> La divergence décrite ci-dessous n'existe plus, le contournement a été démonté :
> `wire.ts` ne contient plus aucun type de dossier, et `Applications.tsx` consomme
> désormais `CreditApplication` directement, sans cast. Section conservée pour l'historique
> et parce que sa retombée — §4.3 — a demandé un vrai travail de réparation.

`credits/workflow.py::serialize_application` émet du camelCase ; `src/types/api.ts` déclare du
snake_case. Les clés ne se croisent jamais :

| Type déclaré | Clé réellement servie |
|---|---|
| `amount_requested` | `amountRequested` |
| `amount_approved` | `amountApproved` |
| `value_chain` | `valueChain` |
| `needs_sheet` | `needsSheet` |
| `score_result` | `scoreResult` |
| `area_ha` | `areaHa` |
| `guarantee_type` | `guaranteeType` |
| `rejectionReasonComment` | `rejectionComment` |
| `disbursed_amount` | *(absent du sérialiseur)* |
| `disbursedAt` | *(absent du sérialiseur)* |

Champs servis mais absents du type : `pendingClientConsent`, `isOnBehalfOf`, `initiatedBySub`.

Précision confirmée par `front-garanties` (relecture indépendante de `serialize_application`,
lignes 392-441) : ni `disbursed_amount` ni `disbursedAt` ne sont émis. Le décaissement n'existe
que dans l'objet `disbursement` (`_disbursement_summary`) — montant via `disbursement.amount`,
date de départ via `disbursement.confirmedAt`. `wire.ts` ne déclare donc aucun de ces deux
champs. `ApplicationDetail.tsx` lit les deux : ses cartes « Décaissé le » et « Montant
décaissé » sont vides par construction.

Conséquence : tout écran lisant ces champs affiche « — » sur des données pourtant présentes, et
TypeScript ne peut rien signaler puisque le type ment sur le contrat. **`ApplicationDetail.tsx`
est concerné** (montants, filière, superficie, scoring, feuille de besoins, décaissement) —
il n'est pas dans mon périmètre de correction et reste donc affecté.

Ce qu'il reste de `wire.ts` après démontage, et qui est légitime : la corbeille du comité
(la branche comité de l'union `CreditDashboard` n'est pas typée), l'entrée de journal d'audit
(le type inline de `api.ts` omet `userName`, que le backend résout pourtant), les plafonds de
troncature serveur, et les formateurs/libellés partagés par les quatre écrans.

`AssetRow` était déjà correct et conforme à `assets/views.py::_row`.

**Ce que l'épisode a coûté, et ce qu'il faut en retenir.** Pendant plusieurs heures, deux
agents ont lu un type qui mentait, chacun le contournant de son côté, aucun n'ayant le droit
de le corriger (`types/api.ts` était en lecture seule dans les deux périmètres). Le correctif
était mécanique ; c'est l'attribution qui bloquait. Un fichier de contrat partagé par
plusieurs périmètres a besoin d'un propriétaire nommé, sinon le contournement se duplique à
chaque nouvel écran et finit par paraître normal.

Deux écarts subsistaient dans le type migré, **tous deux comblés depuis** par le propriétaire
de `types/api.ts` (commits 8cd3946 et 048d2b2) :

- `CreditNeedsSheet.area_ha` — déclaré mais jamais émis, et qui plus est **non optionnel**,
  ce qui affirmait sa présence systématique : d'où la carte vide sans alerte. Retiré.
- `CreditNeedsSheet.anomalies` — émis mais absent du type. Ajouté, et désormais affiché
  (§4.3).

Comblés au même passage, à la demande de `front-garanties` : `CreditGuaranteeSet.coverage`,
l'objet `asset` par garantie (avec `declaredValue` et `retainedValue` distincts — seule la
seconde couvre), et `CreditGuaranteeItem.type` élargi aux 4 codes canoniques.

### 4.3 `ApplicationDetail.tsx` réparé — 27 erreurs et quatre bugs silencieux

La migration du type a rendu visibles 27 erreurs `tsc` dans ce fichier, **qui est dans mon
périmètre** : il lisait encore l'ancien contrat. Signalé par `front-garanties`, réparé ici.
Au-delà des renommages mécaniques, quatre défauts que le typage a mis au jour :

| Défaut | Effet réel | Correctif |
|---|---|---|
| `app.disbursedAt` et `app.disbursed_amount` lus à la racine | Ces champs **n'existent dans aucun contrat**. Les cartes « Décaissé le » et « Montant décaissé » affichaient « — » quel que soit l'état du dossier, y compris sur un crédit décaissé. | Lecture de `app.disbursement.confirmedAt` / `.amount`, conditionnée à `status === 'confirmed'` |
| `app.needsSheet.area_ha` | Déclaré au type, jamais émis : carte « Superficie » vide en toutes circonstances (la superficie du dossier est déjà affichée plus haut) | Remplacée par « Révision parsée » (`needsSheet.id`), seule information que ce bloc apporte et que rien d'autre ne donne |
| `setApp(result)` après une transition | Les réponses de transition viennent de `serialize_application`, qui **n'ajoute pas** `availableActions` (seul `serialize_for_role` le fait). La barre d'actions se vidait après chaque acte, laissant croire qu'il n'y avait plus rien à faire. | `reload()` — on relit le dossier complet |
| Deux blocs de code mort | Le premier finissait par `&& null` (rien rendu), le second produisait des `<button className="hidden" />` sans libellé, donc invisibles et inatteignables | Supprimés |

Ces quatre défauts vivaient depuis l'origine et **aucun n'était détectable** : `tsc` était vert
parce que le type mentait, et un écran qui affiche « — » ne lève aucune alerte. C'est
l'illustration la plus nette de ce que coûte un type faux — il ne cache pas seulement des
erreurs de compilation, il rend indétectables des bugs d'affichage.

**Complément, après comblement des types et typage des erreurs de workflow** — deux capacités
devenues exploitables ont été branchées plutôt que laissées inertes :

- **Refus de transition détaillés.** `credits/workflow.py` lève désormais des `WorkflowError`
  typées (`INVALID_TRANSITION`, `APPLICATION_INCOMPLETE`, `DELEGATION_EXCEEDED`,
  `MAKER_CHECKER_VIOLATION`, `CLIENT_CONSENT_MISSING`) dont `as_errors()` alimente
  `ApiError.errors`. L'écran aplatissait tout en une ligne (« ✗ » + message) ; il passe
  maintenant par `toFieldErrors` / `ErrorPanel` — une ligne par règle refusée, avec son code.
  S'y ajoute une **suite à donner** par code (`REFUSAL_GUIDANCE`) : le message du serveur dit
  ce qui s'est passé, cette phrase dit quoi faire ensuite (un plafond dépassé s'escalade au
  comité, une violation maker ≠ checker se délègue à un autre profil). Aucun code n'est
  inventé : la clé vient de `WorkflowError.code`.
  Sur un écran de décision de crédit, savoir *quelle* règle a bloqué change l'action suivante.

  **Correctif d'un défaut que j'avais moi-même introduit**, signalé par `front-garanties` :
  la première version faisait `.map(code => REFUSAL_GUIDANCE[code]).filter(Boolean)`, donc
  **un code inconnu disparaissait sans trace**. Exactement la classe de bug que ce fragment
  reproche par ailleurs — silencieux, sans erreur de compilation ni test rouge. Corrigé par
  `lookupGuidance()` : `console.warn` en développement sur tout code sans suite à donner,
  plus un ensemble `NO_GUIDANCE_NEEDED` listant les codes volontairement relayés tels quels
  (un avertissement qui crie en permanence finit ignoré, et rate alors le vrai cas).
  L'utilisateur, lui, ne perd jamais rien : `ErrorPanel` affiche le message serveur de chaque
  entrée `errors[]`, code connu ou non — seule la suite à donner manque.

  `CLIENT_CONSENT_EXPIRED` (410) est traité **distinctement** de `CLIENT_CONSENT_MISSING`
  (409) : le backend sépare les deux sous-classes parce que l'acte attendu diffère — un
  consentement manquant se recueille, un consentement expiré se renouvelle. Le message
  initial disait « absent ou expiré », contournement légitime tant que le backend
  confondait les deux, devenu une perte d'information dès qu'il les a séparés.
- **Anomalies de la feuille de besoins** (`needsSheet.anomalies`, désormais typé) affichées,
  **avant** les avertissements et avec leur effectif. C'est le premier signal que lit un
  analyste. Rendu défensif (`typeof a === 'string' ? a : JSON.stringify(a)`) : le champ est
  typé `unknown[]` et le backend y met selon les cas une chaîne ou un objet — supposer une
  forme produirait des « [object Object] ».

### 4.4 Édition concurrente non coordonnée — risque d'écrasement

Constaté deux fois pendant ce lot, dans les deux sens :

- `ApplicationDetail.tsx` (mon périmètre) a été partiellement corrigé par un tiers pendant
  que je le réparais : une de mes éditions a été refusée en « File has been modified since
  read », et plusieurs renommages que je m'apprêtais à faire étaient déjà appliqués ;
- `front-garanties` rapporte le même phénomène sur l'en-tête de `guaranteeErrors.js`, dans
  son propre périmètre.

Aucun dégât dans les deux cas — les contenus concordaient — mais c'est de la chance. Deux
agents qui éditent le même fichier sans le savoir finissent par écraser du travail, et rien
dans l'outillage ne le signale : `tsc` et `vite build` valident le résultat de l'écrasement
aussi volontiers que celui du travail perdu.

Les corrections transverses utiles (`types/api.ts`, `api.ts`) ont d'ailleurs été faites par
un troisième agent, sans que les demandeurs en soient informés — j'ai remonté à `main` une
demande déjà satisfaite. Un registre des fichiers en cours d'édition, ou simplement l'annonce
d'une correction transverse aux périmètres concernés, éviterait les deux symptômes.

### 4.5 Build — cassé pendant le développement, réparé depuis

`npx vite build` a échoué pendant tout mon développement sur
`src/pages/Credits.jsx:572 — "The symbol GUARANTEE_CONFIG has already been declared"`
(fichier hors de mon périmètre). `front-garanties` a corrigé : la constante locale a laissé
place à `src/components/guarantees/guaranteeConfig.js`.

**Build revérifié après correction : ✅ succès en 5,38 s**, mes quatre écrans compris.

Leçon de méthode à retenir pour la CI, et pas seulement pour ce lot : `checkJs: false` +
pages en `.jsx` ⇒ **`npx tsc --noEmit` ne dit rien de ces écrans**. Il est resté vert pendant
toute la durée où le build était cassé. Le garde-fou de merge doit être
`tsc --noEmit` **et** `vite build`, jamais le premier seul.

---

## 5. Vérifications effectuées, et ce qui ne l'a pas été

**Effectué**
- `npx tsc --noEmit` depuis `AGRICAP FINTECH/` : **0 erreur** (état préservé).
- `npx vite build` : **succès, 5,38 s**, après réparation de `Credits.jsx` par
  `front-garanties`. Contrôle nécessaire et non redondant avec tsc (cf. §4.2).
- Lecture du contrat côté serveur pour chaque écran, plutôt que confiance au type partagé :
  `credits/workflow.py`, `credits/view_context.py`, `credits/dashboard.py`, `credits/roles.py`,
  `assets/views.py`, `assets/services.py`, `audit/views.py`, `portfolio/services.py`.
- Vérification que chaque action affichée correspond à un endpoint réellement protégé, et que
  les groupes RBAC cités (`CAN_VERIFY_ASSET`, `COMMITTEE_ROLES`, capacité `audit`) sont bien
  ceux appliqués côté serveur.

**Non effectué — je n'ai pas de navigateur**
- Aucun écran n'a été ouvert. Rendu, mise en page responsive, contrastes, comportement des
  filtres à l'usage : non vérifiés.
- Aucun appel réseau réel : les chemins nominaux (liste non vide, vérification d'un actif,
  affichage de la valeur retenue), les 403 (comité hors direction, actifs hors terrain, journal
  sans capacité `audit`) et les 422 (rejet sans motif, valeur non numérique) sont écrits d'après
  la lecture du code serveur, **pas exécutés**.
- Pas de jeu de données de test : la base ne contient que 2 `CreditApplication` (§6.1 du statut)
  et je n'ai pas vérifié qu'un actif au statut `declare` existe. La file de vérification n'a
  donc jamais affiché de ligne réelle.
- Aucun test automatisé n'accompagne ces écrans : le projet n'a pas de suite front. Un build
  qui passe prouve que le code compile et s'assemble, pas qu'un écran affiche juste.

---

## 6. Reste à faire sur le périmètre backoffice (§7.1)

| # | Écran | État |
|---|---|---|
| 1 | Dashboard role-aware réel | ❌ non traité — `api.credits.dashboard()` sert 5 formes de réponse différentes selon le rôle ; nécessite un écran par lentille |
| 2 | File d'instruction analyste | ✅ livré |
| 3 | Onglet Analyse du dossier (5 critères, écarts, DSCR, stress, révisions, SHA-256) | ❌ non traité — le plus gros morceau restant ; dépend de `analysis-report/` et d'un sélecteur de révision côté serveur. `ApplicationDetail.tsx` affiche le scoring brut, pas l'analyse (§4.3) |
| 4 | Vue comité de crédit | ⚠️ corbeille livrée ; quorum et procès-verbal sans backend |
| 5 | Onglet Référence (templates, `reference-data`, barèmes) | ❌ non traité — `api.ranges()`/`chains()`/`config()` restent du code mort côté UI |
| 6 | File de vérification des actifs | ✅ livré |
| 7 | Suivi des garanties (compte à rebours 72 h, confirmations, libérations) | ❌ non traité — périmètre de l'agent `front-garanties` |
| 8 | Journal & audit | ⚠️ écran livré, mais vide de toute décision de crédit tant que §3.1 n'est pas corrigé |

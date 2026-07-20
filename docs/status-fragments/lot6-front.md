# Fragment de statut — Lot 6 front : l'écran du garant

> À fusionner dans `CREDIT_MODULE_STATUS.md` (§9.6 / « Reste à faire »).
> Auteur : MKOPO — juillet 2026.
> Périmètre : `src/pages/GuaranteeRequests.jsx`, `src/components/guarantees/**`,
> `src/App.jsx` (route), ajouts stricts dans `src/services/api.ts` et
> `src/types/api.ts`.

---

## 1. Ce qui est livré

Nouvel écran **« Mes demandes de caution »** (`/guarantee-requests`), branché sur
le contrat publié par `lot6-backend`
([`lot6-backend.md` §1](lot6-backend.md)).

### 1.1 Fichiers

| Fichier | Rôle |
|---|---|
| `src/pages/GuaranteeRequests.jsx` | L'écran : chargement, sections, orchestration des décisions |
| `src/components/guarantees/guaranteeRequestShape.js` | **Seul** point de contact avec les clés de l'API + statuts |
| `src/components/guarantees/SolidarityCommitment.jsx` | L'énoncé de l'engagement — le cœur de l'écran |
| `src/components/guarantees/GuaranteeRequestCard.jsx` | Une demande : identité, contexte, engagement, actions |
| `src/components/guarantees/ConsentDecisionDialog.jsx` | Confirmation d'accepter / de refuser, affichage des refus serveur |
| `src/components/guarantees/ConsentCountdown.jsx` | Compte à rebours de la fenêtre de consentement |
| `src/components/guarantees/guarantorErrors.js` | Traduction des 11 codes de refus du §1.2 |

Ajouts en `api.ts` : `credits.guaranteeRequests({status?})` et
`credits.consentGuaranteeRequest(id, accept)`. Ajouts en `types/api.ts` :
`GuaranteeRequest`, `GuaranteeRequestList`, `GuaranteeConsentResult` et leurs
satellites. **Aucune signature existante n'a été modifiée.**

### 1.2 L'engagement, traité comme un acte juridique

C'est l'exigence centrale de la SPEC §2.5 et elle a dicté la structure de l'écran.

- Le montant couvert **n'est pas une ligne de la grille d'information**. Il sort
  du tableau des métadonnées et occupe son propre bloc bordé, en typographie de
  titre : « En cas de défaut de paiement de **Marie Kabemba**, vous vous engagez
  **solidairement** à rembourser AGRICAP à hauteur de **500,00 USD**. »
- Le mot « solidairement » est explicité en dessous, parce que le terme juridique
  ne dit rien à qui ne l'a pas déjà rencontré : AGRICAP peut réclamer la somme
  **directement et en totalité**, sans poursuivre d'abord le demandeur, et
  l'épargne du garant peut être mobilisée.
- Le montant du crédit (`loanAmount`) figure sur la carte, mais étiqueté
  « Ce n'est pas le montant de votre engagement ». Sans cette mention, le chiffre
  le plus gros de la carte est celui que le garant retient — et ce n'est pas le
  sien.
- Accepter passe par une **confirmation avec case à cocher obligatoire**, qui
  répète l'engagement intégralement hors du contexte de la liste. Le bouton reste
  inerte tant qu'elle n'est pas cochée. Même mécanique que l'avertissement avant
  modification d'un actif vérifié (`AssetFormDialog`), pour la même raison :
  rendre l'irréversible délibéré.

### 1.3 Les deux actions sont de poids égal

Accepter et Refuser sont **deux boutons de même taille, côte à côte, `flex-1`
chacun**. Le refus n'est pas un lien discret à côté d'un bouton vert : c'est une
réponse légitime, souvent la bonne, et la mettre en retrait serait une pression à
s'engager. Une ligne sous les boutons le dit explicitement (« Refuser est une
réponse légitime et sans conséquence sur vos propres crédits »).

Le seul déséquilibre est **dans la confirmation** : accepter exige la case à
cocher, refuser non. Alourdir le chemin du refus au même niveau recréerait la
pression que l'écran doit éviter. Le refus garde néanmoins sa confirmation, parce
qu'il est définitif côté serveur (`GUARANTOR_ALREADY_ANSWERED` sur toute seconde
tentative) — et c'est écrit dans le dialogue.

### 1.4 Compte à rebours — et pourquoi « 72 h » n'apparaît nulle part

`ConsentCountdown` décompte depuis `consentExpiresAt`, avec trois paliers visuels
(> 24 h, < 24 h, < 6 h) et les secondes affichées sous l'heure. La date absolue
reste en `title` : un décompte relatif seul empêche de s'organiser.

La durée nominale n'est **jamais écrite en dur**. La fenêtre est paramétrable
(`InstitutionConfig`) et le backend sert `consent_window_hours` ; l'écran ne
nomme la durée qu'à un seul endroit — l'écran vide (« vous aurez N heures pour
répondre ») — et prend N du serveur. Principe 8 appliqué jusque dans l'affichage.

> **Où une valeur de secours backend affleure dans l'UI.** `lot6-backend` signale
> que `consent_window_hours` peut être servi depuis une valeur de repli (72) quand
> `InstitutionConfig` n'a rien — repli signalé côté serveur par un warning loggé,
> invisible du client.
>
> **Cet écran n'en est pas faussé** : le repli *est* la fenêtre effectivement
> appliquée, donc « vous aurez N heures pour répondre » reste vrai dans les deux
> cas, et le compte à rebours décompte de toute façon sur `consentExpiresAt`. Je
> le note sans en faire un défaut — ce serait l'erreur inverse de celle du §5,
> gonfler un risque pour paraître minutieux.
>
> Ce qui vaut d'être tracé est l'emplacement : **un seul point de consommation**,
> `GuaranteeRequests.jsx` (état vide). Si le fondateur veut un jour distinguer à
> l'écran une fenêtre *décidée* d'une fenêtre *par défaut* — ce qui relève de la
> gouvernance, pas de l'information du garant — il faudrait que le backend le
> dise dans la réponse. Le front ne peut pas l'inventer, et ne doit pas essayer.

**Le décompte ne décide de rien.** C'est un affichage. La qualification
« expirée » vient du statut serveur et de `isExpired`, jamais d'une comparaison
de dates côté navigateur. Si le front déclarait l'expiration lui-même, un garant
dont la machine avance de deux heures verrait sa demande grisée alors que le
serveur l'accepte encore — et l'inverse est pire. À décompte échu mais statut
serveur encore `pending_consent`, le badge dit « Délai écoulé » et les boutons
restent actifs : c'est le serveur qui refusera, avec `GUARANTOR_CONSENT_EXPIRED`
traduit.

### 1.5 Expirée ≠ en attente

Deux **sections distinctes**, pas une liste triée : « en attente de votre
réponse » et « historique — closes ou caduques ». Une demande caduque garde une
bordure neutre, un badge rouge, aucun bouton, et une phrase qui dit quoi faire
(« le demandeur doit vous solliciter à nouveau depuis son dossier »).

> **Défaut corrigé après retour de `lot6-backend`.** L'expiration n'est
> matérialisée en base qu'à la lecture — il n'y a pas d'ordonnanceur qui bascule
> les demandes en `expired` (pas de Celery dans le projet, limite assumée
> `lot6-backend.md` §6). Une demande périmée est donc servie avec
> `status: "pending_consent"` **et** `isExpired: true`.
>
> `isActionable()` traitait déjà le cas et retirait les boutons. Le **badge**, lui,
> lisait `status` seul : la carte affichait « En attente de votre réponse » en
> ambre sur une demande morte, sans bouton, rangée dans l'historique —
> contradiction dans la même carte, et exactement le contraire de la consigne.
> Ajout de `displayStatusMeta()`, où `isExpired` prime sur `status` pour toute
> présentation d'état. **Aucun écran ne doit lire `status` seul** ; c'est noté sur
> le champ dans `types/api.ts`.
>
> Ce que ça dit du reste : j'avais protégé le chemin qui engage (les boutons) et
> laissé faux le chemin qui informe (le badge). Un garant lisant « en attente »
> sur une demande caduque aurait cherché un bouton absent, ou attendu une échéance
> déjà passée. Même famille que les défauts du §3.2 de `front-garanties.md` — la
> règle avait été appliquée à un endroit, pas partout où elle valait.

L'écran demande **toutes** les demandes (pas de `?status=pending_consent`).
Filtrer ferait disparaître silencieusement une demande à laquelle le garant n'a
pas répondu — et une ligne qui s'évapore est indiscernable d'une ligne qui n'a
jamais existé.

### 1.6 Le cas vide, traité comme le cas principal

Un membre reçoit quelques demandes par an, pas par semaine : **l'écran vide est
ce que la plupart des visiteurs verront**. Il ne se réduit donc pas à une ligne
grise. Il répond à trois questions : où suis-je, pourquoi c'est vide, qu'est-ce
qui remplira cette page — « une demande apparaîtra ici lorsqu'un membre de l'un
de vos groupes vous désignera comme garant […] sans réponse dans ce délai, la
demande devient caduque, et vous n'êtes engagé à rien ».

Un second état vide existe, distinct : liste non vide mais **aucune demande en
attente** (tout est répondu ou caduc). Il ne dit pas la même chose et n'a pas le
même contenu.

### 1.7 Erreurs — routage sur `code`, jamais sur le texte

`guarantorErrors.js` traduit les **12 codes**, vérifiés un par un contre les
`code = "…"` de `backend/credits/guarantor.py` :

`ACCEPT_REQUIRED` · `GUARANTOR_NOT_DESIGNATED` · `GUARANTOR_ALREADY_ANSWERED` ·
`INVALID_GUARANTEE_STATE` · `GUARANTOR_CONSENT_EXPIRED` · `GUARANTOR_OVEREXTENDED` ·
`GUARANTOR_TOO_MANY_PLEDGES` · `GUARANTOR_IN_DEFAULT` · `CROSS_GUARANTEE_FORBIDDEN` ·
`GUARANTOR_NOT_IN_GROUP` · `GUARANTOR_INVALID_AMOUNT` — plus le **404 sans code**,
qui tombe dans le repli.

`GUARANTOR_INVALID_AMOUNT` sort à la pose (§1.3), pas au consentement : il ne
devrait jamais atteindre cet écran. Traduit quand même, le coût étant nul.

Choix de conception documentés dans le fichier :

- **Fichier séparé de `guaranteeErrors.js`**, qui couvre le parcours du
  *demandeur*. Les fusionner ferait une table où la moitié des entrées ne peut
  jamais sortir sur l'écran qui la consulte, et le garde-fou « code inconnu »
  perdrait son sens sur les deux écrans. La **convention** est reprise
  intégralement, et le repli **délègue** à `guaranteeErrorMessage()` : il n'y a
  pas deux implémentations à maintenir en phase.
- **Ma traduction prime sur le message serveur** ici — à l'inverse du choix fait
  dans `guaranteeErrorList()`. La raison est propre à cet écran : côté demandeur,
  le serveur énumère ce que le front ne peut pas reconstituer (types de garantie
  admis). Côté garant, le serveur n'énumère rien — principe 7, il ne descend ni
  les plafonds, ni la décote, ni le score. Un `detail` du type « capacité
  d'engagement dépassée » ne dit pas au garant que la limite **le protège**, ni
  quand il pourra à nouveau s'engager. Les messages sont écrits dans ce ton : ces
  refus sont des protections, pas des sanctions.
- **Aucun code inventé.** Un code hors table relaie le `detail` serveur et
  déclenche un `console.warn`. Idem pour un statut hors `REQUEST_STATUS_META`
  (`statusMeta()`), avec repli prudent : `actionable: false` — un statut qu'on ne
  comprend pas n'ouvre pas un acte juridique.
- Les refus s'affichent **dans le dialogue qui les a provoqués**, via `ErrorPanel`
  (une ligne par cause, avec son code), pas en toast : ces messages expliquent une
  situation financière en plusieurs phrases et un toast disparaît avant lecture.

### 1.8 Route

`/guarantee-requests`, **volontairement sans prop `roles`** — pour une raison
différente de celle des écrans backoffice. Il n'y a ici aucun privilège à garder :
`GET /credits/guarantee-requests/` ne sert que les lignes dont l'utilisateur
connecté est le garant désigné, y compris pour un admin. La liste est donc vide
par construction pour qui n'est garant de rien.

Un garde `roles={['client']}` serait au contraire **nuisible** : il repose sur
`menuKeyFor`, qui écrase les 16 rôles canoniques en 5 clés de menu, et fermerait
la porte à un salarié ou un agent qui se porte caution d'un membre de son groupe —
cas parfaitement légitime, dont le refus se traduirait par une caution jamais
consentie et un dossier bloqué.

---

## 2. Conformité aux contraintes

| Contrainte | État |
|---|---|
| Zéro `localStorage` métier | ✅ `grep` : 0 occurrence dans les 7 fichiers |
| Zéro chiffre métier calculé côté client | ✅ `grep` sur `Math.`, `* 0.`, `/ 100` : 0 occurrence. Seule arithmétique du lot : la décomposition du temps restant dans `ConsentCountdown`, qui est un affichage et ne décide de rien |
| Montants via le formateur unique | ✅ `formatMontant()` / `formatDateFr()` de `guarantees/format.js`, partout |
| États chargement / erreur / vide | ✅ squelettes ; `ErrorPanel` + « Réessayer » ; deux états vides distincts (§1.6) |
| Réutilisation de `States.tsx` | ✅ `ErrorPanel`, `toFieldErrors` |
| Routage sur `code` | ✅ aucun `match` sur un `detail`, aucune inférence depuis un statut HTTP |
| Expirée distinguée de en attente | ✅ sections séparées, badge, actions retirées (§1.5) |
| `npx tsc --noEmit` | ✅ **0 erreur** (dépôt entier) |
| `npx vite build` | ✅ **OK** (2 817 modules, 9,2 s) |
| `npx eslint` sur mes 7 fichiers | ✅ 0 warning ; seules les erreurs `import/no-unresolved` sur `@/services/api` et `@/components/backoffice/States`, **pré-existantes et générales** — reproduites sur `Contracts.jsx` et `AssetsInventory.jsx`, non modifiés (le resolver eslint n'attrape pas l'extension `.ts`) |

---

## 3. Divergence relevée — `valueChain` nullable dans le contrat figé

> **Résolu.** `lot6-backend` a corrigé le §1.1 (tableau de nullabilité explicite)
> et confirmé le typage. Je conserve le constat plutôt que de l'effacer : la trace
> du défaut et de sa correction vaut mieux qu'une page propre. Réponses obtenues,
> intégrées ci-dessous.

Le §1.1 du fragment backend est publié comme « figé et typable tel quel », et son
exemple JSON montre toujours `valueChain` sous forme d'objet. **Le serializer réel
émet `null`** (`backend/credits/guarantees.py:750`) :

```python
"valueChain": {"code": chain.code, "label": chain.label} if chain else None,
```

Même écart sur `loanAmount` (`amount_approved or amount_requested`, tous deux
facultatifs sur un dossier en constitution) et sur `coveredAmount`.

Conséquence évitée de justesse : un front qui aurait typé d'après l'exemple aurait
écrit `item.valueChain.label` et planté sur le premier dossier sans filière
rattachée. Mon adaptateur les traite (la carte affiche « Filière non
communiquée »), et `types/api.ts` porte `valueChain: {…} | null` avec la mention
que **le type suit le code, pas l'exemple de documentation**.

**Réponse obtenue sur la question de fond** : `coveredAmount: null` est
**impossible par construction**. `assert_can_guarantee` refuse un montant ≤ 0
(nouveau code `GUARANTOR_INVALID_AMOUNT`) *avant* la création de la caution — une
demande à 0 ou nulle n'existe pas en base. Idem `consentExpiresAt`. À traiter donc
comme un **défaut pur** : si l'écran en observe un, c'est un bug backend à
remonter, pas un état à gérer. L'affichage rouge « (montant non communiqué par le
serveur) » reste comme filet, et `types/api.ts` documente que la nullabilité est
un filet et non un cas métier.

**Effet de bord utile de mon garde-fou** : le `console.warn` sur
`GUARANTOR_ERROR` (la classe de base sans code propre) a attrapé un vrai défaut —
la règle du montant nul levait effectivement le générique, et un code sans
identité atteignait le client. Corrigé côté backend par
`GUARANTOR_INVALID_AMOUNT`, avec un test qui vérifie qu'aucune règle ne sort la
classe de base. **`GUARANTOR_ERROR` reste donc volontairement hors des codes
relayés** : ce n'est pas une sortie légitime, et le warn est le comportement
attendu — s'il se déclenche, c'est un bug backend à signaler, pas une entrée à
ajouter à la table.

**Leçon générale, dans la lignée du §3.2 de `front-garanties.md`** : un contrat
publié avant implémentation est un contrat que le code peut démentir en silence.
Ici les deux ont été écrits par le même agent à quelques minutes d'intervalle et
divergeaient déjà. Lire le serializer a pris deux `grep` ; croire l'exemple aurait
coûté un plantage en production. **Vérifier l'existant plutôt que la
documentation de l'existant.**

---

## 4. Ce que je n'ai pas pu observer

**Je n'ai pas de navigateur. Rien de ce qui suit n'a été exécuté, et je ne peux
pas affirmer que cet écran fonctionne** — seulement qu'il compile, que ses appels
correspondent au contrat publié, et que les clés lues correspondent au serializer
que j'ai lu dans `backend/credits/guarantees.py`.

Restent à valider en conditions réelles :

- le rendu complet de la page, à commencer par **l'écran vide** — l'état le plus
  fréquent, et celui que je n'ai jamais vu ;
- **le parcours de bout en bout** : réception d'une demande → lecture → accepter
  → substitution de la ligne par l'item renvoyé (`res.item`) → nouveau statut
  affiché. Je n'ai jamais reçu de réponse réelle de `consent/` ;
- le refus (`accept: false`) et son message de confirmation ;
- **les 11 refus serveur** : aucun n'a été déclenché, seules leurs traductions ont
  été écrites. En particulier `GUARANTOR_CONSENT_EXPIRED` (410) et
  `GUARANTOR_OVEREXTENDED` (422), qui sont les deux cas où l'écran doit être le
  plus clair ;
- le comportement du compte à rebours au **passage à zéro** pendant que la page
  est ouverte, et la cohérence entre « Délai écoulé » affiché et le refus 410
  effectivement renvoyé ;
- le rendu d'une demande dont `valueChain` est `null` (§3) ;
- **le cas `pending_consent` + `isExpired: true`** — celui qui a révélé le défaut
  de badge du §1.5. C'est l'état par défaut de toute demande périmée tant que
  personne ne la relit côté serveur, donc le plus fréquent des états « expirés »,
  et je ne l'ai jamais vu rendu ;
- l'**accessibilité clavier** du dialogue de confirmation, et le fait que la case
  à cocher soit atteignable et annoncée correctement — sur un acte juridique, un
  garant qui navigue au clavier doit pouvoir lire l'engagement avant de le
  cocher ;
- le comportement sur mobile des deux boutons d'action empilés (`flex-col` en
  dessous de `sm`) : je n'ai pas vérifié que l'ordre visuel — Refuser au-dessus
  d'Accepter — reste le bon choix sur petit écran.

---

## 5. Reste à faire (hors périmètre de ce lot)

1. ✅ **Point d'entrée dans la navigation — comblé** (hors de mon fait).
   `Layout.jsx:60` porte désormais
   `{ icon: ShieldCheck, label: 'Demandes de caution', path: '/guarantee-requests' }`
   dans le bucket `client`. Je ne l'ai pas écrit — `Layout.jsx` n'est pas dans
   mon périmètre — mais je l'ai vérifié : import présent, build vert.

   **Résidu, désormais qualifié par la vérification et non par la supposition** :
   l'entrée n'existe que pour le bucket `client`. Ma route est volontairement sans
   garde `roles` (cf. §1.8) précisément pour qu'un agent ou un salarié caution d'un
   membre de son groupe puisse y accéder ; pour eux, l'écran n'a **aucun point
   d'entrée dans le menu** et reste atteignable par URL.

   `lot6-backend` a vérifié le versant serveur plutôt que de le supposer :
   `_assert_account_active` n'écarte qu'un compte **suspendu**, donc un salarié
   actif membre du groupe du demandeur passe les sept contrôles et **peut être
   garant** ; la notification in-app est créée pour `guarantee.guarantor` sans
   distinction de rôle, et un test le verrouille
   (`test_un_garant_staff_est_notifie_comme_un_garant_client`).

   **Deux branches à arbitrer, pas une** — et elles ne se codent pas au même
   endroit :

   1. **Ajouter l'entrée aux autres buckets de `Layout.jsx`.** Rattrape le cas.
      Hors de mon périmètre comme de celui de `lot6-backend`.
   2. **Exclure les garants staff au niveau des règles**, par une garde dans
      `_assert_can_guarantee`. **Supprime** le cas au lieu de le rattraper, et le
      problème de menu disparaît de lui-même. Se code côté backend, pas côté front.
      Argument de fond en sa faveur : un agent à la fois instructeur et garant dans
      son propre portefeuille est un problème de contrôle interne, adjacent au
      maker ≠ checker du principe 2.

   > **Correction d'une erreur de lecture de ma part.** J'avais écrit que la
   > seconde branche « n'était plus sur la table », au motif que le test de
   > `lot6-backend` établit qu'un salarié peut être garant. C'était une lecture
   > trop forte : **un test qui documente un comportement n'est pas un test qui
   > l'exige.** Ce que ce test change n'est pas l'espace des décisions mais leur
   > visibilité — exclure les garants staff deviendrait un acte délibéré qui casse
   > un test nommé, au lieu d'un effet de bord silencieux. Même mécanique que le
   > test qui verrouille les permissions de la pose : il n'interdit pas de changer
   > la règle, il garantit qu'on ne la changera pas sans s'en apercevoir.
   >
   > La distinction est mince à l'écrit et large en pratique, et je l'ai ratée
   > dans le sens le plus coûteux : en retirant une option d'un arbitrage qui
   > n'était pas le mien. Signalé par `lot6-backend`, corrigé ici.

   La rareté du cas ne change pas la nature du défaut, elle change le délai avant
   qu'on le découvre.

2. ✅ **Notification au garant — émise** (`lot6-backend`, deux canaux). In-app dans
   la transaction de désignation (non best-effort, pour qu'un engagement invisible
   ne puisse pas exister) + SMS best-effort. Les deux portent l'engagement en clair,
   l'échéance et le chemin `/guarantee-requests`.

   **Limite connue, non résolue** : `notifications.Notification` n'a pas de champ
   d'URL — le chemin voyage dans le **corps du message, en texte**. Il est donc
   lisible mais **pas cliquable** depuis `ClientNotifications.jsx`, qui consomme
   `{id, title, body, read, createdAt}` (vérifié dans le fichier).

   Ajouter un champ `url` est un **changement de contrat entre apps** : il migre
   `notifications`, modifie le payload et touche `ClientNotifications.jsx`. Ni ce
   fichier ni l'app `notifications` ne sont dans mon périmètre, et `lot6-backend`
   a eu raison de ne pas le faire unilatéralement. **Décision à prendre par le
   fondateur ou par qui possède ces deux surfaces**, pas entre nos deux lots :
   c'est peu de code mais un contrat partagé, et c'est ainsi que le projet s'est
   retrouvé avec quatre vocabulaires de rôles.
3. **Désignation du garant côté demandeur.** `lot6-backend` §1.3 étend
   `guarantees/moral/` avec `guarantor_sub` requis. Le front de `Credits.jsx`
   (étape 3) présente toujours la caution solidaire en carte informative
   « constituée avec votre agent » (cf. `front-garanties.md` §3.4) — cohérent avec
   le serveur d'hier, à revoir maintenant que le lot 6 existe. Fichier hors de mon
   périmètre.
4. **Retrait d'un consentement.** L'écran affirme au garant qu'il ne peut pas
   revenir sur son engagement depuis cette page et qu'il doit s'adresser à son
   agence. Je n'ai pas vérifié qu'un chemin agence existe réellement — si ce n'est
   pas le cas, la phrase promet un recours qui n'existe pas.

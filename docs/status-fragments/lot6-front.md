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

`guarantorErrors.js` traduit les **11 codes** du §1.2, vérifiés un par un contre
les `code = "…"` de `backend/credits/guarantor.py` :

`ACCEPT_REQUIRED` · `GUARANTOR_NOT_DESIGNATED` · `GUARANTOR_ALREADY_ANSWERED` ·
`INVALID_GUARANTEE_STATE` · `GUARANTOR_CONSENT_EXPIRED` · `GUARANTOR_OVEREXTENDED` ·
`GUARANTOR_TOO_MANY_PLEDGES` · `GUARANTOR_IN_DEFAULT` · `CROSS_GUARANTEE_FORBIDDEN` ·
`GUARANTOR_NOT_IN_GROUP` — plus le **404 sans code**, qui tombe dans le repli.

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

Signalé à `lot6-backend` avec une question de fond restée ouverte :
`coveredAmount: null` sur une demande `pending_consent` est-il un état
atteignable ? Aujourd'hui l'écran refuse d'écrire « 0 » ou « — » dans une phrase
d'engagement juridique et affiche « (montant non communiqué par le serveur) » en
rouge. Si l'état est atteignable, ce n'est pas au front de le rattraper : une
demande sans montant couvert ne devrait pas être servie comme consentable.

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
- le rendu d'une demande dont `valueChain` ou `coveredAmount` est `null` (§3) ;
- l'**accessibilité clavier** du dialogue de confirmation, et le fait que la case
  à cocher soit atteignable et annoncée correctement — sur un acte juridique, un
  garant qui navigue au clavier doit pouvoir lire l'engagement avant de le
  cocher ;
- le comportement sur mobile des deux boutons d'action empilés (`flex-col` en
  dessous de `sm`) : je n'ai pas vérifié que l'ordre visuel — Refuser au-dessus
  d'Accepter — reste le bon choix sur petit écran.

---

## 5. Reste à faire (hors périmètre de ce lot)

1. **Point d'entrée dans la navigation.** La route existe, mais rien ne pointe
   vers `/guarantee-requests` : ni le menu de `Layout`, ni `ClientNotifications`.
   Un garant notifié n'a aujourd'hui aucun moyen d'atteindre l'écran autrement
   qu'en tapant l'URL. C'est le maillon manquant le plus important — sans lui, la
   fenêtre de consentement expire faute d'accès, pas faute de décision.
   `Layout.jsx` est hors de mon périmètre ; à attribuer.
2. **Notification au garant.** La SPEC §2.5 prévoit d'informer le garant via
   `ClientNotifications`. Je n'ai pas vérifié que le backend l'émet, ni que cet
   écran-là sait afficher une notification de type caution.
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

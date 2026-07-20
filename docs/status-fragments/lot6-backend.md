# Fragment de statut — Lot 6 backend : caution solidaire opposable (MKOPO)

> Périmètre : `backend/credits/` + une extension additive de `referentiel.InstitutionConfig`.
> `src/`, `dataio/`, `assets/` n'ont pas été touchés.

---

## 1. CONTRAT D'API — à lire en premier par le front garant

> Cette section est figée : elle est publiée avant l'implémentation pour que
> l'écran garant puisse être typé sans deviner. Toute évolution ultérieure sera
> signalée ici explicitement.

### Conventions communes

- **Enveloppe de liste** : `{"total_rows": <int>, "items": [...]}` — même forme que
  `GET /api/assets/mine/`. Les **clés de liste sont en `snake_case`**, les **clés
  d'item en `camelCase`** (convention déjà en place dans `assets/views.py` et
  `credits/workflow.serialize_application`).
- **Enveloppe d'erreur** : identique à celle du workflow crédit —
  ```json
  {"detail": "phrase lisible", "code": "CODE_MAJUSCULE",
   "errors": [{"code": "...", "message": "..."}]}
  ```
  Le front route **uniquement sur `code`**, jamais sur `detail`.
- **Dates** : ISO 8601 avec offset de timezone (`.isoformat()` sur un datetime aware).
- **Montants** : nombres JSON, toujours accompagnés de leur devise. Aucun calcul
  n'est laissé au client.

### 1.1 `GET /api/credits/guarantee-requests/`

Les demandes de caution **dont l'utilisateur connecté est le garant désigné**
(`CreditGuarantee.guarantor == request.user`). Aucun autre utilisateur ne voit
ces lignes, quel que soit son rôle — y compris admin.

Paramètre optionnel : `?status=pending_consent` (filtre exact sur un statut).
**Sans filtre, toutes les demandes du garant sont servies**, expirées comprises :
le front doit pouvoir afficher « expirée » sans l'inférer d'une date passée.
Tri : `consent_expires_at` croissant, les demandes en attente d'abord.

```json
{
  "total_rows": 2,
  "consent_window_hours": 72,
  "items": [
    {
      "id": 41,
      "applicationCode": "CRED-20260720-1234",
      "status": "pending_consent",
      "applicant": {
        "displayName": "Marie Kabemba",
        "sharedGroups": [{"id": 3, "name": "AVEC Kabare", "type": "AVEC"}]
      },
      "valueChain": {"code": "MAIS", "label": "Maïs"},
      "loanAmount": 1330.0,
      "loanCurrency": "USD",
      "coveredAmount": 500.0,
      "coveredCurrency": "USD",
      "consentExpiresAt": "2026-07-23T10:15:00+00:00",
      "consentedAt": null,
      "declinedAt": null,
      "isExpired": false,
      "createdAt": "2026-07-20T10:15:00+00:00"
    }
  ]
}
```

**Champs nullables** (correction demandée par l'agent front — l'exemple ci-dessus
montrait des valeurs pleines, le code émet `null` dans des cas réels) :

| Champ | `null` quand | Impossible par construction ? |
|---|---|---|
| `valueChain` | le dossier n'a pas encore de filière rattachée | non, cas courant en constitution |
| `loanAmount` | `amount_approved` et `amount_requested` tous deux vides | rare, mais atteignable |
| `applicant.sharedGroups` | jamais `null` — liste vide au pire (garant sorti du groupe depuis la désignation) | — |
| `coveredAmount` | **jamais** sur une demande servie | **oui, impossible** — voir ci-dessous |
| `consentExpiresAt` | jamais sur une caution créée par le flux de consentement | oui pour ce flux |

`coveredAmount` est garanti non nul et strictement positif : `assert_can_guarantee`
refuse un montant ≤ 0 (`GUARANTOR_INVALID_AMOUNT`) **avant** que la caution ne
soit créée. Une demande à 0 n'existe donc pas en base. Si le front en observe
une, c'est un défaut à signaler, pas un état à gérer.

Notes de contrat :

- `id` est bien l'identifiant à passer dans `/<id>/consent/`.
- `consent_window_hours` est la fenêtre **configurée** (`InstitutionConfig`), servie
  au niveau de la liste. N'affiche jamais « 72 h » en dur : soit tu décomptes depuis
  `consentExpiresAt`, soit tu utilises cette valeur.
- `valueChain.code` est le code canonique du référentiel (`MAIS`, `RIZ`…), `label`
  est prêt à afficher.
- `applicant.sharedGroups` : les groupes/coopératives **communs** au demandeur et au
  garant — c'est ce qui justifie la demande auprès du garant.
- **Volontairement absents** (principe 7, anti-gaming) : la décote de 70 %, la
  contribution de la caution à la couverture, le score du dossier, les plafonds
  d'engagement du garant. Le garant voit son engagement (`coveredAmount`), pas les
  règles du moteur. Le texte d'engagement se construit avec
  `applicant.displayName` + `coveredAmount` + `coveredCurrency`.
- Statuts possibles dans `status` : `pending_consent`, `consented`, `declined`,
  `expired`, `active` (caution constituée par l'agent), `released`, `called`.

### 1.2 `POST /api/credits/guarantee-requests/<id>/consent/`

Corps : `{"accept": true}` ou `{"accept": false}`. **Seul le garant désigné**
peut appeler cet endpoint (permission déclarative `IsDesignatedGuarantor`).

**Succès `200`** — l'item mis à jour, même forme qu'en 1.1 :

```json
{"detail": "Consentement enregistré.", "item": { ... }}
```

`accept: true` → `status: "consented"`, `consentedAt` renseigné.
`accept: false` → `status: "declined"`, `declinedAt` renseigné.

**Refus** — codes exacts émis par cet endpoint :

| HTTP | `code` | Quand |
|---|---|---|
| 400 | `ACCEPT_REQUIRED` | `accept` absent ou non booléen |
| 403 | `GUARANTOR_NOT_DESIGNATED` | l'utilisateur connecté n'est pas le garant de cette demande |
| 404 | *(pas de `code`)* | id inconnu, ou garantie qui n'est pas une caution morale |
| 409 | `GUARANTOR_ALREADY_ANSWERED` | consentement déjà donné ou déjà refusé |
| 409 | `INVALID_GUARANTEE_STATE` | la caution a été libérée / appelée entre-temps |
| 410 | `GUARANTOR_CONSENT_EXPIRED` | fenêtre dépassée (la demande bascule en `expired` à la lecture) |
| 422 | `GUARANTOR_OVEREXTENDED` | Σ cautions vivantes + celle-ci > k × épargne du garant |
| 422 | `GUARANTOR_TOO_MANY_PLEDGES` | plafond de cautions vivantes atteint |
| 422 | `GUARANTOR_IN_DEFAULT` | prêt en défaut/bloqué, ou caution appelée non soldée |
| 422 | `CROSS_GUARANTEE_FORBIDDEN` | caution croisée A↔B sur dossiers vivants |
| 422 | `GUARANTOR_NOT_IN_GROUP` | plus aucun groupe commun avec le demandeur |

**Oui, la capacité d'engagement est intégralement re-vérifiée au moment du
consentement** — les cinq règles, pas seulement celles de la pose. Motif : entre
la désignation et le clic du garant, celui-ci a pu s'engager ailleurs, tomber en
défaut, ou quitter le groupe. L'engagement se forme au consentement, donc c'est à
ce moment que les règles doivent tenir. Les codes `GUARANTOR_*` peuvent donc
sortir **des deux côtés** : à la pose (`guarantees/moral/`) et ici.

### 1.3 Pose d'une caution — `POST .../guarantees/moral/` (existant, étendu)

Corps étendu : `guarantor_sub` (sub du garant, **désormais requis** pour une
caution opposable) et `montant_couvert`. Les anciens champs déclaratifs
(`guarantor_name`, `guarantor_phone`, `guarantor_id_number`) restent acceptés et
alimentent la trace, mais ne suffisent plus seuls.

Codes de refus : les 5 codes `GUARANTOR_*` / `CROSS_GUARANTEE_FORBIDDEN` du
tableau ci-dessus, plus `GUARANTOR_IS_APPLICANT` (garant = demandeur),
`GUARANTOR_ACCOUNT_INACTIVE` (compte suspendu), `GUARANTOR_UNKNOWN` (sub
inconnu ou absent), `GUARANTOR_INVALID_AMOUNT` (montant couvert ≤ 0), tous en
**422**, plus `GUARANTEE_TYPE_NOT_ELIGIBLE` (existant).

`GUARANTOR_INVALID_AMOUNT` a été ajouté après le signalement de l'agent front :
cette règle levait la classe de base, donc le code générique `GUARANTOR_ERROR`
atteignait le client, intraduisible. **`GUARANTOR_ERROR` n'est pas une sortie
légitime** — le `console.warn` du front est le bon comportement, et un
`GUARANTOR_ERROR` observé en production est un défaut backend à remonter. Un
test le verrouille (`test_aucune_regle_ne_sort_le_code_generique`).

### 1.4 Blocage à la soumission

`POST /api/credits/applications/<code>/submit/` refuse un dossier portant une
caution morale non consentie. La réponse conserve l'enveloppe existante :

```json
{"detail": "Dossier incomplet : …", "code": "APPLICATION_INCOMPLETE",
 "errors": [{"code": "GUARANTOR_CONSENT_MISSING", "message": "…"}]}
```

→ HTTP **422**. Le code `GUARANTOR_CONSENT_MISSING` est dans `errors[]`, pas au
niveau racine : c'est la mécanique d'agrégation déjà utilisée pour
`GUARANTEE_TYPE_NOT_ELIGIBLE` (principe 5 — toutes les causes de l'étape, pas
seulement la première).

---

## 2. Le problème traité

Une caution morale s'enregistrait sur la seule déclaration de l'agent : trois
chaînes de caractères (nom, téléphone, n° d'identité) et un statut `pending`.
Le garant n'était jamais consulté, jamais identifié dans le système, et rien ne
vérifiait qu'il en avait la capacité. Concrètement, **on pouvait engager
n'importe qui à son insu**, y compris quelqu'un déjà en défaut, déjà garant de
cinq dossiers, ou garanti en retour par le demandeur lui-même.

Une caution ainsi constituée est juridiquement vide : appelée devant un tribunal,
elle tombe faute de consentement. Le principe 9 en faisait donc déjà une
non-garantie — elle entrait pourtant dans le ratio de couverture.

---

## 3. Choix de conception à justifier

### 3.1 Statuts — extension, pas substitution

La SPEC proposait `pending_consent / consented / declined / expired /
constituted / called`. L'existant portait `pending / active / released / expired`,
**utilisés en production par les garanties épargne et les gages sur actif**.

Remplacer aurait cassé ces deux types. Ajouter le jeu complet en parallèle aurait
créé un sixième vocabulaire — précisément ce que le principe 6 interdit, et ce
dont le module a déjà souffert (4 jeux de rôles, 2 nomenclatures de filières).

Décision : **8 statuts, dont 4 nouveaux.**

| SPEC | Retenu | Pourquoi |
|---|---|---|
| `pending_consent` | `pending_consent` **(nouveau)** | état inexistant auparavant |
| `consented` | `consented` **(nouveau)** | idem |
| `declined` | `declined` **(nouveau)** | idem |
| `called` | `called` **(nouveau)** | créé maintenant pour l'historique, comme demandé ; le lien `portfolio` reste hors périmètre |
| `constituted` | **`active`** (existant) | une garantie confirmée par l'agent était déjà « active » pour l'épargne et les gages. Deux mots pour un état identique auraient obligé chaque lecteur du statut à connaître d'abord le type de la garantie. |
| `expired` | `expired` (existant) | même sémantique |
| `released` | `released` (existant) | même sémantique |
| — | `pending` (existant) | conservé : « en attente de confirmation par un agent » pour l'épargne et les gages. Une caution morale n'y passe plus. |

`status` est passé de `max_length=10` à `20` (`pending_consent` fait 15 caractères).
Un test verrouille la survie des 4 codes historiques.

### 3.2 `montant_couvert` → `covered_amount` existant

La consigne demandait un champ `montant_couvert`. `covered_amount` existait déjà,
avec exactement cette sémantique (« montant réellement couvert, après décote,
celui qui entre dans le ratio ») et la même précision décimale. En ajouter un
second sous un nom français aurait donné **deux colonnes pour un seul concept** —
le défaut que le principe 6 interdit, et la première chose qu'un auditeur aurait
à démêler. Le nom canonique reste `covered_amount` ; l'API l'expose en
`coveredAmount`.

Même raisonnement inverse pour `consent_expires_at`, qui **a** été ajouté malgré
l'existence de `expires_at` : ce sont deux fenêtres distinctes, portées par deux
acteurs différents (le garant / l'agent), avec deux durées différentes. Un seul
champ aurait fusionné deux délais qui n'ont pas la même conséquence.

### 3.3 `consent_meta` immuable

Implémenté par `from_db` + `save()` sur le modèle : toute tentative de réécriture
d'un `consent_meta` non vide lève `ImmutableConsentMeta`. Trois tests le
verrouillent (réécriture, effacement, et le fait que les autres champs restent
modifiables).

**Limite honnête** : `QuerySet.update()` court-circuite `save()`. Le module
n'utilise `update()` sur les garanties que pour des transitions de statut en
masse (expiration), qui ne touchent pas `consent_meta` — mais rien au niveau base
ne l'empêche. Une contrainte PostgreSQL (trigger) serait le vrai verrou ; elle
sort du périmètre de ce lot.

### 3.4 Seuils en base (principe 8)

Quatre champs ajoutés à `referentiel.InstitutionConfig` :
`caution_ratio_epargne` (k = 2), `caution_max_actives` (3),
`caution_consent_window_hours` (72), `decote_caution_morale` (0,70).

**C'est une sortie de mon périmètre déclaré** (`backend/credits/` + ses
migrations) : la migration `referentiel/0002` est additive, réversible, et
n'existe que parce que le principe 8 exige que ces seuils vivent en base. Si un
autre agent migre `referentiel` en parallèle, c'est le point de collision à
surveiller. `referentiel` n'avait que `0001_initial` au moment de l'écriture.

Le repli sur les valeurs de secours logge systématiquement un warning nommant le
champ manquant — un comité qui croit avoir fixé k = 1,5 doit pouvoir constater
dans les logs que le code applique encore 2. Testé.

**Mais un log est un garde-fou que personne ne lit tant que rien ne va mal**, et
ce cas-ci ne va jamais mal : un `k = 2` non décidé fonctionne exactement comme un
`k = 2` décidé, indéfiniment. Contrairement à une rupture de contrat, une absence
de décision ne finit jamais par se voir toute seule. `config_provenance()` rend
donc l'état **interrogeable** et pas seulement traçable : pour chacun des quatre
paramètres, sa valeur, son repli, et `source: "config" | "fallback"`.

Volontairement **sans endpoint** : son lieu d'affichage est l'onglet Référence du
backoffice (CLAUDE.md §7.1.5, « consultation des plages, versions, config
institution »), qui n'est pas le périmètre de ce lot. La fonction existe pour que
celui qui construira cet écran n'ait pas à rétro-concevoir `_param`.

Elle n'est **pas** exposée au garant ni au client : elle révèle les seuils du
moteur (principe 7). L'agent front l'a confirmé de son côté — son unique
consommation de `consent_window_hours` (l'état vide, « vous aurez N heures pour
répondre ») reste vraie que la valeur vienne du comité ou du repli, puisque c'est
la fenêtre effectivement appliquée. Il n'y a donc aucun défaut client-facing à
corriger, et le front ne doit surtout pas inventer la distinction.

`_param` et `config_provenance` lisent la même table `CAUTION_PARAMS` : sans ça,
l'écran d'administration pourrait afficher un défaut différent de celui réellement
appliqué — un mensonge pire que l'absence d'écran. Testé.

### 3.5 Décote de 70 %

`CreditGuarantee.retained_coverage` applique la décote aux seules cautions
morales ; `get_guarantee_summary` l'utilise pour le ratio de couverture.

**Cas chiffré exécuté** (test `MoralHaircutTests`) : dossier de 1 000 USD, caution
consentie puis constituée à 1 000 USD → couverture retenue **300,00 USD**,
ratio **0,300**. Une caution non consentie ou non constituée couvre **0,00**.
Avec `decote_caution_morale = 0,50` en config, la même caution retient 500,00 —
la décote vient bien de la base.

---

## 4. Ce qui est en place

| Élément | Fichier |
|---|---|
| 13 exceptions typées (`code` + `http_status` + `as_errors()`) | `credits/guarantor.py` |
| Les 7 contrôles de capacité + resolveurs de config | `credits/guarantor.py` |
| FK `guarantor`, `consent_expires_at`, `consent_meta`, 4 statuts, index | `credits/models.py` |
| Immuabilité de `consent_meta` | `credits/models.py` (`from_db` / `save`) |
| Désignation, consentement, constitution, expiration, sérialisation garant | `credits/guarantees.py` |
| Permission déclarative `IsDesignatedGuarantor` | `credits/permissions.py` **(nouveau)** |
| Les 2 endpoints garant | `credits/views.py`, `credits/urls.py` |
| Blocage à la soumission | `credits/workflow.py` (`_missing_guarantor_consent_errors`) |
| 4 seuils institutionnels | `referentiel/models.py` |
| Migrations | `credits/0009`, `referentiel/0002` |

**Notification du garant** (ajouté après signalement de l'agent front : rien ne
pointait vers l'écran garant). La désignation dépose une
`notifications.Notification` dans la boîte du garant, énonçant l'engagement en
clair (« en cas de défaut de X, vous vous engagez solidairement à hauteur de Y »),
l'échéance, et **le chemin `/guarantee-requests`**. Le SMS porte la même
information.

Répartition des exigences, volontairement asymétrique :

| Canal | Best-effort ? | Pourquoi |
|---|---|---|
| Notification in-app | **non** — dans la transaction | écriture dans la même base ; un garant non notifié ne consentira pas, donc mieux vaut échouer franchement que créer un engagement invisible |
| SMS | oui | dépend d'un tiers (Dream Digital) et du réseau ; son échec ne doit pas annuler une désignation, l'in-app servant de rattrapage |

**Limite** : `notifications.Notification` n'a **pas** de champ d'URL — le chemin
est écrit dans le corps du message, en texte. Ajouter un champ `url` migrerait
une app partagée et changerait le payload que `ClientNotifications` consomme :
c'est une décision de contrat entre apps, pas un effet de bord de ce lot. Je ne
l'ai pas prise unilatéralement, et l'agent front a refusé de l'arbitrer avec moi
pour la même raison — `notifications/` n'est le périmètre d'aucun de nous deux,
et un contrat entre apps décidé en fin de chantier entre deux agents est
exactement le mécanisme qui a produit les quatre vocabulaires de rôles que le
principe 6 demande de résorber. **À arbitrer par le fondateur** si l'on veut un
lien cliquable plutôt qu'un chemin lisible ; se porte des deux côtés en une passe.

**Cas du garant staff** (signalé par l'agent front) : l'entrée de menu vers
l'écran garant n'existe que pour le bucket `client` de `Layout.jsx`. Un salarié
qui cautionne un membre de son groupe — cas rare mais permis par les règles :
seul un compte *suspendu* est écarté — n'atteint donc l'écran que par URL. La
notification in-app portant le chemin est alors son **seul** accès. Vérifié par
test (`test_un_garant_staff_est_notifie_comme_un_garant_client`) plutôt que
supposé. Le menu lui-même est hors des périmètres backend et lot 6 front.

**Journalisation** : `credits.guarantee.guarantor_designated`,
`.consent_accepted`, `.consent_declined`, `.constituted` dans `audit.AuditEntry`,
via `audit.services.record` (pas de journal réinventé). L'appel est
**volontairement non best-effort** : contrairement au SMS, une transition de
caution non journalisée est une perte de preuve, donc si l'audit échoue la
transition est annulée avec lui.

---

## 5. Deux bugs trouvés en écrivant les tests

**a) `@transaction.atomic` annulait le marquage d'expiration.**
`record_guarantor_consent` était intégralement atomique. Le chemin « fenêtre
dépassée » écrit `status = expired` **puis lève** `GuarantorConsentExpired` — le
`raise` faisait rollback de l'écriture. La demande restait indéfiniment en
`pending_consent`, et chaque tentative reconstatait la même expiration sans
jamais la matérialiser. Corrigé : l'atomicité est posée autour de la transition
et de sa journalisation uniquement, ce que la consigne demandait précisément.
Test de régression : `test_expiration_est_persistee_malgre_le_refus`.

**b) `GUARANTOR_ERROR` générique atteignait le client** (signalé par l'agent
front) : la règle du montant nul levait la classe de base, intraduisible côté
front. Corrigé par `GuarantorInvalidAmount` / `GUARANTOR_INVALID_AMOUNT`, avec un
test qui vérifie qu'aucune règle ne sort le code générique.

---

## 6. Tests

`./.venv/Scripts/python.exe manage.py test` → **516 tests, 8 échecs**, tous dans
`support/` (7 failures + 1 error) — les préexistants annoncés, non touchés.
Baseline 427 + **89 nouveaux tests**, tous verts.

- `credits/tests_guarantor.py` (64) — les 7 règles **en refus ET en cas nominal**,
  le consentement, l'expiration, la caution croisée, l'immuabilité, la décote,
  le contrat des codes d'erreur, la notification du garant.
- `credits/tests_guarantee_requests_api.py` (25) — forme exacte des 2 endpoints,
  statuts HTTP, isolation par garant, anti-gaming de la réponse.

Une règle testée seulement en refus peut être un `raise` inconditionnel : le test
passerait et plus aucune caution ne serait posable. Le cas nominal est la moitié
du contrat, c'est pourquoi chaque règle en a un.

**Migration testée par rollback puis re-migration** : `migrate credits 0008` +
`migrate referentiel 0001` → `migrate` → OK. Les deux migrations sont réversibles
(aucun `RunPython`).

### Ce que je n'ai PAS pu tester

- **Le double consentement concurrent** (deux requêtes simultanées sur la même
  demande). Le garde-fou est la vérification de statut, pas un `select_for_update` :
  sous forte concurrence, deux `accept` simultanés pourraient tous deux passer le
  contrôle. Le second échouerait sur l'immuabilité de `consent_meta`, mais par
  accident, pas par conception. Un `select_for_update` sur la garantie serait le
  correctif propre. Non fait pour rester dans le périmètre ; **à traiter**.
- **Le statut de compte d'un garant client.** `accounts.FintechUser` ne porte
  aucun statut ; seul un profil staff peut être suspendu. La règle « compte
  actif » est donc réelle pour un garant staff (testée) et **vide pour un garant
  client** — le cas réel. Signalé plutôt que simulé : le jour où un statut de
  compte client existera, il se branche dans `_assert_account_active` et nulle
  part ailleurs.
- **L'agrégation multi-devises de l'épargne du garant.** `guarantor_savings`
  somme les soldes sans conversion et logge un warning si plusieurs devises sont
  présentes. Le plafond d'engagement est donc approximatif dans ce cas —
  contraire au principe 4, mais le convertisseur du module Accounting n'est pas
  exposé. Loggé, jamais maquillé.
- **Le lien `called` ↔ `portfolio`.** Le statut existe et compte dans les règles
  (une caution appelée bloque le garant, cf. `GUARANTOR_IN_DEFAULT`), mais rien
  ne le déclenche : hors périmètre, comme demandé.
- **La tâche périodique d'expiration.** `expire_pending_moral_guarantees()` gère
  les deux fenêtres et est testable, mais **aucun ordonnanceur ne l'appelle** —
  il n'y a pas de Celery configuré dans le projet. En attendant, l'expiration
  n'est constatée qu'à la lecture (consentement ou constitution). Une demande
  expirée reste donc affichée `pending_consent` avec `isExpired: true` tant que
  personne n'y touche : le front la traite correctement, mais la base ment.

---

## 7. La question que je ne tranche pas — pour le fondateur

**Qui désigne le garant ?**

La SPEC §2.5 fait désigner le garant **par le client** (« recherche parmi les
membres de son/ses groupes »). Le front présente aujourd'hui la caution comme
« constituée avec votre agent », et `POST guarantees/moral/` est réservé à
`CAN_INSTRUCT` — donc au staff.

**Je n'ai pas changé ces permissions.** Le mécanisme fonctionne des deux côtés :
rien dans `credits/guarantor.py` ni dans le flux de consentement ne dépend de
l'identité du désignateur. Ouvrir la désignation au client est un changement
d'une ligne de garde dans `register_moral_guarantee` (la vue).

Les deux options n'ont pas le même coût :

- **Désignation par l'agent** (état actuel) : l'agent connaît le groupe, filtre
  les garants plausibles, et relève la pièce d'identité. Mais il devient le point
  de passage obligé, et un agent qui « arrange » les cautions de son portefeuille
  est un risque de fraude concentré.
- **Désignation par le client** (SPEC) : plus fluide, moins de charge agent,
  et l'agent n'est plus au milieu. Mais le client choisit son garant dans une
  liste que le système lui expose — donc le système révèle qui est membre de
  quels groupes, et un client peut solliciter en masse.

Dans les deux cas le consentement du garant reste le verrou, et il ne bouge pas.
**C'est une décision de gouvernance, pas d'ingénierie.** Un test verrouille l'état
actuel (`test_permissions_de_la_pose_inchangees`) : il faudra le mettre à jour
avec la décision, ce qui garantit qu'elle sera consciente.

---

## 8. Dettes croisées rencontrées

- `credits/views.py` continue de contrôler les permissions dans le corps des vues
  (`_require_group`) plutôt qu'en `permission_classes`, contrairement au §5. Les
  deux nouvelles vues utilisent des permissions déclaratives ; le reste du fichier
  n'a pas été converti (hors périmètre, et un agent front travaille dessus).
- `confirm_moral_guarantee` conserve un chemin pour les cautions déclaratives
  historiques (statut `pending`, sans FK `guarantor`). Principe 3 : on ne réécrit
  pas l'historique. Ce chemin doit disparaître quand ces lignes seront soldées.
- La conversion CDF→USD du contrôle de délégation reste un taux de secours non
  journalisé (`workflow._to_usd`) — dette déjà documentée, non aggravée ici.

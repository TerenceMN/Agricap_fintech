# AGRICAP FINTECH — Fonctionnalités backend non connectées au frontend

**Date de rédaction** : 16 juillet 2026  
**Stack** : Django 5.2 / DRF (backend) + React 18 / TypeScript / Vite (frontend)  
**Tests backend** : 283 tests — OK  
**Vérification TypeScript** : `tsc --noEmit` — 0 erreur  

---

## Contexte

Ce document recense les endpoints backend **entièrement implémentés et testés** côté
serveur, mais dont aucun appel n'existe encore dans l'interface utilisateur. Pour chaque
gap, on documente : la fonctionnalité en langage métier, les références techniques
précises (fichiers, lignes, routes HTTP), l'état actuel dans le frontend, et ce qu'il
faudrait construire.

---

## 1. Workflow d'approbation à double validation sur les agences (Maker-Checker)

### Description fonctionnelle

Lorsqu'un agent souhaite effectuer une opération sensible sur une agence — la
**suspendre**, la **fermer définitivement**, la **déverrouiller temporairement** après
suspension, ou la **rouvrir** après fermeture — cette fonctionnalité impose un circuit de
validation en deux temps :

1. **Le maker** (premier agent) soumet une demande motivée, éventuellement accompagnée
   d'un document justificatif scanné.
2. **Le checker** (second agent, rôle `validate`) reçoit une notification, consulte la
   demande, demande l'envoi d'un code de vérification par SMS sur son téléphone
   enregistré, saisit ce code dans l'interface, puis **approuve** ou **rejette** la
   demande avec une note explicative.
3. Seulement après approbation du checker l'action s'exécute réellement sur l'agence,
   avec enregistrement complet dans le journal d'audit.

Ce mécanisme garantit qu'aucune opération irréversible (fermeture d'agence, suspension)
ne peut être effectuée par une seule personne, même avec les droits suffisants.

### État actuel dans le frontend

La page **Agencies.jsx** déclenche les actions de cycle de vie directement via :

```typescript
// src/services/api.ts — ligne 285
action: (code: string, action: string, reason = '', extra = {}) =>
  request(`/agencies/${code}/action`, { method: 'POST', body: { action, reason, ...extra } })
```

Ce call pointe vers `POST /agencies/<code>/action` qui **exécute immédiatement** l'action
sans passer par aucun checker. Le maker-checker est présent dans le backend mais le
frontend le bypass intégralement.

### Références techniques backend

| Fichier | Lignes | Rôle |
|---|---|---|
| `backend/agencies/urls.py` | 12–16 | Déclaration des 5 routes action-requests |
| `backend/agencies/views.py` | 302–379 | Contrôleurs des 5 endpoints |
| `backend/agencies/maker_checker.py` | — | Logique métier : création demande, OTP SMS, approbation, rejet |
| `backend/agencies/models.py` | `AgencyActionRequest` | Modèle de données de la demande |
| `backend/agencies/tests.py` | — | Tests couvrant le workflow complet |

### Routes HTTP exposées

```
GET  /api/agencies/action-requests                         → liste toutes les demandes (filtrable ?status= ?agency=)
POST /api/agencies/action-requests                         → créer une demande (maker)
POST /api/agencies/action-requests/<id>/request-code       → checker demande un code OTP par SMS
POST /api/agencies/action-requests/<id>/verify-code        → vérifier que le code est valide
POST /api/agencies/action-requests/<id>/approve            → approuver la demande (exécute l'action)
POST /api/agencies/action-requests/<id>/reject             → rejeter avec note
```

### Réponse type du backend

```json
// GET /api/agencies/action-requests
[
  {
    "id": 12,
    "agencyCode": "AG-KIN-001",
    "actionType": "suspend",
    "reason": "Écart de caisse non justifié depuis 3 semaines",
    "hasDocument": true,
    "requestedBy": "sub-agent-123",
    "status": "pending",
    "approvedBy": null,
    "decidedAt": null,
    "rejectionNote": null,
    "createdAt": "2026-07-16T10:22:00Z"
  }
]
```

### Ce qui manque à construire (frontend)

**Wrappers `api.ts` à ajouter** :
```typescript
agencies: {
  // ... existant ...
  actionRequests: {
    list: (filters?: { agency?: string; status?: string }) =>
      request<ActionRequestRow[]>(`/agencies/action-requests${qs}`),
    create: (agencyCode: string, actionType: string, reason: string, document?: File) =>
      request<ActionRequestRow>('/agencies/action-requests', { method: 'POST', body: form, isForm: true }),
    requestCode: (id: number) =>
      request<{ challengeId: string; expiresAt: string }>(
        `/agencies/action-requests/${id}/request-code`, { method: 'POST', body: {} }),
    verifyCode: (id: number, challengeId: string, code: string) =>
      request<{ verified: boolean }>(
        `/agencies/action-requests/${id}/verify-code`, { method: 'POST', body: { challengeId, code } }),
    approve: (id: number, code: string) =>
      request<ActionRequestRow>(
        `/agencies/action-requests/${id}/approve`, { method: 'POST', body: { code } }),
    reject: (id: number, note: string) =>
      request<ActionRequestRow>(
        `/agencies/action-requests/${id}/reject`, { method: 'POST', body: { note } }),
  },
}
```

**Composants UI à créer dans `Agencies.jsx`** :
- Onglet ou section **"Demandes en attente"** listant les `AgencyActionRequest` avec leur
  statut (badge couleur : en attente / approuvé / rejeté)
- Dialog **"Soumettre une demande"** (maker) : sélection de l'action, champ motif,
  upload optionnel d'un document
- Dialog **"Approuver / Rejeter"** (checker) : affichage du contexte de la demande,
  bouton "Recevoir le code SMS", champ saisie du code, boutons Approuver / Rejeter

**Permissions à respecter** : les actions sur les demandes nécessitent la capacité
`validate`. Côté UI, conditionner l'affichage des boutons checker à
`rbacMe.capabilities.includes('validate')`.

---

## 2. Tableau d'amortissement d'un prêt — vue gestionnaire

### Description fonctionnelle

Pour chaque prêt actif dans le portefeuille, cette fonctionnalité produit le **tableau
d'amortissement complet** : la liste exhaustive de toutes les échéances futures avec,
pour chaque ligne, la date d'échéance, le montant total dû, la part de capital remboursé,
la part d'intérêts, et le capital restant dû après paiement. C'est l'outil de travail
quotidien d'un gestionnaire de portefeuille pour anticiper les flux de trésorerie,
préparer les relances avant échéance, et calculer les pénalités en cas de retard.

### État actuel dans le frontend

Le client (espace "Mes Crédits" — `Credits.jsx`) voit son échéancier parce qu'il est
**inclus dans la réponse** de `GET /portfolio/mine/<ref>`. Côté gestionnaire en revanche,
la page `Portfolios.jsx` n'affiche aucun tableau d'amortissement. Un bouton "Vue
Échéances" existe dans `CreditsDashboard.jsx` (ligne 73) mais affiche seulement un toast
indiquant d'aller dans "Config Taux & Maturité" — il ne charge aucune donnée.

```jsx
// src/components/admin/credits/CreditsDashboard.jsx — ligne 73
if (action === 'calendar_view') {
  toast({ title: 'Vue Échéances',
          description: 'Voir l\'échéancier dans « Config. Taux & Maturité » de chaque dossier.' });
  return;
}
```

### Références techniques backend

| Fichier | Lignes | Rôle |
|---|---|---|
| `backend/portfolio/urls.py` | 14 | Route `loans/<ref>/schedule` |
| `backend/portfolio/views.py` | 146–152 | Contrôleur `loan_schedule` |
| `backend/portfolio/services.py` | `schedule_for(loan)` | Calcul du tableau d'amortissement |

### Route HTTP exposée

```
GET /api/portfolio/loans/<ref>/schedule    → tableau d'amortissement complet (staff uniquement)
```

### Réponse type du backend

```json
{
  "schedule": [
    {
      "period": 1,
      "dueDate": "2026-08-15",
      "payment": 245.50,
      "principal": 198.20,
      "interest": 47.30,
      "remainingBalance": 4801.80
    },
    {
      "period": 2,
      "dueDate": "2026-09-15",
      "payment": 245.50,
      "principal": 200.15,
      "interest": 45.35,
      "remainingBalance": 4601.65
    }
  ],
  "currency": "USD",
  "totalInterest": 1245.00,
  "totalPayment": 6245.00
}
```

### Ce qui manque à construire (frontend)

**Wrapper `api.ts` à ajouter** :
```typescript
portfolio: {
  // ... existant ...
  loanSchedule: (ref: string) =>
    request<{ schedule: LoanScheduleRow[]; currency: string; totalInterest: number; totalPayment: number }>(
      `/portfolio/loans/${ref}/schedule`),
}
```

**Composant UI** : dans le panel de détail d'un prêt de `Portfolios.jsx`, ajouter un
onglet **"Échéancier"** avec un tableau paginé (date, paiement, capital, intérêts, solde
restant). Mettre en évidence les échéances passées non payées en rouge.

---

## 3. Agenda global des remboursements à venir

### Description fonctionnelle

Vue d'ensemble de **toutes les échéances dues sur l'ensemble du portefeuille**, regroupées
et triées par date. Permet à un responsable de portefeuille de voir d'un seul coup d'œil
quels clients doivent rembourser cette semaine ou ce mois-ci, le montant total attendu,
et d'identifier les risques d'impayés avant qu'ils ne surviennent. Différent des alertes
de retard (qui signalent ce qui est déjà en défaut) : le calendrier est **prédictif**.

### État actuel dans le frontend

Aucune vue calendrier ou agenda n'existe dans l'interface. Les alertes de retard
(`GET /portfolio/alerts` — endpoint câblé) informent après le fait. Le calendrier
permettrait d'anticiper.

### Références techniques backend

| Fichier | Lignes | Rôle |
|---|---|---|
| `backend/portfolio/urls.py` | 20 | Route `calendar` |
| `backend/portfolio/views.py` | 205–208 | Contrôleur `calendar` |
| `backend/portfolio/services.py` | `calendar_entries()` | Agrégation des échéances |

### Route HTTP exposée

```
GET /api/portfolio/calendar    → toutes les prochaines échéances du portefeuille (staff)
```

### Ce qui manque à construire (frontend)

**Wrapper `api.ts` à ajouter** :
```typescript
portfolio: {
  // ... existant ...
  calendar: () => request<CalendarEntry[]>('/portfolio/calendar'),
}
```

**Composant UI** : dans `Portfolios.jsx` ou le Dashboard Crédits, une section
**"Échéances à venir"** avec deux sous-vues :
- Liste triée par date (7 prochains jours / 30 prochains jours)
- Indicateur du montant total attendu par semaine

---

## 4. Fiche détaillée d'un groupe d'épargne collectif

### Description fonctionnelle

Un groupe d'épargne est une **tontine structurée** où plusieurs clients cotisent ensemble
selon un calendrier fixé à la création du groupe. Cette fonctionnalité retourne toutes
les informations complètes d'un groupe précis : la liste des membres actifs, le taux
d'intérêt appliqué, la fréquence des versements (hebdomadaire / mensuelle), les règles
de distribution du capital accumulé, et les méta-données de gouvernance (qui peut
rejoindre, conditions d'exclusion).

### État actuel dans le frontend

La page `Savings.jsx` liste tous les groupes avec leurs informations résumées et permet
l'édition inline (nom, taux, fréquence) et la suppression. Mais il n'existe pas de
panneau ou dialog de détail qui s'ouvre sur un groupe pour en voir l'historique des
membres, les cotisations individuelles passées, ou les paramètres complets.

Les wrappers `PATCH` et `DELETE` sur `/savings/groups/<id>` sont bien câblés dans
`api.ts` (lignes 592–594). Seul le `GET` du détail est absent.

### Références techniques backend

| Fichier | Lignes | Rôle |
|---|---|---|
| `backend/savings/urls.py` | 11 | Route `groups/<group_id>` |
| `backend/savings/views.py` | 96–119 | Contrôleur `group_detail` (GET/PATCH/DELETE) |

### Route HTTP exposée

```
GET /api/savings/groups/<id>    → détail complet d'un groupe d'épargne
```

### Ce qui manque à construire (frontend)

**Wrapper `api.ts` à ajouter** dans `api.savings.groups` :
```typescript
detail: (groupId: number) => request<SavingsGroupDetail>(`/savings/groups/${groupId}`),
```

**Composant UI** : dans `Savings.jsx`, rendre chaque ligne de groupe cliquable pour
ouvrir un **panneau latéral (Sheet)** ou un dialog affichant :
- Informations complètes (taux, fréquence, règles de distribution)
- Liste des membres avec leur statut
- Historique des dépôts collectifs
- Demandes d'adhésion en attente (endpoint `/savings/groups/<id>/requests` déjà câblé)

---

## 5. Module Référentiel — Transparence des barèmes de notation crédit

### Description fonctionnelle

Le moteur d'analyse crédit d'AGRICAP FINTECH évalue chaque dossier agricole en se basant
sur des **barèmes de notation** organisés par filière (maïs, manioc, café, cacao…) et
par zone géographique. Ces barèmes définissent, pour chaque critère agronomique et
financier, les fourchettes de valeurs correspondant à chaque note (A, B, C, D). C'est
l'intelligence métier centrale du système.

**Ce module comporte quatre fonctionnalités distinctes, toutes orphelines** : les
wrappers existent dans `api.ts` mais aucune page du frontend ne les appelle jamais.

### État actuel dans le frontend

```typescript
// src/services/api.ts — lignes 86–91
// Référentiel (transparence).
ranges: (chain?) => request(`/referentiel/ranges${chain ? `?chain=${chain}` : ''}`),
chains: () => request('/referentiel/chains'),
config: () => request('/referentiel/config'),
// Note : api.versions() n'existe pas encore — wrapper manquant également
```

Recherche dans tout `src/` : **zéro appel** à `api.ranges()`, `api.chains()`,
`api.config()` dans les pages. Les wrappers sont définis mais jamais invoqués.

---

### 5a. Consultation des barèmes par filière agricole

**Ce que ça fait** : retourne les grilles de notation complètes. Pour chaque filière et
chaque zone, on sait exactement quel rendement attendu, quelle superficie minimale, quel
accès à l'irrigation correspondent à une note A, B ou C. Ce sont les règles qui
expliquent pourquoi un dossier obtient le score qu'il obtient.

**Utilité** : un analyste crédit qui veut comprendre ou contester la note d'un dossier
peut consulter les barèmes directement depuis l'interface, au lieu de demander accès à
la base de données.

### Références techniques backend

| Fichier | Lignes | Rôle |
|---|---|---|
| `backend/referentiel/urls.py` | 6 | Route `ranges` |
| `backend/referentiel/views.py` | — | Contrôleur `ranges` |
| `backend/referentiel/models.py` | `ReferenceRange` | Modèle d'une ligne de barème |

### Route HTTP exposée

```
GET /api/referentiel/ranges?chain=<code>    → barèmes de notation (filtrables par filière)
```

---

### 5b. Liste des filières agricoles disponibles

**Ce que ça fait** : liste toutes les filières agricoles configurées dans le système
(maïs, manioc, café, cacao, riz, élevage…) avec leur code, leur libellé en clair, et
leur spécialité d'analyse. Sert de liste déroulante pour filtrer les barèmes par filière,
et d'information de référence pour les formulaires de demande de crédit.

### Route HTTP exposée

```
GET /api/referentiel/chains    → liste des filières agricoles
```

---

### 5c. Paramètres globaux du moteur de notation

**Ce que ça fait** : expose la configuration générale du moteur d'analyse : pondérations
appliquées à chaque grande catégorie de critères (revenus, actifs, historique de
remboursement, facteurs agronomiques), seuils de décision automatique (en dessous de
quel score cumulé le crédit est refusé sans analyse manuelle), constantes de calcul des
intérêts par défaut.

**Utilité** : permet à un administrateur de vérifier depuis l'interface que les paramètres
globaux correspondent aux décisions de politique de crédit en vigueur, sans toucher
directement à la base de données.

### Route HTTP exposée

```
GET /api/referentiel/config    → paramètres globaux du moteur de notation
```

---

### 5d. Historique des versions du référentiel

**Ce que ça fait** : liste toutes les versions du référentiel de barèmes importées dans
le temps. Chaque version porte un label (ex. "Barèmes Q3-2026"), une date d'import, le
nombre de barèmes qu'elle contient, et un indicateur indiquant si elle est actuellement
active. Quand les barèmes sont mis à jour (nouvelle saison, nouvelles filières, révision
de politique), une nouvelle version est importée et devient active. L'ancienne est
conservée pour permettre de savoir exactement avec quels barèmes un dossier a été analysé
à une date donnée — essentiel pour l'audit réglementaire.

**Utilité** : traçabilité complète des décisions crédit. Si un régulateur demande
"selon quels critères ce dossier a-t-il été refusé en mars 2026 ?", la réponse est
retrouvable.

### Références techniques backend

| Fichier | Lignes | Rôle |
|---|---|---|
| `backend/referentiel/urls.py` | 9 | Route `versions` |
| `backend/referentiel/views.py` | 58–65 | Contrôleur `versions` |
| `backend/referentiel/models.py` | `ReferentielVersion` | Modèle de version |

### Route HTTP exposée

```
GET /api/referentiel/versions    → historique de toutes les versions importées
```

### Réponse type du backend

```json
[
  {
    "id": 3,
    "label": "Barèmes Q3-2026",
    "imported_at": "2026-07-01T08:00:00Z",
    "is_active": true,
    "n_ranges": 248
  },
  {
    "id": 2,
    "label": "Barèmes Q2-2026",
    "imported_at": "2026-04-01T08:00:00Z",
    "is_active": false,
    "n_ranges": 231
  }
]
```

### Ce qui manque à construire (frontend) — module complet

**Wrapper `api.ts` à ajouter** :
```typescript
// Compléter les 3 wrappers existants (jamais appelés) + ajouter versions
referentiel: {
  ranges: (chain?: string) => request(`/referentiel/ranges${chain ? `?chain=${chain}` : ''}`),
  chains: () => request('/referentiel/chains'),
  config: () => request('/referentiel/config'),
  versions: () => request<ReferentielVersion[]>('/referentiel/versions'),  // à créer
}
```

**Page à créer** : `src/pages/Referentiel.jsx` (ou dans la section admin) avec quatre
onglets :

| Onglet | Endpoint | Description |
|---|---|---|
| **Filières** | `/referentiel/chains` | Liste des filières avec leur spécialité |
| **Barèmes** | `/referentiel/ranges?chain=<code>` | Table des grilles de notation, filtrable par filière |
| **Paramètres** | `/referentiel/config` | Affichage en lecture seule des pondérations et seuils globaux |
| **Versions** | `/referentiel/versions` | Historique des imports avec version active mise en évidence |

**Route frontend à ajouter** dans le routeur principal et dans la navigation sidebar.

---

## Synthèse des priorités

| Priorité | Module | Fonctionnalité | Complexité UI | Impact métier |
|---|---|---|---|---|
| 🔴 Critique | `agencies` | Maker-checker — approbation à double validation | Élevée (2 dialogs + liste + OTP) | Sécurité opérationnelle — empêche actions irréversibles à un seul agent |
| 🟡 Haute | `referentiel` | Module transparence barèmes (page entière) | Élevée (page 4 onglets) | Auditabilité réglementaire + compréhension des décisions crédit |
| 🟡 Moyenne | `portfolio` | Tableau d'amortissement — vue gestionnaire | Faible (onglet dans détail existant) | Suivi quotidien du portefeuille de prêts |
| 🟠 Moyenne | `portfolio` | Agenda des remboursements à venir | Faible (liste filtrée) | Anticipation des risques d'impayés |
| 🟢 Faible | `savings` | Fiche détaillée d'un groupe d'épargne | Faible (panel latéral) | Confort de gestion des groupes |

---

## Notes d'implémentation

### Sécurité maker-checker agences
Le bypass actuel (action directe) est techniquement fonctionnel mais contourne le
contrôle à 4 yeux. Il est recommandé de **ne pas supprimer l'action directe** mais de
la réserver aux rôles avec capacité `config` (administrateur système), et d'imposer le
maker-checker à tous les autres rôles `validate`.

### Module référentiel — lecture seule
Les endpoints `/referentiel/*` sont en **lecture seule** depuis le frontend. La mise à
jour des barèmes se fait via le module `dataio` (import de fichier Excel, commit). La
page Référentiel n'a donc pas besoin de formulaires d'édition — uniquement de la
consultation et de la navigation.

### Backend prêt, aucune migration requise
Tous les endpoints documentés ici sont **en production dans le backend**, couverts par
les tests (283 tests — OK), et ne nécessitent aucune migration de base de données ni
modification backend. Le travail est intégralement côté frontend.

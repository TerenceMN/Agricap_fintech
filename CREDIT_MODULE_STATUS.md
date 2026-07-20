# Module Crédit AGRICAP — État Actuel

> Mis à jour : Juillet 2026

---

## 1. Architecture du Parcours Client

```
Étape 1 : Demande initiale
  → Sélection filière + superficie + montant
  → Préremplissage depuis profil client (KYC, encours, historique)

Étape 2 : Simulateur intelligent
  → Upload Feuille de Besoins (Excel)
  → Parsing automatique → totaux par module (depuis 5_Synthèse_Besoins)
  → Simulation scoring depuis données de référence (dataio)

Étape 3 : Configuration garanties
  → Garantie épargne (hold wallet) ou caution morale

Étape 4 : Fiche de synthèse + soumission
  → Dossier créé en base (statut : submitted)
  → Transmission au backoffice
```

---

## 2. Filières Actives (référentiel DB)

| Code | Libellé | Taux de base | Durée cycle | Score minimum |
|------|---------|-------------|-------------|---------------|
| `CAFE_ARABICA` | Café Arabica | 6,00 %/an | 9 mois | 60/100 |
| `HARICOT` | Haricot | 8,50 %/an | 4 mois | 55/100 |
| `MANIOC` | Manioc | 8,00 %/an | 12 mois | 50/100 |
| `MAIS` | Maïs | 7,50 %/an | 5 mois | 55/100 |
| `RIZ` | Riz | 7,00 %/an | 6 mois | 58/100 |

---

## 3. Simulateurs de Référence (dataio)

### 3.1 Fichiers ingérés dans la base

14 simulateurs par filière + 1 simulateur générique v4 :

| Fichier | Filière |
|---------|---------|
| `AGRICAP_FIN_SIM_01_Cereales_Mais.xlsx` | Céréales — Maïs |
| `AGRICAP_FIN_SIM_02_Legumineuses_Haricot.xlsx` | Légumineuses — Haricot |
| `AGRICAP_FIN_SIM_03_Tubercules_PatateDouce.xlsx` | Tubercules — Patate douce |
| `AGRICAP_FIN_SIM_04_Maraichage_Tomate.xlsx` | Maraîchage — Tomate |
| `AGRICAP_FIN_SIM_05_Bananes_Plantain.xlsx` | Bananes — Plantain |
| `AGRICAP_FIN_SIM_06_FruitsTropicaux_Maracuja.xlsx` | Fruits tropicaux — Maracuja |
| `AGRICAP_FIN_SIM_07_CulturesIndustrielles_Sesame.xlsx` | Cultures industrielles — Sésame |
| `AGRICAP_FIN_SIM_08_Apiculture_RuchesKenyanes.xlsx` | Apiculture |
| `AGRICAP_FIN_SIM_09_Elevage_PouletChair.xlsx` | Élevage — Poulet de chair |
| `AGRICAP_FIN_SIM_10_ElevagesNonConv_LarvesBSF.xlsx` | Élevages non conventionnels |
| `AGRICAP_FIN_SIM_11_Aquaculture_TilapiaEtang.xlsx` | Aquaculture — Tilapia |
| `AGRICAP_FIN_SIM_12_Agroforesterie_TaungyaAcaciaMais.xlsx` | Agroforesterie |
| `AGRICAP_FIN_SIM_13_Champignons_Pleurotes.xlsx` | Champignons |
| `AGRICAP_FIN_SIM_14_Transformation_MoulinMais.xlsx` | Transformation |
| `AGRICAP_FIN_Simulateur_Credit_Cycle_Production_v4.xlsx` | Générique (fallback) |

### 3.2 Tables utilisées par filière (structure commune)

| Table | Contenu | Utilisation |
|-------|---------|-------------|
| `5_Synthese_Besoins` | Totaux par rubrique + TOTAL GÉNÉRAL | Référentiels de comparaison |
| `10_Capacite_Remboursement` | Taux, durée, différé, DSCR, EBE | Paramètres du prêt |
| `12_Analyse_Credit` | Critères scoring + pondérations | Poids du scoring |

---

## 4. Logique de Simulation (DataioSimulator)

### 4.1 Correspondance filière → simulateur

Le moteur cherche d'abord un simulateur dont le nom contient les mots-clés du code filière :
- `MAIS` → `SIM_01_Cereales_Mais` ✓ (2 tokens communs : "mais")
- `CAFE_ARABICA` → aucun simulateur Café → utilise le référentiel `ValueChain`

**Quand le simulateur correspond à la filière :**
- Totaux de référence : lus depuis `5_Synthese_Besoins` du simulateur
- Taux : lu depuis `10_Capacite_Remboursement`
- DSCR : calculé en scalant l'EBE de référence

**Quand il n'y a pas de simulateur pour la filière (ex. CAFE_ARABICA) :**
- Totaux de référence : calculés depuis `ValueChain.module_weights × cost_per_hectare_usd × superficie`
- Taux : `ValueChain.base_rate` (ex. 6% pour CAFE_ARABICA)
- Durée : `ValueChain.cycle_months` (ex. 9 mois pour CAFE_ARABICA)
- DSCR : proxy depuis le simulateur le plus proche (scalé par ratio montant)

### 4.2 Critères de scoring (pondérations depuis `12_Analyse_Credit`)

| Critère | Poids | Calcul |
|---------|-------|--------|
| Fiabilité technique | 25% | Cohérence feuille de besoins vs référentiel (plage ±30% par module) |
| Capacité financière (DSCR) | 20% | DSCR ≥ 1.8 → 100pts, ≥ 1.5 → 80pts, ≥ 1.25 → 60pts, ≥ 1.0 → 30pts |
| Résilience au stress | 10% | DSCR × 0.75 (stress test −25%) |
| Historique comportemental | 30% | Transactions wallet AGRICAP (défaut 50/100 si nouveau client) |
| Garanties & domiciliation | 15% | Couverture garanties vs montant demandé |

### 4.3 Taux proposé (ajustement par score)

| Score | Taux proposé |
|-------|-------------|
| ≥ 85 | Taux de base − 2 points |
| ≥ 70 | Taux de base (standard) |
| ≥ 55 | Taux de base + 2 points |
| < 55 | Taux de base + 5 points |

---

## 5. Feuille de Besoins — Parsing

### 5.1 Template officiel

Fichier : `credits/static/credits/feuille_besoins_template.xlsx`  
Endpoint : `GET /api/credits/needs-sheet-template/?value_chain_code=CAFE_ARABICA`

### 5.2 Structure du classeur

| Feuille | Rôle |
|---------|------|
| `4_Besoins_Financiers` | Saisie détaillée ligne par ligne (Rubrique, Quantité, Prix, Total) |
| `5_Synthese_Besoins` | **Source principale** : totaux par rubrique + TOTAL GÉNÉRAL (calculé automatiquement par Excel) |

### 5.3 Totaux lus depuis `5_Synthese_Besoins`

| Rubrique Excel | Code module Python | Exemple (template) |
|---------------|-------------------|-------------------|
| Semences & Intrants | `semences` | 600 USD |
| Opérations mécanisées | `mecanisation` | 450 USD |
| Main d'œuvre | `maindoeuvre` | 280 USD |
| Équipement & petit matériel | `equipements` | 0 USD |
| Récolte & post-récolte | `postrecolte` | 0 USD |
| Logistique | `logistique` | 0 USD |
| Commercialisation | `commercialisation` | 0 USD |
| Réserve d'exploitation | `reserve` | 0 USD |
| **TOTAL GÉNÉRAL** | — | **1 330 USD** |

---

## 6. Workflow Dossier de Crédit

```
draft
  ↓ (client soumet)                          → si dossier "pour le compte de" :
submitted                                       fenêtre de consentement client 72 h
  ↓ (analyste prend en charge)                  (bloque start-analysis si absent/expiré)
in_analysis  ←──────────────┐
  ↓ favorable   ↓ défavorable │ (réouverture)
approved      rejected      adjourned
  ↓ (demande de décaissement)   ↑ (ajournement, commentaire obligatoire)
pending_disbursement
  ↓ (maker ≠ checker confirme)   └→ (annulation → retour approved)
active
  ↓ (remboursement complet)
closed
```

Le statut `adjourned` et l'annulation de décaissement sont implémentés dans
[workflow.py](backend/credits/workflow.py) et [disbursement.py](backend/credits/disbursement.py).

### 6.1 Applications en base (état actuel)

| Statut | Nombre |
|--------|--------|
| `pending_disbursement` | 1 |
| `in_analysis` | 1 |

---

## 7. Endpoints Disponibles (parcours client)

Routes déclarées dans [credits/urls.py](backend/credits/urls.py), préfixe `/api/credits/`.

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/credits/application/prefill/` | Préremplissage (profil client, filières, historique) |
| `POST` | `/api/credits/needs-sheet/parse/` | Upload + parsing feuille de besoins |
| `GET` | `/api/credits/needs-sheet-template/` | Téléchargement template Excel — **accès public** (`@permission_classes([])`) |
| `POST` | `/api/credits/simulate/` | Simulation scoring depuis données de référence |
| `GET` | `/api/credits/applications/` | Liste des dossiers (rôle-dépendant) |
| `GET` | `/api/credits/applications/<code>/` | Détail du dossier (sérialisation filtrée par rôle) |
| `POST` | `/api/credits/applications/<code>/score/` | Re-scorer un dossier existant |
| `POST` | `/api/credits/applications/<code>/submit/` | Soumission `draft` → `submitted` |
| `POST` | `/api/credits/applications/<code>/client-consent/` | Consentement client (dossier « pour le compte de ») |
| `GET` | `/api/credits/applications/<code>/guarantees/` | Liste des garanties + ratio de couverture |
| `POST` | `/api/credits/applications/<code>/guarantees/savings/` | Pose d'une garantie épargne (hold wallet) |
| `POST` | `/api/credits/applications/<code>/guarantees/moral/` | Enregistrement d'une caution solidaire |
| `POST` | `/api/credits/applications/<code>/guarantees/asset/` | Gage sur un actif vérifié — `{asset_id}` |
| `POST` | `/api/credits/applications/<code>/guarantees/<id>/confirm/` | Confirmation — gage effectif de l'actif (staff) |
| `GET` | `/api/credits/applications/<code>/disbursement/` | Détail du décaissement |
| `POST` | `/api/credits/applications/<code>/disbursement/request/` | Demande de décaissement |
| `POST` | `/api/credits/applications/<code>/disbursement/confirm/` | Confirmation décaissement (maker ≠ checker) |

> **Correction** — les versions précédentes de ce document indiquaient
> `/disburse/request/` et `/disburse/confirm/`. Le segment réel est
> **`/disbursement/`**.

Les endpoints réservés à l'analyste, à l'agent et au comité sont documentés au [§8](#8-backoffice--administration).

---

## 8. Backoffice & Administration

### 8.1 Deux backoffices crédit distincts

Le crédit est administré par **deux ensembles séparés**, adossés à deux apps Django et deux modèles différents. Ils ne partagent pas leur machine à états.

| | Backoffice A — « Portefeuille » | Backoffice B — « Analyse & workflow » |
|---|---|---|
| Route front | `/credits` (vue admin) | `/credit`, `/credit/dossiers`, `/credit/dossiers/<code>` |
| Composants | [src/components/admin/credits/](src/components/admin/credits/) | [src/pages/credit/](src/pages/credit/) |
| App backend | [backend/portfolio/](backend/portfolio/) | [backend/credits/](backend/credits/) |
| Modèle | `portfolio.Loan` | `credits.CreditApplication` |
| Objet | Gestion du prêt décaissé (taux, échéancier, transactions, alertes) | Instruction du dossier (scoring, comité, décaissement) |
| Garde-fous | `IsStaff` uniquement | maker ≠ checker + plafonds de délégation |

Deux seuls points de jonction : `POST /api/portfolio/loans/from-application/<code>` (rattachement) et la lecture de l'analyse via `GET /api/credits/applications/<code>/` dans `CreditDetailsModal`.

### 8.2 Composants UI admin — [src/components/admin/credits/](src/components/admin/credits/)

| Fichier | Rôle | Appels API |
|---|---|---|
| `CreditsDashboard.jsx` | Conteneur admin : KPI, table, création | `GET /api/portfolio/loans`, `/summary`, `/alerts` ; `POST /api/portfolio/loans/<ref>/action` |
| `CreditsTable.jsx` | Filtres statut, recherche, export XLSX | Aucun (export local) |
| `CreditRow.jsx` | Ligne + menu d'actions | Aucun (émet des événements) |
| `CreditDetailsModal.jsx` | Détail : Info / Échéancier / Transactions / Analyse | `GET /api/credits/applications/<code>/` ; `GET /api/portfolio/loans/<ref>/schedule` |
| `RateMaturityModal.jsx` | Taux, durée, fréquence, date de départ + simulation | `GET`/`POST /api/portfolio/loans/<ref>/config` |
| `TransactionSubTable.jsx` | Sous-table transactions | `GET /api/portfolio/loans/<ref>/transactions` |
| `CreditFormDialog.jsx` | Création manuelle (formulaire ou upload) | `POST /api/credits/applications` puis `POST /api/portfolio/loans/from-application/<code>` |

L'écran réel d'instruction analyste est [ApplicationDetail.tsx](src/pages/credit/ApplicationDetail.tsx), piloté par `app.availableActions` calculé côté serveur.

### 8.3 Endpoints admin/analyste — `/api/credits/`

Les groupes cités sont ceux de [credits/roles.py](backend/credits/roles.py).

| Méthode | Endpoint | Description | Groupe requis |
|---|---|---|---|
| `GET` | `/api/credits/dashboard/` | KPI role-aware (`?view=committee` pour la corbeille comité) | authentifié |
| `POST` | `…/<code>/start-analysis/` | `submitted` → `in_analysis` | `CAN_INSTRUCT` |
| `POST` | `…/<code>/approve/` | `in_analysis` → `approved` | `CAN_DECIDE` + délégation |
| `POST` | `…/<code>/reject/` | `in_analysis` → `rejected` (`reason_code` obligatoire) | `CAN_DECIDE` |
| `POST` | `…/<code>/adjourn/` | `in_analysis` → `adjourned` (commentaire obligatoire) | `CAN_INSTRUCT` |
| `POST` | `…/<code>/reopen-analysis/` | `adjourned` → `in_analysis` | `CAN_INSTRUCT` |
| `POST` | `…/<code>/score/` | Re-scorer un dossier | `CAN_INSTRUCT` |
| `POST` | `…/<code>/disbursement/request/` | Demande de décaissement (maker) | `CAN_REQUEST_DISBURSEMENT` |
| `POST` | `…/<code>/disbursement/confirm/` | Confirmation (checker) | `CAN_CONFIRM_DISBURSEMENT` |
| `POST` | `…/<code>/disbursement/cancel/` | `pending_disbursement` → `approved` | `CAN_REQUEST_DISBURSEMENT` |
| `POST` | `…/<code>/guarantees/<id>/release/` | Libère une garantie | `CAN_INSTRUCT` |
| `GET` | `…/<code>/analysis-report/` | Rapport d'analyse documentaire | authentifié + étanchéité client |
| `POST` | `…/<code>/analysis-report/` | Décision analyste sur un finding | `CAN_INSTRUCT` |

### 8.4 Endpoints portefeuille — `/api/portfolio/`

Toutes les vues sont protégées par `@permission_classes([IsStaff])` — booléen `user.is_staff_role`, **sans granularité de rôle**.

| Méthode | Endpoint | Description |
|---|---|---|
| `GET`/`POST` | `/api/portfolio/loans` | Liste filtrable (déclenche `sync_from_applications`) / création manuelle |
| `POST` | `/api/portfolio/loans/from-application/<code>` | Rattache un prêt à une `CreditApplication` |
| `GET`/`PATCH`/`DELETE` | `/api/portfolio/loans/<ref>` | Détail / modification / suppression |
| `GET`/`POST` | `/api/portfolio/loans/<ref>/config` | Taux, durée, fréquence, statut (+ audit) |
| `GET` | `/api/portfolio/loans/<ref>/schedule` | Échéancier calculé |
| `GET`/`POST` | `/api/portfolio/loans/<ref>/transactions` | Transactions |
| `GET`/`POST` | `/api/portfolio/loans/<ref>/notes` | Notes |
| `POST` | `/api/portfolio/loans/<ref>/action` | Action générique (voir ci-dessous) |
| `GET` | `/api/portfolio/summary` | Cartes KPI |
| `GET` | `/api/portfolio/alerts` | Alertes |
| `GET` | `/api/portfolio/calendar` | Échéancier global — **non consommé par le front** |

Actions acceptées par `/action` : `reassign`, `extend`, `pause`, `block`, `resume`, `close`, `cancel`, `default`, `approve`, `reminder`, `note`, `disburse`. Elles écrivent directement `loan.status`, **sans passer par `credits/workflow.py`** — donc sans maker ≠ checker ni contrôle de délégation.

### 8.5 Rôles et plafonds de délégation

Le module crédit s'appuie sur les **16 rôles canoniques** de
[rbac/role_registry.py](backend/rbac/role_registry.py) — aucun rôle propre au crédit.
La traduction entre vocabulaire métier et identifiants canoniques vit dans un
fichier unique, [credits/roles.py](backend/credits/roles.py).

| Partie prenante | Rôle canonique | Rôle dans le crédit |
|---|---|---|
| Client / garant | `client`, `agri_op`, `invest`, `partner` | Dépose, uploade, configure ses garanties, consent |
| Agent terrain | `agent_terrain`, `agent_cash` | Monte le dossier, vérifie les actifs — **n'approuve jamais** |
| Gestionnaire Crédits | `gest_credit`, `gest_port` | Instruit et décide dans sa délégation |
| Niveau agence | `gest_zone` | Décide au niveau agence |
| Caisse | `gest_caisse` | **Confirme** le décaissement (checker) |
| Direction | `dir_ops`, `dg` | Décide au-delà des plafonds |
| Comité de crédit | `dg`, `admin` | Pas de rôle propre — corbeille via `?view=committee` |
| Audit / risque | `aud_tech`, `aud_fin`, `risk_analyst`, `compliance` | Lecture seule, aucune décision |
| Administration | `admin`, `admin_it`, `dg` | Référentiels, templates, barèmes |

**Autorité d'approbation — deux conditions cumulatives** : capacité `validate`
dans le registre **et** présence dans `CREDIT_DELEGATION_USD`. La capacité seule
ne suffit pas : `admin_it` et `compliance` valident de la configuration et de la
conformité, pas des engagements financiers.

| Rôle | Plafond d'approbation |
|---|---|
| `gest_credit`, `gest_port`, `gest_zone`, `gest_caisse`, `manager` | 25 000 USD |
| `dir_ops` | 100 000 USD |
| `dg`, `admin` | illimité |
| *tout autre rôle* | **aucune autorité** |

**Séparation des tâches** : confirmer un décaissement exige la capacité
`disburse`, que `gest_credit` ne porte pas — celui qui instruit le dossier ne
libère pas les fonds. Deux tests verrouillent ces deux invariants.

Fenêtre de consentement client : `CREDIT_CONSENT_WINDOW_HOURS = 72`.

### 8.6 Administration Django

**Aucun modèle crédit, référentiel ou dataio n'est enregistré dans l'admin Django.** `referentiel/admin.py` et `dataio/admin.py` ne contiennent que le boilerplate ; `reference_data/` et `credits/` n'ont pas de fichier `admin.py`. Seules `portfolio/` (`Loan`, `LoanConfigHistory`, `LoanNote`) et `support/` exposent des modèles dans `/admin/`.

Toute l'administration des référentiels passe donc par l'API DRF et le front React.

---

## 9. Données de Référence

### 9.1 Trois systèmes distincts et non connectés entre eux

| App | Rôle | Consommateur |
|---|---|---|
| [backend/reference_data/](backend/reference_data/) | Référentiel filières paramétrique (`ValueChain`) avec maker-checker | `credits/scoring.py`, `prefill.py`, `dataio_simulator.py` |
| [backend/referentiel/](backend/referentiel/) | Référentiel technico-économique v3 : 14 chaînes, plages min/max, config institution | `credits/analysis.py`, `/api/referentiel/*` |
| [backend/dataio/](backend/dataio/) | Ingestion générique de classeurs `.xlsx` → tables/colonnes/lignes | `DataAdmin.tsx`, `credits/dataio_simulator.py` |

> Les 14 chaînes figées de `referentiel/chains.py` (codes `01`–`14`) et les `ValueChain` en base (codes `MAIS`, `RIZ`…) sont **deux nomenclatures sans mapping** dans le code.

### 9.2 Modèle `ValueChain` — [reference_data/models.py](backend/reference_data/models.py)

C'est ce modèle qui alimente le tableau du [§2](#2-filières-actives-référentiel-db).

| Champ | Type | Rôle |
|---|---|---|
| `code`, `label`, `active` | Char / Bool | Identité de la filière |
| `cycle_months` | Integer | Durée du cycle (§2) |
| `cost_per_hectare_usd` / `_cdf` | Decimal | Base de calcul des totaux de référence |
| `module_weights` | JSON | Poids des 8 modules — doit sommer à 100 % |
| `risk_factor` | Decimal(5,3) | Facteur de risque filière |
| `min_score_required` | Integer | Score minimum (§2) |
| `base_rate` | Decimal(5,2) | Taux de base (§2) |
| `harvest_months`, `eligible_guarantees` | JSON list | Mois de récolte ; garanties admises (`epargne`, `morale`, `foncier`, `materiel`) |
| `source_file` | FK `ReferenceFileUpload` (**PROTECT**) | Traçabilité du fichier source |

Clés de `module_weights` : `semences, mecanisation, maindoeuvre, equipements, postrecolte, logistique, commercialisation, reserve` — identiques aux codes modules du [§5.3](#53-totaux-lus-depuis-5_synthese_besoins).

### 9.3 Cycle de vie d'un référentiel filière (maker-checker)

```
upload .xlsx  →  validation  →  pending_validation  →  activation  →  active
   (maker)      (18 colonnes)      (+ diff calculé)     (checker ≠ maker)
                     ↓ échec                                  ↓
                422 + errors[]                    l'actif précédent → archived
```

| Méthode | Endpoint | Permission |
|---|---|---|
| `POST` | `/api/reference-data/upload/` | `HasCapability("config")` |
| `GET` | `/api/reference-data/uploads/` | `HasCapability("config")` |
| `POST` | `/api/reference-data/uploads/<id>/activate/` | `HasCapability("config")` |
| `GET` | `/api/reference-data/value-chains/` | `HasCapability("read")` — cache 300 s |

**Règles de validation** ([validators.py](backend/reference_data/validators.py)) — feuille `value_chains` obligatoire, 18 colonnes requises, somme des 8 poids = 100 % (±0.5), `base_rate ∈ [1, 30]`, `risk_factor > 0`, `min_score ∈ [0, 100]`, mois ∈ [1..12], garanties ⊂ {epargne, morale, foncier, materiel}, codes uniques.

**Seed initial** (les 5 filières du §2) :

```bash
python manage.py shell < reference_data/fixtures/value_chains_initial.py
```

Ce n'est pas une fixture Django : `loaddata` ne fonctionne pas dessus.

### 9.4 Ingestion des classeurs — `dataio`

Schéma générique (`DataSource` → `DataTable` → `DataColumn` → `DataRecord`), donc **aucune migration par nouveau fichier**. Un simulateur n'a pas de modèle dédié : c'est un `DataSource` avec `kind="SIMULATEUR"`, détecté si ≥2 marqueurs parmi `1_Accueil_Parametres`, `4_Besoins_Financiers`, `8_Previsions_Ventes` **et** ≥15 feuilles.

Flux en trois temps, toutes vues en `IsStaff` :

| Étape | Endpoint | Effet |
|---|---|---|
| Upload | `POST /api/dataio/sources` | Crée un `DataSource` `STAGED` + `preview` (8 lignes) — **rien en base** |
| Aperçu | `GET /api/dataio/sources/<id>` | Lecture seule |
| Enregistrement | `POST /api/dataio/sources/<id>/commit` | Écrit tables/lignes, versionne (`revision`, `is_current`, `supersedes`) |
| Consultation | `GET /api/dataio/sources/<id>/tables` | Tables + colonnes + **500 lignes max** par table |
| Correction | `POST /api/dataio/tables/<id>/records` | Édition de cellules + suppression de lignes + resync du typé |
| Renommage | `PATCH /api/dataio/tables/<id>` | Renomme une table (409 si doublon) |
| Historique | `GET /api/dataio/history?key=<dataset_key>` | Toutes les révisions d'un dataset |
| Suppression | `DELETE /api/dataio/sources/<id>` | Cascade + réactivation de la révision précédente |

Le versionnage s'appuie sur `dataset_key` (nom de fichier normalisé : sans accents, minuscules, espaces compactés). L'historique est conservé — le commit bascule seulement `is_current`.

> **Le hook de re-synchronisation ne s'applique qu'aux référentiels** : `ingest_workbook` n'est rappelé au commit que si `kind == "REFERENTIEL"`. Un simulateur reste uniquement en tables génériques.

### 9.5 Référentiel technico-économique — `referentiel`

| Méthode | Endpoint | Retour |
|---|---|---|
| `GET` | `/api/referentiel/ranges` (+ `?chain=09`) | Plages min/max de la version active |
| `GET` | `/api/referentiel/chains` | Les 14 chaînes |
| `GET` | `/api/referentiel/config` | Seuils + pondérations + `phase_deploiement` |
| `GET` | `/api/referentiel/versions` | Historique des versions |

Ces routes sont **sans slash final** (contrairement à `credits` et `reference-data`) et **en lecture seule** — l'app n'expose aucun endpoint d'écriture ; l'upload passe par `dataio`.

Import en ligne de commande — **seule commande de management custom du projet** :

```bash
python manage.py import_referentiel [chemin.xlsx] [--label LABEL]
# défaut : AGRICAP_REF_Referentiels_Technico_Economiques_v3.xlsx
```

`InstitutionConfig` porte les seuils institutionnels (DSCR 1.20, DSCR stressé 1.00, couverture 1.00, score global 70, pondérations 25/20/10/30/15, plafond délégué 25 000 USD, décote garantie 30 %) — **ce sont ces pondérations que reprend le [§4.2](#42-critères-de-scoring-pondérations-depuis-12_analyse_credit)**. La feuille de calibrage est `16_Calibrage_Gouvernance` ; absente, la config par défaut s'applique avec un warning.

### 9.6 Registre des actifs gageables — [backend/assets/](backend/assets/)

Refondu en juillet 2026. L'app existait comme CRUD léger (`status ∈ {free, pledged}`,
valeur purement déclarative) et **le client pouvait écrire son propre statut** via
`PATCH /api/assets/mine/<id>` : il suffisait de déclarer un actif pour qu'il serve
de garantie. Le principe 9 impose l'inverse.

Cycle de vie — toute transition passe par [assets/services.py](backend/assets/services.py) :

```
declare ──vérification agent──> verifie ──confirmation garantie──> gage
   │                              ↑                                  │
   └──────rejet (motif)──> rejete │                    libération ────┘
                                  └──────────── libere ←──────────────
```

| Concept | Champ | Qui l'écrit |
|---|---|---|
| Valeur déclarée | `value` | Le client |
| **Valeur retenue** | `valeur_retenue` | Le serveur, à la vérification : valeur constatée − décote `InstitutionConfig` (30 % par défaut) |
| Statut | `status` | Le service uniquement — jamais un payload client |
| Gage | `gage_application` | La confirmation de garantie, sous `select_for_update` |

C'est `valeur_retenue`, et elle seule, qui entre dans la couverture.

| Méthode | Endpoint | Accès |
|---|---|---|
| `GET`/`POST` | `/api/assets/mine` | Client — `?status=`, `?pledgeable=true` |
| `GET`/`PATCH`/`DELETE` | `/api/assets/mine/<id>` | Client — champs restreints ; 409 si l'actif est gagé |
| `GET` | `/api/assets/pending` | `CAN_VERIFY_ASSET` — file de vérification terrain |
| `POST` | `/api/assets/<id>/verify` | `CAN_VERIFY_ASSET` — `{valeur_verifiee, documents?}` |
| `POST` | `/api/assets/<id>/reject` | `CAN_VERIFY_ASSET` — `{motif}` obligatoire |

Toute modification d'un actif déjà vérifié le **remet en file de vérification** et
efface sa valeur retenue : on ne certifie pas un objet qui a changé depuis le contrôle.

### 9.7 Interface d'administration des données — [DataAdmin.tsx](src/pages/admin/DataAdmin.tsx)

Route `/admin/data`, `PrivateRoute roles={['admin']}`. Gère **exclusivement `dataio`** : upload → aperçu → enregistrement → édition des tables. CRUD effectif : création (upload + commit), lecture, mise à jour (cellules, nom de table), suppression (lignes, source). Pas d'ajout de ligne ni de colonne.

---

## 10. Points d'Attention & Limites Actuelles

### À surveiller
- **Filières sans simulateur dédié** (CAFE_ARABICA, HARICOT, MANIOC, RIZ) : le scoring utilise `ValueChain.module_weights` pour la fiabilité technique. Ces données doivent être correctement renseignées dans le référentiel filière.
- **Historique comportemental** : si le client n'a pas de transactions wallet AGRICAP, le score est 50/100 (neutre). À améliorer avec les données des caisses.
- **DSCR pour filières sans simulateur** : proxy basé sur le simulateur générique v4 → score DSCR peut être imprécis.

### Simulateurs manquants pour les filières actives
| Filière | Simulateur dédié | Fallback utilisé |
|---------|-----------------|-----------------|
| CAFE_ARABICA | ❌ Non | ValueChain + v4 générique |
| HARICOT | ✓ `SIM_02_Legumineuses_Haricot` | — |
| MANIOC | ❌ Non | ValueChain + v4 générique |
| MAIS | ✓ `SIM_01_Cereales_Mais` | — |
| RIZ | ❌ Non | ValueChain + v4 générique |

**Recommandation** : créer et ingérer des simulateurs pour CAFE_ARABICA, MANIOC et RIZ pour améliorer la précision du scoring.

### ✅ Résolu (juillet 2026) — nomenclature des rôles et délégation

L'anomalie P1 est corrigée. Ce qu'elle était réellement, une fois le code lu de près :

- **`request.roles` n'était jamais défini.** Aucun middleware ne posait cet attribut.
  `approve` recevait `approver_roles=[]`, et `_max_delegation_usd([])` retournait `0`
  → toute approbation d'un montant > 0 échouait en 403 `delegation_exceeded`.
- **Pire : les rôles comparés n'existaient pas.** `_require_permission(request, "agent")`
  comparait `user.role` — qui contient un identifiant du registre (`gest_credit`,
  `agent_terrain`…) — au littéral `"agent"`. Aucune correspondance possible.
  Seul `role == "admin"` franchissait ces gardes. **Le workflow crédit était
  intégralement inaccessible à tous les rôles métier**, pas seulement l'approbation.
- **La suite de tests était verte** : elle injectait `roles=["agent"]` directement
  dans `ViewContextService`, une valeur que l'authentification ne produit jamais.
  Elle validait un vocabulaire fictif.

**Correctif** — [credits/roles.py](backend/credits/roles.py), source unique de la
nomenclature crédit, adossée aux 16 rôles de `rbac/role_registry.py` :

| Fichier | Changement |
|---|---|
| `credits/roles.py` | **Nouveau** — groupes fonctionnels, `roles_of()`, `delegation_limit()` |
| `config/settings.py` | `CREDIT_DELEGATION_USD` rekeyé sur les identifiants canoniques |
| `credits/views.py` | `_require_permission` → `_require_group` ; les 2 lectures de `request.roles` → `_roles()` |
| `credits/workflow.py` | Délégation déléguée à `credits.roles` ; conversion CDF→USD tracée |
| `credits/view_context.py` | `_ACTION_ROLES` sur groupes canoniques + masquage hors délégation |
| `credits/dashboard.py` | Dispatch par groupes ; vue comité via `?view=committee` |
| `credits/tests.py` | Recalés sur les rôles réels + 13 tests de nomenclature et délégation |

Choix d'architecture, **divergent des SPEC** : celles-ci préconisent un middleware
posant `request.roles`. Impossible ici — l'authentification est faite par DRF
(`IdpBearerAuthentication`) après la chaîne de middlewares Django, avec
`UNAUTHENTICATED_USER: None` : un middleware ne verrait qu'un utilisateur anonyme.
Les rôles sont donc résolus à l'usage via `credits.roles.roles_of()`.

Deux invariants nouvellement verrouillés par des tests :
- tout rôle porteur d'une délégation porte la capacité `validate` ;
- confirmer un décaissement exige `disburse` — `gest_credit` instruit mais ne
  libère pas les fonds.

### ✅ Résolu (juillet 2026) — garanties opposables

Nomenclature canonique des garanties (**backend fait foi**, le front mappe) :

| Code | Libellé | Adossé à |
|---|---|---|
| `epargne` | Nantissement Épargne | hold sur `SavingsPlan` |
| `morale` | Caution Solidaire | garant du groupe (consentement : voir reste à faire) |
| `materiel` | Gage matériel | `assets.Asset` mobilier vérifié |
| `foncier` | Hypothèque / Foncier | `assets.Asset` immobilier vérifié |

`actif` et `immobilier` deviennent des alias d'affichage, plus des codes de stockage.

**Faille corrigée** : `ValueChain.eligible_guarantees` existait sans qu'aucun code ne
le contrôle — n'importe quel type pouvait être posé sur n'importe quelle filière.
Le contrôle est désormais fait à la pose des trois types **et** re-vérifié à la
soumission (un dossier resté en brouillon peut porter un type devenu inéligible).

**Faille corrigée** : le client pouvait écrire le `status` de ses propres actifs.
Voir [§9.6](#96-registre-des-actifs-gageables--backendassets).

Les 5 règles bloquantes du gage sur actif ([guarantees.py](backend/credits/guarantees.py)) :
propriété, actif vérifié et libre, catégorie gageable, type éligible pour la filière,
valeur retenue non nulle. Le gage effectif n'a lieu qu'à la **confirmation par un
agent**, sous `select_for_update` — c'est là qu'est empêché le double gage.

28 tests ajoutés, dont l'invariant « un actif ne peut être gagé deux fois ».

### Reste à faire sur les chantiers SPEC

| Lot | Contenu | État |
|---|---|---|
| 1 | Nomenclature garanties + contrôle `eligible_guarantees` | ✅ **fait** (backend + front) |
| 2 | Feuille de besoins → `dataio` (`kind=FEUILLE_BESOINS`) | ✅ **backend fait** — front n'envoie pas encore `application_code` |
| 3 | Front simulateur en calque strict | ⏳ partiel — score fictif supprimé, calque strict non fait |
| 4 | App `assets` : modèle, vérification terrain | ✅ **fait** (backend + front client + file agent) |
| 5 | Garantie sur actif, gage atomique | ✅ **fait** (backend + front) |
| 6 | Caution solidaire : consentement garant 72 h, 5 règles | ❌ non commencé |
| 7 | Nomenclature des rôles / délégation | ✅ fait |

### SPEC Moteur d'analyse — ✅ livrée

| Élément | État |
|---|---|
| `construire_echeancier` (`credits/echeancier.py`) | ✅ cas A.2 reproduit au centime dans les deux modes |
| `ReferentielFiliere`, `BaremeScore`, `AnalyseCredit` | ✅ migration 0010, rollback testé |
| Les 5 scoreurs + orchestration (`credits/analyse.py`) | ✅ `Decimal` partout, journalisation atomique |
| Seed idempotent (`manage.py seed_analyse`) | ✅ 3 barèmes + référentiel Maïs |
| Endpoints analyse / justifier / réanalyser / résumé | ✅ permissions déclaratives |
| Onglet Analyse (front) | ✅ `CreditDetailsModal` |
| Simulateur analyste (front) | ✅ `RateMaturityModal` |

**Cas de référence conforme** : service de dette 1 469,65 · CRD final 0,00 ·
DSCR 0,636 · score 29,2 · recommandation `refus`.

`AnalyseCredit` est immuable — `save()` refuse toute modification sauf l'ajout en
fin de `justifications`. Lignage figé par `needs_source_id + revision + sha256` :
deux analyses successives sont comparables, et leur écart est lui-même un signal.

#### Trois écarts SPEC / réalité, à arbitrer

**1. Les cash-flows n'ont aucune source.** La SPEC les lit dans une feuille
`Tresorerie` qui n'existe pas — `dataio` ne commit que les feuilles 4 et 5. Le
moteur les **projette** depuis `rendement_ref` (revenu brut − coûts, étalé sur
les mois d'amortissement), hypothèse restituée dans les détails du critère. Les
935 USD de l'exemple ne se déduisent d'aucune donnée détenue. Soit la feuille
entre au template, soit la projection devient la règle officielle.

**2. L'exemple de la §2 ne se déduit pas des barèmes de la §5.** La courbe DSCR
donne 19,7 pour 0,636 (et non 19,1) ; 6,4 pour le stressé 0,477 (et non 14,3).
La courbe n'a pas été tordue pour retomber sur l'illustration — elle serait
fausse pour tous les autres dossiers. L'écart est figé dans un test.

**3. Le référentiel Maïs seedé est inventé.** Ses coûts par module ont été
répartis à la main pour totaliser 9 111 USD/ha ; `AGRICAP_FIN_SIM_01.xlsx` n'a
pas été ouvert. **Ils pilotent 25 % du score** — à recalibrer avant tout usage réel.

#### Contradiction interne du backend, non arbitrée

Pour un score en bande 55–69, `scoring.py:332` propose `base + 2,5` et
`dataio_simulator.py:580` `base + 2,0`. **Deux taux différents proposés au même
client pour le même score.** Choisir change ce qu'on offre à des emprunteurs
réels : c'est un arbitrage du comité, pas d'implémentation.

S'y ajoute la grille de classement A/B/C/D, dupliquée en **trois échelles front**
et **quatre backend**, avec deux divergences : 3ᵉ palier à 50 côté front contre
55 côté backend, et comparaison `>` contre `>=` — un score valant exactement 85
ou 70 est déclassé d'une lettre à l'écran. Correctif atomique requis, et la
grille doit descendre dans `BaremeScore` (principe 8).

### Écrans backoffice (§7 de CLAUDE.md)

Livrés : file d'instruction analyste (`/credit/dossiers`), file de vérification des
actifs (`/credit/actifs`), corbeille du comité (`/credit/comite`), journal d'audit
(`/credit/journal`). Non faits : onglet Analyse, onglet Référence (principe 11),
suivi des garanties, décision collégiale avec quorum.

### Deux failles supplémentaires trouvées et corrigées

- **Le modèle Excel officiel faisait échouer sa propre validation.** La ligne
  « TOTAL BESOINS DU CYCLE » de la feuille 4 était comptée comme un besoin,
  doublant la rubrique et déclenchant `INCOHERENCE_INTERNE` **sur tout dossier
  conforme** — y compris ceux remplis à partir du template distribué par AGRICAP.
- **Un actif `libere` modifié restait mobilisable.** Le PATCH ne réinitialisait
  que le cas `verifie`. Séquence : gage levé → le client change désignation,
  catégorie ou valeur → le bien reste `is_pledgeable` avec une valeur retenue
  certifiée par un agent sur un objet qui a changé. Règle remontée dans
  `assets.services.invalidate_verification()`.

> Cause racine du second cas, à traquer ailleurs : le test existant **recopiait la
> condition de la vue en dur** au lieu d'appeler le code de production. Il validait
> sa propre copie du bug.

### Erreur relevée dans la SPEC Moteur

Le pseudo-code de la §4 calcule `A = capital / N` **avant** le différé. En mode
`franchise_totale`, le capital à amortir est le CRD après capitalisation : le prêt
ne se solderait jamais. L'annexe A.2 de la même SPEC donne d'ailleurs
`A = 477,59 = 1 432,78 / 3`. **L'implémentation suit l'annexe, pas le pseudo-code.**

### Anomalies bloquantes restantes — backoffice

- **`RateMaturityModal` : actions non persistées.** `block` / `suspend` / `resume` écrivent dans `localStorage` et affichent un toast de succès, sans appel backend — alors que `portfolio/services.py` implémente bien ces transitions.
- **Aucun endpoint `credits` n'a de `permission_classes` déclaratives** : le contrôle est fait en début de corps de vue (`_require_group`). Correct et testé, mais non déclaratif — à migrer vers des classes DRF branchées sur `HasCapability`.
- **`portfolio /action` contourne toujours le workflow** : les 12 actions écrivent `loan.status` directement, sans maker ≠ checker ni délégation.
- **Conversion CDF→USD non journalisée** : le contrôle de délégation utilise un taux de secours (`CREDIT_FALLBACK_CDF_PER_USD`), désormais loggué en warning mais toujours ni daté ni tracé — contraire au principe 4.
- **Actions UI sans backend** : génération de contrat et export de dossier affichent « à brancher (gabarit) » ; aucun endpoint correspondant n'existe.
- **Pas de vue comité de crédit** côté frontend, bien que `credit_committee` soit reconnu dans `_ACTION_ROLES` et que `dashboard.py` implémente `_committee_dashboard`.

### Anomalies — données de référence

- **L'API `reference-data` n'a aucune interface utilisateur** : l'upload et l'activation maker-checker des `ValueChain` ne sont accessibles qu'en appel direct. `DataAdmin.tsx` ne gère que `dataio`.
- **`api.ranges()`, `api.chains()`, `api.config()`** sont définis dans `src/services/api.ts` mais appelés par aucune page — code mort côté UI.
- **`file_type` `suppliers` et `rates`** sont déclarés dans `ReferenceFileUpload.FileType` mais systématiquement rejetés par `process_upload` : aucun validateur n'est implémenté.
- **Le diff d'activation est partiel** : `_compute_diff` ne détecte les modifications que sur `base_rate`, `cycle_months`, `min_score_required` et `risk_factor`. Un changement de coût à l'hectare ou de poids modules passe en « unchanged ».
- **`ReferenceWorkbook`** (`referentiel/models.py`) n'est écrit nulle part dans le code — modèle apparemment orphelin.
- **Troncature silencieuse** : `GET /api/dataio/sources/<id>/tables` limite à 500 lignes par table, sans pagination ni indication de troncature vers le front.
- **Aucune commande de management pour les simulateurs** ni commande de seed : les simulateurs passent uniquement par l'API `dataio`, le seed des filières par un script shell.

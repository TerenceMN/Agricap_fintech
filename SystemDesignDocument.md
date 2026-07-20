# Document de Conception Système : AGRICAP FINTECH
**Version:** 1.0.0 | **Date:** 2026-07-03 | **Auteur:** Équipe d'Architecture Système

---

## Résumé Exécutif
Ce document présente l'architecture décisionnelle et fonctionnelle de la plateforme AGRICAP. Il couvre 14 scénarios critiques d'ingénierie système et de gestion opérationnelle. Pour chaque scénario, 3 options (A, B, C) sont proposées, allant de la plus simple (Agile) à la plus complexe (Enterprise/Security-First). L'objectif est de fournir un cadre de décision cohérent pour garantir la sécurité, la scalabilité, et la conformité réglementaire de la plateforme, tout en préservant l'expérience utilisateur.

---

## Table des Matières
1. [Scénario 1 : Système de Notes (Audit & Suivi)](#scénario-1--système-de-notes-audit--suivi)
2. [Scénario 2 : Suspension d'Agence](#scénario-2--suspension-dagence)
3. [Scénario 3 : Clôture d'Agence](#scénario-3--clôture-dagence)
4. [Scénario 4 : Création Agence](#scénario-4--création-agence)
5. [Scénario 5 : Création Portefeuille](#scénario-5--création-portefeuille)
6. [Scénario 6 : Création Caisse](#scénario-6--création-caisse)
7. [Scénario 7 : Validation Transaction](#scénario-7--validation-transaction)
8. [Scénario 8 : Impacts en Cascade](#scénario-8--impacts-en-cascade)
9. [Scénario 9 : Rôles & Permissions](#scénario-9--rôles--permissions)
10. [Scénario 10 : Approbations & Validations](#scénario-10--approbations--validations)
11. [Scénario 11 : Persistance des Données](#scénario-11--persistance-des-données)
12. [Scénario 12 : Gestion des Erreurs](#scénario-12--gestion-des-erreurs)
13. [Scénario 13 : Rapports & Analytics](#scénario-13--rapports--analytics)
14. [Scénario 14 : Intégrations Externes](#scénario-14--intégrations-externes)
15. [Cohérence Inter-Scénarios & Arbre de Décision](#cohérence-inter-scénarios--arbre-de-décision)
16. [Synthèse & Matrice de Comparaison Globale](#synthèse--matrice-de-comparaison-globale)
17. [Profils de Configuration Recommandés](#profils-de-configuration-recommandés)

---

## Scénario 1 : Système de Notes (Audit & Suivi)
**Contexte:** Traçabilité des actions, des décisions et des commentaires sur les entités (Agences, Transactions).

* **Option A (Basique) :** Notes textuelles simples, non modifiables, horodatées.
* **Option B (Avancé) :** Notes riches (Rich Text), pièces jointes, mentions (@user), historique de modification.
* **Option C (Audit Strict) :** Notes structurées basées sur des blocs (type Notion), immuables, liées à des hachages cryptographiques pour conformité légale, validation par pairs.

| Caractéristique | Option A (Basique) | Option B (Avancé) | Option C (Audit Strict) |
| :--- | :--- | :--- | :--- |
| Format | Texte brut | Rich Text + Fichiers | Blocs structurés + Hash |
| Immuabilité | ✅ Oui | ❌ Non (Historisé) | ✅ Oui (Cryptographique) |
| Collaboration | ❌ Non | ✅ Oui (@mentions) | ✅ Oui (Workflow de validation) |

**Analyse d'Impact :**
* Sécurité : A (Faible), B (Moyenne), C (Haute)
* Performance : A (Très rapide), B (Moyenne - stockage fichiers), C (Lourde - hachage)
* Complexité : A (Basse), B (Moyenne), C (Haute)

**Recommandation :** Option B pour l'interne, Option C pour les secteurs hautement régulés (ex: AML/KYC).

---

## Scénario 2 : Suspension d'Agence
**Contexte:** Blocage temporaire d'une agence suite à une fraude ou non-conformité.

* **Option A (Soft Suspend) :** Blocage des nouvelles transactions. Les retraits en cours sont permis.
* **Option B (Hard Suspend) :** Gel total. Aucune entrée/sortie, désactivation des accès agents.
* **Option C (Phased Escrow) :** Suspension avec mise sous séquestre. Les fonds sont routés vers un compte de garantie, audit automatisé déclenché.

| Caractéristique | Option A (Soft) | Option B (Hard) | Option C (Escrow) |
| :--- | :--- | :--- | :--- |
| Flux financiers | Entrées bloquées | Gél total | Routés vers Séquestre |
| Accès Agents | Lecture seule | Révoqué | Restreint (Audit mode) |
| Conformité légale | ⚠️ Risque de fuite | ✅ Sécurisé | ✅ Haute sécurité |

**Recommandation :** Option C pour le profil "Security-First", Option B pour une réactivité immédiate.

---

## Scénario 3 : Clôture d'Agence
**Contexte:** Fermeture définitive d'un point de vente.

* **Option A (Immediate Soft-Delete) :** Changement de statut `is_active = false`.
* **Option B (Cool-down 30j) :** Période de grâce de 30 jours pour réconciliation, puis archivage.
* **Option C (Full Migration Workflow) :** Transfert automatisé des portefeuilles clients, rapprochement final forcé, génération d'un rapport de clôture certifié, puis archivage immuable.

| Caractéristique | Option A (Soft-Delete) | Option B (Cool-down) | Option C (Migration) |
| :--- | :--- | :--- | :--- |
| Vitesse | Instantanée | 30 jours | Dépend du rapprochement |
| Risque de perte | ⚠️ Élevé (Comptabilité) | ⚠️ Moyen | ✅ Nul |
| Dette Technique| Faible | Moyenne | Haute |

**Recommandation :** Option C. La gestion financière exige une intégrité transactionnelle parfaite lors d'une clôture.

---

## Scénario 4 : Création Agence
**Contexte:** Onboarding d'un nouveau point du réseau.

* **Option A (Direct Active) :** L'agence est active dès la soumission du formulaire.
* **Option B (Draft -> Admin) :** Statut "Brouillon", nécessite 1 validation Admin.
* **Option C (Comité Multi-niveaux) :** Création -> Visite Terrain (Checklist) -> Validation Conformité -> Validation Finance -> Activation.

**Recommandation :** Option C pour les réseaux franchisés, Option B en phase de lancement.

---

## Scénario 5 : Création Portefeuille
**Contexte:** Structuration des fonds d'investissement.

* **Option A (Preset statique) :** Choix parmi 3 profils (Risqué, Équilibré, Sécurisé).
* **Option B (Allocation personnalisée) :** L'investisseur/manager définit les % d'allocation (Obligations, Actions, Cash).
* **Option C (Smart Allocation algorithmique) :** Rééquilibrage automatique basé sur des algorithmes IA et l'analyse de risque VaR.

**Recommandation :** Option B pour l'agilité métier, Option C comme produit Premium futur.

---

## Scénario 6 : Création Caisse
**Contexte:** Déploiement d'un point d'encaissement physique/mobile.

* **Option A (Caisse Unique) :** Une seule caisse fiat par agence.
* **Option B (Multi-Caisses plafonnées) :** Création illimitée avec plafonds d'encaisse par agent.
* **Option C (Smart Caisses Multi-devises) :** Gestion CDF/USD automatique, Taux de change en temps réel, alertes de réapprovisionnement prédictives.

**Recommandation :** Option C (essentiel pour la réalité multi-devises RDC/Afrique).

---

## Scénario 7 : Validation Transaction
**Contexte:** Approbation des mouvements de fonds.

* **Option A (Auto-Validation) :** Toute transaction sous 1000$ est auto-validée.
* **Option B (Maker-Checker) :** L'Agent initie, le Manager valide.
* **Option C (Multi-Signature adaptative) :** <100$: Auto | 100$-5000$: Manager | >5000$: Quorum de 3 Superviseurs + MFA.

**Recommandation :** Option C. Le contrôle adaptatif réduit les goulots d'étranglement tout en sécurisant les gros montants.

---

## Scénario 8 : Impacts en Cascade
**Contexte:** Conséquences d'une modification (ex: annulation transaction) sur les rapports et portefeuilles.

* **Option A (Eventual Consistency) :** Les agrégats sont mis à jour via des tâches asynchrones en arrière-plan. (Risque de décalage temporaire).
* **Option B (Strict ACID) :** Transaction synchrone complète. Si un agrégat échoue, tout est rollbacké. (Bloquant si fort trafic).
* **Option C (Saga Pattern / CQRS) :** Architecture distribuée. Mise à jour via Event Sourcing avec compensation automatique en cas d'erreur.

**Recommandation :** Option C pour la scalabilité de type "Enterprise", Option B pour un MVP strict.

---

## Scénario 9 : Rôles & Permissions
**Contexte:** Contrôle d'accès au système.

* **Option A (RBAC basique) :** Rôles fixes (Admin, Manager, Agent).
* **Option B (ABAC) :** Basé sur les attributs (ex: Agent peut valider SEULEMENT si Agence = KOL-01 et Heure < 18h).
* **Option C (PBAC Hybride) :** Politiques dynamiques gérées par un moteur de règles (ex: restriction IP, géofencing, limites dynamiques de montants).

**Recommandation :** Option B est le compromis idéal entre sécurité et maintenabilité.

---

## Scénario 10 : Approbations & Validations
**Contexte:** Chaîne de décision des opérations critiques.

* **Option A (Approbation Simple) :** 1 clic = validé.
* **Option B (Approbation + MFA) :** Validation nécessite un code OTP ou biométrie.
* **Option C (Approbation par Smart Contracts) :** Validation conditionnée par l'exécution d'un contrat intelligent (vérification des oracles, soldes séquestres certifiés).

**Recommandation :** Option B pour l'environnement actuel. Option C si migration Web3 envisagée.

---

## Scénario 11 : Persistance des Données
**Contexte:** Stockage des données critiques et historiques.

* **Option A (Base Relationnelle Classique) :** PostgreSQL classique. Modèles CRUD standards.
* **Option B (PostgreSQL + Audit Tables) :** RDBMS avec triggers générant des logs d'audit immuables pour chaque modification.
* **Option C (Event Sourcing complet) :** La base de données stocke des *événements* (ex: "TxInitiated", "TxValidated"). L'état actuel est une projection de ces événements (CQRS).

**Recommandation :** Option B est requise au minimum. Option C pour la traçabilité financière absolue.

---

## Scénario 12 : Gestion des Erreurs
**Contexte:** Tolérance aux pannes du système.

* **Option A (Logs passifs) :** Erreurs écrites dans des fichiers de log.
* **Option B (Alerting Actif) :** Gestionnaire d'exceptions global + Notifications Slack/Email aux admins sur erreurs critiques.
* **Option C (Circuit Breakers + Dead Letter Queues) :** Isolation automatique des services défaillants, stockage des transactions échouées dans une file d'attente pour retraitement manuel ou automatique.

**Recommandation :** Option C pour éviter la perte de données financières lors de pannes réseau.

---

## Scénario 13 : Rapports & Analytics
**Contexte:** Génération de la BI et des états financiers.

* **Option A (Batch de Nuit) :** Rapports générés à 02h00 du matin.
* **Option B (Read Replicas en Temps Réel) :** Base de données séparée pour la lecture, rafraîchie en temps réel pour des dashboards live.
* **Option C (Streaming Analytics) :** Utilisation d'Apache Kafka / Supabase Realtime pour pousser des événements BI en millisecondes aux dashboards.

**Recommandation :** Option B (Équilibre coût/performance).

---

## Scénario 14 : Intégrations Externes
**Contexte:** Connexion avec Mobile Money, Banques, KYC.

* **Option A (API Point-to-Point) :** Appels directs aux API partenaires (couplage fort).
* **Option B (API Gateway centralisée) :** Une passerelle gère le routage, le rate-limiting et les timeouts.
* **Option C (Architecture Event-Driven avec Webhooks) :** Intégration via un Enterprise Service Bus (ESB) avec retry policies et gestion asynchrone des callbacks Mobile Money.

**Recommandation :** Option C, indispensable pour gérer la latence et les pannes des opérateurs télécoms africains.

---
---

## Cohérence Inter-Scénarios & Arbre de Décision

Les décisions prises dans ces 14 scénarios ne sont pas isolées. Voici la matrice d'interaction :

1. **Si [Scénario 2: Suspension Hard (B)] est choisi** ➡️ *Impacts* : Le [Scénario 8: Impacts en Cascade] doit immédiatement forcer l'invalidation des transactions en cours (Rollback). Le [Scénario 9: RBAC] doit révoquer les tokens JWT des agents.
2. **Si [Scénario 7: Multi-Signature (C)] est choisi** ➡️ *Impacts* : Le [Scénario 10: Approbations (B)] avec OTP devient obligatoire pour assurer que les signataires sont légitimes.
3. **Si [Scénario 11: Event Sourcing (C)] est choisi** ➡️ *Impacts* : Le [Scénario 1: Notes (C)] devient natif (chaque note est un événement). Le [Scénario 13: Rapports (C)] devient naturel via les flux d'événements.

### Arbre de Décision : Résolution de Conflit
* **Objectif Prioritaire = Vitesse d'Exécution :** Opter pour les Scénarios (A) en Création (4), Validation (7), et Intégration (14).
* **Objectif Prioritaire = Conformité Légale (RDC/BCC) :** Imposer Scénario 3(C) Clôture stricte, Scénario 7(C) Validation adaptative, Scénario 11(B/C) Persistance avec Audit.

---

## Synthèse & Matrice de Comparaison Globale

| Scénario | Option A (Agile) | Option B (Balanced) | Option C (Security-First) |
| :--- | :--- | :--- | :--- |
| **1. Notes** | Texte simple | Rich Text + @ | Blocs hashés |
| **2. Suspendre** | Soft (nouvelles Tx off) | Hard (Gel total) | Escrow & Audit |
| **3. Clôturer** | Soft-delete | 30j grace period | Migration totale |
| **4. Création Ag** | Direct active | Draft -> Admin | Comité multi-niveaux |
| **5. Portefeuille** | Preset statique | Custom allocation | Smart AI algorithm |
| **6. Caisse** | Unique | Multi plafonnée | Smart Multi-devises |
| **7. Valider Tx** | Auto-validation | Maker-Checker | Multi-Sig adaptative |
| **8. Cascades** | Eventual consistency | Strict ACID (Rollback)| Saga / CQRS |
| **9. Rôles** | RBAC basique | ABAC (Attributs) | PBAC (Politiques) |
| **10. Approuver** | 1 Clic | MFA / OTP | Smart Contracts |
| **11. Persistance**| RDBMS Classique | RDBMS + Audit Logs | Event Sourcing complet|
| **12. Erreurs** | Logs simples | Alerts + Global Handler| Circuit Breaker + DLQ |
| **13. Analytics** | Batch nocturne | Read Replicas (Live) | Streaming (Kafka) |
| **14. External APIs**| Point-to-point | API Gateway | Event-Driven ESB |

---

## Profils de Configuration Recommandés

### 🛡️ Profil 1 : "Security-First" (Recommandé pour Production Financière Régulée)
* **Sélection :** Majorité de "C" (1C, 2C, 3C, 7C, 8C, 10B, 11C, 12C, 14C).
* **Avantages :** Zéro perte de données, conformité totale aux normes bancaires, résilience aux pannes externes.
* **Inconvénients :** Coût d'infrastructure élevé, développement complexe, latence perçue légèrement supérieure due aux validations multiples.
* **Atténuation des risques :** Investir fortement dans l'UX pour masquer la complexité asynchrone (loaders, notifications WebSockets).

### ⚖️ Profil 2 : "Balanced" (Recommandé pour PME / Croissance)
* **Sélection :** Majorité de "B" (1B, 2B, 3B, 4B, 7B, 8B, 11B, 13B).
* **Avantages :** Excellent rapport qualité-prix, sécurité suffisante pour l'audit, maintenabilité élevée par une équipe moyenne.
* **Inconvénients :** Limites de scalabilité au-delà de 10,000 transactions/seconde, quelques interventions manuelles requises.
* **Atténuation des risques :** Effectuer des audits de base de données trimestriels pour s'assurer de l'intégrité de l'approche ACID/Audit.

### 🚀 Profil 3 : "Agile / Startup" (Recommandé pour MVP ou Preuve de Concept)
* **Sélection :** Majorité de "A" (1A, 2A, 4A, 7A, 9A, 11A, 13A).
* **Avantages :** Time-to-market ultra rapide, coûts de serveur minimes, architecture compréhensible par un développeur junior.
* **Inconvénients :** Refactoring massif obligatoire lors du scaling ou lors d'un audit de régulateur financier.
* **Atténuation des risques :** Documenter strictement la dette technique et isoler les modules pour faciliter la migration vers le Profil 2.

---

## Feuille de Route d'Implémentation (Roadmap)
L'implémentation du système "Balanced" (Profil 2) est recommandée comme cible initiale, évoluant vers le "Security-First" par la suite :

1. **Phase 1 (Mois 1-2) :** Fondations (Scénarios 11, 12, 9). Mise en place de la base de données RDBMS avec Audit, du RBAC, et du gestionnaire d'erreurs.
2. **Phase 2 (Mois 3-4) :** Cœur Métier (Scénarios 4, 6, 7, 10). Création des agences, des caisses multi-devises, logique Maker-Checker avec MFA.
3. **Phase 3 (Mois 5-6) :** Opérations Avancées (Scénarios 2, 3, 8). Suspension, clôture avec migration, et gestion des cascades via transactions SQL strictes.
4. **Phase 4 (Mois 7+) :** Périphérie & Scale (Scénarios 5, 13, 14). Portefeuilles dynamiques, API Gateway, et Read Replicas pour les dashboards.

---
**Document confidentiel et propriétaire - AGRICAP FINTECH © 2026**
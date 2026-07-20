# Front — simulateur de l'analyste (`RateMaturityModal`, SPEC Moteur §8c)

> Fragment de statut. À fusionner dans `CREDIT_MODULE_STATUS.md` (section moteur d'analyse).
> Auteur : MKOPO — juillet 2026. Périmètre :
> `src/components/admin/credits/RateMaturityModal.jsx`,
> `src/components/analyse/simulateur/**`.

---

## 1. Ce qui a été livré

`RateMaturityModal` passe de deux à trois onglets :

| Onglet | Contenu | Source des chiffres |
|---|---|---|
| **Simulateur d'analyse** (par défaut) | durée / différé / taux annuel / mode de différé → « Ré-analyser » → DSCR, DSCR stressé, score, recommandation, échéancier | `POST /api/credits/applications/<code>/reanalyser/` et `GET .../analyse/` |
| Paramètres du prêt | config portefeuille (taux mensuel, durée, date d'effet, fréquence) + `block` / `suspend` / `resume` | `/portfolio/loans/<ref>/config` et `/action` — **inchangés** |
| Historique & Audit | historique de configuration du portefeuille | `/portfolio/loans/<ref>/config` — inchangé |

Fichiers neufs, tous dans `src/components/analyse/simulateur/` :

- `SimulateurMoteur.jsx` — orchestration : chargement, états, ré-analyse, liste des essais ;
- `ComparaisonAnalyse.jsx` — avant / après (DSCR, DSCR stressé, score, recommandation, paramètres) ;
- `DiagnosticDiffere.jsx` — le lien différé → concentration de l'amortissement (SPEC §9.3) ;
- `EcheancierServeur.jsx` — l'échéancier tel que le moteur le sert ;
- `format.js` — mise en forme uniquement ; les montants réutilisent
  `components/guarantees/format.js` (formateur unique fr-FR), on n'y a ajouté que
  ce qui lui manquait (ratio brut type DSCR, horodatage, écart entre deux analyses).

### 1.1 Comparer avant / après

Voir la nouvelle valeur du DSCR ne dit rien à un analyste qui vient de passer le différé
de 5 à 3 mois ; voir la **variation** le dit. Chaque métrique affiche donc sa valeur
serveur **et** son écart, avec deux bases au choix dès qu'il y a plus d'une analyse :
*analyse précédente* (l'effet du dernier réglage) ou *analyse d'origine* (le chemin
parcouru depuis l'analyse du dossier). Le changement de recommandation est montré comme
une transition (`Refus → Revue manuelle`), pas comme une valeur isolée.

La soustraction est la seule arithmétique de cet écran, et elle porte sur deux nombres
déjà arrêtés par le serveur (`ecartEntre()` dans `format.js`). Elle n'est ni persistée
ni réutilisée.

### 1.2 Le différé rendu lisible

`DiagnosticDiffere` énonce, à partir de l'échéancier servi : « 5 mois de différé sur 8 :
la totalité du capital s'amortit sur 3 mois ; chaque échéance d'amortissement porte 1/3
du capital ». Le nombre de mois d'amortissement est **compté** dans les lignes de phase
`amortissement` renvoyées par le moteur (repli sur `dureeMois − differeMois` si les phases
manquent) — un comptage, pas une formule financière.

Le composant dit aussi ce qu'il ne peut pas faire : le diagnostic automatique
« un différé de N mois porterait le DSCR à X » (SPEC §9.3, boucle sur `differe_mois` dans
`reanalyser`) **n'est pas servi** ; la seule façon de l'obtenir aujourd'hui est de relancer
une analyse.

### 1.3 Immuabilité affichée à l'écran

Bandeau permanent dans l'onglet : chaque ré-analyse **crée une nouvelle analyse horodatée**,
rien n'est écrasé, ce n'est pas un brouillon, et l'écart entre deux analyses successives
est lui-même un signal suivi (principe 3). Une table « Analyses obtenues depuis l'ouverture
de cet écran » liste chaque essai (horodatage, paramètres, DSCR, DSCR stressé, score,
recommandation) en précisant que la liste est locale mais que les analyses, elles, sont
conservées côté serveur.

### 1.4 États explicites

| État | Déclencheur | Ce qui s'affiche |
|---|---|---|
| Chargement | ouverture de l'onglet | spinner « Chargement de l'analyse serveur… » |
| Sans dossier | `applicationCode` vide (prêt saisi manuellement) | « Aucune demande de crédit rattachée » — le moteur n'a pas de dossier à analyser ; aucun bouton |
| 404 | `GET .../analyse/` | l'endpoint exact est cité ; les **deux** causes indiscernables sont nommées (moteur non déployé / aucune analyse encore exécutée) ; le bouton devient « Lancer l'analyse » et interroge le serveur |
| 403 / 401 | permission refusée | « Accès refusé par le serveur » ; **aucun** bouton de ré-analyse n'est rendu |
| Erreur autre | 5xx, réseau | message serveur + bouton « Réessayer » |
| Vide | analyse sans lignes d'échéancier | « Le moteur n'a renvoyé aucune ligne d'échéancier » |
| Échec de ré-analyse | `POST .../reanalyser/` | alerte distinguant 404 / 403 / autre, et affirmant explicitement qu'**aucune analyse n'a été créée** et que les chiffres à l'écran restent ceux de la dernière analyse reçue |

Aujourd'hui, `backend/credits/urls.py` ne déclare **aucune** route `analyse` /
`reanalyser` : l'écran s'ouvre donc en état 404 documenté. C'est un état, pas une panne.

---

## 2. Ce qui a été supprimé, et pourquoi

L'onglet « Paramètres & Simulation » calculait **dans le navigateur** un tableau
d'amortissement (amortissement constant, intérêt simple), un total d'intérêts, un total à
rembourser et un « TAEG estimé ». Un commentaire prévenait que ces chiffres n'étaient pas
ceux du serveur — mais ils s'affichaient en gros, en haut, dans le modal que l'analyste
ouvre pour décider.

Ce bloc a été retiré. Il produisait pour un même dossier deux échéanciers et deux coûts du
crédit dont aucun n'était opposable, et il ne pouvait de toute façon pas représenter ce que
fait le moteur : il ignore la notion de différé, ignore les deux modes (`interets_seuls` /
`franchise_totale`), et applique le taux **mensuel** du portefeuille là où le moteur
raisonne en taux annuel. L'écart n'était pas un arrondi, c'était un autre modèle.

Aucun échéancier, DSCR ou mensualité n'est désormais calculé côté client dans cet écran.
L'annexe A de la SPEC a servi à lire et nommer ce qui s'affiche (phases, CRD de début de
mois, dernière échéance ajustée au solde exact), jamais à le reproduire.

**Non affiché volontairement** : les totaux « coût du crédit » et « service de la dette ».
Le contrat `CreditAnalyse` ne les porte pas ; les recomposer par somme des lignes
recréerait un chiffre du navigateur à côté d'un chiffre serveur — précisément ce qu'on
vient de supprimer. Ils s'afficheront quand le moteur les servira.

---

## 3. Ce qui n'a pas bougé

Le branchement portefeuille du matin est intact :

- `api.portfolio.config(credit.id)` au chargement, `api.portfolio.saveConfig(...)` à
  l'enregistrement ;
- `api.portfolio.action(credit.id, 'block' | 'suspend' | 'resume')` avec relecture de la
  config après l'action, confirmation inline, `actionBusy`, et le rappel que ces
  transitions ne passent pas par `credits/workflow.py` (ni maker ≠ checker ni contrôle de
  délégation) ;
- `ACTIVE_STATES` et le choix Suspendre/Bloquer vs Réactiver.

Modifications collatérales minimes : le montant de l'en-tête passe par `formatMontant`
(il utilisait `toLocaleString()` sans locale), et le modal s'élargit à `max-w-6xl`.

---

## 4. Décisions à connaître

**Quel `code` envoyer au moteur ?** `portfolio/serializers.py::loan_row` sert
`applicationCode` : le code de la demande pour un prêt issu du pipeline, la chaîne vide
pour un prêt saisi manuellement. `codeDemande()` lit ce champ ; s'il est *absent* (source
qui ne le porte pas), il retombe sur `credit.id`, égal au code de la demande pour les prêts
issus du pipeline (`portfolio/services.py`, `reference=app.code`). S'il est *vide*, l'écran
affiche « aucune demande rattachée » au lieu d'appeler un endpoint avec une référence qui
ne désigne aucun dossier.

**Permissions (CLAUDE.md §7.2).** Aucun code de capacité RBAC n'a été inventé côté front :
l'endpoint de ré-analyse n'existant pas encore, sa permission n'est pas nommée. Le bouton
appelle l'endpoint protégé et l'écran affiche honnêtement un 403 s'il en reçoit un, sans
proposer d'alternative. Quand la permission sera définie côté serveur, un masquage
préalable du bouton pourra s'ajouter — il ne remplacera pas la vérification serveur.

**Validation de saisie.** Durée ≥ 1, différé ≥ 0, différé < durée, taux ≥ 0 : bloqués côté
UI avec message. Le serveur reste l'autorité ; ce n'est pas une règle métier dupliquée mais
un garde-fou de saisie (un différé égal à la durée ne produit aucun mois d'amortissement).

**Seuils.** Aucun seuil métier n'est codé (principe 8). Les deux constantes de ce chantier
sont des seuils d'affichage explicitement commentés : la tolérance sous laquelle un écart
n'est pas visible au nombre de décimales montré, et l'emphase ambre quand la phase
d'amortissement occupe moins de la moitié de la durée. Aucune décision n'en dépend.

**Envoi en `snake_case`.** `api.credits.reanalyser` attend `duree_mois`, `differe_mois`,
`taux_annuel`, `mode_differe` ; les réponses sont en camelCase (`dureeMois`, …). Le contrat
`api.ts` / `types/api.ts` n'a pas été touché.

**`parametres.modeDiffere`** n'existe pas dans `CreditAnalyse.parametres` (typé
`{dureeMois, differeMois, tauxAnnuel}`). Il est lu de façon défensive et affiché seulement
s'il est présent — sans quoi l'analyste ne peut pas savoir dans quel mode une analyse
passée a tourné. **À arbitrer avec le backend** : l'ajouter au contrat, ou accepter que le
mode ne soit pas restituable.

---

## 5. Ce que je n'ai pas pu vérifier

- **Aucune exécution navigateur.** `npx tsc --noEmit` sort 0 erreur et `npx vite build`
  est vert (2832 modules, build OK) — c'est tout ce qui protège un `.jsx`. Le rendu réel,
  la mise en page des trois onglets, le comportement du `Select` de mode et la lisibilité
  du tableau des essais n'ont **pas** été observés.
- **Aucun aller-retour serveur.** Le backend ne sert pas la route : ni le 200, ni la forme
  réelle de `CreditAnalyse`, ni l'orthographe exacte des phases (`différé` accentué ?
  `franchise` ?) n'ont été confrontés au réel. Le filtrage de phase tolère les variantes
  (`toLowerCase().startsWith('amort' | 'franchise')`), mais le libellé affiché dans le
  badge est la chaîne brute du serveur — un `differe` non accentué s'afficherait tel quel.
- **Chemin 403 non exercé** : rendu depuis le code, jamais déclenché.
- **`eslint`** signale `import/no-unresolved` sur `@/services/api` dans les deux fichiers
  qui l'importent — limitation pré-existante du résolveur (alias `@` vers un `.ts` depuis
  un `.jsx`), déjà présente avant ce chantier.

---

## 6. Ce qu'il reste à faire (dépend du backend)

1. Livrer `GET .../analyse/` et `POST .../reanalyser/` + permissions ; l'écran se remplit
   sans modification front.
2. Servir `modeDiffere` dans `parametres` (cf. §4).
3. Servir les totaux (coût du crédit, service de la dette) si on veut les afficher.
4. Implémenter le diagnostic §9.3 (« un différé de N mois porterait le DSCR à X ») : le
   composant a la place prévue et annonce déjà son absence.
5. Cas chiffré de non-régression à passer dans l'écran une fois le moteur branché :
   C = 1 330 USD, 18 %/an, D = 8, F = 5, `interets_seuls` → 8 lignes, 5 en différé à
   19,95 d'intérêts, service de la dette 1 469,65, DSCR 0,636, CRD final 0,00
   (SPEC annexe A.2). L'écart connu avec le simulateur Excel v4 (intérêts de 25 au lieu de
   19,95, annexe A.3) reste ouvert : il ne se voit pas depuis ce front.

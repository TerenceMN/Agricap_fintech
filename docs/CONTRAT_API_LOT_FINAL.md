# Contrat d'API — Lot final « tout à 100 % »

> Source de vérité PARTAGÉE entre les agents. Un agent backend qui doit dévier
> d'une forme décrite ici **met à jour ce fichier ET le signale** — jamais de
> changement silencieux (la divergence front/back typée qui a produit les
> défauts de la semaine vient précisément de là). Les noms de champs sont en
> `camelCase` dans les réponses JSON (le backend sérialise ainsi), `snake_case`
> tolérés en entrée.

## 1. Simulate — prise en compte du financement par module

`POST /api/credits/simulate/` — **ajout** d'un champ optionnel :

```jsonc
{
  "application_code": "CRED-…",        // inchangé, prime sur tout
  "module_financing": {                 // NOUVEAU, optionnel
    "semences": 90, "operations": 100, "main_doeuvre": 70
    // codes = MODULE_CODES (src/components/simulateur/modules.js), % entier 0..100
  }
}
```

Sémantique (principe 1 respecté) :
- Les **coûts** restent lus des `DataRecord` de la feuille — jamais du payload.
- La **part demandée** par module = `cout_fichier × pct/100`. Absent = 100 %.
- Le **montant demandé** scoré = `Σ parts demandées` (et non le total feuille).
  Le DSCR et l'échéancier se calculent sur ce montant demandé ajusté.
- Un module à 0 dans la feuille reste à 0 (aucun financement inventable).
- La réponse ajoute `moduleFinancing: [{module, coutFichier, pct, partDemandee}]`
  et `montantDemandeAjuste`.

**Fiabilité technique — correctif attendu** : `_score_fiabilite` renvoie
« Données insuffisantes » quand `ref_totals` est vide. Diagnostiquer et corriger
pour que, dès qu'un référentiel existe pour la filière, le score se calcule.
La fiabilité compare les **coûts fichier** au référentiel (inchangé par le
financement % — c'est le réalisme du coût, pas la part demandée). Si aucun
référentiel n'existe (filière hors-modèle), l'état reste explicitement
« non calculable » avec le motif — jamais un 50 muet.

## 2. Comité de crédit — décision collégiale à quorum

- `GET /api/credits/dashboard/?view=committee` — **existe**, corbeille.
- `GET /api/credits/applications/<code>/committee-votes/` — **NOUVEAU** :
  ```jsonc
  { "quorum": 3, "votes": [{ "voter", "decision": "approve|reject",
      "comment", "votedAt" }], "tally": {"approve": 2, "reject": 0},
    "resolved": false, "decision": null }
  ```
- `POST /api/credits/applications/<code>/committee-vote/` — **NOUVEAU** :
  body `{ "decision": "approve|reject", "comment": "…", "conditions?": "…" }`.
  Append-only (principe 3), un vote par membre (second vote du même membre = 409).
  Quorum lu de `InstitutionConfig`. Quorum atteint → transition via `workflow.py`
  (jamais d'écriture directe de `status`) + `audit_record` (PV). maker ≠ checker
  déjà en vigueur au décaissement.

## 3. Principe 11 — templates de fichiers versionnés (`dataio`)

- `GET /api/dataio/templates/` — liste, avec `active` (id/version courante).
  Résumé par ligne seulement (`sheetNames`, `rubriques`) — pas le schéma complet.
- `GET /api/dataio/templates/<pk>` — **NOUVEAU** : détail d'un template =
  schéma dérivé COMPLET (`schema.sheets[].columns/types/row_labels`) + `diff`
  calculé **côté serveur** + `diffBaseline: {id, version, relation}`.
  `relation="active"` si le template est `pending` (« qu'est-ce que change son
  activation ? » — la question du checker) ; `relation="supersedes"` s'il est
  `active`/`archived` (trace de ce qui a changé à SON activation).
  Sans cet endpoint le **checker** (≠ maker par construction) ne voyait le schéma
  et le diff que dans la réponse d'`upload` du maker, donc jamais au rechargement
  de l'écran : il activait à l'aveugle (CLAUDE.md §7.1.5). Le front ne recalcule
  jamais le diff.
- `POST /api/dataio/templates/upload` (maker) — `kind="TEMPLATE"`, SHA-256.
- `POST /api/dataio/templates/<id>/activate` (checker ≠ maker) — le précédent
  passe `archived`; le schéma attendu est **dérivé du template actif**.
- `GET /api/credits/needs-sheet-template/` — sert **exactement** le template
  actif (celui téléchargé = celui contre lequel on valide). Aucun template
  actif → refus `TEMPLATE_NOT_CONFIGURED`.
- La validation structurelle enregistre `templateId + version` utilisés.

## 4. Journal & audit (écran auditeur, lecture seule)

- `GET /api/audit/entries` — **existe**. Filtres attendus : `?dossier=&acteur=&
  etape=&depuis=&jusqu=`. Réponse liste + `totalRows` (troncature signalée,
  `?meta=1` pour l'obtenir dans le corps ; toujours en en-tête `X-Total-Rows`).
  Aucune écriture depuis cet écran.
- `GET /api/audit/export` — **NOUVEAU** : export CSV (BOM UTF-8) du journal filtré,
  **mêmes filtres** que `entries`, capacité `audit`, lecture seule. Contrairement à
  `entries` (plafonné à 500 pour l'affichage), l'export est **complet** sur le
  périmètre filtré — un auditeur obtient l'intégralité de ses lignes, jamais un
  sous-ensemble tronqué en silence. Colonne `Détails` = JSON brut de l'entrée
  (le code du dossier y vit, rien n'est perdu).

## 5. Barèmes (`BaremeScore`, comité)

- `GET /api/credits/baremes/` — courbes par critère (staff seulement).
- `POST /api/credits/baremes/<id>` — édition comité, avec prévisualisation
  d'impact sur le golden set AVANT activation. Append-only sur l'historique.

## 6. Analyse-resume client (principe 7)

- `GET /api/credits/applications/<code>/analyse-resume/` — **existe**, client-safe.
  Consommateur front à créer : score, lettre, pistes d'amélioration UNIQUEMENT.
  Jamais de barème, seuil, tolérance, plage, poids ni règle moteur.

## Garde-fous transverses (CLAUDE.md)

- Une seule nomenclature par concept (P6) : réutiliser les codes existants.
- `Decimal` côté serveur pour tout montant scoré (P4) ; zéro chiffre métier
  calculé côté client (les totaux viennent du serveur).
- Toute vue d'écriture porte une permission explicite ; toute décision, un motif.
- Un seul agent lance `makemigrations` par app Django.

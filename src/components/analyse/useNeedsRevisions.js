import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/services/api';

/**
 * Historique des dépôts de la feuille de besoins d'un dossier.
 *
 * Principe 3 (CLAUDE.md §3) : « l'écart entre deux analyses successives est
 * lui-même une donnée (signal de fraude potentiel — comparer les SHA-256) », et
 * §4.3 : « la TRAJECTOIRE est le signal, pas chaque révision isolée ». Sans cet
 * historique, l'onglet Analyse montre un instantané et l'analyste ne voit pas
 * qu'un client a re-déposé trois fois.
 *
 * Source unique : `GET /api/dataio/history?key=fb__<code>` (staff, `IsStaff`).
 * Rien n'est agrégé ni recalculé ici — le hook trie et normalise, c'est tout.
 */

/**
 * Clé de lignée d'un dossier, telle que le backend la construit
 * (`credits/needs_sheet.py::dataset_key_for` → `fb__<code>`).
 *
 * ⚠ Convention **recopiée** côté front faute de mieux : ni le contrat
 * `CreditAnalyse.lignage` ni `CreditApplication.needsSheet` ne portent le
 * `dataset_key`, alors que `needs_source_lineage()` le calcule déjà côté
 * serveur. Le jour où il est servi, cette fonction disparaît — une nomenclature
 * dupliquée est une dette (principe 6), pas un choix.
 */
export function datasetKeyDossier(code) {
  return code ? `fb__${code}` : '';
}

/**
 * Une entrée d'historique, normalisée depuis `_source_dict` (dataio/views.py).
 * Aucune clé n'est inventée : tout ce qui est lu ci-dessous est émis par le
 * serveur (`id`, `original_name`, `status`, `revision`, `is_current`,
 * `uploaded_at`, `committed_at`, `sha256`, `n_tables`, `supersedes`).
 *
 * `revision` n'a de sens que pour une source COMMITTED : le numéro est attribué
 * au commit (`dataio/services.py::commit`). Les dépôts refusés en validation
 * restent STAGED avec le `revision` par défaut — les afficher comme
 * « révision 1 » ferait croire à plusieurs révisions numéro 1. On les nomme donc
 * pour ce qu'ils sont : des tentatives non ingérées.
 */
function normaliser(source, precedente) {
  const sha = source?.sha256 ? String(source.sha256) : '';
  const shaPrecedente = precedente?.sha256 ? String(precedente.sha256) : '';
  return {
    id: source.id,
    nomFichier: source.original_name || '',
    statut: source.status || '',
    ingeree: source.status === 'COMMITTED',
    revision: source.status === 'COMMITTED' ? source.revision : null,
    estCourante: Boolean(source.is_current),
    deposeeLe: source.uploaded_at || null,
    ingereeLe: source.committed_at || null,
    sha256: sha,
    nTables: source.n_tables ?? 0,
    supersedes: source.supersedes ?? null,
    /**
     * Empreinte identique au dépôt chronologiquement précédent : le fichier est
     * bit à bit le même. Comparaison de deux chaînes servies par le serveur —
     * aucun calcul métier (principe « zéro chiffre métier calculé côté client »).
     * `null` quand l'une des deux empreintes manque : « inconnu » n'est pas
     * « différent ».
     */
    memeEmpreinteQuePrecedente:
      sha && shaPrecedente ? sha === shaPrecedente : null,
  };
}

/**
 * @param {string|null|undefined} code référence du dossier
 * @param {boolean} enabled ne charge que lorsque l'onglet Analyse est ouvert
 */
export function useNeedsRevisions(code, enabled = true) {
  const [revisions, setRevisions] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    setRevisions([]);
    setError(null);
    setLoaded(false);
  }, [code]);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.history(datasetKeyDossier(code));
      if (!alive.current) return;
      const brutes = Array.isArray(data) ? data : [];
      // Chronologie décroissante sur la date de DÉPÔT : c'est l'ordre dans
      // lequel le client a agi, tentatives refusées comprises. Trier sur
      // `revision` (l'ordre du serveur) rangerait tous les refus ensemble et
      // ferait disparaître la cadence des re-dépôts, qui est le signal.
      const triees = [...brutes].sort((a, b) => {
        const ta = Date.parse(a?.uploaded_at || '') || 0;
        const tb = Date.parse(b?.uploaded_at || '') || 0;
        if (tb !== ta) return tb - ta;
        return (b?.id ?? 0) - (a?.id ?? 0);
      });
      setRevisions(triees.map((s, i) => normaliser(s, triees[i + 1])));
    } catch (e) {
      if (!alive.current) return;
      setRevisions([]);
      setError(e);
    } finally {
      if (alive.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [code]);

  useEffect(() => {
    if (!enabled || !code || loaded || loading) return;
    load();
  }, [enabled, code, loaded, loading, load]);

  const status = error instanceof ApiError ? error.status : null;

  return {
    revisions,
    loading,
    error,
    loaded,
    /** Refus serveur — décision d'autorisation, jamais contournée côté front. */
    forbidden: status === 403,
    reload: load,
  };
}

export default useNeedsRevisions;

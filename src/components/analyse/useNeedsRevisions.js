import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/services/api';


/**
 * Clé de lignée dataio d'un dossier.
 *
 * REPLI, pas source de vérité. Le backend définit la convention
 * (`credits/needs_sheet.py::dataset_key_for`) et l'expose déjà dans
 * `needs_source_lineage` — mais le lignage de l'ANALYSE
 * (`analyse.py::serialiser`) ne le porte pas. Tant que ce n'est pas le cas, le
 * front doit recopier `fb__<code>` : une nomenclature backend dupliquée dans le
 * navigateur, contraire au principe 6, et qui casserait en silence le jour où
 * le serveur changerait de préfixe. La fonction est donc isolée ici, et
 * `useNeedsRevisions` préfère TOUJOURS la clé servie par le serveur quand elle
 * existe. Dette croisée à résorber côté backend, hors périmètre de ce lot.
 */
export function datasetKeyDossier(code) {
  return code ? `fb__${code}` : '';
}


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
    
    memeEmpreinteQuePrecedente:
      sha && shaPrecedente ? sha === shaPrecedente : null,
  };
}

/**
 * @param {string|null|undefined} code référence du dossier
 * @param {boolean} enabled ne charge que lorsque l'onglet Analyse est ouvert
 * @param {string|null|undefined} datasetKey clé de lignée servie par le serveur
 *        (`lignage.datasetKey`). Prioritaire sur la convention reconstruite.
 */
export function useNeedsRevisions(code, enabled = true, datasetKey = null) {
  const [revisions, setRevisions] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // La clé effective : celle du serveur si elle existe, sinon la convention.
  const cle = (datasetKey && String(datasetKey).trim()) || datasetKeyDossier(code);

  useEffect(() => {
    setRevisions([]);
    setError(null);
    setLoaded(false);
  }, [cle]);

  const load = useCallback(async () => {
    if (!cle) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.history(cle);
      if (!alive.current) return;
      const brutes = Array.isArray(data) ? data : [];
      
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
  }, [cle]);

  useEffect(() => {
    if (!enabled || !cle || loaded || loading) return;
    load();
  }, [enabled, cle, loaded, loading, load]);

  const status = error instanceof ApiError ? error.status : null;

  return {
    revisions,
    loading,
    error,
    loaded,
    
    forbidden: status === 403,
    reload: load,
  };
}

export default useNeedsRevisions;

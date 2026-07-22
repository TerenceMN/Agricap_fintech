import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/services/api';

/**

 * @param {string|null|undefined} code référence du dossier
 * @param {boolean} enabled ne charge que lorsque l'onglet a été ouvert
 */
export function useCreditAnalyse(code, enabled = true) {
  const [analyse, setAnalyse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    setAnalyse(null);
    setError(null);
    setLoaded(false);
  }, [code]);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.credits.analyse(code);
      if (!alive.current) return;
      setAnalyse(data);
    } catch (e) {
      if (!alive.current) return;
      setAnalyse(null);
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
    analyse,
    loading,
    error,
    loaded,
    /** Analyse jamais exécutée sur ce dossier — état vide explicite. */
    notAnalysed: status === 404,
    /** Refus serveur — décision d'autorisation, pas incident technique. */
    forbidden: status === 403,
   
    sessionExpiree: status === 401,
    reload: load,
    /** Remplace l'analyse par celle que le serveur vient de renvoyer (justification). */
    setAnalyse,
  };
}

export default useCreditAnalyse;

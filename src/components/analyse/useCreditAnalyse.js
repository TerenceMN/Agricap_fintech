import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/services/api';

/**
 * Chargement de l'analyse d'un dossier (`GET .../analyse/`).
 *
 * Le state vit ici et non dans l'onglet : Radix démonte le contenu d'un onglet
 * inactif, et on ne veut pas re-solliciter le moteur à chaque aller-retour
 * entre les onglets du modal.
 *
 * Distinction volontaire entre trois issues que l'UI ne doit pas confondre :
 *  - **404** : le moteur n'a pas encore tourné sur ce dossier. C'est l'état
 *    normal au début, un état vide — pas une panne, pas une erreur à afficher
 *    en rouge.
 *  - **403** : refus d'autorisation du serveur. Ce n'est pas une panne non plus,
 *    et le front ne le contourne pas.
 *  - le reste : erreur, restituée telle que le serveur l'a formulée.
 *
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

  // Nouveau dossier = tout est repris à zéro (aucune analyse d'un autre dossier
  // ne doit rester à l'écran une milliseconde).
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
    /**
     * Session expirée : `request()` a tenté un `refresh()` et rejoué une fois ;
     * un 401 qui ressort est une authentification morte, pas une panne du
     * moteur. Sans état dédié, il s'affichait sous « Analyse indisponible » —
     * un message qui désigne le mauvais coupable et fait attendre à l'analyste
     * une analyse qui n'est pas en cause.
     */
    sessionExpiree: status === 401,
    reload: load,
    /** Remplace l'analyse par celle que le serveur vient de renvoyer (justification). */
    setAnalyse,
  };
}

export default useCreditAnalyse;

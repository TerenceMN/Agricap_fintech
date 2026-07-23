import { useEffect, useState } from 'react';
import { api } from '@/services/api';

// Droits d'accès de l'espace comptable, résolus CÔTÉ SERVEUR (CLAUDE.md §7.2 : « toute action
// affichée = une permission vérifiée serveur »). Le socle `accounting` pose DEUX gardes cumulés
// sur chaque vue : `IsStaff` + une capacité (read / create / validate / config). On lit donc
// `api.me().is_staff` ET `api.rbac.me().capabilities` pour n'AFFICHER que ce que le serveur
// autorisera de toute façon — le serveur reste seul juge, mais on n'expose pas un bouton mort.
//
// Dégradation : si l'identité ne peut être résolue, on refuse tout (défaut fermé). Un bouton
// masqué à tort est un désagrément ; un bouton affiché à tort est une action fantôme.

const AUCUNE = { read: false, create: false, validate: false, config: false };

export function useAccountingAccess() {
  const [state, setState] = useState({ loading: true, isStaff: false, can: AUCUNE, error: null });

  useEffect(() => {
    let vivant = true;
    Promise.all([api.me(), api.rbac.me()])
      .then(([me, rbac]) => {
        if (!vivant) return;
        const caps = rbac?.capabilities || {};
        setState({
          loading: false,
          isStaff: Boolean(me?.is_staff),
          can: {
            read: Boolean(caps.read),
            create: Boolean(caps.create),
            validate: Boolean(caps.validate),
            config: Boolean(caps.config),
          },
          error: null,
        });
      })
      .catch((error) => {
        if (!vivant) return;
        setState({ loading: false, isStaff: false, can: AUCUNE, error });
      });
    return () => { vivant = false; };
  }, []);

  return state;
}

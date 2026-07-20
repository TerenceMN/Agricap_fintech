import React, { createContext, useContext, useEffect, useState } from 'react';
import { tokens, beginLogin, beginRegister, logout as oidcLogout } from '@/services/oidc';
import { api } from '@/services/api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/**
 * Authentification réelle déléguée à l'IdP AGRICAP (OIDC/PKCE).
 * Le profil (et le rôle) vient des claims du jeton — plus de rôle choisi ni de
 * session localStorage. La forme de `user` reste compatible avec le design
 * (name, role, realRole, impersonatedRole) pour ne rien casser dans le Layout.
 */
const AuthProvider = ({ children }) => {
  const [profile, setProfile] = useState(null);          // /me brut
  const [impersonatedRole, setImpersonatedRole] = useState(null);
  const [loading, setLoading] = useState(true);

  const [rbac, setRbac] = useState(null); // /api/rbac/me : capacités effectives (16 rôles)

  const loadProfile = async () => {
    if (!tokens.access) { setProfile(null); setRbac(null); setLoading(false); return; }
    try {
      const [me, rbacMe] = await Promise.all([
        api.me(),
        api.rbac.me().catch(() => null), // additif — ne bloque pas le profil si indisponible
      ]);
      setProfile(me);
      setRbac(rbacMe);
    } catch {
      // Jeton mort (expiré/invalide/compte disparu après re-seed) : on le PURGE
      // pour ne pas le réessayer en boucle → état déconnecté propre, prêt à relogin.
      tokens.clear();
      setProfile(null);
      setRbac(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProfile(); }, []);

  // Vue « user » attendue par le design (avatar, menus, badge impersonation).
  const user = profile ? {
    sub: profile.sub,
    email: profile.email,
    name: profile.full_name || profile.email || 'Utilisateur',
    realRole: profile.role,
    role: impersonatedRole || profile.role,
    impersonatedRole,
    is_staff: profile.is_staff,
    phone: profile.phone,
    farmer_id: profile.farmer_id,
    national_id: profile.national_id,
    company_name: profile.company_name,
    // Capacités RBAC (16 rôles, backend `rbac` app) — undefined tant que /rbac/me
    // n'a pas répondu (chargement ou erreur réseau), à traiter comme "aucune capacité".
    level: rbac?.level,
    zone: rbac?.zone,
    capabilities: rbac?.capabilities,
    isSupervisor: !!rbac?.isSupervisor,
    viewOverride: rbac?.viewOverride || '',
  } : null;

  const value = {
    user,
    loading,
    isAuthenticated: !!profile,
    login: () => beginLogin(),               // redirige vers l'IdP (login)
    register: () => beginRegister(),         // redirige vers l'IdP (création de compte)
    logout: () => { setProfile(null); oidcLogout(); },
    // Impersonation = vue locale (admin uniquement) ; n'affecte ni le jeton ni le backend.
    impersonate: (role) => {
      if (profile?.is_staff) setImpersonatedRole(role === 'admin' ? null : role);
    },
    refreshProfile: loadProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;

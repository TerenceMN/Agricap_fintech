import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleCallback } from '@/services/oidc';
import { useAuth } from '@/contexts/AuthContext.jsx';

// Reçoit le code de l'IdP, l'échange contre les jetons, charge le profil, puis route.
const AuthCallback = () => {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        await handleCallback();
        await refreshProfile();
        navigate('/', { replace: true });
      } catch (e) {
        setError(e?.message || 'Échec de la connexion.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center text-slate-200 bg-background">
      {error ? (
        <div className="text-center">
          <p className="text-red-400 mb-3">{error}</p>
          <button onClick={() => navigate('/login')} className="underline">Retour à la connexion</button>
        </div>
      ) : (
        <p>Connexion en cours…</p>
      )}
    </div>
  );
};

export default AuthCallback;

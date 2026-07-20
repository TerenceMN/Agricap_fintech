import React from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { LogIn, UserPlus } from 'lucide-react';

// Connexion et inscription déléguées à l'IdP AGRICAP (OIDC/PKCE). Aucun rôle choisi
// ni mot de passe saisi ici : l'IdP authentifie, le rôle vient des claims du jeton.
const Login = () => {
  const { isAuthenticated, loading, login, register } = useAuth();

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-300">Chargement…</div>;
  if (isAuthenticated) return <Navigate to="/" replace />;

  return (
    <>
      <Helmet><title>Connexion — AGRICAP FINTECH</title></Helmet>
      <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, type: 'spring' }}
          className="w-full max-w-md relative z-10"
        >
          <div className="bg-card/90 backdrop-blur-xl border border-white/5 rounded-2xl shadow-2xl p-8 text-center">
            <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-secondary items-center justify-center mb-4 shadow-lg shadow-primary/20">
              <span className="text-3xl font-bold text-white">A</span>
            </div>
            <h1 className="text-3xl font-bold gradient-text">AGRICAP FINTECH</h1>
            <p className="text-muted-foreground mt-2 mb-8 text-sm">
              Plateforme de services financiers — accès sécurisé via AGRICAP&nbsp;ID.
            </p>
            <button
              onClick={login}
              className="w-full flex items-center justify-center bg-gradient-to-r from-primary to-secondary text-white font-bold text-lg py-4 rounded-lg shadow-lg shadow-primary/20"
            >
              <LogIn className="w-5 h-5 mr-2" /> Se connecter avec AGRICAP&nbsp;ID
            </button>
            <button
              onClick={register}
              className="w-full flex items-center justify-center mt-3 border border-white/10 text-muted-foreground py-3 rounded-lg hover:bg-white/5"
            >
              <UserPlus className="w-5 h-5 mr-2" /> Créer un compte
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default Login;

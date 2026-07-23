/**
 * Page **Référentiel technico-économique** — `/credit/referentiel`.
 *
 * Ce que gap #3 appelle la « transparence des barèmes » : donner au personnel qui
 * instruit une vue directe sur les règles chiffrées du moteur, jusque-là servies
 * par l'API mais affichées nulle part. Quatre onglets, quatre référentiels de
 * l'app Django `referentiel` :
 *
 *   1. **Plages** — rendement/coût/prix bornés par chaîne (le cœur chiffré).
 *   2. **Filières** — le catalogue des 14 chaînes (non chiffré).
 *   3. **Configuration** — seuils, poids, taux, plafond de délégation.
 *   4. **Versions** — sous quelle version un dossier a été jugé.
 *
 * ⚠ ANTI-GAMING (principe 7). Plages, seuils, tolérances et poids sont du
 * référentiel chiffré : un client qui les voit construit un dossier pour franchir
 * la règle plutôt que pour décrire une exploitation. La page est donc réservée au
 * PERSONNEL. Deux gardes se superposent, la seconde seule fait autorité :
 *
 *   - garde d'affichage : `me.is_staff` (calculé PAR LE SERVEUR dans
 *     `accounts/views.py`, pas déduit du rôle localement) masque la page à un
 *     compte client — confort, pas sécurité ;
 *   - garde serveur : chaque endpoint `ranges/config/versions` est `IsStaff` et
 *     re-vérifie. Rappel : `HasCapability("read")` ne suffit PAS — client et
 *     investisseur portent `read=True` ; c'est le rôle interne qui ouvre la porte.
 *
 * Le front n'infère aucun droit : un refus vient du serveur (403) et est relayé
 * tel quel par chaque panneau.
 */
import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import type { Me } from '@/types/api';
import {
  ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import RangesPanel from '@/components/referentiel/RangesPanel';
import ChainsPanel from '@/components/referentiel/ChainsPanel';
import ConfigPanel from '@/components/referentiel/ConfigPanel';
import VersionsPanel from '@/components/referentiel/VersionsPanel';

type TabId = 'ranges' | 'chains' | 'config' | 'versions';

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: 'ranges', label: 'Plages', hint: 'Rendement, coût, prix bornés par chaîne' },
  { id: 'chains', label: 'Filières', hint: 'Catalogue des 14 chaînes de valeur' },
  { id: 'config', label: 'Configuration', hint: 'Seuils, poids, taux, plafond' },
  { id: 'versions', label: 'Versions', hint: 'Sous quelle version un dossier a été jugé' },
];

const Referentiel: React.FC = () => {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [tab, setTab] = useState<TabId>('ranges');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const profile = await api.me();
        if (alive) setMe(profile);
      } catch (e) {
        if (alive) setErrors(toFieldErrors(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="p-6"><Loading label="Vérification de vos habilitations…" /></div>;
  }

  if (!me) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Helmet><title>Référentiel — AGRICAP FINTECH</title></Helmet>
        <ErrorPanel errors={errors} title="Profil indisponible" />
        <Forbidden
          message="Impossible de vérifier votre profil."
          detail="Cet écran expose des référentiels chiffrés : il ne s'ouvre pas tant que l'identité de l'utilisateur n'est pas confirmée par le serveur."
        />
      </div>
    );
  }

  if (!me.is_staff) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Helmet><title>Référentiel — AGRICAP FINTECH</title></Helmet>
        <Forbidden
          message="Écran réservé au personnel."
          detail="Plages, seuils, tolérances et poids du référentiel ne sont jamais servis à un compte client : les connaître permettrait de construire un dossier pour franchir la règle plutôt que pour décrire une exploitation (principe 7)."
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 text-white">
      <Helmet><title>Référentiel — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Référentiel technico-économique</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            La référence chiffrée à laquelle le moteur situe chaque dossier : plages par chaîne,
            catalogue des filières, configuration de l'institution, historique des versions.
            Consultation réservée au personnel.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/credit/dossiers" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            File d'instruction
          </Link>
          <Link to="/credit/reference" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            Données de référence
          </Link>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-300">
        <p className="font-semibold text-slate-200">
          Connecté comme {me.full_name || me.email}
          <span className="ml-2 text-xs font-mono text-slate-500" title={me.sub}>{me.sub}</span>
        </p>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          Ces référentiels ne transitent que vers les comptes internes. Un client authentifié,
          bien qu'il porte la capacité <span className="font-mono">read</span>, se voit refuser
          plages, seuils et poids par le serveur (403) — l'asymétrie d'information est la première
          défense anti-gaming.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            title={t.hint}
            className={`px-4 py-2 rounded-lg text-sm transition ${
              tab === t.id
                ? 'bg-emerald-500/20 text-emerald-100 border border-emerald-500/40'
                : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ranges' && <RangesPanel />}
      {tab === 'chains' && <ChainsPanel />}
      {tab === 'config' && <ConfigPanel />}
      {tab === 'versions' && <VersionsPanel />}
    </div>
  );
};

export default Referentiel;

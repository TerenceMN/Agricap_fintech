/**
 * Écran **Données de référence** (admin) — `/credit/reference`.
 *
 * C'est l'écran où l'on change les règles sans redéployer, et où l'on peut
 * reconstituer qui les a changées. Quatre sections, quatre référentiels
 * distincts, un seul mécanisme commun : maker ≠ checker.
 *
 *   1. **Templates de fichiers** (principe 11) — le schéma de validation des
 *      fichiers client est dérivé du template ACTIF, jamais codé en dur.
 *   2. **Filières `ValueChain`** — cycles, coûts/ha, poids de modules, scores
 *      minimums : ce sur quoi le moteur juge un dossier.
 *   3. **Barèmes de score** (principe 8) — les courbes qui traduisent une
 *      grandeur mesurée en points, avec l'impact chiffré sur le golden set
 *      AVANT activation.
 *   4. **Versions du référentiel** technico-économique — sous quelle version un
 *      dossier a été jugé.
 *
 * Deux règles gouvernent tout l'écran :
 *
 * - **Anti-gaming (principe 7).** Barèmes, seuils, tolérances, plages et poids
 *   sont du référentiel chiffré. Un client qui les voit construit un dossier
 *   pour franchir la règle, pas pour décrire une exploitation. L'écran est donc
 *   réservé au personnel, et le serveur re-vérifie chaque appel — le garde
 *   d'affichage n'est qu'un confort, jamais la sécurité.
 * - **Le front n'infère aucun droit.** Les capacités affichées viennent de
 *   `/api/rbac/me` (le serveur les déclare) ; les refus viennent du serveur et
 *   sont relayés tels quels, avec leur code. Aucun bouton n'est activé sur une
 *   déduction locale de rôle.
 */
import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import type { Me, RbacMe } from '@/types/api';
import {
  ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { Note } from '@/components/credit/reference/Bits';
import TemplatesPanel from '@/components/credit/reference/TemplatesPanel';
import ValueChainsPanel from '@/components/credit/reference/ValueChainsPanel';
import BaremesPanel from '@/components/credit/reference/BaremesPanel';
import VersionsPanel from '@/components/credit/reference/VersionsPanel';

type TabId = 'templates' | 'chains' | 'baremes' | 'versions';

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: 'templates', label: 'Templates de fichiers', hint: 'Principe 11 — la règle de validation' },
  { id: 'chains', label: 'Filières', hint: 'Cycles, coûts, poids de modules' },
  { id: 'baremes', label: 'Barèmes de score', hint: 'Principe 8 — les règles vivent en base' },
  { id: 'versions', label: 'Versions du référentiel', hint: 'Sous quelle version un dossier a été jugé' },
];

const ReferenceData: React.FC = () => {
  const [me, setMe] = useState<Me | null>(null);
  const [rbac, setRbac] = useState<RbacMe | null>(null);
  const [rbacFailed, setRbacFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [tab, setTab] = useState<TabId>('templates');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const profile = await api.me();
        if (!alive) return;
        setMe(profile);
      } catch (e) {
        if (!alive) return;
        setErrors(toFieldErrors(e));
      }
      try {
        const r = await api.rbac.me();
        if (!alive) return;
        setRbac(r);
      } catch {
        // Additif : l'écran reste utilisable sans les capacités — il cesse
        // seulement d'annoncer à l'avance ce que le serveur refusera.
        if (alive) setRbacFailed(true);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="p-6"><Loading label="Vérification de vos habilitations…" /></div>;

  if (!me) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <ErrorPanel errors={errors} title="Profil indisponible" />
        <Forbidden
          message="Impossible de vérifier votre profil."
          detail="Cet écran expose des référentiels chiffrés : il ne s'ouvre pas tant que l'identité de l'utilisateur n'est pas confirmée par le serveur."
        />
      </div>
    );
  }

  // Garde d'affichage anti-gaming. `is_staff` est calculé PAR LE SERVEUR
  // (`accounts/views.py` → `is_staff_role`), ce n'est pas une déduction locale.
  if (!me.is_staff) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Helmet><title>Données de référence — AGRICAP FINTECH</title></Helmet>
        <Forbidden
          message="Écran réservé au personnel."
          detail="Barèmes, seuils, tolérances et plages du référentiel ne sont jamais servis à un compte client : les connaître permettrait de construire un dossier pour franchir la règle plutôt que pour décrire une exploitation."
        />
      </div>
    );
  }

  const canConfig: boolean | null = rbac ? !!rbac.capabilities?.config : null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 text-white">
      <Helmet><title>Données de référence — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Données de référence</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            Les règles du moteur vivent en base, pas dans le code : template de validation,
            filières, barèmes de score, versions du référentiel. Chaque changement suit le même
            cycle — un acteur propose, un second active — et laisse une trace nominative.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/credit/dossiers" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            File d'instruction
          </Link>
          <Link to="/credit/journal" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            Journal &amp; audit
          </Link>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-300">
        <p className="font-semibold text-slate-200 mb-1">
          Connecté comme {me.full_name || me.email}
          <span className="ml-2 text-xs font-mono text-slate-500" title={me.sub}>{me.sub}</span>
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">
          {rbac
            ? (
              <>
                Rôle serveur <span className="font-mono text-slate-300">{rbac.role}</span> ·
                capacité <span className="font-mono">config</span>{' '}
                {canConfig ? (
                  <span className="text-emerald-300">accordée</span>
                ) : (
                  <span className="text-amber-300">non accordée</span>
                )}
                . C'est votre <span className="font-mono">sub</span> ci-dessus qui détermine si une
                activation vous est ouverte : on n'active pas ce qu'on a soi-même proposé.
              </>
            )
            : (
              <>
                Vos capacités RBAC n'ont pas pu être lues : l'écran n'annonce donc pas à l'avance
                ce qui vous sera refusé. Les actions restent proposées et le serveur tranche.
              </>
            )}
        </p>
      </div>

      {rbacFailed && (
        <Note tone="warn">
          <span className="font-mono">/api/rbac/me</span> n'a pas répondu. Les boutons ne sont pas
          pré-désactivés : un refus, s'il vient, viendra du serveur avec son code.
        </Note>
      )}

      <ErrorPanel errors={errors} title="Avertissement" />

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

      {tab === 'templates' && <TemplatesPanel mySub={me.sub} canConfig={canConfig} />}
      {tab === 'chains' && <ValueChainsPanel mySub={me.sub} canConfig={canConfig} />}
      {tab === 'baremes' && <BaremesPanel mySub={me.sub} />}
      {tab === 'versions' && <VersionsPanel />}
    </div>
  );
};

export default ReferenceData;

/**
 * File d'instruction analyste — `/credit/dossiers`.
 *
 * Sert deux publics avec le même endpoint : `GET /api/credits/applications/`
 * filtre déjà par rôle côté serveur (`ViewContextService.filter_qs`) — un client
 * n'y voit que ses dossiers, un instructeur voit la file. Le front ne décide
 * donc jamais « qui voit quoi » : il présente ce que le serveur a bien voulu
 * servir.
 *
 * La file d'instruction agrège les trois statuts en attente d'un acte humain :
 * `submitted` (à prendre en charge), `in_analysis` (en cours), `adjourned`
 * (rouvert). L'API n'accepte qu'un statut par appel : trois requêtes parallèles,
 * pas de filtrage client sur une liste tronquée.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import type { CreditApplication } from '@/types/api';
import { Empty, ErrorPanel, Loading, toFieldErrors, type FieldError } from '@/components/backoffice/States';
import {
  ageInDays, consentState, fmtAmount, fmtDate, statusOf, STATUS_LABELS,
  type ConsentState,
} from './wire';

/** Statuts composant la file d'instruction (`_PENDING_ANALYSIS` côté backend). */
const QUEUE_STATUSES = ['submitted', 'in_analysis', 'adjourned'] as const;

/** `list_applications` coupe à `qs.order_by(...)[:100]`, sans compteur total. */
const SERVER_PAGE_CAP = 100;

type SortKey = 'age_desc' | 'age_asc' | 'amount_desc' | 'amount_asc';

const SORT_LABELS: Record<SortKey, string> = {
  age_desc: 'Ancienneté — les plus vieux d\'abord',
  age_asc: 'Ancienneté — les plus récents d\'abord',
  amount_desc: 'Montant — décroissant',
  amount_asc: 'Montant — croissant',
};

const CONSENT_BADGE: Record<ConsentState, { label: string; className: string } | null> = {
  none: null,
  given: null,
  pending: {
    label: 'Consentement client en attente',
    className: 'text-amber-200 bg-amber-500/20 border border-amber-500/40',
  },
  expired: {
    label: 'Consentement client expiré',
    className: 'text-red-200 bg-red-500/20 border border-red-500/40',
  },
};

/** Date de référence pour l'ancienneté : la soumission fait foi, la création à défaut. */
const referenceDate = (a: CreditApplication): string => a.submittedAt || a.createdAt;

const Applications: React.FC = () => {
  const [apps, setApps] = useState<CreditApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  /** '' = file d'instruction (3 statuts) ; sinon un statut unique. */
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('age_desc');
  const [consentOnly, setConsentOnly] = useState(false);
  const [maybeTruncated, setMaybeTruncated] = useState(false);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setErrors([]);
    try {
      const buckets = status ? [status] : [...QUEUE_STATUSES];
      const results = await Promise.all(
        buckets.map((s) => api.credits.list({ status: s })),
      );
      // Le serveur plafonne chaque appel à 100 lignes : si un seau est plein,
      // la file affichée est incomplète et doit le dire.
      setMaybeTruncated(results.some((r) => r.length >= SERVER_PAGE_CAP));
      setApps(results.flat());
    } catch (e) {
      setApps([]);
      setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(statusFilter); }, [load, statusFilter]);

  const rows = useMemo(() => {
    const filtered = consentOnly
      ? apps.filter((a) => {
        const s = consentState(a);
        return s === 'pending' || s === 'expired';
      })
      : apps;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'age_asc':
          return new Date(referenceDate(b)).getTime() - new Date(referenceDate(a)).getTime();
        case 'amount_desc':
          return (b.amountRequested ?? 0) - (a.amountRequested ?? 0);
        case 'amount_asc':
          return (a.amountRequested ?? 0) - (b.amountRequested ?? 0);
        case 'age_desc':
        default:
          return new Date(referenceDate(a)).getTime() - new Date(referenceDate(b)).getTime();
      }
    });
    return sorted;
  }, [apps, consentOnly, sortKey]);

  const consentAlerts = useMemo(
    () => apps.filter((a) => {
      const s = consentState(a);
      return s === 'pending' || s === 'expired';
    }).length,
    [apps],
  );

  /** Devises présentes : interdit d'additionner sans conversion journalisée. */
  const currencies = useMemo(
    () => Array.from(new Set(rows.map((a) => a.currency))).sort(),
    [rows],
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 text-white [&>option]:bg-slate-800 [&>option]:text-white">
      <Helmet><title>File d'instruction — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {statusFilter ? 'Dossiers de crédit' : "File d'instruction"}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {statusFilter
              ? `Statut « ${statusOf(statusFilter).label} ».`
              : 'Dossiers soumis, en analyse ou ajournés — en attente d\'un acte humain.'}
            {' '}Périmètre servi par le serveur selon votre rôle.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/credit/comite"
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
          >
            Corbeille du comité
          </Link>
          <Link
            to="/credit/actifs"
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
          >
            Vérification des actifs
          </Link>
          <Link
            to="/credit"
            className="bg-gradient-to-r from-emerald-500 to-blue-600 text-white font-semibold px-4 py-2 rounded-lg text-sm [&>option]:bg-slate-800 [&>option]:text-white"
          >
            + Nouvelle demande
          </Link>
        </div>
      </div>

      {/* Barre de filtres et de tri */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-wrap items-end gap-4">
        <label className="text-xs text-slate-400">
          Statut
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="block mt-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
          >
            <option value="">File d'instruction (soumis + analyse + ajournés)</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-400">
          Tri
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="block mt-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
          >
            {Object.entries(SORT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-300 pb-2">
          <input
            type="checkbox"
            checked={consentOnly}
            onChange={(e) => setConsentOnly(e.target.checked)}
            className="accent-amber-500"
          />
          Consentement manquant ou expiré uniquement
          {consentAlerts > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200">
              {consentAlerts}
            </span>
          )}
        </label>

        <button
          type="button"
          onClick={() => void load(statusFilter)}
          className="ml-auto px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
        >
          Rafraîchir
        </button>
      </div>

      <ErrorPanel errors={errors} title="Chargement de la file impossible" />

      {/* Compteurs — effectif explicite, aucune somme multi-devises */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
          {rows.length} dossier(s) affiché(s){consentOnly ? ` sur ${apps.length} chargé(s)` : ''}
        </span>
        {currencies.length > 0 && (
          <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
            Devise(s) : {currencies.join(', ')} — montants non agrégés (pas de conversion journalisée)
          </span>
        )}
        {maybeTruncated && (
          <span className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200">
            Liste possiblement tronquée : le serveur plafonne à {SERVER_PAGE_CAP} lignes par statut
            et ne renvoie pas de <code className="font-mono">total_rows</code>.
          </span>
        )}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="text-slate-400 border-b border-white/10">
            <tr>
              <th className="text-left p-4">Code</th>
              <th className="text-left p-4">Client</th>
              <th className="text-left p-4">Filière</th>
              <th className="text-right p-4">Montant demandé</th>
              <th className="text-center p-4">Statut</th>
              <th className="text-center p-4">Score</th>
              <th className="text-left p-4">Déposé le</th>
              <th className="text-right p-4">Ancienneté</th>
              <th className="p-4" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const st = statusOf(a.status);
              const badge = CONSENT_BADGE[consentState(a)];
              const days = ageInDays(referenceDate(a));
              const score = a.scoreResult?.score;
              return (
                <tr key={a.code} className="border-t border-white/5 hover:bg-white/5 transition-colors align-top">
                  <td className="p-4 font-mono text-xs text-emerald-300">
                    {a.code}
                    {badge && (
                      <span className={`block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded ${badge.className}`}>
                        {badge.label}
                      </span>
                    )}
                  </td>
                  <td className="p-4">
                    <span className="text-white [&>option]:bg-slate-800 [&>option]:text-white">{a.client?.displayName || '—'}</span>
                    {a.isOnBehalfOf && (
                      <span className="block text-[11px] text-slate-500">déposé pour le compte de</span>
                    )}
                  </td>
                  <td className="p-4 text-slate-300">{a.valueChain?.label ?? '—'}</td>
                  <td className="p-4 text-right font-semibold whitespace-nowrap">
                    {fmtAmount(a.amountRequested, a.currency)}
                  </td>
                  <td className="p-4 text-center">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.color}`}>{st.label}</span>
                  </td>
                  <td className="p-4 text-center">
                    {score != null ? (
                      <span className={`font-bold ${score >= 70 ? 'text-emerald-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {score}<span className="text-slate-500 font-normal">/100</span>
                      </span>
                    ) : <span className="text-slate-600">non scoré</span>}
                  </td>
                  <td className="p-4 text-slate-400 whitespace-nowrap">{fmtDate(referenceDate(a))}</td>
                  <td className={`p-4 text-right whitespace-nowrap ${days != null && days > 7 ? 'text-amber-300' : 'text-slate-400'}`}>
                    {days != null ? `${days} j` : '—'}
                  </td>
                  <td className="p-4 text-right">
                    <Link to={`/credit/dossiers/${a.code}`} className="text-primary text-xs underline">
                      Instruire
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {loading && <Loading label="Chargement de la file…" />}
        {!loading && rows.length === 0 && errors.length === 0 && (
          <Empty
            title={consentOnly
              ? 'Aucun dossier avec un consentement manquant ou expiré.'
              : 'Aucun dossier dans ce périmètre.'}
            hint={statusFilter
              ? 'Changez de statut ou retirez le filtre de consentement.'
              : 'La file d\'instruction est vide : rien n\'attend d\'acte humain.'}
          />
        )}
      </div>

      <p className="text-xs text-slate-500">
        Les actions possibles sur un dossier (prise en charge, approbation, rejet, ajournement,
        décaissement) sont décidées par le serveur et n'apparaissent que dans le détail du
        dossier — cet écran ne propose aucune action qu'il ne pourrait garantir.
      </p>
    </div>
  );
};

export default Applications;

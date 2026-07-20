/**
 * Journal & audit crédit — `/credit/journal`. LECTURE SEULE ABSOLUE.
 *
 * `GET /api/audit/entries` (`audit/views.py`), protégé par la capacité RBAC
 * `audit`. Aucun bouton d'écriture, aucune action mutante, aucun export
 * fabriqué côté client : cet écran consulte, point.
 *
 * Deux vérités désagréables que l'écran affiche plutôt que de les masquer :
 *
 * 1. **Le module `credits` n'écrit rien dans ce journal.** Aucun appel à
 *    `audit.services.record` n'existe dans `backend/credits/` : prise en charge,
 *    approbation, rejet, ajournement, demande et confirmation de décaissement
 *    ne laissent aucune trace ici. Seuls `assets.*` et `portfolio.*` alimentent
 *    le journal. Le `JournalValidation` append-only du principe 3 n'existe pas
 *    en base. Un auditeur ne peut donc PAS reconstituer une décision de crédit.
 *
 * 2. **Le filtre de période est client-side.** L'endpoint n'accepte ni `date_from`
 *    ni `date_to` et coupe à 500 lignes (`qs[:500]`) sans compteur total ni
 *    pagination. Filtrer une période dans le navigateur filtre donc les 500
 *    dernières entrées, pas la période : l'écran le dit explicitement.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { AUDIT_ROWS_CAP, fmtDateTime, type WireAuditEntry } from './wire';

/** Types d'entités réellement journalisées et pertinentes pour le crédit. */
const ENTITY_TYPES = [
  { value: '', label: 'Toutes les entités' },
  { value: 'Asset', label: 'Actif gageable (Asset)' },
  { value: 'Loan', label: 'Prêt décaissé (Loan)' },
  { value: 'LoanTransaction', label: 'Transaction de prêt' },
  { value: 'SavingsPlan', label: 'Plan d\'épargne (nantissement)' },
  { value: 'ClientWallet', label: 'Portefeuille client' },
  { value: 'JournalEntry', label: 'Écriture comptable' },
];

const AuditJournal: React.FC = () => {
  const [entries, setEntries] = useState<WireAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);

  // Filtres serveur
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [actor, setActor] = useState('');
  const [financialOnly, setFinancialOnly] = useState(false);
  // Filtre client (l'API n'accepte pas de bornes de date)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    try {
      const res = await api.audit.entries({
        entity_type: entityType || undefined,
        entity_id: entityId.trim() || undefined,
        actor: actor.trim() || undefined,
        category: financialOnly ? 'financial' : undefined,
      });
      setEntries(res as unknown as WireAuditEntry[]);
    } catch (e) {
      setEntries([]);
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(e.message);
      } else {
        setErrors(toFieldErrors(e));
      }
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, actor, financialOnly]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    if (!dateFrom && !dateTo) return entries;
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : -Infinity;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : Infinity;
    return entries.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return t >= from && t <= to;
    });
  }, [entries, dateFrom, dateTo]);

  const atCap = entries.length >= AUDIT_ROWS_CAP;
  const periodFiltered = Boolean(dateFrom || dateTo);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 text-white [&>option]:bg-slate-800 [&>option]:text-white">
      <Helmet><title>Journal & audit — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Journal &amp; audit</h1>
          <p className="text-sm text-slate-400 mt-1">
            Consultation du journal des opérations. Écran en lecture seule : aucune action
            mutante n'y est proposée.
          </p>
        </div>
        <Link to="/credit/dossiers" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
          File d'instruction
        </Link>
      </div>

      {/* Avertissement de couverture — sans lui, l'écran laisserait croire que
          l'absence de trace vaut absence d'événement. */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-100">
        <p className="font-semibold mb-1">Couverture réelle de ce journal</p>
        <p className="text-amber-100/80 leading-relaxed">
          Le module d'instruction du crédit <strong>n'écrit rien dans ce journal</strong> :
          prise en charge, approbation, rejet, ajournement et décaissement d'un dossier
          n'y laissent aucune trace. Seuls les actifs (<code className="font-mono">assets.*</code>)
          et le portefeuille (<code className="font-mono">portfolio.*</code>) y sont journalisés.
          Une absence de ligne sur un dossier ne signifie donc pas qu'il ne s'est rien passé.
        </p>
      </div>

      {/* Filtres */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-slate-400">
            Type d'entité
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="block mt-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-400">
            Identifiant d'entité (dossier, référence de prêt, id d'actif)
            <input
              type="text"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="ex. : 42 ou LN-2026-0007"
              className="block mt-1 w-56 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
            />
          </label>

          <label className="text-xs text-slate-400">
            Acteur (sub IdP)
            <input
              type="text"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="sub de l'utilisateur"
              className="block mt-1 w-56 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-300 pb-2">
            <input
              type="checkbox"
              checked={financialOnly}
              onChange={(e) => setFinancialOnly(e.target.checked)}
              className="accent-emerald-500"
            />
            Opérations financières uniquement
          </label>

          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
          >
            Appliquer
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-white/10">
          <label className="text-xs text-slate-400">
            Du
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="block mt-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
            />
          </label>
          <label className="text-xs text-slate-400">
            Au
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="block mt-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
            />
          </label>
          {periodFiltered && (
            <button
              type="button"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
            >
              Effacer la période
            </button>
          )}
          <p className="text-[11px] text-amber-300/90 max-w-xl">
            Le filtre de période s'applique dans le navigateur : l'API n'accepte pas de bornes
            de date et ne renvoie que les {AUDIT_ROWS_CAP} entrées les plus récentes du filtre
            serveur. Une période ancienne peut donc paraître vide alors qu'elle ne l'est pas.
          </p>
        </div>
      </div>

      {loading && <Loading label="Chargement du journal…" />}

      {!loading && forbidden && (
        <Forbidden
          message="Journal d'audit réservé aux profils disposant de la capacité « audit »."
          detail={forbidden}
        />
      )}

      {!loading && !forbidden && (
        <>
          <ErrorPanel errors={errors} title="Chargement du journal impossible" />

          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              {rows.length} entrée(s) affichée(s)
              {periodFiltered && ` sur ${entries.length} servie(s) par le serveur`}
            </span>
            {atCap && (
              <span className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200">
                Plafond serveur atteint : {AUDIT_ROWS_CAP} entrées renvoyées, sans
                <code className="font-mono"> total_rows </code>ni pagination. Affinez les filtres.
              </span>
            )}
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th className="text-left p-4">Horodatage</th>
                  <th className="text-left p-4">Acteur</th>
                  <th className="text-left p-4">Rôle</th>
                  <th className="text-left p-4">Action</th>
                  <th className="text-left p-4">Entité</th>
                  <th className="text-left p-4">Détails</th>
                  <th className="text-left p-4">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-t border-white/5 hover:bg-white/5 align-top">
                    <td className="p-4 text-slate-300 whitespace-nowrap">{fmtDateTime(e.timestamp)}</td>
                    <td className="p-4">
                      <span className="text-white [&>option]:bg-slate-800 [&>option]:text-white">{e.userName || e.user || 'Système'}</span>
                      {e.user && e.userName && e.userName !== e.user && (
                        <span className="block font-mono text-[10px] text-slate-500">{e.user}</span>
                      )}
                    </td>
                    <td className="p-4 text-slate-400">{e.role || '—'}</td>
                    <td className="p-4 font-mono text-xs text-emerald-300">{e.action}</td>
                    <td className="p-4 text-slate-300 whitespace-nowrap">
                      {e.entityType || '—'}
                      {e.entityId && <span className="block font-mono text-[10px] text-slate-500">#{e.entityId}</span>}
                    </td>
                    <td className="p-4 text-slate-400 max-w-md">
                      {e.details && Object.keys(e.details).length > 0 ? (
                        <pre className="whitespace-pre-wrap break-words text-[11px] font-mono">
                          {JSON.stringify(e.details, null, 1)}
                        </pre>
                      ) : '—'}
                    </td>
                    <td className="p-4 text-slate-500 font-mono text-[11px]">{e.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {rows.length === 0 && errors.length === 0 && (
              <Empty
                title="Aucune entrée pour ces filtres."
                hint={periodFiltered
                  ? 'La période demandée peut être hors des dernières entrées servies : élargissez ou retirez les bornes.'
                  : 'Rappel : les décisions de crédit ne sont pas journalisées ici.'}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AuditJournal;

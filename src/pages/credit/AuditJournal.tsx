/**
 * Journal & audit crédit — `/credit/journal`. LECTURE SEULE ABSOLUE.
 *
 * `GET /api/audit/entries` et `GET /api/audit/export` (`audit/views.py`), tous
 * deux protégés par la capacité RBAC `audit`. Aucun bouton d'écriture, aucune
 * action mutante, aucune suppression : cet écran consulte, point. L'export
 * lui-même est un GET — il produit un fichier, il ne touche à rien.
 *
 * ── Ce qui a changé, et pourquoi ce fichier n'affirme plus l'inverse ──────────
 * Ce commentaire portait deux avertissements devenus faux, et les afficher plus
 * longtemps aurait été pire que de ne rien dire :
 *
 *   1. « le module `credits` n'écrit rien dans ce journal ». Il écrit désormais :
 *      `workflow._audit_transition` (soumission, prise en charge, approbation,
 *      rejet, ajournement, réouverture, consentement client),
 *      `guarantees._audit` (désignation du garant, consentement, constitution),
 *      `analyse`, `committee`, `disbursement`, `baremes`, `needs_sheet`. La liste
 *      d'étapes ci-dessous est relue une par une dans `backend/credits/`.
 *   2. « le filtre de période est client-side ». `_apply_filters` accepte
 *      `depuis` / `jusqu` (date ou datetime ISO, borne haute inclusive au jour),
 *      ainsi que `dossier` et `etape`. Les cinq filtres du contrat §4 sont
 *      SERVEUR : filtrer une période filtre bien la période, plus les 500
 *      dernières lignes.
 *
 * ── L'honnêteté d'affichage, qui est le vrai sujet de cet écran ──────────────
 * `entries` est plafonné à 500 lignes ; `export` est COMPLET sur le même
 * périmètre. Les deux passent par la même sérialisation de filtres
 * (`api.ts::auditQuery`), donc le CSV porte exactement ce qui est à l'écran —
 * ni plus, ni moins.
 *
 * Reste une asymétrie que l'écran expose au lieu de la taire : `api.audit.entries`
 * renvoie la liste nue, sans le total. Le serveur le connaît (en-tête
 * `X-Total-Rows`, corps avec `?meta=1`) mais le contrat ne le remonte pas. Tant
 * qu'il ne le fera pas, l'écran raisonne ainsi :
 *   - 500 lignes rendues ⇒ le périmètre en compte AU MOINS 500, et la liste est
 *     très probablement coupée : c'est dit, en rouge, sans attendre l'export ;
 *   - après un export, `totalRows` est connu et affiché tel quel — c'est le seul
 *     chiffre exact dont l'écran dispose, et il permet de recouper.
 * Un auditeur qui croit tout voir alors qu'il voit 500 lignes tire de fausses
 * conclusions ; c'est le seul risque que cet écran doit absolument écarter.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { AlertTriangle, Download, Lock } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import type { AuditFilters } from '@/types/api';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { AUDIT_ROWS_CAP, fmtDateTime, type WireAuditEntry } from './wire';

/** Types d'entités réellement journalisées et pertinentes pour le crédit. */
const ENTITY_TYPES = [
  { value: '', label: 'Toutes les entités' },
  { value: 'CreditApplication', label: 'Dossier de crédit' },
  { value: 'CreditGuarantee', label: 'Garantie / caution' },
  { value: 'Asset', label: 'Actif gageable (Asset)' },
  { value: 'Loan', label: 'Prêt décaissé (Loan)' },
  { value: 'LoanTransaction', label: 'Transaction de prêt' },
  { value: 'SavingsPlan', label: 'Plan d\'épargne (nantissement)' },
  { value: 'ClientWallet', label: 'Portefeuille client' },
  { value: 'JournalEntry', label: 'Écriture comptable' },
];

/**
 * Étapes proposées en suggestion — le filtre serveur est une SOUS-CHAÎNE
 * (`action__icontains`), donc `credits.workflow` attrape les sept transitions et
 * `credits.` attrape tout le module. Ces valeurs sont relues dans
 * `backend/credits/` ; la saisie reste libre, la liste n'est qu'un raccourci.
 *
 * Noter l'irrégularité de nommage, conservée telle quelle parce qu'elle est dans
 * les données : les garanties écrivent `credit.` au singulier, tout le reste
 * `credits.` au pluriel. Un filtre `credits.` manque donc les garanties.
 */
const ETAPE_SUGGESTIONS = [
  'credits.workflow.submit',
  'credits.workflow.start_analysis',
  'credits.workflow.approve',
  'credits.workflow.reject',
  'credits.workflow.adjourn',
  'credits.workflow.reopen_analysis',
  'credits.workflow.client_consent',
  'credits.analyse.execute',
  'credits.analyse.justifier',
  'credits.committee.vote',
  'credits.committee.resolved',
  'credits.disbursement.request',
  'credits.disbursement.confirm',
  'credits.disbursement.cancel',
  'credits.needs_sheet.validated',
  'credits.bareme.propose',
  'credits.bareme.activate',
  'credit.guarantee.guarantor_designated',
  'credit.guarantee.consent_accepted',
  'credit.guarantee.consent_declined',
  'credit.guarantee.constituted',
];

const AuditJournal: React.FC = () => {
  const [entries, setEntries] = useState<WireAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);

  // Filtres du contrat §4 — tous serveur, aucun repli navigateur.
  const [dossier, setDossier] = useState('');
  const [acteur, setActeur] = useState('');
  const [etape, setEtape] = useState('');
  const [depuis, setDepuis] = useState('');
  const [jusqu, setJusqu] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [financialOnly, setFinancialOnly] = useState(false);

  // `applied` : les filtres RÉELLEMENT servis. Séparés de la saisie en cours pour
  // que le bouton d'export ne parte jamais avec un périmètre que l'écran n'affiche
  // pas encore — c'est toute la garantie « le CSV porte ce que vous voyez ».
  const [applied, setApplied] = useState<AuditFilters>({});
  const [exporting, setExporting] = useState(false);
  const [exportErrors, setExportErrors] = useState<FieldError[]>([]);
  const [exportTotal, setExportTotal] = useState<number | null>(null);

  const draft = useMemo<AuditFilters>(() => ({
    dossier: dossier.trim() || undefined,
    acteur: acteur.trim() || undefined,
    etape: etape.trim() || undefined,
    depuis: depuis || undefined,
    jusqu: jusqu || undefined,
    entity_type: entityType || undefined,
    entity_id: entityId.trim() || undefined,
    category: financialOnly ? 'financial' : undefined,
  }), [dossier, acteur, etape, depuis, jusqu, entityType, entityId, financialOnly]);

  const load = useCallback(async (filters: AuditFilters) => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    // Un total obtenu pour un autre périmètre serait un mensonge : il meurt avec lui.
    setExportTotal(null);
    setExportErrors([]);
    try {
      const res = await api.audit.entries(filters);
      setEntries(res as unknown as WireAuditEntry[]);
    } catch (e) {
      setEntries([]);
      if (e instanceof ApiError && e.status === 403) setForbidden(e.message);
      else setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load({}); }, [load]);

  const apply = useCallback(() => {
    setApplied(draft);
    void load(draft);
  }, [draft, load]);

  const reset = useCallback(() => {
    setDossier(''); setActeur(''); setEtape(''); setDepuis(''); setJusqu('');
    setEntityType(''); setEntityId(''); setFinancialOnly(false);
    setApplied({});
    void load({});
  }, [load]);

  /** Export CSV — MÊMES filtres que la vue courante, via la même sérialisation. */
  const doExport = useCallback(async () => {
    setExporting(true);
    setExportErrors([]);
    try {
      const { totalRows } = await api.audit.export(applied);
      setExportTotal(totalRows);
    } catch (e) {
      setExportErrors(toFieldErrors(e));
    } finally {
      setExporting(false);
    }
  }, [applied]);

  const activeFilters = useMemo(
    () => Object.entries(applied).filter(([, v]) => v !== undefined && v !== ''),
    [applied],
  );
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(applied),
    [draft, applied],
  );
  /** 500 lignes rendues : le serveur a coupé, ou s'est arrêté pile au plafond. */
  const atCap = entries.length >= AUDIT_ROWS_CAP;
  /** Troncature CERTAINE : l'export a compté plus de lignes que l'écran n'en rend. */
  const provenTruncated = exportTotal !== null && exportTotal > entries.length;

  const inputCls =
    'block mt-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 text-white">
      <Helmet><title>Journal &amp; audit — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Journal &amp; audit</h1>
          <p className="text-sm text-slate-400 mt-1 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            Écran de l'auditeur, en lecture seule absolue : aucune écriture, aucune
            correction, aucune suppression n'y est possible.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/credit/garanties" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            Suivi des garanties
          </Link>
          <Link to="/credit/dossiers" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            File d'instruction
          </Link>
        </div>
      </div>

      {/* Couverture réelle — remplace l'ancien avertissement, devenu faux. */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-300">
        <p className="font-semibold text-white mb-1">Ce que ce journal couvre</p>
        <p className="text-slate-400 leading-relaxed">
          Les transitions du crédit y sont tracées (<code className="font-mono">credits.workflow.*</code>,{' '}
          <code className="font-mono">credits.analyse.*</code>,{' '}
          <code className="font-mono">credits.committee.*</code>,{' '}
          <code className="font-mono">credits.disbursement.*</code>,{' '}
          <code className="font-mono">credit.guarantee.*</code>), aux côtés des actifs
          (<code className="font-mono">assets.*</code>) et du portefeuille
          (<code className="font-mono">portfolio.*</code>). Le code du dossier vit dans
          <code className="font-mono"> details.applicationCode</code> — c'est sur lui que porte
          le filtre « dossier », et il est conservé dans l'export.
        </p>
      </div>

      {/* Filtres — les cinq du contrat §4, tous serveur. */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-slate-400">
            Dossier (code)
            <input
              type="text"
              value={dossier}
              onChange={(e) => setDossier(e.target.value)}
              placeholder="ex. : CRED-2026-0042"
              className={`${inputCls} w-52`}
            />
          </label>

          <label className="text-xs text-slate-400">
            Acteur (sub IdP)
            <input
              type="text"
              value={acteur}
              onChange={(e) => setActeur(e.target.value)}
              placeholder="sub de l'utilisateur"
              className={`${inputCls} w-56`}
            />
          </label>

          <label className="text-xs text-slate-400">
            Étape (sous-chaîne de l'action)
            <input
              type="text"
              list="audit-etapes"
              value={etape}
              onChange={(e) => setEtape(e.target.value)}
              placeholder="ex. : approve, guarantee, disbursement"
              className={`${inputCls} w-64`}
            />
            <datalist id="audit-etapes">
              {ETAPE_SUGGESTIONS.map((a) => <option key={a} value={a} />)}
            </datalist>
          </label>

          <label className="text-xs text-slate-400">
            Du
            <input type="date" value={depuis} onChange={(e) => setDepuis(e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs text-slate-400">
            Au (jour inclus)
            <input type="date" value={jusqu} onChange={(e) => setJusqu(e.target.value)} className={inputCls} />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-4 pt-3 border-t border-white/10">
          <label className="text-xs text-slate-400">
            Type d'entité
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className={inputCls}>
              {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>

          <label className="text-xs text-slate-400">
            Identifiant d'entité
            <input
              type="text"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="ex. : CRED-2026-0042, 42"
              className={`${inputCls} w-52`}
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

          <div className="ml-auto flex items-end gap-2">
            <button
              type="button"
              onClick={reset}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
            >
              Réinitialiser
            </button>
            <button
              type="button"
              onClick={apply}
              className={`px-3 py-2 rounded-lg text-sm ${
                dirty
                  ? 'bg-emerald-500/25 border border-emerald-500/40 text-emerald-100 hover:bg-emerald-500/35'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              Appliquer
            </button>
          </div>
        </div>

        {dirty && (
          <p className="text-[11px] text-amber-300/90">
            Filtres modifiés mais non appliqués : le tableau et l'export portent encore le
            périmètre précédent. Cliquez « Appliquer ».
          </p>
        )}
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

          {/* Effectif, troncature, export : les trois se lisent ensemble. */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              {entries.length} entrée(s) affichée(s)
              {exportTotal !== null && (
                <> sur <strong className="text-white">{exportTotal}</strong> dans le périmètre
                (compté par le dernier export)</>
              )}
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              Périmètre : {activeFilters.length === 0
                ? 'aucun filtre — tout le journal'
                : activeFilters.map(([k, v]) => `${k} = ${String(v)}`).join(' · ')}
            </span>

            <button
              type="button"
              onClick={() => void doExport()}
              disabled={exporting}
              className="ml-auto px-3 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-100 text-sm hover:bg-emerald-500/30 disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              {exporting ? 'Export en cours…' : 'Exporter le CSV du périmètre'}
            </button>
          </div>

          <ErrorPanel errors={exportErrors} title="Export refusé par le serveur" />

          {/* Le message central de l'écran : ce que vous voyez ≠ ce qui existe. */}
          {(atCap || provenTruncated) && (
            <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 text-sm text-red-100">
              <p className="font-semibold mb-1 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                Vous ne voyez pas tout le périmètre
              </p>
              <p className="text-red-100/85 leading-relaxed">
                {provenTruncated ? (
                  <>
                    Le périmètre filtré compte <strong>{exportTotal}</strong> entrées ; le tableau
                    n'en affiche que <strong>{entries.length}</strong> (plafond serveur de{' '}
                    {AUDIT_ROWS_CAP} lignes). Ne concluez rien de l'absence d'une ligne à l'écran.
                  </>
                ) : (
                  <>
                    Le tableau atteint le plafond serveur de {AUDIT_ROWS_CAP} lignes : le périmètre
                    filtré en compte au moins autant, et très probablement davantage. Affinez les
                    filtres (période, dossier, étape) ou exportez le CSV, qui est complet.
                  </>
                )}
              </p>
            </div>
          )}

          {exportTotal !== null && !provenTruncated && (
            <p className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 rounded-lg px-4 py-3 text-sm">
              Export terminé : {exportTotal} ligne(s) — soit exactement le périmètre affiché.
              Le fichier reprend les mêmes filtres, et le détail JSON complet de chaque entrée.
            </p>
          )}

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
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-white/5 hover:bg-white/5 align-top">
                    <td className="p-4 text-slate-300 whitespace-nowrap">{fmtDateTime(e.timestamp)}</td>
                    <td className="p-4">
                      <span className="text-white">{e.userName || e.user || 'Système'}</span>
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

            {entries.length === 0 && errors.length === 0 && (
              <Empty
                title="Aucune entrée pour ces filtres."
                hint="Les filtres sont appliqués par le serveur : un résultat vide signifie qu'aucune entrée du journal ne correspond, pas qu'elle serait hors des dernières lignes servies."
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AuditJournal;

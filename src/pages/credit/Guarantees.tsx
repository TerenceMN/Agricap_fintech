/**
 * Suivi des garanties (staff) — `/credit/garanties`. CLAUDE.md §7.1 point 7.
 *
 * Le parcours du GARANT existe (`/credits/garanties`, `MesCautions`) : il montre
 * à une personne les demandes qui l'engagent. Le personnel, lui, n'avait aucune
 * vue d'ensemble — impossible de savoir combien de cautions attendent une
 * réponse, lesquelles arrivent à échéance, lesquelles attendent un agent. C'est
 * ce que cet écran répare, en cinq files de travail.
 *
 * ── D'où viennent les données ─────────────────────────────────────────────────
 * D'un seul appel : `GET /api/credits/applications/`. Le sérialiseur de la liste
 * (`workflow.serialize_application`) embarque déjà `get_guarantee_summary` pour
 * chaque dossier — items ET couverture. Il n'existe pas d'endpoint « toutes les
 * garanties » côté serveur, et `GET /credits/guarantee-requests/` ne sert QUE
 * les cautions dont l'appelant est le garant désigné (le serveur filtre sur
 * `guarantor == request.user`, admin compris) : il est donc inutilisable ici.
 *
 * ── Les deux limites de périmètre, affichées et non masquées ──────────────────
 *   1. `list_applications` coupe à `qs.order_by("-created_at")[:100]` et ne sert
 *      aucun `total_rows`. Au-delà de cent dossiers, des garanties existent que
 *      cet écran ne voit pas — et il ne peut même pas dire combien.
 *   2. La liste est filtrée par rôle (`ViewContextService.filter_qs`) : ce n'est
 *      pas l'institution qu'on voit, c'est le périmètre de l'utilisateur.
 * Les décomptes des onglets portent donc sur ce périmètre-là, et le disent.
 *
 * ── Principe 9 : « toute garantie est opposable ou n'est pas » ────────────────
 * La colonne « Montant retenu » n'affiche JAMAIS une valeur déclarée. Elle lit le
 * champ que le serveur a arrêté selon le type (`retainedAmountOf`), et affiche
 * « non arrêté » quand il n'y en a pas. La valeur déclarée d'un gage apparaît en
 * second plan, explicitement libellée comme déclarative. Aucun total n'est
 * recomposé ici : la couverture d'un dossier est celle que le serveur a calculée
 * sur les seules garanties constituées.
 *
 * Aucun chiffre métier n'est calculé côté client. Les seules dérivations sont le
 * rangement en files (par statut serveur), le tri par échéance et le décompte de
 * lignes affichées — tous présentés comme tels.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext.jsx';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import ConsentCountdown from '@/components/guarantees/ConsentCountdown';
import { guaranteeConfig } from '@/components/guarantees/guaranteeConfig';
import { formatMontant, formatRatio } from '@/components/guarantees/format';
import { fmtDateTime, statusOf } from './wire';
import {
  APPLICATIONS_CAP, QUEUES, byUrgency, canInstruct, decisionAt, declaredAmountOf,
  isConfirmable, isReleasable, queueOf, retainedAmountOf, statusMeta,
  toGuaranteeRows,
  type GuaranteeRow, type GuaranteeSourceApplication, type GuaranteeTypeCode,
  type QueueId,
} from './guaranteesWire';

const TYPE_FILTERS: Array<{ value: '' | GuaranteeTypeCode; label: string }> = [
  { value: '', label: 'Tous les types' },
  { value: 'epargne', label: 'Nantissement épargne' },
  { value: 'morale', label: 'Caution solidaire' },
  { value: 'materiel', label: 'Gage matériel' },
  { value: 'foncier', label: 'Hypothèque / foncier' },
];

/** Clé stable d'une ligne : l'id de garantie est unique en base. */
const rowKey = (row: GuaranteeRow) => `${row.applicationCode}#${row.guarantee.id}`;

const Guarantees: React.FC = () => {
  const auth = useAuth() as unknown as {
    user?: { role?: string; realRole?: string } | null;
  } | null;
  // `realRole` et non `role` : l'impersonation change l'affichage, pas ce que le
  // serveur autorisera. Masquer un bouton reste une politesse, pas une sécurité.
  const instructing = canInstruct(auth?.user?.realRole || auth?.user?.role);

  const [apps, setApps] = useState<GuaranteeSourceApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const [queue, setQueue] = useState<QueueId>('consent');
  const [typeFilter, setTypeFilter] = useState<'' | GuaranteeTypeCode>('');
  const [search, setSearch] = useState('');

  // Action en cours et confirmation en deux temps (une libération ne se défait pas).
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    try {
      const res = await api.credits.list();
      setApps(res as unknown as GuaranteeSourceApplication[]);
    } catch (e) {
      setApps([]);
      if (e instanceof ApiError && e.status === 403) setForbidden(e.message);
      else setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => toGuaranteeRows(apps), [apps]);

  /** Effectifs par file — sur le périmètre chargé, jamais présentés comme un total
   *  institution (cf. la double limite documentée en tête de fichier). */
  const counts = useMemo(() => {
    const acc: Record<QueueId, number> = {
      consent: 0, confirm: 0, release: 0, called: 0, closed: 0,
    };
    for (const row of rows) acc[queueOf(row.guarantee.status)] += 1;
    return acc;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((r) => queueOf(r.guarantee.status) === queue)
      .filter((r) => !typeFilter || r.guarantee.type === typeFilter)
      .filter((r) => {
        if (!needle) return true;
        const haystack = [
          r.applicationCode, r.clientName, r.guarantee.guarantorName || '',
          r.guarantee.guarantorPhone || '', r.guarantee.asset?.name || '',
          r.valueChainLabel || '',
        ].join(' ').toLowerCase();
        return haystack.includes(needle);
      })
      .sort(byUrgency);
  }, [rows, queue, typeFilter, search]);

  const runAction = useCallback(
    async (row: GuaranteeRow, action: 'confirm' | 'release') => {
      const key = rowKey(row);
      setBusyKey(key);
      setActionErrors([]);
      setNotice(null);
      try {
        if (action === 'confirm') {
          await api.credits.confirmGuarantee(row.applicationCode, row.guarantee.id);
          setNotice(`Garantie #${row.guarantee.id} constituée sur ${row.applicationCode}.`);
        } else {
          await api.credits.releaseGuarantee(row.applicationCode, row.guarantee.id);
          setNotice(`Garantie #${row.guarantee.id} libérée sur ${row.applicationCode}.`);
        }
        setArmed(null);
        // La réponse ne porte que le `guarantees` du dossier touché : on recharge
        // la liste plutôt que de recoller un état partiel dans celui d'à côté.
        await load();
      } catch (e) {
        // 403, 409, 410, 422 : le refus serveur s'affiche tel quel, avec son code
        // métier. Le front ne le reformule pas et ne le pré-juge pas.
        setActionErrors(toFieldErrors(e));
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const queueMeta = QUEUES.find((q) => q.id === queue);
  const atCap = apps.length >= APPLICATIONS_CAP;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5 text-white">
      <Helmet><title>Suivi des garanties — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400" aria-hidden="true" />
            Suivi des garanties
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Cautions en attente du consentement de leur garant, garanties à constituer,
            libérations et cautions appelées.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Recharger
          </button>
          <Link to="/credit/dossiers" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            File d'instruction
          </Link>
        </div>
      </div>

      {/* Périmètre réel — sans ce bandeau, les décomptes des onglets se lisent
          comme des totaux institution, ce qu'ils ne sont pas. */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-100">
        <p className="font-semibold mb-1 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          Périmètre de cette vue
        </p>
        <p className="text-amber-100/80 leading-relaxed">
          Il n'existe pas d'endpoint « toutes les garanties » : cette vue est reconstituée
          depuis les dossiers que <strong>votre rôle</strong> peut lire, et le serveur en sert
          au plus {APPLICATIONS_CAP} (les plus récents), sans compteur total.
          {atCap && (
            <>
              {' '}<strong className="text-amber-200">
                Ce plafond est atteint : des garanties plus anciennes existent et ne sont pas
                comptées ci-dessous.
              </strong>
            </>
          )}
          {' '}Les effectifs des onglets décrivent ce périmètre, pas l'institution.
        </p>
      </div>

      {loading && <Loading label="Chargement des garanties…" />}

      {!loading && forbidden && (
        <Forbidden
          message="Lecture des dossiers de crédit refusée pour votre rôle."
          detail={forbidden}
        />
      )}

      {!loading && !forbidden && (
        <>
          <ErrorPanel errors={errors} title="Chargement des dossiers impossible" />

          {/* Files de travail */}
          <div className="flex flex-wrap gap-2">
            {QUEUES.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => { setQueue(q.id); setArmed(null); }}
                aria-pressed={queue === q.id}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                  queue === q.id
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                {q.label}
                <span className="ml-2 text-xs tabular-nums opacity-80">{counts[q.id]}</span>
              </button>
            ))}
          </div>

          {queueMeta && (
            <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">{queueMeta.hint}</p>
          )}

          {/* Filtres locaux — appliqués aux lignes déjà chargées, pas au serveur. */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-wrap items-end gap-4">
            <label className="text-xs text-slate-400">
              Type de garantie
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as '' | GuaranteeTypeCode)}
                className="block mt-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
              >
                {TYPE_FILTERS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400 flex-1 min-w-[16rem]">
              Rechercher (dossier, client, garant, actif, filière)
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ex. : CRED-2026-0042, Kabila, tracteur"
                className="block mt-1 w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
            <p className="text-[11px] text-slate-500 max-w-xs">
              Ces deux filtres s'appliquent dans le navigateur, sur les lignes déjà chargées —
              ils ne rouvrent pas le périmètre annoncé ci-dessus.
            </p>
          </div>

          <ErrorPanel errors={actionErrors} title="Le serveur a refusé cette action" />
          {notice && (
            <p className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 rounded-lg px-4 py-3 text-sm">
              {notice}
            </p>
          )}

          <div className="text-xs text-slate-400">
            <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              {visible.length} garantie(s) affichée(s) sur {counts[queue]} dans cette file
            </span>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th className="text-left p-4">Garantie</th>
                  <th className="text-left p-4">Dossier</th>
                  <th className="text-left p-4">Garant / support</th>
                  <th className="text-left p-4">Montant retenu</th>
                  <th className="text-left p-4">Échéance du consentement</th>
                  <th className="text-left p-4">Horodatage</th>
                  {instructing && <th className="text-left p-4">Action</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const g = row.guarantee;
                  const key = rowKey(row);
                  const cfg = guaranteeConfig(g.type);
                  // `guaranteeConfig` est en JS et annote son icône `Function` :
                  // on rétablit ici le type réel (une icône lucide), sans toucher
                  // au module partagé.
                  const Icon = cfg.icon as React.ComponentType<{
                    className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean | 'true';
                  }>;
                  const meta = statusMeta(g.status);
                  const retained = retainedAmountOf(row);
                  const declared = declaredAmountOf(row);
                  const decision = decisionAt(row);
                  const appStatus = statusOf(row.applicationStatus);
                  const busy = busyKey === key;

                  return (
                    <tr key={key} className="border-t border-white/5 hover:bg-white/5 align-top">
                      {/* Type canonique + statut serveur */}
                      <td className="p-4">
                        <div className="flex items-start gap-2">
                          <span
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `${cfg.color}20` }}
                          >
                            <Icon className="w-4 h-4" style={{ color: cfg.color }} aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-white">{cfg.label}</p>
                            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full border text-[10px] ${meta.className}`}>
                              {meta.label}
                            </span>
                            <p className="font-mono text-[10px] text-slate-500 mt-1">
                              #{g.id} · {g.type}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Dossier et couverture serveur */}
                      <td className="p-4">
                        <Link
                          to={`/credit/dossiers/${row.applicationCode}`}
                          className="font-mono text-emerald-300 hover:underline"
                        >
                          {row.applicationCode}
                        </Link>
                        <p className="text-slate-300 mt-1">{row.clientName}</p>
                        <p className="text-[11px] text-slate-500">
                          {row.valueChainLabel || 'Filière non rattachée'}
                        </p>
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] ${appStatus.color}`}>
                          {appStatus.label}
                        </span>
                        {row.coverage && (
                          <p className="text-[11px] text-slate-500 mt-1">
                            Couverture du dossier :{' '}
                            {formatMontant(row.coverage.retainedTotal, row.coverage.currency)}
                            {' · '}{formatRatio(row.coverage.ratio)}
                          </p>
                        )}
                      </td>

                      {/* Garant (morale) ou support du gage */}
                      <td className="p-4 text-slate-300">
                        {g.type === 'morale' && (
                          <>
                            <p className="text-white">{g.guarantorName || '—'}</p>
                            <p className="text-[11px] text-slate-500">{g.guarantorPhone || '—'}</p>
                            {g.consentChannel && (
                              <p className="text-[11px] text-slate-500">
                                Réponse reçue par {g.consentChannel}
                              </p>
                            )}
                            {!g.guarantorSub && (
                              <p className="text-[11px] text-amber-300/80 mt-1">
                                Aucun compte garant lié : caution déclarative antérieure au
                                consentement opposable.
                              </p>
                            )}
                          </>
                        )}
                        {(g.type === 'materiel' || g.type === 'foncier') && (
                          <>
                            <p className="text-white">{g.asset?.name || '—'}</p>
                            <p className="text-[11px] text-slate-500">
                              {g.asset?.category || '—'} · actif {g.asset?.status || '—'}
                            </p>
                          </>
                        )}
                        {g.type === 'epargne' && (
                          <>
                            <p className="text-white">Plan d'épargne nanti</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {g.holdReference || '—'}
                            </p>
                          </>
                        )}
                      </td>

                      {/* Principe 9 : la valeur retenue, jamais la valeur déclarée. */}
                      <td className="p-4">
                        {retained.value === null ? (
                          <p className="text-amber-300/90">
                            Montant retenu non arrêté
                            <span className="block text-[11px] text-slate-500 mt-0.5">
                              Le serveur n'a pas encore fixé de valeur opposable — rien n'est
                              couvert, et la valeur déclarée ne s'y substitue pas.
                            </span>
                          </p>
                        ) : (
                          <p className="text-emerald-300 font-semibold">
                            {formatMontant(retained.value, retained.currency)}
                          </p>
                        )}
                        <p className="text-[11px] text-slate-500 mt-1">{retained.basis}</p>
                        {declared.value !== null && (
                          <p className="text-[11px] text-slate-600 mt-1">
                            Valeur déclarée par le client :{' '}
                            {formatMontant(declared.value, declared.currency)} — non opposable.
                          </p>
                        )}
                      </td>

                      {/* Fenêtre de consentement du garant */}
                      <td className="p-4">
                        {g.type === 'morale' && g.status === 'pending_consent' ? (
                          <>
                            <ConsentCountdown expiresAt={g.consentExpiresAt} audience="staff" />
                            {g.isConsentExpired && (
                              <p className="text-[11px] text-red-300/90 mt-1">
                                Fenêtre écoulée selon le serveur : la caution ne peut plus être
                                constituée, le garant doit être désigné à nouveau.
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>

                      {/* Horodatages servis, jamais recalculés */}
                      <td className="p-4 text-slate-400 whitespace-nowrap">
                        <p className="text-[11px] text-slate-500">Désignation</p>
                        <p>{fmtDateTime(g.createdAt)}</p>
                        {decision.at && (
                          <>
                            <p className="text-[11px] text-slate-500 mt-2">{decision.label}</p>
                            <p>{fmtDateTime(decision.at)}</p>
                          </>
                        )}
                        {g.holdReleasedAt && (
                          <>
                            <p className="text-[11px] text-slate-500 mt-2">Libération</p>
                            <p>{fmtDateTime(g.holdReleasedAt)}</p>
                          </>
                        )}
                      </td>

                      {instructing && (
                        <td className="p-4 space-y-2">
                          {isConfirmable(row) && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void runAction(row, 'confirm')}
                              className="w-full px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs hover:bg-emerald-500/30 disabled:opacity-50"
                            >
                              {busy ? 'En cours…' : 'Constituer'}
                            </button>
                          )}
                          {isReleasable(row) && (
                            armed === key ? (
                              <div className="space-y-1">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void runAction(row, 'release')}
                                  className="w-full px-3 py-1.5 rounded-lg bg-red-500/25 border border-red-500/50 text-red-100 text-xs hover:bg-red-500/35 disabled:opacity-50"
                                >
                                  {busy ? 'En cours…' : 'Confirmer la libération'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setArmed(null)}
                                  className="w-full px-3 py-1.5 rounded-lg bg-white/10 text-slate-300 text-xs hover:bg-white/20"
                                >
                                  Annuler
                                </button>
                                <p className="text-[10px] text-red-300/80 leading-snug">
                                  Une libération ne se défait pas : la garantie cesse de couvrir
                                  le dossier et l'actif ou l'épargne redevient disponible.
                                </p>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => { setArmed(key); setActionErrors([]); }}
                                className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-slate-200 text-xs hover:bg-white/20"
                              >
                                Libérer
                              </button>
                            )
                          )}
                          {!isConfirmable(row) && !isReleasable(row) && (
                            <span className="text-[11px] text-slate-500">
                              Aucune action à ce statut
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {visible.length === 0 && errors.length === 0 && (
              <Empty
                title="Aucune garantie dans cette file."
                hint={
                  rows.length === 0
                    ? 'Aucun dossier lisible par votre rôle ne porte de garantie.'
                    : 'Changez de file, élargissez les filtres, ou rappelez-vous que le périmètre est plafonné.'
                }
              />
            )}
          </div>

          {!instructing && (
            <p className="text-xs text-slate-500">
              Votre rôle ne dispose pas de la capacité d'instruction : cet écran vous est servi
              en consultation. Constitution et libération sont gardées côté serveur
              (<code className="font-mono">CAN_INSTRUCT</code>), pas seulement masquées ici.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default Guarantees;

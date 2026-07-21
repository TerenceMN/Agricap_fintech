/**
 * Section 3 — **Barèmes de score** (principe 8 : les règles vivent en base).
 *
 * Une courbe de barème traduit une grandeur mesurée (DSCR, écart technique,
 * couverture des garanties) en un score sur 100. Elle n'est pas dans le code :
 * elle est en base, éditable par le comité de crédit sans redéploiement. Le
 * cycle est maker-checker et append-only (`BaremeRevision`) :
 *
 *   1. un membre du comité PROPOSE une révision — rien n'est activé ;
 *   2. le serveur calcule et FIGE l'impact de cette courbe sur le golden set
 *      (les dernières analyses réelles, `credits/baremes.py::previsualiser_impact`) ;
 *   3. un SECOND membre active — le barème bascule, le précédent est archivé.
 *
 * Ce que cet écran ne fait pas, et c'est le point central : il ne calcule aucun
 * score, aucun delta, aucune bascule de recommandation. Tous les chiffres
 * affichés ici viennent du serveur, y compris ceux de la simulation. Un impact
 * recalculé dans le navigateur ne serait pas celui qui s'appliquera : le
 * principe 1 (« ce qui est scoré est ce qui est en base ») vaut aussi pour la
 * simulation d'un recalibrage.
 *
 * Backend : `credits/views.py` (`list_baremes`, `bareme_detail`, `bareme_preview`,
 * `bareme_activate`), `credits/baremes.py`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/services/api';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { Btn, Card, CardHead, MakerChecker, Note, Pill } from './Bits';
import {
  BAREME_ABSCISSE, BAREME_PORTEE, GOLDEN_SET_CAP, REVISION_STATUS_LABELS, fmtDateTime, fmtNum,
  fmtRaw, fmtSigned, isForbidden, labelOf, shortSub,
  type BaremeListResponse, type BaremeRevisionRow, type BaremeRow, type CurvePoint,
  type ImpactPreview,
} from './wire';

interface Props {
  /** `sub` de l'utilisateur connecté — rend maker ≠ checker lisible. */
  mySub: string;
}

/** Ligne de l'éditeur de courbe : les valeurs restent des CHAÎNES du saisi à
 *  l'envoi. Les convertir en `number` ferait passer un `Decimal` métier par un
 *  flottant JavaScript, exactement ce que le principe 4 interdit — le serveur
 *  accepte les chaînes et les relit en `Decimal`. */
interface DraftPoint {
  x: string;
  y: string;
}

function toDraft(points: CurvePoint[] | undefined): DraftPoint[] {
  return (points ?? []).map((p) => ({ x: String(p.x ?? ''), y: String(p.y ?? '') }));
}

const BaremesPanel: React.FC<Props> = ({ mySub }) => {
  const [data, setData] = useState<BaremeListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    try {
      const res = await api.credits.baremes.list();
      setData(res);
      setSelected((prev) => (prev && res.baremes.some((b) => b.code === prev)
        ? prev
        : res.baremes[0]?.code ?? ''));
    } catch (e) {
      setData(null);
      if (isForbidden(e)) setForbidden(e.message);
      else setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const baremes = data?.baremes ?? [];
  const bareme = baremes.find((b) => b.code === selected) ?? null;

  if (forbidden) {
    return (
      <Forbidden
        message="Barèmes de score réservés au personnel (principe 7 : anti-gaming)."
        detail={forbidden}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Barèmes de score — les règles vivent en base"
          subtitle="Ces courbes traduisent une grandeur mesurée en points de score. Les modifier change la façon dont TOUS les dossiers seront notés : c'est pourquoi la proposition et l'activation sont deux actes, exercés par deux personnes différentes."
          right={<Btn onClick={() => void load()} busy={loading}>Rafraîchir</Btn>}
        />
        <div className="p-4">
          <Note tone="warn">
            Écran strictement interne. Un barème, un seuil ou une tolérance visible par un
            client rendrait le score jouable : le dossier serait construit pour franchir la
            règle plutôt que pour décrire une exploitation (principe 7).
          </Note>
        </div>
      </Card>

      <ErrorPanel errors={errors} title="Action refusée par le serveur" />
      {notice && <Note tone="ok">{notice}</Note>}

      {loading && <Card><Loading label="Chargement des barèmes…" /></Card>}

      {!loading && baremes.length === 0 && errors.length === 0 && (
        <Card>
          <Empty
            title="Aucun barème en base."
            hint="Sans barème, le moteur retombe sur ses valeurs de secours codées en dur — situation à corriger par un import (commande de seed), pas depuis cet écran."
          />
        </Card>
      )}

      {!loading && baremes.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {baremes.map((b) => (
              <button
                key={b.code}
                type="button"
                onClick={() => setSelected(b.code)}
                className={`px-3 py-2 rounded-lg text-sm border transition ${
                  b.code === selected
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-100'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                }`}
              >
                <span className="font-mono text-xs">{b.code}</span>
                <span className="ml-2 text-xs text-slate-400">v{b.version}</span>
                {b.pendingRevision && (
                  <span className="ml-2 text-[11px] text-amber-300">• révision en attente</span>
                )}
              </button>
            ))}
          </div>

          {bareme && (
            <BaremeDetail
              key={bareme.code}
              bareme={bareme}
              mySub={mySub}
              onChanged={(msg) => { setNotice(msg); void load(); }}
              onError={(errs) => { setNotice(''); setErrors(errs); }}
            />
          )}

          <p className="text-xs text-slate-500">
            {data?.totalRows ?? baremes.length} barème(s) en base.
          </p>
        </>
      )}
    </div>
  );
};

// ── Détail d'un barème : courbe active, révision en attente, proposition ──────

const BaremeDetail: React.FC<{
  bareme: BaremeRow;
  mySub: string;
  onChanged: (message: string) => void;
  onError: (errors: FieldError[]) => void;
}> = ({ bareme, mySub, onChanged, onError }) => {
  const courbe = bareme.type === 'courbe';
  const pending = bareme.pendingRevision;

  const [draft, setDraft] = useState<DraftPoint[]>(() => toDraft(bareme.points));
  const [params, setParams] = useState<string>(
    () => JSON.stringify(bareme.parametres ?? {}, null, 2),
  );
  const [paramsError, setParamsError] = useState<string>('');
  const [comment, setComment] = useState('');
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'propose' | 'activate'>('');

  /** Contenu proposé, dans la forme attendue par le serveur. Les valeurs sont
   *  transmises telles que saisies : aucune normalisation numérique côté front. */
  const payload = useCallback((): { points?: CurvePoint[]; parametres?: Record<string, unknown> } => {
    if (courbe) return { points: draft.map((p) => ({ x: p.x, y: p.y })) };
    const parsed = JSON.parse(params) as Record<string, unknown>;
    return { parametres: parsed };
  }, [courbe, draft, params]);

  /** Le JSON des paramètres est le seul contrôle fait ici : il porte sur la
   *  FORME du texte saisi, pas sur la règle métier — celle-ci est validée par
   *  `credits/baremes.py::valider_contenu`, côté serveur. */
  const checkParams = useCallback((): boolean => {
    if (courbe) return true;
    try {
      const parsed: unknown = JSON.parse(params);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParamsError('Les paramètres doivent former un objet JSON ({ … }).');
        return false;
      }
      setParamsError('');
      return true;
    } catch (e) {
      setParamsError(`JSON invalide : ${(e as Error).message}`);
      return false;
    }
  }, [courbe, params]);

  const doPreview = useCallback(async () => {
    if (!checkParams()) return;
    setBusy('preview');
    setPreview(null);
    onError([]);
    try {
      const res = await api.credits.baremes.preview(bareme.code, payload());
      setPreview(res);
    } catch (e) {
      onError(toFieldErrors(e));
    } finally {
      setBusy('');
    }
  }, [bareme.code, checkParams, payload, onError]);

  const doPropose = useCallback(async () => {
    if (!checkParams()) return;
    setBusy('propose');
    onError([]);
    try {
      const res = await api.credits.baremes.propose(bareme.code, {
        ...payload(),
        comment: comment.trim(),
      });
      setPreview(null);
      setComment('');
      onChanged(
        `Révision v${res.version} du barème ${bareme.code} proposée. `
        + 'Son impact est figé ; son activation revient à un second membre du comité.',
      );
    } catch (e) {
      onError(toFieldErrors(e));
    } finally {
      setBusy('');
    }
  }, [bareme.code, checkParams, comment, payload, onChanged, onError]);

  const doActivate = useCallback(async (rev: BaremeRevisionRow) => {
    setBusy('activate');
    onError([]);
    try {
      const res = await api.credits.baremes.activateRevision(rev.id);
      onChanged(
        `Révision v${res.version} du barème ${bareme.code} activée. `
        + 'Elle s\'applique désormais à toute nouvelle analyse ; la précédente est archivée.',
      );
    } catch (e) {
      // 409 `MAKER_CHECKER_VIOLATION` / `BAREME_REVISION_ETAT`, 403 hors comité :
      // messages serveur relayés tels quels.
      onError(toFieldErrors(e));
    } finally {
      setBusy('');
    }
  }, [bareme.code, onChanged, onError]);

  const commentManquant = comment.trim().length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title={`${bareme.code} — ${bareme.libelle ?? 'sans libellé'}`}
          subtitle={BAREME_PORTEE[bareme.code] ?? 'Portée non documentée pour ce code de barème.'}
          right={(
            <>
              <Pill
                label={bareme.actif ? 'Actif' : 'Inactif'}
                color={bareme.actif
                  ? 'text-emerald-300 bg-emerald-500/20'
                  : 'text-slate-400 bg-slate-500/20'}
              />
              <Pill label={`v${bareme.version}`} color="text-slate-300 bg-white/10" />
              <Pill
                label={bareme.type === 'courbe' ? 'Courbe' : 'Règles'}
                color="text-slate-300 bg-white/10"
              />
            </>
          )}
        />
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-500">
            Dernière modification : {fmtDateTime(bareme.updatedAt)}
            {BAREME_ABSCISSE[bareme.code] && (
              <span className="ml-3 text-slate-400">{BAREME_ABSCISSE[bareme.code]}</span>
            )}
          </p>
          {courbe
            ? <PointsTable points={bareme.points} title="Courbe active" />
            : <ParamsBlock parametres={bareme.parametres} title="Règles actives" />}
        </div>
      </Card>

      {pending && (
        <Card className="ring-1 ring-amber-500/40">
          <CardHead
            title={`Révision v${pending.version} en attente d'activation`}
            subtitle="C'est la décision du checker. Tout ce qu'il faut pour la prendre est ci-dessous : ce qui est proposé, par qui, et l'impact chiffré de ce changement sur les dossiers réels."
            right={(
              <Pill
                label={labelOf(REVISION_STATUS_LABELS, pending.status).label}
                color={labelOf(REVISION_STATUS_LABELS, pending.status).color}
              />
            )}
          />
          <div className="p-4 space-y-4">
            <MakerChecker
              makerSub={pending.proposedBySub}
              makerLabel={shortSub(pending.proposedBySub)}
              isSelf={!!mySub && pending.proposedBySub === mySub}
              extra={`le ${fmtDateTime(pending.proposedAt)}`}
            />

            <div className="text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-1">
                Motif de la proposition
              </p>
              {pending.comment
                ? <p className="text-slate-200">{pending.comment}</p>
                : (
                  <Note tone="warn">
                    Aucun motif n'accompagne cette proposition. Le serveur ne l'exige pas
                    aujourd'hui ; un changement de règle de scoring sans motif écrit n'est
                    pourtant pas reconstituable par un auditeur.
                  </Note>
                )}
            </div>

            {courbe
              ? <PointsTable points={pending.points} title="Courbe proposée" tone="proposed" />
              : <ParamsBlock parametres={pending.parametres} title="Règles proposées" />}

            {pending.impactPreview
              ? (
                <ImpactView
                  impact={pending.impactPreview}
                  frozenAt={pending.proposedAt}
                />
              )
              : (
                <Note tone="warn">
                  Cette révision ne porte pas d'impact figé : elle est antérieure au calcul
                  de prévisualisation. Activer sans cette information, c'est activer à
                  l'aveugle — demandez une nouvelle proposition plutôt qu'une activation.
                </Note>
              )}

            <div className="flex items-center gap-3 flex-wrap">
              <Btn
                tone="primary"
                onClick={() => void doActivate(pending)}
                busy={busy === 'activate'}
                disabled={!!mySub && pending.proposedBySub === mySub}
                title={mySub && pending.proposedBySub === mySub
                  ? 'Maker ≠ checker : l’activation revient à un autre membre du comité.'
                  : 'Activer cette révision — elle devient la règle de scoring.'}
              >
                Activer la révision v{pending.version}
              </Btn>
              <span className="text-xs text-slate-500">
                L'activation est réservée au comité de crédit ; le serveur re-vérifie
                l'appartenance et le maker ≠ checker.
              </span>
            </div>
          </div>
        </Card>
      )}

      {!pending && (
        <Card>
          <CardHead
            title="Proposer une révision (maker)"
            subtitle="La proposition n'active rien. Le serveur calcule l'impact sur le golden set et le fige avec la révision ; un second membre du comité décide ensuite."
          />
          <div className="p-4 space-y-4">
            {courbe
              ? <CurveEditor draft={draft} onChange={setDraft} />
              : (
                <div className="space-y-2">
                  <label className="text-xs text-slate-400 block">
                    Paramètres (seuils de décision, grille de lettres) — JSON
                  </label>
                  <textarea
                    value={params}
                    onChange={(e) => { setParams(e.target.value); setParamsError(''); }}
                    rows={12}
                    spellCheck={false}
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 font-mono text-xs text-slate-200"
                  />
                  {paramsError && <Note tone="warn">{paramsError}</Note>}
                  <Note>
                    Les clés attendues sont celles que lit `credits.analyse` (seuils de
                    recommandation, bornes de lettres). Le contenu est validé par le serveur
                    (<span className="font-mono">BAREME_CONTENU_INVALIDE</span>) : cet écran ne
                    juge que la syntaxe JSON.
                  </Note>
                </div>
              )}

            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">
                Motif de la proposition (ce qui justifie le recalibrage)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Ex. : recalibrage de la courbe DSCR après 40 dossiers clôturés sur la filière maïs."
                className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm text-slate-200"
              />
              {commentManquant && (
                <p className="text-[11px] text-amber-300/90">
                  Motif requis par cet écran. Le serveur, lui, accepte une proposition sans
                  motif : c'est une faiblesse du contrat, pas une garantie sur laquelle
                  s'appuyer.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Btn onClick={() => void doPreview()} busy={busy === 'preview'}>
                Prévisualiser l'impact
              </Btn>
              <Btn
                tone="primary"
                onClick={() => void doPropose()}
                busy={busy === 'propose'}
                disabled={commentManquant}
                title={commentManquant ? 'Renseignez le motif de la proposition.' : undefined}
              >
                Proposer la révision
              </Btn>
              <Btn
                onClick={() => {
                  setDraft(toDraft(bareme.points));
                  setParams(JSON.stringify(bareme.parametres ?? {}, null, 2));
                  setPreview(null);
                  setParamsError('');
                }}
              >
                Repartir de la version active
              </Btn>
            </div>

            {preview && (
              <ImpactView
                impact={preview}
                title="Impact simulé de la courbe saisie (rien n'est enregistré)"
              />
            )}
          </div>
        </Card>
      )}

      {bareme.revisions && bareme.revisions.length > 0 && (
        <Card>
          <CardHead
            title="Historique des révisions"
            subtitle="Append-only : une révision n'est jamais modifiée ni supprimée, seulement archivée. C'est ce qui permet de savoir sous quel barème un dossier a été scoré."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th className="text-left p-3">Version</th>
                  <th className="text-center p-3">Statut</th>
                  <th className="text-left p-3">Proposée par (maker)</th>
                  <th className="text-left p-3">Décidée par (checker)</th>
                  <th className="text-left p-3">Motif</th>
                </tr>
              </thead>
              <tbody>
                {bareme.revisions.map((r) => {
                  const st = labelOf(REVISION_STATUS_LABELS, r.status);
                  return (
                    <tr key={r.id} className="border-t border-white/5 align-top">
                      <td className="p-3 text-white">v{r.version}</td>
                      <td className="p-3 text-center"><Pill label={st.label} color={st.color} /></td>
                      <td className="p-3 text-xs text-slate-400">
                        <span title={r.proposedBySub}>{shortSub(r.proposedBySub)}</span>
                        <br />
                        <span className="text-slate-600">{fmtDateTime(r.proposedAt)}</span>
                      </td>
                      <td className="p-3 text-xs text-slate-400">
                        <span title={r.decidedBySub || undefined}>{shortSub(r.decidedBySub)}</span>
                        <br />
                        <span className="text-slate-600">{fmtDateTime(r.decidedAt)}</span>
                      </td>
                      <td className="p-3 text-xs text-slate-300 max-w-[320px]">
                        {r.comment || <span className="text-slate-600">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 px-4 py-3 border-t border-white/10">
            L'historique ne porte ni la courbe ni l'impact de chaque révision : le serveur ne
            les sert que pour la révision en attente (`serialize_revision`). Pour reconstituer
            une révision archivée, c'est le journal d'audit qui fait foi.
          </p>
        </Card>
      )}
    </div>
  );
};

// ── Briques d'affichage ──────────────────────────────────────────────────────

/** Courbe en toutes lettres. `x`/`y` peuvent arriver en nombre ou en chaîne :
 *  affichés bruts, jamais reformatés — un arrondi d'affichage sur un barème
 *  ferait croire à une courbe qui n'est pas celle qui s'applique. */
const PointsTable: React.FC<{
  points: CurvePoint[] | undefined;
  title: string;
  tone?: 'active' | 'proposed';
}> = ({ points, title, tone = 'active' }) => {
  const rows = points ?? [];
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">{title}</p>
      {rows.length === 0 ? (
        <Note tone="warn">Aucun point : le barème ne décrit aucune courbe exploitable.</Note>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10 max-w-md">
          <table className="w-full text-xs">
            <thead className="text-slate-400 bg-white/5">
              <tr>
                <th className="text-left p-2">x (grandeur mesurée)</th>
                <th className="text-right p-2">y (score sur 100)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={`${String(p.x)}-${i}`} className="border-t border-white/5">
                  <td className="p-2 font-mono text-slate-300">{fmtRaw(p.x)}</td>
                  <td className={`p-2 text-right font-mono ${
                    tone === 'proposed' ? 'text-amber-200' : 'text-slate-300'}`}
                  >
                    {fmtRaw(p.y)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const ParamsBlock: React.FC<{
  parametres: Record<string, unknown> | undefined;
  title: string;
}> = ({ parametres, title }) => (
  <div className="space-y-1">
    <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">{title}</p>
    <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-slate-200 overflow-x-auto">
      {JSON.stringify(parametres ?? {}, null, 2)}
    </pre>
  </div>
);

const CurveEditor: React.FC<{
  draft: DraftPoint[];
  onChange: (next: DraftPoint[]) => void;
}> = ({ draft, onChange }) => {
  const set = (i: number, key: 'x' | 'y', value: string) => {
    const next = draft.slice();
    next[i] = { ...next[i], [key]: value };
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
        Courbe proposée
      </p>
      <div className="overflow-x-auto rounded-lg border border-white/10 max-w-xl">
        <table className="w-full text-xs">
          <thead className="text-slate-400 bg-white/5">
            <tr>
              <th className="text-left p-2">x (grandeur mesurée)</th>
              <th className="text-left p-2">y (score sur 100)</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {draft.map((p, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="p-1">
                  <input
                    value={p.x}
                    onChange={(e) => set(i, 'x', e.target.value)}
                    inputMode="decimal"
                    className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 font-mono text-slate-200"
                  />
                </td>
                <td className="p-1">
                  <input
                    value={p.y}
                    onChange={(e) => set(i, 'y', e.target.value)}
                    inputMode="decimal"
                    className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 font-mono text-slate-200"
                  />
                </td>
                <td className="p-1 text-right">
                  <button
                    type="button"
                    onClick={() => onChange(draft.filter((_, j) => j !== i))}
                    className="text-red-300 hover:text-red-200 px-2"
                    title="Retirer ce point"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {draft.length === 0 && (
              <tr><td colSpan={3} className="p-3 text-slate-500">Aucun point.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Btn onClick={() => onChange([...draft, { x: '', y: '' }])}>Ajouter un point</Btn>
      <p className="text-[11px] text-slate-500">
        Les valeurs sont transmises telles que saisies (jamais converties en flottant) et
        validées par le serveur : au moins deux points, y dans [0, 100], pas deux points
        sur la même abscisse.
      </p>
    </div>
  );
};

/**
 * Impact sur le golden set — **affiché, jamais recalculé**.
 *
 * `frozenAt` distingue les deux natures d'impact, qui n'ont pas la même valeur
 * probante : figé avec la révision à sa proposition (c'est celui qui fonde la
 * décision du checker), ou simulé à la volée sur une courbe en cours de saisie.
 */
const ImpactView: React.FC<{
  impact: ImpactPreview;
  title?: string;
  frozenAt?: string | null;
}> = ({ impact, title, frozenAt }) => {
  const [onlyChanged, setOnlyChanged] = useState(true);

  const changed = useMemo(
    () => impact.impacts.filter((i) => i.evaluable && i.deltaScore !== 0),
    [impact.impacts],
  );
  const shown = onlyChanged ? changed : impact.impacts;

  return (
    <div className="space-y-3 border border-white/10 rounded-xl p-4 bg-black/20">
      <div>
        <p className="text-sm font-semibold text-slate-200">
          {title ?? 'Impact sur le golden set, calculé par le serveur'}
        </p>
        <p className="text-xs text-slate-500 mt-1">
          {frozenAt
            ? `Figé le ${fmtDateTime(frozenAt)}, au moment de la proposition — il n'est pas `
              + 'rejoué à l\'activation. Si des dossiers ont été analysés depuis, l\'effet réel '
              + 'peut différer de celui-ci.'
            : 'Simulation à la volée : rien n\'est enregistré, aucune révision n\'est créée.'}
        </p>
      </div>

      <div className="text-xs text-slate-400 leading-relaxed">
        Périmètre : {impact.goldenSet.source} — {impact.goldenSet.nbDossiers} dossier(s) du
        golden set, dont {impact.goldenSet.nbEvalues} réellement évaluable(s) sous ce barème.
        {impact.goldenSet.nbDossiers >= GOLDEN_SET_CAP && (
          <span className="text-amber-300">
            {' '}Golden set plafonné à {GOLDEN_SET_CAP} dossiers par le serveur.
          </span>
        )}
        {impact.goldenSet.nbDossiers === 0 && (
          <span className="text-amber-300">
            {' '}Aucun dossier analysé en base : cette simulation ne dit rien de l'effet réel
            du changement. La grille d'échantillon ci-dessous reste le seul élément lisible.
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
        <Stat label="Scores modifiés" value={String(impact.resume.nbScoreChange)} />
        <Stat
          label="Recommandations qui basculent"
          value={String(impact.resume.nbRecommandationFlip)}
          alert={impact.resume.nbRecommandationFlip > 0}
        />
        <Stat label="Lettres qui changent" value={String(impact.resume.nbLettreFlip)} />
        <Stat label="Δ score moyen" value={fmtSigned(impact.resume.deltaScoreMoyen)} />
        <Stat label="Δ score max (absolu)" value={fmtNum(impact.resume.deltaScoreMax)} />
      </div>

      {impact.resume.nbRecommandationFlip > 0 && (
        <Note tone="warn">
          {impact.resume.nbRecommandationFlip} dossier(s) du golden set changeraient de
          recommandation sous ce barème. Une bascule n'est pas une erreur — c'est
          exactement ce qu'un recalibrage produit — mais elle doit être voulue et motivée.
        </Note>
      )}

      {impact.sampleGrid.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
            Courbe avant / après sur les abscisses clés
          </p>
          <div className="overflow-x-auto rounded-lg border border-white/10 max-w-2xl">
            <table className="w-full text-xs">
              <thead className="text-slate-400 bg-white/5">
                <tr>
                  <th className="text-left p-2">x</th>
                  <th className="text-right p-2">Score avant</th>
                  <th className="text-right p-2">Score après</th>
                  <th className="text-right p-2">Δ</th>
                </tr>
              </thead>
              <tbody>
                {impact.sampleGrid.map((g, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="p-2 font-mono text-slate-300">{fmtNum(g.x, 3)}</td>
                    <td className="p-2 text-right text-slate-400">{fmtNum(g.scoreAvant)}</td>
                    <td className="p-2 text-right text-slate-200">{fmtNum(g.scoreApres)}</td>
                    <td className={`p-2 text-right font-mono ${
                      (g.delta ?? 0) > 0 ? 'text-emerald-300'
                        : (g.delta ?? 0) < 0 ? 'text-red-300' : 'text-slate-500'}`}
                    >
                      {fmtSigned(g.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {impact.impacts.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
              Dossier par dossier
            </p>
            <label className="text-xs text-slate-400 flex items-center gap-2">
              <input
                type="checkbox"
                checked={onlyChanged}
                onChange={(e) => setOnlyChanged(e.target.checked)}
              />
              N'afficher que les dossiers dont le score change
            </label>
          </div>
          <div className="overflow-auto rounded-lg border border-white/10 max-h-96">
            <table className="w-full text-xs min-w-[720px]">
              <thead className="text-slate-400 bg-white/5 sticky top-0">
                <tr>
                  <th className="text-left p-2">Dossier</th>
                  <th className="text-right p-2">Score avant</th>
                  <th className="text-right p-2">Score après</th>
                  <th className="text-right p-2">Δ</th>
                  <th className="text-left p-2">Recommandation</th>
                  <th className="text-center p-2">Lettre</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  if (!row.evaluable) {
                    return (
                      <tr key={row.applicationCode} className="border-t border-white/5">
                        <td className="p-2 font-mono text-slate-300">{row.applicationCode}</td>
                        <td colSpan={5} className="p-2 text-slate-500">
                          Non évaluable sous ce barème : la grandeur nécessaire n'est pas
                          présente dans l'analyse stockée. Rien n'est inventé à sa place.
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={row.applicationCode} className="border-t border-white/5">
                      <td className="p-2 font-mono text-slate-300">{row.applicationCode}</td>
                      <td className="p-2 text-right text-slate-400">{fmtNum(row.scoreGlobalAvant)}</td>
                      <td className="p-2 text-right text-slate-200">{fmtNum(row.scoreGlobalApres)}</td>
                      <td className={`p-2 text-right font-mono ${
                        row.deltaScore > 0 ? 'text-emerald-300'
                          : row.deltaScore < 0 ? 'text-red-300' : 'text-slate-500'}`}
                      >
                        {fmtSigned(row.deltaScore)}
                      </td>
                      <td className="p-2">
                        {row.recommandationChange ? (
                          <span className="text-amber-200">
                            {row.recommandationAvant} → {row.recommandationApres}
                          </span>
                        ) : (
                          <span className="text-slate-500">{row.recommandationApres}</span>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        {row.lettreAvant !== row.lettreApres ? (
                          <span className="text-amber-200">
                            {row.lettreAvant} → {row.lettreApres}
                          </span>
                        ) : (
                          <span className="text-slate-500">{row.lettreApres}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-slate-500">
                      Aucun dossier du golden set ne change de score sous ce barème.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            {shown.length} ligne(s) affichée(s) sur {impact.impacts.length} dossier(s) du
            périmètre.
          </p>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; alert?: boolean }> = ({
  label, value, alert,
}) => (
  <div className="bg-white/5 border border-white/10 rounded-lg p-2">
    <p className={`text-lg font-bold ${alert ? 'text-amber-300' : 'text-white'}`}>{value}</p>
    <p className="text-[11px] text-slate-500 leading-tight mt-1">{label}</p>
  </div>
);

export default BaremesPanel;

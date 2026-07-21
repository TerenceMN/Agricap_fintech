/**
 * Section 1 — **Templates de fichiers** (principe 11).
 *
 * Le template officiel n'est pas un fichier statique du dépôt : c'est une donnée
 * versionnée, déposée par un administrateur (maker) et activée par un second
 * (checker ≠ maker). À l'activation, le serveur DÉRIVE du fichier le schéma
 * attendu — feuilles, colonnes, types, rubriques — et ce schéma devient la règle
 * de validation de tout fichier client. Changer la règle ne demande donc aucun
 * redéploiement, et l'auditeur retrouve quelle version a validé quel dossier.
 *
 * Ce que cet écran ne fait pas, délibérément :
 *   - il ne dérive aucun schéma et ne calcule aucun diff : les deux viennent du
 *     serveur (`derive_schema`, `diff_schema`). Un diff reconstitué côté client
 *     ne serait pas la règle de validation, et un checker déciderait sur une
 *     information fausse ;
 *   - il n'autorise rien : `MAKER_EGAL_CHECKER` est une décision serveur, relayée
 *     telle quelle. Le bouton reste visible mais désactivé quand l'utilisateur
 *     connecté est le maker, avec la raison écrite.
 *
 * Backend : `dataio/views_templates.py`, `dataio/services_templates.py`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/services/api';
import { Empty, ErrorPanel, Loading, toFieldErrors, type FieldError } from '@/components/backoffice/States';
import { Btn, Card, CardHead, MakerChecker, Note, Pill, Tokens } from './Bits';
import {
  DIFF_BASELINE_LABELS, TEMPLATE_KINDS, TEMPLATE_STATUS_LABELS, fmtDateTime, labelOf,
  shortHash, shortSub, type TemplateDetail, type TemplateListResponse, type TemplateRow,
} from './wire';

interface Props {
  /** `sub` de l'utilisateur connecté — sert à rendre maker ≠ checker LISIBLE. */
  mySub: string;
  /** Capacité `config` du RBAC ; `null` quand elle n'a pas pu être lue. */
  canConfig: boolean | null;
}

const TemplatesPanel: React.FC<Props> = ({ mySub, canConfig }) => {
  const [data, setData] = useState<TemplateListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<string>('');

  const [kind, setKind] = useState<string>(TEMPLATE_KINDS[0].code);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErrors, setDetailErrors] = useState<FieldError[]>([]);
  const [activatingId, setActivatingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    try {
      const res = await api.templates.list();
      setData(res as unknown as TemplateListResponse);
    } catch (e) {
      setData(null);
      setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (id: number) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    setDetailErrors([]);
    setDetailLoading(true);
    try {
      const res = await api.templates.detail(id);
      setDetail(res as unknown as TemplateDetail);
    } catch (e) {
      setDetailErrors(toFieldErrors(e));
    } finally {
      setDetailLoading(false);
    }
  }, [openId]);

  const doUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setErrors([]);
    setNotice('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      const res = (await api.templates.upload(form)) as unknown as TemplateDetail;
      setNotice(res.message
        || `Template v${res.version} téléversé — en attente d'activation par un second administrateur.`);
      setFile(null);
      await load();
      // Le maker voit immédiatement le schéma dérivé de SON dépôt et son diff.
      setOpenId(res.id);
      setDetail(res);
    } catch (e) {
      setErrors(toFieldErrors(e));
    } finally {
      setUploading(false);
    }
  }, [file, kind, load]);

  const doActivate = useCallback(async (row: TemplateRow) => {
    setActivatingId(row.id);
    setErrors([]);
    setNotice('');
    try {
      const res = (await api.templates.activate(row.id)) as unknown as TemplateDetail;
      setNotice(res.message
        || `Template v${res.version} activé : son schéma dérivé devient la règle de validation.`);
      await load();
      if (openId === row.id) await openDetail(row.id);
    } catch (e) {
      // 409 `MAKER_EGAL_CHECKER` / `STATUT_INVALIDE` : message serveur relayé tel quel.
      setErrors(toFieldErrors(e));
    } finally {
      setActivatingId(null);
    }
  }, [load, openId, openDetail]);

  const rows = data?.templates ?? [];
  const active = data?.active ?? null;
  const readOnly = canConfig === false;

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Template actif — règle de validation en vigueur"
          subtitle="Tout fichier client déposé est comparé au schéma dérivé de ce template, et le rapport de validation enregistre sa version. Le fichier que le client télécharge est exactement celui-ci : une seule source."
          right={<Btn onClick={() => void load()} busy={loading}>Rafraîchir</Btn>}
        />
        <div className="p-4">
          {active ? (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <Pill label={`v${active.version}`} color="text-emerald-300 bg-emerald-500/20" />
              <span className="text-slate-300 font-mono text-xs">{active.kind}</span>
              <span className="text-slate-400 text-xs">Activé le {fmtDateTime(active.activatedAt)}</span>
              <span className="text-slate-500 text-xs">#{active.id}</span>
            </div>
          ) : (
            <Note tone="warn">
              <strong>Aucun template actif.</strong> Tant qu'aucun template n'est activé pour ce
              type de fichier, le dépôt d'une feuille de besoins est refusé côté serveur avec le
              code <span className="font-mono">TEMPLATE_NOT_CONFIGURED</span> — il n'y a pas de
              validation « au mieux ». Téléversez un template, puis faites-le activer par un
              second administrateur.
            </Note>
          )}
        </div>
      </Card>

      <Card>
        <CardHead
          title="Téléverser un template (maker)"
          subtitle="Fichier .xlsx uniquement, 5 Mo maximum. Le dépôt ne change aucune règle : il crée une version « en attente » dont le schéma est dérivé pour relecture."
        />
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-400 space-y-1">
              <span className="block">Type de fichier régi</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                disabled={readOnly}
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-40"
              >
                {TEMPLATE_KINDS.map((k) => (
                  <option key={k.code} value={k.code}>{k.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span className="block">Classeur modèle</span>
              <input
                type="file"
                accept=".xlsx"
                disabled={readOnly}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block text-sm text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:bg-white/10 file:text-white disabled:opacity-40"
              />
            </label>
            <Btn tone="primary" onClick={() => void doUpload()} disabled={!file || readOnly} busy={uploading}>
              Téléverser
            </Btn>
          </div>
          {readOnly && (
            <Note tone="warn">
              Votre rôle ne porte pas la capacité <span className="font-mono">config</span> :
              le dépôt et l'activation d'un template vous sont refusés par le serveur. La
              consultation reste ouverte.
            </Note>
          )}
        </div>
      </Card>

      <ErrorPanel errors={errors} title="Action refusée par le serveur" />
      {notice && <Note tone="ok">{notice}</Note>}

      <Card>
        <CardHead
          title="Historique des templates"
          subtitle="Maker (dépôt) et checker (activation) sont nommés sur chaque ligne : c'est la trace qui permet à un auditeur de reconstituer qui a changé la règle de validation, et quand."
          right={<span className="text-xs text-slate-500">{rows.length} version(s)</span>}
        />

        {loading && <Loading label="Chargement des templates…" />}

        {!loading && rows.length === 0 && errors.length === 0 && (
          <Empty
            title="Aucun template n'a encore été déposé."
            hint="Le premier dépôt crée la version 1 ; son activation par un second administrateur la rend opposable."
          />
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th className="text-left p-3">Version</th>
                  <th className="text-left p-3">Type</th>
                  <th className="text-center p-3">Statut</th>
                  <th className="text-left p-3">Fichier</th>
                  <th className="text-left p-3">SHA-256</th>
                  <th className="text-left p-3">Déposé par (maker)</th>
                  <th className="text-left p-3">Activé par (checker)</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = labelOf(TEMPLATE_STATUS_LABELS, r.status);
                  const isSelfMaker = !!r.uploadedBy && r.uploadedBy === mySub;
                  const open = openId === r.id;
                  return (
                    <React.Fragment key={r.id}>
                      <tr className="border-t border-white/5 hover:bg-white/5 align-top">
                        <td className="p-3 font-semibold text-white">v{r.version}</td>
                        <td className="p-3 font-mono text-xs text-slate-400">{r.kind}</td>
                        <td className="p-3 text-center"><Pill label={st.label} color={st.color} /></td>
                        <td className="p-3 text-slate-300 text-xs max-w-[220px] truncate" title={r.originalName}>
                          {r.originalName}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-slate-500" title={r.sha256}>
                          {shortHash(r.sha256)}
                        </td>
                        <td className="p-3 text-xs text-slate-400">
                          <span title={r.uploadedBy || undefined}>{shortSub(r.uploadedBy)}</span>
                          <br />
                          <span className="text-slate-600">{fmtDateTime(r.uploadedAt)}</span>
                        </td>
                        <td className="p-3 text-xs text-slate-400">
                          <span title={r.activatedBy || undefined}>{shortSub(r.activatedBy)}</span>
                          <br />
                          <span className="text-slate-600">{fmtDateTime(r.activatedAt)}</span>
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-2">
                            <Btn onClick={() => void openDetail(r.id)}>
                              {open ? 'Masquer' : 'Schéma & diff'}
                            </Btn>
                            {r.status === 'pending' && (
                              <Btn
                                tone="primary"
                                onClick={() => void doActivate(r)}
                                busy={activatingId === r.id}
                                disabled={isSelfMaker || readOnly}
                                title={isSelfMaker
                                  ? 'Maker ≠ checker : l’activation revient à un second administrateur.'
                                  : 'Activer ce template — son schéma devient la règle de validation.'}
                              >
                                Activer
                              </Btn>
                            )}
                          </div>
                        </td>
                      </tr>

                      {open && (
                        <tr className="border-t border-white/5 bg-black/20">
                          <td colSpan={8} className="p-4 space-y-3">
                            {r.status === 'pending' && (
                              <MakerChecker
                                makerSub={r.uploadedBy}
                                makerLabel={shortSub(r.uploadedBy)}
                                isSelf={isSelfMaker}
                                extra={`le ${fmtDateTime(r.uploadedAt)}`}
                              />
                            )}
                            <ErrorPanel errors={detailErrors} title="Détail indisponible" />
                            {detailLoading && <Loading label="Chargement du schéma dérivé…" />}
                            {!detailLoading && detail && detail.id === r.id && (
                              <TemplateDetailView detail={detail} />
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

/** Aperçu du schéma dérivé + diff serveur. Aucune dérivation locale. */
const TemplateDetailView: React.FC<{ detail: TemplateDetail }> = ({ detail }) => {
  const { schema, diff, diffBaseline } = detail;
  const baselineLabel = diffBaseline?.relation
    ? DIFF_BASELINE_LABELS[diffBaseline.relation]
    : null;

  const nothingChanged =
    diff.hasPrevious
    && diff.sheetsAdded.length === 0
    && diff.sheetsRemoved.length === 0
    && diff.sheetsColumnsChanged.length === 0
    && diff.rubriquesAdded.length === 0
    && diff.rubriquesRemoved.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-2">
          Diff vs version de référence
        </p>
        {!diff.hasPrevious ? (
          <Note>
            Première version pour ce type de fichier : il n'y a rien à comparer. Son activation
            créera la règle de validation initiale.
          </Note>
        ) : (
          <div className="space-y-2">
            <Note>
              {baselineLabel ?? 'Base de comparaison servie par le serveur.'}
              {diffBaseline?.version != null && (
                <span className="text-slate-500"> {' '}(v{diffBaseline.version}, #{diffBaseline.id})</span>
              )}
            </Note>
            {nothingChanged ? (
              <Note tone="ok">
                Aucun écart de forme détecté : mêmes feuilles, mêmes colonnes, mêmes rubriques.
                L'activation ne changerait pas la règle de validation — seul le fichier servi au
                client change (SHA-256 différent).
              </Note>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <DiffLine label="Feuilles ajoutées" items={diff.sheetsAdded} tone="add" />
                <DiffLine label="Feuilles supprimées" items={diff.sheetsRemoved} tone="del" />
                <DiffLine label="Feuilles dont les colonnes changent" items={diff.sheetsColumnsChanged} tone="mod" />
                <DiffLine label="Rubriques ajoutées" items={diff.rubriquesAdded} tone="add" />
                <DiffLine label="Rubriques supprimées" items={diff.rubriquesRemoved} tone="del" />
              </div>
            )}
            {(diff.sheetsRemoved.length > 0 || diff.rubriquesRemoved.length > 0) && (
              <Note tone="warn">
                Des feuilles ou rubriques disparaissent. Les dossiers déjà validés gardent la
                référence de LEUR version de template ; en revanche toute nouvelle feuille client
                sera validée contre celle-ci. Vérifiez que la suppression est voulue avant
                d'activer.
              </Note>
            )}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-2">
          Schéma dérivé du fichier
          <span className="ml-2 font-normal normal-case text-slate-600">
            dérivé le {fmtDateTime(schema.derived_at)} par le serveur
          </span>
        </p>
        <div className="space-y-2">
          <div className="text-xs text-slate-400">
            Feuille de synthèse retenue :{' '}
            <span className="font-mono text-slate-300">{schema.synthesis_sheet ?? '(aucune)'}</span>
          </div>
          <div className="text-xs text-slate-400 space-y-1">
            <span className="block">Rubriques attendues ({schema.rubriques.length})</span>
            <Tokens items={schema.rubriques} empty="Aucune rubrique dérivée." />
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="text-slate-400 bg-white/5">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Feuille</th>
                  <th className="text-right p-2">Colonnes</th>
                  <th className="text-left p-2">En-têtes attendus (ordre)</th>
                  <th className="text-right p-2">Lignes de repère</th>
                </tr>
              </thead>
              <tbody>
                {schema.sheets.map((s) => (
                  <tr key={s.name} className="border-t border-white/5 align-top">
                    <td className="p-2 text-slate-500">{s.position}</td>
                    <td className="p-2 font-mono text-slate-300">{s.name}</td>
                    <td className="p-2 text-right text-slate-400">{s.n_columns}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {s.columns.map((c) => (
                          <span key={c} className="bg-white/10 text-slate-300 rounded px-1.5 py-0.5 font-mono">
                            {c}
                            <span className="text-slate-500"> : {s.types[c] ?? '?'}</span>
                          </span>
                        ))}
                        {s.columns.length === 0 && <span className="text-slate-500">— aucune colonne lue</span>}
                      </div>
                    </td>
                    <td className="p-2 text-right text-slate-400" title={s.row_labels.slice(0, 30).join(' · ')}>
                      {s.row_labels.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const DiffLine: React.FC<{ label: string; items: string[]; tone: 'add' | 'del' | 'mod' }> = ({
  label,
  items,
  tone,
}) => {
  const tones: Record<string, string> = {
    add: 'text-emerald-300',
    del: 'text-red-300',
    mod: 'text-amber-300',
  };
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-2">
      <p className={`font-semibold mb-1 ${tones[tone]}`}>{label} ({items.length})</p>
      <Tokens items={items} empty="—" />
    </div>
  );
};

export default TemplatesPanel;

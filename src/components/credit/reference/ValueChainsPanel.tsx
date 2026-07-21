/**
 * Section 2 — **Filières `ValueChain`** (référentiel maker-checker).
 *
 * Ce référentiel porte ce sur quoi le moteur s'appuie pour juger un dossier :
 * cycle cultural, coût par hectare, poids des modules, facteur de risque, score
 * minimum exigé, taux de base, mois de récolte, garanties éligibles. Le changer,
 * c'est changer la façon dont tous les dossiers d'une filière seront analysés —
 * d'où le cycle maker-checker : un administrateur dépose un classeur, le serveur
 * le valide et calcule un diff, un SECOND administrateur active.
 *
 * L'UI n'existait pas : le cycle n'était accessible que par appels API directs
 * (dette explicite du CLAUDE.md §6, « maker-checker inaccessible hors API »).
 * Concrètement, personne ne pouvait relire un diff avant d'activer.
 *
 * Ce que cet écran ne fait pas :
 *   - il ne valide pas le classeur (`reference_data/validators.py` le fait) et ne
 *     recalcule aucun diff : `diff_summary` est figé en base à la validation ;
 *   - il n'autorise rien : le refus maker ≠ checker vient du serveur
 *     (`services.activate_file`) et est relayé tel quel.
 *
 * Backend : `reference_data/views.py`, `reference_data/services.py`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import type { ReferenceDiffSummary } from '@/types/api';
import { Btn, Card, CardHead, MakerChecker, Note, Pill, Tokens } from './Bits';
import {
  REFERENCE_FILE_TYPES, REFERENCE_STATUS_LABELS, REFERENCE_UPLOADS_CAP, fmtDateTime, fmtRaw,
  isForbidden, labelOf, refDataErrors, shortSub,
  type ReferenceActivateResult, type ReferenceUpload, type ReferenceUploadOk,
  type ValueChainRow,
} from './wire';

interface Props {
  /** `sub` de l'utilisateur connecté — rend maker ≠ checker lisible. */
  mySub: string;
  /** Capacité `config` du RBAC ; `null` quand `/rbac/me` n'a pas répondu. */
  canConfig: boolean | null;
}

const MOIS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

/** Mois de récolte : le numéro seul n'apprend rien à un lecteur. */
function moisLabels(months: number[] | null | undefined): string[] {
  if (!months || months.length === 0) return [];
  return months.map((m) => MOIS[m - 1] ?? String(m));
}

const ValueChainsPanel: React.FC<Props> = ({ mySub, canConfig }) => {
  const [chains, setChains] = useState<ValueChainRow[] | null>(null);
  const [uploads, setUploads] = useState<ReferenceUpload[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [uploadsForbidden, setUploadsForbidden] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const [fileType, setFileType] = useState(REFERENCE_FILE_TYPES[0].code);
  const [version, setVersion] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    setUploadsForbidden(null);
    // Les deux listes ont des gardes différentes : `value-chains` demande la
    // capacité `read`, `uploads` la capacité `config`. Un lecteur légitime du
    // référentiel n'a donc pas forcément accès à l'historique des dépôts : les
    // deux échecs sont traités séparément plutôt que fondus en un seul.
    const [chainsRes, uploadsRes] = await Promise.allSettled([
      api.referenceData.valueChains(),
      api.referenceData.uploads(),
    ]);

    if (chainsRes.status === 'fulfilled') {
      setChains(chainsRes.value as unknown as ValueChainRow[]);
    } else {
      setChains(null);
      if (isForbidden(chainsRes.reason)) setForbidden(chainsRes.reason.message);
      else setErrors(toFieldErrors(chainsRes.reason));
    }

    if (uploadsRes.status === 'fulfilled') {
      setUploads(uploadsRes.value as unknown as ReferenceUpload[]);
    } else {
      setUploads(null);
      if (isForbidden(uploadsRes.reason)) setUploadsForbidden(uploadsRes.reason.message);
      else setErrors((prev) => [...prev, ...toFieldErrors(uploadsRes.reason)]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setErrors([]);
    setNotice('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('file_type', fileType);
      if (version.trim()) form.append('version', version.trim());
      const res = (await api.referenceData.upload(form)) as unknown as ReferenceUploadOk;
      setNotice(res.message
        || `${res.rowCount} ligne(s) validée(s) — en attente d'activation par un second administrateur.`);
      setFile(null);
      setVersion('');
      await load();
      setOpenId(res.uploadId);
    } catch (e) {
      setErrors(refDataErrors(e));
    } finally {
      setUploading(false);
    }
  }, [file, fileType, version, load]);

  const doActivate = useCallback(async (row: ReferenceUpload) => {
    setActivatingId(row.id);
    setErrors([]);
    setNotice('');
    try {
      const res = (await api.referenceData.activate(row.id)) as unknown as ReferenceActivateResult;
      setNotice(res.message
        || `Référentiel activé : ${res.chainsCreated} filière(s) désormais opposables.`);
      await load();
    } catch (e) {
      // Refus maker ≠ checker, statut invalide, rapport de validation absent :
      // tous arrivent en 400 `{detail}`, message serveur relayé sans réécriture.
      setErrors(refDataErrors(e));
    } finally {
      setActivatingId(null);
    }
  }, [load]);

  const readOnly = canConfig === false;
  const rows = uploads ?? [];
  const list = chains ?? [];

  if (forbidden && uploadsForbidden) {
    return (
      <Forbidden
        message="Référentiel des filières réservé au personnel habilité."
        detail={forbidden}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Filières actives — ce sur quoi le moteur s'appuie"
          subtitle="Cycle, coût par hectare, poids des modules, facteur de risque, score minimum, taux de base : ces valeurs sont celles de la version ACTIVE du référentiel. Elles ne sont jamais servies à un client (principe 7)."
          right={<Btn onClick={() => void load()} busy={loading}>Rafraîchir</Btn>}
        />

        {loading && <Loading label="Chargement du référentiel filières…" />}

        {!loading && forbidden && (
          <div className="p-4">
            <Note tone="warn">{forbidden}</Note>
          </div>
        )}

        {!loading && !forbidden && list.length === 0 && (
          <Empty
            title="Aucune filière active."
            hint="Tant qu'aucun classeur de filières n'est activé, le moteur n'a ni coût de référence, ni poids de modules, ni score minimum par filière."
          />
        )}

        {!loading && list.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th className="text-left p-3">Code</th>
                  <th className="text-left p-3">Filière</th>
                  <th className="text-right p-3">Cycle (mois)</th>
                  <th className="text-right p-3">Coût / ha (USD)</th>
                  <th className="text-right p-3">Coût / ha (CDF)</th>
                  <th className="text-right p-3">Facteur risque</th>
                  <th className="text-right p-3">Score min.</th>
                  <th className="text-right p-3">Taux de base</th>
                  <th className="text-left p-3">Récolte</th>
                  <th className="text-left p-3">Poids modules</th>
                  <th className="text-left p-3">Garanties éligibles</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.code} className="border-t border-white/5 align-top hover:bg-white/5">
                    <td className="p-3 font-mono text-xs text-slate-400">{c.code}</td>
                    <td className="p-3 text-white">{c.label}</td>
                    <td className="p-3 text-right text-slate-300">{c.cycleMonths}</td>
                    <td className="p-3 text-right text-slate-300">{fmtRaw(c.costPerHectareUsd)}</td>
                    <td className="p-3 text-right text-slate-300">{fmtRaw(c.costPerHectareCdf)}</td>
                    <td className="p-3 text-right text-slate-300">{fmtRaw(c.riskFactor)}</td>
                    <td className="p-3 text-right text-slate-300">{c.minScoreRequired}</td>
                    <td className="p-3 text-right text-slate-300">{fmtRaw(c.baseRate)}</td>
                    <td className="p-3"><Tokens items={moisLabels(c.harvestMonths)} empty="—" /></td>
                    <td className="p-3">
                      <Tokens
                        items={Object.entries(c.moduleWeights || {})
                          .map(([k, v]) => `${k} ${v}`)}
                        empty="—"
                      />
                    </td>
                    <td className="p-3"><Tokens items={c.eligibleGuarantees || []} empty="—" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHead
          title="Déposer un classeur de référentiel (maker)"
          subtitle="Fichier .xlsx. Le dépôt ne change rien : le serveur valide, calcule un diff vs le référentiel actif et met la version « en attente ». L'activation revient à un second administrateur."
        />
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-400 space-y-1">
              <span className="block">Type de référentiel</span>
              <select
                value={fileType}
                onChange={(e) => setFileType(e.target.value)}
                disabled={readOnly}
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-40"
              >
                {REFERENCE_FILE_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span className="block">Libellé de version (optionnel)</span>
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={readOnly}
                placeholder="Nom du fichier si laissé vide"
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-64 disabled:opacity-40"
              />
            </label>
            <label className="text-xs text-slate-400 space-y-1">
              <span className="block">Classeur</span>
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

          {!REFERENCE_FILE_TYPES.find((t) => t.code === fileType)?.supported && (
            <Note tone="warn">
              Seul le type <span className="font-mono">value_chains</span> dispose aujourd'hui
              d'un validateur côté serveur. Un dépôt de ce type sera rejeté en 422 avec
              « Type de fichier non supporté pour la validation automatique » — ce n'est pas une
              panne, c'est une capacité qui n'existe pas encore.
            </Note>
          )}

          {readOnly && (
            <Note tone="warn">
              Votre rôle ne porte pas la capacité <span className="font-mono">config</span> :
              le dépôt et l'activation d'un référentiel vous sont refusés par le serveur.
              La consultation des filières actives reste ouverte.
            </Note>
          )}
        </div>
      </Card>

      <ErrorPanel errors={errors} title="Action refusée par le serveur" />
      {notice && <Note tone="ok">{notice}</Note>}

      <Card>
        <CardHead
          title="Historique des dépôts"
          subtitle="Qui a déposé, qui a activé, quand, et ce que le dépôt changeait. C'est la trace qui permet de savoir sous quelle version d'un référentiel un dossier a été analysé."
          right={<span className="text-xs text-slate-500">{rows.length} dépôt(s)</span>}
        />

        {loading && <Loading label="Chargement de l'historique…" />}

        {!loading && uploadsForbidden && (
          <div className="p-4">
            <Note tone="warn">
              Historique des dépôts réservé à la capacité <span className="font-mono">config</span> :
              {' '}{uploadsForbidden}
            </Note>
          </div>
        )}

        {!loading && !uploadsForbidden && rows.length === 0 && (
          <Empty
            title="Aucun dépôt de référentiel enregistré."
            hint="Le premier classeur validé puis activé crée les filières du moteur."
          />
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th className="text-left p-3">Version</th>
                  <th className="text-left p-3">Type</th>
                  <th className="text-center p-3">Statut</th>
                  <th className="text-right p-3">Lignes</th>
                  <th className="text-left p-3">Déposé par (maker)</th>
                  <th className="text-left p-3">Activé par (checker)</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = labelOf(REFERENCE_STATUS_LABELS, r.status);
                  const isSelfMaker = !!r.uploadedBy && r.uploadedBy === mySub;
                  const open = openId === r.id;
                  const pending = r.status === 'pending_validation';
                  return (
                    <React.Fragment key={r.id}>
                      <tr className="border-t border-white/5 hover:bg-white/5 align-top">
                        <td className="p-3 text-white max-w-[240px] truncate" title={r.version}>
                          {r.version || `#${r.id}`}
                        </td>
                        <td className="p-3 font-mono text-xs text-slate-400">{r.fileType}</td>
                        <td className="p-3 text-center"><Pill label={st.label} color={st.color} /></td>
                        <td className="p-3 text-right text-slate-300">{r.rowCount}</td>
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
                            <Btn onClick={() => setOpenId(open ? null : r.id)}>
                              {open ? 'Masquer' : 'Diff'}
                            </Btn>
                            {pending && (
                              <Btn
                                tone="primary"
                                onClick={() => void doActivate(r)}
                                busy={activatingId === r.id}
                                disabled={isSelfMaker || readOnly}
                                title={isSelfMaker
                                  ? 'Maker ≠ checker : l’activation revient à un second administrateur.'
                                  : 'Activer ce référentiel — les filières qu’il décrit deviennent celles du moteur.'}
                              >
                                Activer
                              </Btn>
                            )}
                          </div>
                        </td>
                      </tr>

                      {open && (
                        <tr className="border-t border-white/5 bg-black/20">
                          <td colSpan={7} className="p-4 space-y-3">
                            {pending && (
                              <MakerChecker
                                makerSub={r.uploadedBy}
                                makerLabel={shortSub(r.uploadedBy)}
                                isSelf={isSelfMaker}
                                extra={`le ${fmtDateTime(r.uploadedAt)}`}
                              />
                            )}
                            <DiffView diff={r.diff} />
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

        {!loading && rows.length >= REFERENCE_UPLOADS_CAP && (
          <p className="text-xs text-amber-300/90 px-4 py-3 border-t border-white/10">
            Liste plafonnée à {REFERENCE_UPLOADS_CAP} dépôts par le serveur, qui ne renvoie pas
            l'effectif total : des dépôts plus anciens peuvent manquer de cet historique.
          </p>
        )}
      </Card>
    </div>
  );
};

/**
 * Diff figé en base à la validation du classeur (`diff_summary`). Jamais
 * recalculé ici : le comparer côté client donnerait un diff vs les filières
 * ACTUELLES, alors que le champ dit ce qui a été constaté au moment du dépôt.
 */
const DiffView: React.FC<{ diff: ReferenceDiffSummary | null | undefined }> = ({ diff }) => {
  if (!diff || Object.keys(diff).length === 0) {
    return (
      <Note>
        Aucun diff enregistré pour ce dépôt : le classeur n'a pas passé la validation, ou il
        est antérieur au calcul de diff. Rien n'est déduit à sa place.
      </Note>
    );
  }
  const added = diff.added ?? [];
  const removed = diff.removed ?? [];
  const modified = diff.modified ?? [];

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-4 text-slate-400">
        <span>Filières du classeur : <span className="text-slate-200">{diff.totalNew ?? '—'}</span></span>
        <span>Inchangées : <span className="text-slate-200">{diff.unchanged ?? '—'}</span></span>
        <span>Ajoutées : <span className="text-emerald-300">{added.length}</span></span>
        <span>Supprimées : <span className="text-red-300">{removed.length}</span></span>
        <span>Modifiées : <span className="text-amber-300">{modified.length}</span></span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-lg p-2">
          <p className="font-semibold text-emerald-300 mb-1">Filières ajoutées ({added.length})</p>
          <Tokens items={added} empty="—" />
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg p-2">
          <p className="font-semibold text-red-300 mb-1">Filières retirées ({removed.length})</p>
          <Tokens items={removed} empty="—" />
        </div>
      </div>

      {removed.length > 0 && (
        <Note tone="warn">
          Des filières disparaissent du référentiel. Les dossiers déjà analysés conservent leur
          analyse, mais toute nouvelle demande sur une filière retirée n'aura plus de coût de
          référence ni de poids de modules. Vérifiez que le retrait est voulu avant d'activer.
        </Note>
      )}

      {modified.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[520px]">
            <thead className="text-slate-400 bg-white/5">
              <tr>
                <th className="text-left p-2">Code</th>
                <th className="text-left p-2">Filière</th>
                <th className="text-left p-2">Champs modifiés</th>
              </tr>
            </thead>
            <tbody>
              {modified.map((m) => (
                <tr key={m.code} className="border-t border-white/5 align-top">
                  <td className="p-2 font-mono text-slate-400">{m.code}</td>
                  <td className="p-2 text-slate-300">{m.label}</td>
                  <td className="p-2"><Tokens items={m.changes ?? []} empty="—" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ValueChainsPanel;

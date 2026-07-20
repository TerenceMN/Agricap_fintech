import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import type { DataSource, SourceTablesResponse, SourceTable, SourceRow } from '@/types/api';

// Écran admin : ingestion générique. Upload → APERÇU (aucune écriture, données montrées
// dans des tableaux) → « Enregistrer » (commit manuel) → les données enregistrées sont
// affichées en tableaux ÉDITABLES : l'admin corrige une cellule et « Enregistre les
// modifications » ; pour un référentiel, la correction re-synchronise aussitôt les plages
// typées que le moteur d'analyse relit. L'historique permet de revoir chaque source.

// Normalise une ligne : accepte {id, values} (source enregistrée) OU un dict brut (aperçu).
function toRow(r: unknown): SourceRow {
  return r && typeof r === 'object' && 'values' in (r as object)
    ? (r as SourceRow)
    : { values: (r as Record<string, string | null>) ?? {} };
}

// Lignes normalisées d'une table : nouvelle clé `rows` (=[{id, values}]) ou, en repli,
// ancienne clé backend `sample` (=[dict]) tant que l'API n'a pas été rechargée.
function rowsOf(table: SourceTable): SourceRow[] {
  const raw = Array.isArray(table?.rows)
    ? table.rows
    : Array.isArray((table as unknown as { sample?: unknown[] })?.sample)
      ? (table as unknown as { sample: unknown[] }).sample
      : [];
  return raw.map(toRow);
}

// Tableau générique. Éditable dès que la table porte un id et des lignes identifiées
// (données enregistrées) ; en lecture seule pour l'aperçu (avant commit).
const DataTableView: React.FC<{ table: SourceTable }> = ({ table }) => {
  const columns = Array.isArray(table?.columns) ? table.columns : [];
  const initial: SourceRow[] = rowsOf(table);
  const editable = !!table?.id && initial.some((r) => r.id != null);

  const [draft, setDraft] = useState<SourceRow[]>(initial);
  const [removed, setRemoved] = useState<number[]>([]);   // ids de lignes à supprimer au save
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [title, setTitle] = useState(table?.name ?? '');   // titre éditable de la table
  const [renaming, setRenaming] = useState(false);

  // Ré-hydrate quand la table change (autre source, ou re-consultation).
  useEffect(() => {
    setDraft(rowsOf(table));
    setRemoved([]); setDirty(false); setNote(null);
    setTitle(table?.name ?? '');
  }, [table]);

  const commitTitle = async () => {
    const next = title.trim();
    if (!table.id || !next || next === table.name) { setTitle(table?.name ?? ''); return; }
    setRenaming(true); setNote(null);
    try {
      const res = await api.renameTable(table.id, next);
      setTitle(res.name); setNote(res.detail);
    } catch (e) { setNote((e as Error).message); setTitle(table?.name ?? ''); }
    finally { setRenaming(false); }
  };

  const setCell = (ri: number, col: string, val: string) => {
    setDraft((d) => d.map((r, i) => (i === ri ? { ...r, values: { ...r.values, [col]: val } } : r)));
    setDirty(true); setNote(null);
  };

  const deleteRow = (ri: number) => {
    const row = draft[ri];
    if (row?.id != null) setRemoved((s) => [...s, row.id as number]);
    setDraft((d) => d.filter((_, i) => i !== ri));   // retrait visuel immédiat
    setDirty(true); setNote(null);
  };

  const save = async () => {
    if (!table.id) return;
    setSaving(true); setNote(null);
    try {
      const payload = draft.filter((r) => r.id != null).map((r) => ({ id: r.id as number, values: r.values }));
      const res = await api.updateTableRecords(table.id, payload, removed);
      setNote(res.detail); setDirty(false); setRemoved([]);
    } catch (e) { setNote((e as Error).message); }
    finally { setSaving(false); }
  };

  const reset = () => {
    setDraft(rowsOf(table));
    setRemoved([]); setDirty(false); setNote(null);
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-baseline gap-2 min-w-0">
          {editable ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setTitle(table?.name ?? ''); }}
              disabled={renaming}
              title="Renommer la table (Entrée pour valider)"
              className="text-sm font-semibold text-slate-200 bg-transparent border border-transparent rounded px-1 -ml-1 min-w-[8rem] max-w-[24rem] outline-none hover:border-white/10 focus:border-primary/60 focus:bg-white/5"
            />
          ) : (
            <span className="text-sm font-semibold text-slate-200">{table?.name}</span>
          )}
          <span className="text-xs font-normal text-slate-400 whitespace-nowrap">— {editable ? draft.length : (table?.n_rows ?? draft.length)} lignes, {table?.n_cols ?? columns.length} colonnes</span>
        </div>
        {editable && (
          <div className="flex items-center gap-2 shrink-0">
            {note && <span className="text-xs text-slate-400 max-w-[22rem] truncate" title={note}>{note}</span>}
            {removed.length > 0 && <span className="text-xs text-amber-400">{removed.length} à supprimer</span>}
            {dirty && <button onClick={reset} disabled={saving} className="text-xs text-slate-400 hover:text-slate-200">Annuler</button>}
            <button onClick={save} disabled={!dirty || saving}
              className="text-xs px-3 py-1 rounded-md bg-gradient-to-r from-primary to-secondary text-white font-semibold disabled:opacity-40">
              {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
            </button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto border border-white/10 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-white/5 text-slate-400">
            <tr>
              {columns.map((c) => (
                <th key={c.name} className="text-left px-3 py-2 whitespace-nowrap">{c.name}
                  {c.dtype ? <span className="ml-1 text-[10px] text-slate-500">{c.dtype}</span> : null}
                </th>
              ))}
              {editable && <th className="w-8 px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {draft.map((row, i) => (
              <tr key={row.id ?? i} className="border-t border-white/5 group">
                {columns.map((c) => (
                  <td key={c.name} className="px-2 py-1 whitespace-nowrap text-slate-300">
                    {editable ? (
                      <input
                        value={row.values[c.name] ?? ''}
                        onChange={(e) => setCell(i, c.name, e.target.value)}
                        className="w-full min-w-[6rem] bg-transparent border border-transparent rounded px-1.5 py-0.5 outline-none hover:border-white/10 focus:border-primary/60 focus:bg-white/5"
                      />
                    ) : (row.values[c.name] ?? '')}
                  </td>
                ))}
                {editable && (
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => deleteRow(i)} title="Supprimer cette ligne"
                      className="text-slate-500 hover:text-red-400 opacity-60 group-hover:opacity-100">✕</button>
                  </td>
                )}
              </tr>
            ))}
            {draft.length === 0 && (
              <tr><td className="px-3 py-3 text-slate-500" colSpan={(columns.length || 1) + (editable ? 1 : 0)}>Aucune ligne.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const DataAdmin: React.FC = () => {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [staged, setStaged] = useState<DataSource | null>(null);
  const [viewed, setViewed] = useState<SourceTablesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try { setSources(await api.dataSources()); } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { refresh(); }, []);

  const onUpload = async (file: File) => {
    setBusy(true); setError(null); setMsg(null); setStaged(null); setViewed(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const src = await api.uploadSource(fd);
      setStaged(src);
      setMsg(`Aperçu prêt : ${src.preview?.n_tables ?? 0} table(s) détectée(s). Rien n'est encore enregistré.`);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const viewData = async (id: number) => {
    setBusy(true); setError(null);
    try { setViewed(await api.sourceTables(id)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const onCommit = async (id: number) => {
    setBusy(true); setError(null);
    try {
      const r = await api.commitSource(id);
      setMsg(r.detail || 'Enregistré.');
      setStaged(null);
      await refresh();
      await viewData(id);            // affiche directement les données enregistrées
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const onDeleteSource = async (s: DataSource) => {
    if (!window.confirm(`Supprimer « ${s.original_name} » (r${s.revision}) et TOUTES ses données ?\nCette action est irréversible.`)) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await api.deleteSource(s.id);
      setMsg(r.detail || 'Source supprimée.');
      if (viewed?.source.id === s.id) setViewed(null);
      if (staged?.id === s.id) setStaged(null);
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="p-6">
      <Helmet><title>Données de référence — AGRICAP FINTECH</title></Helmet>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Ingestion des données de référence</h1>
          <Link to="/" className="text-sm text-primary underline">Retour</Link>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-4">
          <label className="block text-sm mb-2">Téléverser un classeur (référentiel, simulateur…)</label>
          <input type="file" accept=".xlsx,.xls" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
          <p className="text-xs text-slate-400 mt-2">
            L'upload calcule un <b>aperçu</b> (données affichées ci-dessous) sans rien écrire. L'enregistrement est <b>manuel</b>.
          </p>
        </div>

        {msg && <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg p-3 mb-4">{msg}</div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3 mb-4">{error}</div>}

        {/* APERÇU : données montrées en tableaux avant enregistrement. */}
        {staged?.preview && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">
                Aperçu — {staged.original_name} <span className="text-xs text-slate-400">({staged.preview.kind})</span>
                {staged.preview.is_reupload && <span className="ml-2 text-xs text-amber-400">réupload → nouvelle révision, ancienne conservée</span>}
              </h2>
              <button onClick={() => onCommit(staged.id)} disabled={busy}
                className="bg-gradient-to-r from-primary to-secondary text-white font-bold px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                Enregistrer
              </button>
            </div>
            <div className="max-h-[28rem] overflow-y-auto pr-1">
              {staged.preview.tables.map((t) => (
                <DataTableView key={t.sheet} table={{
                  name: t.sheet, n_rows: t.n_rows, n_cols: t.n_columns,
                  columns: t.columns.map((c) => ({ name: c, dtype: '' })),
                  rows: t.sample.map((r) => ({ values: Object.fromEntries(t.columns.map((c, i) => [c, r[i] ?? ''])) })),
                }} />
              ))}
            </div>
          </div>
        )}

        {/* DONNÉES ENREGISTRÉES : tables/colonnes/lignes d'une source. */}
        {viewed && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Données — {viewed.source.original_name} (r{viewed.source.revision})</h2>
              <button onClick={() => setViewed(null)} className="text-xs text-slate-400 hover:text-slate-200">Fermer</button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Tableaux <b>éditables</b> : corrigez une cellule puis « Enregistrer les modifications ».
              {viewed.source.kind === 'REFERENTIEL' && ' Sur un référentiel courant, la correction re-synchronise aussitôt les plages relues par le moteur d\'analyse.'}
            </p>
            <div className="max-h-[32rem] overflow-y-auto pr-1">
              {viewed.tables.map((t) => <DataTableView key={t.name} table={t} />)}
              {viewed.tables.length === 0 && <p className="text-slate-500 text-sm">Aucune table.</p>}
            </div>
          </div>
        )}

        <h2 className="font-semibold mb-2">Historique des sources</h2>
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400"><tr>
              <th className="text-left p-2">Fichier</th><th>Type</th><th>Rév.</th><th>Statut</th><th>Courant</th><th>Tables</th><th>Uploadé</th><th></th>
            </tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-t border-white/5">
                  <td className="p-2">{s.original_name}</td>
                  <td className="text-center">{s.kind}</td>
                  <td className="text-center">r{s.revision}</td>
                  <td className="text-center">{s.status === 'COMMITTED' ? 'Enregistré' : 'En attente'}</td>
                  <td className="text-center">{s.is_current ? '✓' : ''}</td>
                  <td className="text-center">{s.n_tables}</td>
                  <td className="text-center text-slate-400">{new Date(s.uploaded_at).toLocaleString('fr-FR')}</td>
                  <td className="text-right pr-3 whitespace-nowrap">
                    {s.status === 'COMMITTED' && (
                      <button onClick={() => viewData(s.id)} disabled={busy} className="text-primary text-xs underline">
                        Voir les données
                      </button>
                    )}
                    <button onClick={() => onDeleteSource(s)} disabled={busy} className="text-red-400 text-xs underline ml-3">
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
              {sources.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-500">Aucune source.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DataAdmin;

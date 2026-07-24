import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { SlidersHorizontal, Gauge, Archive, ListChecks, Pencil, PlayCircle } from 'lucide-react';
import {
  accountingApi, formatMontantDevise, pourcentDepuisFraction, deplierErreur,
} from '@/services/accountingApi';
import { Loading, ErrorState, EmptyState, ErrorList } from './AccountingStates';

// ────────────────────────────────────────────────────── Édition d'une classe (config)
const ClasseForm = ({ classe, onDone }) => {
  const [data, setData] = useState({
    libelle: classe.libelle, joursMin: String(classe.joursMin ?? ''),
    joursMax: classe.joursMax === null || classe.joursMax === undefined ? '' : String(classe.joursMax),
    tauxProvision: classe.tauxProvision ?? '', enSouffrance: classe.enSouffrance,
    ordre: String(classe.ordre ?? ''), actif: classe.actif,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const set = (k) => (e) => setData((d) => ({ ...d, [k]: e?.target ? e.target.value : e }));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await accountingApi.provisions.classes.update(classe.code, {
        libelle: data.libelle,
        joursMin: data.joursMin === '' ? undefined : Number(data.joursMin),
        joursMax: data.joursMax === '' ? null : Number(data.joursMax),
        tauxProvision: data.tauxProvision === '' ? undefined : String(data.tauxProvision),
        enSouffrance: data.enSouffrance,
        ordre: data.ordre === '' ? undefined : Number(data.ordre),
        actif: data.actif,
      });
      toast({ title: 'Classe PAR mise à jour', description: classe.code });
      onDone?.();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label className="text-xs">Libellé</Label><Input value={data.libelle} onChange={set('libelle')} /></div>
        <div><Label className="text-xs">Jours min</Label><Input type="number" value={data.joursMin} onChange={set('joursMin')} /></div>
        <div><Label className="text-xs">Jours max (vide = ∞)</Label><Input type="number" value={data.joursMax} onChange={set('joursMax')} /></div>
        <div><Label className="text-xs">Taux de provision (fraction, ex. 0.05 = 5 %)</Label><Input value={data.tauxProvision} onChange={set('tauxProvision')} className="font-mono" /></div>
        <div><Label className="text-xs">Ordre</Label><Input type="number" value={data.ordre} onChange={set('ordre')} /></div>
      </div>
      <div className="flex gap-6 text-xs text-slate-300">
        <label className="flex items-center gap-2"><input type="checkbox" checked={data.enSouffrance} onChange={(e) => set('enSouffrance')(e.target.checked)} /> En souffrance</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={data.actif} onChange={(e) => set('actif')(e.target.checked)} /> Active</label>
      </div>
      <ErrorList error={error} />
      <div className="flex justify-end"><Button onClick={submit} disabled={busy}><Pencil className="w-4 h-4 mr-2" /> Enregistrer</Button></div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────── Grille PAR
const GrilleVue = ({ can }) => {
  const [state, setState] = useState({ data: null, error: null });
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.provisions.classes.list({})
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (state.error) return <ErrorState error={state.error} onRetry={load} />;
  if (!state.data) return <Loading label="Chargement de la grille PAR…" />;
  return (
    <div className="space-y-3">
      <div className={`rounded-lg border p-3 text-sm ${state.data.couvertureValide ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-300' : 'border-red-900/50 bg-red-950/20 text-red-300'}`}>
        {state.data.couvertureValide ? 'Couverture des retards complète et sans chevauchement [0, ∞[.' : `Couverture invalide : ${state.data.couvertureProbleme}`}
      </div>
      <div className="overflow-auto rounded-lg border border-slate-800">
        <Table>
          <TableHeader className="bg-slate-900/60">
            <TableRow>
              <TableHead>Code</TableHead><TableHead>Libellé</TableHead><TableHead className="text-right">Jours</TableHead>
              <TableHead className="text-right">Taux</TableHead><TableHead>Souffrance</TableHead><TableHead>État</TableHead>
              {can.config && <TableHead className="text-right">Éditer</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.data.results.map((c) => (
              <TableRow key={c.code} className="border-slate-800">
                <TableCell className="font-mono text-xs text-emerald-300">{c.code}</TableCell>
                <TableCell className="text-sm">{c.libelle}</TableCell>
                <TableCell className="text-right font-mono text-xs">{c.joursMin}{c.joursMax === null ? ' → ∞' : ` → ${c.joursMax}`}</TableCell>
                <TableCell className="text-right font-mono">{pourcentDepuisFraction(c.tauxProvision)}</TableCell>
                <TableCell>{c.enSouffrance ? <Badge variant="destructive">Oui</Badge> : <Badge variant="secondary">Non</Badge>}</TableCell>
                <TableCell>{c.actif ? <Badge variant="success">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                {can.config && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEdit(c)}><Pencil className="w-4 h-4 text-slate-400" /></Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={Boolean(edit)} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="glass-effect text-white border-slate-700 sm:max-w-[480px]">
          <DialogHeader><DialogTitle>Classe PAR {edit?.code}</DialogTitle></DialogHeader>
          {edit && <ClasseForm classe={edit} onDone={() => { setEdit(null); load(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ──────────────────────────────────────────────────── Classification (simulation)
const ClassificationVue = () => {
  const [asOf, setAsOf] = useState('');
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.provisions.classification({ as_of: asOf || undefined })
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, [asOf]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div><Label className="text-[10px] uppercase text-slate-500">Arrêté au</Label><Input type="date" className="w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
        <span className="text-xs text-slate-500 self-center">Simulation en lecture seule : ce que coûterait l'arrêté, sans écrire une ligne.</span>
      </div>
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Analyse du portefeuille…" />
        : (
          <div className="space-y-4">
            {state.data.synthese.map((s) => (
              <div key={s.devise} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-200">Synthèse {s.devise}</span>
                  <span className="text-xs text-slate-500">{s.nombreCredits} crédit(s) · PAR30 {pourcentDepuisFraction(s.par30Ratio)}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
                  <div><div className="text-slate-500">Encours total</div><div className="font-mono text-white">{formatMontantDevise(s.encoursTotal, s.devise, { decimales: 2 })}</div></div>
                  <div><div className="text-slate-500">Provision requise</div><div className="font-mono text-amber-300">{formatMontantDevise(s.provisionRequise, s.devise, { decimales: 2 })}</div></div>
                  <div><div className="text-slate-500">Provision comptabilisée</div><div className="font-mono text-white">{formatMontantDevise(s.provisionComptabilisee, s.devise, { decimales: 2 })}</div></div>
                  <div><div className="text-slate-500">Encours à risque 30j</div><div className="font-mono text-red-300">{formatMontantDevise(s.encoursARisque30j, s.devise, { decimales: 2 })}</div></div>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>Classe</TableHead><TableHead className="text-right">Taux</TableHead><TableHead className="text-right">Nombre</TableHead><TableHead className="text-right">Encours</TableHead><TableHead className="text-right">Provision</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {s.lignes.map((l) => (
                      <TableRow key={l.classe} className="border-slate-800">
                        <TableCell className="text-sm">{l.libelle} <span className="font-mono text-xs text-slate-500">({l.classe})</span></TableCell>
                        <TableCell className="text-right font-mono">{pourcentDepuisFraction(l.tauxProvision)}</TableCell>
                        <TableCell className="text-right font-mono">{l.nombre}</TableCell>
                        <TableCell className="text-right font-mono">{formatMontantDevise(l.encours, null, { decimales: 2 })}</TableCell>
                        <TableCell className="text-right font-mono text-amber-300">{formatMontantDevise(l.provision, null, { decimales: 2 })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
            {state.data.anomalies?.length > 0 && (
              <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-300 space-y-1">
                {state.data.anomalies.map((a, i) => <div key={i}>{a}</div>)}
              </div>
            )}
            <p className="text-xs text-slate-500">{state.data.totalRows} crédit(s) analysé(s) au {state.data.asOf || '—'}.</p>
          </div>
        )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────── Arrêtés
const ArretesVue = ({ can }) => {
  const [state, setState] = useState({ data: null, error: null });
  const [dateArrete, setDateArrete] = useState('');
  const [busy, setBusy] = useState(false);
  const [dernier, setDernier] = useState(null);
  const { toast } = useToast();

  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.provisions.arretes.list({ limit: 50 })
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const passer = async () => {
    setBusy(true);
    try {
      const res = await accountingApi.provisions.arretes.create({ dateArrete: dateArrete || undefined });
      setDernier(res);
      toast({ title: 'Arrêté passé', description: `Dotations/reprises comptabilisées au ${res.dateArrete || '—'}.` });
      load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Arrêté refusé', description: deplierErreur(e)[0]?.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {can.validate && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div><Label className="text-[10px] uppercase text-slate-500">Date d'arrêté</Label><Input type="date" className="w-40" value={dateArrete} onChange={(e) => setDateArrete(e.target.value)} /></div>
          <Button onClick={passer} disabled={busy}><PlayCircle className="w-4 h-4 mr-2" /> Passer l'arrêté (acte écrivant)</Button>
          <span className="text-xs text-slate-500 self-center">Comptabilise les dotations/reprises 137 et les déclassements — irréversible (append-only).</span>
        </div>
      )}
      {dernier && (
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 text-xs text-emerald-200 space-y-1">
          <div className="font-semibold">Arrêté du {dernier.dateArrete || '—'} — {dernier.declassements.length} déclassement(s)</div>
          {dernier.arretes.map((a) => (
            <div key={a.devise} className="font-mono">
              {a.devise} : dotation {formatMontantDevise(a.dotation, null, { decimales: 2 })} · reprise {formatMontantDevise(a.reprise, null, { decimales: 2 })} · pièce {a.piece || '—'}
            </div>
          ))}
          {dernier.anomalies?.map((x, i) => <div key={i} className="text-amber-300">{x}</div>)}
        </div>
      )}
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Chargement de l'historique…" />
        : state.data.results.length === 0 ? <EmptyState label="Aucun arrêté de provisionnement passé." />
        : (
          <div className="overflow-auto max-h-[46vh] rounded-lg border border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                <TableRow><TableHead>Date</TableHead><TableHead>Devise</TableHead><TableHead className="text-right">Requise</TableHead><TableHead className="text-right">Dotation</TableHead><TableHead className="text-right">Reprise</TableHead><TableHead>Pièce</TableHead><TableHead>Par</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {state.data.results.map((a) => (
                  <TableRow key={a.id} className="border-slate-800">
                    <TableCell className="text-xs text-slate-400">{a.dateArrete || '—'}</TableCell>
                    <TableCell><Badge variant="secondary">{a.devise}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{formatMontantDevise(a.provisionRequise, null, { decimales: 2 })}</TableCell>
                    <TableCell className="text-right font-mono text-amber-300">{formatMontantDevise(a.dotation, null, { decimales: 2 })}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-300">{formatMontantDevise(a.reprise, null, { decimales: 2 })}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{a.piece || '—'}</TableCell>
                    <TableCell className="text-xs text-slate-400">{a.creePar || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────── Classements
const ClassementsVue = () => {
  const [reference, setReference] = useState('');
  const [dateArrete, setDateArrete] = useState('');
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.provisions.classements({ reference: reference || undefined, dateArrete: dateArrete || undefined, limit: 200 })
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, [reference, dateArrete]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label className="text-[10px] uppercase text-slate-500">Référence crédit</Label><Input className="w-44 font-mono" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="LN-…" /></div>
        <div><Label className="text-[10px] uppercase text-slate-500">Date d'arrêté</Label><Input type="date" className="w-40" value={dateArrete} onChange={(e) => setDateArrete(e.target.value)} /></div>
      </div>
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Chargement des classements…" />
        : state.data.results.length === 0 ? <EmptyState label="Aucun classement daté pour ce filtre." />
        : (
          <div className="overflow-auto max-h-[50vh] rounded-lg border border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                <TableRow><TableHead>Date arrêté</TableHead><TableHead>Crédit</TableHead><TableHead>Classe</TableHead><TableHead className="text-right">Retard (j)</TableHead><TableHead className="text-right">Encours</TableHead><TableHead>Souffrance</TableHead><TableHead>Déclassement</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {state.data.results.map((c) => (
                  <TableRow key={c.id} className="border-slate-800">
                    <TableCell className="text-xs text-slate-400">{c.dateArrete || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{c.reference}</TableCell>
                    <TableCell><Badge variant={c.enSouffrance ? 'destructive' : 'secondary'}>{c.classe}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{c.joursRetard}</TableCell>
                    <TableCell className="text-right font-mono">{formatMontantDevise(c.encours, c.devise, { decimales: 2 })}</TableCell>
                    <TableCell>{c.enSouffrance ? <Badge variant="destructive">Oui</Badge> : <Badge variant="secondary">Non</Badge>}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{c.pieceDeclassement || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
    </div>
  );
};

const VUES = [
  { key: 'grille', label: 'Grille PAR', icon: SlidersHorizontal },
  { key: 'classification', label: 'Classification', icon: Gauge },
  { key: 'arretes', label: 'Arrêtés', icon: Archive },
  { key: 'classements', label: 'Classements', icon: ListChecks },
];

const ProvisionsViewer = ({ access }) => {
  const can = access?.can || {};
  const [vue, setVue] = useState('grille');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {VUES.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setVue(key)}
            className={`p-3 rounded-lg transition-all flex items-center justify-center gap-2 ${vue === key ? 'glass-effect-active' : 'glass-effect'}`}>
            <Icon className={`w-4 h-4 ${vue === key ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span className={`text-xs font-semibold ${vue === key ? 'text-white' : 'text-slate-300'}`}>{label}</span>
          </button>
        ))}
      </div>
      <div className="glass-effect rounded-2xl p-5">
        {vue === 'grille' && <GrilleVue can={can} />}
        {vue === 'classification' && <ClassificationVue />}
        {vue === 'arretes' && <ArretesVue can={can} />}
        {vue === 'classements' && <ClassementsVue />}
      </div>
    </div>
  );
};

export default ProvisionsViewer;

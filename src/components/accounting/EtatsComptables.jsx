import React, { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Scale, Briefcase, Globe } from 'lucide-react';
import { accountingApi, formatMontantDevise } from '@/services/accountingApi';
import { Loading, ErrorState, EmptyState } from './AccountingStates';

const DEVISES = ['FC', 'USD'];

const PostesTable = ({ titre, postes, devise }) => (
  <>
    <TableRow className="bg-slate-800/50"><TableHead colSpan={3} className="text-white font-bold">{titre}</TableHead></TableRow>
    {postes.map((p) => (
      <TableRow key={p.code} className="border-slate-800">
        <TableCell className="font-mono text-xs text-slate-500">{p.code}</TableCell>
        <TableCell className="text-sm">{p.intitule}</TableCell>
        <TableCell className="text-right font-mono text-white">{formatMontantDevise(p.montant, devise, { decimales: 2 })}</TableCell>
      </TableRow>
    ))}
    {postes.length === 0 && (
      <TableRow><TableCell colSpan={3} className="text-center text-slate-500 py-4">Aucun poste.</TableCell></TableRow>
    )}
  </>
);

// ──────────────────────────────────────────────────────────────────── Bilan
const BilanVue = () => {
  const [devise, setDevise] = useState('USD');
  const [asOf, setAsOf] = useState('');
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.etats.bilan({ devise, as_of: asOf || undefined })
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, [devise, asOf]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[10px] uppercase text-slate-500">Devise (obligatoire)</Label>
          <Select value={devise} onValueChange={setDevise}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{DEVISES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label className="text-[10px] uppercase text-slate-500">Arrêté au</Label><Input type="date" className="w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      </div>
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Construction du bilan…" />
        : (
          <>
            <div className="overflow-auto max-h-[46vh] rounded-lg border border-slate-800">
              <Table>
                <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Intitulé</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
                <TableBody>
                  <PostesTable titre="Actif" postes={state.data.actif} devise={state.data.devise} />
                  <TableRow className="bg-slate-900/40 font-semibold"><TableCell colSpan={2} className="text-right text-slate-200">Total Actif</TableCell><TableCell className="text-right font-mono text-emerald-300">{formatMontantDevise(state.data.totalActif, state.data.devise, { decimales: 2 })}</TableCell></TableRow>
                  <PostesTable titre="Passif" postes={state.data.passif} devise={state.data.devise} />
                  <TableRow className="border-slate-800"><TableCell colSpan={2} className="text-right text-slate-400 text-sm">Résultat de l'exercice</TableCell><TableCell className="text-right font-mono text-slate-200">{formatMontantDevise(state.data.resultatExercice, state.data.devise, { decimales: 2 })}</TableCell></TableRow>
                  <TableRow className="bg-slate-900/40 font-semibold"><TableCell colSpan={2} className="text-right text-slate-200">Total Passif + Résultat</TableCell><TableCell className="text-right font-mono text-emerald-300">{formatMontantDevise(state.data.totalPassifEtResultat, state.data.devise, { decimales: 2 })}</TableCell></TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {state.data.boucle ? <Badge variant="success">Bilan équilibré</Badge> : <Badge variant="destructive">Écart de bouclage</Badge>}
              <span className="text-xs text-slate-500">Écart : <span className="font-mono">{formatMontantDevise(state.data.ecartBouclage, state.data.devise, { decimales: 2 })}</span> — calculé par le serveur.</span>
            </div>
          </>
        )}
    </div>
  );
};

// ──────────────────────────────────────────────────────── Compte de résultat
const ResultatVue = () => {
  const [devise, setDevise] = useState('USD');
  const [asOf, setAsOf] = useState('');
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.etats.resultat({ devise, as_of: asOf || undefined })
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, [devise, asOf]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[10px] uppercase text-slate-500">Devise (obligatoire)</Label>
          <Select value={devise} onValueChange={setDevise}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{DEVISES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label className="text-[10px] uppercase text-slate-500">Arrêté au</Label><Input type="date" className="w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      </div>
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Construction du compte de résultat…" />
        : (
          <div className="overflow-auto max-h-[52vh] rounded-lg border border-slate-800">
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Intitulé</TableHead><TableHead className="text-right">Montant</TableHead></TableRow></TableHeader>
              <TableBody>
                <PostesTable titre="Produits" postes={state.data.produits} devise={state.data.devise} />
                <TableRow className="bg-slate-900/40 font-semibold"><TableCell colSpan={2} className="text-right text-slate-200">Total Produits</TableCell><TableCell className="text-right font-mono text-emerald-300">{formatMontantDevise(state.data.totalProduits, state.data.devise, { decimales: 2 })}</TableCell></TableRow>
                <PostesTable titre="Charges" postes={state.data.charges} devise={state.data.devise} />
                <TableRow className="bg-slate-900/40 font-semibold"><TableCell colSpan={2} className="text-right text-slate-200">Total Charges</TableCell><TableCell className="text-right font-mono text-red-300">{formatMontantDevise(state.data.totalCharges, state.data.devise, { decimales: 2 })}</TableCell></TableRow>
                <TableRow className="bg-slate-900 font-extrabold text-base"><TableCell colSpan={2} className="text-right text-white">RÉSULTAT NET</TableCell><TableCell className="text-right font-mono text-emerald-400">{formatMontantDevise(state.data.resultat, state.data.devise, { decimales: 2 })}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
        )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────── États consolidés
const ConsolideVue = () => {
  const [asOf, setAsOf] = useState('');
  const [state, setState] = useState({ data: null, error: null, loading: false });
  const load = useCallback(() => {
    if (!asOf) return;
    setState({ data: null, error: null, loading: true });
    accountingApi.etats.consolide({ as_of: asOf })
      .then((d) => setState({ data: d, error: null, loading: false }))
      .catch((e) => setState({ data: null, error: e, loading: false }));
  }, [asOf]);
  useEffect(() => { load(); }, [load]);

  const c = state.data?.consolide;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label className="text-[10px] uppercase text-slate-500">Arrêté au (obligatoire — rattaché à un taux de clôture)</Label><Input type="date" className="w-52" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      </div>
      {!asOf ? <EmptyState label="Choisissez une date d'arrêté pour consolider FC + USD au taux de clôture." />
        : state.error ? <ErrorState error={state.error} onRetry={load} />
        : state.loading || !state.data ? <Loading label="Consolidation…" />
        : (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400">
              Taux de clôture appliqué : <span className="font-mono text-slate-200">{state.data.tauxCloture.deviseBase}/{state.data.tauxCloture.deviseContre} = {formatMontantDevise(state.data.tauxCloture.taux, null, { decimales: 4 })}</span>
              {' · '}{state.data.tauxCloture.provenance}
            </div>
            {state.data.avertissements?.length > 0 && (
              <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-300 space-y-1">
                {state.data.avertissements.map((a, i) => <div key={i}>{a}</div>)}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                ['Total Actif', c.totalActif], ['Total Passif', c.totalPassif], ['Résultat', c.resultat],
                ['Total Produits', c.totalProduits], ['Total Charges', c.totalCharges], ['Total Passif + Résultat', c.totalPassifEtResultat],
              ].map(([label, val]) => (
                <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                  <div className="text-[10px] uppercase text-slate-500">{label}</div>
                  <div className="font-mono text-white">{formatMontantDevise(val, c.devisePivot, { decimales: 2 })}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {c.boucle ? <Badge variant="success">Consolidé équilibré</Badge> : <Badge variant="destructive">Écart de bouclage</Badge>}
              <span className="text-xs text-slate-500">Écart : <span className="font-mono">{formatMontantDevise(c.ecartBouclage, c.devisePivot, { decimales: 2 })}</span> (devise pivot {c.devisePivot}).</span>
            </div>
            <div className="text-xs text-slate-500">
              Détail par devise disponible : {Object.keys(state.data.parDevise).join(', ')} — chaque devise porte son propre bilan et résultat avant conversion.
            </div>
          </div>
        )}
    </div>
  );
};

const VUES = [
  { key: 'bilan', label: 'Bilan', icon: Scale },
  { key: 'resultat', label: 'Compte de résultat', icon: Briefcase },
  { key: 'consolide', label: 'États consolidés', icon: Globe },
];

const EtatsComptables = () => {
  const [vue, setVue] = useState('bilan');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {VUES.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setVue(key)}
            className={`p-3 rounded-lg transition-all flex items-center justify-center gap-2 ${vue === key ? 'glass-effect-active' : 'glass-effect'}`}>
            <Icon className={`w-4 h-4 ${vue === key ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span className={`text-xs font-semibold ${vue === key ? 'text-white' : 'text-slate-300'}`}>{label}</span>
          </button>
        ))}
      </div>
      <div className="glass-effect rounded-2xl p-5">
        {vue === 'bilan' && <BilanVue />}
        {vue === 'resultat' && <ResultatVue />}
        {vue === 'consolide' && <ConsolideVue />}
      </div>
    </div>
  );
};

export default EtatsComptables;

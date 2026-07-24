import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Scale, BookOpen, Layers, ShieldCheck, ArrowRightLeft, Coins } from 'lucide-react';
import {
  accountingApi, formatMontantDevise, libelleJournal, libelleNature, libelleUsageTaux,
  libelleSourceTaux, libelleStatutPiece,
} from '@/services/accountingApi';
import { Loading, ErrorState, EmptyState } from './AccountingStates';

const DEVISES = ['FC', 'USD'];

const VUES = [
  { key: 'balance', label: 'Balance', icon: Scale },
  { key: 'grandlivre', label: 'Grand livre', icon: BookOpen },
  { key: 'journaux', label: 'Journaux auxiliaires', icon: Layers },
  { key: 'integrite', label: 'Contrôle d\'intégrité', icon: ShieldCheck },
  { key: 'fx', label: 'Rapprochement 588FX', icon: ArrowRightLeft },
  { key: 'taux', label: 'Taux appliqués', icon: Coins },
];

// ─────────────────────────────────────────────────────────────────── Balance
const BalanceVue = () => {
  const [devise, setDevise] = useState('USD');
  const [asOf, setAsOf] = useState('');
  const [state, setState] = useState({ data: null, error: null });

  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.balance({ devise, as_of: asOf || undefined })
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
        <div><Label className="text-[10px] uppercase text-slate-500">Arrêtée au</Label><Input type="date" className="w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      </div>
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Calcul de la balance…" />
        : state.data.results.length === 0 ? <EmptyState label="Aucun mouvement pour cette devise." />
        : (
          <div className="overflow-auto max-h-[52vh] rounded-lg border border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                <TableRow>
                  <TableHead>Compte</TableHead><TableHead>Intitulé</TableHead><TableHead>Nature</TableHead>
                  <TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Solde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.data.results.map((l) => (
                  <TableRow key={l.code} className="border-slate-800">
                    <TableCell className="font-mono text-xs text-emerald-300">{l.code}</TableCell>
                    <TableCell className="text-sm">{l.intitule}</TableCell>
                    <TableCell className="text-xs text-slate-400">{libelleNature(l.nature)}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-400">{formatMontantDevise(l.debit, null, { decimales: 2 })}</TableCell>
                    <TableCell className="text-right font-mono text-red-400">{formatMontantDevise(l.credit, null, { decimales: 2 })}</TableCell>
                    <TableCell className="text-right font-mono text-white">{formatMontantDevise(l.solde, null, { decimales: 2 })}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-slate-900/50 font-bold">
                  <TableCell colSpan={3} className="text-right text-slate-200">Totaux {state.data.devise}</TableCell>
                  <TableCell className="text-right font-mono text-white">{formatMontantDevise(state.data.totalDebit, null, { decimales: 2 })}</TableCell>
                  <TableCell className="text-right font-mono text-white">{formatMontantDevise(state.data.totalCredit, null, { decimales: 2 })}</TableCell>
                  <TableCell className="text-right">{state.data.equilibree ? <Badge variant="success">Équilibrée</Badge> : <Badge variant="destructive">Déséquilibre</Badge>}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      {state.data && <p className="text-xs text-slate-500">{state.data.total_rows} compte(s) — verdict d'équilibre calculé par le serveur.</p>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────── Grand livre
const GrandLivreVue = () => {
  const [compte, setCompte] = useState('');
  const [devise, setDevise] = useState('USD');
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');
  const [state, setState] = useState({ data: null, error: null, loading: false });

  const load = useCallback(() => {
    if (!compte.trim()) return;
    setState({ data: null, error: null, loading: true });
    accountingApi.grandLivre({ compte: compte.trim(), devise, debut: debut || undefined, fin: fin || undefined })
      .then((d) => setState({ data: d, error: null, loading: false }))
      .catch((e) => setState({ data: null, error: e, loading: false }));
  }, [compte, devise, debut, fin]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label className="text-[10px] uppercase text-slate-500">Compte (code ou racine)</Label><Input className="w-40 font-mono" placeholder="413FC ou 413" value={compte} onChange={(e) => setCompte(e.target.value)} /></div>
        <div>
          <Label className="text-[10px] uppercase text-slate-500">Devise</Label>
          <Select value={devise} onValueChange={setDevise}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{DEVISES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label className="text-[10px] uppercase text-slate-500">Du</Label><Input type="date" className="w-40" value={debut} onChange={(e) => setDebut(e.target.value)} /></div>
        <div><Label className="text-[10px] uppercase text-slate-500">Au</Label><Input type="date" className="w-40" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
        <Button onClick={load} disabled={!compte.trim()}><BookOpen className="w-4 h-4 mr-2" /> Afficher</Button>
      </div>
      {!compte.trim() ? <EmptyState label="Saisissez un compte pour afficher son grand livre." />
        : state.error ? <ErrorState error={state.error} onRetry={load} />
        : state.loading ? <Loading label="Chargement du grand livre…" />
        : !state.data ? <EmptyState label="Cliquez sur Afficher." />
        : (
          <div className="overflow-auto max-h-[50vh] rounded-lg border border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Pièce</TableHead><TableHead>Journal</TableHead><TableHead>Libellé</TableHead>
                  <TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Solde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-slate-900/40">
                  <TableCell colSpan={6} className="text-right text-xs text-slate-400">Report à nouveau</TableCell>
                  <TableCell className="text-right font-mono text-slate-300">{formatMontantDevise(state.data.report, null, { decimales: 2 })}</TableCell>
                </TableRow>
                {state.data.mouvements.map((m, i) => (
                  <TableRow key={i} className="border-slate-800">
                    <TableCell className="text-xs text-slate-400">{m.date || '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{m.reference}</TableCell>
                    <TableCell><Badge variant="secondary">{m.journal}</Badge></TableCell>
                    <TableCell className="text-sm">{m.libelle}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-400">{formatMontantDevise(m.debit, null, { decimales: 2 })}</TableCell>
                    <TableCell className="text-right font-mono text-red-400">{formatMontantDevise(m.credit, null, { decimales: 2 })}</TableCell>
                    <TableCell className="text-right font-mono text-white">{formatMontantDevise(m.solde, null, { decimales: 2 })}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-slate-900/50 font-bold">
                  <TableCell colSpan={4} className="text-right text-slate-200">Totaux ({state.data.devise})</TableCell>
                  <TableCell className="text-right font-mono text-white">{formatMontantDevise(state.data.totalDebit, null, { decimales: 2 })}</TableCell>
                  <TableCell className="text-right font-mono text-white">{formatMontantDevise(state.data.totalCredit, null, { decimales: 2 })}</TableCell>
                  <TableCell className="text-right font-mono text-white">{formatMontantDevise(state.data.solde, null, { decimales: 2 })}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      {state.data && <p className="text-xs text-slate-500">{state.data.totalRows} mouvement(s) — compte {state.data.compte}.</p>}
    </div>
  );
};

// ─────────────────────────────────────────────────────── Journaux auxiliaires
const JournauxVue = () => {
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.journaux({ debut: debut || undefined, fin: fin || undefined })
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, [debut, fin]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label className="text-[10px] uppercase text-slate-500">Du</Label><Input type="date" className="w-40" value={debut} onChange={(e) => setDebut(e.target.value)} /></div>
        <div><Label className="text-[10px] uppercase text-slate-500">Au</Label><Input type="date" className="w-40" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
      </div>
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Chargement des journaux…" />
        : state.data.results.length === 0 ? <EmptyState label="Aucun journal mouvementé sur la période." />
        : (
          <div className="space-y-3">
            {state.data.results.map((j) => (
              <div key={j.journal} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-200">{libelleJournal(j.journal)} <span className="text-xs text-slate-500 font-mono">({j.journal})</span></span>
                  <Badge variant="secondary">{j.nombrePieces} pièce(s)</Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Devise</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Équilibre</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {j.devises.map((d) => (
                      <TableRow key={d.devise} className="border-slate-800">
                        <TableCell><Badge variant="secondary">{d.devise}</Badge></TableCell>
                        <TableCell className="text-right font-mono text-emerald-400">{formatMontantDevise(d.debit, null, { decimales: 2 })}</TableCell>
                        <TableCell className="text-right font-mono text-red-400">{formatMontantDevise(d.credit, null, { decimales: 2 })}</TableCell>
                        <TableCell className="text-right">{d.equilibre ? <Badge variant="success">=</Badge> : <Badge variant="destructive">≠</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
    </div>
  );
};

// ─────────────────────────────────────────────────────── Contrôle d'intégrité
const IntegriteVue = () => {
  const [asOf, setAsOf] = useState('');
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.controles.integrite({ as_of: asOf || undefined })
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, [asOf]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div><Label className="text-[10px] uppercase text-slate-500">Arrêté au</Label><Input type="date" className="w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      </div>
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Contrôle en cours…" />
        : (
          <div className="space-y-3">
            <div className={`rounded-lg border p-4 ${state.data.conforme ? 'border-emerald-900/50 bg-emerald-950/20' : 'border-red-900/50 bg-red-950/20'}`}>
              {state.data.conforme
                ? <span className="text-emerald-300 text-sm">Conforme : aucune pièce validée déséquilibrée.</span>
                : <span className="text-red-300 text-sm">{state.data.total_rows} pièce(s) validée(s) déséquilibrée(s) — à contrepasser.</span>}
            </div>
            {state.data.results.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Référence</TableHead><TableHead>Devise</TableHead><TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead><TableHead className="text-right">Écart</TableHead></TableRow></TableHeader>
                <TableBody>
                  {state.data.results.map((a) => (
                    <TableRow key={`${a.reference}-${a.devise}`} className="border-slate-800">
                      <TableCell className="font-mono text-xs">{a.reference}</TableCell>
                      <TableCell><Badge variant="secondary">{a.devise}</Badge></TableCell>
                      <TableCell className="text-right font-mono">{formatMontantDevise(a.debit, null, { decimales: 2 })}</TableCell>
                      <TableCell className="text-right font-mono">{formatMontantDevise(a.credit, null, { decimales: 2 })}</TableCell>
                      <TableCell className="text-right font-mono text-red-400">{formatMontantDevise(a.ecart, null, { decimales: 2 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
    </div>
  );
};

// ────────────────────────────────────────────────────── Rapprochement 588FX
const FxVue = () => {
  const [age, setAge] = useState('48');
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.controles.fx({ ageHeures: Number(age) || 48 })
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, [age]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div><Label className="text-[10px] uppercase text-slate-500">Âge min (heures)</Label><Input type="number" className="w-28" value={age} onChange={(e) => setAge(e.target.value)} /></div>
      </div>
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Rapprochement 588FX…" />
        : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {state.data.soldesTransitoire.map((s) => (
                <div key={s.devise} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                  <div className="text-[10px] uppercase text-slate-500">Solde 588FX {s.devise}</div>
                  <div className="font-mono text-white">{formatMontantDevise(s.solde, s.devise, { decimales: 2 })}</div>
                </div>
              ))}
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <div className="text-[10px] uppercase text-slate-500">Position (contre-valeur {state.data.devisePivot})</div>
                <div className="font-mono text-white">{formatMontantDevise(state.data.positionContreValeur, state.data.devisePivot, { decimales: 2 })}</div>
                <div className="text-[10px] text-slate-500 mt-1">Taux : {state.data.tauxUtilise || 'aucun taux de clôture'}</div>
              </div>
            </div>
            <p className="text-xs text-slate-500">{state.data.note}</p>
            {state.data.results.length === 0
              ? <EmptyState label={`Aucune pièce FX non dénouée depuis plus de ${state.data.ageHeures} h.`} />
              : (
                <Table>
                  <TableHeader><TableRow><TableHead>Référence</TableHead><TableHead>Statut</TableHead><TableHead className="text-right">Âge (h)</TableHead><TableHead className="text-right">Résidu</TableHead><TableHead>Problème</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {state.data.results.map((a) => (
                      <TableRow key={a.reference} className="border-slate-800">
                        <TableCell className="font-mono text-xs">{a.reference}</TableCell>
                        <TableCell><Badge variant={a.statut === 'VALIDEE' ? 'success' : 'info'}>{libelleStatutPiece(a.statut)}</Badge></TableCell>
                        <TableCell className="text-right font-mono">{a.ageHeures}</TableCell>
                        <TableCell className="text-right font-mono text-amber-300">{formatMontantDevise(a.residu, null, { decimales: 2 })}</TableCell>
                        <TableCell className="text-xs text-slate-400">{a.probleme}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
          </div>
        )}
    </div>
  );
};

// ────────────────────────────────────────────────────── Taux appliqués (projection)
const TauxVue = () => {
  const [usage, setUsage] = useState('__tous__');
  const [state, setState] = useState({ data: null, error: null });
  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.taux.list({ usage: usage === '__tous__' ? undefined : usage, limit: 100 })
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, [usage]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div>
          <Label className="text-[10px] uppercase text-slate-500">Usage</Label>
          <Select value={usage} onValueChange={setUsage}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__tous__">Tous usages</SelectItem>
              <SelectItem value="OPERATIONNEL">{libelleUsageTaux('OPERATIONNEL')}</SelectItem>
              <SelectItem value="CLOTURE">{libelleUsageTaux('CLOTURE')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Projection en LECTURE SEULE des taux effectivement appliqués aux écritures. La gouvernance (saisie, validation,
        historique) vit dans l'onglet Taux de Change (module `fx`) — la comptabilité consomme les taux, elle ne les fixe pas.
      </p>
      {state.error ? <ErrorState error={state.error} onRetry={load} />
        : !state.data ? <Loading label="Chargement des taux…" />
        : state.data.results.length === 0 ? <EmptyState label="Aucun taux appliqué pour ce filtre." />
        : (
          <div className="overflow-auto max-h-[48vh] rounded-lg border border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                <TableRow><TableHead>Date</TableHead><TableHead>Usage</TableHead><TableHead>Paire</TableHead><TableHead className="text-right">Taux</TableHead><TableHead>Source</TableHead><TableHead>Provenance</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {state.data.results.map((t) => (
                  <TableRow key={t.id} className="border-slate-800">
                    <TableCell className="text-xs text-slate-400">{t.dateTaux || '—'}</TableCell>
                    <TableCell><Badge variant={t.usage === 'CLOTURE' ? 'info' : 'secondary'}>{libelleUsageTaux(t.usage)}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{t.deviseBase}/{t.deviseContre}</TableCell>
                    <TableCell className="text-right font-mono text-white">{formatMontantDevise(t.taux, null, { decimales: 4 })}</TableCell>
                    <TableCell className="text-xs text-slate-400">{libelleSourceTaux(t.source)}</TableCell>
                    <TableCell className="text-[11px] text-slate-500">{t.provenance}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
    </div>
  );
};

const RestitutionsViewer = () => {
  const [vue, setVue] = useState('balance');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {VUES.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setVue(key)}
            className={`p-3 rounded-lg transition-all text-left flex items-center gap-2 ${vue === key ? 'glass-effect-active' : 'glass-effect'}`}>
            <Icon className={`w-4 h-4 ${vue === key ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span className={`text-xs font-semibold ${vue === key ? 'text-white' : 'text-slate-300'}`}>{label}</span>
          </button>
        ))}
      </div>
      <div className="glass-effect rounded-2xl p-5">
        {vue === 'balance' && <BalanceVue />}
        {vue === 'grandlivre' && <GrandLivreVue />}
        {vue === 'journaux' && <JournauxVue />}
        {vue === 'integrite' && <IntegriteVue />}
        {vue === 'fx' && <FxVue />}
        {vue === 'taux' && <TauxVue />}
      </div>
    </div>
  );
};

export default RestitutionsViewer;

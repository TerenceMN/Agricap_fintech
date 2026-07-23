import React, { useCallback, useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Search, Power, PlusCircle, Check, X } from 'lucide-react';
import {
  accountingApi, formatMontantDevise, libelleNature, libelleStatutDemande, deplierErreur,
} from '@/services/accountingApi';
import { Loading, ErrorState, EmptyState, ErrorList } from './AccountingStates';

const TOUS = '__tous__';

const DemandeForm = ({ onDone }) => {
  const [data, setData] = useState({
    code: '', racine: '', intitule: '', classe: '', nature: 'ACTIF', devise: '',
    cantonnement: '', parentCode: '', justification: '', estTransitoire: false,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const set = (k) => (e) => setData((d) => ({ ...d, [k]: e?.target ? e.target.value : e }));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await accountingApi.comptes.demandes.create({
        ...data,
        classe: Number(data.classe) || 0,
        devise: data.devise || undefined,
      });
      toast({ title: 'Demande enregistrée', description: `Le compte ${data.code} attend un valideur (checker ≠ maker).` });
      onDone?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label className="text-xs">Code</Label><Input value={data.code} onChange={set('code')} placeholder="413FC" /></div>
        <div><Label className="text-xs">Racine</Label><Input value={data.racine} onChange={set('racine')} placeholder="413" /></div>
        <div className="col-span-2"><Label className="text-xs">Intitulé</Label><Input value={data.intitule} onChange={set('intitule')} /></div>
        <div><Label className="text-xs">Classe</Label><Input type="number" value={data.classe} onChange={set('classe')} placeholder="4" /></div>
        <div>
          <Label className="text-xs">Nature</Label>
          <Select value={data.nature} onValueChange={set('nature')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['ACTIF', 'PASSIF', 'CHARGE', 'PRODUIT'].map((n) => <SelectItem key={n} value={n}>{libelleNature(n)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Devise (vide = multi)</Label>
          <Select value={data.devise || TOUS} onValueChange={(v) => set('devise')(v === TOUS ? '' : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TOUS}>—</SelectItem>
              <SelectItem value="FC">FC</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Compte parent</Label><Input value={data.parentCode} onChange={set('parentCode')} placeholder="413" /></div>
        <div className="col-span-2"><Label className="text-xs">Cantonnement (419-OFF-…)</Label><Input value={data.cantonnement} onChange={set('cantonnement')} /></div>
        <div className="col-span-2"><Label className="text-xs">Justification (obligatoire)</Label><Textarea value={data.justification} onChange={set('justification')} rows={2} /></div>
      </div>
      <ErrorList error={error} />
      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy || !data.code || !data.justification}>
          <PlusCircle className="w-4 h-4 mr-2" /> Soumettre la demande
        </Button>
      </div>
    </div>
  );
};

const AccountingPlanComptable = ({ access }) => {
  const can = access?.can || {};
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ classe: '', nature: TOUS, devise: TOUS, actif: TOUS, q: '' });
  const [detail, setDetail] = useState(null);
  const [demandes, setDemandes] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => {
    setPage(null); setError(null);
    accountingApi.comptes.list({
      classe: filters.classe ? Number(filters.classe) : undefined,
      nature: filters.nature === TOUS ? undefined : filters.nature,
      devise: filters.devise === TOUS ? undefined : filters.devise,
      actif: filters.actif === TOUS ? undefined : filters.actif === 'actif',
      q: filters.q || undefined,
      limit: 200,
    }).then(setPage).catch(setError);
  }, [filters]);

  const loadDemandes = useCallback(() => {
    accountingApi.comptes.demandes.list({ limit: 100 }).then(setDemandes).catch(() => setDemandes({ results: [], total_rows: 0 }));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDemandes(); }, [loadDemandes]);

  const openDetail = (code) => {
    setDetail({ code, data: null, error: null });
    accountingApi.comptes.detail(code)
      .then((d) => setDetail({ code, data: d, error: null }))
      .catch((e) => setDetail({ code, data: null, error: e }));
  };

  const toggleActivation = async (compte) => {
    try {
      await accountingApi.comptes.activation(compte.code, !compte.actif, 'Bascule depuis le plan comptable');
      toast({ title: compte.actif ? 'Compte désactivé' : 'Compte réactivé', description: compte.code });
      load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Refusé', description: deplierErreur(e)[0]?.message });
    }
  };

  const decideDemande = async (id, approuver) => {
    try {
      await accountingApi.comptes.demandes.decision(id, approuver, approuver ? 'Approbation' : 'Rejet');
      toast({ title: approuver ? 'Compte créé' : 'Demande rejetée' });
      loadDemandes(); load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Refusé', description: deplierErreur(e)[0]?.message });
    }
  };

  return (
    <div className="space-y-6">
      {/* Filtres */}
      <div className="flex flex-wrap items-end gap-3 bg-slate-900/40 p-4 rounded-xl border border-slate-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input className="pl-10 w-56" placeholder="Code ou intitulé…" value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
        </div>
        <Input type="number" className="w-24" placeholder="Classe" value={filters.classe}
          onChange={(e) => setFilters((f) => ({ ...f, classe: e.target.value }))} />
        <Select value={filters.nature} onValueChange={(v) => setFilters((f) => ({ ...f, nature: v }))}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Nature" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TOUS}>Toutes natures</SelectItem>
            {['ACTIF', 'PASSIF', 'CHARGE', 'PRODUIT'].map((n) => <SelectItem key={n} value={n}>{libelleNature(n)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.devise} onValueChange={(v) => setFilters((f) => ({ ...f, devise: v }))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TOUS}>Devises</SelectItem>
            <SelectItem value="FC">FC</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.actif} onValueChange={(v) => setFilters((f) => ({ ...f, actif: v }))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TOUS}>Actifs + inactifs</SelectItem>
            <SelectItem value="actif">Actifs</SelectItem>
            <SelectItem value="inactif">Inactifs</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Plan comptable */}
      {error ? <ErrorState error={error} onRetry={load} />
        : page === null ? <Loading label="Chargement du plan comptable…" />
        : page.results.length === 0 ? <EmptyState label="Aucun compte pour ces critères." />
        : (
          <div className="overflow-auto max-h-[55vh] rounded-lg border border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>Intitulé</TableHead>
                  <TableHead>Classe</TableHead><TableHead>Nature</TableHead>
                  <TableHead>Devise</TableHead><TableHead>État</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.results.map((c) => (
                  <TableRow key={c.code} className="border-slate-800 cursor-pointer hover:bg-white/5" onClick={() => openDetail(c.code)}>
                    <TableCell className="font-mono text-xs text-emerald-300">{c.code}</TableCell>
                    <TableCell className="text-sm">
                      {c.intitule}
                      {c.estTransitoire && <Badge variant="outline" className="ml-2 text-[10px] text-amber-400 border-amber-700">transitoire</Badge>}
                      {c.cantonnement && <Badge variant="outline" className="ml-2 text-[10px] text-blue-300 border-blue-800">{c.cantonnement}</Badge>}
                    </TableCell>
                    <TableCell className="text-slate-400">{c.classe}</TableCell>
                    <TableCell className="text-slate-400 text-sm">{libelleNature(c.nature)}</TableCell>
                    <TableCell>{c.devise ? <Badge variant="secondary">{c.devise}</Badge> : <span className="text-slate-600 text-xs">multi</span>}</TableCell>
                    <TableCell>{c.actif ? <Badge variant="success">Actif</Badge> : <Badge variant="destructive">Inactif</Badge>}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {can.config && (
                        <Button variant="ghost" size="sm" onClick={() => toggleActivation(c)} title={c.actif ? 'Désactiver' : 'Réactiver'}>
                          <Power className={`w-4 h-4 ${c.actif ? 'text-emerald-400' : 'text-slate-500'}`} />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      {page && <p className="text-xs text-slate-500">{page.results.length} compte(s) affiché(s) sur {page.total_rows}.</p>}

      {/* Demandes d'ouverture (maker-checker) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-200">Ouvertures de compte (maker-checker)</h3>
          {can.create && (
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
              <PlusCircle className="w-4 h-4 mr-2" /> Demander un compte
            </Button>
          )}
        </div>
        {demandes === null ? <Loading label="Chargement des demandes…" />
          : demandes.results.length === 0 ? <EmptyState label="Aucune demande d'ouverture." />
          : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>Intitulé</TableHead><TableHead>Demandé par</TableHead>
                  <TableHead>Statut</TableHead><TableHead className="text-right">Décision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {demandes.results.map((d) => (
                  <TableRow key={d.id} className="border-slate-800">
                    <TableCell className="font-mono text-xs">{d.code}</TableCell>
                    <TableCell className="text-sm">{d.intitule}</TableCell>
                    <TableCell className="text-xs text-slate-400">{d.demandePar}</TableCell>
                    <TableCell>
                      <Badge variant={d.statut === 'APPROUVEE' ? 'success' : d.statut === 'REJETEE' ? 'destructive' : 'info'}>
                        {libelleStatutDemande(d.statut)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {d.statut === 'EN_ATTENTE' && can.config ? (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => decideDemande(d.id, true)} title="Approuver">
                            <Check className="w-4 h-4 text-emerald-400" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => decideDemande(d.id, false)} title="Rejeter">
                            <X className="w-4 h-4 text-red-400" />
                          </Button>
                        </div>
                      ) : d.decidePar ? <span className="text-xs text-slate-500">par {d.decidePar}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </div>

      {/* Détail compte */}
      <Dialog open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="glass-effect text-white border-slate-700 sm:max-w-[520px]">
          <DialogHeader><DialogTitle className="font-mono">{detail?.code}</DialogTitle></DialogHeader>
          {detail?.error ? <ErrorState error={detail.error} />
            : !detail?.data ? <Loading />
            : (
              <div className="space-y-3 text-sm">
                <div className="text-slate-300">{detail.data.intitule}</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">Classe {detail.data.classe}</Badge>
                  <Badge variant="outline">{libelleNature(detail.data.nature)}</Badge>
                  {detail.data.devise && <Badge variant="secondary">{detail.data.devise}</Badge>}
                  <Badge variant={detail.data.actif ? 'success' : 'destructive'}>{detail.data.actif ? 'Actif' : 'Inactif'}</Badge>
                  <Badge variant={detail.data.mouvemente ? 'info' : 'outline'}>{detail.data.mouvemente ? 'Mouvementé' : 'Sans mouvement'}</Badge>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-500 mb-1">Soldes (calculés par le serveur)</div>
                  <Table>
                    <TableBody>
                      {(detail.data.soldes || []).map((s) => (
                        <TableRow key={s.devise} className="border-slate-800">
                          <TableCell className="text-slate-400">{s.devise}</TableCell>
                          <TableCell className="text-right font-mono text-white">{formatMontantDevise(s.solde, s.devise, { decimales: 2 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
        </DialogContent>
      </Dialog>

      {/* Formulaire de demande */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="glass-effect text-white border-slate-700 sm:max-w-[560px]">
          <DialogHeader><DialogTitle>Nouvelle demande d'ouverture de compte</DialogTitle></DialogHeader>
          <DemandeForm onDone={() => { setShowForm(false); loadDemandes(); }} />
          <DialogFooter />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AccountingPlanComptable;

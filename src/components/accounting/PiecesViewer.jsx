import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { PlusCircle, Trash2, Check, Undo2, BookOpenCheck, ScrollText, Search } from 'lucide-react';
import {
  accountingApi, formatMontantDevise, libelleJournal, libelleStatutPiece, libelleSens,
  pieceEquilibree, peutValider, peutContrepasser, deplierErreur,
} from '@/services/accountingApi';
import { Loading, ErrorState, EmptyState, ErrorList } from './AccountingStates';

const TOUS = '__tous__';
const JOURNAUX = ['JCR', 'JEP', 'JCA', 'JMM', 'JFX', 'JIN', 'JOD'];
const STATUTS = ['BROUILLON', 'VALIDEE'];
const DEVISES = ['FC', 'USD'];

const ligneVide = () => ({ compte: '', devise: 'FC', debit: '', credit: '', libelle: '' });

// Éditeur de lignes d'écriture. Le front NE TOTALISE PAS et n'affiche AUCUN verdict d'équilibre :
// il transmet ce que l'utilisateur tape ; c'est le serveur qui arbitre (Σ débit = Σ crédit par
// devise) et renvoie soit un 422 déplié, soit la pièce avec ses totaux calculés.
const LignesEditor = ({ lignes, onChange }) => {
  const set = (i, k) => (e) => {
    const v = e?.target ? e.target.value : e;
    onChange(lignes.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  };
  const removeLine = (i) => onChange(lignes.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1.2fr_0.8fr_1fr_1fr_1.4fr_auto] gap-2 text-[10px] uppercase text-slate-500 px-1">
        <span>Compte</span><span>Devise</span><span>Débit</span><span>Crédit</span><span>Libellé</span><span />
      </div>
      {lignes.map((l, i) => (
        <div key={i} className="grid grid-cols-[1.2fr_0.8fr_1fr_1fr_1.4fr_auto] gap-2 items-center">
          <Input value={l.compte} onChange={set(i, 'compte')} placeholder="413FC" className="font-mono text-xs" />
          <Select value={l.devise} onValueChange={set(i, 'devise')}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{DEVISES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={l.debit} onChange={set(i, 'debit')} placeholder="0.00" inputMode="decimal" className="font-mono text-xs text-right" />
          <Input value={l.credit} onChange={set(i, 'credit')} placeholder="0.00" inputMode="decimal" className="font-mono text-xs text-right" />
          <Input value={l.libelle} onChange={set(i, 'libelle')} placeholder="(optionnel)" className="text-xs" />
          <Button variant="ghost" size="sm" onClick={() => removeLine(i)} disabled={lignes.length <= 1} title="Retirer la ligne">
            <Trash2 className="w-4 h-4 text-red-400" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...lignes, ligneVide()])}>
        <PlusCircle className="w-4 h-4 mr-2" /> Ajouter une ligne
      </Button>
    </div>
  );
};

// ─────────────────────────────────────────────────── Formulaire de saisie OD (maker)
const SaisieODForm = ({ onDone }) => {
  const [libelle, setLibelle] = useState('');
  const [dateOperation, setDateOperation] = useState('');
  const [lignes, setLignes] = useState([ligneVide(), ligneVide()]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const piece = await accountingApi.pieces.od({
        libelle,
        dateOperation: dateOperation || undefined,
        lignes: lignes
          .filter((l) => l.compte.trim())
          .map((l) => ({
            compte: l.compte.trim(),
            devise: l.devise,
            debit: l.debit || '0',
            credit: l.credit || '0',
            libelle: l.libelle || '',
          })),
      });
      toast({ title: 'OD enregistrée en brouillon', description: `${piece.reference} — un checker distinct devra la valider.` });
      onDone?.(piece);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-slate-900/60 border border-slate-800 p-3 text-xs text-slate-400">
        La saisie manuelle est cantonnée au <span className="font-mono text-amber-300">JOD</span> (opérations diverses :
        salaires, charges, régularisations). Une écriture de crédit ou d'épargne naît d'un événement métier et passe par
        le catalogue — elle ne se saisit pas ici. L'équilibre par devise est arbitré par le serveur au moment de l'enregistrement.
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Label className="text-xs">Libellé de l'OD (obligatoire)</Label>
          <Input value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="Régularisation charge loyer" />
        </div>
        <div>
          <Label className="text-xs">Date d'opération</Label>
          <Input type="date" value={dateOperation} onChange={(e) => setDateOperation(e.target.value)} />
        </div>
      </div>
      <LignesEditor lignes={lignes} onChange={setLignes} />
      <ErrorList error={error} />
      <div className="flex justify-end">
        <Button onClick={submit} disabled={busy || !libelle.trim() || !lignes.some((l) => l.compte.trim())}>
          <PlusCircle className="w-4 h-4 mr-2" /> Enregistrer le brouillon
        </Button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────── Contrepassation (checker)
const ContrepassationForm = ({ reference, onDone }) => {
  const [motif, setMotif] = useState('');
  const [avecRectif, setAvecRectif] = useState(false);
  const [lignes, setLignes] = useState([ligneVide(), ligneVide()]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await accountingApi.pieces.contrepasser(reference, {
        motif,
        lignesRectificatives: avecRectif
          ? lignes.filter((l) => l.compte.trim()).map((l) => ({
            compte: l.compte.trim(), devise: l.devise,
            debit: l.debit || '0', credit: l.credit || '0', libelle: l.libelle || '',
          }))
          : undefined,
      });
      toast({
        title: 'Pièce contrepassée',
        description: `Inverse ${res.contrepassation.reference}${res.rectification ? ` + rectification ${res.rectification.reference}` : ''}.`,
      });
      onDone?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        On ne modifie jamais une pièce validée : on la contrepasse (écriture inverse liée). Une rectification
        optionnelle passe une nouvelle écriture, les trois restant liées et traçables.
      </p>
      <div>
        <Label className="text-xs">Motif (obligatoire)</Label>
        <Textarea value={motif} onChange={(e) => setMotif(e.target.value)} rows={2} placeholder="Erreur d'imputation compte 613 au lieu de 623" />
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={avecRectif} onChange={(e) => setAvecRectif(e.target.checked)} />
        Ajouter une écriture rectificative
      </label>
      {avecRectif && <LignesEditor lignes={lignes} onChange={setLignes} />}
      <ErrorList error={error} />
      <div className="flex justify-end">
        <Button variant="destructive" onClick={submit} disabled={busy || !motif.trim()}>
          <Undo2 className="w-4 h-4 mr-2" /> Contrepasser
        </Button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────── Détail d'une pièce
const DetailPiece = ({ reference, access, onChanged }) => {
  const { can = {}, sub = '' } = access || {};
  const [state, setState] = useState({ data: null, error: null });
  const [contrepasser, setContrepasser] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const load = useCallback(() => {
    setState({ data: null, error: null });
    accountingApi.pieces.detail(reference)
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, [reference]);

  useEffect(() => { load(); }, [load]);

  const valider = async () => {
    setBusy(true);
    try {
      await accountingApi.pieces.valider(reference);
      toast({ title: 'Pièce validée', description: reference });
      load(); onChanged?.();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Validation refusée', description: deplierErreur(e)[0]?.message });
    } finally {
      setBusy(false);
    }
  };

  if (state.error) return <ErrorState error={state.error} onRetry={load} />;
  if (!state.data) return <Loading label="Chargement de la pièce…" />;
  const p = state.data;
  const equilibre = pieceEquilibree(p.totaux);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{libelleJournal(p.journal)}</Badge>
        <Badge variant={p.statut === 'VALIDEE' ? 'success' : 'info'}>{libelleStatutPiece(p.statut)}</Badge>
        {p.saisieManuelle && <Badge variant="outline" className="text-amber-400 border-amber-700">Saisie manuelle</Badge>}
        {equilibre === true && <Badge variant="success">Équilibrée (serveur)</Badge>}
        {equilibre === false && <Badge variant="destructive">Déséquilibrée</Badge>}
      </div>
      <div className="text-slate-300">{p.libelle}</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400">
        <div>Date : <span className="text-slate-200">{p.dateOperation || '—'}</span></div>
        <div>Événement : <span className="text-slate-200">{p.evenement || '—'}</span></div>
        <div>Saisie par : <span className="text-slate-200">{p.creePar || '—'}</span></div>
        <div>Validée par : <span className="text-slate-200">{p.validePar || '—'}</span></div>
        {p.pieceContrepassee && <div>Contrepasse : <span className="font-mono text-slate-200">{p.pieceContrepassee}</span></div>}
        {p.pieceRectifiee && <div>Rectifie : <span className="font-mono text-slate-200">{p.pieceRectifiee}</span></div>}
      </div>

      <div className="overflow-auto rounded-lg border border-slate-800">
        <Table>
          <TableHeader className="bg-slate-900/60">
            <TableRow>
              <TableHead>Compte</TableHead><TableHead>Intitulé</TableHead><TableHead>Devise</TableHead>
              <TableHead className="text-right">Débit</TableHead><TableHead className="text-right">Crédit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(p.lignes || []).map((l) => (
              <TableRow key={l.id} className="border-slate-800">
                <TableCell className="font-mono text-xs text-emerald-300">{l.compte}</TableCell>
                <TableCell className="text-xs text-slate-400">{l.intitule}</TableCell>
                <TableCell><Badge variant="secondary">{l.devise}</Badge></TableCell>
                <TableCell className="text-right font-mono text-emerald-400">{formatMontantDevise(l.debit, null, { decimales: 2, vide: '—' })}</TableCell>
                <TableCell className="text-right font-mono text-red-400">{formatMontantDevise(l.credit, null, { decimales: 2, vide: '—' })}</TableCell>
              </TableRow>
            ))}
            {(p.totaux || []).map((t) => (
              <TableRow key={`tot-${t.devise}`} className="bg-slate-900/40 font-semibold">
                <TableCell colSpan={2} className="text-right text-slate-300">Total {t.devise}</TableCell>
                <TableCell>{t.equilibre ? <Badge variant="success">=</Badge> : <Badge variant="destructive">≠</Badge>}</TableCell>
                <TableCell className="text-right font-mono text-white">{formatMontantDevise(t.debit, null, { decimales: 2 })}</TableCell>
                <TableCell className="text-right font-mono text-white">{formatMontantDevise(t.credit, null, { decimales: 2 })}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {p.residuFx !== undefined && (
        <div className="text-xs text-slate-400">
          Résidu transitoire 588FX : <span className="font-mono text-amber-300">{p.residuFx ?? p.residuFxProbleme ?? '—'}</span>
        </div>
      )}
      {(p.contrepassations?.length > 0 || p.rectifications?.length > 0) && (
        <div className="text-xs text-slate-400 space-x-2">
          {p.contrepassations?.map((r) => <Badge key={r} variant="outline" className="font-mono">↩ {r}</Badge>)}
          {p.rectifications?.map((r) => <Badge key={r} variant="outline" className="font-mono">✎ {r}</Badge>)}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
        {peutValider(p, sub, Boolean(can.validate)) && (
          <Button onClick={valider} disabled={busy}>
            <Check className="w-4 h-4 mr-2" /> Valider (checker)
          </Button>
        )}
        {p.statut === 'BROUILLON' && can.validate && p.creePar === sub && (
          <span className="text-xs text-slate-500 self-center">Vous avez saisi cette pièce : un autre agent doit la valider.</span>
        )}
        {peutContrepasser(p, Boolean(can.validate)) && (
          <Button variant="outline" onClick={() => setContrepasser(true)}>
            <Undo2 className="w-4 h-4 mr-2" /> Contrepasser
          </Button>
        )}
      </div>

      <Dialog open={contrepasser} onOpenChange={setContrepasser}>
        <DialogContent className="glass-effect text-white border-slate-700 sm:max-w-[560px]">
          <DialogHeader><DialogTitle>Contrepasser {reference}</DialogTitle></DialogHeader>
          <ContrepassationForm reference={reference} onDone={() => { setContrepasser(false); load(); onChanged?.(); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ────────────────────────────────────────────────────── Catalogue (référence)
const CatalogueViewer = () => {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    accountingApi.catalogue()
      .then((d) => setState({ data: d, error: null }))
      .catch((e) => setState({ data: null, error: e }));
  }, []);
  if (state.error) return <ErrorState error={state.error} />;
  if (!state.data) return <Loading label="Chargement du catalogue…" />;
  if (state.data.results.length === 0) return <EmptyState label="Aucun schéma d'écriture au catalogue." />;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        Schémas d'écritures automatiques (annexe B). Ils décrivent comment chaque événement métier génère sa pièce —
        c'est pourquoi la saisie manuelle est limitée aux OD : le reste naît d'ici.
      </p>
      <div className="overflow-auto max-h-[55vh] rounded-lg border border-slate-800">
        <Table>
          <TableHeader className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
            <TableRow>
              <TableHead>Code</TableHead><TableHead>Libellé</TableHead><TableHead>Journal</TableHead>
              <TableHead>Lignes (sens · racine)</TableHead><TableHead>État</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.data.results.map((s) => (
              <TableRow key={s.code} className="border-slate-800 align-top">
                <TableCell className="font-mono text-xs text-emerald-300">{s.code}</TableCell>
                <TableCell className="text-sm">{s.libelle}<div className="text-[11px] text-slate-500">{s.description}</div></TableCell>
                <TableCell><Badge variant="secondary">{libelleJournal(s.journal)}</Badge></TableCell>
                <TableCell className="text-xs">
                  {s.lignes.map((l) => (
                    <div key={l.ordre} className="text-slate-400">
                      <span className={l.sens === 'DEBIT' ? 'text-emerald-400' : 'text-red-400'}>{libelleSens(l.sens)}</span>
                      {' '}<span className="font-mono">{l.compteRacine}</span>
                      {l.condition && <span className="text-slate-600"> — si {l.condition}</span>}
                    </div>
                  ))}
                </TableCell>
                <TableCell>{s.actif ? <Badge variant="success">Actif v{s.version}</Badge> : <Badge variant="outline">Inactif</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────────── Écran principal
const PiecesViewer = ({ access }) => {
  const can = access?.can || {};
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ journal: TOUS, statut: TOUS, debut: '', fin: '', reference: '' });
  const [detail, setDetail] = useState(null);
  const [saisie, setSaisie] = useState(false);
  const [catalogue, setCatalogue] = useState(false);

  const load = useCallback(() => {
    setPage(null); setError(null);
    accountingApi.pieces.list({
      journal: filters.journal === TOUS ? undefined : filters.journal,
      statut: filters.statut === TOUS ? undefined : filters.statut,
      debut: filters.debut || undefined,
      fin: filters.fin || undefined,
      reference: filters.reference || undefined,
      lignes: true, // pour lire le verdict d'équilibre SERVEUR par ligne
      limit: 50,
    }).then(setPage).catch(setError);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => page?.results || [], [page]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-slate-900/40 p-4 rounded-xl border border-slate-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input className="pl-10 w-52" placeholder="Référence…" value={filters.reference}
            onChange={(e) => setFilters((f) => ({ ...f, reference: e.target.value }))} />
        </div>
        <Select value={filters.journal} onValueChange={(v) => setFilters((f) => ({ ...f, journal: v }))}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Journal" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TOUS}>Tous journaux</SelectItem>
            {JOURNAUX.map((j) => <SelectItem key={j} value={j}>{libelleJournal(j)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.statut} onValueChange={(v) => setFilters((f) => ({ ...f, statut: v }))}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TOUS}>Tous statuts</SelectItem>
            {STATUTS.map((s) => <SelectItem key={s} value={s}>{libelleStatutPiece(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div><Label className="text-[10px] uppercase text-slate-500">Du</Label><Input type="date" className="w-40" value={filters.debut} onChange={(e) => setFilters((f) => ({ ...f, debut: e.target.value }))} /></div>
        <div><Label className="text-[10px] uppercase text-slate-500">Au</Label><Input type="date" className="w-40" value={filters.fin} onChange={(e) => setFilters((f) => ({ ...f, fin: e.target.value }))} /></div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setCatalogue(true)}><BookOpenCheck className="w-4 h-4 mr-2" /> Catalogue</Button>
          {can.create && (
            <Button onClick={() => setSaisie(true)}><ScrollText className="w-4 h-4 mr-2" /> Saisir une OD</Button>
          )}
        </div>
      </div>

      {error ? <ErrorState error={error} onRetry={load} />
        : page === null ? <Loading label="Chargement des pièces…" />
        : rows.length === 0 ? <EmptyState label="Aucune pièce pour ces critères." hint="Le socle comptable n'est pas encore alimenté par les événements métier (décaissements, dépôts) : hors OD, les pièces restent à brancher côté backend." />
        : (
          <div className="overflow-auto max-h-[55vh] rounded-lg border border-slate-800">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                <TableRow>
                  <TableHead>Référence</TableHead><TableHead>Date</TableHead><TableHead>Journal</TableHead>
                  <TableHead>Libellé</TableHead><TableHead>Équilibre</TableHead><TableHead>Statut</TableHead><TableHead>Saisie par</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const eq = pieceEquilibree(p.totaux);
                  return (
                    <TableRow key={p.reference} className="border-slate-800 cursor-pointer hover:bg-white/5" onClick={() => setDetail(p.reference)}>
                      <TableCell className="font-mono text-xs text-emerald-300">{p.reference}</TableCell>
                      <TableCell className="text-slate-400 text-xs">{p.dateOperation || '—'}</TableCell>
                      <TableCell><Badge variant="secondary">{p.journal}</Badge></TableCell>
                      <TableCell className="text-sm">{p.libelle}</TableCell>
                      <TableCell>
                        {eq === true ? <Badge variant="success">=</Badge> : eq === false ? <Badge variant="destructive">≠</Badge> : <span className="text-slate-600">—</span>}
                      </TableCell>
                      <TableCell><Badge variant={p.statut === 'VALIDEE' ? 'success' : 'info'}>{libelleStatutPiece(p.statut)}</Badge></TableCell>
                      <TableCell className="text-xs text-slate-400">{p.creePar || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      {page && <p className="text-xs text-slate-500">{rows.length} pièce(s) affichée(s) sur {page.total_rows}.</p>}

      {/* Détail */}
      <Dialog open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="glass-effect text-white border-slate-700 sm:max-w-[720px]">
          <DialogHeader><DialogTitle className="font-mono">{detail}</DialogTitle></DialogHeader>
          {detail && <DetailPiece reference={detail} access={access} onChanged={load} />}
        </DialogContent>
      </Dialog>

      {/* Saisie OD */}
      <Dialog open={saisie} onOpenChange={setSaisie}>
        <DialogContent className="glass-effect text-white border-slate-700 sm:max-w-[720px]">
          <DialogHeader><DialogTitle>Saisir une opération diverse (OD)</DialogTitle></DialogHeader>
          <SaisieODForm onDone={() => { setSaisie(false); load(); }} />
          <DialogFooter />
        </DialogContent>
      </Dialog>

      {/* Catalogue */}
      <Dialog open={catalogue} onOpenChange={setCatalogue}>
        <DialogContent className="glass-effect text-white border-slate-700 sm:max-w-[820px]">
          <DialogHeader><DialogTitle>Catalogue des écritures automatiques</DialogTitle></DialogHeader>
          <CatalogueViewer />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PiecesViewer;

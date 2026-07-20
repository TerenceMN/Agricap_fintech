import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import { UserPlus, Plus, Trash2, FileUp, CheckCircle2 } from 'lucide-react';

const EMPTY_BESOIN = { rubrique: '', unite: '', quantite: '', cout_unitaire: '', frequence: 1, periode: '' };
const EMPTY_VENTE = { produit: '', quantite: '', unite: '', taux_perte: '', prix_unitaire: '', mois_vente: '' };

// « Ajouter » = créer une DEMANDE qui suit les documents (besoins/ventes ou import du
// classeur), passe par le MOTEUR (vérification contre le référentiel selon la filière),
// est enregistrée, puis rattachée au portefeuille de gestion.
const CreditFormDialog = ({ open, onOpenChange, onCreated }) => {
  const { toast } = useToast();
  const [client, setClient] = useState({ client_name: '', client_phone: '', garantie_estimee: '' });
  const [besoins, setBesoins] = useState([{ ...EMPTY_BESOIN }]);
  const [ventes, setVentes] = useState([{ ...EMPTY_VENTE }]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const setC = (k, v) => setClient((c) => ({ ...c, [k]: v }));
  const setB = (i, k, v) => setBesoins((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const setV = (i, k, v) => setVentes((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const reset = () => {
    setClient({ client_name: '', client_phone: '', garantie_estimee: '' });
    setBesoins([{ ...EMPTY_BESOIN }]); setVentes([{ ...EMPTY_VENTE }]); setFile(null); setResult(null);
  };

  const attach = async (code) => { try { await api.portfolio.fromApplication(code); } catch { /* la source reste analysée */ } };

  const submitForm = async () => {
    if (!client.client_name.trim()) { toast({ variant: 'destructive', title: 'Erreur', description: 'Le bénéficiaire est requis.' }); return; }
    const cleanB = besoins.filter((b) => b.rubrique.trim());
    if (cleanB.length === 0) { toast({ variant: 'destructive', title: 'Erreur', description: 'Au moins une ligne de besoin.' }); return; }
    setBusy(true);
    try {
      const res = await api.analyseForm({ ...client, besoins: cleanB, ventes: ventes.filter((v) => v.produit.trim()) });
      await attach(res.code);
      setResult(res);
      toast({ title: 'Demande analysée', description: `${res.code} — ${res.chaine_valeur?.libelle || ''}` });
      onCreated?.();
    } catch (e) { toast({ variant: 'destructive', title: 'Échec', description: e.message }); }
    finally { setBusy(false); }
  };

  const submitUpload = async () => {
    if (!file) { toast({ variant: 'destructive', title: 'Erreur', description: 'Choisissez un classeur.' }); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (client.client_name) fd.append('client_name', client.client_name);
      if (client.client_phone) fd.append('client_phone', client.client_phone);
      if (client.garantie_estimee) fd.append('garantie_estimee', client.garantie_estimee);
      const res = await api.analyseUpload(fd);
      await attach(res.code);
      setResult(res);
      toast({ title: 'Dossier analysé', description: `${res.code} — ${res.chaine_valeur?.libelle || ''}` });
      onCreated?.();
    } catch (e) { toast({ variant: 'destructive', title: 'Échec', description: e.message }); }
    finally { setBusy(false); }
  };

  const close = () => { reset(); onOpenChange(false); };

  const verdictColor = (v) => v.startsWith('OK') || v === 'JUSTIFIÉ' ? 'text-emerald-400'
    : v.startsWith('NON ÉVALUABLE') ? 'text-slate-400' : 'text-amber-400';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="glass-effect text-white max-w-3xl border-slate-700 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5 text-emerald-400" /> Nouvelle demande de crédit</DialogTitle>
          <DialogDescription>La demande suit les documents, est vérifiée contre le référentiel selon la filière, puis enregistrée.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-400"><CheckCircle2 className="w-5 h-5" /> Demande enregistrée : <span className="font-mono">{result.code}</span>
              {result.analyse_ia?.used && <Badge variant="outline" className="text-violet-300 border-violet-500/40 bg-violet-500/10">Analyse IA</Badge>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-slate-800/50 p-3 rounded-lg"><p className="text-xs text-slate-400">Filière</p><p className="font-bold">{result.chaine_valeur?.libelle || '—'}</p></div>
              <div className="bg-slate-800/50 p-3 rounded-lg"><p className="text-xs text-slate-400">Décision</p><p className="font-bold text-sm">{result.decision_suggeree?.code || '—'}</p></div>
              <div className="bg-slate-800/50 p-3 rounded-lg"><p className="text-xs text-slate-400">Score</p><p className="font-bold">{result.score?.global ?? '—'}/100</p></div>
              <div className="bg-slate-800/50 p-3 rounded-lg"><p className="text-xs text-slate-400">Statut</p><p className="font-bold text-sm">{result.statut}</p></div>
            </div>
            <div>
              <p className="font-semibold text-sm mb-2">Vérification contre le référentiel</p>
              <div className="rounded-lg border border-slate-700 divide-y divide-slate-800 max-h-52 overflow-y-auto">
                {(result.vraisemblance || []).map((v, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="text-slate-300">{v.controle}</span>
                    <span className={verdictColor(v.verdict)}>{v.verdict}</span>
                  </div>
                ))}
                {(result.vraisemblance || []).length === 0 && <div className="px-3 py-2 text-xs text-slate-500">Aucun contrôle.</div>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={reset}>Nouvelle demande</Button>
              <Button onClick={close} className="bg-gradient-to-r from-emerald-500 to-blue-600">Terminer</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label>Bénéficiaire *</Label><Input value={client.client_name} onChange={(e) => setC('client_name', e.target.value)} className="bg-slate-900 border-slate-700" /></div>
              <div><Label>Téléphone</Label><Input value={client.client_phone} onChange={(e) => setC('client_phone', e.target.value)} className="bg-slate-900 border-slate-700" /></div>
              <div><Label>Garantie estimée (USD)</Label><Input type="number" value={client.garantie_estimee} onChange={(e) => setC('garantie_estimee', e.target.value)} className="bg-slate-900 border-slate-700" /></div>
            </div>

            <Tabs defaultValue="form" className="mt-2">
              <TabsList className="grid w-full grid-cols-2 bg-slate-800/50">
                <TabsTrigger value="form">Saisie (besoins & ventes)</TabsTrigger>
                <TabsTrigger value="upload">Importer le classeur</TabsTrigger>
              </TabsList>

              <TabsContent value="form" className="space-y-4 mt-4">
                <div>
                  <div className="flex items-center justify-between mb-1"><Label>Besoins financiers</Label>
                    <Button size="sm" variant="ghost" onClick={() => setBesoins((r) => [...r, { ...EMPTY_BESOIN }])}><Plus className="w-3 h-3 mr-1" />Ligne</Button>
                  </div>
                  <div className="space-y-2">
                    {besoins.map((b, i) => (
                      <div key={i} className="grid grid-cols-12 gap-1 items-center">
                        <Input placeholder="Rubrique" value={b.rubrique} onChange={(e) => setB(i, 'rubrique', e.target.value)} className="col-span-3 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Input placeholder="Unité" value={b.unite} onChange={(e) => setB(i, 'unite', e.target.value)} className="col-span-2 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Input placeholder="Qté" type="number" value={b.quantite} onChange={(e) => setB(i, 'quantite', e.target.value)} className="col-span-1 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Input placeholder="Coût U." type="number" value={b.cout_unitaire} onChange={(e) => setB(i, 'cout_unitaire', e.target.value)} className="col-span-2 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Input placeholder="Fréq." type="number" value={b.frequence} onChange={(e) => setB(i, 'frequence', e.target.value)} className="col-span-1 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Input placeholder="Période" value={b.periode} onChange={(e) => setB(i, 'periode', e.target.value)} className="col-span-2 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Button size="icon" variant="ghost" className="col-span-1 h-8 w-8" onClick={() => setBesoins((r) => r.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3 text-red-400" /></Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1"><Label>Prévisions de ventes</Label>
                    <Button size="sm" variant="ghost" onClick={() => setVentes((r) => [...r, { ...EMPTY_VENTE }])}><Plus className="w-3 h-3 mr-1" />Ligne</Button>
                  </div>
                  <div className="space-y-2">
                    {ventes.map((v, i) => (
                      <div key={i} className="grid grid-cols-12 gap-1 items-center">
                        <Input placeholder="Produit" value={v.produit} onChange={(e) => setV(i, 'produit', e.target.value)} className="col-span-3 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Input placeholder="Qté" type="number" value={v.quantite} onChange={(e) => setV(i, 'quantite', e.target.value)} className="col-span-2 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Input placeholder="Unité" value={v.unite} onChange={(e) => setV(i, 'unite', e.target.value)} className="col-span-2 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Input placeholder="Perte (0-1)" type="number" step="0.01" value={v.taux_perte} onChange={(e) => setV(i, 'taux_perte', e.target.value)} className="col-span-2 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Input placeholder="Prix U." type="number" value={v.prix_unitaire} onChange={(e) => setV(i, 'prix_unitaire', e.target.value)} className="col-span-2 bg-slate-900 border-slate-700 h-8 text-xs" />
                        <Button size="icon" variant="ghost" className="col-span-1 h-8 w-8" onClick={() => setVentes((r) => r.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3 text-red-400" /></Button>
                      </div>
                    ))}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={close}>Annuler</Button>
                  <Button onClick={submitForm} disabled={busy} className="bg-gradient-to-r from-emerald-500 to-blue-600">{busy ? 'Analyse…' : 'Analyser & enregistrer'}</Button>
                </DialogFooter>
              </TabsContent>

              <TabsContent value="upload" className="space-y-4 mt-4">
                <div className="border border-dashed border-slate-600 rounded-xl p-6 text-center">
                  <FileUp className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                  <Input type="file" accept=".xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="bg-slate-900 border-slate-700" />
                  <p className="text-xs text-slate-400 mt-2">Classeur d'annexe / simulateur (format AGRICAP). {file && <Badge variant="outline" className="ml-2">{file.name}</Badge>}</p>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={close}>Annuler</Button>
                  <Button onClick={submitUpload} disabled={busy} className="bg-gradient-to-r from-emerald-500 to-blue-600">{busy ? 'Analyse…' : 'Analyser & enregistrer'}</Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreditFormDialog;

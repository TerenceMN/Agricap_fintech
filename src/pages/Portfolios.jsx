import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Briefcase, SlidersHorizontal, Bell, ShieldAlert, BarChart2, Leaf, History } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import { formatCurrency } from '@/lib/investorSpaceUtils';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b'];

const Portfolios = () => {
  const { toast } = useToast();
  const [subPortfolios, setSubPortfolios] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [allocation, setAllocation] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    try {
      const [portfolios, subs, alloc] = await Promise.all([
        api.investments.subPortfolios.list(),
        api.investments.subscriptions.mine(),
        api.investments.portfolioAllocation(),
      ]);
      setSubPortfolios(portfolios);
      setSubscriptions(subs);
      setAllocation(alloc);
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' });
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.investments.subPortfolios.create(newName, newDescription);
      setIsCreateOpen(false);
      setNewName('');
      setNewDescription('');
      loadData();
      toast({ title: 'Succès', description: 'Portefeuille créé.' });
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Création impossible.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleNotAvailable = (label) => toast({
    title: label,
    description: "Non disponible : aucune fonctionnalité correspondante côté serveur pour le moment.",
  });

  const totalAUM = (allocation?.bonds || 0) + (allocation?.cash || 0) + (allocation?.stocks || 0);
  const allocationData = allocation ? [
    { name: 'Obligations', value: allocation.bonds },
    { name: 'Cash', value: allocation.cash },
    { name: 'Actions', value: allocation.stocks },
  ].filter(d => d.value > 0) : [];

  const holdingsFor = (portfolioId) => subscriptions.filter(s => s.subPortfolioId === portfolioId);

  return (
    <Layout>
      <Helmet><title>Mes Portefeuilles - AGRICAP</title></Helmet>

      <div className="flex justify-between items-center mb-6">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-3xl font-bold gradient-text">Gestion de Portefeuilles</h1>
            <p className="text-gray-400">Vos sous-portefeuilles et la répartition globale de vos actifs.</p>
        </motion.div>
        <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleNotAvailable('Rapport Global (PDF)')}>Rapport Global</Button>
            <Button className="bg-gradient-to-r from-emerald-500 to-blue-600" onClick={() => setIsCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2"/> Créer Portefeuille
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="glass-effect"><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-400">Valeur Totale (AUM)</CardTitle></CardHeader><CardContent className="text-3xl font-bold text-emerald-400">{formatCurrency(totalAUM)}</CardContent></Card>
            <Card className="glass-effect"><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-400">Sous-portefeuilles</CardTitle></CardHeader><CardContent className="text-3xl font-bold text-blue-400">{subPortfolios.length}</CardContent></Card>
            <Card className="glass-effect"><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-400">Répartition</CardTitle></CardHeader>
              <CardContent className="h-20">
                {allocationData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={allocationData} cx="50%" cy="50%" innerRadius={20} outerRadius={35} dataKey="value">
                        {allocationData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-xs text-slate-500">Aucun actif.</p>}
              </CardContent>
            </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {subPortfolios.length === 0 && (
          <Card className="glass-effect lg:col-span-2">
            <CardContent className="p-8 text-center text-gray-400">
              Aucun sous-portefeuille créé. Utilisez "Créer Portefeuille" pour organiser vos investissements par objectif.
            </CardContent>
          </Card>
        )}
        {subPortfolios.map((p) => {
          const holdings = holdingsFor(p.id);
          const value = holdings.reduce((sum, s) => sum + s.amount, 0);
          return (
            <motion.div key={p.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
                <Card className="glass-effect h-full flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex justify-between items-center text-white">
                            <span className="flex items-center gap-2"><Briefcase className="w-5 h-5 text-emerald-400"/> {p.name}</span>
                            <span className="text-xl font-mono">{formatCurrency(value)}</span>
                        </CardTitle>
                        {p.description && <p className="text-xs text-slate-400 mt-1">{p.description}</p>}
                    </CardHeader>
                    <CardContent className="flex-1 space-y-4">
                        {holdings.length === 0 ? (
                          <p className="text-xs text-slate-500">
                            Aucune souscription rattachée à ce portefeuille pour le moment — l'affectation d'une souscription à un sous-portefeuille se fait au moment de la souscription (fonctionnalité pas encore proposée dans le flux de souscription).
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400">{holdings.length} souscription(s) rattachée(s)</p>
                        )}
                        <div className="grid grid-cols-3 gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleNotAvailable('Rééquilibrage')} className="w-full text-xs"><SlidersHorizontal className="w-3 h-3 mr-1"/> Rééquilibrer</Button>
                            <Button variant="outline" size="sm" onClick={() => handleNotAvailable('Alertes')} className="w-full text-xs"><Bell className="w-3 h-3 mr-1"/> Alertes</Button>
                            <Button variant="outline" size="sm" onClick={() => handleNotAvailable('Analyse de Risque (VaR)')} className="w-full text-xs"><ShieldAlert className="w-3 h-3 mr-1"/> Risque</Button>
                            <Button variant="outline" size="sm" onClick={() => handleNotAvailable('Benchmarks')} className="w-full text-xs"><BarChart2 className="w-3 h-3 mr-1"/> Benchmarks</Button>
                            <Button variant="outline" size="sm" onClick={() => handleNotAvailable('Score ESG')} className="w-full text-xs"><Leaf className="w-3 h-3 mr-1"/> Ind. ESG</Button>
                            <Button variant="outline" size="sm" onClick={() => handleNotAvailable('Historique des transactions')} className="w-full text-xs"><History className="w-3 h-3 mr-1"/> Historique</Button>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
          );
        })}
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Créer un sous-portefeuille</DialogTitle>
            <DialogDescription>Organisez vos futures souscriptions par objectif (ex. Retraite, Impact, Croissance).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="bg-slate-800 border-slate-700" />
            </div>
            <div className="space-y-2">
              <Label>Description (optionnel)</Label>
              <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} className="bg-slate-800 border-slate-700" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Annuler</Button>
            <Button className="bg-emerald-600" onClick={handleCreate} disabled={saving || !newName.trim()}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default Portfolios;

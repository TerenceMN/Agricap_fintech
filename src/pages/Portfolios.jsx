import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Briefcase, FileText, Loader2, Plus } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import { formatCurrency } from '@/lib/investorSpaceUtils';
import { buildAllocationView } from '@/lib/investorSpaceWire';
import PortfolioToolsDialog, { PORTFOLIO_TOOLS } from '@/components/investor-space/PortfolioTools';
import GlobalReportDialog from '@/components/investor-space/GlobalReportDialog';

/**
 * GESTION DE PORTEFEUILLES.
 *
 * Sept boutons de cet écran appelaient `handleNotAvailable`, un toast « non
 * disponible » : `Rapport Global`, `Rééquilibrer`, `Alertes`, `Risque`,
 * `Benchmarks`, `Ind. ESG`, `Historique`. Il n'en reste aucun. Chaque bouton
 * ouvre soit une mesure réelle, soit l'énoncé précis de la donnée qui manque —
 * jamais une promesse qui se dérobe.
 *
 * Ce qui est RÉELLEMENT calculé, et par qui :
 *
 * - `Risque`, `Alertes`, `Rapport Global` lisent `GET /investments/metrics/mine`
 *   (annexe D) : défaut en valeur ET en nombre, concentration de Herfindahl sur
 *   deux axes, part de projets en retard, score de santé avec sa formule et ses
 *   paramètres réellement appliqués, valorisation position par position. Tout
 *   cela est calculé SERVEUR sur le seul portefeuille du demandeur ; le front
 *   affiche, convertit les unités déclarées, et n'en dérive rien ;
 * - `Historique` lit `GET /investments/movements`, borné serveur aux mouvements
 *   de l'investisseur ;
 * - `Rééquilibrer` lit `GET /investments/portfolio-allocation` et compare la
 *   répartition réelle à une cible SAISIE — sans aucun bouton d'exécution,
 *   parce qu'aucun endpoint ne déplace d'argent entre poches ;
 * - `Ind. ESG` et `Benchmarks` n'affichent aucun score : la donnée d'entrée
 *   n'existe pas dans l'institution (`Project.impact_esg` est un texte libre,
 *   aucun indice de référence n'est collecté). Les deux écrans disent ce qui
 *   manque, comment ce serait alimenté, et le contrat serveur à créer.
 *
 * `GET /investments/metrics/portfolio` — la vue institution — n'est PAS utilisée
 * ici : elle est refusée en 403 à un client, et à juste titre. Combler un trou
 * de l'espace investisseur avec des chiffres d'institution serait une fuite.
 */
const COLORS = ['#10b981', '#3b82f6', '#f59e0b'];

const Portfolios = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subPortfolios, setSubPortfolios] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [allocation, setAllocation] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [metricsError, setMetricsError] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [tool, setTool] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Les métriques sont chargées à part : leur absence (pas de profil
      // investisseur, par exemple) ne doit pas vider l'écran des portefeuilles,
      // mais elle doit se voir là où elle empêche une mesure.
      const [portfolios, subs, alloc] = await Promise.all([
        api.investments.subPortfolios.list(),
        api.investments.subscriptions.mine(),
        api.investments.portfolioAllocation(),
      ]);
      setSubPortfolios(portfolios);
      setSubscriptions(subs);
      setAllocation(alloc);
      try {
        setMetrics(await api.investments.metrics.mine());
        setMetricsError(null);
      } catch (err) {
        setMetrics(null);
        setMetricsError(err.message || 'Métriques de portefeuille indisponibles.');
      }
    } catch (err) {
      setError({
        message: err.message || 'Chargement impossible.',
        errors: err.errors ?? [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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

  // `bonds` additionnait les souscriptions ENCAISSÉES et des positions
  // obligataires à montant saisi libre, sous un libellé unique. Deux natures,
  // deux parts : le total ne bouge pas, sa composition devient lisible.
  const allocationView = buildAllocationView(allocation);
  const totalAUM = allocationView.total;
  const allocationData = allocationView.slices;

  const holdingsFor = (portfolioId) => subscriptions.filter((s) => s.subPortfolioId === portfolioId);

  const ToolButtons = ({ subPortfolio }) => (
    <div className="grid grid-cols-3 gap-2">
      {PORTFOLIO_TOOLS.map((t) => (
        <Button
          key={t.key}
          variant="outline"
          size="sm"
          className="w-full text-xs"
          onClick={() => setTool({ key: t.key, subPortfolio })}
        >
          <t.icon className="w-3 h-3 mr-1" /> {t.label}
        </Button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <Layout>
        <Helmet><title>Mes Portefeuilles - AGRICAP</title></Helmet>
        <div className="flex items-center justify-center h-96 text-slate-400 gap-3">
          <Loader2 className="w-6 h-6 animate-spin" /> Chargement de vos portefeuilles…
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <Helmet><title>Mes Portefeuilles - AGRICAP</title></Helmet>
        <Card className="glass-effect border-red-500/40 max-w-2xl">
          <CardHeader>
            <CardTitle className="text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Portefeuilles indisponibles
            </CardTitle>
            <CardDescription className="text-red-200/80">{error.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {error.errors.length > 0 && (
              <ul className="space-y-1 text-sm text-red-200">
                {error.errors.map((e, i) => (
                  <li key={`${e.code}-${i}`}>
                    <span className="font-mono text-xs text-red-300">{e.code}</span> — {e.message}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" className="border-red-500/40" onClick={loadData}>Réessayer</Button>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <Helmet><title>Mes Portefeuilles - AGRICAP</title></Helmet>

      <div className="flex justify-between items-center mb-6">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-3xl font-bold gradient-text">Gestion de Portefeuilles</h1>
            <p className="text-gray-400">Vos sous-portefeuilles et la répartition globale de vos actifs.</p>
        </motion.div>
        <div className="flex gap-2">
            <Button variant="outline" onClick={() => setReportOpen(true)}>
              <FileText className="w-4 h-4 mr-2" /> Rapport Global
            </Button>
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
                      <Tooltip
                        formatter={(v, _n, entry) => [formatCurrency(v), entry?.payload?.name]}
                        labelFormatter={() => ''}
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', fontSize: '12px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-xs text-slate-500">Aucun actif.</p>}
              </CardContent>
            </Card>
      </div>

      {/* Rapprochement : le serveur signale quand deux écrans afficheront deux
          « investi » différents pour le même investisseur. On l'affiche. */}
      {allocationView.reconciliationWarning && (
        <Card className="glass-effect border-amber-500/40 mb-8">
          <CardContent className="p-4 text-sm text-amber-200">
            {allocationView.reconciliationWarning}
          </CardContent>
        </Card>
      )}

      {/* Les six outils sont aussi accessibles hors de toute poche : les mesures
          servies portent sur le portefeuille ENTIER, pas sur un sous-portefeuille
          — et un investisseur qui n'en a créé aucun y a droit comme les autres. */}
      <Card className="glass-effect mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-lg">Analyse de votre portefeuille</CardTitle>
          <CardDescription>
            Mesures calculées par le serveur sur vos seules souscriptions — avec leur base, leur
            effectif et leur méthode. Aucun chiffre n’est recomposé par cet écran.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToolButtons subPortfolio={null} />
          {metricsError && (
            <p className="text-xs text-amber-300">
              Métriques indisponibles : {metricsError} — « Risque », « Alertes » et « Ind. ESG »
              le diront plutôt que d’afficher des zéros.
            </p>
          )}
        </CardContent>
      </Card>

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
                        <ToolButtons subPortfolio={p} />
                    </CardContent>
                </Card>
            </motion.div>
          );
        })}
      </div>

      <PortfolioToolsDialog
        tool={tool?.key ?? null}
        open={Boolean(tool)}
        onOpenChange={(open) => { if (!open) setTool(null); }}
        metrics={metrics}
        metricsError={metricsError}
        allocationView={allocationView}
        subscriptions={subscriptions}
        subPortfolio={tool?.subPortfolio ?? null}
      />

      <GlobalReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        metrics={metrics}
        metricsError={metricsError}
        allocationView={allocationView}
        subPortfoliosCount={subPortfolios.length}
        subscriptionsCount={subscriptions.length}
      />

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

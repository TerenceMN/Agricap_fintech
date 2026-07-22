import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import StatCard from '@/components/StatCard';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  TrendingUp, ShieldCheck, DollarSign, Calendar, FileText, Download, AlertCircle,
  ArrowRightLeft, Clock, Activity, CheckCircle, Wallet, Calculator, AlertTriangle,
} from 'lucide-react';
import { api } from '@/services/api';
import { formatPercent, rowRateToPercent } from '@/lib/investorSpaceWire';

// --- Termes réels du produit (défauts backend `investments.ObligationPosition`) ---
const COUPON_VALUE = 250;
const ANNUAL_RATE = 0.09;
const MATURITY_MONTHS = 24;
const WITHDRAWAL_PENALTY_RATE = 0.02;

const STATUS_LABEL = { ACTIF: 'Actif', EN_ATTENTE: 'En attente', MATURE: 'Maturé' };
const STATUS_COLORS = {
  'Actif': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Maturé': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'En attente': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};
const FLOW_STATUS_LABEL = { EN_ATTENTE: 'En attente', APPROUVE: 'Approuvé', PAYE: 'Payé', REJETE: 'Rejeté' };
const FLOW_STATUS_COLORS = {
  'En attente': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  'Approuvé': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Payé': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'Rejeté': 'bg-red-500/10 text-red-400 border-red-500/20',
};

const calculateMaturityValue = (amount, years = MATURITY_MONTHS / 12) => amount * Math.pow(1 + ANNUAL_RATE, years);

const calculateImpact = (investedAmount) => {
  const coupons = investedAmount / COUPON_VALUE;
  return {
    farmers: Math.round(coupons * 2),
    hectares: (coupons * 0.5).toFixed(1),
    tons: (coupons * 1.5).toFixed(1),
    jobs: Math.round(coupons * 0.2),
  };
};

const Obligations = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');

  const [positions, setPositions] = useState([]);
  const [flows, setFlows] = useState([]); // withdrawals + conversions across all positions
  const [loading, setLoading] = useState(true);

  const [isWithdrawOpen, setWithdrawOpen] = useState(false);
  const [isConvertOpen, setConvertOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);

  const [subscribeQty, setSubscribeQty] = useState(1);
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [withdrawReason, setWithdrawReason] = useState('Urgence médicale');

  const [planObjective, setPlanObjective] = useState(6000);
  const [planMonths, setPlanMonths] = useState(24);

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await api.investments.obligations.list();
      setPositions(list);
      const histories = await Promise.all(list.map(async (p) => {
        const [withdrawals, conversions] = await Promise.all([
          api.investments.obligations.withdrawals(p.id).catch(() => []),
          api.investments.obligations.conversions(p.id).catch(() => []),
        ]);
        return [
          ...withdrawals.map((w) => ({ ...w, kind: 'withdrawal', positionName: p.name })),
          ...conversions.map((c) => ({ ...c, kind: 'conversion', positionName: p.name })),
        ];
      }));
      setFlows(histories.flat());
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSubscribe = async () => {
    try {
      await api.investments.obligations.subscribe({
        name: `Souscription Directe ${new Date().toLocaleDateString()}`,
        investedAmount: subscribeQty * COUPON_VALUE,
      });
      toast({ title: 'Succès', description: 'Souscription confirmée avec succès.' });
      loadData();
      setActiveTab('portfolios');
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Souscription impossible.', variant: 'destructive' });
    }
  };

  const handleWithdraw = async () => {
    if (withdrawAmount > selectedPosition.investedAmount) {
      toast({ title: 'Erreur', description: 'Montant supérieur au capital investi.', variant: 'destructive' });
      return;
    }
    try {
      await api.investments.obligations.withdraw(selectedPosition.id, { amount: withdrawAmount, reason: withdrawReason });
      toast({ title: 'Demande envoyée', description: 'Votre demande de retrait est en cours d\'examen.' });
      setWithdrawOpen(false);
      loadData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Demande impossible.', variant: 'destructive' });
    }
  };

  const handleConvert = async () => {
    const coupons = Math.floor(selectedPosition.investedAmount / selectedPosition.couponAmount);
    try {
      await api.investments.obligations.convert(selectedPosition.id, coupons);
      toast({ title: 'Conversion initiée', description: 'La validation peut prendre jusqu\'à 48h.' });
      setConvertOpen(false);
      loadData();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || 'Conversion impossible.', variant: 'destructive' });
    }
  };

  const handleNotAvailable = (label) => toast({
    title: label,
    description: "Non disponible : aucune fonctionnalité correspondante côté serveur pour le moment.",
  });

  // Calculations
  const totalInvested = positions.reduce((acc, p) => acc + (p.status === 'ACTIF' ? p.investedAmount : 0), 0);
  const estimatedMaturityTotal = calculateMaturityValue(totalInvested);
  const impact = calculateImpact(totalInvested);

  const DashboardOverview = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card className="bg-slate-900 border-slate-800 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -mr-32 -mt-32"></div>
        <CardContent className="p-8 relative z-10">
          <div className="flex flex-col md:flex-row gap-8 items-center">
            <div className="flex-1 space-y-4">
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Produit Certifié Durable</Badge>
              <h2 className="text-3xl font-bold text-white">Obligation Verte Agricole</h2>
              <p className="text-slate-400 text-lg leading-relaxed">
                En épargnant via nos coupons obligataires, vous soutenez directement les producteurs locaux, renforcez l'agribusiness durable et accédez à un rendement sécurisé.
                Chaque coupon de <span className="text-white font-bold">{COUPON_VALUE} USD</span> génère <span className="text-emerald-400 font-bold">{ANNUAL_RATE * 100}%</span> par an.
              </p>
              <div className="flex flex-wrap gap-4 pt-2">
                <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
                  <DollarSign className="w-4 h-4 text-emerald-400"/>
                  <span className="text-sm font-medium text-white">Coupon: {COUPON_VALUE} $</span>
                </div>
                <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
                  <TrendingUp className="w-4 h-4 text-emerald-400"/>
                  <span className="text-sm font-medium text-white">Rendement: {ANNUAL_RATE * 100}% / an</span>
                </div>
                <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700">
                  <Clock className="w-4 h-4 text-emerald-400"/>
                  <span className="text-sm font-medium text-white">Maturité: {MATURITY_MONTHS} Mois</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 min-w-[200px]">
              <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 w-full" onClick={() => setActiveTab('subscribe')}>
                Souscrire Maintenant
              </Button>
              <Button size="lg" variant="outline" className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 w-full" onClick={() => setActiveTab('create-plan')}>
                Simuler un Plan
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Investi" value={`${totalInvested.toLocaleString()} $`} icon={Wallet} trend="up" gradient="from-emerald-600 to-teal-600" />
        <StatCard title="Valeur Maturité Est." value={`~${Math.round(estimatedMaturityTotal).toLocaleString()} $`} change={`Projection +${MATURITY_MONTHS / 12} ans`} icon={TrendingUp} trend="up" gradient="from-blue-600 to-cyan-600" />
        <StatCard title="Coupons Actifs" value={positions.filter(p => p.status === 'ACTIF').reduce((acc, p) => acc + Math.floor(p.investedAmount / p.couponAmount), 0)} change="Unités" icon={FileText} trend="neutral" gradient="from-violet-600 to-purple-600" />
        <StatCard title="Impact Agriculteurs (est.)" value={impact.farmers} change="Producteurs soutenus" icon={ShieldCheck} trend="up" gradient="from-amber-500 to-orange-600" />
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">Impact Mesurable (estimation)</CardTitle>
          <CardDescription>Indicateurs d'impact proportionnels au capital investi — méthodologie de conversion coupon→impact non encore validée par l'équipe ESG, à considérer comme indicative.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-800 rounded-lg border border-slate-700 flex items-center gap-4">
              <div className="p-3 bg-emerald-500/20 rounded-full text-emerald-400"><ShieldCheck className="w-6 h-6"/></div>
              <div><p className="text-2xl font-bold text-white">{impact.hectares}</p><p className="text-xs text-slate-400">Hectares (est.)</p></div>
            </div>
            <div className="p-4 bg-slate-800 rounded-lg border border-slate-700 flex items-center gap-4">
              <div className="p-3 bg-blue-500/20 rounded-full text-blue-400"><TrendingUp className="w-6 h-6"/></div>
              <div><p className="text-2xl font-bold text-white">{impact.tons}</p><p className="text-xs text-slate-400">Tonnes (est.)</p></div>
            </div>
            <div className="p-4 bg-slate-800 rounded-lg border border-slate-700 flex items-center gap-4">
              <div className="p-3 bg-amber-500/20 rounded-full text-amber-400"><Wallet className="w-6 h-6"/></div>
              <div><p className="text-2xl font-bold text-white">{impact.jobs}</p><p className="text-xs text-slate-400">Emplois (est.)</p></div>
            </div>
            <div className="p-4 bg-slate-800 rounded-lg border border-slate-700 flex items-center gap-4">
              <div className="p-3 bg-purple-500/20 rounded-full text-purple-400"><ShieldCheck className="w-6 h-6"/></div>
              <div><p className="text-2xl font-bold text-white">{positions.filter(p => p.status === 'ACTIF').length}</p><p className="text-xs text-slate-400">Positions Actives</p></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const PortfoliosTable = () => (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-white">Mes Portefeuilles</CardTitle></div>
        <Button onClick={() => setActiveTab('subscribe')} className="bg-emerald-600"><DollarSign className="w-4 h-4 mr-2"/> Nouveau</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-slate-800/50">
              <TableHead>ID</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Coupons</TableHead>
              <TableHead>Capital Investi</TableHead>
              <TableHead>Val. Maturité Est.</TableHead>
              <TableHead>Rendement</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && positions.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-slate-500">Aucun portefeuille.</TableCell></TableRow>
            )}
            {positions.map(p => (
              <TableRow key={p.id} className="border-slate-800 hover:bg-slate-800/30">
                <TableCell className="font-mono text-xs text-slate-400">OBL-{p.id}</TableCell>
                <TableCell className="font-medium text-white">{p.name}</TableCell>
                <TableCell>{Math.floor(p.investedAmount / p.couponAmount)}</TableCell>
                <TableCell className="text-emerald-400 font-mono">{p.investedAmount.toLocaleString()} $</TableCell>
                <TableCell className="text-blue-400 font-mono">{Math.round(calculateMaturityValue(p.investedAmount, p.termMonths / 12)).toLocaleString()} $</TableCell>
                <TableCell className="text-white font-bold">
                  {formatPercent(rowRateToPercent(p, 'rate', p.rate))} / an
                </TableCell>
                <TableCell><Badge variant="outline" className={STATUS_COLORS[STATUS_LABEL[p.status]]}>{STATUS_LABEL[p.status] || p.status}</Badge></TableCell>
                <TableCell className="text-right space-x-2">
                  {p.status === 'ACTIF' && (
                    <>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelectedPosition(p); setWithdrawAmount(0); setWithdrawOpen(true); }}><AlertCircle className="w-4 h-4 text-amber-400"/></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelectedPosition(p); setConvertOpen(true); }}><ArrowRightLeft className="w-4 h-4 text-purple-400"/></Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  const CreatePlanForm = () => {
    const totalCouponsNeeded = Math.ceil(planObjective / COUPON_VALUE);
    const adjustedObjective = totalCouponsNeeded * COUPON_VALUE;
    const couponsPerMonth = totalCouponsNeeded / planMonths;
    const monthlyDeposit = (adjustedObjective / planMonths).toFixed(2);

    const planRows = Array.from({ length: planMonths }, (_, i) => {
      const month = i + 1;
      const cumulInvested = monthlyDeposit * month;
      const cumulCoupons = (couponsPerMonth * month).toFixed(1);
      const estValue = cumulInvested * Math.pow(1 + ANNUAL_RATE, month / 12);
      return { month, deposit: monthlyDeposit, cumulInvested, cumulCoupons, estValue };
    });

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-right-4 duration-500">
        <Card className="bg-slate-900 border-slate-800 h-fit">
          <CardHeader><CardTitle className="text-white">Paramètres du Plan (simulateur)</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label>Objectif Total (USD)</Label>
              <Input type="number" value={planObjective} onChange={e => setPlanObjective(Number(e.target.value))} className="bg-slate-800 border-slate-700 mt-2 text-lg" />
              <p className="text-xs text-slate-400 mt-1">Ajusté au multiple de {COUPON_VALUE}$ le plus proche : <span className="text-emerald-400 font-bold">{adjustedObjective} $</span></p>
            </div>
            <div>
              <Label>Durée (Mois)</Label>
              <Input type="number" value={planMonths} onChange={e => setPlanMonths(Number(e.target.value))} className="bg-slate-800 border-slate-700 mt-2" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Taux Annuel</Label><Input disabled value={`${ANNUAL_RATE * 100}%`} className="bg-slate-800/50 border-slate-700 mt-2 font-bold text-emerald-400"/></div>
              <div><Label>Maturité</Label><Input disabled value={`${MATURITY_MONTHS} mois`} className="bg-slate-800/50 border-slate-700 mt-2"/></div>
            </div>

            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg space-y-2">
              <div className="flex justify-between text-sm"><span className="text-slate-300">Total Coupons:</span><span className="text-white font-bold">{totalCouponsNeeded}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-300">Coupons / Mois:</span><span className="text-white font-bold">~{couponsPerMonth.toFixed(2)}</span></div>
              <div className="flex justify-between text-lg pt-2 border-t border-emerald-500/20"><span className="text-emerald-400 font-bold">Dépôt Mensuel:</span><span className="text-white font-bold">{monthlyDeposit} $</span></div>
            </div>

            <Button className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-lg" onClick={() => handleNotAvailable('Activer un plan épargne récurrent')}>
              Activer ce Plan Épargne
            </Button>
            <p className="text-xs text-slate-500">Les dépôts mensuels automatisés ne sont pas encore un produit disponible — vous pouvez souscrire un montant unique via l'onglet "Souscrire".</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white">Projection Détaillée (simulation)</CardTitle><CardDescription>Évolution mensuelle théorique de votre investissement.</CardDescription></CardHeader>
          <CardContent className="max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800"><TableHead>Mois</TableHead><TableHead>Coupons Acquis</TableHead><TableHead>Dépôt ($)</TableHead><TableHead>Cumul Investi</TableHead><TableHead>Valeur Est.</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {planRows.map((row) => (
                  <TableRow key={row.month} className="border-slate-800 hover:bg-slate-800/30">
                    <TableCell className="font-medium text-white">{row.month}</TableCell>
                    <TableCell>{row.cumulCoupons}</TableCell>
                    <TableCell className="text-slate-300">{row.deposit}</TableCell>
                    <TableCell className="text-emerald-400 font-bold">{row.cumulInvested.toFixed(0)} $</TableCell>
                    <TableCell className="text-blue-400 font-mono">{row.estValue.toFixed(0)} $</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  };

  const SubscribeSection = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader><CardTitle className="text-white">Configurer Souscription</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 rounded-lg bg-slate-800 border border-slate-700 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">$</div>
              <div>
                <p className="text-sm text-slate-400">Valeur Unitaire</p>
                <p className="text-xl font-bold text-white">{COUPON_VALUE.toFixed(2)} USD</p>
              </div>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Quantité de Coupons</Label>
            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={() => setSubscribeQty(Math.max(1, subscribeQty - 1))} className="border-slate-700">-</Button>
              <Input type="number" value={subscribeQty} onChange={e => setSubscribeQty(Number(e.target.value))} className="bg-slate-800 border-slate-700 text-center font-bold text-lg" />
              <Button variant="outline" onClick={() => setSubscribeQty(subscribeQty + 1)} className="border-slate-700">+</Button>
            </div>
          </div>

          <div className="space-y-2 pt-4">
            <div className="flex justify-between"><span className="text-slate-400">Total Investissement</span><span className="text-white font-bold">{(subscribeQty * COUPON_VALUE).toLocaleString()} $</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Frais de Gestion (0%)</span><span className="text-emerald-400">0.00 $</span></div>
            <div className="flex justify-between text-xl pt-4 border-t border-slate-800"><span className="text-white font-bold">Total à Payer</span><span className="text-emerald-400 font-bold">{(subscribeQty * COUPON_VALUE).toLocaleString()} $</span></div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader><CardTitle className="text-white">Confirmation</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-300">
            <AlertCircle className="w-4 h-4"/>
            <AlertTitle>Débit du portefeuille</AlertTitle>
            <AlertDescription>Le paiement (virement/mobile money) se règle depuis votre portefeuille AGRICAP existant — voir la page Portefeuille pour approvisionner votre solde au préalable si nécessaire.</AlertDescription>
          </Alert>

          <Button className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-lg" onClick={handleSubscribe}>Confirmer la Souscription</Button>
        </CardContent>
      </Card>
    </div>
  );

  const FlowsView = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2 bg-slate-900 border-slate-800">
        <CardHeader><CardTitle className="text-white">Historique Retraits & Conversions</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow className="border-slate-800"><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Portefeuille</TableHead><TableHead>Montant</TableHead><TableHead>Statut</TableHead></TableRow></TableHeader>
            <TableBody>
              {flows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-slate-500">Aucun flux enregistré.</TableCell></TableRow>
              )}
              {flows.map(f => (
                <TableRow key={`${f.kind}-${f.id}`} className="border-slate-800">
                  <TableCell>{new Date(f.date).toLocaleDateString()}</TableCell>
                  <TableCell>{f.kind === 'withdrawal' ? `Retrait (${f.reason || '-'})` : 'Conversion en actions'}</TableCell>
                  <TableCell className="text-slate-300">{f.positionName}</TableCell>
                  <TableCell className={f.kind === 'withdrawal' ? 'text-red-400' : 'text-purple-400'}>
                    {f.kind === 'withdrawal' ? `-${f.amount.toLocaleString()} $` : `${f.shares} actions`}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={FLOW_STATUS_COLORS[FLOW_STATUS_LABEL[f.status]]}>{FLOW_STATUS_LABEL[f.status] || f.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white">Prochaines Maturités</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {positions.filter(p => p.status === 'ACTIF').length === 0 && (
              <p className="text-sm text-slate-500">Aucune position active.</p>
            )}
            {positions.filter(p => p.status === 'ACTIF').map((p) => {
              const maturity = new Date(p.dateCreated);
              maturity.setMonth(maturity.getMonth() + p.termMonths);
              return (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded bg-slate-800 border border-slate-700">
                  <Calendar className="text-blue-400"/>
                  <div>
                    <p className="text-white font-bold">{maturity.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</p>
                    <p className="text-xs text-slate-400">{p.name}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  return (
    <Layout>
      <Helmet><title>Obligations - AGRICAP Investor</title></Helmet>

      <Dialog open={isWithdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white sm:max-w-md">
          <DialogHeader><DialogTitle>Retrait Anticipé</DialogTitle><DialogDescription>Attention aux pénalités de sortie.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 rounded bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
              <div className="flex items-center gap-2 mb-2 font-bold"><AlertTriangle className="w-4 h-4"/> Pénalité: {WITHDRAWAL_PENALTY_RATE * 100}%</div>
              Le retrait avant maturité entraîne une pénalité sur le capital retiré.
            </div>

            <div><Label>Montant du Retrait (Max: {selectedPosition?.investedAmount} $)</Label><Input type="number" value={withdrawAmount} onChange={e => setWithdrawAmount(Number(e.target.value))} className="bg-slate-800 border-slate-700 mt-2"/></div>

            <div>
              <Label>Motif</Label>
              <Select value={withdrawReason} onValueChange={setWithdrawReason}>
                <SelectTrigger className="bg-slate-800 border-slate-700 mt-2"><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Urgence médicale">Urgence Médicale</SelectItem>
                  <SelectItem value="Urgence familiale">Urgence Familiale</SelectItem>
                  <SelectItem value="Autre opportunité">Autre Opportunité</SelectItem>
                  <SelectItem value="Autre">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex justify-between text-sm"><span className="text-slate-400">Montant Brut:</span><span>{withdrawAmount} $</span></div>
              <div className="flex justify-between text-sm"><span className="text-red-400">Pénalité ({WITHDRAWAL_PENALTY_RATE * 100}%):</span><span className="text-red-400">-{(withdrawAmount * WITHDRAWAL_PENALTY_RATE).toFixed(2)} $</span></div>
              <div className="flex justify-between font-bold text-lg"><span className="text-white">Net à Recevoir:</span><span className="text-emerald-400">{(withdrawAmount * (1 - WITHDRAWAL_PENALTY_RATE)).toFixed(2)} $</span></div>
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setWithdrawOpen(false)}>Annuler</Button><Button onClick={handleWithdraw} className="bg-amber-600 hover:bg-amber-700">Confirmer Retrait</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isConvertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader><DialogTitle>Conversion en Actions</DialogTitle><DialogDescription>Devenez actionnaire et participez à la gouvernance.</DialogDescription></DialogHeader>
          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <div><p className="text-sm text-purple-300">Éligibilité</p><p className="font-bold text-white">{selectedPosition?.status === 'ACTIF' ? 'OUI - Position Active' : 'Non éligible'}</p></div>
              <CheckCircle className="text-purple-400 w-8 h-8"/>
            </div>

            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 bg-slate-800 rounded border border-slate-700">
                <p className="text-xs text-slate-400">Valeur de Conversion</p>
                <p className="text-lg font-bold text-white">
                  {(Math.floor((selectedPosition?.investedAmount || 0) / (selectedPosition?.couponAmount || COUPON_VALUE)) * (selectedPosition?.couponAmount || COUPON_VALUE)).toLocaleString()} $
                </p>
              </div>
              <div className="p-3 bg-slate-800 rounded border border-slate-700">
                <p className="text-xs text-slate-400">Prix Action</p>
                <p className="text-lg font-bold text-white">100 $</p>
              </div>
            </div>

            <div className="text-center">
              <p className="text-slate-300 mb-2">Simulation de Conversion</p>
              <div className="text-4xl font-bold text-purple-400">
                {Math.floor((Math.floor((selectedPosition?.investedAmount || 0) / (selectedPosition?.couponAmount || COUPON_VALUE)) * (selectedPosition?.couponAmount || COUPON_VALUE)) / 100)}
                {' '}<span className="text-lg text-white">Actions AGRICAP</span>
              </div>
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setConvertOpen(false)}>Annuler</Button><Button onClick={handleConvert} className="bg-purple-600 hover:bg-purple-700">Valider Conversion</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6 pb-20">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold gradient-text">Obligations & Coupons</h1>
            <p className="text-slate-400">Investissement à impact garanti par AGRICAP.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="border-slate-700" onClick={() => setActiveTab('documents')}><Download className="w-4 h-4 mr-2"/> Rapport</Button>
            <Button onClick={() => setActiveTab('subscribe')} className="bg-emerald-600 hover:bg-emerald-700"><DollarSign className="w-4 h-4 mr-2"/> Souscrire</Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-slate-900 border border-slate-800 p-1 w-full justify-start overflow-x-auto h-auto">
            <TabsTrigger value="overview" className="data-[state=active]:bg-slate-800"><Activity className="w-4 h-4 mr-2"/> Vue d'ensemble</TabsTrigger>
            <TabsTrigger value="portfolios" className="data-[state=active]:bg-slate-800"><Wallet className="w-4 h-4 mr-2"/> Mes Portefeuilles</TabsTrigger>
            <TabsTrigger value="create-plan" className="data-[state=active]:bg-slate-800"><Calculator className="w-4 h-4 mr-2"/> Simuler Plan</TabsTrigger>
            <TabsTrigger value="subscribe" className="data-[state=active]:bg-slate-800"><DollarSign className="w-4 h-4 mr-2"/> Souscrire</TabsTrigger>
            <TabsTrigger value="flows" className="data-[state=active]:bg-slate-800"><ArrowRightLeft className="w-4 h-4 mr-2"/> Flux & Retours</TabsTrigger>
            <TabsTrigger value="documents" className="data-[state=active]:bg-slate-800"><FileText className="w-4 h-4 mr-2"/> Documents</TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="overview"><DashboardOverview/></TabsContent>
            <TabsContent value="portfolios"><PortfoliosTable/></TabsContent>
            <TabsContent value="create-plan"><CreatePlanForm/></TabsContent>
            <TabsContent value="subscribe"><SubscribeSection/></TabsContent>
            <TabsContent value="flows"><FlowsView/></TabsContent>
            <TabsContent value="documents">
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader><CardTitle className="text-white">Centre de Documentation</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-400">Non disponible : la génération et le stockage de documents (contrats, rapports d'impact, prospectus) ne sont pas encore implémentés côté serveur.</p>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
};

export default Obligations;

import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { STATUS, STATUS_LABELS } from '@/lib/constants';
import { Wallet, ArrowRightLeft, Download, Upload, RefreshCw, DollarSign, History, Smartphone, Landmark, AlertCircle, Clock, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { api, ApiError } from '@/services/api';

const ClientWallet = () => {
  const { toast } = useToast();
  const [balance, setBalance] = useState({ usd: 0, cdf: 0 });
  const [transactions, setTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');

  // Forms State
  const [depositForm, setDepositForm] = useState({ amount: '', currency: 'USD', method: 'mobile_money', phone: '' });
  const [withdrawForm, setWithdrawForm] = useState({ amount: '', currency: 'USD', method: 'mobile_money', phone: '' });
  const [fxForm, setFxForm] = useState({ from: 'USD', to: 'CDF', amount: '' });
  const [fxPreview, setFxPreview] = useState(null); // résultat réel de /fx/convert (taux figé serveur)
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  // Retraits au-dessus du seuil auto : n'apparaissent PAS dans `movements()` tant qu'ils
  // ne sont pas approuvés (pas encore un WalletMovement) — sans cette liste dédiée, un
  // retrait en attente disparaîtrait de la vue du client jusqu'à sa validation.
  const [pendingWithdrawals, setPendingWithdrawals] = useState([]);
  const [kyc, setKyc] = useState(null);

  const loadWallets = () => api.caisses.wallets.mine().then(wallets => {
    const usd = wallets.find(w => w.currency === 'USD');
    const cdf = wallets.find(w => w.currency === 'CDF');
    setBalance({ usd: usd?.balance || 0, cdf: cdf?.balance || 0 });
  }).catch(() => {});
  const loadMovements = () => api.caisses.wallets.movements().then(setTransactions).catch(() => {});
  const loadPendingWithdrawals = () => api.caisses.wallets.myWithdrawalRequests()
    .then(rows => setPendingWithdrawals(rows.filter(r => r.status === 'pending_validation')))
    .catch(() => {});
  const loadKyc = () => api.compliance.myKyc().then(setKyc).catch(() => {});
  useEffect(() => { loadWallets(); loadMovements(); loadPendingWithdrawals(); loadKyc(); }, []);

  // Aperçu de conversion — jamais un taux en dur, toujours dérivé de /fx/convert (taux
  // figé au tarif CLIENT, source de vérité serveur).
  useEffect(() => {
    if (!fxForm.amount || parseFloat(fxForm.amount) <= 0) { setFxPreview(null); return; }
    api.fx.convert(parseFloat(fxForm.amount), fxForm.from, fxForm.to, 'CLIENT')
      .then(res => setFxPreview(res.amount))
      .catch(() => setFxPreview(null));
  }, [fxForm.amount, fxForm.from, fxForm.to]);
  
  // Validation State
  const [errors, setErrors] = useState({});

  const validateForm = (form, type) => {
      const newErrors = {};
      if (!form.amount || parseFloat(form.amount) <= 0) newErrors.amount = "Montant invalide";
      
      if (type === 'deposit' || type === 'withdraw') {
          if (form.method === 'mobile_money' && !form.phone) newErrors.phone = "Numéro requis";
      }

      if (type === 'withdraw') {
          const balanceKey = form.currency === 'USD' ? 'usd' : 'cdf';
          if (parseFloat(form.amount) > balance[balanceKey]) newErrors.amount = "Solde insuffisant";
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
  };

  const handleDeposit = (e) => {
    e.preventDefault();
    if (!validateForm(depositForm, 'deposit')) return;
    
    setPendingAction({ type: 'Dépôt', ...depositForm });
    setConfirmDialog(true);
  };

  const handleWithdraw = (e) => {
    e.preventDefault();
    if (!validateForm(withdrawForm, 'withdraw')) return;

    setPendingAction({ type: 'Retrait', ...withdrawForm });
    setConfirmDialog(true);
  };

  const handleFx = (e) => {
    e.preventDefault();
    if (!fxForm.amount || parseFloat(fxForm.amount) <= 0) {
        setErrors({ fxAmount: "Montant requis" });
        return;
    }
    const balanceKey = fxForm.from === 'USD' ? 'usd' : 'cdf';
    if (parseFloat(fxForm.amount) > balance[balanceKey]) {
        setErrors({ fxAmount: "Solde insuffisant pour la conversion" });
        return;
    }
    if (fxPreview === null) {
        setErrors({ fxAmount: "Aucun taux de change configuré pour cette paire." });
        return;
    }

    setPendingAction({ type: 'Change FX', ...fxForm, result: fxPreview });
    setConfirmDialog(true);
  };

  const executeAction = async () => {
    try {
      let toastTitle = "Opération Effectuée";
      let toastDesc = `Votre ${pendingAction.type} a été traité(e).`;

      if (pendingAction.type === 'Dépôt') {
        await api.caisses.wallets.deposit(parseFloat(pendingAction.amount), pendingAction.currency, pendingAction.method);
      } else if (pendingAction.type === 'Retrait') {
        // Un retrait au-dessus du seuil auto crée une demande en attente de validation
        // (manager ou quorum de superviseurs) plutôt que d'être exécuté immédiatement.
        const result = await api.caisses.wallets.withdraw(parseFloat(pendingAction.amount), pendingAction.currency);
        if (result.status !== 'posted') {
          toastTitle = "Retrait en attente de validation";
          toastDesc = result.detail || "Ce montant nécessite une validation avant exécution.";
        }
      } else if (pendingAction.type === 'Change FX') {
        await api.caisses.wallets.convert(pendingAction.from, pendingAction.to, parseFloat(pendingAction.amount));
      }
      setConfirmDialog(false);
      loadWallets();
      loadMovements();
      loadPendingWithdrawals();
      toast({ title: toastTitle, description: toastDesc, className: "bg-emerald-500 text-white" });
      setDepositForm({ amount: '', currency: 'USD', method: 'mobile_money', phone: '' });
      setWithdrawForm({ amount: '', currency: 'USD', method: 'mobile_money', phone: '' });
      setFxForm({ from: 'USD', to: 'CDF', amount: '' });
      setErrors({});
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  return (
    <Layout>
      <Helmet>
        <title>Ma Trésorerie - AGRICAP FINTECH</title>
      </Helmet>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-3xl font-bold gradient-text">Ma Trésorerie</h1>
        <p className="text-gray-400">Gérez vos fonds, effectuez des dépôts, retraits et changes.</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card className="glass-effect border-emerald-500/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-emerald-400">Solde Disponible (USD)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">${balance.usd.toLocaleString()}</span>
              <span className="text-xs text-gray-500">USD</span>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-blue-500/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-blue-400">Solde Disponible (CDF)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">{balance.cdf.toLocaleString()}</span>
              <span className="text-xs text-gray-500">FC</span>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-purple-500/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-purple-400">En Attente de Validation</CardTitle></CardHeader>
          <CardContent>
             <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">{pendingWithdrawals.length}</span>
              <span className="text-xs text-gray-500">Opération{pendingWithdrawals.length > 1 ? 's' : ''}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-effect border-amber-500/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400 flex items-center gap-1"><ShieldCheck className="w-4 h-4"/> Palier KYC</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">{kyc?.kycLevel || '—'}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Limite mensuelle de retrait : {kyc ? kyc.monthlyLimit.toLocaleString() : '—'}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-slate-800/60 mb-6">
          <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="deposit">Dépôt</TabsTrigger>
          <TabsTrigger value="withdraw">Retrait</TabsTrigger>
          <TabsTrigger value="fx">Change (FX)</TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview">
          {pendingWithdrawals.length > 0 && (
            <Card className="glass-effect border-amber-500/30 mb-6">
              <CardHeader><CardTitle className="flex items-center gap-2 text-amber-400"><Clock className="w-5 h-5"/> Retraits en attente de validation</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead>Réf</TableHead>
                      <TableHead>Montant</TableHead>
                      <TableHead>Approbations</TableHead>
                      <TableHead>Détail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingWithdrawals.map((r) => (
                      <TableRow key={r.requestId} className="border-slate-800">
                        <TableCell className="font-mono text-xs text-gray-400">#{r.requestId}</TableCell>
                        <TableCell className="font-bold text-white">{r.amount.toLocaleString()}</TableCell>
                        <TableCell>{r.approvalsCount} / {r.requiredApprovals}</TableCell>
                        <TableCell className="text-xs text-gray-400">{r.detail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          <Card className="glass-effect">
            <CardHeader><CardTitle className="flex items-center gap-2"><History className="w-5 h-5"/> Historique des Transactions</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700">
                    <TableHead>ID</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Montant</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id} className="border-slate-800">
                      <TableCell className="font-mono text-xs text-gray-400">{tx.id}</TableCell>
                      <TableCell>{new Date(tx.date).toLocaleDateString()}</TableCell>
                      <TableCell>{tx.type}</TableCell>
                      <TableCell className="font-bold text-white">{tx.amount.toLocaleString()} {tx.currency}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_LABELS[tx.status]?.color || 'bg-gray-500'}>
                          {STATUS_LABELS[tx.status]?.label || tx.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* DEPOSIT TAB */}
        <TabsContent value="deposit">
           <Card className="glass-effect max-w-2xl mx-auto">
             <CardHeader><CardTitle className="text-emerald-400 flex items-center gap-2"><Download className="w-5 h-5"/> Nouveau Dépôt</CardTitle></CardHeader>
             <CardContent>
               <form onSubmit={handleDeposit} className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Montant</Label>
                        <Input type="number" value={depositForm.amount} onChange={e => setDepositForm({...depositForm, amount: e.target.value})} placeholder="0.00" required className={`bg-slate-900/50 ${errors.amount ? 'border-red-500' : ''}`} />
                        {errors.amount && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={10}/> {errors.amount}</span>}
                    </div>
                    <div className="space-y-2">
                        <Label>Devise</Label>
                        <Select value={depositForm.currency} onValueChange={v => setDepositForm({...depositForm, currency: v})}>
                            <SelectTrigger className="bg-slate-900/50"><SelectValue/></SelectTrigger>
                            <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF</SelectItem></SelectContent>
                        </Select>
                    </div>
                 </div>
                 <div className="space-y-2">
                    <Label>Méthode de Paiement</Label>
                    <div className="grid grid-cols-2 gap-2">
                        <Button type="button" variant={depositForm.method === 'mobile_money' ? 'default' : 'outline'} onClick={() => setDepositForm({...depositForm, method: 'mobile_money'})} className="justify-start"><Smartphone className="w-4 h-4 mr-2"/> Mobile Money</Button>
                        <Button type="button" variant={depositForm.method === 'bank_transfer' ? 'default' : 'outline'} onClick={() => setDepositForm({...depositForm, method: 'bank_transfer'})} className="justify-start"><Landmark className="w-4 h-4 mr-2"/> Virement Bancaire</Button>
                    </div>
                 </div>
                 {depositForm.method === 'mobile_money' && (
                    <div className="space-y-2">
                        <Label>Numéro de téléphone</Label>
                        <Input placeholder="+243..." value={depositForm.phone} onChange={e => setDepositForm({...depositForm, phone: e.target.value})} className={`bg-slate-900/50 ${errors.phone ? 'border-red-500' : ''}`} />
                        {errors.phone && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={10}/> {errors.phone}</span>}
                    </div>
                 )}
                 <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 mt-4">Initier le Dépôt</Button>
               </form>
             </CardContent>
           </Card>
        </TabsContent>

        {/* WITHDRAW TAB */}
        <TabsContent value="withdraw">
           <Card className="glass-effect max-w-2xl mx-auto">
             <CardHeader><CardTitle className="text-red-400 flex items-center gap-2"><Upload className="w-5 h-5"/> Demande de Retrait</CardTitle></CardHeader>
             <CardContent>
               <form onSubmit={handleWithdraw} className="space-y-4">
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Montant</Label>
                        <Input type="number" value={withdrawForm.amount} onChange={e => setWithdrawForm({...withdrawForm, amount: e.target.value})} placeholder="0.00" required className={`bg-slate-900/50 ${errors.amount ? 'border-red-500' : ''}`} />
                        {errors.amount && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={10}/> {errors.amount}</span>}
                    </div>
                    <div className="space-y-2">
                        <Label>Devise</Label>
                        <Select value={withdrawForm.currency} onValueChange={v => setWithdrawForm({...withdrawForm, currency: v})}>
                            <SelectTrigger className="bg-slate-900/50"><SelectValue/></SelectTrigger>
                            <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF</SelectItem></SelectContent>
                        </Select>
                    </div>
                 </div>
                 <div className="space-y-2">
                    <Label>Compte de Destination</Label>
                     <div className="grid grid-cols-2 gap-2">
                        <Button type="button" variant={withdrawForm.method === 'mobile_money' ? 'default' : 'outline'} onClick={() => setWithdrawForm({...withdrawForm, method: 'mobile_money'})} className="justify-start"><Smartphone className="w-4 h-4 mr-2"/> Mobile Money</Button>
                        <Button type="button" variant={withdrawForm.method === 'bank_transfer' ? 'default' : 'outline'} onClick={() => setWithdrawForm({...withdrawForm, method: 'bank_transfer'})} className="justify-start"><Landmark className="w-4 h-4 mr-2"/> Virement Bancaire</Button>
                    </div>
                 </div>
                 <div className="space-y-2">
                    <Label>Détails du compte (Numéro / IBAN)</Label>
                    <Input placeholder="Entrez les coordonnées..." value={withdrawForm.phone} onChange={e => setWithdrawForm({...withdrawForm, phone: e.target.value})} className={`bg-slate-900/50 ${errors.phone ? 'border-red-500' : ''}`} />
                    {errors.phone && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={10}/> {errors.phone}</span>}
                 </div>
                 <Button type="submit" className="w-full bg-red-600 hover:bg-red-700 mt-4">Demander le Retrait</Button>
               </form>
             </CardContent>
           </Card>
        </TabsContent>

        {/* FX TAB */}
        <TabsContent value="fx">
            <Card className="glass-effect max-w-2xl mx-auto">
             <CardHeader><CardTitle className="text-blue-400 flex items-center gap-2"><RefreshCw className="w-5 h-5"/> Conversion de Devises</CardTitle></CardHeader>
             <CardContent>
               <form onSubmit={handleFx} className="space-y-6">
                 <div className="flex items-end gap-4 bg-slate-900/30 p-4 rounded-xl">
                    <div className="flex-1 space-y-2">
                        <Label>Je convertis (De)</Label>
                        <Select value={fxForm.from} onValueChange={v => setFxForm({...fxForm, from: v, to: v === 'USD' ? 'CDF' : 'USD'})}>
                            <SelectTrigger className="bg-slate-800"><SelectValue/></SelectTrigger>
                            <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="CDF">CDF</SelectItem></SelectContent>
                        </Select>
                        <Input type="number" value={fxForm.amount} onChange={e => setFxForm({...fxForm, amount: e.target.value})} placeholder="0.00" className={`bg-slate-800 text-lg ${errors.fxAmount ? 'border-red-500' : ''}`} />
                        {errors.fxAmount && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={10}/> {errors.fxAmount}</span>}
                    </div>
                    <ArrowRightLeft className="mb-3 text-gray-400"/>
                     <div className="flex-1 space-y-2">
                        <Label>Je reçois (Vers)</Label>
                        <Input value={fxForm.to} disabled className="bg-slate-800/50 font-bold text-center"/>
                        <div className="bg-slate-800/50 h-10 rounded-md flex items-center px-3 text-lg font-bold text-emerald-400">
                             {fxPreview !== null ? fxPreview.toLocaleString() : '0.00'}
                        </div>
                    </div>
                 </div>
                 <div className="text-center text-sm text-gray-400">
                    {fxPreview !== null && fxForm.amount
                      ? `Taux appliqué : 1 ${fxForm.from} = ${(fxPreview / parseFloat(fxForm.amount)).toFixed(4)} ${fxForm.to}`
                      : "Aucun taux configuré pour cette paire — contactez un gestionnaire."}
                 </div>
                 <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">Convertir Maintenant</Button>
               </form>
             </CardContent>
           </Card>
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <DialogContent className="glass-effect text-white">
            <DialogHeader>
                <DialogTitle>Confirmer l'opération</DialogTitle>
                <DialogDescription>Veuillez vérifier les détails avant de valider.</DialogDescription>
            </DialogHeader>
            {pendingAction && (
                <div className="py-4 space-y-3">
                    <div className="flex justify-between border-b border-gray-700 pb-2">
                        <span className="text-gray-400">Type</span>
                        <span className="font-bold text-white">{pendingAction.type}</span>
                    </div>
                     <div className="flex justify-between border-b border-gray-700 pb-2">
                        <span className="text-gray-400">Montant</span>
                        <span className="font-bold text-emerald-400">{parseFloat(pendingAction.amount).toLocaleString()} {pendingAction.currency || pendingAction.from}</span>
                    </div>
                    {pendingAction.type === 'Change FX' && (
                        <div className="flex justify-between border-b border-gray-700 pb-2">
                        <span className="text-gray-400">Montant Reçu (est.)</span>
                        <span className="font-bold text-emerald-400">{pendingAction.result.toLocaleString()} {pendingAction.to}</span>
                    </div>
                    )}
                     <div className="flex justify-between">
                        <span className="text-gray-400">Frais estimés</span>
                        <span className="font-bold text-white">0.00 {pendingAction.currency || pendingAction.from}</span>
                    </div>
                </div>
            )}
            <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmDialog(false)}>Annuler</Button>
                <Button onClick={executeAction} className="bg-gradient-to-r from-emerald-500 to-blue-600">Confirmer et Exécuter</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

    </Layout>
  );
};

export default ClientWallet;
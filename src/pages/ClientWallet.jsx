import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS } from '@/lib/constants';
import { Download, Upload, RefreshCw, History, Clock, ShieldCheck } from 'lucide-react';
import { api } from '@/services/api';
import DepositForm from '@/components/treasury/DepositForm';
import WithdrawForm from '@/components/treasury/WithdrawForm';
import FxForm from '@/components/treasury/FxForm';

/**
 * « Ma Trésorerie » — l'écran de référence des mouvements de portefeuille.
 *
 * Les trois formulaires (dépôt, retrait, change) ne vivent plus ici : ils sont
 * dans `@/components/treasury` et servent désormais TOUTES les surfaces qui
 * proposent un dépôt. Cette page reste la référence de comportement, mais elle
 * n'en est plus la seule dépositaire — c'est précisément ce qui empêche une
 * copie appauvrie de réapparaître ailleurs.
 */
const ClientWallet = () => {
  const [balance, setBalance] = useState({ usd: 0, cdf: 0 });
  const [transactions, setTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
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

  // Après tout mouvement : soldes, historique ET file d'attente de validation.
  const refreshAll = () => { loadWallets(); loadMovements(); loadPendingWithdrawals(); };

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
               <DepositForm onCompleted={refreshAll} />
             </CardContent>
           </Card>
        </TabsContent>

        {/* WITHDRAW TAB */}
        <TabsContent value="withdraw">
           <Card className="glass-effect max-w-2xl mx-auto">
             <CardHeader><CardTitle className="text-red-400 flex items-center gap-2"><Upload className="w-5 h-5"/> Demande de Retrait</CardTitle></CardHeader>
             <CardContent>
               <WithdrawForm balances={balance} onCompleted={refreshAll} />
             </CardContent>
           </Card>
        </TabsContent>

        {/* FX TAB */}
        <TabsContent value="fx">
            <Card className="glass-effect max-w-2xl mx-auto">
             <CardHeader><CardTitle className="text-blue-400 flex items-center gap-2"><RefreshCw className="w-5 h-5"/> Conversion de Devises</CardTitle></CardHeader>
             <CardContent>
               <FxForm balances={balance} onCompleted={refreshAll} />
             </CardContent>
           </Card>
        </TabsContent>
      </Tabs>

    </Layout>
  );
};

export default ClientWallet;
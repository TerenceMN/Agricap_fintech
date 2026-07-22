import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Layout, { menuKeyFor } from '@/components/Layout';
import { useAuth } from '@/contexts/AuthContext.jsx';
import StatCard from '@/components/StatCard';
import MultiCurrencyDashboard from '@/components/dashboard/MultiCurrencyDashboard';
import { api } from '@/services/api';
import { formatCurrency } from '@/lib/investorSpaceUtils';
import { buildAllocationView } from '@/lib/investorSpaceWire';
import {
  DollarSign, TrendingUp, Landmark, Users, AlertTriangle, FileText, CheckCircle, Repeat,
  Wallet, Plus, ArrowRightLeft, ShieldCheck, Briefcase, Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// ====================================
// ADMIN, CAISSIER, AUDITEUR DASHBOARDS
// ====================================

const AdminDashboard = () => {
    const navigate = useNavigate();
    const [stats, setStats] = useState([]);

    useEffect(() => {
        Promise.all([
            api.agencies.list().catch(() => []),
            api.transactions.supervision().catch(() => null),
            api.caisses.accounts.list().catch(() => []),
            api.portfolio.loans().catch(() => []),
        ]).then(([agencies, supervision, accounts, loans]) => {
            const activeAgencies = agencies.filter((a) => a.status === 'ACTIF').length;
            const usdBalance = accounts.filter((a) => a.currency === 'USD').reduce((s, a) => s + a.balance, 0);
            setStats([
                { title: 'Agences actives', value: `${activeAgencies}/${agencies.length}`, icon: Landmark, gradient: 'from-blue-500 to-cyan-600' },
                { title: 'Transactions en attente', value: supervision?.pendingCount ?? 'N/D', icon: AlertTriangle, gradient: 'from-amber-500 to-orange-600' },
                { title: 'Solde Caisses (USD)', value: `$${usdBalance.toLocaleString()}`, icon: Wallet, gradient: 'from-emerald-500 to-teal-600' },
                { title: 'Dossiers de crédit', value: loans.length, icon: FileText, gradient: 'from-purple-500 to-indigo-600' },
            ]);
        });
    }, []);

    return (
        <div className="space-y-8">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <h1 className="text-4xl font-bold gradient-text mb-2">Console d'Administration</h1>
                <p className="text-gray-400">Vue 360° et gouvernance de la plateforme AGRICAP FIN</p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, index) => <StatCard key={index} {...stat} />)}
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}><MultiCurrencyDashboard /></motion.div>
        </div>
    );
};

const ComptableDashboard = () => {
    // Bucket historique conservé pour compatibilité mais non atteignable par aucun des 16
    // rôles réels (menuKeyFor ne mappe rien vers 'comptable' — voir components/Layout.jsx).
    const stats = [];
    return (
        <div className="space-y-8">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}><h1 className="text-4xl font-bold gradient-text mb-2">Tableau de Bord Comptable</h1><p className="text-gray-400">Suivi des positions financières et réconciliation</p></motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">{stats.map((stat, index) => <StatCard key={index} {...stat} />)}</motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}><MultiCurrencyDashboard /></motion.div>
        </div>
    );
};

const CaissierDashboard = () => {
    const [stats, setStats] = useState([]);

    useEffect(() => {
        Promise.all([
            api.caisses.accounts.list().catch(() => []),
            api.transactions.supervision().catch(() => null),
            api.agencies.list().catch(() => []),
        ]).then(([accounts, supervision, agencies]) => {
            const usdBalance = accounts.filter((a) => a.currency === 'USD').reduce((s, a) => s + a.balance, 0);
            const alertsCount = agencies.reduce((s, a) => s + (a.alerts?.length || 0), 0);
            setStats([
                { title: 'Comptes de caisse', value: accounts.length, icon: Wallet, gradient: 'from-blue-500 to-cyan-600' },
                { title: 'Solde Caisses (USD)', value: `$${usdBalance.toLocaleString()}`, icon: DollarSign, gradient: 'from-emerald-500 to-teal-600' },
                { title: 'Transactions en attente', value: supervision?.pendingCount ?? 'N/D', icon: AlertTriangle, gradient: 'from-amber-500 to-orange-600' },
                { title: 'Alertes agences', value: alertsCount, icon: ShieldCheck, gradient: 'from-red-500 to-rose-600' },
            ]);
        });
    }, []);

    return (
        <div className="space-y-8">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}><h1 className="text-4xl font-bold gradient-text mb-2">Tableau de Bord Caisse</h1><p className="text-gray-400">Gestion des opérations de trésorerie quotidiennes</p></motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">{stats.map((stat, index) => <StatCard key={index} {...stat} />)}</motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}><MultiCurrencyDashboard /></motion.div>
        </div>
    );
};

const AuditeurDashboard = () => {
    const [stats, setStats] = useState([]);

    useEffect(() => {
        Promise.all([
            api.transactions.specialCases().catch(() => []),
            api.compliance.kycProfiles().catch(() => []),
            api.agencies.list().catch(() => []),
            api.audit.entries().catch(() => []),
        ]).then(([cases, kyc, agencies, entries]) => {
            const kycScore = kyc.length ? Math.round((kyc.filter((k) => k.kycStatus === 'Validé').length / kyc.length) * 1000) / 10 : null;
            const alertsCount = agencies.reduce((s, a) => s + (a.alerts?.length || 0), 0);
            setStats([
                { title: 'Cas spéciaux en cours', value: cases.length, icon: AlertTriangle, gradient: 'from-amber-500 to-orange-600' },
                { title: 'Score conformité KYC', value: kycScore !== null ? `${kycScore}%` : 'N/D', icon: ShieldCheck, gradient: 'from-emerald-500 to-teal-600' },
                { title: 'Alertes agences', value: alertsCount, icon: AlertTriangle, gradient: 'from-red-500 to-rose-600' },
                { title: "Entrées d'audit", value: entries.length, icon: FileText, gradient: 'from-purple-500 to-indigo-600' },
            ]);
        });
    }, []);

    return (
        <div className="space-y-8">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}><h1 className="text-4xl font-bold gradient-text mb-2">Tableau de Bord Audit</h1><p className="text-gray-400">Contrôle et conformité des opérations</p></motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">{stats.map((stat, index) => <StatCard key={index} {...stat} />)}</motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}><MultiCurrencyDashboard /></motion.div>
        </div>
    );
};

// ====================================
// INVESTOR DASHBOARD
// ====================================
const InvestorDashboard = () => {
    const navigate = useNavigate();
    const [stats, setStats] = useState([]);
    const [recentActivity, setRecentActivity] = useState([]);
    const [allocationView, setAllocationView] = useState({ slices: [], total: 0, reconciliationWarning: null });

    useEffect(() => {
        Promise.all([
            api.investments.subscriptions.mine().catch(() => []),
            api.investments.investors.me().catch(() => null),
            api.investments.portfolioAllocation().catch(() => null),
            api.investments.metrics.mine().catch(() => null),
        ]).then(([subs, investor, allocation, metrics]) => {
            // « Total investi » sommait les montants RÉSERVÉS des souscriptions :
            // des intentions comptées comme de l'argent placé, et un troisième
            // chiffre pour une grandeur que l'espace investisseur affiche déjà.
            // Il vient désormais de `GET /investments/metrics/mine`, qui ne
            // compte que l'encaissé — une seule source, un seul chiffre.
            setStats([
                { title: 'Souscriptions actives', value: subs.filter((s) => s.status === 'ACTIVE' || s.status === 'REPAYMENT').length, icon: Briefcase, gradient: 'from-blue-500 to-cyan-600' },
                { title: 'Total investi', value: metrics ? formatCurrency(metrics.totalInvested, metrics.currency) : 'N/D', icon: DollarSign, gradient: 'from-emerald-500 to-teal-600' },
                { title: 'Statut KYC', value: investor?.kycStatus || 'N/D', icon: ShieldCheck, gradient: 'from-amber-500 to-orange-600' },
                { title: 'Profil de risque', value: investor?.riskProfile || 'N/D', icon: TrendingUp, gradient: 'from-purple-500 to-indigo-600' },
            ]);
            setRecentActivity(
                [...subs]
                    .sort((a, b) => new Date(b.subscriptionDate) - new Date(a.subscriptionDate))
                    .slice(0, 6)
                    .map((s) => ({
                        id: s.id, type: 'Souscription', project: `Offre #${s.offerId}`,
                        amount: s.amount, date: s.subscriptionDate, status: s.status,
                    })),
            );
            setAllocationView(buildAllocationView(allocation));
        });
    }, []);

    return (
        <div className="space-y-8">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex justify-between items-center">
                <div>
                    <h1 className="text-4xl font-bold gradient-text mb-2">Tableau de Bord Investisseur</h1>
                    <p className="text-gray-400">Aperçu de la performance de votre portefeuille.</p>
                </div>
                <Button onClick={() => navigate('/opportunities')} className="bg-gradient-to-r from-emerald-500 to-blue-600">
                    <Plus className="w-4 h-4 mr-2" /> Nouvelle Opportunité
                </Button>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, index) => <StatCard key={index} {...stat} />)}
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-2 glass-effect rounded-2xl p-6">
                    <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                        <Activity className="w-5 h-5 text-blue-400" /> Activité Récente
                    </h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-gray-400 uppercase bg-white/5">
                                <tr>
                                    <th className="px-4 py-3">Type</th>
                                    <th className="px-4 py-3">Projet</th>
                                    <th className="px-4 py-3 text-right">Montant ($)</th>
                                    <th className="px-4 py-3">Date</th>
                                    <th className="px-4 py-3">Statut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentActivity.length === 0 && (
                                    <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Aucune activité récente.</td></tr>
                                )}
                                {recentActivity.map((activity) => (
                                    <tr key={activity.id} className="border-b border-white/5 hover:bg-white/5">
                                        <td className="px-4 py-3">{activity.type}</td>
                                        <td className="px-4 py-3 font-medium text-white">{activity.project}</td>
                                        <td className="px-4 py-3 text-right font-mono">{activity.amount.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-gray-400">{activity.date}</td>
                                        <td className="px-4 py-3">
                                            <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs">
                                                {activity.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-4 text-center">
                        <Button variant="ghost" onClick={() => navigate('/holdings')} className="text-sm text-blue-400 hover:text-blue-300">
                            Voir tous les flux financiers
                        </Button>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-effect rounded-2xl p-6">
                    <h2 className="text-xl font-bold text-white mb-6">Allocation d'Actifs</h2>
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={allocationView.slices} layout="vertical">
                             <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)"/>
                             <XAxis type="number" stroke="#9ca3af" hide />
                             <YAxis type="category" dataKey="name" stroke="#9ca3af" width={140} />
                             <Tooltip contentStyle={{ backgroundColor: 'rgba(30,41,59,0.9)', border: 'none' }} cursor={{fill: 'transparent'}} />
                             <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={30} label={{ position: 'right', fill: 'white' }} fill="#10b981" />
                        </BarChart>
                    </ResponsiveContainer>
                    {/* La nature de chaque part est écrite sous elle : « obligations »
                        recouvrait de l'argent encaissé ET des montants déclarés. */}
                    <div className="mt-4 space-y-2 text-xs">
                        {allocationView.slices.length === 0 && (
                            <p className="text-gray-500">Aucun actif à répartir.</p>
                        )}
                        {allocationView.slices.map((slice) => (
                            <div key={slice.name}>
                                <p className="text-gray-300">{slice.name}</p>
                                <p className="text-gray-500">{slice.note}</p>
                            </div>
                        ))}
                    </div>
                    {allocationView.reconciliationWarning && (
                        <p className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
                            {allocationView.reconciliationWarning}
                        </p>
                    )}
                </motion.div>
            </div>
        </div>
    );
};

// ====================================
// CLIENT DASHBOARD
// ====================================
const ClientDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stats, setStats] = useState([]);

  useEffect(() => {
    Promise.all([
        api.caisses.wallets.mine().catch(() => []),
        api.listApplications().catch(() => []),
    ]).then(([wallets, applications]) => {
        const usdWallet = wallets.find((w) => w.currency === 'USD');
        const cdfWallet = wallets.find((w) => w.currency === 'CDF');
        setStats([
            { title: 'Solde USD', value: `$${(usdWallet?.balance ?? 0).toLocaleString()}`, icon: Wallet, gradient: 'from-emerald-500 to-teal-600' },
            { title: 'Solde CDF', value: `${(cdfWallet?.balance ?? 0).toLocaleString()} FC`, icon: Repeat, gradient: 'from-blue-500 to-cyan-600' },
            { title: 'Dossiers de crédit', value: applications.length, icon: FileText, gradient: 'from-purple-500 to-indigo-600' },
            { title: 'Dossiers approuvés', value: applications.filter((a) => a.decision === 'APPROVE' || a.decision === 'ACCORDE').length, icon: CheckCircle, gradient: 'from-amber-500 to-orange-600' },
        ]);
    });
  }, []);

  return (
        <div className="space-y-8">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <h1 className="text-4xl font-bold gradient-text mb-2">Bonjour, {user?.name || 'Agri-Operator'}</h1>
                <p className="text-gray-400">Bienvenue sur votre espace de gestion financière agricole.</p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, index) => <StatCard key={index} {...stat} />)}
            </motion.div>

            {/* Quick Actions */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-effect rounded-2xl p-6">
                <h2 className="text-xl font-bold text-white mb-4">Actions Rapides</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Button onClick={() => navigate('/wallet')} className="h-24 flex flex-col gap-2 bg-slate-800/50 hover:bg-slate-700 border border-slate-700">
                        <Wallet className="w-6 h-6 text-emerald-400" />
                        <span>Faire un Dépôt</span>
                    </Button>
                    <Button onClick={() => navigate('/credits')} className="h-24 flex flex-col gap-2 bg-slate-800/50 hover:bg-slate-700 border border-slate-700">
                        <DollarSign className="w-6 h-6 text-blue-400" />
                        <span>Demander Crédit</span>
                    </Button>
                    <Button onClick={() => navigate('/wallet')} className="h-24 flex flex-col gap-2 bg-slate-800/50 hover:bg-slate-700 border border-slate-700">
                        <ArrowRightLeft className="w-6 h-6 text-purple-400" />
                        <span>Change Devise</span>
                    </Button>
                    <Button onClick={() => navigate('/documents')} className="h-24 flex flex-col gap-2 bg-slate-800/50 hover:bg-slate-700 border border-slate-700">
                        <FileText className="w-6 h-6 text-yellow-400" />
                        <span>Mes Documents</span>
                    </Button>
                </div>
            </motion.div>
        </div>
  );
};

const Dashboard = () => {
  const { user } = useAuth();
  const renderDashboardByRole = () => {
    switch (menuKeyFor(user)) {
      case 'admin': return <AdminDashboard />;
      case 'comptable': return <ComptableDashboard />;
      case 'caissier': return <CaissierDashboard />;
      case 'auditeur': return <AuditeurDashboard />;
      case 'client': return <ClientDashboard />;
      case 'investor': return <InvestorDashboard />;
      default: return <div>Chargement...</div>;
    }
  };
  return (
    <Layout>
      <Helmet><title>Tableau de Bord - AGRICAP FINTECH</title></Helmet>
      {renderDashboardByRole()}
    </Layout>
  );
};

export default Dashboard;

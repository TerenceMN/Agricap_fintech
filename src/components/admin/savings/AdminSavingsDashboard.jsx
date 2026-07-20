import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { DollarSign, PiggyBank, Bell, Users, TrendingUp, TrendingDown, Landmark, Link2, CalendarDays, Repeat } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminSavingsTable from './AdminSavingsTable';
import AdminGroupsTable from './AdminGroupsTable';
import { api } from '@/services/api';

const SummaryCard = ({ title, value, icon: Icon, trendValue, trendDirection }) => {
  const isUp = trendDirection === 'up';
  const trendColor = isUp ? 'text-emerald-400' : 'text-red-400';
  const TrendIcon = isUp ? TrendingUp : TrendingDown;

  return (
    <div className="bg-slate-800/50 p-4 rounded-lg flex flex-col justify-between h-full border border-slate-700/50 hover:border-slate-600 transition-colors">
        <div className="flex justify-between items-start">
            <p className="font-semibold text-sm text-slate-300">{title}</p>
            <Icon className="w-5 h-5 text-slate-500" />
        </div>
        <div>
            <p className="font-bold text-2xl text-white mt-2">{value}</p>
            {trendValue && (
                <p className={`text-xs font-semibold flex items-center gap-1 ${trendColor}`}>
                    <TrendIcon className="w-3 h-3" />
                    {trendValue}
                </p>
            )}
        </div>
    </div>
);
};

const AdminSavingsDashboard = () => {
    const { toast } = useToast();
    const [savings, setSavings] = useState([]);

    useEffect(() => {
        // objectif/interestRate/status (API) -> goal/rate/status capitalisé (attendus par
        // AdminSavingsTable/SavingsRow/SavingsObjectiveRow, hérités du mock d'origine).
        api.savings.allPlans().then(plans => setSavings(plans.map(p => ({
            ...p, holder: p.holder, goal: p.objectif, rate: p.interestRate,
            status: p.status.charAt(0).toUpperCase() + p.status.slice(1),
        })))).catch(() => {});
    }, []);

    const handleAction = (action, item) => {
        toast({
            title: `Action: ${action}`,
            description: `Dossier ${item.id}. Fonctionnalité non implémentée.`,
            className: 'bg-slate-800 text-white border-blue-500'
        });
    };

    const totalBalance = savings.reduce((sum, s) => sum + s.balance, 0);
    const avgRate = savings.length
        ? (savings.reduce((sum, s) => sum + s.rate, 0) / savings.length).toFixed(2) : 0;
    const summaryData = savings.length ? [
        { title: 'Comptes Actifs', value: savings.length, icon: PiggyBank },
        { title: 'Solde Total (Est.)', value: `${totalBalance.toLocaleString()} $`, icon: DollarSign },
        { title: 'Taux Moyen', value: `${avgRate}%`, icon: TrendingUp },
    ] : [];

    return (
        <div className="space-y-8">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <h2 className="text-xl font-bold text-white mb-4">Tableau de Bord Sommaire de l'Épargne</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {summaryData.map(item => <SummaryCard key={item.title} {...item} />)}
                </div>
            </motion.div>

            <Tabs defaultValue="individual" className="w-full">
                <TabsList className="grid w-full md:w-[400px] grid-cols-2 bg-slate-800/50 mb-6">
                    <TabsTrigger value="individual">Comptes Individuels</TabsTrigger>
                    <TabsTrigger value="group">Comptes de Groupes</TabsTrigger>
                </TabsList>
                
                <TabsContent value="individual">
                    <AdminSavingsTable savingsData={savings} onAction={handleAction} />
                </TabsContent>
                
                <TabsContent value="group">
                    <div className="glass-effect rounded-2xl p-6">
                         <div className="mb-4">
                            <h3 className="text-lg font-bold text-white">Gestion des Groupes d'Épargne (AVEC, Mutuelles, Coopératives)</h3>
                            <p className="text-sm text-slate-400">Administrez les groupes, gérez les membres et les demandes d'intégration.</p>
                        </div>
                        <AdminGroupsTable />
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default AdminSavingsDashboard;
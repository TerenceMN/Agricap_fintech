import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import {
  DollarSign, Banknote, Landmark, TrendingUp, TrendingDown, ArrowRightLeft, AlertTriangle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import TreasuryAccountsManager from '@/components/treasury/TreasuryAccountsManager';
import { api } from '@/services/api';

const SummaryCard = ({ title, value, icon: Icon, color, trend, trendValue }) => (
    <div className="glass-effect p-5 rounded-xl">
        <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-slate-400">{title}</p>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-4 h-4 text-white" />
            </div>
        </div>
        <p className="text-3xl font-bold text-white">{value}</p>
        {trend && (
            <div className={`mt-2 flex items-center text-xs ${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
                {trend === 'up' ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                <span>{trendValue}</span>
            </div>
        )}
    </div>
);

const Treasury = () => {
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);

  useEffect(() => { api.caisses.accounts.list().then(setAccounts).catch(() => {}); }, []);

  const totalUSD = accounts.filter(a => a.currency === 'USD').reduce((sum, a) => sum + a.balance, 0);
  // Répartition des fonds par compte (remplace le graphique vide) — pas de série
  // temporelle réelle disponible (flux entrants/sortants du jour non agrégés côté
  // backend), seule la répartition instantanée par compte est réelle.
  const fundsData = accounts.map(a => ({ name: a.name, value: a.balance }));

  return (
    <Layout>
      <Helmet>
        <title>Trésorerie - AGRICAP FINTECH</title>
        <meta name="description" content="Gestion de la trésorerie et de la liquidité de l'institution." />
      </Helmet>

      <TreasuryAccountsManager isOpen={isManagerOpen} onClose={() => setIsManagerOpen(false)} />

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold gradient-text mb-2">Trésorerie & Liquidité</h1>
        <p className="text-gray-400">Vue d'ensemble de la santé financière et des liquidités de l'institution.</p>
      </motion.div>
      
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <SummaryCard title="Solde Global (USD)" value={`${totalUSD.toLocaleString()} $`} icon={DollarSign} color="bg-emerald-500" />
          <SummaryCard title="Comptes de Trésorerie" value={accounts.length} icon={Landmark} color="bg-blue-500" />
          <SummaryCard title="Comptes Bloqués" value={accounts.filter(a => a.status === 'BLOQUE').length} icon={TrendingDown} color="bg-purple-500" />
          <SummaryCard title="Seuil de Réserve" value="Actif" icon={AlertTriangle} color="bg-yellow-500" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8"
      >
        <div className="lg:col-span-2 glass-effect p-6 rounded-2xl">
          <h2 className="text-xl font-bold text-white mb-4">Répartition des Fonds</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={fundsData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
              <defs>
                <linearGradient id="colorUv" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.8}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
              <XAxis type="number" stroke="#888888" tickFormatter={(value) => `${(value/1000)}k`}/>
              <YAxis type="category" dataKey="name" stroke="#888888" width={120} />
              <Tooltip
                  cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }}
                  contentStyle={{
                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    color: '#ffffff'
                  }}
                />
              <Bar dataKey="value" fill="url(#colorUv)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-effect p-6 rounded-2xl flex flex-col gap-4">
             <h2 className="text-xl font-bold text-white">Opérations de Trésorerie</h2>
             <Button className="w-full"><ArrowRightLeft className="w-4 h-4 mr-2"/> Mouvement Interne</Button>
             <div className="border-t border-slate-700/50 pt-4">
                <h3 className="font-semibold text-white mb-2">Comptes Partenaires</h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2"><Landmark className="w-4 h-4 text-slate-400"/> Rawbank Compte Courant</span>
                        <span className="font-mono">... 4567</span>
                    </div>
                     <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2"><Banknote className="w-4 h-4 text-slate-400"/> M-Pesa Business</span>
                        <span className="font-mono">... 1234</span>
                    </div>
                </div>
             </div>
             <Button variant="outline" className="mt-auto" onClick={() => setIsManagerOpen(true)}>Gérer les comptes</Button>
        </div>
      </motion.div>
    </Layout>
  );
};

export default Treasury;
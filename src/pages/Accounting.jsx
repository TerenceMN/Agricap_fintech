import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRightLeft } from 'lucide-react';
import JournalViewer from '@/components/accounting/JournalViewer';
import ChartOfAccountsViewer from '@/components/accounting/ChartOfAccountsViewer';
import FinancialStatementsViewer from '@/components/accounting/FinancialStatementsViewer';
import ExchangeRateManager from '@/components/accounting/ExchangeRateManager';
import PiecesViewer from '@/components/accounting/PiecesViewer';
import ProvisionsViewer from '@/components/accounting/ProvisionsViewer';
import RestitutionsViewer from '@/components/accounting/RestitutionsViewer';
import { api } from '@/services/api';

/*
 * ⚠ `EtatsComptables.jsx` existe mais n'est VOLONTAIREMENT pas monté ici.
 *
 * Il sert bilan et compte de résultat depuis l'app `accounting` (bi-devise),
 * alors que l'onglet « États Financiers » ci-dessous sert les MÊMES états depuis
 * l'app `ledger` (SYSCOHADA, mono-devise). Les afficher côte à côte donnerait
 * deux bilans contradictoires dans le même écran, sans qu'un comptable puisse
 * savoir lequel fait foi. L'audit a classé ce doublon de grands livres en
 * constat majeur — dont la collision du compte 137, qui vaut « Provisions pour
 * risques de crédit » d'un côté et « Résultat des activités ordinaires » de
 * l'autre.
 *
 * Quel moteur fait autorité est une décision du fondateur, pas un arbitrage
 * d'ingénierie. Tant qu'elle n'est pas prise, on n'en affiche qu'un seul.
 */

const Accounting = () => {
  const [todayRate, setTodayRate] = useState(null);
  useEffect(() => { api.fx.current('CLIENT', 'USD').then(r => setTodayRate(r)).catch(() => {}); }, []);

  return (
    <Layout>
      <Helmet>
        <title>Comptabilité - AGRICAP FINTECH</title>
        <meta name="description" content="Gestion comptable bi-monnaie (FC/USD) de l'institution." />
      </Helmet>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold gradient-text mb-2">Comptabilité Bi-Monnaie</h1>
        <p className="text-gray-400">Journaux FC & USD, plan comptable, et génération d'états financiers consolidés.</p>
      </motion.div>
      
       <Tabs defaultValue="rates" className="mt-8">
        <TabsList className="grid w-full grid-cols-4 lg:grid-cols-8 bg-slate-800/60">
            <TabsTrigger value="rates">Taux de Change</TabsTrigger>
            <TabsTrigger value="dashboard">Tableau de Bord</TabsTrigger>
            <TabsTrigger value="journal">Journaux</TabsTrigger>
            <TabsTrigger value="plan">Plan Comptable</TabsTrigger>
            <TabsTrigger value="pieces">Pièces</TabsTrigger>
            <TabsTrigger value="provisions">Provisions</TabsTrigger>
            <TabsTrigger value="restitutions">Restitutions</TabsTrigger>
            <TabsTrigger value="etats">États Financiers</TabsTrigger>
        </TabsList>

        <TabsContent value="rates" className="mt-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <ExchangeRateManager />
            </motion.div>
        </TabsContent>

        <TabsContent value="dashboard" className="mt-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 glass-effect p-6 rounded-2xl flex flex-col justify-center items-center">
                    <h2 className="text-xl font-bold text-white mb-2">Taux de Change du Jour</h2>
                    <div className="flex items-center gap-4">
                        <span className="text-2xl font-bold text-yellow-400">1 USD</span>
                        <ArrowRightLeft className="w-6 h-6 text-slate-400"/>
                        <span className="text-2xl font-bold text-emerald-400">{todayRate ? `${todayRate.sell} FC` : 'Non configuré'}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">{todayRate ? `Effectif au ${todayRate.effectiveDate}` : 'Aucun taux client défini pour aujourd\'hui'}</p>
                </div>
            </motion.div>
        </TabsContent>
        <TabsContent value="journal" className="mt-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <JournalViewer />
            </motion.div>
        </TabsContent>
        <TabsContent value="plan" className="mt-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <ChartOfAccountsViewer />
            </motion.div>
        </TabsContent>
        <TabsContent value="pieces" className="mt-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <PiecesViewer />
            </motion.div>
        </TabsContent>
        <TabsContent value="provisions" className="mt-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <ProvisionsViewer />
            </motion.div>
        </TabsContent>
        <TabsContent value="restitutions" className="mt-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <RestitutionsViewer />
            </motion.div>
        </TabsContent>
         <TabsContent value="etats" className="mt-6">
            <FinancialStatementsViewer />
        </TabsContent>
      </Tabs>
    </Layout>
  );
};

export default Accounting;
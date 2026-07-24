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
import EtatsComptables from '@/components/accounting/EtatsComptables';
import { api } from '@/services/api';

/*
 * ⚠ DEUX GRANDS LIVRES COEXISTENT — et cette page les montre tous les deux.
 *
 * L'onglet « États — SYSCOHADA » lit l'app `ledger` (mono-devise) ; l'onglet
 * « États — bi-devise » lit l'app `accounting`. Les deux produisent un bilan et
 * un compte de résultat, à partir d'écritures différentes : leurs chiffres
 * peuvent donc diverger légitimement.
 *
 * On les affiche côte à côte MAIS jamais anonymement : chaque onglet annonce sa
 * source. Masquer l'un donnerait l'illusion d'une comptabilité unique ; les
 * confondre serait pire. L'audit a classé ce doublon en constat majeur — dont la
 * collision du compte 137, qui vaut « Provisions pour risques de crédit » d'un
 * côté et « Résultat des activités ordinaires » de l'autre.
 *
 * Désigner le moteur qui fait autorité est une décision du fondateur, pas un
 * arbitrage d'ingénierie. Tant qu'elle n'est pas prise, on nomme la source.
 */

/** Bandeau de provenance — un état financier sans son grand livre d'origine
 *  n'est pas interprétable tant que les deux moteurs coexistent. */
const SourceGrandLivre = ({ app, description }) => (
  <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
    <p className="text-sm text-amber-200">
      Source : grand livre <span className="font-mono font-semibold">{app}</span> — {description}
    </p>
    <p className="text-xs text-amber-300/70 mt-1">
      Deux grands livres coexistent dans l’institution et n’ont pas été rapprochés.
      Les chiffres de cet onglet ne sont comparables qu’à ceux de la même source.
    </p>
  </div>
);

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
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-9 bg-slate-800/60">
            <TabsTrigger value="rates">Taux de Change</TabsTrigger>
            <TabsTrigger value="dashboard">Tableau de Bord</TabsTrigger>
            <TabsTrigger value="journal">Journaux</TabsTrigger>
            <TabsTrigger value="plan">Plan Comptable</TabsTrigger>
            <TabsTrigger value="pieces">Pièces</TabsTrigger>
            <TabsTrigger value="provisions">Provisions</TabsTrigger>
            <TabsTrigger value="restitutions">Restitutions</TabsTrigger>
            <TabsTrigger value="etats">États — SYSCOHADA</TabsTrigger>
            <TabsTrigger value="etats-bidevise">États — bi-devise</TabsTrigger>
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
            <SourceGrandLivre
                app="ledger"
                description="plan SYSCOHADA, écritures mono-devise."
            />
            <FinancialStatementsViewer />
        </TabsContent>
        <TabsContent value="etats-bidevise" className="mt-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <SourceGrandLivre
                    app="accounting"
                    description="écritures bi-devise (FC/USD), avec consolidation au taux de clôture."
                />
                <EtatsComptables />
            </motion.div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
};

export default Accounting;
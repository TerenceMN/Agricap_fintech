import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '@/components/ui/use-toast';
import { DollarSign, Smartphone, Landmark, Repeat, AlertTriangle, Clock } from 'lucide-react';
import AdminTransactionsTable from './AdminTransactionsTable';

const initialTransactionsData = [
    { id: 'TX-2025-001', datetime: '2025-10-28 09:45', type: 'Dépôt Épargne', amount: 350, currency: 'USD', sourceAccount: 'Opérateur #AGF-0021', destAccount: 'Compte AGRICAP', channel: 'Airtel Money', reference: 'TXN-4452-AM', portfolio: '#PF-01', status: 'Validé', operator: 'Ferme Kasapa', verifiedBy: 'Mutombo A.', origin: 'API Airtel', link: 'Épargne #ESP-001', description: 'Dépôt mensuel planifié', docs: true, validation: 'Agent + Admin', signature: true },
    { id: 'TX-2025-002', datetime: '2025-10-28 10:30', type: 'Prélèvement Intérêt', amount: 75, currency: 'USD', sourceAccount: 'Crédit #CRD-023', destAccount: 'Épargne #ESP-102', channel: 'Interne', reference: 'SYS-AUTO-INT', portfolio: '#PF-04', status: 'Effectué', operator: 'Système', verifiedBy: 'Auto', origin: 'Automatique', link: 'Crédit #CRD-023', description: 'Remboursement partiel intérêt', docs: false, validation: 'Auto', signature: true },
    { id: 'TX-2025-003', datetime: '2025-10-28 13:10', type: 'Retrait Épargne', amount: 120, currency: 'USD', sourceAccount: 'Épargne #ESP-054', destAccount: 'Airtel Money (Client)', channel: 'Mobile Money', reference: 'TX-RT-983', portfolio: '#PF-02', status: 'En attente', operator: 'Groupe AgroNord', verifiedBy: 'Monga C.', origin: 'Agent Agricap', link: 'Épargne #ESP-054', description: 'Urgence exploitation', docs: true, validation: 'Gestionnaire', signature: false },
    { id: 'TX-2025-004', datetime: '2025-10-29 11:20', type: 'Transfert Interne', amount: 500, currency: 'USD', sourceAccount: 'Épargne #ESP-120', destAccount: 'Crédit #CRD-031', channel: 'Interne Agricap', reference: 'TX-IN-552', portfolio: '#PF-05', status: 'Terminé', operator: 'Coop. AgroFemmes', verifiedBy: 'Ngoma K.', origin: 'Agent Agricap', link: 'Épargne/Crédit', description: 'Garantie de prêt', docs: false, validation: 'Validé', signature: true },
    { id: 'TX-2025-005', datetime: '2025-10-29 15:45', type: 'Conversion Invest.', amount: 1000, currency: 'USD', sourceAccount: 'Investisseur #INV-006', destAccount: 'Projet AgroTech', channel: 'Gestionnaire', reference: 'TX-CNV-900', portfolio: '#INV-03', status: 'En cours', operator: 'Elongo S.', verifiedBy: 'Admin principal', origin: 'Interface web', link: 'Investissement #INV-006', description: 'Transfo. financement → actions', docs: true, validation: 'Étape 2/3', signature: false },
    { id: 'TX-2025-006', datetime: '2025-10-30 18:00', type: 'Paiement Fournisseur', amount: 450, currency: 'USD', sourceAccount: 'Crédit #CRD-028', destAccount: 'Fournisseur #SUP-004', channel: 'Wallet', reference: 'PAY-SUP-341', portfolio: '#PF-03', status: 'Échoué', operator: 'Ferme du Lac', verifiedBy: 'Système', origin: 'API', link: 'Crédit #CRD-028', description: 'Achat semences', docs: false, validation: 'N/A', signature: false },
];

const SummaryCard = ({ title, value, change, comment }) => (
    <div className="bg-slate-800/50 p-4 rounded-lg">
        <p className="text-sm text-slate-400">{title}</p>
        <p className="text-2xl font-bold text-white mt-1">{value}</p>
        <div className="flex justify-between items-end mt-1">
            <p className="text-xs text-slate-500">{comment}</p>
            <p className={`text-sm font-semibold ${change.startsWith('+') ? 'text-emerald-400' : 'text-red-400'}`}>{change}</p>
        </div>
    </div>
);

const AdminTransactionsDashboard = () => {
    const { toast } = useToast();
    const [transactions, setTransactions] = useState(initialTransactionsData);

    const handleAction = (action, item) => {
        toast({
            title: `Action: ${action}`,
            description: `Dossier ${item.id}. Fonctionnalité non implémentée.`,
            className: 'bg-slate-800 text-white border-blue-500'
        });
    };
    
    const summaryData = [];

    return (
        <div className="space-y-8">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <h2 className="text-xl font-bold text-white mb-4">Tableau de Bord Synthétique</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {summaryData.map(item => <SummaryCard key={item.title} {...item} />)}
                </div>
            </motion.div>
            <AdminTransactionsTable transactionsData={transactions} onAction={handleAction} />
        </div>
    );
};

export default AdminTransactionsDashboard;
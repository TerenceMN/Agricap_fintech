import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, Sparkles } from 'lucide-react';

const mockMovements = {
    'ESP-2025-001': [
        { date: '10/09/2025', type: 'Dépôt Initial', amount: 500, currency: 'USD', channel: 'Agent Agricap', ref: 'TX-AGF-091', balance: 500, verifiedBy: 'Mutombo A.', status: 'Validé' },
        { date: '20/09/2025', type: 'Dépôt Mobile Money', amount: 250, currency: 'USD', channel: 'M-Pesa', ref: 'TRX-2440', balance: 750, verifiedBy: 'Automatique', status: 'Validé' },
        { date: '15/10/2025', type: 'Intérêts Mensuels', amount: 5, currency: 'USD', channel: 'Automatique', ref: 'SYS-INT-15', balance: 755, verifiedBy: 'Système', status: 'Validé' },
        { date: '25/10/2025', type: 'Retrait', amount: -100, currency: 'USD', channel: 'Airtel Money', ref: 'TRX-2874', balance: 655, verifiedBy: 'Gestionnaire', status: 'En attente' },
    ],
    'ESP-2025-002': [
        { date: '18/09/2025', type: 'Dépôt Initial', amount: 15600000, currency: 'CDF', channel: 'Virement Bancaire', ref: 'BGFI-DEP-012', balance: 15600000, verifiedBy: 'Admin', status: 'Validé' },
        { date: '01/10/2025', type: 'Intérêts Mensuels', amount: 480000, currency: 'CDF', channel: 'Automatique', ref: 'SYS-INT-22', balance: 16080000, verifiedBy: 'Système', status: 'Validé' },
    ],
};

const statusVariantMap = {
    'Validé': 'success',
    'En attente': 'info',
};

const TypeIcon = ({ type, amount }) => {
    if (type.toLowerCase().includes('dépôt')) return <ArrowUp className="h-4 w-4 text-emerald-400" />;
    if (type.toLowerCase().includes('retrait')) return <ArrowDown className="h-4 w-4 text-red-400" />;
    if (type.toLowerCase().includes('intérêt')) return <Sparkles className="h-4 w-4 text-yellow-400" />;
    return null;
}

const MovementSubTable = ({ savingsId }) => {
    const movements = mockMovements[savingsId] || [];

    return (
        <div className="p-4 bg-slate-800/50">
            <h4 className="text-md font-semibold text-white mb-3">Historique des Mouvements</h4>
            <Table>
                <TableHeader>
                    <TableRow className="border-slate-700 text-xs">
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Canal</TableHead>
                        <TableHead>Référence</TableHead>
                        <TableHead className="text-right">Montant</TableHead>
                        <TableHead className="text-right">Solde Après</TableHead>
                        <TableHead>Statut</TableHead>
                        <TableHead>Vérifié par</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {movements.map((mov, index) => (
                        <TableRow key={index} className="border-slate-700 text-xs">
                            <TableCell>{mov.date}</TableCell>
                            <TableCell className="font-medium flex items-center gap-2">
                                <TypeIcon type={mov.type} amount={mov.amount} />
                                {mov.type}
                            </TableCell>
                            <TableCell>{mov.channel}</TableCell>
                            <TableCell className="font-mono">{mov.ref}</TableCell>
                            <TableCell className={`text-right font-mono ${mov.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {mov.amount.toLocaleString('fr-FR')} {mov.currency}
                            </TableCell>
                            <TableCell className="text-right font-mono text-slate-300">
                                {mov.balance.toLocaleString('fr-FR')} {mov.currency}
                            </TableCell>
                            <TableCell>
                                <Badge variant={statusVariantMap[mov.status] || 'default'}>{mov.status}</Badge>
                            </TableCell>
                            <TableCell>{mov.verifiedBy}</TableCell>
                        </TableRow>
                    ))}
                     {movements.length === 0 && (
                        <TableRow className="border-slate-700">
                            <TableCell colSpan={8} className="text-center text-slate-400 py-4">Aucun mouvement pour ce compte.</TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    );
};

export default MovementSubTable;
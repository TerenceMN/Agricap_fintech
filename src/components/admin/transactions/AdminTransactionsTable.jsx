import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, FileDown, SlidersHorizontal } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { exportToExcel } from '@/lib/export.js';
import TransactionRow from './TransactionRow';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const AdminTransactionsTable = ({ transactionsData, onAction }) => {
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({
        status: { 'Validé': true, 'Effectué': true, 'En attente': true, 'Terminé': true, 'En cours': true, 'Échoué': true },
        channel: { 'Airtel Money': true, 'Interne': true, 'Mobile Money': true, 'Interne Agricap': true, 'Gestionnaire': true, 'Wallet': true },
    });

    const handleFilterChange = (type, value) => {
        setFilters(prev => ({
            ...prev,
            [type]: {
                ...prev[type],
                [value]: !prev[type][value]
            }
        }));
    };

    const filteredData = useMemo(() => {
        const activeStatusFilters = Object.keys(filters.status).filter(key => filters.status[key]);
        const activeChannelFilters = Object.keys(filters.channel).filter(key => filters.channel[key]);

        return transactionsData.filter(tx => {
            const term = searchTerm.toLowerCase();
            const searchMatch = term === '' || 
                tx.id.toLowerCase().includes(term) ||
                tx.operator.toLowerCase().includes(term) ||
                tx.sourceAccount.toLowerCase().includes(term) ||
                tx.destAccount.toLowerCase().includes(term) ||
                tx.reference.toLowerCase().includes(term);

            const statusMatch = activeStatusFilters.includes(tx.status);
            const channelMatch = activeChannelFilters.includes(tx.channel);

            return searchMatch && statusMatch && channelMatch;
        });
    }, [transactionsData, searchTerm, filters]);

    const handleExport = () => {
        const dataToExport = filteredData.map(tx => ({
            "ID Transaction": tx.id,
            "Date/Heure": tx.datetime,
            "Type": tx.type,
            "Montant": tx.amount,
            "Devise": tx.currency,
            "Compte Source": tx.sourceAccount,
            "Compte Destination": tx.destAccount,
            "Canal": tx.channel,
            "Référence": tx.reference,
            "Portefeuille": tx.portfolio,
            "Statut": tx.status,
            "Opérateur": tx.operator,
            "Vérifié par": tx.verifiedBy,
            "Origine": tx.origin,
            "Lien": tx.link,
            "Description": tx.description,
        }));
        exportToExcel(dataToExport, 'rapport_transactions_global');
        toast({ title: "Exportation réussie!", description: "Le rapport global des transactions a été téléchargé." });
    };

    return (
        <div className="glass-effect rounded-2xl p-6">
            <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-4">
                <div className="relative w-full md:w-auto md:flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input placeholder="Rechercher par ID, opérateur, compte, référence..." className="pl-10 bg-slate-900/50 border-slate-700" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2 justify-start md:justify-end">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="border-slate-600 hover:bg-slate-700"><SlidersHorizontal className="w-4 h-4 mr-2" /> Filtres</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-56 bg-slate-800/80 backdrop-blur border-slate-700 text-slate-200">
                            <DropdownMenuLabel>Statut</DropdownMenuLabel>
                            <DropdownMenuSeparator className="bg-slate-700" />
                            {Object.keys(filters.status).map(status => (
                                <DropdownMenuCheckboxItem key={status} checked={filters.status[status]} onCheckedChange={() => handleFilterChange('status', status)}>
                                    {status}
                                </DropdownMenuCheckboxItem>
                            ))}
                             <DropdownMenuLabel className="mt-2">Canal</DropdownMenuLabel>
                            <DropdownMenuSeparator className="bg-slate-700" />
                            {Object.keys(filters.channel).map(channel => (
                                <DropdownMenuCheckboxItem key={channel} checked={filters.channel[channel]} onCheckedChange={() => handleFilterChange('channel', channel)}>
                                    {channel}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="outline" className="border-slate-600 hover:bg-slate-700" onClick={handleExport}><FileDown className="w-4 h-4 mr-2" /> Exporter</Button>
                </div>
            </div>
            
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
                <Table>
                    <TableHeader>
                        <TableRow className="border-slate-800 hover:bg-transparent text-xs whitespace-nowrap">
                            <TableHead>ID Transaction</TableHead>
                            <TableHead>Date / Heure</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Montant</TableHead>
                            <TableHead>Compte Source</TableHead>
                            <TableHead>Compte Destination</TableHead>
                            <TableHead>Canal</TableHead>
                            <TableHead>Statut</TableHead>
                            <TableHead>Lien Opération</TableHead>
                            <TableHead>Signature</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredData.map(item => <TransactionRow key={item.id} transaction={item} onAction={onAction} />)}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};

export default AdminTransactionsTable;
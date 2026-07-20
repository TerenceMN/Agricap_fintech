import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import CreditRow from './CreditRow';
import CreditDetailsModal from './CreditDetailsModal';
import RateMaturityModal from './RateMaturityModal';
import { Search, FileDown, UserPlus, RefreshCw, Calculator, CalendarDays, AlertCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { exportToExcel } from '@/lib/export.js';

const CreditsTable = ({ credits, onAction }) => {
    const { toast } = useToast();
    const [filter, setFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isRateModalOpen, setIsRateModalOpen] = useState(false);
    const [selectedCredit, setSelectedCredit] = useState(null);

    const handleRowAction = (action, credit) => {
        if (action === 'details') {
            setSelectedCredit(credit);
            setIsModalOpen(true);
        } else if (action === 'configure_rate') {
            setSelectedCredit(credit);
            setIsRateModalOpen(true);
        } else {
            onAction(action, credit);
        }
    };
    
    const filteredCredits = useMemo(() => {
        return credits.filter(c => {
            const statusMatch = c.status.toLowerCase();
            const filterValue = filter.toLowerCase();

            const matchesFilter = filterValue === 'all' || statusMatch === filterValue;
            
            const matchesSearch = searchTerm === '' || 
                c.operator.toLowerCase().includes(searchTerm.toLowerCase()) || 
                c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.manager.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesFilter && matchesSearch;
        });
    }, [credits, filter, searchTerm]);

    const filterButtons = [
        { label: 'Tous', value: 'all' },
        { label: 'En traitement', value: 'En traitement' },
        { label: 'Approuvé', value: 'Approuvé' },
        { label: 'Défaut', value: 'Défaut' },
        { label: 'Clôturé', value: 'Clôturé' },
    ];

    const handleExport = () => {
        const dataToExport = filteredCredits.map(c => ({
            "ID Crédit": c.id,
            "Date": c.date,
            "Bénéficiaire": c.operator,
            "Catégorie": c.type,
            "Demandé": c.amountRequested,
            "Approuvé": c.amountApproved,
            "Décaissé": c.amountDisbursed,
            "Devise": c.currency,
            "Durée (mois)": c.duration,
            "Taux (%)": c.rate,
            "Échéance": c.dueDate,
            "Gestionnaire": c.manager,
            "Investisseur": c.investor,
            "Source": c.source,
            "Statut": c.status,
            "Score": c.score,
            "Garantie": c.guarantee,
            "Progression (%)": c.progress,
        }));
        exportToExcel(dataToExport, 'rapport_credits');
        toast({ title: "Exportation réussie!", description: "Le fichier 'rapport_credits.xlsx' a été téléchargé." });
    };

    return (
        <div className="glass-effect rounded-2xl p-6">
            <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-4">
                <div className="relative w-full md:w-auto md:flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input placeholder="Rechercher par nom, ID, gestionnaire..." className="pl-10 bg-slate-900/50 border-slate-700" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2 justify-start md:justify-end">
                    <Button className="bg-gradient-to-r from-emerald-500 to-blue-600" onClick={() => onAction('add_manual', {})}><UserPlus className="w-4 h-4 mr-2" /> Ajouter</Button>
                    <Button variant="outline" className="border-slate-600 hover:bg-slate-700" onClick={handleExport}><FileDown className="w-4 h-4 mr-2" /> Exporter</Button>
                </div>
            </div>
             <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
                 <div className="flex flex-wrap gap-2">
                    {filterButtons.map(fb => (
                        <Button key={fb.value} variant={filter === fb.value ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(fb.value)} className={`transition-all ${filter === fb.value ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800'}`}>
                            {fb.label}
                        </Button>
                    ))}
                </div>
                 <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800/50 hover:bg-slate-700/70" onClick={() => onAction('sync', {})}><RefreshCw className="w-4 h-4 mr-2" /> Synchroniser</Button>
                    <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800/50 hover:bg-slate-700/70" onClick={() => onAction('simulator', {})}><Calculator className="w-4 h-4 mr-2" /> Simulateur</Button>
                    <Button variant="outline" size="sm" className="border-slate-700 bg-slate-800/50 hover:bg-slate-700/70" onClick={() => onAction('calendar_view', {})}><CalendarDays className="w-4 h-4 mr-2" /> Vue Échéances</Button>
                    <Button variant="outline" size="sm" className="border-yellow-500/50 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20" onClick={() => onAction('alerts', {})}><AlertCircle className="w-4 h-4 mr-2" /> Alertes</Button>
                </div>
            </div>
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
                <Table>
                    <TableHeader>
                        <TableRow className="border-slate-800 hover:bg-transparent">
                            <TableHead className="w-12"></TableHead>
                            <TableHead>ID Crédit</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Bénéficiaire</TableHead>
                            <TableHead>Catégorie</TableHead>
                            <TableHead className="text-right">Demandé</TableHead>
                            <TableHead className="text-right">Approuvé</TableHead>
                            <TableHead className="text-right">Décaissé</TableHead>
                            <TableHead>Devise</TableHead>
                            <TableHead className="text-center">Durée</TableHead>
                            <TableHead className="text-center">Taux</TableHead>
                            <TableHead>Échéance</TableHead>
                            <TableHead>Gestionnaire</TableHead>
                            <TableHead>Investisseur</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Statut</TableHead>
                            <TableHead>Score</TableHead>
                            <TableHead>Garantie</TableHead>
                            <TableHead>Progression</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredCredits.map(credit => <CreditRow key={credit.id} credit={credit} onAction={handleRowAction} />)}
                    </TableBody>
                </Table>
            </div>
            <CreditDetailsModal isOpen={isModalOpen} onOpenChange={setIsModalOpen} credit={selectedCredit} />
            <RateMaturityModal isOpen={isRateModalOpen} onOpenChange={setIsRateModalOpen} credit={selectedCredit} />
        </div>
    );
};

export default CreditsTable;
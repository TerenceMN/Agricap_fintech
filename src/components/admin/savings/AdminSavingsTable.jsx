import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, FileDown, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { exportToExcel } from '@/lib/export.js';
import SavingsRow from './SavingsRow';
import SavingsRateModal from './SavingsRateModal';
import SavingsAdjustmentModal from './SavingsAdjustmentModal';

const AdminSavingsTable = ({ savingsData, onAction }) => {
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [isRateModalOpen, setIsRateModalOpen] = useState(false);
    const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
    const [selectedObjective, setSelectedObjective] = useState(null);

    const handleRowAction = (action, objective) => {
        if (action === 'configure_rate') {
            setSelectedObjective(objective);
            setIsRateModalOpen(true);
        } else if (action === 'adjust_savings') {
            setSelectedObjective(objective);
            setIsAdjustModalOpen(true);
        } else if (action === 'edit_obj' || action === 'details') {
            onAction(action, objective);
        } else {
            onAction(action, objective);
        }
    };
    
    // Group Data by Holder for Level 1
    const groupedData = useMemo(() => {
        const filtered = savingsData.filter(s => {
            const term = searchTerm.toLowerCase();
            return term === '' || 
                s.holder.toLowerCase().includes(term) || 
                s.id.toLowerCase().includes(term) ||
                (s.name && s.name.toLowerCase().includes(term));
        });

        const groups = {};
        filtered.forEach(item => {
            if (!groups[item.holder]) {
                groups[item.holder] = [];
            }
            groups[item.holder].push(item);
        });
        return groups;
    }, [savingsData, searchTerm]);


    const handleExport = () => {
        const dataToExport = savingsData.map(s => ({
            "ID": s.id,
            "Titulaire": s.holder,
            "Objectif": s.name || "N/A",
            "Type": s.objectiveType || s.type,
            "Solde": s.balance,
            "Cible": s.goal,
            "Devise": s.currency,
        }));
        exportToExcel(dataToExport, 'rapport_epargnes_agro');
        toast({ title: "Exportation réussie!", description: "Le fichier a été téléchargé." });
    };

    return (
        <div className="glass-effect rounded-2xl p-6">
            <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-4">
                <div className="relative w-full md:w-auto md:flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input placeholder="Rechercher par titulaire, objectif..." className="pl-10 bg-slate-900/50 border-slate-700" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2 justify-start md:justify-end">
                    <Button className="bg-gradient-to-r from-emerald-500 to-blue-600" onClick={() => onAction('add_saving', {})}><Plus className="w-4 h-4 mr-2" /> Ouvrir Compte</Button>
                    <Button variant="outline" className="border-slate-600 hover:bg-slate-700" onClick={handleExport}><FileDown className="w-4 h-4 mr-2" /> Exporter</Button>
                </div>
            </div>
            
            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
                <Table>
                    <TableHeader>
                        <TableRow className="border-slate-800 hover:bg-transparent text-xs whitespace-nowrap bg-slate-900/80">
                            <TableHead className="w-10"></TableHead>
                            <TableHead>Compte Principal (Titulaire)</TableHead>
                            <TableHead>Solde Total</TableHead>
                            <TableHead className="text-center">Objectifs</TableHead>
                            <TableHead className="text-center">Taux Moy.</TableHead>
                            <TableHead>Statut Global</TableHead>
                            <TableHead className="text-right">Gestion Groupe</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Object.entries(groupedData).map(([holder, objectives]) => (
                            <SavingsRow 
                                key={holder} 
                                holderName={holder} 
                                objectives={objectives} 
                                onAction={handleRowAction} 
                            />
                        ))}
                        {Object.keys(groupedData).length === 0 && (
                            <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-500">Aucune donnée trouvée.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            
            <SavingsRateModal isOpen={isRateModalOpen} onOpenChange={setIsRateModalOpen} savings={selectedObjective} />
            <SavingsAdjustmentModal isOpen={isAdjustModalOpen} onOpenChange={setIsAdjustModalOpen} savings={selectedObjective} />
        </div>
    );
};

export default AdminSavingsTable;
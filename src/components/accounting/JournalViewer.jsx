import React, { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileDown, FileType, Filter, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from '@/components/ui/input';
import { exportToExcel, exportToPDF } from '@/lib/export';
import { useToast } from "@/components/ui/use-toast";
import { api } from '@/services/api';

const STATUS_CODE_TO_LABEL = { VALIDE: 'validé', EN_ATTENTE: 'en_attente', REJETE: 'rejeté' };

// Une écriture réelle (backend `ledger`) peut porter plus de 2 lignes ; cette page
// n'affiche que le premier débit/crédit pour rester compatible avec le tableau simple
// hérité du mock (dégradation gracieuse, pas un crash sur des écritures complexes).
const flattenEntry = (entry) => {
    const debitLine = entry.lines.find(l => l.debit > 0);
    const creditLine = entry.lines.find(l => l.credit > 0);
    return {
        date: entry.date, piece_ref: entry.pieceRef, description: entry.description,
        compte_debit: debitLine?.account || '-', compte_credit: creditLine?.account || '-',
        montant: debitLine?.debit || creditLine?.credit || 0, devise: entry.currency,
        statut: STATUS_CODE_TO_LABEL[entry.status] || entry.status,
    };
};

const journalTypes = [
    { value: 'JCR-FC', label: 'JCR-FC: Journal Crédit FC' },
    { value: 'JCR-USD', label: 'JCR-USD: Journal Crédit USD' },
    { value: 'JEP-FC', label: 'JEP-FC: Journal Épargne FC' },
    { value: 'JEP-USD', label: 'JEP-USD: Journal Épargne USD (Vide)' },
    { value: 'JCA-FC', label: 'JCA-FC: Journal de Caisse FC (Vide)' },
    { value: 'JCA-USD', label: 'JCA-USD: Journal de Caisse USD (Vide)' },
    { value: 'JMM-FC', label: 'JMM-FC: Journal Mobile Money FC (Vide)' },
    { value: 'JFX', label: 'JFX: Journal des Opérations de Change' },
];

const JournalViewer = () => {
    const [selectedJournal, setSelectedJournal] = useState('JCR-FC');
    const [entries, setEntries] = useState([]);
    const { toast } = useToast();

    useEffect(() => { api.ledger.entries.list().then(setEntries).catch(() => {}); }, []);

    const journalData = useMemo(() => {
        const [code, currency] = selectedJournal.split('-'); // ex. "JCR-FC" -> code=JCR, currency=FC ; "JFX" -> code=JFX
        return entries
            .filter(e => e.code === code && (!currency || e.currency === currency))
            .map(flattenEntry);
    }, [selectedJournal, entries]);
    
    const handleExportPDF = () => {
        const headers = [
            { label: 'Date', key: 'date' }, { label: 'Pièce', key: 'piece_ref' }, { label: 'Description', key: 'description' },
            { label: 'Cpt. Débit', key: 'compte_debit' }, { label: 'Cpt. Crédit', key: 'compte_credit' },
            { label: 'Montant', key: 'montant' }, { label: 'Devise', key: 'devise' },
        ];
        exportToPDF(journalData, selectedJournal, `Journal Comptable: ${selectedJournal}`, headers);
        toast({ title: "Exportation PDF", description: `Le journal ${selectedJournal} a été exporté.`});
    };
    
    const handleExportExcel = () => {
        exportToExcel(journalData, selectedJournal);
        toast({ title: "Exportation Excel", description: `Le journal ${selectedJournal} a été exporté.`});
    };

    const getStatusBadge = (status) => {
        switch(status) {
            case 'validé': return <Badge variant="success">Validé</Badge>;
            case 'en_attente': return <Badge variant="info">En attente</Badge>;
            case 'rejeté': return <Badge variant="destructive">Rejeté</Badge>;
            default: return <Badge variant="secondary">{status}</Badge>;
        }
    };

    return (
        <div className="glass-effect p-6 rounded-2xl">
            <div className="flex flex-wrap gap-4 justify-between items-center mb-6">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="w-full sm:w-64">
                         <Select value={selectedJournal} onValueChange={setSelectedJournal}>
                            <SelectTrigger> <SelectValue placeholder="Sélectionner un journal" /> </SelectTrigger>
                            <SelectContent>
                                {journalTypes.map(jt => <SelectItem key={jt.value} value={jt.value}>{jt.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="relative w-full sm:w-auto">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input type="date" placeholder="Date" className="pl-10"/>
                    </div>
                     <Button variant="outline" className="text-gray-300"> <Filter className="w-4 h-4 mr-2"/> Filtres avancés </Button>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleExportPDF}><FileType className="w-4 h-4 mr-2"/> PDF</Button>
                    <Button variant="outline" onClick={handleExportExcel}><FileDown className="w-4 h-4 mr-2"/> Excel</Button>
                </div>
            </div>

            <div className="overflow-auto max-h-[60vh]">
                <Table>
                    <TableHeader className="sticky top-0 bg-slate-900/50 backdrop-blur-sm">
                        <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Pièce</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Débit</TableHead>
                            <TableHead>Crédit</TableHead>
                            <TableHead className="text-right">Montant</TableHead>
                            <TableHead>Devise</TableHead>
                            <TableHead>Statut</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {journalData.length > 0 ? journalData.map((entry, index) => (
                            <TableRow key={index} className="border-slate-800">
                                <TableCell className="text-slate-400 text-xs">{entry.date}</TableCell>
                                <TableCell className="font-mono text-xs text-slate-500">{entry.piece_ref}</TableCell>
                                <TableCell className="text-sm">{entry.description}</TableCell>
                                <TableCell className="font-mono text-emerald-400">{entry.compte_debit}</TableCell>
                                <TableCell className="font-mono text-red-400">{entry.compte_credit}</TableCell>
                                <TableCell className="text-right font-mono text-white">{entry.montant.toLocaleString()}</TableCell>
                                <TableCell>
                                    <Badge variant={entry.devise === 'USD' ? 'secondary' : 'default'} className={entry.devise === 'USD' ? 'text-yellow-300' : 'text-emerald-300'}>{entry.devise}</Badge>
                                </TableCell>
                                <TableCell>{getStatusBadge(entry.statut)}</TableCell>
                            </TableRow>
                        )) : (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center text-slate-500 py-12"> Aucune écriture dans ce journal. </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};

export default JournalViewer;
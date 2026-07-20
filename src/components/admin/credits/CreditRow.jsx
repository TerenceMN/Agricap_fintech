import React, { useState } from 'react';
import { TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
    MoreHorizontal, Eye, FileText, Banknote, MessageSquare, UserCog, AlertTriangle, Clock, CircleOff, Check, ChevronDown, ChevronUp, Settings2
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence } from 'framer-motion';
import TransactionSubTable from './TransactionSubTable';

const ProgressBar = ({ value }) => (
    <div className="w-full bg-slate-700 rounded-full h-2 relative overflow-hidden">
        <div className="absolute inset-0 bg-emerald-500/20"></div>
        <div className="bg-gradient-to-r from-emerald-500 to-green-400 h-2 rounded-full" style={{ width: `${value}%` }}></div>
    </div>
);

const ScoreBadge = ({ score }) => {
    const scoreColor = score > 85 ? 'bg-emerald-500/20 text-emerald-400' : score > 70 ? 'bg-blue-500/20 text-blue-400' : score > 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400';
    return <span className={`px-2 py-1 text-xs font-semibold rounded-full ${scoreColor}`}>{score}/100</span>;
};

const CreditRow = ({ credit, onAction }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    const statusConfig = {
        'Approuvé': { variant: 'success' },
        'En traitement': { variant: 'info' },
        'En cours': { variant: 'default' },
        'Clôturé': { variant: 'secondary' },
        'Défaut': { variant: 'destructive' },
        'Rejeté': { variant: 'destructive' },
        'Blocked': { variant: 'destructive' },
        'Suspended': { variant: 'warning' }
    };
    
    const formatCurrency = (amount, currency) => {
        if (currency === 'CDF') {
            return `${(amount / 1000000).toFixed(1)}M FC`;
        }
        return `$${amount.toLocaleString()}`;
    };

    return (
        <>
            <TableRow className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors data-[state=open]:bg-slate-800/60">
                <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsExpanded(!isExpanded)}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-400">{credit.id}</TableCell>
                <TableCell className="text-sm">{credit.date}</TableCell>
                <TableCell className="font-semibold">{credit.operator}</TableCell>
                <TableCell>{credit.type}</TableCell>
                <TableCell className="text-right font-mono text-slate-400">{formatCurrency(credit.amountRequested, credit.currency)}</TableCell>
                <TableCell className="text-right font-mono font-bold text-emerald-300">{formatCurrency(credit.amountApproved, credit.currency)}</TableCell>
                <TableCell className="text-right font-mono text-slate-300">{formatCurrency(credit.amountDisbursed, credit.currency)}</TableCell>
                <TableCell><Badge variant="outline">{credit.currency}</Badge></TableCell>
                <TableCell className="text-center">{credit.duration}</TableCell>
                <TableCell className="text-center">{credit.rate}%</TableCell>
                <TableCell>{credit.dueDate}</TableCell>
                <TableCell>{credit.manager}</TableCell>
                <TableCell>{credit.investor}</TableCell>
                <TableCell>{credit.source}</TableCell>
                <TableCell>
                    <Badge variant={statusConfig[credit.status]?.variant || 'default'}>
                        {credit.status}
                    </Badge>
                </TableCell>
                <TableCell><ScoreBadge score={credit.score} /></TableCell>
                <TableCell>{credit.guarantee}</TableCell>
                <TableCell>
                    <div className="flex items-center gap-2">
                        <ProgressBar value={credit.progress} />
                        <span className="text-xs font-semibold text-slate-400">{credit.progress}%</span>
                    </div>
                </TableCell>
                <TableCell className="text-right">
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-slate-800/80 backdrop-blur border-slate-700 text-slate-200">
                            <DropdownMenuLabel>Actions Rapides</DropdownMenuLabel>
                            <DropdownMenuSeparator className="bg-slate-700"/>
                            <DropdownMenuItem onSelect={() => onAction('details', credit)}><Eye className="mr-2 h-4 w-4" />Détails du Crédit</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('configure_rate', credit)}><Settings2 className="mr-2 h-4 w-4 text-blue-400" />Config. Taux & Maturité</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('contract', credit)}><FileText className="mr-2 h-4 w-4" />Voir / Télécharger Contrat</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('disburse', credit)}><Banknote className="mr-2 h-4 w-4" />Décaissement / Paiement</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('note', credit)}><MessageSquare className="mr-2 h-4 w-4" />Ajouter une note</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('export', credit)}><FileText className="mr-2 h-4 w-4" />Exporter Dossier</DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-slate-700"/>
                            <DropdownMenuLabel>Gestion du Dossier</DropdownMenuLabel>
                            <DropdownMenuSeparator className="bg-slate-700"/>
                            <DropdownMenuItem onSelect={() => onAction('reassign', credit)}><UserCog className="mr-2 h-4 w-4" />Réaffecter Gestionnaire</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('reminder', credit)} className="text-yellow-400 focus:text-yellow-300"><AlertTriangle className="mr-2 h-4 w-4" />Relancer / Notifier</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('extend', credit)}><Clock className="mr-2 h-4 w-4" />Prolonger Échéance</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('pause', credit)}><CircleOff className="mr-2 h-4 w-4" />Mettre en Pause / Bloquer</DropdownMenuItem>
                             <DropdownMenuItem onSelect={() => onAction('close', credit)} className="text-emerald-400 focus:text-emerald-300"><Check className="mr-2 h-4 w-4" />Clôturer le Crédit</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('cancel', credit)} className="text-red-400 focus:text-red-300"><CircleOff className="mr-2 h-4 w-4" />Annuler / Rejeter</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </TableCell>
            </TableRow>
            <AnimatePresence>
                {isExpanded && (
                    <TableRow className="bg-slate-900/50 hover:bg-slate-900/50">
                        <TableCell colSpan={19} className="p-0">
                             <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.3 }}
                                className="overflow-hidden"
                            >
                               <TransactionSubTable creditId={credit.id} currency={credit.currency} />
                            </motion.div>
                        </TableCell>
                    </TableRow>
                )}
            </AnimatePresence>
        </>
    );
};

export default CreditRow;
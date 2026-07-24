import React, { useState } from 'react';
import { TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    MoreHorizontal, Eye, Banknote, MessageSquare, UserCog, AlertTriangle, Clock, CircleOff,
    Check, ChevronDown, ChevronUp, Settings2, Play, Ban, ThumbsUp, XOctagon
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence } from 'framer-motion';
import TransactionSubTable from './TransactionSubTable';
import { readLoanRates } from '@/lib/loanRateDisplay';

const ProgressBar = ({ value }) => {
    const pct = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
    return (
        <div className="w-full bg-slate-700 rounded-full h-2 relative overflow-hidden">
            <div className="absolute inset-0 bg-emerald-500/20"></div>
            <div className="bg-gradient-to-r from-emerald-500 to-green-400 h-2 rounded-full" style={{ width: `${pct}%` }}></div>
        </div>
    );
};

const ScoreBadge = ({ score }) => {
    if (score == null || !Number.isFinite(Number(score))) {
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-600/30 text-slate-400">—</span>;
    }
    const s = Number(score);
    const scoreColor = s > 85 ? 'bg-emerald-500/20 text-emerald-400' : s > 70 ? 'bg-blue-500/20 text-blue-400' : s > 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400';
    return <span className={`px-2 py-1 text-xs font-semibold rounded-full ${scoreColor}`}>{s}/100</span>;
};

/** Chaîne non vide, sinon tiret — jamais de cellule vide ou « undefined ». */
const orDash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

/** Date ISO → jj/mm/aaaa ; chaîne vide/absente → tiret. */
const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('fr-FR');
};

const CreditRow = ({ credit, onAction }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Les DEUX taux du prêt, chacun avec l'unité que le serveur DÉCLARE.
    // Cette cellule affichait `credit.rate` seul, sous une colonne « Taux » :
    // un taux MENSUEL (2 %) lu comme annuel, soit douze fois moins cher que le
    // prêt réel (24 %/an). Le taux annuel est servi (`annualRate`) — on le
    // montre en premier, et le mensuel dessous, chacun nommé.
    const taux = readLoanRates(credit);

    const statusConfig = {
        'Approuvé': { variant: 'success' },
        'En traitement': { variant: 'info' },
        'En cours': { variant: 'default' },
        'Clôturé': { variant: 'secondary' },
        'Défaut': { variant: 'destructive' },
        'Rejeté': { variant: 'destructive' },
        'Blocked': { variant: 'destructive' },
        'Bloqué': { variant: 'destructive' },
        'Suspended': { variant: 'warning' },
        'Suspendu': { variant: 'warning' }
    };

    /** Montant → format devise ; null/NaN → tiret (jamais de crash `.toLocaleString`). */
    const formatCurrency = (amount, currency) => {
        if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return '—';
        const n = Number(amount);
        if (currency === 'CDF') {
            return `${(n / 1000000).toFixed(1)}M FC`;
        }
        return `$${n.toLocaleString('fr-FR')}`;
    };

    return (
        <>
            <TableRow className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors data-[state=open]:bg-slate-800/60">
                <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsExpanded(!isExpanded)}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-400">{orDash(credit.id)}</TableCell>
                <TableCell className="text-sm">{fmtDate(credit.date)}</TableCell>
                <TableCell className="font-semibold">{orDash(credit.operator)}</TableCell>
                <TableCell>{orDash(credit.type)}</TableCell>
                <TableCell className="text-right font-mono text-slate-400">{formatCurrency(credit.amountRequested, credit.currency)}</TableCell>
                <TableCell className="text-right font-mono font-bold text-emerald-300">{formatCurrency(credit.amountApproved, credit.currency)}</TableCell>
                <TableCell className="text-right font-mono text-slate-300">{formatCurrency(credit.amountDisbursed, credit.currency)}</TableCell>
                <TableCell>{credit.currency ? <Badge variant="outline">{credit.currency}</Badge> : '—'}</TableCell>
                <TableCell className="text-center">{credit.duration != null && credit.duration !== '' ? credit.duration : '—'}</TableCell>
                <TableCell className="text-center whitespace-nowrap" title={taux.title}>
                    <span className={`block font-mono text-sm ${taux.annualServed ? 'text-slate-200' : 'text-amber-400/80 text-xs'}`}>
                        {taux.annualText}
                    </span>
                    <span className="block font-mono text-[10px] text-slate-500">{taux.monthlyText}</span>
                </TableCell>
                <TableCell>{fmtDate(credit.dueDate)}</TableCell>
                <TableCell>{orDash(credit.manager)}</TableCell>
                <TableCell>{orDash(credit.investor)}</TableCell>
                <TableCell>{orDash(credit.source)}</TableCell>
                <TableCell>
                    <Badge variant={statusConfig[credit.status]?.variant || 'default'}>
                        {orDash(credit.status)}
                    </Badge>
                </TableCell>
                <TableCell><ScoreBadge score={credit.score} /></TableCell>
                <TableCell>{orDash(credit.guarantee)}</TableCell>
                <TableCell>
                    <div className="flex items-center gap-2">
                        <ProgressBar value={credit.progress} />
                        <span className="text-xs font-semibold text-slate-400">
                            {Number.isFinite(Number(credit.progress)) ? `${Number(credit.progress)}%` : '—'}
                        </span>
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
                            {/* « Voir / Télécharger Contrat » et « Exporter Dossier » ont été retirés :
                                aucun endpoint backend ne les sert. Ils ouvraient un toast
                                « Génération du document — à brancher (gabarit) », c'est-à-dire une
                                entrée de menu qui promet un document inexistant. Un bouton sans
                                endpoint protégé n'existe pas (CLAUDE.md §7.2). À réintroduire le jour
                                où `credits` expose une génération de contrat et un export de dossier
                                — la route de rapport `GET /api/credits/applications/<code>/rapport`
                                porte sur le dossier d'instruction, pas sur un prêt du portefeuille. */}
                            <DropdownMenuItem onSelect={() => onAction('approve', credit)} className="text-emerald-400 focus:text-emerald-300"><ThumbsUp className="mr-2 h-4 w-4" />Approuver le Dossier</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('disburse', credit)}><Banknote className="mr-2 h-4 w-4" />Décaissement / Paiement</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('note', credit)}><MessageSquare className="mr-2 h-4 w-4" />Ajouter une note</DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-slate-700"/>
                            <DropdownMenuLabel>Gestion du Dossier</DropdownMenuLabel>
                            <DropdownMenuSeparator className="bg-slate-700"/>
                            <DropdownMenuItem onSelect={() => onAction('reassign', credit)}><UserCog className="mr-2 h-4 w-4" />Réaffecter Gestionnaire</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('reminder', credit)} className="text-yellow-400 focus:text-yellow-300"><AlertTriangle className="mr-2 h-4 w-4" />Relancer / Notifier</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('extend', credit)}><Clock className="mr-2 h-4 w-4" />Prolonger Échéance</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('pause', credit)}><CircleOff className="mr-2 h-4 w-4" />Mettre en Pause</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('resume', credit)} className="text-emerald-400 focus:text-emerald-300"><Play className="mr-2 h-4 w-4" />Réactiver</DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-slate-700"/>
                            <DropdownMenuLabel className="text-red-400/80">Actions sensibles</DropdownMenuLabel>
                            <DropdownMenuSeparator className="bg-slate-700"/>
                            <DropdownMenuItem onSelect={() => onAction('block', credit)} className="text-red-400 focus:text-red-300"><Ban className="mr-2 h-4 w-4" />Bloquer (taux 0%)</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('default', credit)} className="text-red-400 focus:text-red-300"><XOctagon className="mr-2 h-4 w-4" />Passer en Défaut</DropdownMenuItem>
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
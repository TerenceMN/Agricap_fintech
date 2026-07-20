import React from 'react';
import { TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
    MoreHorizontal, Eye, FileText, BarChart2, MessageSquare, X, Lock, RefreshCw, File, Link as LinkIcon, 
    CheckCircle, Clock, AlertCircle, Circle, Check, ShieldCheck, ShieldAlert, XCircle, Banknote, User, DollarSign
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const statusConfig = {
    'Validé': { variant: 'success', icon: <CheckCircle className="w-3 h-3" /> },
    'Effectué': { variant: 'success', icon: <CheckCircle className="w-3 h-3" /> },
    'Terminé': { variant: 'success', icon: <CheckCircle className="w-3 h-3" /> },
    'En attente': { variant: 'info', icon: <Clock className="w-3 h-3" /> },
    'En cours': { variant: 'info', icon: <Clock className="w-3 h-3" /> },
    'Échoué': { variant: 'destructive', icon: <XCircle className="w-3 h-3" /> },
    'Bloqué': { variant: 'destructive', icon: <XCircle className="w-3 h-3" /> },
};

const typeConfig = {
    'Dépôt Épargne': { icon: <Banknote className="text-emerald-400" /> },
    'Prélèvement Intérêt': { icon: <RefreshCw className="text-cyan-400" /> },
    'Retrait Épargne': { icon: <Banknote className="text-red-400" /> },
    'Transfert Interne': { icon: <RefreshCw className="text-blue-400" /> },
    'Conversion Invest.': { icon: <BarChart2 className="text-purple-400" /> },
    'Paiement Fournisseur': { icon: <User className="text-orange-400" /> },
};

const TransactionRow = ({ transaction, onAction }) => {
    const currentStatus = statusConfig[transaction.status] || { variant: 'secondary', icon: <Circle className="w-3 h-3" /> };
    const currentType = typeConfig[transaction.type] || { icon: <DollarSign /> };

    return (
        <TableRow className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors text-xs whitespace-nowrap">
            <TableCell className="font-mono text-slate-400">{transaction.id}</TableCell>
            <TableCell>{transaction.datetime}</TableCell>
            <TableCell>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex items-center gap-2">
                                {React.cloneElement(currentType.icon, { className: `${currentType.icon.props.className} h-4 w-4` })}
                                <span className="font-semibold">{transaction.type}</span>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="bg-slate-800 text-white border-slate-700">
                            <p>{transaction.description}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </TableCell>
            <TableCell className="font-mono font-bold text-emerald-300">${transaction.amount.toLocaleString()}</TableCell>
            <TableCell>{transaction.sourceAccount}</TableCell>
            <TableCell>{transaction.destAccount}</TableCell>
            <TableCell>{transaction.channel}</TableCell>
            <TableCell>
                <Badge variant={currentStatus.variant} className="flex items-center gap-1.5">
                    {currentStatus.icon} {transaction.status}
                </Badge>
            </TableCell>
            <TableCell>
                <Badge variant="outline" className="cursor-pointer hover:bg-slate-700">{transaction.link}</Badge>
            </TableCell>
            <TableCell className="text-center">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            {transaction.signature ? <ShieldCheck className="w-5 h-5 text-emerald-400 mx-auto" /> : <ShieldAlert className="w-5 h-5 text-yellow-400 mx-auto" />}
                        </TooltipTrigger>
                        <TooltipContent className="bg-slate-800 text-white border-slate-700">
                            <p>{transaction.signature ? 'Signature numérique certifiée' : 'Signature en attente ou non requise'}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </TableCell>
            <TableCell className="text-right">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-slate-800/80 backdrop-blur border-slate-700 text-slate-200">
                        <DropdownMenuItem onSelect={() => onAction('details', transaction)}><Eye className="mr-2 h-4 w-4" />Voir détails</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onAction('receipt', transaction)}><FileText className="mr-2 h-4 w-4" />Télécharger reçu</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onAction('analysis', transaction)}><BarChart2 className="mr-2 h-4 w-4" />Analyse rapide</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onAction('documents', transaction)} disabled={!transaction.docs}><File className="mr-2 h-4 w-4" />Afficher documents</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onAction('link', transaction)}><LinkIcon className="mr-2 h-4 w-4" />Afficher lien opération</DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-slate-700"/>
                        <DropdownMenuItem onSelect={() => onAction('note', transaction)}><MessageSquare className="mr-2 h-4 w-4" />Ajouter une note</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onAction('retry', transaction)} disabled={transaction.status !== 'Échoué'}><RefreshCw className="mr-2 h-4 w-4" />Réexécuter</DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-slate-700"/>
                        <DropdownMenuItem onSelect={() => onAction('dispute', transaction)} className="text-yellow-400 focus:text-yellow-300"><Lock className="mr-2 h-4 w-4" />Mettre en litige</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onAction('cancel', transaction)} className="text-red-400 focus:text-red-300"><X className="mr-2 h-4 w-4" />Annuler / Bloquer</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </TableCell>
        </TableRow>
    );
};

export default TransactionRow;
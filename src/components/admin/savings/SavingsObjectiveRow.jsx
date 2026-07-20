import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Edit, Trash2, Eye, MoreHorizontal, Target } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence } from 'framer-motion';
import MovementSubTable from './MovementSubTable';

const ProgressBar = ({ value }) => (
    <div className="w-full bg-slate-700 rounded-full h-1.5 relative overflow-hidden">
        <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-1.5 rounded-full" style={{ width: `${Math.min(value, 100)}%` }}></div>
    </div>
);

const SavingsObjectiveRow = ({ objective, onAction }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const progress = objective.goal > 0 ? Math.round((objective.balance / objective.goal) * 100) : 0;

    return (
        <>
            <TableRow className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors bg-slate-800/20 text-xs">
                <TableCell className="w-10 pl-8">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsExpanded(!isExpanded)}>
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </Button>
                </TableCell>
                <TableCell className="font-medium text-emerald-300 flex items-center gap-2">
                    <Target className="w-3 h-3 text-slate-500"/>
                    {objective.name || "Objectif Sans Nom"}
                </TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400">{objective.objectiveType || 'Autre'}</Badge></TableCell>
                <TableCell className="font-mono">{objective.balance.toLocaleString()} {objective.currency}</TableCell>
                <TableCell className="font-mono text-slate-500">/ {objective.goal.toLocaleString()}</TableCell>
                <TableCell>{objective.rate}%</TableCell>
                <TableCell className="w-32">
                    <div className="flex items-center gap-2">
                        <ProgressBar value={progress} />
                        <span className="text-[10px] text-slate-400">{progress}%</span>
                    </div>
                </TableCell>
                <TableCell className="text-right">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3 w-3" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700 text-slate-200">
                            <DropdownMenuItem onSelect={() => onAction('details', objective)}><Eye className="mr-2 h-3 w-3" />Détails</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('edit_obj', objective)}><Edit className="mr-2 h-3 w-3" />Modifier</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onAction('delete_obj', objective)} className="text-red-400"><Trash2 className="mr-2 h-3 w-3" />Supprimer</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </TableCell>
            </TableRow>
            <AnimatePresence>
                {isExpanded && (
                    <TableRow className="bg-slate-900/40">
                        <TableCell colSpan={8} className="p-0 pl-12 border-l-2 border-emerald-500/20">
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <MovementSubTable savingsId={objective.id} />
                            </motion.div>
                        </TableCell>
                    </TableRow>
                )}
            </AnimatePresence>
        </>
    );
};

export default SavingsObjectiveRow;
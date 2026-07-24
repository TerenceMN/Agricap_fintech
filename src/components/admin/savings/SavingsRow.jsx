import React, { useState, useEffect } from 'react';
import { TableRow, TableCell, Table, TableHeader, TableHead, TableBody } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, Users, UserPlus, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SavingsObjectiveRow from './SavingsObjectiveRow';
import AssignGroupModal from './AssignGroupModal';

const SavingsRow = ({ holderName, objectives, onAction }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

    // L'affectation de groupe et le `sub` du titulaire viennent du serveur
    // (`GET /savings/plans`, champs `holderGroups`/`holderSub`) — plus de
    // référentiel de groupes fantôme en `localStorage` (§5). L'affectation
    // d'épargne est exclusive : au plus un groupe, donc on affiche le premier.
    const holderSub = objectives[0]?.holderSub;
    const serverGroup = objectives[0]?.holderGroups?.[0] || null;
    // État local d'affichage : reflète immédiatement une (dé)affectation confirmée
    // par le serveur, puis se resynchronise sur les données servies au rechargement.
    const [groupName, setGroupName] = useState(serverGroup);
    useEffect(() => { setGroupName(serverGroup); }, [serverGroup]);

    // Calculate Aggregates
    const totalBalance = objectives.reduce((sum, obj) => sum + (obj.balance || 0), 0);
    const avgRate = objectives.length > 0 ? (objectives.reduce((sum, obj) => sum + (obj.rate || 0), 0) / objectives.length).toFixed(1) : 0;
    const activeCount = objectives.filter(o => o.status === 'Actif').length;
    const currency = objectives[0]?.currency || 'USD';

    return (
        <>
            <TableRow className={`border-b border-slate-800 transition-colors ${isExpanded ? 'bg-slate-800/40' : 'hover:bg-slate-800/20'} cursor-pointer`} onClick={() => setIsExpanded(!isExpanded)}>
                <TableCell className="w-10 text-center">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-emerald-400" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                </TableCell>
                <TableCell className="font-semibold text-white flex items-center gap-2">
                    {holderName}
                    {groupName && <Badge variant="info" className="text-[10px] h-5 px-1 bg-blue-500/10 text-blue-400 border-blue-500/20">{groupName}</Badge>}
                </TableCell>
                <TableCell className="font-mono font-bold text-emerald-400">{totalBalance.toLocaleString()} {currency}</TableCell>
                <TableCell className="text-center">{objectives.length}</TableCell>
                <TableCell className="text-center">{avgRate}%</TableCell>
                <TableCell>
                    {activeCount > 0 
                        ? <Badge variant="success" className="h-5">Actif</Badge> 
                        : <Badge variant="secondary" className="h-5">Inactif</Badge>
                    }
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                     <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                        onClick={() => setIsAssignModalOpen(true)}
                    >
                        <UserPlus className="w-3.5 h-3.5 mr-1.5"/> Assigner Groupe
                    </Button>
                </TableCell>
            </TableRow>
            
            <AnimatePresence>
                {isExpanded && (
                    <TableRow className="bg-slate-900/30">
                        <TableCell colSpan={7} className="p-0">
                            <motion.div 
                                initial={{ height: 0, opacity: 0 }} 
                                animate={{ height: 'auto', opacity: 1 }} 
                                exit={{ height: 0, opacity: 0 }} 
                                transition={{ duration: 0.2 }}
                                className="border-l-4 border-slate-700 ml-4 my-2 overflow-hidden"
                            >
                                <div className="p-2 bg-slate-800/20 rounded-r-lg">
                                    <div className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                        <FolderOpen className="w-3 h-3"/> Objectifs Agrobusiness
                                    </div>
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-none hover:bg-transparent text-[10px] uppercase text-slate-500">
                                                <TableHead className="w-10"></TableHead>
                                                <TableHead>Objectif</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead>Solde</TableHead>
                                                <TableHead>Cible</TableHead>
                                                <TableHead>Taux</TableHead>
                                                <TableHead>Progrès</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {objectives.map(obj => (
                                                <SavingsObjectiveRow key={obj.id} objective={obj} onAction={onAction} />
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </motion.div>
                        </TableCell>
                    </TableRow>
                )}
            </AnimatePresence>

            <AssignGroupModal
                isOpen={isAssignModalOpen}
                onOpenChange={setIsAssignModalOpen}
                holderName={holderName}
                holderSub={holderSub}
                currentGroupName={groupName}
                onAssigned={setGroupName}
            />
        </>
    );
};

export default SavingsRow;
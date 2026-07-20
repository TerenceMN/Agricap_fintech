import React, { useState, useEffect } from 'react';
import { TableRow, TableCell, Table, TableHeader, TableHead, TableBody } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, Users, UserPlus, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SavingsObjectiveRow from './SavingsObjectiveRow';
import AssignGroupModal from './AssignGroupModal';
import { useToast } from "@/components/ui/use-toast";

const SavingsRow = ({ holderName, objectives, onAction }) => {
    const { toast } = useToast();
    const [isExpanded, setIsExpanded] = useState(false);
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [groupName, setGroupName] = useState(null);

    // Calculate Aggregates
    const totalBalance = objectives.reduce((sum, obj) => sum + (obj.balance || 0), 0);
    const avgRate = objectives.length > 0 ? (objectives.reduce((sum, obj) => sum + (obj.rate || 0), 0) / objectives.length).toFixed(1) : 0;
    const activeCount = objectives.filter(o => o.status === 'Actif').length;
    const currency = objectives[0]?.currency || 'USD';

    useEffect(() => {
        // Check group assignment from localStorage
        const groups = JSON.parse(localStorage.getItem('admin_savings_groups') || '[]');
        const foundGroup = groups.find(g => g.members && g.members.includes(holderName));
        if (foundGroup) setGroupName(foundGroup.name);
        else setGroupName(null);
    }, [holderName, isAssignModalOpen]);

    const handleAssignGroup = (holder, group) => {
        const groups = JSON.parse(localStorage.getItem('admin_savings_groups') || '[]');
        let updatedGroups = groups.map(g => ({
            ...g,
            members: g.members.filter(m => m !== holder) // Remove from all first
        }));

        if (group && group.id !== 'none') {
            const targetGroup = updatedGroups.find(g => g.id === group.id);
            if (targetGroup) {
                targetGroup.members.push(holder);
                // Audit
                const auditEntry = { date: new Date().toISOString(), action: 'Assignation', details: `Membre ${holder} assigné` };
                const oldAudit = JSON.parse(localStorage.getItem(`group_audit_${targetGroup.id}`) || '[]');
                localStorage.setItem(`group_audit_${targetGroup.id}`, JSON.stringify([auditEntry, ...oldAudit]));
            }
        }
        
        localStorage.setItem('admin_savings_groups', JSON.stringify(updatedGroups));
        setGroupName(group && group.id !== 'none' ? group.name : null);
        toast({ title: "Assignation mise à jour", description: `${holder} a été mis à jour.` });
    };

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
                currentGroup={groupName}
                onAssign={handleAssignGroup}
            />
        </>
    );
};

export default SavingsRow;
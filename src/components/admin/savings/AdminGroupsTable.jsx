import React, { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search, Plus, Edit, Trash2, Users, FileText } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import GroupManagementModal from './GroupManagementModal';
import SavingsConfirmDialog from '@/components/savings/SavingsConfirmDialog';
import {
    buildGroupDecisionSummary, buildGroupDeletionSummary, groupDecisionLabel, savingsOperationErrors,
} from '@/components/savings/savingsOperations';
import { api } from '@/services/api';

const AdminGroupsTable = () => {
    const { toast } = useToast();
    const [groups, setGroups] = useState([]);
    const [requests, setRequests] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState(null);
    // Opération en attente de confirmation. Rien n'est envoyé au serveur tant
    // qu'elle n'a pas été relue et signée — comme pour un dépôt.
    const [pending, setPending] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [serverErrors, setServerErrors] = useState([]);

    const loadGroups = () => api.savings.groups.list().then(setGroups).catch(() => {});
    const loadRequests = () => api.savings.allGroupRequests().then(setRequests).catch(() => {});

    useEffect(() => { loadGroups(); loadRequests(); }, []);

    const handleCreateOrEdit = async (groupData) => {
        try {
            if (selectedGroup) {
                await api.savings.groups.update(selectedGroup.id, groupData);
                toast({ title: "Groupe Modifié", description: "Les paramètres ont été mis à jour." });
            } else {
                await api.savings.groups.create(groupData);
                toast({ title: "Groupe Créé", description: "Le nouveau groupe d'épargne est actif." });
            }
            loadGroups();
        } catch (e) {
            // 422 déplié : un refus porte souvent plusieurs causes, les aplatir
            // en une phrase en fait disparaître.
            toast({
                variant: 'destructive', title: 'Échec',
                description: savingsOperationErrors(e).map(c => `${c.code ? `${c.code} — ` : ''}${c.message}`).join(' · '),
            });
        }
    };

    /**
     * Suppression d'un groupe : `window.confirm` ne nommait ni le groupe, ni ses
     * membres — l'administrateur signait une phrase générique alors que
     * l'opération casse en cascade les adhésions et les demandes d'intégration.
     */
    const askDelete = (group) => {
        setServerErrors([]);
        setPending({
            kind: 'delete',
            group,
            title: 'Supprimer ce groupe ?',
            description: "La suppression est immédiate et définitive côté serveur : adhésions et demandes d'intégration disparaissent avec le groupe.",
            lines: buildGroupDeletionSummary(group),
            confirmLabel: 'Supprimer définitivement',
            destructive: true,
        });
    };

    /**
     * Décision sur une demande d'adhésion : approuver crée l'adhésion, rejeter
     * ferme la demande. Le serveur ne rouvre ni l'un ni l'autre — les deux se
     * confirment donc, pas seulement le rejet.
     */
    const askDecision = (req, action) => {
        const decision = action === 'approve' ? 'approved' : 'rejected';
        setServerErrors([]);
        setPending({
            kind: 'decision',
            req,
            decision,
            title: `${groupDecisionLabel(decision)} de la demande d'adhésion`,
            description: 'Cette décision est enregistrée telle quelle et ne se reprend pas.',
            lines: buildGroupDecisionSummary(req, decision),
            confirmLabel: decision === 'approved' ? "Confirmer l'approbation" : 'Confirmer le rejet',
            destructive: decision === 'rejected',
        });
    };

    // Un refus serveur ne referme PAS la confirmation : ses causes s'affichent
    // dedans, dépliées une par une, pendant que l'opération reste sous les yeux.
    const executePending = async () => {
        if (!pending) return;
        setSubmitting(true);
        try {
            if (pending.kind === 'delete') {
                await api.savings.groups.remove(pending.group.id);
                setGroups(prev => prev.filter(g => g.id !== pending.group.id));
                loadRequests();
                toast({ title: 'Groupe supprimé', description: pending.group.name });
            } else {
                await api.savings.groups.decide(pending.req.id, pending.decision);
                loadRequests();
                if (pending.decision === 'approved') {
                    loadGroups();
                    toast({ title: 'Demande approuvée', description: 'Le membre a été ajouté au groupe.' });
                } else {
                    toast({ title: 'Demande rejetée' });
                }
            }
            setPending(null);
            setServerErrors([]);
        } catch (e) {
            const causes = savingsOperationErrors(e);
            setServerErrors(causes);
            toast({ variant: 'destructive', title: 'Échec', description: causes.map(c => c.message).join(' · ') });
        } finally {
            setSubmitting(false);
        }
    };

    const openCreate = () => {
        setSelectedGroup(null);
        setIsModalOpen(true);
    };

    const openEdit = (group) => {
        setSelectedGroup(group);
        setIsModalOpen(true);
    };

    const filteredGroups = groups.filter(g => 
        g.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        g.type.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getTypeBadge = (type) => {
        const styles = {
            'avec': 'bg-orange-500/20 text-orange-400',
            'mutuelle': 'bg-pink-500/20 text-pink-400',
            'cooperative': 'bg-emerald-500/20 text-emerald-400',
            'organisation': 'bg-blue-500/20 text-blue-400'
        };
        return <Badge variant="outline" className={`capitalize ${styles[type] || 'text-slate-400'}`}>{type}</Badge>;
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="relative flex-1 w-full md:max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                        placeholder="Rechercher groupes..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="pl-10 bg-slate-900/50 border-slate-700 w-full" 
                    />
                </div>
                <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700 w-full md:w-auto"><Plus className="w-4 h-4 mr-2"/> Créer Groupe</Button>
            </div>

            <div className="border border-slate-700 rounded-lg overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-slate-800 hover:bg-slate-800 text-xs whitespace-nowrap">
                            <TableHead className="min-w-[200px]">Nom du Groupe</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Membres</TableHead>
                            <TableHead>Solde Total</TableHead>
                            <TableHead>Taux</TableHead>
                            <TableHead>Statut</TableHead>
                            <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredGroups.map(group => {
                             // Count pending requests for this group
                             const pendingCount = requests.filter(r => r.groupId === group.id && r.status === 'pending').length;
                             
                             return (
                                <TableRow key={group.id} className="border-slate-800 hover:bg-slate-800/50 text-sm">
                                    <TableCell className="font-medium text-white">
                                        {group.name}
                                        {pendingCount > 0 && <Badge className="ml-2 bg-blue-600 text-[10px] px-1 h-5">{pendingCount} demande(s)</Badge>}
                                    </TableCell>
                                    <TableCell>{getTypeBadge(group.type)}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1 text-slate-400">
                                            <Users className="w-3 h-3" /> {group.members?.length || 0}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-mono">{group.balance.toLocaleString()} $</TableCell>
                                    <TableCell>{group.rate}%</TableCell>
                                    <TableCell><Badge variant="outline" className="text-emerald-400 border-emerald-500/30">{group.status}</Badge></TableCell>
                                    <TableCell className="text-right space-x-2 whitespace-nowrap">
                                        <Button variant="ghost" size="icon" onClick={() => openEdit(group)} className="h-8 w-8 text-blue-400 hover:bg-blue-900/20"><Edit className="w-4 h-4" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => askDelete(group)} className="h-8 w-8 text-red-400 hover:bg-red-900/20"><Trash2 className="w-4 h-4" /></Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {filteredGroups.length === 0 && (
                            <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-500">Aucun groupe trouvé.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <GroupManagementModal
                isOpen={isModalOpen}
                onOpenChange={setIsModalOpen}
                group={selectedGroup}
                onSave={handleCreateOrEdit}
                requests={requests}
                onHandleRequest={askDecision}
            />

            <SavingsConfirmDialog
                open={!!pending}
                title={pending?.title}
                description={pending?.description}
                lines={pending?.lines || []}
                onOpenChange={() => setPending(null)}
                onConfirm={executePending}
                submitting={submitting}
                errors={serverErrors}
                confirmLabel={pending?.confirmLabel}
                destructive={pending?.destructive}
            />
        </div>
    );
};

export default AdminGroupsTable;
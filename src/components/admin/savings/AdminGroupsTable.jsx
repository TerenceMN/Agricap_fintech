import React, { useState, useEffect } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Search, Plus, Edit, Trash2, Users, FileText } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import GroupManagementModal from './GroupManagementModal';
import { api, ApiError } from '@/services/api';

const AdminGroupsTable = () => {
    const { toast } = useToast();
    const [groups, setGroups] = useState([]);
    const [requests, setRequests] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState(null);

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
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Êtes-vous sûr de vouloir supprimer ce groupe ?")) return;
        try {
            await api.savings.groups.remove(id);
            setGroups(groups.filter(g => g.id !== id));
            toast({ title: "Groupe Supprimé" });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleRequestAction = async (req, action) => {
        try {
            await api.savings.groups.decide(req.id, action === 'approve' ? 'approved' : 'rejected');
            loadRequests();
            if (action === 'approve') {
                loadGroups();
                toast({ title: "Requête Approuvée", description: "Le membre a été ajouté au groupe." });
            } else {
                toast({ title: "Requête Rejetée" });
            }
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
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
                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(group.id)} className="h-8 w-8 text-red-400 hover:bg-red-900/20"><Trash2 className="w-4 h-4" /></Button>
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
                onHandleRequest={handleRequestAction}
            />
        </div>
    );
};

export default AdminGroupsTable;
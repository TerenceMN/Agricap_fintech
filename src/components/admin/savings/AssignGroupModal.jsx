import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Users, Link, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ErrorPanel } from '@/components/backoffice/States';
import { api } from '@/services/api';
import { savingsAdminApi, savingsOperationErrors } from '@/services/savingsApi';

/**
 * Affectation d'un titulaire à un groupe d'épargne.
 *
 * Avant, la liste des groupes ET l'affectation vivaient dans `localStorage`
 * (`admin_savings_groups`), indexées par NOM : une affectation qui ne survivait
 * pas à un vidage de cache et qu'aucun autre poste ne voyait (§5). Désormais la
 * liste vient du serveur (`GET /savings/groups`) et l'affectation part au serveur
 * (`POST /savings/groups/assign`) par `sub` du titulaire — exclusive et auditée.
 * Un refus serveur s'affiche ici, dialogue ouvert.
 */
const AssignGroupModal = ({ isOpen, onOpenChange, holderName, holderSub, currentGroupName, onAssigned }) => {
    const { toast } = useToast();
    const [groups, setGroups] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [serverErrors, setServerErrors] = useState([]);

    useEffect(() => {
        if (!isOpen) return;
        setServerErrors([]);
        api.savings.groups.list()
            .then((list) => {
                setGroups(list);
                const found = currentGroupName
                    ? list.find(g => g.name === currentGroupName)
                    : null;
                setSelectedGroup(found ? String(found.id) : '');
            })
            .catch((e) => setServerErrors(savingsOperationErrors(e)));
    }, [isOpen, currentGroupName]);

    const handleAssign = async () => {
        // Rien de choisi et rien à retirer : simple fermeture, aucun appel.
        if (selectedGroup === '' && !currentGroupName) {
            onOpenChange(false);
            return;
        }
        if (!holderSub) {
            setServerErrors([{ code: 'HOLDER_UNKNOWN', message: "Identifiant du titulaire absent : impossible d'affecter." }]);
            return;
        }
        const groupId = (selectedGroup === '' || selectedGroup === 'none') ? null : Number(selectedGroup);
        setSubmitting(true);
        try {
            const result = await savingsAdminApi.groups.assign(holderSub, groupId);
            toast({ title: 'Affectation mise à jour', description: result.groupName ? `${holderName} → ${result.groupName}` : `${holderName} retiré de son groupe.` });
            if (onAssigned) onAssigned(result.groupName ?? null);
            setServerErrors([]);
            onOpenChange(false);
        } catch (e) {
            // Le dialogue reste ouvert : la cause s'affiche là où l'opération est visible.
            const causes = savingsOperationErrors(e);
            setServerErrors(causes);
            toast({ variant: 'destructive', title: 'Refusé', description: causes.map(c => c.message).join(' · ') });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-400"/>
                        Assigner au Groupe
                    </DialogTitle>
                    <DialogDescription>
                        Lier le compte <strong>{holderName}</strong> à un groupe d'épargne.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {currentGroupName && (
                        <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700 mb-2">
                            <span className="text-xs text-slate-400 block mb-1">Assignation Actuelle</span>
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-emerald-400"/>
                                <span className="font-semibold text-white">{currentGroupName}</span>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>Sélectionner un Groupe</Label>
                        <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                            <SelectTrigger className="bg-slate-900 border-slate-700">
                                <SelectValue placeholder="Choisir un groupe..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">-- Aucun (Désassigner) --</SelectItem>
                                {groups.map(g => (
                                    <SelectItem key={g.id} value={String(g.id)}>
                                        <div className="flex items-center gap-2">
                                            <span>{g.name}</span>
                                            <Badge variant="outline" className="text-[10px] h-4 px-1">{g.type}</Badge>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {serverErrors.length > 0 && <ErrorPanel errors={serverErrors} title="Affectation refusée par le serveur" />}
                </div>

                <DialogFooter>
                    <Button variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button onClick={handleAssign} disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
                        <Link className="w-4 h-4 mr-2"/>
                        {submitting ? 'Envoi…' : 'Enregistrer'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default AssignGroupModal;

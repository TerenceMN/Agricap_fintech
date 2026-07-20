import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Users, Link, Check, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const AssignGroupModal = ({ isOpen, onOpenChange, holderName, currentGroup, onAssign }) => {
    const { toast } = useToast();
    const [groups, setGroups] = useState([]);
    const [selectedGroup, setSelectedGroup] = useState('');

    useEffect(() => {
        const savedGroups = localStorage.getItem('admin_savings_groups');
        if (savedGroups) {
            setGroups(JSON.parse(savedGroups));
        }
        // Initialize with current group if exists
        if (currentGroup) {
            const found = JSON.parse(savedGroups || '[]').find(g => g.name === currentGroup || g.id === currentGroup);
            if (found) setSelectedGroup(found.id);
        } else {
            setSelectedGroup('');
        }
    }, [isOpen, currentGroup]);

    const handleAssign = () => {
        if (!selectedGroup && !currentGroup) {
            onOpenChange(false);
            return;
        }
        
        const group = groups.find(g => g.id === selectedGroup);
        onAssign(holderName, group);
        onOpenChange(false);
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
                    {currentGroup && (
                        <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700 mb-2">
                            <span className="text-xs text-slate-400 block mb-1">Assignation Actuelle</span>
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-emerald-400"/>
                                <span className="font-semibold text-white">{currentGroup}</span>
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
                                    <SelectItem key={g.id} value={g.id}>
                                        <div className="flex items-center gap-2">
                                            <span>{g.name}</span>
                                            <Badge variant="outline" className="text-[10px] h-4 px-1">{g.type}</Badge>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button onClick={handleAssign} className="bg-blue-600 hover:bg-blue-700">
                        <Link className="w-4 h-4 mr-2"/>
                        Enregistrer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default AssignGroupModal;
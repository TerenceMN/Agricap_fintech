import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { Users, Save, CheckCircle, XCircle, ShieldCheck, History } from 'lucide-react';

const GroupManagementModal = ({ isOpen, onOpenChange, group, onSave, requests = [], onHandleRequest }) => {
    const { toast } = useToast();
    const [formData, setFormData] = useState({
        name: '',
        type: 'avec',
        description: '',
        rate: 0,
        frequency: 'mensuel',
        depositMode: 'virement',
        adminUser: 'Admin'
    });
    const [audit, setAudit] = useState([]);

    useEffect(() => {
        if (group) {
            setFormData({
                name: group.name,
                type: group.type,
                description: group.description || '',
                rate: group.rate,
                frequency: group.frequency || 'mensuel',
                depositMode: group.depositMode || 'virement',
                adminUser: group.adminUser || 'Admin'
            });
            // Load specific audit for this group from localStorage
            const savedAudit = localStorage.getItem(`group_audit_${group.id}`);
            if (savedAudit) setAudit(JSON.parse(savedAudit));
        } else {
            setFormData({
                name: '',
                type: 'avec',
                description: '',
                rate: 0,
                frequency: 'mensuel',
                depositMode: 'virement',
                adminUser: 'Admin'
            });
            setAudit([]);
        }
    }, [group, isOpen]);

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = () => {
        if (formData.rate > 6) {
            toast({ variant: "destructive", title: "Erreur", description: "Le taux ne peut dépasser 6%." });
            return;
        }
        onSave(formData);
        onOpenChange(false);
    };

    // Filter requests for this group if creating a new one (none) or editing
    const groupRequests = group ? requests.filter(r => r.groupId === group.id && r.status === 'pending') : [];

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="glass-effect text-white max-w-2xl border-slate-700 max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 text-xl">
                        <Users className="w-6 h-6 text-blue-400" />
                        {group ? "Gestion du Groupe" : "Créer un Nouveau Groupe"}
                    </DialogTitle>
                    <DialogDescription>
                        Configuration des paramètres et gestion des membres.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="details" className="mt-4">
                    <TabsList className="grid w-full grid-cols-2 bg-slate-800/50">
                        <TabsTrigger value="details">Détails & Paramètres</TabsTrigger>
                        <TabsTrigger value="members" disabled={!group}>Membres & Requêtes</TabsTrigger>
                    </TabsList>

                    <TabsContent value="details" className="space-y-4 mt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Nom du Groupe</Label>
                                <Input value={formData.name} onChange={e => handleChange('name', e.target.value)} className="bg-slate-900 border-slate-700" placeholder="Ex: Coopérative Kivu" />
                            </div>
                            <div className="space-y-2">
                                <Label>Type de Groupe</Label>
                                <Select value={formData.type} onValueChange={v => handleChange('type', v)}>
                                    <SelectTrigger className="bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="avec">AVEC (Villageois)</SelectItem>
                                        <SelectItem value="mutuelle">Mutuelle de Solidarité</SelectItem>
                                        <SelectItem value="cooperative">Coopérative Agricole</SelectItem>
                                        <SelectItem value="organisation">Organisation Paysanne</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea value={formData.description} onChange={e => handleChange('description', e.target.value)} className="bg-slate-900 border-slate-700" placeholder="Objectif du groupe..." />
                        </div>

                        <div className="p-4 rounded-lg bg-slate-800/30 border border-slate-700 space-y-4">
                            <h4 className="font-semibold text-emerald-400 flex items-center gap-2">Paramètres Financiers Partagés</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Taux Annuel (%) - Max 6%</Label>
                                    <Input 
                                        type="number" 
                                        step="0.01" 
                                        max="6"
                                        value={formData.rate} 
                                        onChange={e => handleChange('rate', e.target.value)} 
                                        className="bg-slate-900 border-slate-700 mt-1" 
                                    />
                                </div>
                                <div>
                                    <Label>Fréquence Dépôt</Label>
                                    <Select value={formData.frequency} onValueChange={v => handleChange('frequency', v)}>
                                        <SelectTrigger className="bg-slate-900 border-slate-700 mt-1"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="hebdomadaire">Hebdomadaire</SelectItem>
                                            <SelectItem value="mensuel">Mensuel</SelectItem>
                                            <SelectItem value="trimestriel">Trimestriel</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="members" className="space-y-6 mt-4">
                        <div className="space-y-4">
                            <h4 className="font-semibold text-blue-400">Requêtes d'Adhésion ({groupRequests.length})</h4>
                            {groupRequests.length > 0 ? (
                                <div className="border border-slate-700 rounded-lg overflow-hidden">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-slate-800/50 border-slate-700"><TableHead>Demandeur</TableHead><TableHead>Raison</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {groupRequests.map(req => (
                                                <TableRow key={req.id} className="border-slate-700">
                                                    <TableCell className="font-medium">{req.userName}</TableCell>
                                                    <TableCell className="text-slate-400 text-xs">{req.reason}</TableCell>
                                                    <TableCell className="text-right space-x-2">
                                                        <Button size="sm" onClick={() => onHandleRequest(req, 'approve')} className="h-7 bg-emerald-600 hover:bg-emerald-700"><CheckCircle className="w-3 h-3 mr-1"/> Accepter</Button>
                                                        <Button size="sm" variant="destructive" onClick={() => onHandleRequest(req, 'reject')} className="h-7"><XCircle className="w-3 h-3 mr-1"/> Rejeter</Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            ) : (
                                <div className="text-center p-4 border border-slate-700 border-dashed rounded-lg text-slate-500 text-sm">Aucune requête en attente.</div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <h4 className="font-semibold text-emerald-400">Membres Actifs ({group?.members?.length || 0})</h4>
                            <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 min-h-[100px]">
                                {group?.members && group.members.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {group.members.map((member, idx) => (
                                            <Badge key={idx} variant="outline" className="border-slate-600 bg-slate-800 text-slate-300 px-3 py-1">
                                                {member}
                                            </Badge>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-slate-500 text-sm italic">Aucun membre pour le moment.</p>
                                )}
                            </div>
                        </div>

                        {audit.length > 0 && (
                             <div className="space-y-2">
                                <h4 className="font-semibold text-slate-400 flex items-center gap-2"><History className="w-4 h-4"/> Historique Audit</h4>
                                <div className="max-h-[150px] overflow-y-auto border border-slate-700 rounded-lg p-2 bg-slate-900/30 text-xs space-y-1">
                                    {audit.map((entry, i) => (
                                        <div key={i} className="text-slate-400 border-b border-slate-800 pb-1 last:border-0">
                                            <span className="text-slate-500">[{new Date(entry.date).toLocaleDateString()}]</span> {entry.action} - {entry.details}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

                <DialogFooter className="mt-6">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button onClick={handleSave} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
                        <Save className="w-4 h-4 mr-2" /> {group ? "Enregistrer Modifications" : "Créer le Groupe"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default GroupManagementModal;
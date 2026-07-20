import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Star, Users, Plus, Search, MoreHorizontal, FileDown, MessageSquare, Activity, ShieldCheck, Mail } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { exportToExcel } from '@/lib/export.js';
import { api, ApiError } from '@/services/api';

const NewSupplierModal = ({ isOpen, onClose, onCreate }) => {
    const [form, setForm] = useState({ name: '', category: '', complianceStatus: '' });

    const handleSubmit = () => {
        if (!form.name.trim()) return;
        onCreate(form);
        setForm({ name: '', category: '', complianceStatus: '' });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="glass-effect text-white sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle>Nouveau Fournisseur</DialogTitle>
                    <DialogDescription>Ajouter un fournisseur à l'annuaire.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Nom</Label>
                        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                            className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Catégorie</Label>
                        <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                            placeholder="Ex: Intrants agricoles" className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Statut Conf.</Label>
                        <Input value={form.complianceStatus} onChange={e => setForm({ ...form, complianceStatus: e.target.value })}
                            placeholder="Ex: Certifié" className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Annuler</Button>
                    <Button onClick={handleSubmit} className="bg-emerald-600 hover:bg-emerald-700">Ajouter</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const SupplierProfileModal = ({ supplier, onClose }) => (
    <Dialog open={!!supplier} onOpenChange={onClose}>
        <DialogContent className="glass-effect text-white sm:max-w-[450px]">
            <DialogHeader>
                <DialogTitle>{supplier?.name}</DialogTitle>
                <DialogDescription>Fiche fournisseur</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Catégorie</span>
                    <span className="text-white">{supplier?.category || 'Non renseignée'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Note performance</span>
                    <span className="text-white flex items-center gap-1"><Star className="w-3 h-3 text-yellow-400"/> {supplier?.rating.toFixed(1)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400">Statut conformité</span>
                    <span className="text-white">{supplier?.blacklisted ? 'Bloqué' : (supplier?.complianceStatus || 'Certifié')}</span>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={onClose}>Fermer</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);

const Suppliers = () => {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState('list');
    const [suppliers, setSuppliers] = useState([]);
    const [search, setSearch] = useState('');
    const [isNewModalOpen, setNewModalOpen] = useState(false);
    const [profileSupplier, setProfileSupplier] = useState(null);

    const loadSuppliers = () => api.suppliers.list().then(setSuppliers).catch(() => {});
    useEffect(() => { loadSuppliers(); }, []);

    const handleAction = (action) => {
        toast({
            title: action,
            description: "Non disponible : aucune fonctionnalité correspondante côté serveur pour le moment.",
        });
    };

    const handleCreateSupplier = async (data) => {
        try {
            await api.suppliers.create(data);
            setNewModalOpen(false);
            loadSuppliers();
            toast({ title: "Fournisseur ajouté" });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleSupplierAction = async (id, action, label) => {
        try {
            await api.suppliers.action(id, action);
            toast({ title: label });
            loadSuppliers();
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const filtered = suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <Layout>
            <Helmet><title>Fournisseurs - AGRICAP FINTECH</title></Helmet>

            <div className="flex justify-between items-center mb-6">
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                    <h1 className="text-4xl font-bold gradient-text mb-2">Fournisseurs & Partenaires</h1>
                    <p className="text-gray-400">Gestion, performance et communication avec la chaîne de valeur.</p>
                </motion.div>
                <Button className="bg-gradient-to-r from-emerald-500 to-blue-600" onClick={() => setNewModalOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" /> Ajouter
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList className="bg-slate-800 border border-slate-700">
                    <TabsTrigger value="list" className="data-[state=active]:bg-emerald-600"><Users className="w-4 h-4 mr-2"/> Annuaire</TabsTrigger>
                    <TabsTrigger value="perf" className="data-[state=active]:bg-emerald-600"><Activity className="w-4 h-4 mr-2"/> Performance</TabsTrigger>
                    <TabsTrigger value="comms" className="data-[state=active]:bg-emerald-600"><MessageSquare className="w-4 h-4 mr-2"/> Communications</TabsTrigger>
                </TabsList>

                <TabsContent value="list" className="space-y-4">
                    <div className="glass-effect rounded-2xl p-6">
                        <div className="flex justify-between items-center mb-4">
                            <div className="relative w-96">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input placeholder="Rechercher un fournisseur..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-slate-900/50 border-slate-700" />
                            </div>
                            <Button variant="outline" onClick={() => exportToExcel(suppliers, 'fournisseurs')}><FileDown className="w-4 h-4 mr-2" /> Exporter</Button>
                        </div>
                        <Table>
                            <TableHeader>
                                <TableRow className="border-slate-800">
                                    <TableHead>Nom du Fournisseur</TableHead>
                                    <TableHead>Catégorie</TableHead>
                                    <TableHead>Note (Perf.)</TableHead>
                                    <TableHead>Statut Conf.</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map(supplier => (
                                <TableRow key={supplier.id} className="border-slate-800">
                                    <TableCell className="font-semibold text-white">{supplier.name}</TableCell>
                                    <TableCell>{supplier.category || '-'}</TableCell>
                                    <TableCell><div className="flex items-center"><Star className="w-4 h-4 text-yellow-400 mr-1"/> {supplier.rating.toFixed(1)}</div></TableCell>
                                    <TableCell>
                                        {supplier.blacklisted ? (
                                            <Badge variant="destructive">Bloqué</Badge>
                                        ) : (
                                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">{supplier.complianceStatus || 'Certifié'}</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700 text-white">
                                                <DropdownMenuItem onClick={() => setProfileSupplier(supplier)}>Ouvrir Fiche Complète</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleAction('Message Fournisseur')}><Mail className="w-4 h-4 mr-2"/> Envoyer Message</DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-slate-700"/>
                                                <DropdownMenuLabel>Gestion Risque</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => handleAction('Lancer Audit')}><ShieldCheck className="w-4 h-4 mr-2"/> Lancer Audit</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleSupplierAction(supplier.id, 'suspend', 'Fournisseur suspendu')} className="text-amber-400">Suspendre</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleSupplierAction(supplier.id, 'blacklist', 'Fournisseur bloqué')} className="text-red-400">Bloquer (Blacklist)</DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                <TabsContent value="perf" className="space-y-4">
                     <div className="text-center py-20 glass-effect rounded-xl">
                        <Activity className="w-12 h-12 text-emerald-400 mx-auto mb-4 opacity-50"/>
                        <h2 className="text-xl font-bold text-white mb-2">Dashboard de Performance Global</h2>
                        <p className="text-slate-400 mb-4">Métrique de qualité, délais de livraison, et compétitivité prix.</p>
                        <Button onClick={() => handleAction('Générer Rapport Perf')}>Générer Rapport</Button>
                    </div>
                </TabsContent>

                 <TabsContent value="comms" className="space-y-4">
                     <div className="text-center py-20 glass-effect rounded-xl">
                        <MessageSquare className="w-12 h-12 text-blue-400 mx-auto mb-4 opacity-50"/>
                        <h2 className="text-xl font-bold text-white mb-2">Centre de Communication</h2>
                        <p className="text-slate-400 mb-4">Historique des messages, documents partagés et réunions planifiées.</p>
                        <Button onClick={() => handleAction('Nouveau Message')}>Nouveau Message</Button>
                    </div>
                </TabsContent>
            </Tabs>

            <NewSupplierModal isOpen={isNewModalOpen} onClose={() => setNewModalOpen(false)} onCreate={handleCreateSupplier} />
            <SupplierProfileModal supplier={profileSupplier} onClose={() => setProfileSupplier(null)} />
        </Layout>
    );
};

export default Suppliers;
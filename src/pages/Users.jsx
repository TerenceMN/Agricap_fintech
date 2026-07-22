import React, { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
    Users as UsersIcon, UserPlus, Shield, Key, FileText, Search, Filter,
    MoreHorizontal, CheckCircle2, XCircle, AlertTriangle, Lock, Unlock,
    MapPin, Download, UserCog, History
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { exportToExcel } from '@/lib/export.js';
import { formatAuditAction, formatAuditDetails } from '@/lib/auditLabels.js';
import { api, ApiError } from '@/services/api';
import RoleFormModal from '@/components/rbac/RoleFormModal';

// Couleur par niveau hiérarchique (pure présentation — les libellés/capacités viennent
// de l'API /api/rbac/roles, source de vérité unique côté backend).
const LEVEL_COLORS = {
    1: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    2: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    3: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    4: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    5: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    0: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

const PermissionCheck = ({ active }) => (
    active
        ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
        : <XCircle className="w-4 h-4 text-slate-700 mx-auto" />
);

const LevelBadge = ({ level }) => (
    <Badge variant="outline" className={`${LEVEL_COLORS[level] || LEVEL_COLORS[0]} whitespace-nowrap`}>
        Niv. {level}
    </Badge>
);

const DASHBOARD_VIEWS = [
    { value: '', label: 'Automatique (selon rôle)' },
    { value: 'client', label: 'Client' },
    { value: 'investor', label: 'Investisseur' },
    { value: 'admin', label: 'Admin' },
    { value: 'comptable', label: 'Comptable' },
    { value: 'caissier', label: 'Caissier' },
    { value: 'auditeur', label: 'Auditeur' },
];

const EMPTY_USER_FORM = { sub: '', role: '', zone: '', viewOverride: '', perOperationCeiling: '' };

const UserFormModal = ({ isOpen, onClose, user, roles, onSave }) => {
    const [formData, setFormData] = useState(user
        ? { ...user, perOperationCeiling: user.perOperationCeiling ?? '' }
        : { ...EMPTY_USER_FORM, role: roles[0]?.id || '' });

    useEffect(() => {
        setFormData(user
            ? { ...user, perOperationCeiling: user.perOperationCeiling ?? '' }
            : { ...EMPTY_USER_FORM, role: roles[0]?.id || '' });
    }, [user, isOpen]);

    const handleSubmit = () => onSave(formData);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="glass-effect text-white sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{user ? 'Modifier Utilisateur' : 'Assigner un Rôle'}</DialogTitle>
                    <DialogDescription>
                        {user
                            ? 'Rôle et zone rattachés au compte (le nom/email viennent de la connexion IdP).'
                            : "L'utilisateur doit déjà s'être connecté au moins une fois via l'IdP AGRICAP."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Identifiant IdP</Label>
                        <Input
                            value={formData.sub} disabled={!!user}
                            onChange={e => setFormData({ ...formData, sub: e.target.value })}
                            placeholder="sub renvoyé par /me après connexion"
                            className="col-span-3 bg-slate-900 border-slate-700"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Rôle / Fonction</Label>
                        <Select value={formData.role} onValueChange={v => setFormData({ ...formData, role: v })}>
                            <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                            <SelectContent className="max-h-[200px]">
                                {roles.map(r => (
                                    <SelectItem key={r.id} value={r.id}>
                                        <span className="flex items-center gap-2">
                                            {r.label} <Badge variant="secondary" className="text-[10px] h-4">Niv.{r.level}</Badge>
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Zone</Label>
                        <Input value={formData.zone || ''} onChange={e => setFormData({ ...formData, zone: e.target.value })}
                            placeholder="Ex: Haut-Katanga" className="col-span-3 bg-slate-900 border-slate-700" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Vue Assignée</Label>
                        <Select value={formData.viewOverride || 'auto'} onValueChange={v => setFormData({ ...formData, viewOverride: v === 'auto' ? '' : v })}>
                            <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {DASHBOARD_VIEWS.map(v => (
                                    <SelectItem key={v.value || 'auto'} value={v.value || 'auto'}>{v.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Plafond / Opération</Label>
                        <Input
                            type="number" value={formData.perOperationCeiling}
                            onChange={e => setFormData({ ...formData, perOperationCeiling: e.target.value })}
                            placeholder="Aucun plafond individuel" className="col-span-3 bg-slate-900 border-slate-700"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Annuler</Button>
                    <Button onClick={handleSubmit} className="bg-emerald-600 hover:bg-emerald-700">
                        {user ? 'Mettre à jour' : 'Assigner'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const Users = () => {
    const { toast } = useToast();
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [roleModalOpen, setRoleModalOpen] = useState(false);
    const [editingRole, setEditingRole] = useState(null);
    const [auditEntries, setAuditEntries] = useState([]);
    const [activeTab, setActiveTab] = useState('users');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRole, setFilterRole] = useState('all');

    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);

    const loadUsers = () => api.rbac.users.list().then(setUsers).catch(() => {});
    const loadAudit = () => api.audit.entries({ entity_type: 'FintechUser' }).then(setAuditEntries).catch(() => {});

    useEffect(() => {
        api.rbac.roles().then(setRoles).catch(() => {});
        loadUsers();
        loadAudit();
    }, []);

    // Création ET modification d'un rôle, depuis l'onglet qui porte leur nom.
    // Le serveur refuse qu'on modifie les permissions de SON PROPRE rôle
    // (AUTO_ESCALADE_INTERDITE) : on relaie son message tel quel plutôt que de
    // pré-juger le droit côté écran.
    const handleSaveRole = async (formData) => {
        try {
            if (editingRole) {
                await api.rbac.updateRole(editingRole.id, {
                    label: formData.label, level: formData.level,
                    type: formData.type, permissions: formData.permissions,
                });
                toast({ title: 'Rôle mis à jour', description: `${formData.label} — permissions enregistrées.` });
            } else {
                await api.rbac.createRole({
                    id: formData.id, label: formData.label || formData.id,
                    level: formData.level, type: formData.type,
                    permissions: formData.permissions,
                });
                toast({ title: 'Rôle créé', description: `${formData.label || formData.id} est disponible pour affectation.` });
            }
            setRoleModalOpen(false); setEditingRole(null);
            api.rbac.roles().then(setRoles).catch(() => {});
        } catch (e) {
            toast({ variant: 'destructive', title: 'Échec',
                    description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleSaveUser = async (formData) => {
        try {
            await api.rbac.users.update(formData.sub, {
                role: formData.role, zone: formData.zone, viewOverride: formData.viewOverride || '',
                perOperationCeiling: formData.perOperationCeiling === '' ? null : Number(formData.perOperationCeiling),
            });
            toast({ title: "Utilisateur mis à jour", description: "Rôle, zone et plafond enregistrés." });
            loadUsers(); loadAudit();
        } catch (e) {
            toast({ variant: "destructive", title: "Échec", description: e instanceof ApiError ? e.message : String(e) });
        }
        setIsUserModalOpen(false); setEditingUser(null);
    };

    const handleStatusChange = async (sub, action) => {
        try {
            await api.rbac.users.action(sub, action);
            toast({ title: "Statut mis à jour" });
            loadUsers(); loadAudit();
        } catch (e) {
            toast({ variant: "destructive", title: "Échec", description: e instanceof ApiError ? e.message : String(e) });
        }
    };

    const handleExport = () => {
        exportToExcel(users, 'rapport_utilisateurs');
        toast({ title: "Exportation réussie", description: "Le fichier Excel a été généré." });
    };

    const filteredUsers = useMemo(() => {
        return users.filter(u => {
            const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase()) || u.sub.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesRole = filterRole === 'all' || u.role === filterRole;
            return matchesSearch && matchesRole;
        });
    }, [users, searchTerm, filterRole]);

    const kpis = {
        total: users.length,
        active: users.filter(u => u.status === 'Actif').length,
        suspended: users.filter(u => u.status === 'Suspendu').length,
        locked: users.filter(u => u.security?.locked).length,
    };

    return (
        <Layout>
            <Helmet>
                <title>Gestion Utilisateurs - AGRICAP</title>
            </Helmet>

            <div className="space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <UserCog className="w-8 h-8 text-emerald-400" />
                            Gestion des Utilisateurs
                        </h1>
                        <p className="text-slate-400 mt-1">Administration hiérarchique, rôles et sécurité.</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" className="border-slate-600 hover:bg-slate-700" onClick={handleExport}>
                            <Download className="w-4 h-4 mr-2" /> Exporter
                        </Button>
                        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setEditingUser(null); setIsUserModalOpen(true); }}>
                            <UserPlus className="w-4 h-4 mr-2" /> Assigner un Rôle
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                        <div className="flex justify-between items-start">
                            <div><p className="text-slate-400 text-xs uppercase">Utilisateurs Total</p><p className="text-2xl font-bold text-white">{kpis.total}</p></div>
                            <UsersIcon className="text-blue-400 w-5 h-5" />
                        </div>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                        <div className="flex justify-between items-start">
                            <div><p className="text-slate-400 text-xs uppercase">Actifs</p><p className="text-2xl font-bold text-emerald-400">{kpis.active}</p></div>
                            <CheckCircle2 className="text-emerald-400 w-5 h-5" />
                        </div>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                        <div className="flex justify-between items-start">
                            <div><p className="text-slate-400 text-xs uppercase">Suspendus</p><p className="text-2xl font-bold text-amber-400">{kpis.suspended}</p></div>
                            <AlertTriangle className="text-amber-400 w-5 h-5" />
                        </div>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                        <div className="flex justify-between items-start">
                            <div><p className="text-slate-400 text-xs uppercase">Alertes Sécu.</p><p className="text-2xl font-bold text-red-400">{kpis.locked}</p></div>
                            <Lock className="text-red-400 w-5 h-5" />
                        </div>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                            placeholder="Rechercher par nom ou identifiant..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="pl-10 bg-slate-800 border-slate-700"
                        />
                    </div>
                    <Select value={filterRole} onValueChange={setFilterRole}>
                        <SelectTrigger className="w-[200px] bg-slate-800 border-slate-700"><SelectValue placeholder="Rôle" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Tous les Rôles</SelectItem>
                            {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                    <TabsList className="bg-slate-800 border border-slate-700">
                        <TabsTrigger value="users" className="data-[state=active]:bg-emerald-600"><UsersIcon className="w-4 h-4 mr-2" /> Utilisateurs</TabsTrigger>
                        <TabsTrigger value="roles" className="data-[state=active]:bg-emerald-600"><Shield className="w-4 h-4 mr-2" /> Rôles & Permissions</TabsTrigger>
                        <TabsTrigger value="security" className="data-[state=active]:bg-emerald-600"><Key className="w-4 h-4 mr-2" /> Sécurité</TabsTrigger>
                        <TabsTrigger value="audit" className="data-[state=active]:bg-emerald-600"><History className="w-4 h-4 mr-2" /> Audit</TabsTrigger>
                    </TabsList>

                    <TabsContent value="users">
                        <div className="rounded-md border border-slate-800 bg-slate-900/30">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-900/80 hover:bg-slate-900/80 border-slate-800">
                                        <TableHead>Utilisateur</TableHead>
                                        <TableHead>Niveau & Rôle</TableHead>
                                        <TableHead>Zone</TableHead>
                                        <TableHead>Statut</TableHead>
                                        <TableHead>Dernière Connexion</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredUsers.map(user => (
                                        <TableRow key={user.sub} className="border-slate-800 hover:bg-slate-800/30">
                                            <TableCell>
                                                <div className="font-medium text-white">{user.name}</div>
                                                <div className="text-xs text-slate-500 font-mono">{user.sub}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-1 items-start">
                                                    <LevelBadge level={user.level} />
                                                    <span className="text-xs text-slate-300">{user.roleLabel}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-xs text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> {user.zone || 'Non assignée'}</div>
                                                {user.perOperationCeiling != null && (
                                                    <div className="text-[10px] text-amber-400 mt-0.5">Plafond : {user.perOperationCeiling.toLocaleString()}</div>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={user.status === 'Actif' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}>
                                                    {user.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-sm text-slate-400">{user.lastLogin ? new Date(user.lastLogin).toLocaleString() : '-'}</TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white">
                                                            <MoreHorizontal className="w-4 h-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700 text-slate-200">
                                                        <DropdownMenuItem onClick={() => { setEditingUser(user); setIsUserModalOpen(true); }}>
                                                            <UserCog className="w-4 h-4 mr-2" /> Modifier Profil
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleStatusChange(user.sub, 'reset_pin')}>
                                                            <Key className="w-4 h-4 mr-2" /> Reset PIN
                                                        </DropdownMenuItem>
                                                        {user.security?.locked ? (
                                                            <DropdownMenuItem onClick={() => handleStatusChange(user.sub, 'unlock')}>
                                                                <Unlock className="w-4 h-4 mr-2" /> Déverrouiller
                                                            </DropdownMenuItem>
                                                        ) : (
                                                            <DropdownMenuItem className="text-amber-400" onClick={() => handleStatusChange(user.sub, 'lock')}>
                                                                <Lock className="w-4 h-4 mr-2" /> Verrouiller (sécurité)
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuSeparator className="bg-slate-700" />
                                                        {user.status === 'Actif' ? (
                                                            <DropdownMenuItem className="text-red-400" onClick={() => handleStatusChange(user.sub, 'suspend')}>
                                                                <XCircle className="w-4 h-4 mr-2" /> Suspendre
                                                            </DropdownMenuItem>
                                                        ) : (
                                                            <DropdownMenuItem className="text-emerald-400" onClick={() => handleStatusChange(user.sub, 'activate')}>
                                                                <CheckCircle2 className="w-4 h-4 mr-2" /> Activer
                                                            </DropdownMenuItem>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>

                    <TabsContent value="roles">
                        {/* Cette matrice est en LECTURE SEULE, et rien ne le disait.
                            Deux écrans parlent des rôles : celui-ci montre la matrice
                            effective, « Rôles & Accès » (/roles) la modifie. Un
                            utilisateur qui cherchait à cocher une case ici n'avait
                            aucun moyen de savoir où aller — un écran sans issue.
                            On ne duplique pas l'éditeur : un seul endroit modifie
                            les pouvoirs, sinon deux formulaires divergent
                            (principe 6). On indique le chemin. */}
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-slate-400">
                                Matrice effective des capacités. Vous ne pouvez pas modifier
                                les permissions de <strong>votre propre rôle</strong> : un autre
                                administrateur doit le faire.
                            </p>
                            <Button
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-500"
                                onClick={() => { setEditingRole(null); setRoleModalOpen(true); }}
                            >
                                <Shield className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                                Créer un rôle
                            </Button>
                        </div>
                        <div className="rounded-md border border-slate-800 bg-slate-900/30 overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-900/80 border-slate-800">
                                        <TableHead>Rôle / Fonction</TableHead>
                                        <TableHead className="text-center w-24">Lecture</TableHead>
                                        <TableHead className="text-center w-24">Création</TableHead>
                                        <TableHead className="text-center w-24">Validation</TableHead>
                                        <TableHead className="text-center w-24">Décaissement</TableHead>
                                        <TableHead className="text-center w-24">Audit</TableHead>
                                        <TableHead className="text-center w-24">Paramétrage</TableHead>
                                        <TableHead className="text-center w-28">Coopératives</TableHead>
                                        <TableHead className="text-right w-28">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {roles.map(role => (
                                        <TableRow key={role.id} className="border-slate-800 hover:bg-slate-800/20">
                                            <TableCell className="font-medium">
                                                {role.label} <span className="text-xs text-slate-500 ml-2">(Niv. {role.level})</span>
                                            </TableCell>
                                            <TableCell className="text-center"><PermissionCheck active={role.permissions.read} /></TableCell>
                                            <TableCell className="text-center"><PermissionCheck active={role.permissions.create} /></TableCell>
                                            <TableCell className="text-center"><PermissionCheck active={role.permissions.validate} /></TableCell>
                                            <TableCell className="text-center"><PermissionCheck active={role.permissions.disburse} /></TableCell>
                                            <TableCell className="text-center"><PermissionCheck active={role.permissions.audit} /></TableCell>
                                            <TableCell className="text-center"><PermissionCheck active={role.permissions.config} /></TableCell>
                                            <TableCell className="text-center"><PermissionCheck active={role.permissions.cooperatives} /></TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm"
                                                    onClick={() => { setEditingRole(role); setRoleModalOpen(true); }}>
                                                    Modifier
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>

                    <TabsContent value="security">
                        <div className="rounded-md border border-slate-800 bg-slate-900/30">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-900/80 border-slate-800">
                                        <TableHead>Utilisateur</TableHead>
                                        <TableHead>Statut Compte</TableHead>
                                        <TableHead>Politique MFA (rôle)</TableHead>
                                        <TableHead className="text-right">Actions Sécurité</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredUsers.map(user => (
                                        <TableRow key={user.sub} className="border-slate-800">
                                            <TableCell className="font-medium text-white">{user.name}</TableCell>
                                            <TableCell>
                                                {user.security?.locked ? (
                                                    <Badge variant="destructive" className="flex w-fit items-center gap-1"><Lock className="w-3 h-3" /> Verrouillé</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 flex w-fit items-center gap-1"><Unlock className="w-3 h-3" /> Ouvert</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {user.security?.mfaPolicyRequired ? (
                                                    <Badge variant="secondary" className="bg-blue-500/10 text-blue-400">Exigée</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-slate-500">Non exigée</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    {user.security?.locked ? (
                                                        <Button size="sm" variant="outline" className="h-7 text-xs border-amber-500/30 text-amber-400" onClick={() => handleStatusChange(user.sub, 'unlock')}>
                                                            Déverrouiller
                                                        </Button>
                                                    ) : (
                                                        <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-400" onClick={() => handleStatusChange(user.sub, 'lock')}>
                                                            Verrouiller
                                                        </Button>
                                                    )}
                                                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleStatusChange(user.sub, 'reset_pin')}>
                                                        Reset PIN
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </TabsContent>

                    <TabsContent value="audit">
                        <div className="glass-effect p-6 rounded-xl text-center text-slate-400">
                            <Shield className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                            <h3 className="text-lg font-semibold text-white mb-2">Journal d'Audit Sécurisé</h3>
                            <p className="max-w-md mx-auto mb-6">Toutes les actions administratives (création, modification, changement de rôle) sont immuablement enregistrées ici.</p>

                            <div className="text-left max-w-4xl mx-auto border border-slate-700 rounded-lg overflow-hidden">
                                {auditEntries.length > 0 ? (
                                    <Table>
                                        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Action</TableHead><TableHead>Détails</TableHead><TableHead>Par</TableHead></TableRow></TableHeader>
                                        <TableBody>
                                            {auditEntries.map((log) => (
                                                <TableRow key={log.id} className="border-slate-800">
                                                    <TableCell className="text-xs text-slate-400 font-mono">{new Date(log.timestamp).toLocaleString()}</TableCell>
                                                    <TableCell className="font-medium text-emerald-400">{formatAuditAction(log.action)}</TableCell>
                                                    <TableCell className="text-xs">{formatAuditDetails(log.details)}</TableCell>
                                                    <TableCell className="text-xs text-slate-500">{log.userName || log.user}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <div className="p-8 text-center text-sm">Aucune donnée d'audit disponible.</div>
                                )}
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>

            <UserFormModal
                isOpen={isUserModalOpen}
                onClose={() => { setIsUserModalOpen(false); setEditingUser(null); }}
                user={editingUser}
                roles={roles}
                onSave={handleSaveUser}
            />

            {/* Même éditeur que l'écran « Rôles & Accès » — importé, jamais recopié :
                deux formulaires qui décident des mêmes pouvoirs divergent tôt ou
                tard, et c'est la matrice « qui approuve, qui décaisse » qu'on ne
                peut pas se permettre de voir diverger (principe 6). */}
            <RoleFormModal
                isOpen={roleModalOpen}
                onClose={() => { setRoleModalOpen(false); setEditingRole(null); }}
                role={editingRole}
                onSave={handleSaveRole}
            />
        </Layout>
    );
};

export default Users;

import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout, { menuKeyFor } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Bell, Shield, Database, Upload, Trash2, FileText, AlertTriangle, CreditCard } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { api } from '@/services/api';


const TabContentWrapper = ({ children }) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-effect rounded-2xl p-8"
    >
        {children}
    </motion.div>
);

const Settings = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const bucket = menuKeyFor(user);
    const isClientBucket = bucket === 'client' || bucket === 'investor';

    const [notifications, setNotifications] = useState([]);
    const [monthlyLimit, setMonthlyLimit] = useState(null);
    const [dataSources, setDataSources] = useState([]);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        api.notifications.mine().then(setNotifications).catch(() => {});
        if (isClientBucket) {
            api.compliance.kycProfiles().then((profiles) => {
                const mine = profiles.find((p) => p.userSub === user?.sub);
                setMonthlyLimit(mine?.monthlyLimit ?? null);
            }).catch(() => setMonthlyLimit(null));
        } else {
            api.dataSources().then(setDataSources).catch(() => {});
        }
    }, [isClientBucket, user?.sub]);

    const getUserInitials = (name) => {
        if (!name) return 'U';
        const parts = name.trim().split(/\s+/);
        return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    };

    const handleStub = (title, description) => {
        toast({ title, description });
    };

    const handleMarkRead = async (id) => {
        try {
            await api.notifications.markRead(id);
            setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Action impossible.', variant: 'destructive' });
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const form = new FormData();
            form.append('file', file);
            const created = await api.uploadSource(form);
            setDataSources((prev) => [created, ...prev]);
            toast({ title: 'Fichier importé', description: file.name });
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Import impossible.', variant: 'destructive' });
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleDeleteSource = async (id) => {
        try {
            await api.deleteSource(id);
            setDataSources((prev) => prev.filter((f) => f.id !== id));
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || 'Suppression impossible.', variant: 'destructive' });
        }
    };

    return (
        <Layout>
            <Helmet>
                <title>Paramètres - AGRICAP FINTECH</title>
                <meta name="description" content="Gérez votre profil, notifications, sécurité et données." />
            </Helmet>

            <div className="space-y-8">
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                    <h1 className="text-4xl font-bold gradient-text mb-2">Centre de Contrôle</h1>
                    <p className="text-gray-400">Gérez votre compte, vos préférences et votre sécurité.</p>
                </motion.div>

                <Tabs defaultValue="profil" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 bg-white/5 p-1 h-auto">
                        <TabsTrigger value="profil"><User className="w-4 h-4 mr-2 hidden md:inline"/>Profil</TabsTrigger>
                        <TabsTrigger value="notifications"><Bell className="w-4 h-4 mr-2 hidden md:inline"/>Notifications</TabsTrigger>
                        <TabsTrigger value="securite"><Shield className="w-4 h-4 mr-2 hidden md:inline"/>Sécurité</TabsTrigger>
                        <TabsTrigger value="donnees"><Database className="w-4 h-4 mr-2 hidden md:inline"/>Données</TabsTrigger>
                    </TabsList>

                    <div className="pt-6">
                    <TabsContent value="profil">
                        <TabContentWrapper>
                            <div className="flex flex-col md:flex-row items-start gap-8">
                                <div className="flex flex-col items-center gap-4">
                                     <Avatar className="w-32 h-32 text-4xl">
                                        <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-blue-600 text-white">
                                            {getUserInitials(user?.name)}
                                        </AvatarFallback>
                                    </Avatar>
                                </div>
                                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2"> <Label>Nom complet</Label> <Input value={user?.name || ''} readOnly className="opacity-70" /> </div>
                                    <div className="space-y-2"> <Label>Rôle</Label> <Input value={user?.role || ''} readOnly className="opacity-70" /> </div>
                                    <div className="space-y-2"> <Label>Adresse email</Label> <Input type="email" value={user?.email || ''} readOnly className="opacity-70" /> </div>
                                    <div className="space-y-2"> <Label>Numéro de téléphone</Label> <Input type="tel" value={user?.phone || 'Non renseigné'} readOnly className="opacity-70" /> </div>
                                    <div className="space-y-2"> <Label>Langue</Label> <Select defaultValue="fr"><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="fr">Français</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select></div>
                                    <div className="space-y-2"> <Label>Fuseau horaire</Label> <Select defaultValue="auto"><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="auto">Automatique (UTC+2)</SelectItem></SelectContent></Select></div>
                                    <div className="flex items-center justify-between rounded-lg border p-4 col-span-2">
                                        <div className="space-0.5"><Label>Mode Sombre</Label><p className="text-sm text-muted-foreground">Activez pour une meilleure expérience visuelle.</p></div>
                                        <Switch defaultChecked/>
                                    </div>
                                    <div className="col-span-2 text-xs text-slate-500 bg-slate-800/40 rounded-lg p-3">
                                        Les informations d'identité (nom, email, téléphone, rôle) sont gérées par votre compte AGRICAP IdP et ne sont pas modifiables depuis cette page.
                                    </div>
                                </div>
                            </div>
                        </TabContentWrapper>
                    </TabsContent>

                    <TabsContent value="notifications">
                        <TabContentWrapper>
                             <h2 className="text-xl font-bold text-white mb-6">Historique des Notifications</h2>
                             <div className="space-y-4">
                                 {notifications.length === 0 && <p className="text-sm text-slate-500">Aucune notification.</p>}
                                 {notifications.map(notif => (
                                     <div key={notif.id} className={`flex items-start gap-4 p-4 rounded-lg border ${notif.read ? 'border-transparent' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                                         <div className="w-8 h-8 flex-shrink-0 mt-1 rounded-full bg-white/10 flex items-center justify-center">
                                             <Bell className={`w-4 h-4 ${notif.read ? 'text-gray-400' : 'text-emerald-400'}`} />
                                         </div>
                                         <div className="flex-1">
                                             <p className="font-semibold text-white">{notif.title}</p>
                                             {notif.body && <p className="text-sm text-gray-300">{notif.body}</p>}
                                             <p className="text-sm text-gray-400">{new Date(notif.createdAt).toLocaleString()}</p>
                                         </div>
                                         <Button variant="ghost" size="sm" disabled={notif.read} onClick={() => handleMarkRead(notif.id)}>{notif.read ? 'Lu' : 'Marquer lu'}</Button>
                                     </div>
                                 ))}
                             </div>
                        </TabContentWrapper>
                    </TabsContent>

                    <TabsContent value="securite">
                        <TabContentWrapper>
                           <h2 className="text-xl font-bold text-white mb-6">Sécurité & Confidentialité</h2>
                           <div className="space-y-8">
                                <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 flex items-center gap-4">
                                    <AlertTriangle className="w-6 h-6 text-yellow-400 flex-shrink-0"/>
                                    <div>
                                        <h3 className="font-semibold text-yellow-300">Sécurité gérée par l'IdP AGRICAP</h3>
                                        <p className="text-sm text-yellow-400/80">Le mot de passe, l'authentification à deux facteurs (2FA) et les appareils connectés sont gérés depuis votre compte AGRICAP IdP, pas depuis cette application.</p>
                                    </div>
                                </div>

                                {/* Limits Management Section */}
                                <div className="border border-white/10 rounded-xl p-6 bg-white/5">
                                    <div className="flex items-center gap-2 mb-6">
                                        <CreditCard className="w-5 h-5 text-blue-400"/>
                                        <h3 className="font-bold text-white">Limites Personnelles</h3>
                                    </div>
                                    {isClientBucket ? (
                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <Label>Plafond mensuel (KYC)</Label>
                                                <span className="font-bold text-emerald-400">{monthlyLimit !== null ? `$${monthlyLimit.toLocaleString()}` : 'N/D'}</span>
                                            </div>
                                            <p className="text-xs text-slate-500">Défini par votre niveau KYC. Une modification requiert une revue par l'équipe conformité.</p>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-slate-400">
                                            Les seuils de validation par type d'opération se configurent dans
                                            {' '}<a href="/validation-journal" className="text-blue-400 underline">Journal de Validation</a>.
                                        </p>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                     <Button variant="outline" onClick={() => handleStub('Changer le mot de passe', 'Géré depuis votre compte AGRICAP IdP.')}>Changer le mot de passe</Button>
                                     <Button onClick={() => handleStub('Authentification à 2 facteurs', 'Géré depuis votre compte AGRICAP IdP.')} className="bg-gradient-to-r from-emerald-500 to-blue-600">Activer l'authentification à 2 facteurs (2FA)</Button>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-white mb-4">Appareils connectés</h3>
                                    <p className="text-sm text-slate-500">Non disponible depuis cette application — gérez vos sessions actives depuis votre compte AGRICAP IdP.</p>
                                </div>
                           </div>
                        </TabContentWrapper>
                    </TabsContent>

                    <TabsContent value="donnees">
                       <TabContentWrapper>
                             <h2 className="text-xl font-bold text-white mb-6">Données & Intégrations</h2>
                             {isClientBucket ? (
                                <p className="text-sm text-slate-400">L'import de données de référence est réservé au personnel AGRICAP (moteur d'analyse crédit).</p>
                             ) : (
                             <div className="space-y-8">
                                <div>
                                    <h3 className="font-semibold text-white mb-4">Téléverser des données</h3>
                                    <div className="p-6 border-2 border-dashed border-white/20 rounded-xl text-center">
                                        <Upload className="mx-auto w-10 h-10 text-gray-400 mb-2"/>
                                        <p className="text-white mb-2">Sélectionnez un fichier de référentiel</p>
                                        <p className="text-xs text-gray-500 mb-4">.xlsx, .csv, .ods</p>
                                        <Input type="file" accept=".xlsx,.csv,.ods" onChange={handleUpload} disabled={uploading} className="max-w-xs mx-auto bg-slate-800/60" />
                                    </div>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-white mb-4">Fichiers importés</h3>
                                    <div className="space-y-3">
                                        {dataSources.length === 0 && <p className="text-sm text-slate-500">Aucun fichier importé.</p>}
                                        {dataSources.map(file => (
                                            <div key={file.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                                                <div className="flex items-center gap-3"><FileText className="w-5 h-5 text-blue-400"/><div><p className="font-medium text-white">{file.original_name}</p><p className="text-xs text-gray-400">{file.kind} - {file.status}</p></div></div>
                                                <div className="flex gap-2">
                                                    <Button variant="ghost" size="icon" className="w-8 h-8 text-red-400" onClick={() => handleDeleteSource(file.id)}><Trash2 className="w-4 h-4"/></Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                             </div>
                             )}
                       </TabContentWrapper>
                    </TabsContent>
                    </div>
                </Tabs>
            </div>
        </Layout>
    );
};

export default Settings;

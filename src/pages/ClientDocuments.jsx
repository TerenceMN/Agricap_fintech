import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { STATUS_LABELS } from '@/lib/constants';
import { FileCheck2, Upload, AlertTriangle, ShieldCheck, CheckCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';

const DOC_TYPE_OPTIONS = [
    { value: 'other', label: "Statuts de l'entreprise" },
    { value: 'financial', label: 'États Financiers' },
    { value: 'other', label: 'Autre justificatif' },
];

const ClientDocuments = () => {
    const { toast } = useToast();
    const [kycLevel] = useState(1);
    const [documents, setDocuments] = useState([]);
    const [docType, setDocType] = useState('other');

    useEffect(() => { api.compliance.myDocuments().then(setDocuments).catch(() => {}); }, []);

    const handleUpload = async (e) => {
        e.preventDefault();
        try {
            const doc = await api.compliance.uploadDocument({ type: docType, name: 'nouveau_document.pdf' });
            setDocuments([doc, ...documents]);
            toast({ title: "Document téléversé", description: "Votre document est en cours d'analyse." });
        } catch {
            toast({ variant: 'destructive', title: 'Échec du téléversement' });
        }
    };

    return (
        <Layout>
            <Helmet>
                <title>Documents & KYC - AGRICAP FINTECH</title>
            </Helmet>

            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <h1 className="text-3xl font-bold gradient-text">Centre de Conformité (KYC)</h1>
                <p className="text-gray-400">Gérez vos documents légaux et vérifiez votre statut de conformité.</p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <Card className="glass-effect md:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400"/> Statut de Vérification</CardTitle>
                        <CardDescription>Votre niveau de conformité actuel détermine vos limites de transaction.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative">
                                <div className="w-20 h-20 rounded-full border-4 border-emerald-500 flex items-center justify-center bg-emerald-500/10">
                                    <span className="text-2xl font-bold text-emerald-400">T{kycLevel}</span>
                                </div>
                                <CheckCircle className="absolute bottom-0 right-0 w-6 h-6 text-white bg-emerald-500 rounded-full" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-white">Niveau {kycLevel} - Vérifié</h3>
                                <p className="text-sm text-gray-400">Limites: 50,000 USD / mois</p>
                                <Button variant="link" className="text-emerald-400 p-0 h-auto">Voir les avantages du Niveau {kycLevel + 1}</Button>
                            </div>
                        </div>
                        <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
                            <div className="bg-emerald-500 h-full w-3/4"></div>
                        </div>
                        <p className="text-xs text-right mt-1 text-gray-500">75% vers Niveau {kycLevel + 1}</p>
                    </CardContent>
                </Card>
                <Card className="glass-effect border-yellow-500/30">
                    <CardHeader>
                         <CardTitle className="flex items-center gap-2 text-yellow-400"><AlertTriangle className="w-5 h-5"/> Actions Requises</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-3 text-sm">
                            <li className="flex gap-2 items-start">
                                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1.5"></span>
                                <span className="text-gray-300">Mettre à jour le certificat d'impôt (expiration proche).</span>
                            </li>
                            <li className="flex gap-2 items-start">
                                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1.5"></span>
                                <span className="text-gray-300">Valider l'adresse email secondaire.</span>
                            </li>
                        </ul>
                        <Button size="sm" className="w-full mt-4 bg-yellow-600 hover:bg-yellow-700 text-white">Résoudre</Button>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                 <Card className="glass-effect">
                    <CardHeader>
                        <CardTitle>Mes Documents</CardTitle>
                    </CardHeader>
                    <CardContent>
                         <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Statut</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {documents.map(doc => (
                                    <TableRow key={doc.id}>
                                        <TableCell className="font-medium text-white">
                                            <div className="flex items-center gap-2">
                                                <FileCheck2 className="w-4 h-4 text-blue-400"/> {doc.type}
                                            </div>
                                        </TableCell>
                                        <TableCell>{new Date(doc.date).toLocaleDateString()}</TableCell>
                                        <TableCell>
                                            <Badge className={STATUS_LABELS[doc.status]?.color}>
                                                {STATUS_LABELS[doc.status]?.label}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <Card className="glass-effect">
                    <CardHeader>
                        <CardTitle>Téléverser un Document</CardTitle>
                        <CardDescription>Formats acceptés: PDF, JPG, PNG (Max 5MB)</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleUpload} className="space-y-4">
                            <div className="space-y-2">
                                <Label>Type de document</Label>
                                <select
                                    value={docType}
                                    onChange={e => setDocType(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-sm text-white"
                                >
                                    {DOC_TYPE_OPTIONS.map((opt, i) => (
                                        <option key={i} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center hover:bg-slate-800/50 transition-colors cursor-pointer">
                                <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                                <p className="text-sm text-slate-300">Cliquez pour choisir un fichier</p>
                            </div>
                            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">Envoyer pour validation</Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </Layout>
    );
};

export default ClientDocuments;
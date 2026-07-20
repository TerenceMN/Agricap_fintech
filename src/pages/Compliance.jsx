import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FileUp, UserCheck as UserSearch, ShieldQuestion } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError } from '@/services/api';

const RiskBadge = ({ score }) => {
  const config = {
    'Bas': 'success',
    'Moyen': 'info',
    'Élevé': 'destructive',
  };
  return <Badge variant={config[score]}>{score}</Badge>;
};

const KycStatusBadge = ({ status }) => {
    const config = {
      'Validé': { variant: 'success' },
      'En attente': { variant: 'info' },
    };
    return <Badge variant={config[status]?.variant || 'secondary'}>{status}</Badge>;
};

const Compliance = () => {
  const { toast } = useToast();
  const [kycData, setKycData] = useState([]);

  const loadKyc = () => api.compliance.kycProfiles().then(setKycData).catch(() => {});
  useEffect(() => { loadKyc(); }, []);

  const handleValidate = async (userSub) => {
    try {
      await api.compliance.validateKyc(userSub);
      toast({ title: 'KYC validé' });
      loadKyc();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  return (
    <Layout>
      <Helmet>
        <title>Conformité (KYC/AML) - AGRICAP FINTECH</title>
        <meta name="description" content="Gestion de la conformité, vérification KYC et analyse AML." />
      </Helmet>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold gradient-text mb-2">Conformité (KYC / AML)</h1>
        <p className="text-gray-400">Vérification de l'identité des clients et surveillance anti-blanchiment.</p>
      </motion.div>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8"
      >
        <div className="lg:col-span-2 glass-effect p-6 rounded-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Suivi KYC des Clients</h2>
            <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Statut KYC</TableHead>
                    <TableHead>Score de Risque</TableHead>
                    <TableHead>Limite Mensuelle</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {kycData.map((client) => (
                    <TableRow key={client.userSub} className="border-slate-800">
                        <TableCell className="font-semibold font-mono text-xs">{client.userSub}</TableCell>
                        <TableCell><KycStatusBadge status={client.kycStatus} /></TableCell>
                        <TableCell><RiskBadge score={client.riskScore} /></TableCell>
                        <TableCell>{client.monthlyLimit.toLocaleString()} USD</TableCell>
                        <TableCell className="text-right">
                            {client.kycStatus !== 'Validé' && (
                                <Button size="sm" variant="outline" onClick={() => handleValidate(client.userSub)}>Valider</Button>
                            )}
                        </TableCell>
                    </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
        <div className="glass-effect p-6 rounded-2xl flex flex-col justify-start gap-4">
            <h2 className="text-xl font-bold text-white">Actions de Conformité</h2>
            <Button className="w-full"><FileUp className="w-4 h-4 mr-2"/> Uploader un document KYC</Button>
            <Button className="w-full" variant="secondary"><UserSearch className="w-4 h-4 mr-2"/> Lancer une vérification</Button>
            <Button className="w-full" variant="destructive"><ShieldQuestion className="w-4 h-4 mr-2"/> Soumettre au contrôle AML</Button>
        </div>
      </motion.div>
    </Layout>
  );
};

export default Compliance;
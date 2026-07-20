import React from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Badge } from '@/components/ui/badge';
import { useToast } from "@/components/ui/use-toast";
import { Copy } from 'lucide-react';

const CodeBlock = ({ children, language = 'json' }) => {
    const { toast } = useToast();
    const textToCopy = typeof children === 'string' ? children : JSON.stringify(children, null, 2);

    const handleCopy = () => {
        navigator.clipboard.writeText(textToCopy);
        toast({
            title: 'Copié !',
            description: 'Le bloc de code a été copié dans le presse-papiers.',
        });
    };

    return (
        <div className="relative my-4 rounded-lg bg-black/30">
            <button
                onClick={handleCopy}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 text-slate-400 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="Copy code"
            >
                <Copy className="w-4 h-4" />
            </button>
            <pre className="p-4 overflow-x-auto text-sm text-white/90">
                <code className={`language-${language}`}>{textToCopy}</code>
            </pre>
        </div>
    );
};


const Endpoint = ({ method, path, title, description, request, response }) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-effect p-6 rounded-2xl mb-6"
    >
        <div className="flex items-center gap-4 mb-2">
            <Badge variant={
                method === 'POST' ? 'success' :
                method === 'GET' ? 'info' :
                method === 'PUT' ? 'warning' : 'destructive'
            } className="text-sm font-bold w-20 justify-center">{method}</Badge>
            <h3 className="text-lg font-mono text-emerald-400">{path}</h3>
        </div>
        <h2 className="text-xl font-bold text-white mt-1">{title}</h2>
        <p className="text-slate-400 mt-1 mb-4">{description}</p>
        
        {request && (
            <>
                <h4 className="font-semibold text-slate-200">Exemple de Requête :</h4>
                <CodeBlock>{request}</CodeBlock>
            </>
        )}
        
        {response && (
            <>
                <h4 className="font-semibold text-slate-200 mt-4">Exemple de Réponse :</h4>
                <CodeBlock>{response}</CodeBlock>
            </>
        )}
    </motion.div>
);

const ApiDocs = () => {
    return (
        <Layout>
            <Helmet>
                <title>Documentation API - AGRICAP FINTECH</title>
                <meta name="description" content="Documentation technique pour l'intégration avec l'API REST d'AGRICAP FIN." />
            </Helmet>

            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <h1 className="text-4xl font-bold gradient-text mb-2">Documentation API</h1>
                <p className="text-gray-400">Guide de référence pour les développeurs et partenaires s'intégrant à AGRICAP FIN.</p>
            </motion.div>

            <div className="mt-8">
                <h2 className="text-2xl font-bold text-white mb-4 border-l-4 border-emerald-500 pl-4">Authentification</h2>
                <Endpoint 
                    method="POST" 
                    path="/api/auth/login" 
                    title="Connexion Utilisateur"
                    description="Authentifie un utilisateur et retourne un token JWT."
                    request={{ email: "user@example.com", password: "mypassword" }}
                    response={{
                        status: "success",
                        token: "JWT_TOKEN",
                        expires_in: 3600,
                        user: { id: 4, full_name: "John Doe", roles: ["comptable", "superviseur"] }
                    }}
                />

                <h2 className="text-2xl font-bold text-white mt-12 mb-4 border-l-4 border-emerald-500 pl-4">Épargne</h2>
                <Endpoint 
                    method="POST" 
                    path="/api/savings/deposit" 
                    title="Dépôt sur Compte Épargne"
                    description="Enregistre un nouveau dépôt sur un compte épargne et génère l'écriture comptable correspondante."
                    request={{ account_id: 88, amount: 150000, currency: "CDF", channel: "caisse" }}
                    response={{
                        status: "success",
                        transaction_id: 552,
                        journal_entry: { id: 211, journal: "JEP-FC", debit: "501FC", credit: "412FC", amount: 150000 }
                    }}
                />

                <h2 className="text-2xl font-bold text-white mt-12 mb-4 border-l-4 border-emerald-500 pl-4">Crédit</h2>
                <Endpoint 
                    method="POST" 
                    path="/api/loans/{id}/disburse" 
                    title="Décaissement de Crédit"
                    description="Marque un crédit comme décaissé et génère l'écriture comptable d'octroi."
                    request={{ loan_id: 22, method: "caisse", cashbox_id: 1 }}
                    response={{
                        status: "success",
                        journal_entry: { journal: "JCR-FC", debit: "413FC", credit: "501FC", amount: 500000 }
                    }}
                />
                 <Endpoint 
                    method="POST" 
                    path="/api/loans/{id}/repay-fx" 
                    title="Remboursement Cross-Currency"
                    description="Gère le remboursement d'un crédit USD avec un paiement en FC, en générant les écritures de change (FX)."
                    request={{ loan_id: 44, amount_fc: 280000, fx_rate: 2800 }}
                    response={{
                        status: "success",
                        journal_fx: { debit: "501FC", credit: "588FX", amount_fc: 280000 }
                    }}
                />

                <h2 className="text-2xl font-bold text-white mt-12 mb-4 border-l-4 border-emerald-500 pl-4">Comptabilité</h2>
                 <Endpoint 
                    method="POST" 
                    path="/api/accounting/journals" 
                    title="Créer une Écriture Comptable"
                    description="Permet de passer une écriture manuelle. Le système valide l'équilibre et les permissions."
                    request={{ 
                        journal_code: "JCA-FC",
                        piece_ref: "DEP-554",
                        lines: [
                            { account: "501FC", dc: "D", amount: 150000 },
                            { account: "412FC", dc: "C", amount: 150000 }
                        ]
                    }}
                    response={{
                        status: "success",
                        message: "Écriture postée avec succès.",
                        entry_id: 789
                    }}
                />
            </div>
        </Layout>
    );
};

export default ApiDocs;
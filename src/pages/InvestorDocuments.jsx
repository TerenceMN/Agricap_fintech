import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';

const InvestorDocuments = () => {
    const [docs, setDocs] = useState([]);

    useEffect(() => { api.compliance.myDocuments().then(setDocs).catch(() => {}); }, []);

    return (
        <Layout>
            <Helmet><title>Documents - AGRICAP</title></Helmet>
            <h1 className="text-3xl font-bold gradient-text mb-8">Documents & Contrats</h1>
            <div className="space-y-4">
                {docs.length === 0 && <p className="text-gray-500">Aucun document pour le moment.</p>}
                {docs.map(doc => (
                    <div key={doc.id} className="glass-effect p-4 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                <FileText className="w-5 h-5 text-blue-400"/>
                            </div>
                            <div>
                                <p className="font-semibold text-white">{doc.name}</p>
                                <p className="text-xs text-gray-400">{new Date(doc.date).toLocaleDateString()} • {doc.type}</p>
                            </div>
                        </div>
                        {doc.fileUrl && (
                            <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                                <Button variant="ghost" size="icon"><Download className="w-5 h-5"/></Button>
                            </a>
                        )}
                    </div>
                ))}
            </div>
        </Layout>
    );
};

export default InvestorDocuments;
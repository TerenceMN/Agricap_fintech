import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { Bell } from 'lucide-react';
import { api } from '@/services/api';

const InvestorNotifications = () => {
    const [notifs, setNotifs] = useState([]);

    useEffect(() => { api.notifications.mine().then(setNotifs).catch(() => {}); }, []);

    return (
        <Layout>
            <Helmet><title>Alertes - AGRICAP</title></Helmet>
            <h1 className="text-3xl font-bold gradient-text mb-8">Notifications & Alertes</h1>
            <div className="space-y-4">
                {notifs.length === 0 && <p className="text-gray-500">Aucune alerte pour le moment.</p>}
                {notifs.map(n => (
                    <div key={n.id} className="glass-effect p-4 rounded-xl border-l-4 border-l-emerald-500">
                        <div className="flex justify-between items-start mb-1">
                            <h3 className="font-bold text-white flex items-center gap-2"><Bell className="w-4 h-4 text-emerald-400"/> {n.title}</h3>
                            <span className="text-xs text-gray-500">{new Date(n.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-gray-400 text-sm ml-6">{n.body}</p>
                    </div>
                ))}
            </div>
        </Layout>
    );
};

export default InvestorNotifications;
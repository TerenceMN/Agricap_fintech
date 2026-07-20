import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Bell, Check, Info, CreditCard, AlertTriangle } from 'lucide-react';
import { api } from '@/services/api';

const ClientNotifications = () => {
    const [notifications, setNotifications] = useState([]);

    useEffect(() => { api.notifications.mine().then(setNotifications).catch(() => {}); }, []);

    const markAsRead = async (id) => {
        await api.notifications.markRead(id).catch(() => {});
        setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n));
    };

    const markAllRead = () => {
        notifications.filter(n => !n.read).forEach(n => api.notifications.markRead(n.id).catch(() => {}));
        setNotifications(notifications.map(n => ({ ...n, read: true })));
    };

    const getIcon = (type) => {
        switch(type) {
            case 'success': return <Check className="w-5 h-5 text-emerald-400" />;
            case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
            case 'credit': return <CreditCard className="w-5 h-5 text-blue-400" />;
            default: return <Info className="w-5 h-5 text-slate-400" />;
        }
    };

    return (
        <Layout>
            <Helmet>
                <title>Notifications - AGRICAP FINTECH</title>
            </Helmet>

            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold gradient-text">Notifications</h1>
                    <p className="text-gray-400">Restez informé de l'activité de votre compte.</p>
                </div>
                <Button variant="outline" onClick={markAllRead}>Tout marquer comme lu</Button>
            </motion.div>

            <div className="space-y-4 max-w-4xl mx-auto">
                {notifications.length === 0 ? (
                    <div className="text-center py-12 text-gray-500 glass-effect rounded-2xl">
                        <Bell className="w-12 h-12 mx-auto mb-4 opacity-50"/>
                        <p>Aucune notification pour le moment.</p>
                    </div>
                ) : (
                    notifications.map(notif => (
                        <motion.div 
                            key={notif.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`glass-effect p-4 rounded-xl border-l-4 flex gap-4 items-start transition-colors ${notif.read ? 'border-l-slate-600 bg-slate-900/30' : 'border-l-emerald-500 bg-slate-800/80'}`}
                        >
                            <div className="mt-1 bg-slate-800 p-2 rounded-full">
                                {getIcon(notif.type)}
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <h3 className={`font-semibold ${notif.read ? 'text-gray-400' : 'text-white'}`}>{notif.title}</h3>
                                    <span className="text-xs text-gray-500">{new Date(notif.createdAt).toLocaleString()}</span>
                                </div>
                                <p className="text-sm text-gray-300 mt-1">{notif.body}</p>
                            </div>
                            {!notif.read && (
                                <Button variant="ghost" size="icon" onClick={() => markAsRead(notif.id)} title="Marquer comme lu">
                                    <Check className="w-4 h-4 text-emerald-400" />
                                </Button>
                            )}
                        </motion.div>
                    ))
                )}
            </div>
        </Layout>
    );
};

export default ClientNotifications;
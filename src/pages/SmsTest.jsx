import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { MessageSquare, Send, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError } from '@/services/api';

const SmsTest = () => {
    const { toast } = useToast();
    const [phone, setPhone] = useState('+243849585067');
    const [message, setMessage] = useState('Test AGRICAP FINTECH — si vous recevez ce message, le service SMS fonctionne correctement.');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null); // null | { sent, phone, message, sentAt }

    const handleSend = async () => {
        if (!phone.trim() || !message.trim()) return;
        setLoading(true);
        setResult(null);
        try {
            const res = await api.sms.test(phone.trim(), message.trim());
            setResult({ ...res, sentAt: new Date().toLocaleTimeString() });
            if (res.sent) {
                toast({ title: 'SMS envoyé', description: `Livré à ${res.phone}` });
            } else {
                toast({ variant: 'destructive', title: 'SMS non envoyé', description: 'Vérifiez les logs serveur Django pour le détail.' });
            }
        } catch (e) {
            toast({ variant: 'destructive', title: 'Erreur', description: e instanceof ApiError ? e.message : String(e) });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Helmet><title>Test SMS — AGRICAP</title></Helmet>
            <div className="max-w-xl space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <MessageSquare className="w-6 h-6 text-emerald-400" />
                        Test d'envoi SMS
                    </h1>
                    <p className="text-slate-400 mt-1 text-sm">
                        Envoie un SMS de test via Dream Digital. Les logs détaillés apparaissent dans
                        le terminal Django (<span className="font-mono text-slate-300">[SMS] ...</span>).
                    </p>
                </div>

                <div className="glass-effect rounded-xl border border-white/10 p-6 space-y-4">
                    <div>
                        <Label>Numéro de téléphone</Label>
                        <Input
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            placeholder="+243xxxxxxxxx"
                            className="mt-1 font-mono bg-slate-900/50 border-slate-700"
                        />
                        <p className="text-xs text-slate-500 mt-1">Format international avec indicatif pays (ex. +243...)</p>
                    </div>
                    <div>
                        <Label>Message</Label>
                        <Textarea
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="Contenu du SMS..."
                            rows={4}
                            className="mt-1 bg-slate-900/50 border-slate-700"
                        />
                        <p className="text-xs text-slate-500 mt-1">{message.length} caractères</p>
                    </div>
                    <Button
                        className="w-full bg-emerald-600 hover:bg-emerald-700"
                        disabled={loading || !phone.trim() || !message.trim()}
                        onClick={handleSend}
                    >
                        {loading
                            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Envoi en cours…</>
                            : <><Send className="w-4 h-4 mr-2" /> Envoyer le SMS</>}
                    </Button>
                </div>

                {result && (
                    <div className={`rounded-xl border p-5 space-y-3 ${result.sent
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-red-500/30 bg-red-500/5'}`}>
                        <div className="flex items-center gap-2">
                            {result.sent
                                ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                : <XCircle className="w-5 h-5 text-red-400" />}
                            <span className={`font-semibold ${result.sent ? 'text-emerald-400' : 'text-red-400'}`}>
                                {result.sent ? 'SMS envoyé avec succès' : 'Échec — SMS non envoyé'}
                            </span>
                            <span className="text-xs text-slate-500 ml-auto">{result.sentAt}</span>
                        </div>
                        <div className="space-y-1 text-sm border-t border-white/5 pt-3">
                            <div className="flex gap-2">
                                <span className="text-slate-500 w-20 shrink-0">Destinataire</span>
                                <span className="font-mono text-slate-200">{result.phone}</span>
                            </div>
                            <div className="flex gap-2">
                                <span className="text-slate-500 w-20 shrink-0">Message</span>
                                <span className="text-slate-300 italic">« {result.message} »</span>
                            </div>
                        </div>
                        {!result.sent && (
                            <p className="text-xs text-red-400/80 border-t border-red-500/20 pt-2">
                                Consultez le terminal Django pour les prints <span className="font-mono">[SMS]</span> —
                                ils indiquent si le problème vient des identifiants, du numéro ou de l'API Dream Digital.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </>
    );
};

export default SmsTest;

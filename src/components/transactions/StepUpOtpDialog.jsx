import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, Send } from 'lucide-react';
import { api } from '@/services/api';
import { useToast } from '@/components/ui/use-toast';

/** Ré-authentification par étape (step-up OTP email) exigée par le backend (HTTP 428)
 * pour approuver une transaction au-dessus du seuil superviseur ou pour un rôle
 * `mfaRequired`. Partagé par Transactions.jsx, ValidationJournal.jsx, SpecialCases.jsx. */
const StepUpOtpDialog = ({ open, onOpenChange, transactionId, onApproved }) => {
    const { toast } = useToast();
    const [challengeId, setChallengeId] = useState(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open || !transactionId) return;
        setCode('');
        setChallengeId(null);
        setBusy(true);
        api.transactions.otpRequest(transactionId)
            .then((r) => setChallengeId(r.challengeId))
            .catch((err) => toast({ title: "Erreur", description: err.message || "Échec de l'envoi du code.", variant: 'destructive' }))
            .finally(() => setBusy(false));
    }, [open, transactionId]);

    const handleVerifyAndApprove = async () => {
        if (!challengeId || !code) return;
        setBusy(true);
        try {
            const verif = await api.transactions.otpVerify(transactionId, challengeId, code);
            if (!verif.verified) {
                toast({ title: 'Code invalide', description: 'Le code saisi est incorrect ou expiré.', variant: 'destructive' });
                return;
            }
            await api.transactions.approve(transactionId, code);
            toast({ title: 'Approuvé', description: 'Validation step-up réussie.' });
            onOpenChange(false);
            onApproved?.();
        } catch (err) {
            toast({ title: 'Erreur', description: err.message || "Échec de l'approbation.", variant: 'destructive' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /> Validation renforcée (OTP)</DialogTitle>
                    <DialogDescription>
                        Ce montant exige une double authentification. Un code a été envoyé par email à votre compte approbateur.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Label htmlFor="otp-code">Code reçu par email</Label>
                    <Input id="otp-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6}
                        placeholder="000000" className="bg-slate-800 border-slate-700 tracking-widest text-center text-lg" />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => api.transactions.otpRequest(transactionId).then((r) => setChallengeId(r.challengeId))} disabled={busy}>
                        <Send className="w-4 h-4 mr-2" /> Renvoyer le code
                    </Button>
                    <Button onClick={handleVerifyAndApprove} disabled={busy || !code} className="bg-emerald-600">
                        Vérifier &amp; Approuver
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default StepUpOtpDialog;

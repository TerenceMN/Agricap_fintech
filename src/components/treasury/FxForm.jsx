import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertCircle, ArrowRightLeft } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import OperationConfirmDialog from '@/components/treasury/OperationConfirmDialog';
import {
  EMPTY_FX_FORM, WALLET_CURRENCIES, fxRateLabel, validateFx, walletOperationErrors,
} from '@/components/treasury/walletOperations';

/**
 * LE formulaire de change — le taux vient du serveur, toujours.
 *
 * L'aperçu est le résultat de `/fx/convert` au tarif CLIENT : c'est le montant
 * que le serveur s'engage à créditer, pas une estimation reconstituée côté
 * navigateur. Aucune constante de taux n'existe dans ce fichier, et il ne doit
 * jamais en apparaître : un taux affiché qui ne serait pas celui appliqué est
 * un mensonge chiffré, pas un arrondi.
 *
 * Quand le serveur ne renvoie pas de taux, l'écran ne devine pas : il dit
 * qu'aucun taux n'est configuré et refuse la conversion.
 */
const FxForm = ({ balances, onCompleted = () => {} }) => {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_FX_FORM);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);

  useEffect(() => {
    if (!form.amount || parseFloat(form.amount) <= 0) { setPreview(null); return; }
    api.fx.convert(parseFloat(form.amount), form.from, form.to, 'CLIENT')
      .then((res) => setPreview(res.amount))
      .catch(() => setPreview(null));
  }, [form.amount, form.from, form.to]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const found = validateFx(form, balances, preview);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setServerErrors([]);
    setPending({
      label: 'Change FX',
      amount: parseFloat(form.amount),
      currency: form.from,
      received: { amount: preview, currency: form.to },
    });
  };

  const execute = async () => {
    setSubmitting(true);
    try {
      await api.caisses.wallets.convert(form.from, form.to, pending.amount);
      setPending(null);
      setForm(EMPTY_FX_FORM);
      setErrors({});
      setServerErrors([]);
      toast({
        title: 'Opération Effectuée',
        description: 'Votre Change FX a été traité(e).',
        className: 'bg-emerald-500 text-white',
      });
      onCompleted();
    } catch (err) {
      const causes = walletOperationErrors(err);
      setServerErrors(causes);
      toast({
        variant: 'destructive',
        title: 'Échec',
        description: causes.map((c) => c.message).join(' · '),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-end gap-4 bg-slate-900/30 p-4 rounded-xl">
          <div className="flex-1 space-y-2">
            <Label>Je convertis (De)</Label>
            <Select
              value={form.from}
              onValueChange={(v) => setForm({ ...form, from: v, to: v === 'USD' ? 'CDF' : 'USD' })}
            >
              <SelectTrigger className="bg-slate-800" aria-label="Devise source"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WALLET_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              className={`bg-slate-800 text-lg ${errors.fxAmount ? 'border-red-500' : ''}`}
            />
            {errors.fxAmount && (
              <span className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle size={10} /> {errors.fxAmount}
              </span>
            )}
          </div>
          <ArrowRightLeft className="mb-3 text-gray-400" />
          <div className="flex-1 space-y-2">
            <Label>Je reçois (Vers)</Label>
            <Input value={form.to} disabled className="bg-slate-800/50 font-bold text-center" />
            <div className="bg-slate-800/50 h-10 rounded-md flex items-center px-3 text-lg font-bold text-emerald-400">
              {preview !== null ? preview.toLocaleString() : '0.00'}
            </div>
          </div>
        </div>
        <div className="text-center text-sm text-gray-400">{fxRateLabel(form, preview)}</div>
        <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">Convertir Maintenant</Button>
      </form>

      <OperationConfirmDialog
        operation={pending}
        onOpenChange={() => setPending(null)}
        onConfirm={execute}
        submitting={submitting}
        errors={serverErrors}
      />
    </>
  );
};

export default FxForm;

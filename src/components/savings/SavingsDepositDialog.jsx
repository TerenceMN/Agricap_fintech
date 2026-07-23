import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { Banknote, Landmark, Smartphone, User } from 'lucide-react';
import { api } from '@/services/api';
import SavingsConfirmDialog from '@/components/savings/SavingsConfirmDialog';
import {
  EMPTY_SAVINGS_DEPOSIT_FORM,
  SAVINGS_CHANNELS,
  buildSavingsDeposit,
  channelRequiresReference,
  planCurrency,
  planLabel,
  savingsOperationErrors,
  validateSavingsDeposit,
} from '@/components/savings/savingsOperations';

const CHANNEL_ICONS = { agent: User, mobile_money: Smartphone, bank: Landmark };

/**
 * Dépôt sur un plan d'épargne — saisie PUIS confirmation.
 *
 * Jusqu'ici, `Savings.jsx` envoyait le dépôt au serveur au premier clic sur
 * « Valider le Dépôt » : c'était le seul mouvement d'argent de l'application
 * sans étape de vérification. Un client qui visait le mauvais plan, ou qui
 * tapait 1000 au lieu de 100, n'avait aucun moment pour s'en apercevoir.
 *
 * Le dépôt part donc désormais en deux temps, et la devise affichée est CELLE
 * DU PLAN telle que le serveur l'a servie — jamais une constante d'écran. Si
 * elle manque, le dépôt est bloqué plutôt que supposé.
 *
 * Aucun chiffre n'est fabriqué ici : ni solde après dépôt, ni intérêt, ni
 * frais. Les afficher supposerait de les calculer côté client (§5).
 */
const SavingsDepositDialog = ({ open, plan, onOpenChange, onDeposited = () => {} }) => {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_SAVINGS_DEPOSIT_FORM);
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);

  const currency = planCurrency(plan);

  const reset = () => {
    setForm(EMPTY_SAVINGS_DEPOSIT_FORM);
    setErrors({});
    setPending(null);
    setServerErrors([]);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const found = validateSavingsDeposit(form, plan);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setServerErrors([]);
    setPending(buildSavingsDeposit(form, plan));
  };

  const execute = async () => {
    if (!pending) return;
    setSubmitting(true);
    try {
      const updated = await api.savings.deposit(pending.planId, pending.amount, pending.channel);
      toast({
        title: 'Dépôt enregistré',
        description: `${planLabel(plan)} — dépôt confirmé et transmis.`,
        className: 'bg-emerald-500 text-white',
      });
      onDeposited(updated);
      reset();
      onOpenChange(false);
    } catch (err) {
      // Le dialogue reste ouvert et la saisie derrière reste intacte : le refus
      // se lit là où l'opération est encore visible, et se corrige sans tout
      // ressaisir.
      const causes = savingsOperationErrors(err);
      setServerErrors(causes);
      toast({
        variant: 'destructive',
        title: 'Dépôt refusé',
        description: causes.map((c) => c.message).join(' · '),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={!!open} onOpenChange={(next) => { if (!next) close(); }}>
        <DialogContent className="glass-effect text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold gradient-text">Effectuer un Dépôt</DialogTitle>
            <DialogDescription className="text-gray-400">
              Alimentez votre plan d'épargne : {planLabel(plan)}
              {currency
                ? ` — les montants sont libellés en ${currency}, devise du plan.`
                : " — la devise du plan n'a pas été servie par le serveur."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 my-2">
            <div>
              <Label htmlFor="savings-deposit-amount">
                Montant du Dépôt{currency ? ` (${currency})` : ''}
              </Label>
              <Input
                id="savings-deposit-amount"
                name="amount"
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                className="bg-white/5 mt-1 border-white/10"
              />
              {errors.amount && <p className="text-red-400 text-xs mt-1">{errors.amount}</p>}
              {errors.currency && <p className="text-red-400 text-xs mt-1">{errors.currency}</p>}
            </div>

            <div>
              <Label>Canal de Dépôt</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {SAVINGS_CHANNELS.map(({ id, label }) => {
                  const Icon = CHANNEL_ICONS[id];
                  const active = form.channel === id;
                  return (
                    <Button
                      key={id}
                      type="button"
                      variant={active ? 'secondary' : 'outline'}
                      onClick={() => setForm((p) => ({ ...p, channel: id }))}
                      className={`flex-1 ${active ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400' : 'border-white/10'}`}
                    >
                      {Icon && <Icon className="w-4 h-4 mr-2" />}
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {channelRequiresReference(form.channel) && (
              <div>
                <Label htmlFor="savings-deposit-reference">Référence Transaction</Label>
                <Input
                  id="savings-deposit-reference"
                  name="reference"
                  value={form.reference}
                  onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))}
                  className="bg-white/5 mt-1 border-white/10"
                />
                {errors.reference && <p className="text-red-400 text-xs mt-1">{errors.reference}</p>}
              </div>
            )}

            <div className="flex items-start space-x-3 pt-2">
              <Checkbox
                id="savings-deposit-agreed"
                checked={form.agreed}
                onCheckedChange={(checked) => setForm((p) => ({ ...p, agreed: checked === true }))}
                className="mt-1"
              />
              <div className="grid gap-1.5 leading-none">
                <label htmlFor="savings-deposit-agreed" className="text-sm font-medium leading-none">
                  Je confirme l'exactitude des informations et le dépôt autorisé.
                </label>
                {errors.agreed && <p className="text-red-400 text-xs">{errors.agreed}</p>}
              </div>
            </div>

            <DialogFooter className="!mt-6">
              <Button type="button" variant="ghost" onClick={close}>Annuler</Button>
              <Button type="submit" className="bg-gradient-to-r from-emerald-500 to-blue-600">
                <Banknote className="w-4 h-4 mr-2" /> Vérifier le Dépôt
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SavingsConfirmDialog
        open={!!pending}
        title="Confirmer votre dépôt"
        description="Ce dépôt sera transmis au serveur dès que vous confirmerez. Vérifiez le plan visé, le montant et sa devise."
        lines={pending ? pending.lines : []}
        onOpenChange={() => setPending(null)}
        onConfirm={execute}
        submitting={submitting}
        errors={serverErrors}
        confirmLabel="Confirmer et Déposer"
      />
    </>
  );
};

export default SavingsDepositDialog;

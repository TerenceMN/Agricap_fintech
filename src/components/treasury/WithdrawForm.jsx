import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import AmountFields from '@/components/treasury/AmountFields';
import OperationConfirmDialog from '@/components/treasury/OperationConfirmDialog';
import {
  EMPTY_AMOUNT_FORM, validateWithdraw, walletOperationErrors,
} from '@/components/treasury/walletOperations';

/**
 * LE formulaire de retrait — même règle que le dépôt : un seul, partout.
 *
 * Deux comportements ne doivent JAMAIS être aplatis en le réutilisant :
 *   - le solde se contrôle dans LA devise demandée, pas sur un cumul ;
 *   - au-dessus du seuil automatique, le serveur ne poste pas le mouvement : il
 *     ouvre une demande soumise à approbation. Le retour ne vaut alors pas
 *     « effectué », et l'écran doit le dire (`status !== 'posted'`), sans quoi
 *     le client croit disposer d'un argent encore immobilisé.
 */
const WithdrawForm = ({ balances, onCompleted = () => {} }) => {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_AMOUNT_FORM);
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const found = validateWithdraw(form, balances);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setServerErrors([]);
    setPending({
      label: 'Retrait',
      amount: parseFloat(form.amount),
      currency: form.currency,
      received: null,
    });
  };

  const execute = async () => {
    setSubmitting(true);
    try {
      const result = await api.caisses.wallets.withdraw(pending.amount, pending.currency);
      let title = 'Opération Effectuée';
      let description = 'Votre Retrait a été traité(e).';
      if (result.status !== 'posted') {
        title = 'Retrait en attente de validation';
        description = result.detail || 'Ce montant nécessite une validation avant exécution.';
      }
      setPending(null);
      setForm(EMPTY_AMOUNT_FORM);
      setErrors({});
      setServerErrors([]);
      toast({ title, description, className: 'bg-emerald-500 text-white' });
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
      <form onSubmit={handleSubmit} className="space-y-4">
        <AmountFields
          form={form}
          onChange={setForm}
          errors={errors}
          methodLabel="Compte de Destination"
          phoneLabel="Détails du compte (Numéro / IBAN)"
          phonePlaceholder="Entrez les coordonnées..."
          phoneAlways
        />
        <Button type="submit" className="w-full bg-red-600 hover:bg-red-700 mt-4">
          Demander le Retrait
        </Button>
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

export default WithdrawForm;

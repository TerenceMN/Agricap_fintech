import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import AmountFields from '@/components/treasury/AmountFields';
import OperationConfirmDialog from '@/components/treasury/OperationConfirmDialog';
import {
  EMPTY_AMOUNT_FORM, validateDeposit, walletOperationErrors,
} from '@/components/treasury/walletOperations';

/**
 * LE formulaire de dépôt — un seul, pour toutes les surfaces qui en proposent un.
 *
 * Il vient de « Ma Trésorerie » (`ClientWallet`), qui était la seule
 * implémentation complète : montant, devise choisie, moyen de paiement,
 * coordonnées, puis confirmation. L'espace investisseur en avait une copie
 * réduite qui envoyait `'USD'` en dur ; ce composant fait disparaître ce défaut
 * par construction, puisque la devise n'a plus de valeur par défaut imposée par
 * l'appelant — elle est saisie par le client et confirmée sous ses yeux.
 *
 * Le composant ne rend QUE le formulaire (pas de carte, pas de titre) : chaque
 * écran l'habille comme il l'entend, en onglet ou en boîte de dialogue.
 */
const DepositForm = ({ onCompleted = () => {}, submitLabel = 'Initier le Dépôt' }) => {
  const { toast } = useToast();
  const [form, setForm] = useState(EMPTY_AMOUNT_FORM);
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const found = validateDeposit(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setServerErrors([]);
    setPending({
      label: 'Dépôt',
      amount: parseFloat(form.amount),
      currency: form.currency,
      received: null,
    });
  };

  const execute = async () => {
    setSubmitting(true);
    try {
      // La devise vient de la saisie confirmée, jamais d'une constante d'appel.
      await api.caisses.wallets.deposit(pending.amount, pending.currency, form.method);
      setPending(null);
      setForm(EMPTY_AMOUNT_FORM);
      setErrors({});
      setServerErrors([]);
      toast({
        title: 'Opération Effectuée',
        description: 'Votre Dépôt a été traité(e).',
        className: 'bg-emerald-500 text-white',
      });
      onCompleted();
    } catch (err) {
      // Le dialogue reste ouvert : le client garde l'opération sous les yeux
      // pendant qu'il lit les causes du refus.
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
          methodLabel="Méthode de Paiement"
          phoneLabel="Numéro de téléphone"
          phonePlaceholder="+243..."
        />
        <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 mt-4">
          {submitLabel}
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

export default DepositForm;

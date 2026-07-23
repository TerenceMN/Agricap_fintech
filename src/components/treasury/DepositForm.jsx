import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import AmountFields from '@/components/treasury/AmountFields';
import OperationConfirmDialog from '@/components/treasury/OperationConfirmDialog';
import {
  EMPTY_AMOUNT_FORM, validateDeposit, walletOperationErrors,
} from '@/components/treasury/walletOperations';
import { classifyDepositOutcome } from '@/components/treasury/depositOutcome';
import {
  buildDepositArgs, counterpartyErrors, isCounterpartyRequired,
} from '@/components/payments/depositContract';

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
 * DÉPÔT DEVENU ASYNCHRONE. Depuis que le wallet est la seule porte vers
 * l'extérieur, un dépôt externe (mobile money / banque) ne crédite plus
 * instantanément : le serveur ouvre un ORDRE DE PAIEMENT chez le fournisseur et
 * répond `kind: "payment_order"`, encore en attente. Ce composant ne dit
 * « effectué » que sur un `kind: "movement"` (dépôt interne réglé) ; pour tout
 * ordre non confirmé, il affiche « en attente de confirmation » et rappelle que
 * le solde n'a pas bougé. La décision vit dans `classifyDepositOutcome`, testée
 * à part — jamais dans un `if` d'affichage improvisé ici.
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
  // Verdict du dernier dépôt, affiché de façon PERSISTANTE sous le formulaire —
  // un toast s'efface, l'honnêteté d'un « en attente » ne doit pas s'effacer.
  const [outcome, setOutcome] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Deux contrôles complémentaires : les règles de saisie génériques
    // (`validateDeposit`) ET l'exigence de contrepartie d'un canal externe
    // (`counterpartyErrors`). `validateDeposit` passe en dernier pour que son
    // « Numéro requis » précis l'emporte sur le message générique en Mobile Money.
    const found = { ...counterpartyErrors({ method: form.method, counterparty: form.phone }), ...validateDeposit(form) };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setServerErrors([]);
    setOutcome(null);
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
      // Le canal externe est traduit (`bank_transfer` → `bank`) et la
      // contrepartie jointe : sans quoi le serveur refuse en 422
      // (`unknown_channel` / `counterparty_required`).
      const result = await api.caisses.wallets.deposit(buildDepositArgs({
        amount: pending.amount, currency: pending.currency,
        method: form.method, counterparty: form.phone,
      }));
      // La réponse est DISCRIMINÉE : mouvement réglé vs ordre de paiement en
      // attente. Seul `classifyDepositOutcome` tranche « effectué vs en attente ».
      const verdict = classifyDepositOutcome(result);
      setOutcome(verdict);
      setPending(null);
      setForm(EMPTY_AMOUNT_FORM);
      setErrors({});
      setServerErrors([]);
      toast({
        title: verdict.title,
        description: verdict.description,
        className: verdict.settled ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white',
      });
      onCompleted();
    } catch (err) {
      // Le dialogue reste ouvert : le client garde l'opération sous les yeux
      // pendant qu'il lit les causes du refus.
      const causes = walletOperationErrors(err);
      setServerErrors(causes);
      // 422 de contrat : si le serveur réclame la contrepartie, on rallume le
      // champ concerné pour que la correction soit évidente, en plus du message.
      if (isCounterpartyRequired(err)) {
        setErrors((prev) => ({
          ...prev,
          phone: 'Contrepartie requise par le fournisseur (numéro Mobile Money / compte source).',
        }));
      }
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
        {/* Ni `phoneLabel` ni `phonePlaceholder` : le champ contrepartie s'étiquette
            selon le moyen choisi (numéro Mobile Money vs compte source). */}
        <AmountFields
          form={form}
          onChange={setForm}
          errors={errors}
          methodLabel="Méthode de Paiement"
        />
        <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 mt-4">
          {submitLabel}
        </Button>
      </form>

      {outcome && <DepositOutcomeNotice outcome={outcome} />}

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

/**
 * Le récapitulatif honnête d'un dépôt : vert « effectué » si l'argent est
 * crédité, ambre « en attente » sinon — et JAMAIS l'inverse. Pour un ordre
 * externe, on redit noir sur blanc que le solde n'a pas encore bougé et on
 * renvoie vers l'onglet de suivi.
 */
const NOTICE_STYLE = {
  success: { wrap: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200', Icon: CheckCircle2 },
  pending: { wrap: 'bg-amber-500/10 border-amber-500/30 text-amber-200', Icon: Clock },
  error: { wrap: 'bg-red-500/10 border-red-500/30 text-red-200', Icon: AlertTriangle },
};

const DepositOutcomeNotice = ({ outcome }) => {
  const style = NOTICE_STYLE[outcome.tone] || NOTICE_STYLE.pending;
  const { Icon } = style;
  return (
    <div className={`mt-4 rounded-lg border p-4 text-sm ${style.wrap}`} role="status">
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">{outcome.title}</p>
          <p className="opacity-90">{outcome.description}</p>
          {outcome.reference && (
            <p className="text-xs opacity-80">
              Référence de l’ordre : <span className="font-mono">{outcome.reference}</span> —
              {' '}suivez son avancement dans « Ordres de paiement ».
            </p>
          )}
          {!outcome.settled && !outcome.reference && (
            <p className="text-xs opacity-80">Votre solde n’a pas encore changé.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default DepositForm;

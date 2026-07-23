/**
 * La barre d'actions d'un ordre de paiement — présentation seule. La DÉCISION
 * (quelles actions, pour qui) vit dans `paymentActions.availableActions` ; ce
 * composant ne fait que la rendre. C'est cette séparation qui rend testable, en
 * une assertion, la garantie critique : sur un ordre INDÉTERMINÉ, aucun bouton
 * ne « relance » — seules réconciliation et règlement forcé sont offerts.
 *
 * NB : composant en `.jsx` (et non `.tsx`) parce qu'il consomme la primitive UI
 * `.jsx` Button non typée — convention du projet. La logique typée reste dans
 * `paymentActions.ts`.
 */
import { Button } from '@/components/ui/button';
import { availableActions, isOpen } from './paymentActions';

const INTENT_CLASS = {
  default: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  reconcile: 'bg-blue-600 hover:bg-blue-700 text-white',
  danger: 'border border-red-500/40 text-red-300 hover:bg-red-500/10 bg-transparent',
};

const OrderActions = ({ status, caps, onAct, busy = false }) => {
  const actions = availableActions(status, caps);

  if (actions.length === 0) {
    // Rien à faire : soit l'ordre est terminal, soit l'agent n'a pas la capacité.
    // On DIT laquelle, on ne laisse pas un vide muet (jamais un bouton fantôme).
    if (isOpen(status) && !caps.validate) {
      return (
        <p className="text-xs text-amber-300/80">
          Consultation seule : la réconciliation d’un ordre en attente exige la capacité
          {' '}
          <span className="font-mono">validate</span>.
        </p>
      );
    }
    return <p className="text-xs text-slate-500">Aucune action disponible sur cet ordre.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((spec) => (
        <Button
          key={spec.id}
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => onAct(spec)}
          title={spec.hint}
          className={`text-xs ${INTENT_CLASS[spec.intent]}`}
        >
          {spec.label}
        </Button>
      ))}
    </div>
  );
};

export default OrderActions;

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { ErrorPanel } from '@/components/backoffice/States';

/**
 * L'étape de confirmation propre à l'épargne.
 *
 * Elle se tient entre un clic et un mouvement irréversible : dépôt sur un plan,
 * suppression d'un groupe, décision sur une adhésion. Elle ne décide de rien —
 * elle redit, dans les termes de l'épargne, ce que l'appelant a déjà construit
 * (`lines`), puis rend la main.
 *
 * Deux règles de comportement, aussi importantes que l'affichage :
 *   1. rien n'est envoyé au serveur avant `onConfirm` ;
 *   2. un refus serveur NE FERME PAS ce dialogue. Les causes s'affichent ici,
 *      là où l'opération est encore sous les yeux, et la saisie d'origine reste
 *      intacte derrière — l'utilisateur corrige sans tout retaper.
 *
 * Volontairement distincte de `treasury/OperationConfirmDialog` : le dépôt
 * d'épargne n'a pas de devise à choisir (c'est celle du plan), pas de frais à
 * annoncer, et des canaux qui lui sont propres. Partager le composant aurait
 * obligé à afficher des champs vides ou, pire, inventés.
 */
const SavingsConfirmDialog = ({
  open,
  title = "Confirmer l'opération",
  description = 'Vérifiez ces éléments : ils ne seront plus modifiables une fois validés.',
  lines = [],
  onOpenChange,
  onConfirm,
  submitting = false,
  errors = [],
  confirmLabel = 'Confirmer',
  pendingLabel = 'Envoi…',
  destructive = false,
}) => (
  <Dialog open={!!open} onOpenChange={(next) => { if (!next && !submitting) onOpenChange(false); }}>
    <DialogContent className="glass-effect text-white">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-gray-400">{description}</DialogDescription>
      </DialogHeader>

      <div className="py-2 space-y-3">
        {lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-4 border-b border-white/10 pb-2 last:border-0">
            <span className="text-gray-400 text-sm">{line.label}</span>
            <span
              className={line.emphasis
                ? 'font-bold text-lg text-emerald-400 text-right break-words'
                : 'font-medium text-white text-right break-words'}
            >
              {line.value}
            </span>
          </div>
        ))}
      </div>

      {errors.length > 0 && <ErrorPanel errors={errors} title="Opération refusée par le serveur" />}

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
          Annuler
        </Button>
        <Button
          onClick={onConfirm}
          disabled={submitting}
          className={destructive
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-gradient-to-r from-emerald-500 to-blue-600'}
        >
          {submitting ? pendingLabel : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default SavingsConfirmDialog;

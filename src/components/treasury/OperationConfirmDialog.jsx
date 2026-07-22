import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { ErrorPanel } from '@/components/backoffice/States';

/**
 * Étape de confirmation avant TOUT mouvement d'argent.
 *
 * C'est le seul écran qui se tient entre une faute de frappe et un virement.
 * Il redit au client les trois choses qu'il ne peut plus corriger après coup :
 * la nature de l'opération, le montant, et LA DEVISE. Cette dernière est la
 * raison d'être du composant partagé : le formulaire de dépôt de l'espace
 * investisseur envoyait des dollars quel que soit ce que le client avait en
 * tête, sans jamais le lui montrer.
 *
 * Un refus serveur ne referme pas ce dialogue : les causes s'affichent ici,
 * là où le client a encore l'opération sous les yeux.
 */
const OperationConfirmDialog = ({ operation, onOpenChange, onConfirm, submitting, errors = [] }) => (
  <Dialog open={!!operation} onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
    <DialogContent className="glass-effect text-white">
      <DialogHeader>
        <DialogTitle>Confirmer l'opération</DialogTitle>
        <DialogDescription>Veuillez vérifier les détails avant de valider.</DialogDescription>
      </DialogHeader>
      {operation && (
        <div className="py-4 space-y-3">
          <div className="flex justify-between border-b border-gray-700 pb-2">
            <span className="text-gray-400">Type</span>
            <span className="font-bold text-white">{operation.label}</span>
          </div>
          <div className="flex justify-between border-b border-gray-700 pb-2">
            <span className="text-gray-400">Montant</span>
            <span className="font-bold text-emerald-400">
              {operation.amount.toLocaleString()} {operation.currency}
            </span>
          </div>
          {operation.received && (
            <div className="flex justify-between border-b border-gray-700 pb-2">
              <span className="text-gray-400">Montant Reçu (est.)</span>
              <span className="font-bold text-emerald-400">
                {operation.received.amount.toLocaleString()} {operation.received.currency}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-400">Frais estimés</span>
            <span className="font-bold text-white">0.00 {operation.currency}</span>
          </div>
        </div>
      )}
      {errors.length > 0 && <ErrorPanel errors={errors} title="Opération refusée" />}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Annuler</Button>
        <Button
          onClick={onConfirm}
          disabled={submitting}
          className="bg-gradient-to-r from-emerald-500 to-blue-600"
        >
          {submitting ? 'Envoi…' : 'Confirmer et Exécuter'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default OperationConfirmDialog;

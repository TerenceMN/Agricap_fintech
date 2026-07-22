import React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import DepositForm from '@/components/treasury/DepositForm';

/**
 * Le formulaire de dépôt partagé, présenté en boîte de dialogue.
 *
 * Pour les écrans où le dépôt part d'un bouton (« Faire un dépôt ») et non d'un
 * onglet dédié. La confirmation de `DepositForm` s'empile par-dessus : deux
 * couches, mais une seule étape de vérification — celle qui existe partout.
 */
const WalletDepositDialog = ({ open, onOpenChange, onCompleted = () => {} }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="glass-effect text-white">
      <DialogHeader>
        <DialogTitle>Nouveau dépôt</DialogTitle>
        <DialogDescription>
          Alimentez votre portefeuille AGRICAP. Choisissez la devise du dépôt : elle
          détermine le compte crédité.
        </DialogDescription>
      </DialogHeader>
      <DepositForm
        onCompleted={() => {
          onOpenChange(false);
          onCompleted();
        }}
      />
    </DialogContent>
  </Dialog>
);

export default WalletDepositDialog;

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertCircle, Smartphone, Landmark } from 'lucide-react';
import { WALLET_CURRENCIES } from '@/components/treasury/walletOperations';
import {
  counterpartyLabel, counterpartyPlaceholder, isExternalMethod,
} from '@/components/payments/depositContract';

/**
 * Les champs communs au dépôt et au retrait : montant, DEVISE, moyen, coordonnées.
 *
 * La devise est un `Select` et non une valeur implicite. C'est tout l'enjeu :
 * un formulaire qui ne montre pas la devise oblige le code appelant à en choisir
 * une — et le code appelant, lui, choisit toujours la même.
 *
 * Le champ « coordonnées » porte la CONTREPARTIE d'un canal externe (numéro
 * Mobile Money / compte source), que le serveur exige pour un dépôt Makuta. Il
 * s'affiche donc pour TOUT moyen externe — plus seulement le Mobile Money — et
 * son libellé s'adapte au moyen choisi, à moins que l'appelant n'en impose un
 * (le retrait fournit le sien). Sans ce champ pour le virement bancaire, un
 * dépôt banque partait sans contrepartie et se faisait refuser en 422.
 */
const AmountFields = ({
  form, onChange, errors, methodLabel, phoneLabel, phonePlaceholder, phoneAlways = false,
}) => {
  const set = (patch) => onChange({ ...form, ...patch });
  const showPhone = phoneAlways || isExternalMethod(form.method);
  const resolvedPhoneLabel = phoneLabel ?? counterpartyLabel(form.method);
  const resolvedPhonePlaceholder = phonePlaceholder ?? counterpartyPlaceholder(form.method);

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="wallet-amount">Montant</Label>
          <Input
            id="wallet-amount"
            type="number"
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder="0.00"
            required
            className={`bg-slate-900/50 ${errors.amount ? 'border-red-500' : ''}`}
          />
          {errors.amount && (
            <span className="text-xs text-red-500 flex items-center gap-1">
              <AlertCircle size={10} /> {errors.amount}
            </span>
          )}
        </div>
        <div className="space-y-2">
          <Label>Devise</Label>
          <Select value={form.currency} onValueChange={(v) => set({ currency: v })}>
            <SelectTrigger className="bg-slate-900/50" aria-label="Devise"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WALLET_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{methodLabel}</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={form.method === 'mobile_money' ? 'default' : 'outline'}
            onClick={() => set({ method: 'mobile_money' })}
            className="justify-start"
          >
            <Smartphone className="w-4 h-4 mr-2" /> Mobile Money
          </Button>
          <Button
            type="button"
            variant={form.method === 'bank_transfer' ? 'default' : 'outline'}
            onClick={() => set({ method: 'bank_transfer' })}
            className="justify-start"
          >
            <Landmark className="w-4 h-4 mr-2" /> Virement Bancaire
          </Button>
        </div>
      </div>

      {showPhone && (
        <div className="space-y-2">
          <Label htmlFor="wallet-phone">{resolvedPhoneLabel}</Label>
          <Input
            id="wallet-phone"
            placeholder={resolvedPhonePlaceholder}
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            className={`bg-slate-900/50 ${errors.phone ? 'border-red-500' : ''}`}
          />
          {errors.phone && (
            <span className="text-xs text-red-500 flex items-center gap-1">
              <AlertCircle size={10} /> {errors.phone}
            </span>
          )}
        </div>
      )}
    </>
  );
};

export default AmountFields;

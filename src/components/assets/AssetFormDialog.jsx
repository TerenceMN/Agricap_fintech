import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { ASSET_CATEGORIES, ASSET_CATEGORY_CODES } from './assetMeta';

const EMPTY = {
  name: '', type: 'materiel', value: '', currency: 'USD',
  description: '', localisation: '', documents: '',
};

/**
 * Formulaire de déclaration / modification d'un actif.
 *
 * Le client déclare **uniquement** ce que le backend accepte de lui
 * (`CLIENT_WRITABLE` : name, type, value, currency, description, localisation,
 * documents). Ni le statut ni la valeur retenue ne sont exposés : le backend
 * répond 403 `FIELD_NOT_WRITABLE` à toute tentative, et un contrôle qui
 * laisserait croire l'inverse serait un mensonge d'interface.
 *
 * @param {{open: boolean, asset: object|null, submitting: boolean,
 *          onOpenChange: Function, onSubmit: Function}} props
 */
const AssetFormDialog = ({ open, asset, submitting, onOpenChange, onSubmit }) => {
  const [form, setForm] = useState(EMPTY);
  const [acknowledged, setAcknowledged] = useState(false);

  const isEdit = Boolean(asset);
  // Modifier un actif certifié annule sa vérification côté serveur
  // (`assets/services.invalidate_verification`) : le statut repasse en
  // « déclaré », la valeur retenue et les marques de vérification sont effacées.
  // `libere` est concerné au même titre que `verifie` : il est `is_pledgeable`
  // et porte lui aussi une valeur retenue certifiée.
  const revalidationWarning = isEdit && (asset?.status === 'verifie' || asset?.status === 'libere');

  useEffect(() => {
    if (!open) return;
    setAcknowledged(false);
    setForm(
      asset
        ? {
            name: asset.name ?? '',
            type: asset.type ?? 'materiel',
            value: asset.value != null ? String(asset.value) : '',
            currency: asset.currency ?? 'USD',
            description: asset.description ?? '',
            localisation: asset.localisation ?? '',
            documents: Array.isArray(asset.documents)
              ? asset.documents.map((d) => (typeof d === 'string' ? d : JSON.stringify(d))).join('\n')
              : '',
          }
        : EMPTY,
    );
  }, [open, asset]);

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (revalidationWarning && !acknowledged) return;
    onSubmit({
      name: form.name.trim(),
      type: form.type,
      value: form.value,
      currency: form.currency,
      description: form.description.trim(),
      localisation: form.localisation.trim(),
      documents: form.documents
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    });
  };

  const categoryHint = ASSET_CATEGORIES[form.type]?.guaranteeHint;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier l'actif" : 'Déclarer un nouvel actif'}</DialogTitle>
          <DialogDescription>
            Vous déclarez un bien. Un agent de terrain le vérifiera et fixera lui-même sa valeur
            retenue — c'est cette valeur, et elle seule, qui pourra couvrir un crédit.
          </DialogDescription>
        </DialogHeader>

        {revalidationWarning && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
            <p className="text-sm text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Cet actif {asset?.status === 'libere' ? 'a été vérifié puis libéré' : 'est déjà vérifié'} et
                porte une <strong>valeur retenue certifiée par un agent</strong>. Si vous
                l'enregistrez modifié, il repassera en file de vérification, cette valeur sera
                effacée, et il ne pourra plus servir de garantie tant qu'un agent ne l'aura pas
                revu.
              </span>
            </p>
            <label className="flex items-center gap-2 text-xs text-amber-100 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="accent-amber-400"
              />
              J'ai compris et je souhaite modifier cet actif.
            </label>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="asset-name">Désignation de l'actif</Label>
            <Input
              id="asset-name"
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
              placeholder="Ex. Tracteur Kubota L3408, 2019"
              className="bg-slate-900/50 border-slate-700"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="asset-type">Catégorie</Label>
              <Select value={form.type} onValueChange={set('type')}>
                <SelectTrigger id="asset-type" className="bg-slate-900/50 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CATEGORY_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {ASSET_CATEGORIES[code].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                {categoryHint
                  ? `Une fois vérifié, cet actif pourra servir de garantie « ${categoryHint} ».`
                  : "La catégorie « Autre » n'est jamais gageable."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset-currency">Devise</Label>
              <Select value={form.currency} onValueChange={set('currency')}>
                <SelectTrigger id="asset-currency" className="bg-slate-900/50 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="CDF">CDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-value">Valeur déclarée</Label>
            <Input
              id="asset-value"
              type="number"
              min="0"
              step="0.01"
              value={form.value}
              onChange={(e) => set('value')(e.target.value)}
              className="bg-slate-900/50 border-slate-700"
              required
            />
            <p className="text-xs text-gray-500 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              Votre estimation. L'agent constatera la valeur sur le terrain ; AGRICAP applique
              ensuite une décote pour obtenir la valeur retenue. Vous ne pouvez fixer ni l'une ni
              l'autre.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-localisation">Localisation</Label>
            <Input
              id="asset-localisation"
              value={form.localisation}
              onChange={(e) => set('localisation')(e.target.value)}
              placeholder="Ex. Kabare, Sud-Kivu — parcelle n° 14"
              className="bg-slate-900/50 border-slate-700"
            />
            <p className="text-xs text-gray-500">
              Aide l'agent à retrouver le bien lors de la vérification.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-description">Description et état</Label>
            <Textarea
              id="asset-description"
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
              placeholder="Année, numéro de série, état général, usage actuel…"
              className="bg-slate-900/50 border-slate-700"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="asset-documents">Références des preuves de propriété</Label>
            <Textarea
              id="asset-documents"
              value={form.documents}
              onChange={(e) => set('documents')(e.target.value)}
              placeholder={'Une référence par ligne\nEx. Titre foncier n° 2019/SK/0431\nEx. Facture ETS BUKAVU MOTORS n° 8871'}
              className="bg-slate-900/50 border-slate-700 font-mono text-xs"
              rows={3}
            />
            <p className="text-xs text-gray-500">
              Saisissez les références des pièces (titre, facture, carte grise). Le dépôt des
              fichiers se fait auprès de votre agence lors de la vérification : aucun envoi de
              document n'est encore possible depuis cet écran.
            </p>
          </div>

          <DialogFooter className="mt-6 gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={submitting || (revalidationWarning && !acknowledged)}
              className="bg-gradient-to-r from-emerald-500 to-blue-600"
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              {isEdit ? 'Enregistrer les modifications' : "Déclarer l'actif"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AssetFormDialog;

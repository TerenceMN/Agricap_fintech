/**
 * Éditeur de rôle — partagé par les DEUX écrans qui parlent de rôles.
 *
 * Il vivait dans `pages/Roles.jsx`, donc l'onglet « Rôles & Permissions » de la
 * page Utilisateurs ne pouvait rien modifier : il affichait la matrice sans
 * aucun moyen d'agir, alors que son nom promet le contraire.
 *
 * Extrait plutôt que recopié : deux formulaires qui décident des mêmes pouvoirs
 * divergent tôt ou tard, et c'est la matrice de capacités — qui approuve, qui
 * décaisse — qu'on ne peut pas se permettre de voir diverger (principe 6).
 */
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export const CAPABILITIES = [
  { key: 'read', label: 'Lecture' },
  { key: 'create', label: 'Création' },
  { key: 'validate', label: 'Validation' },
  { key: 'disburse', label: 'Décaissement' },
  { key: 'audit', label: 'Audit' },
  { key: 'config', label: 'Paramétrage' },
];

export const emptyForm = {
  id: '', label: '', level: 0, type: 'Gestion',
  permissions: { read: true, create: false, validate: false, disburse: false, audit: false, config: false },
};

const RoleFormModal = ({ isOpen, onClose, role, onSave }) => {
  const [formData, setFormData] = useState(emptyForm);

  useEffect(() => {
    setFormData(role
      ? { id: role.id, label: role.label, level: role.level, type: role.type, permissions: { ...role.permissions } }
      : emptyForm);
  }, [role, isOpen]);

  const togglePermission = (key) =>
    setFormData(f => ({ ...f, permissions: { ...f.permissions, [key]: !f.permissions[key] } }));

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="glass-effect text-white sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{role ? `Modifier ${role.label}` : 'Nouveau Rôle Personnalisé'}</DialogTitle>
          <DialogDescription>
            {role
              ? "Les nouvelles capacités de ce rôle sont effectives immédiatement pour tous les utilisateurs qui le portent."
              : "Créer un rôle personnalisé en plus des 16 rôles standards."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {!role && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Identifiant</Label>
              <Input
                value={formData.id} onChange={e => setFormData({ ...formData, id: e.target.value.trim() })}
                placeholder="ex: gest_zone_est" className="col-span-3 bg-slate-900 border-slate-700"
              />
            </div>
          )}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Libellé</Label>
            <Input
              value={formData.label} onChange={e => setFormData({ ...formData, label: e.target.value })}
              className="col-span-3 bg-slate-900 border-slate-700"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Niveau</Label>
            <Input
              type="number" value={formData.level}
              onChange={e => setFormData({ ...formData, level: Number(e.target.value) })}
              className="col-span-3 bg-slate-900 border-slate-700"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Type</Label>
            <Input
              value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })}
              className="col-span-3 bg-slate-900 border-slate-700"
            />
          </div>
          <div className="grid grid-cols-4 gap-4">
            <Label className="text-right pt-1">Capacités</Label>
            <div className="col-span-3 grid grid-cols-2 gap-2">
              {CAPABILITIES.map(cap => (
                <label key={cap.key} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <Checkbox
                    checked={!!formData.permissions[cap.key]}
                    onCheckedChange={() => togglePermission(cap.key)}
                  />
                  {cap.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={() => onSave(formData)} className="bg-emerald-600 hover:bg-emerald-700">
            {role ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RoleFormModal;

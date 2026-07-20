import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { api, ApiError } from '@/services/api';

const CAPABILITIES = [
  { key: 'read', label: 'Lecture' },
  { key: 'create', label: 'Création' },
  { key: 'validate', label: 'Validation' },
  { key: 'disburse', label: 'Décaissement' },
  { key: 'audit', label: 'Audit' },
  { key: 'config', label: 'Paramétrage' },
];

const emptyForm = {
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

const Roles = () => {
  const { toast } = useToast();
  const [rolesData, setRolesData] = useState([]);
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(null);

  const loadRoles = () => api.rbac.roles().then(setRolesData).catch(() => {});
  useEffect(() => { loadRoles(); }, []);

  const handleSave = async (formData) => {
    try {
      if (editingRole) {
        await api.rbac.updateRole(editingRole.id, {
          label: formData.label, level: formData.level, type: formData.type, permissions: formData.permissions,
        });
        toast({ title: "Rôle mis à jour", description: `${formData.label} : les nouvelles capacités sont effectives immédiatement.` });
      } else {
        if (!formData.id) {
          toast({ variant: 'destructive', title: "Identifiant requis" });
          return;
        }
        await api.rbac.createRole({
          id: formData.id, label: formData.label || formData.id, level: formData.level, type: formData.type,
          permissions: formData.permissions,
        });
        toast({ title: "Rôle créé", description: `${formData.label || formData.id} est disponible pour affectation.` });
      }
      setModalOpen(false); setEditingRole(null);
      loadRoles();
    } catch (e) {
      toast({ variant: 'destructive', title: "Échec", description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  return (
    <Layout>
      <Helmet>
        <title>Rôles & Accès - AGRICAP FINTECH</title>
        <meta name="description" content="Gestion des rôles et des permissions de la plateforme." />
      </Helmet>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-4xl font-bold gradient-text">Rôles & Accès</h1>
            <p className="text-gray-400">Configuration des profils et des droits d'accès sur la plateforme.</p>
          </div>
          <Button
            className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
            onClick={() => { setEditingRole(null); setModalOpen(true); }}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Nouveau Rôle
          </Button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-effect p-6 rounded-2xl"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom du Rôle</TableHead>
              <TableHead>Niveau</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Capacités</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rolesData.map((role) => (
              <TableRow key={role.id} className="border-slate-800">
                <TableCell>
                  <Badge variant="outline" className="text-white border-slate-600 font-mono text-sm">{role.label}</Badge>
                  {role.isCustom && <Badge className="ml-2 bg-blue-500/20 text-blue-400 border-0">Personnalisé</Badge>}
                  {role.isOverridden && <Badge className="ml-2 bg-amber-500/20 text-amber-400 border-0">Modifié</Badge>}
                </TableCell>
                <TableCell className="text-gray-300">Niv. {role.level}</TableCell>
                <TableCell className="text-gray-300">{role.type}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {CAPABILITIES.filter(c => role.permissions[c.key]).map(c => (
                      <Badge key={c.key} variant="secondary" className="text-[10px]">{c.label}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" onClick={() => { setEditingRole(role); setModalOpen(true); }}>
                    Modifier
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </motion.div>

      <RoleFormModal
        isOpen={isModalOpen}
        onClose={() => { setModalOpen(false); setEditingRole(null); }}
        role={editingRole}
        onSave={handleSave}
      />
    </Layout>
  );
};

export default Roles;

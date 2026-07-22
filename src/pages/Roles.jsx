import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { Badge } from '@/components/ui/badge';
import { api, ApiError } from '@/services/api';
import RoleFormModal, { CAPABILITIES } from '@/components/rbac/RoleFormModal';

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

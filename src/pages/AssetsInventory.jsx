import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion, AnimatePresence } from 'framer-motion';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, Info, Package, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '@/services/api';
import AssetCard from '@/components/assets/AssetCard';
import AssetFormDialog from '@/components/assets/AssetFormDialog';
import { ASSET_STATUSES, ASSET_STATUS_ORDER, assetStatus } from '@/components/assets/assetMeta';
import { guaranteeErrorMessage } from '@/components/guarantees/guaranteeErrors';
import { formatMontant } from '@/components/guarantees/format';

/**
 * Registre des actifs gageables du client — branché sur `/api/assets/mine`.
 *
 * Cet écran lisait auparavant `localStorage.agricap_assets` : un actif
 * n'existait que dans le navigateur de celui qui le déclarait, et son statut
 * était écrit côté client. Principe 9 (« toute garantie est opposable ou
 * n'est pas ») : l'actif vit désormais en base, son statut et sa valeur
 * retenue sont écrits par le serveur, jamais d'ici.
 *
 * Cycle de vie affiché : declare → verifie → gage → libere, plus rejete.
 */

/** Étapes du cycle de vie, telles que présentées au client. */
const LIFECYCLE_STEPS = [
  { code: 'declare', text: 'Vous déclarez le bien' },
  { code: 'verifie', text: 'Un agent le vérifie et fixe sa valeur retenue' },
  { code: 'gage', text: 'Il est nanti sur un crédit' },
  { code: 'libere', text: 'Le crédit soldé, le gage est levé' },
];

const AssetsInventory = () => {
  const { toast } = useToast();

  const [assets, setAssets] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('tous');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.assets.mine();
      setAssets(Array.isArray(res?.items) ? res.items : []);
      setTotalRows(Number(res?.total_rows ?? 0));
    } catch (e) {
      setAssets([]);
      setTotalRows(0);
      setLoadError(guaranteeErrorMessage(e, "Impossible de charger votre inventaire d'actifs."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  /** Répartition par statut — comptage d'affichage, aucun chiffre métier. */
  const countsByStatus = useMemo(() => {
    const counts = {};
    for (const code of ASSET_STATUS_ORDER) counts[code] = 0;
    for (const a of assets) {
      if (counts[a.status] === undefined) counts[a.status] = 0;
      counts[a.status] += 1;
    }
    return counts;
  }, [assets]);

  const visibleAssets = useMemo(
    () => (statusFilter === 'tous' ? assets : assets.filter((a) => a.status === statusFilter)),
    [assets, statusFilter],
  );

  const pledgeableCount = useMemo(
    () => assets.filter((a) => a.isPledgeable).length,
    [assets],
  );

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (asset) => {
    if (!assetStatus(asset.status).writable) {
      toast({ variant: 'destructive', title: 'Actif verrouillé', description: assetStatus(asset.status).help });
      return;
    }
    setEditing(asset);
    setFormOpen(true);
  };

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      if (editing) {
        const updated = await api.assets.update(editing.id, payload);
        setAssets((prev) => prev.map((a) => (a.id === editing.id ? updated : a)));
        toast({
          title: 'Actif mis à jour',
          description:
            updated.status === 'declare'
              ? "L'actif repasse en file de vérification : un agent doit le revoir avant qu'il puisse garantir un crédit."
              : 'Les modifications ont été enregistrées.',
        });
      } else {
        const created = await api.assets.create(payload);
        setAssets((prev) => [created, ...prev]);
        setTotalRows((n) => n + 1);
        toast({
          title: 'Actif déclaré',
          description: "Il est en attente de vérification par un agent de terrain.",
        });
      }
      setFormOpen(false);
      setEditing(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Enregistrement refusé', description: guaranteeErrorMessage(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.assets.remove(pendingDelete.id);
      setAssets((prev) => prev.filter((a) => a.id !== pendingDelete.id));
      setTotalRows((n) => Math.max(0, n - 1));
      toast({ title: 'Actif supprimé', description: "L'actif a été retiré de votre inventaire." });
      setPendingDelete(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Suppression refusée', description: guaranteeErrorMessage(e) });
    } finally {
      setDeleting(false);
    }
  };

  const filterChips = [
    { code: 'tous', label: 'Tous', count: assets.length },
    ...ASSET_STATUS_ORDER.map((code) => ({
      code,
      label: ASSET_STATUSES[code].label,
      count: countsByStatus[code] || 0,
    })),
  ];

  return (
    <Layout>
      <Helmet><title>Mes Actifs - AGRICAP FINTECH</title></Helmet>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold gradient-text mb-2">Inventaire des Actifs</h1>
          <p className="text-gray-400 max-w-2xl">
            Déclarez vos biens pour qu'ils puissent garantir vos crédits. Un actif ne devient une
            garantie qu'une fois <strong className="text-white">vérifié par un agent AGRICAP</strong>.
          </p>
        </motion.div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-white/20 hover:bg-white/10" onClick={loadAssets} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Actualiser
          </Button>
          <Button onClick={openCreate} className="bg-gradient-to-r from-emerald-500 to-blue-600">
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Déclarer un actif
          </Button>
        </div>
      </div>

      {/* Cycle de vie — le client doit savoir où s'arrête son pouvoir */}
      <div className="glass-effect rounded-xl p-4 mb-6">
        <p className="text-xs uppercase tracking-wide text-gray-500 mb-3">
          Cycle de vie d'un actif
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          {LIFECYCLE_STEPS.map((step, i) => {
            const meta = ASSET_STATUSES[step.code];
            return (
              <React.Fragment key={step.code}>
                <div className={`px-3 py-2 rounded-lg border text-xs ${meta.badge}`}>
                  <span className="font-semibold">{meta.label}</span>
                  <span className="block text-[11px] opacity-80">{step.text}</span>
                </div>
                {i < LIFECYCLE_STEPS.length - 1 && (
                  <span className="text-gray-600" aria-hidden="true">→</span>
                )}
              </React.Fragment>
            );
          })}
          <div className={`px-3 py-2 rounded-lg border text-xs ${ASSET_STATUSES.rejete.badge}`}>
            <span className="font-semibold">Rejeté</span>
            <span className="block text-[11px] opacity-80">La vérification n'a pas abouti</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          Vous déclarez la <strong className="text-gray-300">valeur déclarée</strong> ; l'agent
          arrête la <strong className="text-emerald-300">valeur retenue</strong> après décote.
          Seule la valeur retenue couvre un crédit. Ni le statut ni la valeur retenue ne peuvent
          être modifiés depuis cet écran.
        </p>
      </div>

      {/* Filtres par statut */}
      {!loading && !loadError && assets.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {filterChips.map((chip) => (
            <button
              key={chip.code}
              type="button"
              onClick={() => setStatusFilter(chip.code)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === chip.code
                  ? 'bg-white/15 border-white/30 text-white'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
              }`}
            >
              {chip.label} <span className="opacity-60">({chip.count})</span>
            </button>
          ))}
          <span className="ml-auto self-center text-xs text-gray-500">
            {totalRows} actif{totalRows > 1 ? 's' : ''} au registre ·{' '}
            <span className="text-emerald-300">{pledgeableCount} mobilisable{pledgeableCount > 1 ? 's' : ''}</span>
          </span>
        </div>
      )}

      {/* État de chargement */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-effect rounded-xl p-6 space-y-4">
              <Skeleton className="h-12 w-12 rounded-xl" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* État d'erreur */}
      {!loading && loadError && (
        <div className="glass-effect rounded-xl border border-red-500/30 p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" aria-hidden="true" />
          <h3 className="text-lg font-bold text-white">Inventaire indisponible</h3>
          <p className="text-sm text-gray-400 mt-2 max-w-lg mx-auto">{loadError}</p>
          <Button className="mt-4" variant="outline" onClick={loadAssets}>
            <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" /> Réessayer
          </Button>
        </div>
      )}

      {/* Liste */}
      {!loading && !loadError && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {visibleAssets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onEdit={openEdit}
                onDelete={setPendingDelete}
              />
            ))}
          </AnimatePresence>

          {assets.length === 0 && (
            <div className="col-span-full text-center py-12 glass-effect rounded-xl border-dashed border-2 border-white/10">
              <Package className="w-12 h-12 text-gray-600 mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-xl font-bold text-gray-300">Aucun actif enregistré</h3>
              <p className="text-gray-500 mt-2 max-w-md mx-auto">
                Déclarez un équipement, un terrain, un véhicule ou un stock. Il devra être vérifié
                par un agent avant de pouvoir garantir un crédit.
              </p>
              <Button onClick={openCreate} className="mt-4 bg-gradient-to-r from-emerald-500 to-blue-600">
                <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Déclarer mon premier actif
              </Button>
            </div>
          )}

          {assets.length > 0 && visibleAssets.length === 0 && (
            <div className="col-span-full text-center py-10 glass-effect rounded-xl border-dashed border-2 border-white/10">
              <ShieldCheck className="w-10 h-10 text-gray-600 mx-auto mb-3" aria-hidden="true" />
              <p className="text-gray-400">
                Aucun actif au statut « {ASSET_STATUSES[statusFilter]?.label || statusFilter} ».
              </p>
              <Button variant="ghost" className="mt-2" onClick={() => setStatusFilter('tous')}>
                Voir tous les actifs
              </Button>
            </div>
          )}
        </div>
      )}

      <AssetFormDialog
        open={formOpen}
        asset={editing}
        submitting={submitting}
        onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}
        onSubmit={handleSubmit}
      />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="glass-effect text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet actif ?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              {pendingDelete && (
                <>
                  « {pendingDelete.name} » ({formatMontant(pendingDelete.value, pendingDelete.currency)}{' '}
                  déclarés) sera retiré de votre registre. Cette action est définitive et l'actif
                  devra être redéclaré puis vérifié à nouveau pour servir de garantie.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent border-white/20 hover:bg-white/10">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Suppression…' : 'Supprimer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
};

export default AssetsInventory;

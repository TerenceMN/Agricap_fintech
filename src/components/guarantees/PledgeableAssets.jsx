import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Check, Loader2, PackageSearch, RefreshCw } from 'lucide-react';
import { formatMontant } from './format';
import { guaranteeConfig } from './guaranteeConfig';
import { assetCategory } from '@/components/assets/assetMeta';

/**
 * « Mes actifs mobilisables » — alimenté par
 * `GET /api/assets/mine?pledgeable=true`, jamais par `localStorage`.
 *
 * Le backend décide de la mobilisabilité (`Asset.is_pledgeable` : vérifié ou
 * libéré, libre de gage, valeur retenue > 0). Le front n'en déduit rien : il
 * affiche la liste telle qu'elle vient.
 *
 * @param {{assets: Array, loading: boolean, error: string|null, pledgingId: number|null,
 *          pledgedAssetIds: Array<number>, onRetry: Function, onPledge: Function,
 *          disabled: boolean, disabledReason: string}} props
 */
const PledgeableAssets = ({
  assets, loading, error, pledgingId, pledgedAssetIds = [],
  onRetry, onPledge, disabled = false, disabledReason = '',
}) => {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-xl border border-red-500/30 bg-red-500/5 text-center">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-gray-300">{error}</p>
        <Button variant="outline" size="sm" className="mt-3 border-white/20" onClick={onRetry}>
          <RefreshCw className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Réessayer
        </Button>
      </div>
    );
  }

  // Encart explicite : aucun actif mobilisable ⇒ ce type de garantie est
  // simplement indisponible pour ce client, et on lui dit pourquoi.
  if (!assets.length) {
    return (
      <div className="p-6 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <PackageSearch className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-2">
            <p className="font-semibold text-amber-200">Aucun actif mobilisable</p>
            <p className="text-sm text-gray-300 leading-relaxed">
              Vous ne pouvez pas choisir de garantie sur actif pour l'instant. Déclarez un actif
              dans <strong>Mes Actifs</strong> : il devra être{' '}
              <strong>vérifié par un agent</strong> et recevoir une valeur retenue avant de pouvoir
              servir de garantie. Un actif déjà nanti sur un autre crédit n'est pas mobilisable non
              plus.
            </p>
            <Button asChild variant="outline" size="sm" className="border-amber-500/40 hover:bg-amber-500/10">
              <Link to="/assets">Aller à Mes Actifs</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {assets.map((asset) => {
        const category = assetCategory(asset.type);
        const cfg = guaranteeConfig(asset.guaranteeType || asset.type);
        const CategoryIcon = category.icon;
        const alreadyPledged = pledgedAssetIds.includes(asset.id);
        const busy = pledgingId === asset.id;

        return (
          <div
            key={asset.id}
            className={`p-4 rounded-xl border transition-all ${
              alreadyPledged
                ? 'bg-emerald-500/10 border-emerald-500/40'
                : 'bg-white/5 border-white/10'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${category.bg} shrink-0`}>
                <CategoryIcon className={`w-5 h-5 ${category.color}`} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{asset.name}</p>
                <p className="text-xs text-gray-500">
                  {category.label} · garantie « {cfg.label} »
                </p>
              </div>
              {alreadyPledged && (
                <Check className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden="true" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="bg-black/20 rounded-lg p-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Déclarée</p>
                <p className="text-sm text-gray-300">{formatMontant(asset.value, asset.currency)}</p>
              </div>
              <div className="bg-emerald-500/10 rounded-lg p-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Retenue</p>
                <p className="text-sm font-bold text-emerald-300">
                  {formatMontant(asset.valeurRetenue, asset.currency)}
                </p>
              </div>
            </div>

            <Button
              size="sm"
              className="w-full mt-3 bg-blue-600/80 hover:bg-blue-600 disabled:opacity-40"
              onClick={() => onPledge(asset)}
              disabled={alreadyPledged || busy || disabled}
              title={disabled ? disabledReason : undefined}
            >
              {busy && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" aria-hidden="true" />}
              {alreadyPledged ? 'Proposé au dossier' : 'Mobiliser en garantie'}
            </Button>
          </div>
        );
      })}
    </div>
  );
};

export default PledgeableAssets;

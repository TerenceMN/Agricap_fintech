import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Edit2, Lock, MapPin, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { assetCategory, assetStatus } from './assetMeta';
import { formatDateFr, formatMontant } from '@/components/guarantees/format';

/**
 * Carte d'un actif du registre.
 *
 * Deux valeurs, jamais confondues :
 *  - **valeur déclarée** (`value`) : ce que le client annonce ;
 *  - **valeur retenue** (`valeurRetenue`) : ce que l'agent arrête après décote,
 *    calculée par le serveur — seule elle couvre un crédit.
 *
 * @param {{asset: import('@/types/api').AssetRow, onEdit: Function, onDelete: Function}} props
 */
const AssetCard = ({ asset, onEdit, onDelete }) => {
  const category = assetCategory(asset.type);
  const status = assetStatus(asset.status);
  const Icon = category.icon;
  const locked = !status.writable;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      layout
    >
      <Card className={`glass-effect border-l-4 ${status.accent} h-full flex flex-col`}>
        <CardHeader className="pb-3">
          <div className="flex justify-between items-start gap-2">
            <div className={`p-3 rounded-xl ${category.bg}`}>
              <Icon className={`w-6 h-6 ${category.color}`} aria-hidden="true" />
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-1 rounded-full border text-[11px] font-semibold flex items-center gap-1.5 ${status.badge}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
                {status.label}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-white disabled:opacity-30"
                onClick={() => onEdit(asset)}
                disabled={locked}
                aria-label={`Modifier ${asset.name}`}
                title={locked ? status.help : 'Modifier cet actif'}
              >
                {locked ? <Lock className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30"
                onClick={() => onDelete(asset)}
                disabled={!status.deletable}
                aria-label={`Supprimer ${asset.name}`}
                title={status.deletable ? 'Supprimer cet actif' : status.help}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <CardTitle className="mt-4 text-white text-lg leading-snug">{asset.name}</CardTitle>
          <p className="text-xs text-gray-500">
            {category.label} · réf. #{asset.id}
          </p>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/5 p-3 rounded-lg">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Valeur déclarée</p>
              <p className="font-semibold text-gray-200 mt-1 break-words">
                {formatMontant(asset.value, asset.currency)}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">saisie par vous</p>
            </div>
            <div
              className={`p-3 rounded-lg ${
                asset.valeurRetenue != null ? 'bg-emerald-500/10' : 'bg-white/5'
              }`}
            >
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Valeur retenue</p>
              <p
                className={`font-bold mt-1 break-words ${
                  asset.valeurRetenue != null ? 'text-emerald-300' : 'text-gray-500'
                }`}
              >
                {asset.valeurRetenue != null
                  ? formatMontant(asset.valeurRetenue, asset.currency)
                  : 'Non fixée'}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                {asset.valeurRetenue != null
                  ? `fixée par l'agent le ${formatDateFr(asset.verifieLe)}`
                  : "fixée par l'agent après vérification"}
              </p>
            </div>
          </div>

          <p className="text-xs text-gray-500 leading-relaxed">
            Seule la <span className="text-emerald-300 font-medium">valeur retenue</span>, arrêtée
            par l'agent après décote, entre dans la couverture d'un crédit — jamais la valeur que
            vous déclarez.
          </p>

          {asset.status === 'rejete' && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-xs font-semibold text-red-300 flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5" aria-hidden="true" /> Motif du rejet
              </p>
              <p className="text-sm text-red-200/90 mt-1">
                {asset.motifRejet || 'Motif non communiqué par l’agent vérificateur.'}
              </p>
            </div>
          )}

          {asset.status === 'gage' && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
              <p className="text-xs text-orange-200 flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{status.help}</span>
              </p>
            </div>
          )}

          {asset.description && (
            <p className="text-sm text-gray-400 line-clamp-3">{asset.description}</p>
          )}

          <div className="mt-auto pt-3 border-t border-white/5 flex justify-between items-center text-xs text-gray-500 gap-2">
            <span className="flex items-center gap-1 truncate">
              {asset.localisation ? (
                <>
                  <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{asset.localisation}</span>
                </>
              ) : (
                <span className="italic">Localisation non renseignée</span>
              )}
            </span>
            <span className="shrink-0">Déclaré le {formatDateFr(asset.createdAt)}</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default AssetCard;

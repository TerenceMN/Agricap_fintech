import React from 'react';
import { Info, ShieldCheck } from 'lucide-react';
import { formatDateFr, formatMontant, formatRatio } from './format';
import { guaranteeConfig } from './guaranteeConfig';

const GUARANTEE_STATUS_LABELS = {
  pending: { label: 'En attente de confirmation', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  active: { label: 'Constituée', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  released: { label: 'Libérée', className: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  expired: { label: 'Expirée', className: 'bg-red-500/15 text-red-300 border-red-500/30' },
};

/**
 * Synthèse de couverture d'un dossier — restitution stricte de l'objet
 * `coverage` renvoyé par `GET /credits/applications/<code>/guarantees/`.
 *
 * Rien n'est recalculé ici : `retainedTotal`, `ratio` et `activeCount` sont
 * arrêtés côté serveur sur les **valeurs retenues après décote** des seules
 * garanties constituées. Une garantie en attente de confirmation ne couvre rien.
 *
 * @param {{guaranteeSet: object|null}} props
 */
const GuaranteeCoverage = ({ guaranteeSet }) => {
  const coverage = guaranteeSet?.coverage;
  const items = Array.isArray(guaranteeSet?.items) ? guaranteeSet.items : [];

  if (!guaranteeSet) return null;

  return (
    <div className="glass-effect rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h4 className="font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
          Couverture du dossier
        </h4>
        <span className="text-xs text-gray-500">
          {guaranteeSet.count ?? items.length} garantie
          {(guaranteeSet.count ?? items.length) > 1 ? 's' : ''} au dossier
        </span>
      </div>

      {coverage ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white/5 p-3 rounded-lg">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Total retenu</p>
              <p className="text-lg font-bold text-emerald-300 mt-1">
                {formatMontant(coverage.retainedTotal, coverage.currency)}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                {coverage.activeCount} garantie{coverage.activeCount > 1 ? 's' : ''} constituée
                {coverage.activeCount > 1 ? 's' : ''}
              </p>
            </div>
            <div className="bg-white/5 p-3 rounded-lg">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Montant demandé</p>
              <p className="text-lg font-bold text-white mt-1">
                {formatMontant(coverage.requestedAmount, coverage.currency)}
              </p>
            </div>
            <div className="bg-white/5 p-3 rounded-lg">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Ratio de couverture</p>
              <p className="text-lg font-bold text-white mt-1">{formatRatio(coverage.ratio)}</p>
              <p className="text-[11px] text-gray-500 mt-1">calculé par AGRICAP</p>
            </div>
          </div>
          <p className="text-xs text-gray-500 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            Ce ratio est calculé sur les <strong className="text-gray-300">valeurs retenues après
            décote</strong> des garanties déjà constituées — jamais sur les valeurs que vous avez
            déclarées. Une garantie en attente de confirmation par un agent ne compte pas encore.
          </p>
        </>
      ) : (
        <p className="text-sm text-gray-500">
          La couverture sera calculée par AGRICAP dès qu'une garantie sera constituée.
        </p>
      )}

      {items.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-white/5">
          {items.map((g) => {
            const cfg = guaranteeConfig(g.type);
            const Icon = cfg.icon;
            const statusMeta = GUARANTEE_STATUS_LABELS[g.status] || {
              label: g.status,
              className: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
            };
            return (
              <div key={g.id} className="bg-white/5 p-3 rounded-lg flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${cfg.color}20` }}
                >
                  <Icon className="w-4 h-4" style={{ color: cfg.color }} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm text-white">{cfg.label}</p>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${statusMeta.className}`}>
                      {statusMeta.label}
                    </span>
                  </div>
                  {g.asset && (
                    <p className="text-xs text-gray-400 mt-1">
                      {g.asset.name} — retenu{' '}
                      <span className="text-emerald-300">
                        {formatMontant(g.asset.retainedValue, g.asset.currency)}
                      </span>{' '}
                      <span className="text-gray-600">
                        (déclaré {formatMontant(g.asset.declaredValue, g.asset.currency)})
                      </span>
                    </p>
                  )}
                  {g.type === 'epargne' && g.holdAmount != null && (
                    <p className="text-xs text-gray-400 mt-1">
                      {formatMontant(g.holdAmount, g.holdCurrency)} bloqués sur votre épargne
                    </p>
                  )}
                  {g.type === 'morale' && (
                    <p className="text-xs text-gray-400 mt-1">
                      Garant : {g.guarantorName || '—'}
                      {g.expiresAt && g.status === 'pending'
                        ? ` — à confirmer avant le ${formatDateFr(g.expiresAt)}`
                        : ''}
                    </p>
                  )}
                  {g.status === 'pending' && (
                    <p className="text-[11px] text-amber-300/80 mt-1">
                      Ne couvre rien tant qu'un agent AGRICAP ne l'a pas confirmée.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GuaranteeCoverage;

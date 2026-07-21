/**
 * Chaîne de valeur d'un actif : déclarée → constatée → retenue.
 *
 * Principe 9 — « la couverture est calculée sur la valeur retenue après décote,
 * jamais sur la valeur déclarée ». L'agent doit donc voir les trois montants
 * ensemble, et l'abattement qui les sépare : c'est la seule façon de vérifier
 * qu'il a bien fixé une valeur opposable et non recopié la déclaration.
 *
 * Ce que ce composant ne fait PAS, et pourquoi :
 *   - il ne calcule aucune valeur retenue. `assets/services.py::valeur_apres_decote`
 *     applique `InstitutionConfig.decote_garantie` côté serveur ; **le taux n'est
 *     exposé par aucun endpoint** (`GET /api/referentiel/config` sert les seuils
 *     et pondérations, pas `decote_garantie`). Le front ne peut donc pas
 *     prévisualiser la valeur retenue, et il ne code surtout pas 30 % en dur.
 *   - la décote affichée après enregistrement est **constatée, pas postulée** :
 *     c'est l'écart entre la valeur constatée envoyée et la valeur retenue
 *     renvoyée par le serveur. On restitue un fait serveur, on n'applique pas une
 *     règle métier côté client. L'étiquette le dit à l'écran.
 */
import React from 'react';
import { fmtAmount } from '@/pages/credit/wire';

interface Props {
  currency: string;
  /** `value` — saisie par le client, jamais opposable. */
  declaredValue: number;
  /** `valeur_verifiee` envoyée par l'agent ; `null` tant qu'il n'a rien saisi. */
  observedValue: number | null;
  /** `valeurRetenue` renvoyée par le serveur ; `null` avant enregistrement. */
  retainedValue: number | null;
  /** `isPledgeable` servi par le serveur — jamais déduit ici. */
  isPledgeable?: boolean;
  /** Rend l'attente explicite tant que le serveur n'a pas tranché. */
  pendingLabel?: string;
}

const Row: React.FC<{
  label: string;
  hint: string;
  value: string;
  tone?: 'muted' | 'normal' | 'strong';
}> = ({ label, hint, value, tone = 'normal' }) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5">
    <div className="min-w-0">
      <p className={`text-sm ${tone === 'strong' ? 'text-white font-semibold' : 'text-slate-300'}`}>
        {label}
      </p>
      <p className="text-[11px] text-slate-500 leading-snug">{hint}</p>
    </div>
    <p
      className={`shrink-0 tabular-nums ${
        tone === 'strong'
          ? 'text-emerald-300 text-lg font-bold'
          : tone === 'muted'
            ? 'text-slate-400 text-sm'
            : 'text-white text-sm font-medium'
      }`}
    >
      {value}
    </p>
  </div>
);

const RetainedValueBreakdown: React.FC<Props> = ({
  currency, declaredValue, observedValue, retainedValue, isPledgeable, pendingLabel,
}) => {
  // Abattement CONSTATÉ : différence de deux montants connus du serveur.
  const abattement =
    observedValue != null && retainedValue != null && observedValue > 0
      ? observedValue - retainedValue
      : null;
  const tauxConstate =
    abattement != null && observedValue != null && observedValue > 0
      ? (abattement / observedValue) * 100
      : null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 divide-y divide-white/5">
      <Row
        label="Valeur déclarée par le client"
        hint="Déclarative — n'entre jamais dans la couverture d'un crédit."
        value={fmtAmount(declaredValue, currency)}
        tone="muted"
      />
      <Row
        label="Valeur constatée par l'agent"
        hint="Ce que vous avez vu sur place. C'est la seule valeur que vous saisissez."
        value={observedValue != null ? fmtAmount(observedValue, currency) : '—'}
      />
      <div className="py-1.5">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-slate-300">Décote institutionnelle appliquée</p>
            <p className="text-[11px] text-slate-500 leading-snug">
              Appliquée par le serveur (<code className="font-mono">InstitutionConfig.decote_garantie</code>).
              Le taux n'est pas exposé par l'API : la valeur ci-contre est l'écart
              constaté entre la valeur constatée et la valeur retenue, pas un taux
              recopié côté écran.
            </p>
          </div>
          <p className="shrink-0 tabular-nums text-amber-300 text-sm font-medium">
            {abattement != null
              ? `− ${fmtAmount(abattement, currency)}`
              : '—'}
            {tauxConstate != null && (
              <span className="block text-[11px] text-amber-300/70 text-right">
                soit {tauxConstate.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %
              </span>
            )}
          </p>
        </div>
      </div>
      <Row
        label="Valeur retenue — opposable"
        hint="Fixée par le serveur. C'est elle, et elle seule, qui couvre un crédit."
        value={
          retainedValue != null
            ? fmtAmount(retainedValue, currency)
            : (pendingLabel ?? '—')
        }
        tone="strong"
      />

      {retainedValue != null && (retainedValue <= 0 || isPledgeable === false) && (
        <p className="pt-2 text-xs text-red-300">
          <span className="font-semibold">Actif non gageable.</span> Le serveur ne
          le déclare pas mobilisable (<code className="font-mono">isPledgeable = false</code>) :
          sans valeur retenue strictement positive, aucune garantie ne peut être
          constituée dessus. Reprenez la vérification.
        </p>
      )}
      {retainedValue != null && retainedValue > 0 && isPledgeable === true && (
        <p className="pt-2 text-xs text-emerald-300">
          Actif mobilisable en garantie (<code className="font-mono">isPledgeable = true</code>),
          à hauteur de sa valeur retenue.
        </p>
      )}
    </div>
  );
};

export default RetainedValueBreakdown;

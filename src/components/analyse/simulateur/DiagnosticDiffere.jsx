import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

/**
 * Pourquoi le DSCR est ce qu'il est : le lien différé → concentration de
 * l'amortissement (SPEC §9.3).
 *
 * « Avec 5 mois de différé sur 8, tout le capital s'amortit sur 3 mois — c'est
 * précisément ce qui produit un DSCR de 0,64 dans le cas de référence. »
 * L'analyste doit comprendre POURQUOI le ratio est mauvais, pas seulement
 * constater qu'il l'est.
 *
 * Aucun DSCR n'est estimé ici. Le nombre de mois d'amortissement est LU dans
 * l'échéancier servi (comptage des lignes en phase d'amortissement) ; à défaut,
 * il est déduit des paramètres de l'analyse. Un comptage n'est pas un calcul
 * financier — il n'y a aucune formule d'intérêt dans ce fichier.
 */
const DiagnosticDiffere = ({ analyse }) => {
  if (!analyse) return null;

  const p = analyse.parametres || {};
  const lignes = analyse.echeancier || [];

  const amortissement = lignes.filter((l) => (l.phase || '').toLowerCase().startsWith('amort'));
  const duree = lignes.length || p.dureeMois || 0;
  const moisAmortissement = amortissement.length || (
    p.dureeMois !== undefined && p.differeMois !== undefined ? p.dureeMois - p.differeMois : 0
  );
  const differe = duree - moisAmortissement;

  if (!duree || moisAmortissement <= 0) {
    return (
      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 text-xs text-slate-400 flex gap-2">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Phases de l'échéancier indisponibles : le lien entre différé et concentration
          de l'amortissement ne peut pas être établi pour cette analyse.
        </span>
      </div>
    );
  }

  // Emphase purement visuelle : quand la phase d'amortissement occupe moins de la
  // moitié de la durée, le service de la dette est mécaniquement concentré. Ce
  // n'est pas un seuil métier (aucune décision n'en dépend, principe 8).
  const concentre = differe > 0 && moisAmortissement < duree / 2;

  return (
    <div className={`rounded-lg border p-3 text-xs flex gap-2 ${
      concentre
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        : 'border-slate-700/60 bg-slate-900/40 text-slate-300'
    }`}>
      {concentre ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
      <div className="space-y-1">
        <p>
          <strong>{differe} mois de différé sur {duree}</strong> : la totalité du capital
          s'amortit sur <strong>{moisAmortissement} mois</strong>. Chaque échéance de la
          phase d'amortissement porte donc {moisAmortissement > 0 ? `1/${moisAmortissement}` : '—'} du
          capital, et le service de la dette se concentre sur cette fenêtre.
        </p>
        <p className={concentre ? 'text-amber-300/80' : 'text-slate-500'}>
          C'est ce que le DSCR mesure : des flux de trésorerie annuels confrontés à un
          service de dette resserré donnent un ratio bas, même quand le taux est modéré.
          Raccourcir le différé étale l'amortissement — relancez une analyse pour voir
          de combien.
        </p>
        <p className="text-slate-500">
          Le moteur ne sert pas encore le diagnostic automatique « un différé de N mois
          porterait le DSCR à X » (SPEC §9.3, évolution prévue) : la seule façon de
          l'obtenir aujourd'hui est de relancer une analyse avec un autre différé.
        </p>
      </div>
    </div>
  );
};

export default DiagnosticDiffere;

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  formatRatio2, formatPourcent, ecartEntre, NULL_DISPLAY,
  RECOMMANDATION_LABEL, RECOMMANDATION_CLASS, MODE_DIFFERE_LABEL,
} from './format';

/**
 * Comparaison « avant / après » entre deux analyses du moteur.
 *
 * Ce que ça apporte : voir la NOUVELLE valeur ne dit rien à un analyste qui vient
 * de passer le différé de 5 à 3 mois. Voir la VARIATION le dit. Les deux valeurs
 * comparées viennent du serveur ; seule la soustraction est faite ici, et elle
 * n'est jamais persistée ni réutilisée comme donnée.
 */

/** Une métrique servie par le moteur, avec sa variation par rapport à la référence. */
const Metrique = ({ libelle, valeur, ecart, aide }) => {
  const Icone = !ecart || ecart.sens === 'stable' ? Minus : ecart.sens === 'hausse' ? TrendingUp : TrendingDown;
  // Sur DSCR et score, « plus haut » est meilleur : c'est le sens de lecture
  // retenu pour la couleur. La couleur ne porte aucun verdict — le verdict, c'est
  // la recommandation du moteur.
  const couleur = !ecart || ecart.sens === 'stable'
    ? 'text-slate-400'
    : ecart.sens === 'hausse' ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800">
      <p className="text-xs text-slate-400">{libelle}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className="text-xl font-bold text-white font-mono">{valeur}</p>
        {ecart && (
          <span className={`text-xs font-semibold flex items-center gap-1 ${couleur}`}>
            <Icone className="w-3 h-3" />{ecart.texte}
          </span>
        )}
      </div>
      {aide && <p className="text-[11px] text-slate-500 mt-1">{aide}</p>}
    </div>
  );
};

/** Un paramètre d'entrée, avec sa valeur d'origine quand elle a changé. */
const Parametre = ({ libelle, avant, apres }) => {
  const change = avant !== undefined && avant !== null && String(avant) !== String(apres);
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60 last:border-0">
      <span className="text-slate-400">{libelle}</span>
      <span className="font-mono flex items-center gap-2">
        {change && <span className="text-slate-500 line-through">{avant}</span>}
        {change && <ArrowRight className="w-3 h-3 text-slate-600" />}
        <span className={change ? 'text-amber-300 font-semibold' : 'text-slate-200'}>{apres}</span>
      </span>
    </div>
  );
};

const ComparaisonAnalyse = ({ courante, reference, libelleReference = 'analyse de référence' }) => {
  if (!courante) return null;

  const ref = reference && reference !== courante ? reference : null;
  const pRef = ref?.parametres || {};
  const pCur = courante.parametres || {};

  const ecartDscr = ref ? ecartEntre(courante.dscr, ref.dscr, 3) : null;
  const ecartStress = ref ? ecartEntre(courante.dscrStress, ref.dscrStress, 3) : null;
  const ecartScore = ref ? ecartEntre(courante.scoreGlobal, ref.scoreGlobal, 1) : null;

  const recoChange = ref && ref.recommandation !== courante.recommandation;

  return (
    <div className="space-y-4">
      {/* Bandeau de recommandation — le moteur recommande, l'humain décide (principe 2). */}
      <div className={`rounded-lg border px-4 py-3 ${RECOMMANDATION_CLASS[courante.recommandation] || 'text-slate-300 border-slate-700 bg-slate-800/40'}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wide opacity-70">Recommandation du moteur</span>
            {recoChange && (
              <>
                <span className="text-xs opacity-60 line-through">
                  {RECOMMANDATION_LABEL[ref.recommandation] || ref.recommandation}
                </span>
                <ArrowRight className="w-3 h-3 opacity-60" />
              </>
            )}
            <span className="font-bold">
              {RECOMMANDATION_LABEL[courante.recommandation] || courante.recommandation || NULL_DISPLAY}
            </span>
          </div>
          <Badge variant="outline" className="text-[10px] h-5 border-current opacity-80">
            Avis consultatif — la décision reste un acte humain motivé
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metrique
          libelle="DSCR"
          valeur={formatRatio2(courante.dscr, 3)}
          ecart={ecartDscr}
          aide="Capacité de remboursement — servi par le moteur"
        />
        <Metrique
          libelle="DSCR stressé"
          valeur={formatRatio2(courante.dscrStress, 3)}
          ecart={ecartStress}
          aide="Après choc sur les flux de trésorerie"
        />
        <Metrique
          libelle="Score global"
          valeur={formatPourcent(courante.scoreGlobal, 1)}
          ecart={ecartScore}
          aide="Somme pondérée des 5 critères"
        />
      </div>

      <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
          Paramètres de cette analyse{ref ? ` — comparés à l'${libelleReference}` : ''}
        </p>
        <Parametre libelle="Durée (mois)" avant={pRef.dureeMois} apres={pCur.dureeMois ?? NULL_DISPLAY} />
        <Parametre libelle="Différé (mois)" avant={pRef.differeMois} apres={pCur.differeMois ?? NULL_DISPLAY} />
        <Parametre
          libelle="Taux annuel"
          avant={pRef.tauxAnnuel !== undefined ? formatPourcent(pRef.tauxAnnuel) : undefined}
          apres={pCur.tauxAnnuel !== undefined ? formatPourcent(pCur.tauxAnnuel) : NULL_DISPLAY}
        />
        {(pCur.modeDiffere || pRef.modeDiffere) && (
          <Parametre
            libelle="Mode de différé"
            avant={pRef.modeDiffere ? (MODE_DIFFERE_LABEL[pRef.modeDiffere] || pRef.modeDiffere) : undefined}
            apres={pCur.modeDiffere ? (MODE_DIFFERE_LABEL[pCur.modeDiffere] || pCur.modeDiffere) : NULL_DISPLAY}
          />
        )}
        {!ref && (
          <p className="text-[11px] text-slate-500 mt-2">
            Première analyse chargée : aucune variation à afficher tant qu'une seconde
            analyse n'a pas été exécutée.
          </p>
        )}
      </div>
    </div>
  );
};

export default ComparaisonAnalyse;

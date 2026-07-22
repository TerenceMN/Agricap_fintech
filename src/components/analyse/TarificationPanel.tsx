/**
 * Tarification d'une analyse — le CHEMIN qui mène au taux, pas le taux seul.
 *
 * ⚠ ÉCRAN STAFF (principe 7). Ce panneau montre la bande de score, l'ajustement
 * et le plancher : c'est la grille de tarification. Servie à un demandeur, elle
 * lui apprend qu'un point de score de plus vaut deux points de taux — soit
 * exactement de quoi calibrer un dossier pour la barre plutôt que pour réussir.
 * Il ne doit apparaître que sur les surfaces `/credit/*`.
 *
 * Rien n'est calculé ici : `tauxBase`, `ajustement`, `plancher` et `tauxPropose`
 * ont été arrêtés en `Decimal` par `analyse.proposer_taux` puis FIGÉS avec
 * l'analyse (`baremes_appliques._tarification`). L'écran ne refait pas
 * `base + ajustement` — si les deux ne se recomposent pas, c'est un signal
 * serveur à remonter, pas un arrondi à corriger au clavier. C'est aussi
 * pourquoi le plancher est présenté comme une étape à part : quand il mord, le
 * taux proposé n'est PAS la somme des lignes du dessus, et le dire évite qu'un
 * analyste croie à une erreur d'affichage.
 */
import React from 'react';
import { AlertTriangle, ArrowDown, Lock } from 'lucide-react';
import type { CreditTarification } from '@/types/api';
import { NULL_DISPLAY } from './analyseFormat';

/** Taux annuel en points, à 2 décimales — présentation d'un chiffre serveur. */
function tauxFr(valeur: number | null | undefined): string {
  if (valeur === null || valeur === undefined) return NULL_DISPLAY;
  const n = Number(valeur);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)} %`;
}

/** Ajustement signé, en POINTS de taux. Le signe porte le sens de la bande :
 *  une bonification (−2,00) et une surcote (+2,00) ne se lisent pas pareil. */
function pointsSignes(valeur: number | null | undefined): string {
  if (valeur === null || valeur === undefined) return NULL_DISPLAY;
  const n = Number(valeur);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  const signe = n > 0 ? '+' : '';
  return `${signe}${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)} pt`;
}

function scoreFr(valeur: number | null | undefined): string {
  if (valeur === null || valeur === undefined) return NULL_DISPLAY;
  const n = Number(valeur);
  if (!Number.isFinite(n)) return NULL_DISPLAY;
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n);
}

interface Etape {
  cle: string;
  titre: string;
  valeur: string;
  explication: string;
  ton?: 'neutre' | 'attention' | 'final';
}

const Ligne: React.FC<{ etape: Etape; dernier: boolean }> = ({ etape, dernier }) => (
  <li className="relative pl-8">
    <span
      className={`absolute left-2 top-2 w-2.5 h-2.5 rounded-full ${
        etape.ton === 'final' ? 'bg-emerald-400'
          : etape.ton === 'attention' ? 'bg-amber-400' : 'bg-slate-500'
      }`}
      aria-hidden="true"
    />
    {!dernier && (
      <span className="absolute left-[0.7rem] top-5 bottom-0 w-px bg-slate-700" aria-hidden="true" />
    )}
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 pb-4">
      <p className={`text-sm ${etape.ton === 'final' ? 'text-white font-semibold' : 'text-slate-200'}`}>
        {etape.titre}
      </p>
      <p
        className={`tabular-nums whitespace-nowrap ${
          etape.ton === 'final' ? 'text-emerald-300 font-bold text-lg'
            : etape.ton === 'attention' ? 'text-amber-300 font-semibold' : 'text-slate-300 font-medium'
        }`}
      >
        {etape.valeur}
      </p>
      <p className="basis-full text-[11px] text-slate-500 leading-relaxed">{etape.explication}</p>
    </div>
  </li>
);

export interface TarificationPanelProps {
  tarification: CreditTarification | null | undefined;
  /** Score global servi par le moteur — sert à NOMMER la bande atteinte
   *  (« 72,4 ≥ 70 »), pas à la recalculer. */
  scoreGlobal?: number | null;
}

const TarificationPanel: React.FC<TarificationPanelProps> = ({ tarification, scoreGlobal }) => {
  if (!tarification) {
    return (
      <section className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
        <h4 className="font-semibold text-white text-sm">Tarification</h4>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Cette analyse ne porte pas de tarification : elle est antérieure à la grille unique.
          Le serveur ne la re-tarife pas avec la grille d'aujourd'hui — ce serait réécrire ce
          qu'un analyste a lu. Relancez une analyse pour obtenir un taux et la bande qui l'explique.
        </p>
      </section>
    );
  }

  const {
    tauxPropose, tauxBase, bandeScoreMin, ajustement, plancher, plancherApplique,
    origineGrille, devise,
  } = tarification;

  const grilleDeSecours = origineGrille === 'defaut';

  const etapes: Etape[] = [
    {
      cle: 'base',
      titre: 'Taux de base de la filière',
      valeur: tauxFr(tauxBase),
      explication:
        "Assiette de la grille : le taux annuel de la filière du dossier, et non le taux "
        + "auquel l'échéancier a été construit. Les confondre ferait dériver le taux à chaque "
        + 'ré-analyse.',
    },
    {
      cle: 'bande',
      titre: 'Bande de score atteinte',
      valeur: bandeScoreMin === null || bandeScoreMin === undefined
        ? 'aucune'
        : `score ≥ ${scoreFr(bandeScoreMin)}`,
      explication: bandeScoreMin === null || bandeScoreMin === undefined
        ? "Aucun palier de la grille n'est applicable à ce score : le serveur l'a signalé et "
          + "n'a appliqué aucun ajustement. À faire corriger par le comité."
        : `Score global de l'analyse : ${scoreFr(scoreGlobal)}/100. Les bandes de tarification `
          + 'ne sont ni celles de la décision ni celles de la lettre — tarifer, décider et '
          + 'noter sont trois actes distincts.',
      ton: bandeScoreMin === null || bandeScoreMin === undefined ? 'attention' : 'neutre',
    },
    {
      cle: 'ajustement',
      titre: 'Ajustement de la bande',
      valeur: pointsSignes(ajustement),
      explication:
        'Points de taux ajoutés (surcote) ou retirés (bonification) par le palier retenu, '
        + 'en points annuels.',
    },
    {
      cle: 'plancher',
      titre: plancherApplique
        ? 'Plancher de sécurité — APPLIQUÉ'
        : 'Plancher de sécurité',
      valeur: tauxFr(plancher),
      explication: plancherApplique
        ? "La bonification descendait le taux sous le plancher : c'est LUI qui fait le taux "
          + "proposé, pas la somme des lignes ci-dessus. L'écart est voulu, pas un arrondi."
        : "Borne basse : la bonification ne peut pas descendre le taux sous cette valeur. "
          + "Non atteinte ici.",
      ton: plancherApplique ? 'attention' : 'neutre',
    },
    {
      cle: 'propose',
      titre: 'Taux proposé',
      valeur: `${tauxFr(tauxPropose)}${devise ? ` · ${devise}` : ''}`,
      explication:
        'Figé avec l\'analyse : une révision ultérieure de la grille ne réécrit pas le taux '
        + 'd\'un dossier déjà instruit. C\'est ce taux que reprendra le décaissement.',
      ton: 'final',
    },
  ];

  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-white text-sm">Tarification — du taux de base au taux proposé</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Chaque étape est servie par le moteur ; aucune n'est recomposée à l'écran.
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <Lock className="w-3 h-3" aria-hidden="true" /> Réservé au personnel
        </span>
      </header>

      <ol className="px-4 pt-4 list-none">
        {etapes.map((etape, i) => (
          <Ligne key={etape.cle} etape={etape} dernier={i === etapes.length - 1} />
        ))}
      </ol>

      <footer className="px-4 py-3 border-t border-slate-700 flex items-start gap-2">
        {grilleDeSecours ? (
          <>
            <AlertTriangle className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              Grille de tarification <span className="font-semibold">de secours</span> : le barème
              « TAUX » est absent ou vide en base, le moteur a appliqué les valeurs par défaut du
              code. Le comité ne peut pas la recalibrer tant qu'elle n'y vit pas — à faire créer
              en base.
            </p>
          </>
        ) : (
          <>
            <ArrowDown className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Origine de la grille :{' '}
              <span className="text-slate-300">
                {origineGrille === 'bareme' ? 'barème « TAUX » actif en base' : (origineGrille || NULL_DISPLAY)}
              </span>
              . Elle est modifiable par le comité (maker ≠ checker, impact prévisualisé sur le
              golden set) sans redéploiement.
            </p>
          </>
        )}
      </footer>
    </section>
  );
};

export default TarificationPanel;

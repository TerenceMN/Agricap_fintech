import React from 'react';
import { formatScore, formatPoints, formatPoids } from './analyseFormat';

/**
 * Ordre et libellés des 5 critères — SPEC Moteur §2, format de restitution.
 * L'ordre est celui de la SPEC (C1→C5), pas un tri par score : l'analyste lit
 * toujours la même grille, dossier après dossier.
 */
const CRITERES = [
  { cle: 'technique', libelle: 'Fiabilité technique' },
  { cle: 'dscr', libelle: 'Capacité financière (DSCR)' },
  { cle: 'stress', libelle: 'Résilience au stress' },
  { cle: 'comportemental', libelle: 'Historique comportemental' },
  { cle: 'garanties', libelle: 'Garanties & domiciliation' },
];

/**
 * Tableau des 5 critères pondérés : `score/100 × poids % = points`.
 *
 * Rien n'est calculé ici — ni les points de chaque ligne, ni le total. Le
 * moteur les a arrêtés en `Decimal` côté serveur (principe 4) ; le front les
 * restitue. Si la somme affichée des points ne tombe pas sur le score global,
 * c'est un signal serveur à remonter, pas un arrondi à corriger au clavier.
 *
 * @param {{criteres: object|null|undefined, scoreGlobal: number|null}} props
 */
const CriteriaTable = ({ criteres, scoreGlobal }) => {
  const lignes = CRITERES.map((c) => ({ ...c, data: criteres?.[c.cle] }));
  const manquants = lignes.filter((l) => !l.data).map((l) => l.libelle);

  return (
    <section className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-700">
        <h4 className="font-semibold text-white text-sm">Les 5 critères pondérés</h4>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Score de chaque critère sur 100, pondéré par son poids ; le total est le score global.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-500">
              <th scope="col" className="text-left font-medium px-4 py-2">Critère</th>
              <th scope="col" className="text-right font-medium px-2 py-2">Score</th>
              <th scope="col" className="text-right font-medium px-2 py-2">Poids</th>
              <th scope="col" className="text-right font-medium px-4 py-2">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {lignes.map(({ cle, libelle, data }) => (
              <tr key={cle} className="align-top">
                <td className="px-4 py-2.5">
                  <p className="text-slate-200">{libelle}</p>
                  {data?.details?.commentaire && (
                    <p className="text-[11px] text-slate-500 mt-0.5">{data.details.commentaire}</p>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right whitespace-nowrap text-slate-300">
                  {formatScore(data?.score)}
                  <span className="text-slate-600">/100</span>
                </td>
                <td className="px-2 py-2.5 text-right whitespace-nowrap text-slate-400">
                  ×&nbsp;{formatPoids(data?.poids)}
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap font-semibold text-white">
                  {formatPoints(data?.points)}
                  <span className="text-slate-500 font-normal"> pts</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-600">
              <th scope="row" className="px-4 py-3 text-left text-slate-200 font-semibold uppercase text-xs tracking-wide">
                Score global
              </th>
              <td colSpan={2} />
              <td className="px-4 py-3 text-right font-bold text-white text-base whitespace-nowrap">
                {formatScore(scoreGlobal)}
                <span className="text-sm text-slate-400 font-normal">/100</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {manquants.length > 0 && (
        <p className="px-4 py-2.5 text-[11px] text-amber-300/90 border-t border-slate-700">
          Critère(s) absent(s) de la réponse du serveur : {manquants.join(', ')}. Le score global
          affiché reste celui renvoyé par le moteur — il n'est pas recomposé côté client.
        </p>
      )}
    </section>
  );
};

export default CriteriaTable;

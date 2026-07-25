/**
 * Le tableau que le fondateur a demandé : chaque poste du classeur envoyé par le
 * demandeur, face à la référence de sa filière, ligne à ligne.
 *
 * Ce que chaque ligne montre, et d'où ça vient :
 *   - la valeur DÉCLARÉE  → `parModule[].valeur`, extraite des `DataRecord` de la
 *     révision courante (principe 1 : ce qui est scoré est ce qui est en base) ;
 *   - la RÉFÉRENCE        → `parModule[].reference`, coût unitaire du référentiel
 *     multiplié par la dimension du dossier PAR LE SERVEUR ;
 *   - l'ÉCART             → `parModule[].ecartPct` ;
 *   - le BADGE hors plage → `parModule[].horsPlage`, verdict du moteur après
 *     application des tolérances du référentiel.
 *
 * Ce que le tableau NE montre PAS, et pourquoi il le dit : les BORNES de la plage.
 * Elles existent en base (`couts_modules.tol_inf` / `tol_sup`) mais ne sont pas
 * sérialisées. Les recomposer ici exigerait de recopier des tolérances qui se
 * recalibrent sans redéploiement (principe 8) — la plage affichée serait fausse
 * dès le premier ajustement du comité, sans que rien ne le signale.
 *
 * ─── POURQUOI PAS `analyse/ModuleGaps` (concept distinct, déclaré) ───────────
 *
 * `ModuleGaps` liste les écarts HORS PLAGE — c'est son objet, et il le fait
 * bien : il fusionne `ecartsHorsPlage` et `indicateursHorsPlage`, et il ouvre le
 * canal de justification. Ce que le fondateur demande ici est l'autre moitié :
 * TOUS les postes du classeur, hors plage COMME dans la plage, plus ceux que le
 * référentiel ne couvre pas du tout. La différence n'est pas cosmétique — un
 * tableau qui ne montre que les écarts ne dit pas combien de postes ont été
 * confrontés, donc ne permet pas de lire « 2 écarts sur 9 postes » plutôt que
 * « 2 écarts ». Il ne montre pas non plus les postes financés mais absents du
 * référentiel, qui n'entrent dans AUCUN écart et donc dans aucun score.
 * Les deux vues coexistent, sur deux écrans, sans recalculer quoi que ce soit.
 *
 * ⚠ STAFF UNIQUEMENT (principe 7) : références, écarts et effectif du référentiel
 * sont exactement ce qu'un demandeur ne doit jamais voir.
 */
import React, { useState } from 'react';
import { Bouton, Card, CardHead, Grandeur, Note, Pill, classeChamp } from './Bits';
import {
  NULL_DISPLAY, formatDateTimeFr, formatEcartPct, formatEntier, formatMontant, formatScore,
} from './format';
import {
  MESSAGE_BORNES_NON_SERVIES, type Confrontation, type LigneConfrontation,
} from './confrontation';

export interface ConfrontationPostesProps {
  confrontation: Confrontation;
  /** Canal de justification (`POST .../analyse/justifier/`) — append only, journalisé. */
  onJustifier: (indicateur: string, justification: string) => Promise<void>;
  /** Le serveur réserve la justification aux rôles d'instruction. */
  justificationPermise: boolean;
  busy: boolean;
}

const LigneJustification: React.FC<{
  ligne: LigneConfrontation;
  onJustifier: (indicateur: string, justification: string) => Promise<void>;
  busy: boolean;
}> = ({ ligne, onJustifier, busy }) => {
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState('');

  if (!ligne.indicateur) return null;
  const indicateur = ligne.indicateur;

  return (
    <div className="mt-2">
      {!ouvert ? (
        <Bouton variant="discret" onClick={() => setOuvert(true)} disabled={busy}>
          Consigner une justification
        </Bouton>
      ) : (
        <div className="space-y-2">
          <textarea
            className={`${classeChamp} min-h-[72px]`}
            placeholder="Ce que vous savez de cet écart, et la question à poser au demandeur."
            value={texte}
            disabled={busy}
            onChange={(e) => setTexte(e.target.value)}
          />
          <p className="text-[11px] text-slate-500">
            Enregistrée en ajout seul, horodatée et signée de votre compte. Elle ne modifie ni
            l'analyse ni le score : elle documente la lecture humaine de l'écart.
          </p>
          <div className="flex gap-2">
            <Bouton
              variant="primaire"
              busy={busy}
              disabled={texte.trim() === ''}
              onClick={async () => {
                await onJustifier(indicateur, texte.trim());
                setTexte('');
                setOuvert(false);
              }}
            >
              Enregistrer la justification
            </Bouton>
            <Bouton variant="discret" disabled={busy} onClick={() => { setOuvert(false); setTexte(''); }}>
              Annuler
            </Bouton>
          </div>
        </div>
      )}
    </div>
  );
};

const ConfrontationPostes: React.FC<ConfrontationPostesProps> = ({
  confrontation, onJustifier, justificationPermise, busy,
}) => {
  const { base, lignes } = confrontation;
  const dimension = base.quantiteReference === null
    ? NULL_DISPLAY
    : `${formatEntier(base.quantiteReference)} ${base.uniteReference ?? ''}`.trim();

  return (
    <Card>
      <CardHead
        title="Poste par poste : classeur du demandeur vs référentiel de la filière"
        subtitle={
          <>
            Référentiel <span className="font-mono text-slate-300">{base.referentiel || NULL_DISPLAY}</span>
            {base.filiere ? ` — ${base.filiere}` : ''}
            {base.version === null ? '' : ` (version ${base.version})`}. Comparaison rapportée à la
            dimension du dossier : {dimension}. Barèmes, références et tolérances sont des données
            internes : cet écran n'est jamais servi à un demandeur.
          </>
        }
        right={
          <Pill
            label={base.fiabilite === 'indicative' ? 'Plage indicative' : 'Plage apprise'}
            tone={base.fiabilite === 'indicative' ? 'attention' : 'ok'}
            title={base.messageFiabilite}
          />
        }
      />

      <div className="p-4 space-y-3">
        <Note tone={base.fiabilite === 'indicative' ? 'attention' : 'info'}>
          {base.messageFiabilite}
        </Note>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Grandeur
            label="Total du plan"
            valeur={formatMontant(base.totalPlan, base.devise)}
            base={`Somme des postes du classeur — ${formatEntier(confrontation.nbPostes)} poste(s) affiché(s)`}
          />
          <Grandeur
            label="Total référentiel"
            valeur={formatMontant(base.totalReferentiel, base.devise)}
            base={`Pour ${dimension}`}
          />
          <Grandeur
            label="Écart moyen absolu"
            valeur={base.ecartMoyenPct === null ? NULL_DISPLAY : `${formatScore(base.ecartMoyenPct)} %`}
            tone="ambre"
            base="Moyenne des écarts en valeur absolue, calculée par le moteur"
          />
          <Grandeur
            label="Postes hors plage"
            valeur={formatEntier(confrontation.nbHorsPlage)}
            tone={confrontation.nbHorsPlage > 0 ? 'rouge' : 'vert'}
            base={`Sur ${formatEntier(confrontation.nbPostes)} poste(s) confronté(s)`}
          />
        </div>

        {base.commentaire && confrontation.calculable && (
          <Note tone="info" title="Lecture du moteur">{base.commentaire}</Note>
        )}

        {confrontation.completude === 'ecarts_seulement' && confrontation.calculable && (
          <Note tone="attention" title="Comparaison partielle servie par cette analyse">
            Cette analyse ne porte que les postes HORS plage : les postes conformes n'ont pas été
            servis. Le tableau ci-dessous n'est donc pas la liste complète du classeur, et
            l'absence d'une ligne ne veut pas dire « conforme ». Ré-analysez le dossier pour
            obtenir la confrontation complète.
          </Note>
        )}
      </div>

      {!confrontation.calculable ? (
        <div className="px-4 pb-6">
          <Note tone="alerte" title="Confrontation non calculable">
            {confrontation.motifNonCalculable}
            {' '}
            Ce panneau reste vide plutôt que d'afficher un tableau sans ligne, qui se lirait à
            tort comme « aucun écart ».
          </Note>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-white/10">
            <table className="w-full text-sm min-w-[860px]">
              <caption className="sr-only">
                Confrontation poste par poste des montants déclarés et des références de filière
              </caption>
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th scope="col" className="text-left p-3">Poste</th>
                  <th scope="col" className="text-right p-3">Déclaré au classeur</th>
                  <th scope="col" className="text-right p-3">Référence filière</th>
                  <th scope="col" className="text-left p-3">Plage de référence</th>
                  <th scope="col" className="text-right p-3">Écart</th>
                  <th scope="col" className="text-center p-3">Verdict du moteur</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr
                    key={l.indicateur ?? `${l.module}-${i}`}
                    className={`border-t border-white/5 align-top ${l.horsPlage ? 'bg-red-500/5' : ''}`}
                  >
                    <td className="p-3">
                      <p className="text-white font-medium">{l.module || NULL_DISPLAY}</p>
                      {l.indicateur && (
                        <p className="text-[11px] text-slate-600 font-mono mt-0.5">{l.indicateur}</p>
                      )}
                      {l.message && <p className="text-xs text-slate-400 mt-1">{l.message}</p>}

                      {l.justifications.length > 0 && (
                        <ul className="mt-2 space-y-1.5 border-l-2 border-slate-700 pl-3">
                          {l.justifications.map((j, k) => (
                            <li key={k} className="text-xs">
                              <p className="text-slate-300 whitespace-pre-line">{j.justification}</p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {j.agent || 'compte inconnu'} · {formatDateTimeFr(j.date)}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}

                      {l.justifiable && justificationPermise && (
                        <LigneJustification ligne={l} onJustifier={onJustifier} busy={busy} />
                      )}
                    </td>

                    <td className="p-3 text-right text-white tabular-nums">
                      {formatMontant(l.valeurDeclaree, base.devise)}
                    </td>

                    <td className="p-3 text-right text-slate-300 tabular-nums">
                      {l.origine === 'hors_referentiel'
                        ? <span className="text-slate-500">{NULL_DISPLAY}</span>
                        : formatMontant(l.reference, base.devise)}
                    </td>

                    <td className="p-3 text-[11px] text-slate-500 max-w-[220px] leading-relaxed">
                      {l.origine === 'hors_referentiel'
                        ? 'Aucune plage : ce poste n’est pas couvert par le référentiel.'
                        : 'Bornes non servies par l’API.'}
                    </td>

                    <td className={`p-3 text-right tabular-nums font-medium ${l.horsPlage ? 'text-red-300' : 'text-slate-300'}`}>
                      {formatEcartPct(l.ecartPct)}
                    </td>

                    <td className="p-3 text-center">
                      {l.origine === 'hors_referentiel'
                        ? <Pill label="Hors scoring" tone="info" title="N'entre dans aucun écart, donc dans aucun score." />
                        : l.horsPlage
                          ? <Pill label="Hors plage" tone="alerte" />
                          : <Pill label="Dans la plage" tone="ok" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-white/10 space-y-2">
            <Note tone="neutre" title="Pourquoi la colonne « plage » est vide">
              {MESSAGE_BORNES_NON_SERVIES}
            </Note>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Un poste à zéro est traité par le moteur comme un écart de −100 % : le classeur ne
              distingue pas « rien prévu » de « prévu à zéro ». Cette différence-là se tranche en
              parlant au demandeur, pas en lisant le tableau.
            </p>
          </div>
        </>
      )}
    </Card>
  );
};

export default ConfrontationPostes;

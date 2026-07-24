/**
 * Contre QUOI ce dossier est analysé — le point aveugle du module.
 *
 * Deux références interviennent, et une seule est tracée :
 *
 *   1. le **référentiel filière** (`ReferentielFiliere`), résolu depuis la filière
 *      du dossier et FIGÉ avec l'analyse (clé étrangère `AnalyseCredit.referentiel`,
 *      servie en `referentielInfo`). Rejouable, mais pas choisissable ;
 *   2. le **classeur simulateur** (`dataio.DataSource`, `kind=SIMULATEUR`), choisi
 *      par `_find_source` en appariant des MOTS DU NOM DE FICHIER à la filière,
 *      avec repli sur le générique. Ni choisissable, ni tracé : rien, dans une
 *      analyse enregistrée, ne dit contre quel classeur elle a été faite.
 *
 * Ce panneau ne corrige pas le second point — il le rend VISIBLE, ce qui est la
 * première chose qui manquait. Le nom du classeur retenu vient du serveur
 * (`refData.sourceFile`, réponse de `POST /credits/simulate/`, qui n'écrit rien) ;
 * l'appariement par jetons n'est pas rejoué au navigateur, sinon le « document
 * retenu » affiché pourrait différer du vrai.
 *
 * Aucun sélecteur n'est proposé : aucune route n'accepte de source explicite
 * aujourd'hui, et un choix qui ne part nulle part est une action fantôme
 * (CLAUDE.md §7.2). Le contrat manquant est décrit dans le rapport de lot.
 *
 * ⚠ Principe 7 : la liste des documents internes et leur empreinte ne descendent
 * jamais vers un rôle client. `GET /dataio/sources` est `IsStaff`, et le filtre
 * `SIMULATEUR` écarte en outre les feuilles de besoins d'autres dossiers.
 */
import React from 'react';
import type { CreditAnalyse } from '@/types/api';
import { Card, CardHead, Note, Pill } from './Bits';
import { NULL_DISPLAY, abregerSha, formatDateTimeFr, formatEntier } from './format';
import { MESSAGE_CHOIX_NON_TRANSMISSIBLE, type ChoixDocuments } from './documents';

export interface DocumentsReferenceProps {
  choix: ChoixDocuments;
  /** Analyse affichée — porte le référentiel filière réellement figé. */
  analyse: CreditAnalyse | null;
  /** La détection du choix automatique n'a pas pu être faite (simulation en échec). */
  detectionIndisponible: string | null;
  chargement: boolean;
}

const DocumentsReference: React.FC<DocumentsReferenceProps> = ({
  choix, analyse, detectionIndisponible, chargement,
}) => {
  const info = analyse?.referentielInfo;

  return (
    <Card>
      <CardHead
        title="Documents de référence de l'analyse"
        subtitle={
          "Deux références servent à instruire un dossier : le référentiel technico-économique "
          + "de la filière, figé avec chaque analyse, et le classeur simulateur, que le moteur "
          + "choisit seul. Ce panneau montre les deux."
        }
        right={
          choix.correspondFiliere === false
            ? <Pill label="Classeur hors filière" tone="alerte" />
            : choix.correspondFiliere === true
              ? <Pill label="Classeur de la filière" tone="ok" />
              : <Pill label="Correspondance non dite" tone="neutre" />
        }
      />

      <div className="p-4 space-y-4">
        {/* 1 — Référentiel filière : la référence RÉELLEMENT figée avec l'analyse. */}
        <div className="bg-slate-900/50 border border-white/5 rounded-lg p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Référentiel filière utilisé par le moteur d'analyse
          </p>
          {info ? (
            <>
              <p className="text-white font-medium mt-1">
                <span className="font-mono">{info.code || NULL_DISPLAY}</span>
                {info.filiere ? ` — ${info.filiere}` : ''}
              </p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Version {formatEntier(info.version)} · source « {info.source || NULL_DISPLAY} » ·
                {' '}{formatEntier(info.nCasReels)} dossier(s) réel(s).
                {info.estIndicatif
                  ? ' Plages estimées : elles n’ont pas l’autorité d’une plage apprise.'
                  : ' Plages apprises sur des dossiers réels.'}
              </p>
              <p className="text-[11px] text-emerald-300/80 mt-2">
                Cette référence est enregistrée AVEC l'analyse : deux ans plus tard, on saura
                contre quel référentiel ce dossier a été jugé.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-400 mt-1">
              Aucune analyse affichée : le référentiel figé n'est pas connu.
            </p>
          )}
        </div>

        {/* 2 — Classeur simulateur retenu automatiquement, rendu visible. */}
        <div className="bg-slate-900/50 border border-white/5 rounded-lg p-4">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Classeur simulateur que le moteur retient de lui-même
          </p>
          {chargement ? (
            <p className="text-sm text-slate-400 mt-1">Interrogation du serveur…</p>
          ) : detectionIndisponible ? (
            <p className="text-sm text-amber-200 mt-1">{detectionIndisponible}</p>
          ) : choix.nomRetenu || choix.libelleRetenu ? (
            <>
              <p className="text-white font-medium mt-1 break-all">
                {choix.nomRetenu ?? choix.libelleRetenu}
              </p>
              {choix.nomRetenu === null && (
                <p className="text-xs text-slate-400 mt-1">
                  Le serveur n'a nommé aucun fichier : il a retenu une référence de filière, pas
                  un classeur.
                </p>
              )}
              {choix.retenuIntrouvable && (
                <p className="text-xs text-amber-200 mt-1">
                  Ce document ne figure pas parmi les classeurs simulateurs courants listés
                  ci-dessous : il a pu être remplacé depuis, ou la liste et le moteur ne
                  regardent pas la même base.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400 mt-1">
              Le serveur n'a pas dit quel classeur il retient pour ce dossier.
            </p>
          )}
        </div>

        {choix.correspondFiliere === false && (
          <Note tone="alerte" title="Substitution de référentiel — acte à assumer, pas accident">
            Le classeur retenu n'est pas celui de la filière du dossier ; le moteur est retombé
            sur un référentiel générique. Un plan de maïs comparé à des coûts génériques produit
            un score technique qui ne parle pas de maïs. Aucune substitution ne doit rester
            silencieuse : mentionnez-la dans votre justification d'écart, et faites téléverser le
            classeur de la filière avant de conclure.
            {choix.referentielFiliere && (
              <>
                {' '}Référentiel filière résolu par le serveur :{' '}
                <span className="font-mono">{choix.referentielFiliere}</span>.
              </>
            )}
          </Note>
        )}

        {/* 3 — Les classeurs courants en base. */}
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
            Classeurs simulateurs courants en base
          </p>
          {choix.aucunDocument ? (
            <Note tone="attention">
              {chargement
                ? 'Chargement de la liste…'
                : 'Aucun classeur simulateur courant : le moteur travaille alors sur le seul '
                  + 'référentiel filière. Un classeur se téléverse et s’enregistre depuis l’écran '
                  + 'des données de référence.'}
            </Note>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Classeurs simulateurs courants</caption>
                <thead className="text-slate-400 border-b border-white/10">
                  <tr>
                    <th scope="col" className="text-left p-3">Document</th>
                    <th scope="col" className="text-right p-3">Révision</th>
                    <th scope="col" className="text-left p-3">Empreinte</th>
                    <th scope="col" className="text-left p-3">Enregistré le</th>
                    <th scope="col" className="text-center p-3">Retenu</th>
                  </tr>
                </thead>
                <tbody>
                  {choix.documents.map((d) => (
                    <tr
                      key={d.id}
                      className={`border-t border-white/5 ${d.retenuParLeMoteur ? 'bg-emerald-500/5' : ''}`}
                    >
                      <td className="p-3 text-white break-all">{d.nom}</td>
                      <td className="p-3 text-right text-slate-300 tabular-nums">
                        {formatEntier(d.revision)}
                      </td>
                      <td className="p-3 text-slate-500 font-mono text-[11px]">
                        {abregerSha(d.sha256)}
                      </td>
                      <td className="p-3 text-slate-400 text-xs">{formatDateTimeFr(d.committedAt)}</td>
                      <td className="p-3 text-center">
                        {d.retenuParLeMoteur
                          ? <Pill label="Retenu par le moteur" tone="ok" />
                          : <span className="text-slate-600">{NULL_DISPLAY}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Note tone="attention" title="Choisir le document reste impossible aujourd'hui">
          {MESSAGE_CHOIX_NON_TRANSMISSIBLE}
        </Note>
      </div>
    </Card>
  );
};

export default DocumentsReference;

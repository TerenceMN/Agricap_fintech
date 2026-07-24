/**
 * Les leviers de la direction : durée, différé, mode de différé, taux.
 *
 * ─── LE POINT DÉLICAT : SIMULER SANS ÉCRIRE ──────────────────────────────────
 *
 * Le fondateur veut essayer des combinaisons librement, puis VALIDER pour figer.
 * Le serveur ne le permet pas encore : la seule route qui accepte
 * `duree_mois / differe_mois / taux_annuel / mode_differe` est
 * `POST .../reanalyser/`, et elle PERSISTE une `AnalyseCredit` à chaque appel
 * (`executer_analyse` crée la ligne, append-only, journalisée).
 * `POST /credits/simulate/`, la route sans écriture, n'accepte AUCUN de ces
 * paramètres : elle lit durée, différé et taux dans le classeur simulateur.
 *
 * Deux façons de traiter ce manque, une seule est honnête :
 *
 *   ✗ afficher un échéancier « provisoire » recalculé au navigateur pendant que
 *     l'utilisateur bouge les curseurs. C'est l'anti-modèle du projet (un
 *     simulateur multipliait un taux par 12 dans le navigateur), et sur un
 *     échéancier à différé l'écart avec le moteur ne serait pas cosmétique ;
 *   ✓ dire que chaque exécution s'enregistre, et ne rien afficher entre-temps.
 *     La ré-analyse ne réécrit rien (principe 3 : on ré-analyse, on ne corrige
 *     pas) et l'écart entre deux analyses successives est lui-même un signal.
 *
 * C'est la seconde qui est implémentée. Le contrat manquant est décrit dans le
 * rapport de lot.
 *
 * ─── PRINCIPE 2 ──────────────────────────────────────────────────────────────
 *
 * Ce panneau exécute le MOTEUR. Il n'approuve rien, ne rejette rien, ne déplace
 * pas le dossier dans la machine à états — `reanalyser` ne le fait pas non plus.
 * Aucun libellé ne doit laisser croire le contraire.
 */
import React, { useState } from 'react';
import { Bouton, Card, CardHead, Champ, Note, classeChamp } from './Bits';
import { MODES_DIFFERE, type SaisieParametres } from './parametres';

export interface ParametresInstructionProps {
  saisie: SaisieParametres;
  onChange: (saisie: SaisieParametres) => void;
  /** Vrai tant que la saisie diffère des paramètres de l'analyse affichée. */
  modifie: boolean;
  busy: boolean;
  /** Exécute le moteur et FIGE une nouvelle analyse (append-only). */
  onExecuter: () => void;
  onReinitialiser: () => void;
  /** Une analyse est-elle déjà affichée ? Change le libellé, pas le comportement. */
  aUneAnalyse: boolean;
  /** Le serveur a refusé l'exécution (403) : le bouton n'a pas à rester offert. */
  interdit?: boolean;
}

const ParametresInstruction: React.FC<ParametresInstructionProps> = ({
  saisie, onChange, modifie, busy, onExecuter, onReinitialiser, aUneAnalyse, interdit = false,
}) => {
  const [confirme, setConfirme] = useState(false);
  const maj = (champ: keyof SaisieParametres, valeur: string) => {
    setConfirme(false);
    onChange({ ...saisie, [champ]: valeur } as SaisieParametres);
  };

  const aide = MODES_DIFFERE.find((m) => m.value === saisie.modeDiffere)?.aide ?? '';

  return (
    <Card>
      <CardHead
        title="Paramètres de l'instruction"
        subtitle={
          "Vous fixez les leviers du dossier ; le moteur recalcule l'échéancier, le DSCR et "
          + "les cinq critères. Le moteur RECOMMANDE — la décision reste un acte humain, "
          + "prise sur l'écran du dossier, avec son motif."
        }
      />

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Champ id="p-duree" label="Durée (mois)" aide="Entier. À défaut, le serveur prend le cycle de la filière.">
            <input
              id="p-duree" className={classeChamp} inputMode="numeric" value={saisie.dureeMois}
              onChange={(e) => maj('dureeMois', e.target.value)} disabled={busy}
            />
          </Champ>

          <Champ id="p-differe" label="Différé (mois)" aide="Entier. Vide = aucun différé.">
            <input
              id="p-differe" className={classeChamp} inputMode="numeric" value={saisie.differeMois}
              onChange={(e) => maj('differeMois', e.target.value)} disabled={busy}
            />
          </Champ>

          <Champ id="p-mode" label="Mode de différé" aide={aide}>
            <select
              id="p-mode" className={classeChamp} value={saisie.modeDiffere} disabled={busy}
              onChange={(e) => maj('modeDiffere', e.target.value)}
            >
              {MODES_DIFFERE.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Champ>

          <Champ
            id="p-taux"
            label="Taux annuel (points)"
            aide="Vide = taux de base de la filière. Ce taux construit l'échéancier ; il n'est pas le taux proposé par la grille de tarification."
          >
            <input
              id="p-taux" className={classeChamp} inputMode="decimal" value={saisie.tauxAnnuel}
              onChange={(e) => maj('tauxAnnuel', e.target.value)} disabled={busy}
            />
          </Champ>
        </div>

        <Note tone="attention" title="Chaque exécution enregistre une analyse">
          Le serveur ne sert aujourd'hui aucune prévisualisation : la seule route qui accepte
          ces quatre paramètres crée une <strong>AnalyseCredit</strong> append-only, datée et
          journalisée. Cet écran ne fabrique donc pas d'échéancier « provisoire » entre deux
          exécutions — il ne sait pas le calculer sans le serveur, et ne le calculera pas dans
          le navigateur. Rien n'est écrasé : l'analyse précédente reste lisible, et l'écart
          entre deux analyses successives est lui-même une donnée.
        </Note>

        {modifie && aUneAnalyse && (
          <Note tone="alerte" title="Les résultats ci-dessous ne correspondent plus à cette saisie">
            L'échéancier, le DSCR et les écarts affichés plus bas appartiennent aux paramètres
            de la dernière analyse enregistrée. Exécutez le moteur pour les mettre à jour, ou
            revenez aux paramètres de cette analyse.
          </Note>
        )}

        {interdit ? (
          <Note tone="attention" title="Exécution non autorisée">
            Le serveur réserve l'exécution du moteur aux rôles d'instruction. L'écran ne propose
            donc pas un bouton dont l'appel serait refusé.
          </Note>
        ) : !confirme ? (
          <div className="flex flex-wrap gap-2">
            <Bouton variant="primaire" onClick={() => setConfirme(true)} busy={busy}>
              {aUneAnalyse ? 'Ré-analyser avec ces paramètres' : 'Lancer la première analyse'}
            </Bouton>
            {modifie && aUneAnalyse && (
              <Bouton variant="discret" onClick={onReinitialiser} disabled={busy}>
                Revenir aux paramètres de l'analyse affichée
              </Bouton>
            )}
          </div>
        ) : (
          <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-lg p-4 space-y-3">
            <p className="text-sm text-emerald-100 font-medium">
              Confirmer l'enregistrement d'une nouvelle analyse ?
            </p>
            <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside leading-relaxed">
              <li>Une ligne d'analyse est créée à votre nom, horodatée, avec la révision et
                l'empreinte SHA-256 de la feuille de besoins scorée.</li>
              <li>L'analyse précédente n'est ni modifiée ni supprimée.</li>
              <li>Le dossier ne change pas de statut : le moteur recommande, il ne décide pas.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <Bouton variant="primaire" busy={busy} onClick={() => { setConfirme(false); onExecuter(); }}>
                Confirmer et enregistrer
              </Bouton>
              <Bouton variant="discret" disabled={busy} onClick={() => setConfirme(false)}>
                Annuler
              </Bouton>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export default ParametresInstruction;

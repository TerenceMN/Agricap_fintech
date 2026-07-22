/**
 * `DscrPanel` — restitution du critère DSCR de l'onglet Analyse (staff).
 *
 * Ces tests figent la FORME du payload autant que l'affichage. Le moteur
 * (`credits/analyse.py`) remonte `facteurDominant` et `levier` à la racine de
 * `criteres.dscr.details` (`diagnostic.pop`), et laisse tout le reste —
 * `hypotheseCashFlows`, `moisLePlusTendu`, `alternativesDiffere` — DANS
 * `details.diagnostic`. Le contrat `types/api.ts` déclarait `alternativesDiffere`
 * à la racine : il décrivait une réponse qui n'existe pas, et seul le fait que
 * ce composant soit en `.jsx` a empêché le compilateur de le dire. Une lecture
 * au mauvais niveau ne casse rien — elle affiche simplement moins, en silence.
 *
 * Ce qui se joue derrière chaque cas :
 *   - le DSCR n'est jamais livré seul (§4.6) : facteur dominant, levier chiffré,
 *     et surtout le MOIS LE PLUS TENDU, qu'un DSCR global sain peut masquer ;
 *   - une hypothèse ne prend jamais l'autorité d'une donnée : des cash-flows
 *     projetés sont annoncés comme tels ;
 *   - rien n'est recalculé côté client — les valeurs affichées sont celles du
 *     serveur, telles quelles.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DscrPanel from '@/components/analyse/DscrPanel';
import type { CreditAnalyse } from '@/types/api';

/**
 * Analyse minimale, aux clés exactes de `analyse.py::serialiser`.
 *
 * Fixture volontairement PARTIELLE : ce composant ne lit que `parametres`,
 * `dscr`, `dscrStress`, `criteres.dscr|stress` et `echeancier`. Compléter les
 * quinze autres champs du contrat noierait le cas testé sans rien prouver de
 * plus — d'où le cast assumé, plutôt qu'un `Partial<>` qui mentirait au
 * composant sur ce qu'il reçoit en production.
 */
function analyse(dscrDetails: Record<string, unknown> = {}): CreditAnalyse {
  return {
    parametres: {
      dureeMois: 8, differeMois: 5, tauxAnnuel: 18,
      modeDiffere: 'interets_seuls', capital: 1330, devise: 'USD',
    },
    dscr: 0.64,
    dscrStress: 0.41,
    criteres: {
      dscr: { score: 20, poids: 25, points: 5, details: dscrDetails },
      stress: { score: 10, poids: 15, points: 1.5, details: {} },
    },
    echeancier: [
      { mois: 1, phase: 'différé', capital: 0, interets: 19.95, echeance: 19.95, crd: 1330 },
      { mois: 6, phase: 'amortissement', capital: 443.33, interets: 19.95, echeance: 463.28, crd: 886.67 },
    ],
  } as unknown as CreditAnalyse;
}

describe('DscrPanel — mois le plus tendu', () => {
  it('affiche le mois le plus tendu servi dans `details.diagnostic`', () => {
    // Le DSCR global (0,64) et le mois le plus tendu (0,21) sont deux
    // grandeurs différentes : les confondre fait conclure sur une moyenne.
    render(<DscrPanel analyse={analyse({
      facteurDominant: 'Différé de 5 mois sur 8.',
      diagnostic: {
        moisLePlusTendu: { mois: 6, dscr: 0.213, echeance: 463.28, cashFlow: 98.7 },
      },
    })} currency="USD" />);

    expect(screen.getByText(/Mois le plus tendu/i)).toBeTruthy();
    expect(screen.getByText('0,213')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('avertit quand le DSCR du mois passe sous 1, avec la question à poser', () => {
    render(<DscrPanel analyse={analyse({
      diagnostic: { moisLePlusTendu: { mois: 6, dscr: 0.213, echeance: 463.28, cashFlow: 98.7 } },
    })} currency="USD" />);

    expect(screen.getByText(/ne couvre pas l'échéance/i)).toBeTruthy();
    expect(screen.getByText(/calendrier de récolte/i)).toBeTruthy();
  });

  it('n’avertit pas quand le mois le plus tendu couvre son échéance', () => {
    render(<DscrPanel analyse={analyse({
      diagnostic: { moisLePlusTendu: { mois: 3, dscr: 1.42, echeance: 100, cashFlow: 142 } },
    })} currency="USD" />);

    expect(screen.getByText('1,42')).toBeTruthy();
    expect(screen.queryByText(/ne couvre pas l'échéance/i)).toBeNull();
  });

  it('n’affiche rien quand le moteur ne sert pas le diagnostic', () => {
    // `dscr_mensuel_minimum` renvoie `{}` si aucune échéance n'est exigible :
    // afficher un bloc vide ferait croire à un mois tendu à zéro.
    render(<DscrPanel analyse={analyse({ diagnostic: { moisLePlusTendu: {} } })} currency="USD" />);
    expect(screen.queryByText(/Mois le plus tendu/i)).toBeNull();

    render(<DscrPanel analyse={analyse()} currency="USD" />);
    expect(screen.queryByText(/Mois le plus tendu/i)).toBeNull();
  });
});

describe('DscrPanel — hypothèse de cash-flows', () => {
  it('signale des cash-flows PROJETÉS et chiffre l’hypothèse', () => {
    render(<DscrPanel analyse={analyse({
      diagnostic: {
        hypotheseCashFlows: {
          origine: 'projection_referentiel',
          commentaire: 'Revenus projetés depuis le référentiel filière.',
          revenuBrut: 2400, chargesPlan: 1330, margeNetteCycle: 1070,
        },
      },
    })} currency="USD" />);

    expect(screen.getByText(/cash-flows projetés, non déclarés/i)).toBeTruthy();
    expect(screen.getByText(/Revenus projetés depuis le référentiel/i)).toBeTruthy();
    expect(screen.getByText(/Hypothèse à valider avec le client/i)).toBeTruthy();
  });

  it('ne signale rien quand les cash-flows sont FOURNIS', () => {
    render(<DscrPanel analyse={analyse({
      diagnostic: { hypotheseCashFlows: { origine: 'fourni', commentaire: 'Fournis à l’appel.' } },
    })} currency="USD" />);
    expect(screen.queryByText(/cash-flows projetés/i)).toBeNull();
  });

  it('ne signale rien sur une origine inconnue plutôt que de supposer une projection', () => {
    // Test d'appartenance, pas d'exclusion : une origine ajoutée demain ne doit
    // pas déclencher un bandeau « projeté » qui discréditerait l'avertissement.
    render(<DscrPanel analyse={analyse({
      diagnostic: { hypotheseCashFlows: { origine: 'saisie_agent' } },
    })} currency="USD" />);
    expect(screen.queryByText(/cash-flows projetés/i)).toBeNull();
  });
});

describe('DscrPanel — levier chiffré', () => {
  it('affiche la courbe « différé N → DSCR X » depuis `details.diagnostic`', () => {
    render(<DscrPanel analyse={analyse({
      facteurDominant: 'Différé de 5 mois sur 8.',
      levier: 'Un différé de 3 mois porterait le DSCR à 0,95.',
      diagnostic: {
        alternativesDiffere: [
          { differeMois: 3, dscr: 0.95, serviceDette: 1469.65 },
          { differeMois: 5, dscr: 0.64, serviceDette: 1469.65 },
        ],
      },
    })} currency="USD" />);

    expect(screen.getByText(/Un différé de 3 mois porterait le DSCR/i)).toBeTruthy();
    expect(screen.getByText('0,95')).toBeTruthy();
    // Le différé courant du dossier (5 mois) est marqué comme tel.
    expect(screen.getByText(/\(actuel\)/)).toBeTruthy();
  });

  it('explique l’absence de facteur dominant au lieu de le fabriquer', () => {
    render(<DscrPanel analyse={analyse()} currency="USD" />);
    expect(screen.getByText(/n'a pas renvoyé de facteur dominant/i)).toBeTruthy();
    // Les phases de l'échéancier restent affichées pour que l'analyste conclue.
    expect(screen.getByText(/1 échéance\(s\) d'amortissement sur 2/)).toBeTruthy();
  });
});

/**
 * ANTI-GAMING (principe 7) — ce que l'espace CLIENT ne doit jamais afficher.
 *
 * `POST /credits/simulate/` sert au demandeur, dans la même réponse, des blocs
 * qui ne lui sont pas destinés : `breakdown[].maxPoints` et `weight` (le poids
 * de chaque critère), `breakdown[].detail` (phrases d'analyste citant le
 * référentiel et l'écart), `refData` (plages, DSCR, durée, différé, taux) et
 * `tarification` (la grille de taux : bande, ajustement, plancher). C'est la
 * vue de l'écran qui filtre — le module de simulation, lui, ne connaît pas le
 * rôle de l'appelant.
 *
 * Ce fichier est le garde-fou de ce filtrage. Il échoue si quelqu'un
 * réintroduit un poids, un point, une bande ou un taux dans le panneau client :
 * c'est-à-dire précisément le jour où un demandeur pourrait apprendre que
 * l'historique comportemental pèse 30 points et déplacer ses chiffres vers le
 * critère le plus rentable, au lieu d'améliorer son projet.
 *
 * Le pendant serveur existe déjà (`serialiser_analyse_resume`, vue client
 * volontairement pauvre) ; celui-ci couvre le chemin du SIMULATEUR, qui n'a pas
 * de sérialiseur par rôle.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CriteresClient } from '@/components/simulateur/SimulationResult';

/** Réponse serveur réaliste : tous les champs sensibles sont PRÉSENTS. */
const simResult = {
  score: 62.4,
  eligible: true,
  proposedRate: 20,
  minScoreRequired: 60,
  valuationNote: 'Dossier recevable — approbation sous conditions.',
  breakdown: [
    {
      code: 'technique', label: 'Fiabilité technique',
      points: 8.5, maxPoints: 25, weight: 25, weightedScore: 8.5, score: 34, calculable: true,
      detail: 'Écart moyen de 42 % au référentiel MAIS-v3.',
    },
    {
      code: 'dscr', label: 'Capacité financière (DSCR)',
      points: null, maxPoints: 20, weight: 20, weightedScore: null, score: null, calculable: false,
      detail: 'Capacité financière non calculable : aucun DSCR n’a pu être estimé.',
    },
    {
      code: 'comportemental', label: 'Historique comportemental',
      points: 15, maxPoints: 30, weight: 30, weightedScore: 15, score: 50, calculable: true,
      detail: 'Historique comportemental non disponible : score neutre de 50/100.',
    },
  ],
  refData: {
    source: 'Simulateur MAIS.xlsx', dscr: 0.64, durationMonths: 8, deferredMonths: 5,
    rateAnnual: 0.18, uniteReference: 'ha', uniteDossier: 'ha', quantiteReference: 5,
    refTotals: { semences: 210, maindoeuvre: 480 },
  },
  tarification: {
    tauxBase: 18, bandeScoreMin: 55, ajustement: 2, plancher: 12.6,
    plancherApplique: false, taux: 20, origine: 'bareme',
  },
  needsSource: { revision: 2, sha256: 'a1b2c3d4e5f6a7b8' },
};

describe('CriteresClient — ce qui est montré', () => {
  it('nomme les critères examinés : c’est utile et ce n’est pas jouable', () => {
    render(<CriteresClient simResult={simResult} />);

    expect(screen.getByText(/Fiabilité technique/)).toBeTruthy();
    expect(screen.getByText(/Capacité financière/)).toBeTruthy();
    expect(screen.getByText(/Historique comportemental/)).toBeTruthy();
  });

  it('signale un critère non évalué — c’est actionnable pour le demandeur', () => {
    render(<CriteresClient simResult={simResult} />);
    expect(screen.getByText(/non évalué à ce stade/)).toBeTruthy();
    expect(screen.getByText(/Un critère n’a pas pu être évalué/)).toBeTruthy();
  });

  it('renvoie le détail du calcul à l’instruction, sans le montrer', () => {
    render(<CriteresClient simResult={simResult} />);
    expect(screen.getByText(/relève de l'instruction du dossier/)).toBeTruthy();
  });

  it('ne rend rien tant que le moteur n’a pas répondu', () => {
    const { container } = render(<CriteresClient simResult={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('CriteresClient — ce qui ne doit JAMAIS fuiter (principe 7)', () => {
  /** Tout le texte rendu, sans balises : on cherche des CHIFFRES de barème. */
  function texteRendu(): string {
    const { container } = render(<CriteresClient simResult={simResult} />);
    return container.textContent ?? '';
  }

  it('n’affiche aucun poids de critère', () => {
    const texte = texteRendu();
    // 25, 20 et 30 sont les poids servis dans `maxPoints` / `weight`.
    expect(texte).not.toMatch(/\b25\b/);
    expect(texte).not.toMatch(/\b30\b/);
    expect(texte).not.toMatch(/\b20\b/);
  });

  it('n’affiche aucun point pondéré ni score par critère', () => {
    const texte = texteRendu();
    expect(texte).not.toContain('8.5');
    expect(texte).not.toContain('8,5');
    expect(texte).not.toContain('/100');
  });

  it('n’affiche ni référentiel, ni DSCR, ni durée, ni différé, ni taux', () => {
    const texte = texteRendu();
    expect(texte).not.toContain('MAIS-v3');
    expect(texte).not.toContain('Simulateur MAIS.xlsx');
    expect(texte).not.toContain('0.64');
    expect(texte).not.toMatch(/DSCR\s*=|DSCR calculé/);
    expect(texte).not.toMatch(/%\s*\/?\s*an/);
  });

  it('n’affiche aucune bande de tarification ni son ajustement', () => {
    const texte = texteRendu();
    expect(texte).not.toContain('55');
    expect(texte).not.toContain('12,6');
    expect(texte).not.toContain('12.6');
  });

  it('n’affiche pas les phrases d’analyste servies dans `detail`', () => {
    // « Écart moyen de 42 % au référentiel » cite une plage et une tolérance :
    // c'est du vocabulaire d'instruction, pas une piste d'amélioration.
    const texte = texteRendu();
    expect(texte).not.toContain('Écart moyen');
    expect(texte).not.toContain('42 %');
  });

  it('conserve le lignage de la feuille — une preuve, pas une règle', () => {
    // La révision et l'empreinte disent AU CLIENT sur quel fichier il a été
    // simulé. Rien ne s'en déduit sur le barème : c'est de la traçabilité.
    render(<CriteresClient simResult={simResult} />);
    expect(screen.getByText(/révision 2 de votre feuille/)).toBeTruthy();
  });
});

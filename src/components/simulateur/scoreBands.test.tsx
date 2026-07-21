/**
 * Bandes de classement du score du simulateur (`SimulationResult.jsx`).
 *
 * ⚠ AVERTISSEMENT AUX FUTURS RELECTEURS — NE « CORRIGEZ » PAS CES SEUILS.
 *
 * La grille de la LETTRE est 85 / 70 / 50 en `>` STRICT. Ce sont les bornes du
 * SERVEUR (SPEC §6, `LETTRES_DEFAUT`, test Django `test_lettre_de_score`), donc :
 * 85 → B, 70 → C, 50 → D. Les échelles 85/70/**55** en `>=` que l'on croise dans
 * `scoring.py` et `dataio_simulator.py` sont autre chose — les bandes
 * d'ajustement du TAUX et de la note de valorisation. Aligner l'une sur l'autre
 * ferait diverger la lettre affichée de celle du moteur.
 *
 * Ce fichier fige donc les bornes exactes, y compris et surtout AUX POINTS DE
 * BASCULE, parce que c'est là que les deux échelles se ressemblent le plus et
 * que la confusion s'installe.
 *
 * Limite assumée : `SCORE_BANDS` est une COPIE d'une grille qui vit en base
 * (`BaremeScore.DECISION.parametres.lettres`). Ces tests protègent la copie
 * contre une modification accidentelle ; ils ne détectent PAS une dérive entre
 * la copie et la base le jour où le comité recalibrera la grille. Le vrai
 * correctif est que `simulate/` serve `scoreLettre` comme `analyse/`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DonutChartScore, scoreLetterOf } from '@/components/simulateur/SimulationResult';

describe('scoreLetterOf — points de bascule (comparaison STRICTE)', () => {
  it('85 donne B, pas A — la borne est `> 85`', () => {
    expect(scoreLetterOf(85)).toBe('B');
    expect(scoreLetterOf(85.01)).toBe('A');
    expect(scoreLetterOf(86)).toBe('A');
  });

  it('70 donne C, pas B — la borne est `> 70`', () => {
    expect(scoreLetterOf(70)).toBe('C');
    expect(scoreLetterOf(70.01)).toBe('B');
    expect(scoreLetterOf(71)).toBe('B');
  });

  it('50 donne D, pas C — la borne est `> 50`', () => {
    expect(scoreLetterOf(50)).toBe('D');
    expect(scoreLetterOf(50.01)).toBe('C');
    expect(scoreLetterOf(51)).toBe('C');
  });

  it('n’utilise PAS le seuil 55 des bandes de taux', () => {
    // Si quelqu'un « alignait » la grille sur `scoring.py`, 52 basculerait en D.
    expect(scoreLetterOf(52)).toBe('C');
    expect(scoreLetterOf(55)).toBe('C');
  });
});

describe('scoreLetterOf — couverture de l’échelle', () => {
  it('classe l’ensemble des scores plausibles', () => {
    expect(scoreLetterOf(100)).toBe('A');
    expect(scoreLetterOf(90)).toBe('A');
    expect(scoreLetterOf(84)).toBe('B');
    expect(scoreLetterOf(69)).toBe('C');
    expect(scoreLetterOf(49)).toBe('D');
    expect(scoreLetterOf(0)).toBe('D');
  });

  it('ne laisse aucun score sans lettre, y compris hors bornes', () => {
    expect(scoreLetterOf(-10)).toBe('D');
    expect(scoreLetterOf(1000)).toBe('A');
  });

  it('accepte un score servi en chaîne (JSON `Decimal` sérialisé)', () => {
    expect(scoreLetterOf('85')).toBe('B');
    expect(scoreLetterOf('85.5')).toBe('A');
    expect(scoreLetterOf('42')).toBe('D');
  });

  it('retombe sur D — jamais sur A — quand le score est illisible', () => {
    // Un score absent doit dégrader vers la lettre la moins flatteuse : afficher
    // « A » sur une réponse tronquée serait un mensonge favorable au dossier.
    expect(scoreLetterOf(null)).toBe('D');
    expect(scoreLetterOf(undefined)).toBe('D');
    expect(scoreLetterOf(Number.NaN)).toBe('D');
    expect(scoreLetterOf('n/a')).toBe('D');
  });
});

describe('DonutChartScore — rendu', () => {
  it('affiche la lettre et le score entier servis par le moteur', () => {
    const { container } = render(<DonutChartScore score={85} />);

    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText('85/100')).toBeTruthy();
    // La lettre partage la couleur de sa bande — une seule définition, pas deux
    // ternaires à vingt lignes d'écart qui peuvent diverger.
    const cercle = container.querySelector('circle[stroke="#60a5fa"]');
    expect(cercle).not.toBeNull();
  });

  it('affiche un état vide explicite tant qu’aucune simulation n’a tourné', () => {
    render(<DonutChartScore score={null} />);

    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText(/Lancez la simulation/)).toBeTruthy();
  });

  it('affiche l’état vide plutôt qu’un « D » fabriqué sur un score illisible', () => {
    render(<DonutChartScore score="n/a" />);

    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('D')).toBeNull();
  });

  it('arrondit l’affichage sans changer de bande', () => {
    render(<DonutChartScore score={84.6} />);

    // 84,6 s'affiche « 85/100 » mais reste un B : l'arrondi est de la
    // présentation, il ne doit pas se propager au classement.
    expect(screen.getByText('85/100')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
  });
});

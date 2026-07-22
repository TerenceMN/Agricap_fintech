/**
 * `TarificationPanel` — le chemin qui mène au taux (page de scoring, staff).
 *
 * Ce que ces tests protègent, dans l'ordre :
 *
 *  1. **Aucune recomposition côté client.** Le taux proposé affiché est celui
 *     que le serveur a figé, jamais `tauxBase + ajustement`. Le cas du plancher
 *     le prouve : base 18 + ajustement −5 donnerait 13, le serveur sert 12,60
 *     (plancher = 70 % de la base), et c'est 12,60 qui doit s'afficher. Un écran
 *     qui recalculerait afficherait 13 % sur un dossier tarifé 12,60 % — un
 *     chiffre faux sur une pièce contractuelle.
 *
 *  2. **Une analyse non tarifée le dit.** `tarification: null` (analyse
 *     antérieure à la grille unique) ne doit produire ni 0 %, ni « — » muet,
 *     mais l'explication et la conduite à tenir.
 *
 *  3. **L'origine de la grille est visible.** `origineGrille: 'defaut'` signifie
 *     que le barème « TAUX » n'existe pas en base : le comité ne peut pas le
 *     recalibrer, et un taux servi par une valeur en dur ne s'audite pas comme
 *     un taux servi par une règle votée. L'écran doit le crier, pas l'absorber.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TarificationPanel from '@/components/analyse/TarificationPanel';
import type { CreditTarification } from '@/types/api';

const base: CreditTarification = {
  tauxPropose: 20,
  tauxBase: 18,
  bandeScoreMin: 55,
  ajustement: 2,
  plancher: 12.6,
  plancherApplique: false,
  origineGrille: 'bareme',
  devise: 'USD',
};

describe('TarificationPanel — analyse tarifée', () => {
  it('affiche chaque étape servie par le moteur', () => {
    render(<TarificationPanel tarification={base} scoreGlobal={62.4} />);

    expect(screen.getByText('18,00 %')).toBeTruthy();          // taux de base
    expect(screen.getByText('score ≥ 55')).toBeTruthy();       // bande retenue
    expect(screen.getByText('+2,00 pt')).toBeTruthy();         // ajustement signé
    expect(screen.getByText('12,60 %')).toBeTruthy();          // plancher
    expect(screen.getByText('20,00 % · USD')).toBeTruthy();    // taux proposé
  });

  it('affiche le taux du serveur, pas la somme des lignes, quand le plancher mord', () => {
    render(
      <TarificationPanel
        tarification={{
          ...base, ajustement: -5, plancher: 12.6, plancherApplique: true, tauxPropose: 12.6,
        }}
        scoreGlobal={91}
      />,
    );

    // 18 − 5 = 13 : ce chiffre ne doit apparaître NULLE PART.
    expect(screen.queryByText(/13,00 %/)).toBeNull();
    expect(screen.getByText('12,60 % · USD')).toBeTruthy();
    expect(screen.getByText(/Plancher de sécurité — APPLIQUÉ/)).toBeTruthy();
  });

  it('signale une bande introuvable au lieu de la remplacer par 0', () => {
    render(<TarificationPanel tarification={{ ...base, bandeScoreMin: null }} scoreGlobal={62} />);

    expect(screen.getByText('aucune')).toBeTruthy();
    expect(screen.getByText(/Aucun palier de la grille n'est applicable/)).toBeTruthy();
  });

  it('alerte quand la grille appliquée est celle de secours du code', () => {
    render(<TarificationPanel tarification={{ ...base, origineGrille: 'defaut' }} scoreGlobal={62} />);

    expect(screen.getByText(/de secours/)).toBeTruthy();
    expect(screen.getByText(/absent ou vide en base/)).toBeTruthy();
  });

  it('nomme la grille active quand elle vit en base', () => {
    render(<TarificationPanel tarification={base} scoreGlobal={62} />);
    expect(screen.getByText(/barème « TAUX » actif en base/)).toBeTruthy();
  });
});

describe('TarificationPanel — analyse non tarifée', () => {
  it('explique l’absence de taux et la conduite à tenir', () => {
    render(<TarificationPanel tarification={null} scoreGlobal={62} />);

    expect(screen.getByText(/antérieure à la grille unique/)).toBeTruthy();
    expect(screen.getByText(/Relancez une analyse/)).toBeTruthy();
    // Surtout : aucun taux fabriqué.
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('traite `undefined` comme `null` — jamais comme un taux à 0', () => {
    render(<TarificationPanel tarification={undefined} />);
    expect(screen.getByText(/ne porte pas de tarification/)).toBeTruthy();
  });
});

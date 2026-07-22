/**
 * `DeviationBlock` — l'écart d'un poste du reporting promoteur.
 *
 * Trois pièges, tous déjà présents dans la version précédente de cet écran :
 *
 * 1. **Le sens de l'écart.** +20 % sur les coûts et +20 % sur le revenu ont la
 *    même forme et le sens INVERSE. L'ancien code codait la règle en dur
 *    (`costDeviation <= 0 ? vert : rouge`) juste à côté d'une flèche pilotée par
 *    le signe — les deux se contredisaient. La règle est métier : elle vit au
 *    serveur (`unfavorable`), l'écran lit un booléen.
 *
 * 2. **L'absence de prévision.** Sans prévision posée, le serveur sert un écart
 *    de 0. Affiché tel quel, il se lit « conforme à la prévision » alors qu'il
 *    veut dire « rien à comparer ». `hasForecast` sépare les deux.
 *
 * 3. **Le recalcul.** L'écart affiché est celui figé par le serveur à la
 *    soumission — le même qui déclenche l'observation de risque. Ce composant ne
 *    reçoit qu'un nombre : il ne peut structurellement plus en dériver un autre.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeviationBlock } from '@/components/investor-space/PerformanceReports';

const format = (v: number) => `${v} $`;

describe('DeviationBlock — le sens vient du serveur', () => {
  it('colore en rouge un écart déclaré défavorable, même positif', () => {
    // Coûts à +20 % : la forme est celle d'une hausse, le sens est mauvais.
    const { container } = render(
      <DeviationBlock
        label="Coûts" actual={1200} forecast={1000} deviation={20}
        unfavorable hasForecast format={format}
      />,
    );

    expect(container.querySelector('.text-red-400')).toBeTruthy();
    expect(container.querySelector('.text-emerald-400')).toBeNull();
    expect(container.textContent).toContain('défavorable');
  });

  it('colore en vert un écart positif déclaré favorable', () => {
    const { container } = render(
      <DeviationBlock
        label="Revenus" actual={1200} forecast={1000} deviation={20}
        unfavorable={false} hasForecast format={format}
      />,
    );

    expect(container.querySelector('.text-emerald-400')).toBeTruthy();
    expect(container.querySelector('.text-red-400')).toBeNull();
    expect(container.textContent).not.toContain('défavorable');
  });

  it('colore en rouge un écart NÉGATIF déclaré défavorable', () => {
    // Production en dessous de la prévision : signe inverse du cas des coûts,
    // même verdict. Router sur le signe donnerait la couleur inverse.
    const { container } = render(
      <DeviationBlock
        label="Production" actual={800} forecast={1000} deviation={-20}
        unfavorable hasForecast format={format}
      />,
    );

    expect(container.querySelector('.text-red-400')).toBeTruthy();
  });

  it('affiche le signe et le taux servis, sans les recomposer', () => {
    render(
      <DeviationBlock
        label="Revenus" actual={1200} forecast={1000} deviation={20}
        unfavorable={false} hasForecast format={format}
      />,
    );

    expect(screen.getByText(/\+20,00 %/)).toBeTruthy();
  });
});

describe('DeviationBlock — pas de prévision n’est pas « conforme »', () => {
  it('dit qu’il n’y a rien à comparer plutôt que d’afficher 0 %', () => {
    const { container } = render(
      <DeviationBlock
        label="Coûts" actual={1200} forecast={0} deviation={0}
        unfavorable={false} hasForecast={false} format={format}
      />,
    );

    expect(container.textContent).toContain('Aucune prévision posée');
    expect(container.textContent).not.toContain('0,00 %');
    expect(container.textContent).not.toContain('vs prévision');
  });

  it('n’affiche pas non plus un montant prévu inventé', () => {
    const { container } = render(
      <DeviationBlock
        label="Coûts" actual={1200} forecast={0} deviation={0}
        unfavorable={false} hasForecast={false} format={format}
      />,
    );

    expect(container.textContent).toContain('Prévu : —');
    // Le réalisé, lui, reste affiché : c'est une donnée du rapport.
    expect(container.textContent).toContain('1200 $');
  });

  it('affiche un écart réellement nul comme un chiffre quand la prévision existe', () => {
    // 0 % avec prévision = conforme, et ça se dit. C'est l'inverse du cas
    // précédent, et les deux ne doivent jamais se ressembler à l'écran.
    const { container } = render(
      <DeviationBlock
        label="Revenus" actual={1000} forecast={1000} deviation={0}
        unfavorable={false} hasForecast format={format}
      />,
    );

    expect(container.textContent).toContain('+0,00 % vs prévision');
    expect(container.textContent).not.toContain('Aucune prévision');
  });
});

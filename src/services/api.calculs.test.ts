/**
 * `montantLigne` / `recetteVente` — les deux seuls calculs métier que le front
 * assume encore (saisie assistée de la feuille de besoins).
 *
 * Ils existent pour donner un total au fil de la frappe ; le SERVEUR reste seul
 * juge des montants scorés. Trois choses les rendaient fragiles, corrigées et
 * désormais figées ici :
 *   - la normalisation de saisie francophone (« 3,5 » et non « 3.5 »), qui casse
 *     silencieusement en `NaN` si elle disparaît ;
 *   - l'arithmétique en `float` là où le backend calcule en `Decimal`
 *     (principe 4) : `Math.round(x * 100) / 100` n'est pas `ROUND_HALF_UP`.
 *     Le calcul passe maintenant par des décimaux exacts (`BigInt`), donc les
 *     deux moteurs tombent sur le même centime ;
 *   - l'absence de bornes sur `taux_perte`, qui produisait des recettes
 *     négatives à partir d'une saisie en pourcents.
 */
import { describe, expect, it } from 'vitest';
import { diagnostiquerTauxPerte, montantLigne, recetteVente } from '@/services/api';

describe('montantLigne', () => {
  it('multiplie quantité × coût unitaire × fréquence', () => {
    expect(montantLigne({
      rubrique: 'Semences', quantite: 25, cout_unitaire: 4, frequence: 2,
    })).toBe(200);
  });

  it('accepte la virgule décimale de la saisie francophone', () => {
    expect(montantLigne({
      rubrique: 'Engrais', quantite: '2,5', cout_unitaire: '12,4', frequence: '1',
    })).toBe(31);
  });

  it('accepte aussi le point décimal', () => {
    expect(montantLigne({
      rubrique: 'Engrais', quantite: '2.5', cout_unitaire: '12.4',
    })).toBe(31);
  });

  it('traite une fréquence absente comme 1', () => {
    expect(montantLigne({ rubrique: 'Main-d’œuvre', quantite: 10, cout_unitaire: 3 })).toBe(30);
  });

  it('renvoie 0 sur une ligne vide plutôt que NaN', () => {
    // Une ligne en cours de saisie ne doit jamais afficher « NaN » à l'écran.
    expect(montantLigne({ rubrique: 'Divers' })).toBe(0);
    expect(montantLigne({ rubrique: 'Divers', quantite: '', cout_unitaire: '' })).toBe(0);
    expect(montantLigne({ rubrique: 'Divers', quantite: 'abc', cout_unitaire: 'xyz' })).toBe(0);
  });

  it('renvoie 0 dès qu’un facteur est nul', () => {
    expect(montantLigne({ rubrique: 'X', quantite: 0, cout_unitaire: 100 })).toBe(0);
    expect(montantLigne({ rubrique: 'X', quantite: 100, cout_unitaire: 0 })).toBe(0);
  });

  it('arrondit à deux décimales', () => {
    expect(montantLigne({
      rubrique: 'X', quantite: 3, cout_unitaire: 1.333, frequence: 1,
    })).toBe(4);
    expect(montantLigne({
      rubrique: 'X', quantite: 7, cout_unitaire: 1.111, frequence: 1,
    })).toBe(7.78);
  });

  it('ignore `montant_total` même quand la ligne en porte un', () => {
    // Le total affiché se recalcule toujours : sinon un `montant_total` obsolète
    // (import, copier-coller) contredirait les facteurs saisis juste à côté.
    expect(montantLigne({
      rubrique: 'X', quantite: 2, cout_unitaire: 3, montant_total: 999,
    })).toBe(6);
  });

  it('une fréquence explicitement à 0 donne un montant nul', () => {
    // CORRIGÉ. `(n(b.frequence) || 1)` ne distinguait pas « pas de fréquence
    // saisie » de « zéro occurrence » : un client qui met 0 pour neutraliser une
    // ligne voyait le montant plein, repris dans le total du poste.
    // Une donnée absente et un zéro explicite ne se traitent jamais pareil
    // (CLAUDE.md §4.5).
    expect(montantLigne({ rubrique: 'X', quantite: 10, cout_unitaire: 5, frequence: 0 })).toBe(0);
    expect(montantLigne({ rubrique: 'X', quantite: 10, cout_unitaire: 5, frequence: '0' })).toBe(0);
    expect(montantLigne({ rubrique: 'X', quantite: 10, cout_unitaire: 5, frequence: '0,0' })).toBe(0);
  });

  it('une fréquence vide ou absente reste 1 — c’est l’oubli, pas le zéro', () => {
    expect(montantLigne({ rubrique: 'X', quantite: 10, cout_unitaire: 5 })).toBe(50);
    expect(montantLigne({ rubrique: 'X', quantite: 10, cout_unitaire: 5, frequence: '' })).toBe(50);
    expect(montantLigne({ rubrique: 'X', quantite: 10, cout_unitaire: 5, frequence: '  ' })).toBe(50);
  });

  it('une fréquence saisie mais illisible n’est pas silencieusement 1', () => {
    // « deux » est une saisie, pas un oubli : la lire comme 1 fabriquerait une
    // occurrence que personne n'a demandée. Elle vaut 0, comme une quantité
    // illisible, et le total tombe à 0 — visible, donc corrigeable.
    expect(montantLigne({ rubrique: 'X', quantite: 10, cout_unitaire: 5, frequence: 'deux' })).toBe(0);
  });

  it('arrondit au demi-supérieur comme le backend (ROUND_HALF_UP)', () => {
    // CORRIGÉ. 1,005 × 1 = 1,005 → 1,01 en ROUND_HALF_UP (principe 4).
    // `Math.round(1.005 * 100) / 100` donnait 1 : `1.005 * 100` vaut
    // 100.49999999999999 en binaire. L'écart d'un centime remontait dans les
    // contrôles de cohérence (Σ feuille 4 = feuille 5, ±0,01).
    expect(montantLigne({ rubrique: 'X', quantite: 1.005, cout_unitaire: 1 })).toBe(1.01);
    expect(montantLigne({ rubrique: 'X', quantite: '1,005', cout_unitaire: 1 })).toBe(1.01);
  });

  it('arrondit au demi-supérieur sur les cas que le binaire manque', () => {
    // Chacun de ces produits tombe exactement sur un demi-centime : c'est là que
    // `float` et `Decimal` divergent, et nulle part ailleurs.
    expect(montantLigne({ rubrique: 'X', quantite: '0,005', cout_unitaire: 1 })).toBe(0.01);
    expect(montantLigne({ rubrique: 'X', quantite: '2,675', cout_unitaire: 1 })).toBe(2.68);
    expect(montantLigne({ rubrique: 'X', quantite: '8,165', cout_unitaire: 1 })).toBe(8.17);
    expect(montantLigne({ rubrique: 'X', quantite: '1,015', cout_unitaire: 1 })).toBe(1.02);
    // Trois facteurs : les échelles s'additionnent (3 + 2 + 1 = 6 décimales).
    expect(montantLigne({
      rubrique: 'X', quantite: '1,005', cout_unitaire: '1,00', frequence: '1,0',
    })).toBe(1.01);
  });

  it('ne perd pas de précision sur un produit à beaucoup de décimales', () => {
    // 0,1 + 0,2 ≠ 0,3 en binaire ; ici le produit est exact avant arrondi.
    expect(montantLigne({ rubrique: 'X', quantite: '0,1', cout_unitaire: '0,2' })).toBe(0.02);
    expect(montantLigne({
      rubrique: 'X', quantite: '1234,567', cout_unitaire: '89,012', frequence: 3,
    })).toBe(329673.83);
  });

  it('accepte un montant hors de portée du binaire sans dériver', () => {
    // 12 345 678 901,23 × 3 : au-delà de ce que `x * 100` arrondit encore juste.
    expect(montantLigne({
      rubrique: 'X', quantite: '12345678901,23', cout_unitaire: 3,
    })).toBe(37037036703.69);
  });
});

describe('recetteVente', () => {
  it('applique le taux de perte avant le prix', () => {
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 1000, taux_perte: 0.1, prix_unitaire: 0.45,
    })).toBe(405);
  });

  it('sans perte déclarée, recette = quantité × prix', () => {
    expect(recetteVente({ produit: 'Maïs grain', quantite: 500, prix_unitaire: 0.5 })).toBe(250);
  });

  it('accepte la virgule décimale sur les trois champs', () => {
    expect(recetteVente({
      produit: 'Riz', quantite: '200', taux_perte: '0,05', prix_unitaire: '1,2',
    })).toBe(228);
  });

  it('renvoie 0 sur une ligne vide plutôt que NaN', () => {
    expect(recetteVente({ produit: 'Riz' })).toBe(0);
    expect(recetteVente({ produit: 'Riz', quantite: 'n/a', prix_unitaire: '' })).toBe(0);
  });

  it('arrondit à deux décimales', () => {
    // 333 × 0,93 × 1,11 = 343,7559 → 343,76.
    expect(recetteVente({
      produit: 'Riz', quantite: 333, taux_perte: 0.07, prix_unitaire: 1.11,
    })).toBe(343.76);
  });

  it('une perte hors [0,1] ne produit jamais de recette négative', () => {
    // CORRIGÉ. `taux_perte` est une FRACTION (0,1 = 10 %). Rien ne le bornait :
    // « 10 » saisi pour « 10 % » donnait (1 − 10) = −9, soit −1 800 au lieu de
    // 180 — un montant négatif qui se propage dans un total de feuille 5.
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: 10, prix_unitaire: 2,
    })).toBeGreaterThanOrEqual(0);
    // Borné à une perte totale : au-delà de 100 %, il ne reste rien à vendre.
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: 10, prix_unitaire: 2,
    })).toBe(0);
  });

  it('borne aussi une perte négative, sans en faire un bonus de récolte', () => {
    // −0,2 ne signifie pas « 20 % de plus » : la perte est comptée nulle.
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: -0.2, prix_unitaire: 2,
    })).toBe(200);
  });

  it('perte totale (1) et perte > 1 donnent toutes deux 0', () => {
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: 1, prix_unitaire: 2,
    })).toBe(0);
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: 1.5, prix_unitaire: 2,
    })).toBe(0);
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: '1,000', prix_unitaire: 2,
    })).toBe(0);
  });

  it('une perte juste sous 1 reste calculée, elle n’est pas rabotée', () => {
    // La borne ne doit pas manger les valeurs légitimes proches du bord.
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: '0,999', prix_unitaire: 2,
    })).toBe(0.2);
  });

  it('arrondit au demi-supérieur comme le backend', () => {
    // 100 × (1 − 0,9) × 0,1005 = 1,005 → 1,01 en ROUND_HALF_UP.
    expect(recetteVente({
      produit: 'Riz', quantite: 100, taux_perte: '0,9', prix_unitaire: '0,1005',
    })).toBe(1.01);
  });
});

describe('diagnostiquerTauxPerte', () => {
  it('ne signale rien sur un taux dans [0, 1]', () => {
    expect(diagnostiquerTauxPerte('0,1')).toMatchObject({ saisi: 0.1, horsPlage: false, message: null });
    expect(diagnostiquerTauxPerte(0)).toMatchObject({ horsPlage: false });
    expect(diagnostiquerTauxPerte(1)).toMatchObject({ horsPlage: false });
  });

  it('ne signale rien sur un champ vide — l’absence n’est pas une erreur', () => {
    expect(diagnostiquerTauxPerte('')).toEqual({
      saisi: null, horsPlage: false, message: null, suggestion: null,
    });
    expect(diagnostiquerTauxPerte(undefined)).toMatchObject({ saisi: null, horsPlage: false });
  });

  it('signale une saisie en pourcents et SUGGÈRE la lecture probable', () => {
    // §4.5 : on suggère la correction pressentie, on ne l'applique jamais d'office.
    const d = diagnostiquerTauxPerte(10);
    expect(d.horsPlage).toBe(true);
    expect(d.saisi).toBe(10);
    expect(d.message).toContain('fraction');
    expect(d.suggestion).toBe('0,1 pour 10 % ?');
  });

  it('ne suggère rien quand la saisie ne se lit même pas en pourcents', () => {
    const d = diagnostiquerTauxPerte(450);
    expect(d.horsPlage).toBe(true);
    expect(d.suggestion).toBeNull();
  });

  it('signale un taux négatif', () => {
    const d = diagnostiquerTauxPerte('-0,2');
    expect(d.horsPlage).toBe(true);
    expect(d.message).toContain('négatif');
  });
});

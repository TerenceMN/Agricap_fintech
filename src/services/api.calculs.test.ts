/**
 * `montantLigne` / `recetteVente` — les deux seuls calculs métier que le front
 * assume encore (saisie assistée de la feuille de besoins).
 *
 * Ils existent pour donner un total au fil de la frappe ; le SERVEUR reste seul
 * juge des montants scorés. Deux choses les rendent fragiles et méritent d'être
 * figées :
 *   - la normalisation de saisie francophone (« 3,5 » et non « 3.5 »), qui casse
 *     silencieusement en `NaN` si elle disparaît ;
 *   - l'arithmétique en `float`, alors que le backend calcule en `Decimal`
 *     (principe 4). Les écarts sont documentés plus bas — ce ne sont pas des
 *     détails de présentation, ce sont deux moteurs de calcul différents sur la
 *     même ligne.
 */
import { describe, expect, it } from 'vitest';
import { montantLigne, recetteVente } from '@/services/api';

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

  it('DÉFAUT CONSTATÉ : une fréquence explicitement à 0 est comptée comme 1', () => {
    // `(n(b.frequence) || 1)` ne distingue pas « pas de fréquence saisie » de
    // « zéro occurrence ». Un client qui met 0 pour neutraliser une ligne voit
    // le montant plein s'afficher — et il est repris dans le total du poste.
    // Correctif hors périmètre (`api.ts` en lecture seule) : ne remplacer par 1
    // que si le champ est vide/absent, pas s'il vaut 0.
    expect(montantLigne({ rubrique: 'X', quantite: 10, cout_unitaire: 5, frequence: 0 })).toBe(50);
  });

  it.skip('ATTENDU (échoue aujourd’hui) : fréquence 0 → montant 0', () => {
    expect(montantLigne({ rubrique: 'X', quantite: 10, cout_unitaire: 5, frequence: 0 })).toBe(0);
  });

  it('DÉFAUT CONSTATÉ : l’arrondi `float` n’est pas le ROUND_HALF_UP du backend', () => {
    // 1,005 × 1 × 1 = 1,005 → attendu 1,01 en ROUND_HALF_UP (principe 4).
    // `Math.round(1.005 * 100) / 100` donne 1 : `1.005 * 100` vaut
    // 100.49999999999999 en binaire. La ligne affichée peut donc différer d'un
    // centime du total que le serveur retiendra. Écart borné, mais réel, et il
    // remonte dans les contrôles de cohérence (Σ feuille 4 = feuille 5, ±0,01).
    expect(montantLigne({ rubrique: 'X', quantite: 1.005, cout_unitaire: 1 })).toBe(1);
  });

  it.skip('ATTENDU (échoue aujourd’hui) : arrondi demi-supérieur comme le serveur', () => {
    expect(montantLigne({ rubrique: 'X', quantite: 1.005, cout_unitaire: 1 })).toBe(1.01);
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

  it('DÉFAUT CONSTATÉ : un taux de perte saisi en POURCENTS rend la recette négative', () => {
    // `taux_perte` est attendu en FRACTION (0,1 = 10 %). Rien ne le borne : un
    // client qui saisit « 10 » en pensant « 10 % » obtient (1 − 10) = −9 et une
    // recette négative de −1 800 au lieu de 180. Aucun garde-fou, aucun message.
    // Correctif hors périmètre (`api.ts` en lecture seule) : borner le taux à
    // [0, 1] et libeller l'unité au point de saisie.
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: 10, prix_unitaire: 2,
    })).toBe(-1800);
  });

  it.skip('ATTENDU (échoue aujourd’hui) : une perte hors [0,1] ne produit pas de recette négative', () => {
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: 10, prix_unitaire: 2,
    })).toBeGreaterThanOrEqual(0);
  });

  it('DÉFAUT CONSTATÉ : une perte totale (1) donne 0, mais une perte > 1 n’est pas signalée', () => {
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: 1, prix_unitaire: 2,
    })).toBe(0);
    expect(recetteVente({
      produit: 'Maïs grain', quantite: 100, taux_perte: 1.5, prix_unitaire: 2,
    })).toBe(-100);
  });
});

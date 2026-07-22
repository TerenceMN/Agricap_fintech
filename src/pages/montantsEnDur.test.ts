import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Aucun montant ni taux ne s'écrit en dur dans une page.
 *
 * Origine : `FinancialFlows.jsx` affichait « Total Reçu (YTD) 12 450 $ »,
 * « Prochain Paiement 425 $ » et « TRI Global 11,8 % » **au-dessus d'un tableau
 * vide**. Quelqu'un avait vidé le tableau de démonstration sans retirer les
 * chiffres qui l'accompagnaient. Le serveur, lui, calcule ces trois grandeurs et
 * retourne honnêtement `null` avec un motif quand elles n'existent pas encore —
 * l'écran les inventait pendant que le backend refusait de le faire.
 *
 * Un chiffre d'argent ne se distingue pas visuellement selon qu'il vient du
 * serveur ou d'une maquette : c'est pour ça que ce test lit la source.
 */

/** Un nombre suivi de `$` ou `%` posé directement comme texte JSX. */
const MONTANT_EN_DUR = /<[^<>]*>[^<>{}]*[0-9][0-9.,\s]*\s*(\$|%)\s*<\//g;

/**
 * Occurrences connues, en attente d'une DÉCISION métier — pas d'un correctif.
 *
 * Le prix de conversion (100 $/action) et les frais de gestion (0 %) sont des
 * constantes inventées par le prototype. Les brancher sur l'endpoint existant ne
 * réglerait rien : il code la même constante. Il faut d'abord arrêter les termes
 * du produit obligataire. Cette liste doit RÉTRÉCIR, jamais grandir.
 */
const TOLERE = new Set([
  'Conversions.jsx',
  'Obligations.jsx',
]);

function fichiersPages(dir: string, acc: string[] = []): string[] {
  for (const nom of readdirSync(dir)) {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) fichiersPages(chemin, acc);
    else if (/\.(jsx|tsx)$/.test(nom)) acc.push(chemin);
  }
  return acc;
}

describe('aucun montant ni taux en dur dans les pages', () => {
  const pages = fichiersPages(join(process.cwd(), 'src', 'pages'));

  it('trouve bien des pages à inspecter', () => {
    expect(pages.length).toBeGreaterThan(10);
  });

  it.each(pages.filter((p) => !TOLERE.has(p.split(/[\\/]/).pop() as string)))(
    '%s n’affiche aucun chiffre d’argent écrit dans le code',
    (chemin) => {
      const source = readFileSync(chemin, 'utf8');
      const trouves = source.match(MONTANT_EN_DUR) ?? [];
      expect(trouves, `Chiffre écrit en dur : ${trouves.join(' | ')}`).toEqual([]);
    },
  );

  it('la liste de tolérance ne contient que des cas connus et documentés', () => {
    // Si une entrée devient inutile, la retirer — une tolérance qui ne sert plus
    // masque la prochaine régression au même endroit.
    for (const nom of TOLERE) {
      const chemin = pages.find((p) => p.endsWith(nom));
      expect(chemin, `${nom} est toléré mais n’existe plus`).toBeDefined();
      const trouves = readFileSync(chemin as string, 'utf8').match(MONTANT_EN_DUR) ?? [];
      expect(trouves.length, `${nom} n’a plus de montant en dur : le retirer de TOLERE`)
        .toBeGreaterThan(0);
    }
  });
});

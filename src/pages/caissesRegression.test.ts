/**
 * Régression prototype — les grandeurs que le backend NE SERT PAS ne doivent
 * jamais réapparaître dans la vue « Caisses » ni dans son export.
 *
 * Le prototype Horizons portait un « Rendement » à 0 en dur, un « Taux Risque (%) »
 * fabriqué en convertissant un champ catégoriel (FAIBLE/MODERE/ELEVE) en 2/5/8, et
 * un `yield: 0`. Aucune de ces trois grandeurs n'existe côté serveur. Ce test lit
 * le SOURCE des fichiers neufs (rendu ET export) et échoue si l'une réapparaît —
 * une régression de ce genre ne se voit pas au rendu quand la donnée est absente.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const NEW_FILES = [
  'src/pages/Caisses.jsx',
  'src/pages/caissesWire.ts',
  'src/components/treasury/CaisseCells.tsx',
  'src/components/treasury/CaisseDialogs.jsx',
];

const FORBIDDEN: Array<{ label: string; re: RegExp }> = [
  { label: 'yield (rendement technique du prototype)', re: /\byield\b/i },
  { label: '« Rendement »', re: /rendement/i },
  { label: '« Taux Risque » (%)', re: /taux\s*(?:de\s*)?risque/i },
  // Dérivation d'un pourcentage depuis le niveau de risque catégoriel :
  // `{ FAIBLE: 2, MODERE: 5, ELEVE: 8 }` et consorts.
  { label: 'niveau de risque converti en nombre', re: /(?:FAIBLE|MODERE|ELEVE)\s*:\s*-?\d/ },
];

describe('vue Caisses — aucune grandeur non servie ne réapparaît', () => {
  it.each(NEW_FILES)('%s est exempt de rendement et de taux de risque', (rel) => {
    const source = readFileSync(join(ROOT, rel), 'utf8');
    const hits = FORBIDDEN.filter((f) => f.re.test(source)).map((f) => f.label);
    expect(hits, `Grandeur non servie dans ${rel} : ${hits.join(' | ')}`).toEqual([]);
  });

  it('le garde-fou lui-même détecte bien une conversion catégorielle', () => {
    const faulty = 'const RISK_LABEL_TO_PCT = { FAIBLE: 2, MODERE: 5, ELEVE: 8 };';
    expect(FORBIDDEN.some((f) => f.re.test(faulty))).toBe(true);
  });
});

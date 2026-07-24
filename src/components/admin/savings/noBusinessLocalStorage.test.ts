/**
 * GARDE-FOU : aucune donnée métier d'épargne écrite ou lue en `localStorage`.
 *
 * Ce test n'inspecte pas un rendu, il lit le CODE SOURCE des modales admin
 * d'épargne et du panneau `Savings.jsx`. C'est le seul moyen d'attraper la classe
 * de défaut que ce chantier corrige (CLAUDE.md §5) : les cinq modales écrivaient
 * la configuration de taux, les ajustements, l'affectation des groupes et le
 * journal d'audit dans `localStorage`, et calculaient le taux mensuel côté client.
 * Rien n'était partagé, rien ne survivait à un vidage de cache, aucun auditeur ne
 * voyait quoi que ce soit — et une config de taux locale n'engageait rien.
 *
 * Un thème ou une locale résiduels seraient tolérables ; une config de taux, un
 * ajustement, une affectation de groupe ou un audit, non. Le garde-fou vise donc
 * les CLÉS MÉTIER connues : leur seule présence dans un `localStorage.getItem` /
 * `setItem` fait échouer la suite avant qu'un écran n'atteigne un administrateur.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');
const ADMIN_SAVINGS = join(SRC, 'components', 'admin', 'savings');
const SAVINGS_PAGE = join(SRC, 'pages', 'Savings.jsx');

/** Tout accès à `localStorage`, en get comme en set. */
const LOCAL_STORAGE_CALL = /localStorage\s*\.\s*(?:get|set)Item\s*\(/g;

/** Clés métier de l'épargne qui n'ont RIEN à faire dans le navigateur. */
const BUSINESS_KEY = /savings_rate_config|savings_adjust_config|admin_savings_groups|group_audit/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(jsx?|tsx?)$/.test(entry) && !/\.test\.(jsx?|tsx?)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Extrait la liste d'arguments d'un appel, parenthèses équilibrées. */
function argumentsAt(source: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  return source.slice(openParenIndex + 1);
}

interface Offence {
  file: string;
  line: number;
  call: string;
}

function scanned(): string[] {
  const files = sourceFiles(ADMIN_SAVINGS);
  if (existsSync(SAVINGS_PAGE)) files.push(SAVINGS_PAGE);
  return files;
}

function findOffences(): Offence[] {
  const offences: Offence[] = [];
  for (const file of scanned()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(LOCAL_STORAGE_CALL)) {
      const open = match.index! + match[0].length - 1;
      const args = argumentsAt(source, open);
      if (BUSINESS_KEY.test(args)) {
        offences.push({
          file: `src/${relative(SRC, file).replace(/\\/g, '/')}`,
          line: source.slice(0, match.index!).split('\n').length,
          call: `${match[0]}${args.replace(/\s+/g, ' ').trim()})`,
        });
      }
    }
  }
  return offences;
}

describe('données métier d’épargne et localStorage', () => {
  it('ne persiste AUCUNE config de taux, ajustement, groupe ou audit en localStorage', () => {
    const offences = findOffences();
    const report = offences.map((o) => `${o.file}:${o.line} → ${o.call}`);

    expect(
      report,
      'Une config de taux (ou un audit) en localStorage n’engage rien, ne survit '
      + 'pas à un vidage de cache et n’est vue d’aucun autre poste. Elle doit passer '
      + 'par les endpoints /savings/plans/{id}/rate-config, /adjustment et '
      + '/groups (voir @/services/savingsApi).',
    ).toEqual([]);
  });

  it('détecte bien une écriture fautive — le garde-fou lui-même est vérifié', () => {
    // Reproduction littérale du défaut corrigé dans SavingsRateModal.jsx.
    const faulty = "localStorage.setItem(`savings_rate_config_${savings.id}`, JSON.stringify(payload));";
    const match = [...faulty.matchAll(LOCAL_STORAGE_CALL)][0];

    expect(match).toBeTruthy();
    expect(BUSINESS_KEY.test(argumentsAt(faulty, match.index! + match[0].length - 1))).toBe(true);
  });

  it('laisse passer un usage non métier (thème/locale résiduel toléré)', () => {
    const benign = "localStorage.getItem('theme');";
    const match = [...benign.matchAll(LOCAL_STORAGE_CALL)][0];

    expect(BUSINESS_KEY.test(argumentsAt(benign, match.index! + match[0].length - 1))).toBe(false);
  });
});

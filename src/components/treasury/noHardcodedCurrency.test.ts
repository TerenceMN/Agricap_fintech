/**
 * GARDE-FOU : aucune devise écrite en dur dans un mouvement de portefeuille.
 *
 * Ce test ne vérifie pas un rendu, il inspecte le CODE SOURCE de `src/`. C'est
 * volontaire, et c'est le seul moyen d'attraper la classe de défaut qui a
 * motivé ce chantier : `InvestorBanking.jsx` appelait
 * `api.caisses.wallets.deposit(amount, 'USD')`. Le formulaire n'offrait aucun
 * choix de devise, donc aucun test de rendu ne pouvait échouer — l'écran
 * fonctionnait exactement comme écrit. Le défaut n'était visible qu'au niveau
 * du CRÉDIT RÉEL : un investisseur déposant 200 000 CDF voyait 200 000 USD
 * portés à son compte.
 *
 * Un contrôle par les types serait plus élégant, mais `wallets.deposit` accepte
 * légitimement une devise en second argument : c'est le SITE D'APPEL qui doit
 * la tenir d'une saisie, pas d'une constante. Seule une lecture du source le
 * distingue.
 *
 * Portée : tout `src/**`. Un nouvel écran qui recopierait le raccourci échoue
 * ici avant d'atteindre un client.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Résolu depuis la racine du projet : sous l'environnement `jsdom`,
// `import.meta.url` n'est pas une URL `file:` et ne peut pas servir d'ancre.
const SRC = resolve(process.cwd(), 'src');

/** Appels dont le site d'appel ne doit JAMAIS fixer la devise lui-même. */
const GUARDED_CALLS = /\b(?:wallets\.(?:deposit|withdraw|convert)|fx\.convert)\s*\(/g;

/** Littéraux de devise, sous toutes leurs orthographes de chaîne. */
const CURRENCY_LITERAL = /['"`](USD|CDF)['"`]/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
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

function findOffences(): Offence[] {
  const offences: Offence[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(GUARDED_CALLS)) {
      const open = match.index! + match[0].length - 1;
      const args = argumentsAt(source, open);
      if (CURRENCY_LITERAL.test(args)) {
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

describe('devise des mouvements de portefeuille', () => {
  it('n’est jamais écrite en dur sur un site d’appel', () => {
    const offences = findOffences();
    const report = offences.map((o) => `${o.file}:${o.line} → ${o.call}`);

    expect(
      report,
      'Une devise en dur fait crédier le mauvais compte : elle doit venir de la '
      + 'saisie confirmée par le client (voir @/components/treasury/DepositForm).',
    ).toEqual([]);
  });

  it('détecte bien un appel fautif — le garde-fou lui-même est vérifié', () => {
    // Reproduction littérale du défaut corrigé dans `InvestorBanking.jsx`.
    const faulty = "await api.caisses.wallets.deposit(amount, 'USD');";
    const match = [...faulty.matchAll(GUARDED_CALLS)][0];

    expect(match).toBeTruthy();
    expect(CURRENCY_LITERAL.test(argumentsAt(faulty, match.index! + match[0].length - 1))).toBe(true);
  });

  it('laisse passer un appel qui transmet la devise saisie', () => {
    const sound = 'await api.caisses.wallets.deposit(pending.amount, pending.currency, form.method);';
    const match = [...sound.matchAll(GUARDED_CALLS)][0];

    expect(CURRENCY_LITERAL.test(argumentsAt(sound, match.index! + match[0].length - 1))).toBe(false);
  });
});

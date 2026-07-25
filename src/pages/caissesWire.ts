/**
 * Logique de composition de la vue « Caisses » — fonctions PURES, testables,
 * sans accès réseau ni dépendance React.
 *
 * ─── CE QUI EST ADMIS ICI, ET CE QUI NE L'EST PAS ────────────────────────────
 * Dénombrer des statuts et sommer des soldes À DEVISE CONSTANTE est de la
 * présentation de faits déjà servis (admis, §6). En revanche, RECALCULER un
 * solde, un écart, un cumul de plafond ou une tolérance est interdit : ces
 * grandeurs viennent du serveur (`account_row.balance`, `session_row.discrepancy`,
 * `session_row.cashInTotal`) et ne sont jamais reconstituées côté client.
 *
 * Le verdict de clôture se lit sur `session_row.status` (`DISCREPANCY` vs
 * `CLOSED`), JAMAIS sur un code HTTP : le serveur répond 200 même sur écart.
 */
import type { CashRegisterSessionRow } from '@/types/api';

/** Forme exacte de `caisses.serializers.account_row` — aucun champ inventé. */
export interface CaisseAccountRow {
  id: number;
  code: string;
  name: string;
  kind: 'CAISSE' | 'BANQUE' | 'MOBILE_MONEY';
  agencyId: number | null;
  currency: string;
  balance: number;
  initialAmount: number;
  manager: string;
  scope: string;
  riskLevel: string;
  status: 'ACTIF' | 'EN_TRAITEMENT' | 'EN_OBSERVATION' | 'BLOQUE' | 'ARCHIVE';
  createdAt: string;
  dailyCeiling: number | null;
  partnerId: number | null;
  partnerName: string | null;
}

/** Le endpoint `register-sessions` tronque à 100 lignes, sans marqueur : la
 *  troncature est INFÉRÉE du fait qu'on en reçoit exactement 100. */
export const SERVER_SESSION_LIMIT = 100;

/** Au-delà de ce nombre de caisses, l'éventail de séances est refusé tant qu'une
 *  agence n'est pas choisie (100 lignes × N caisses = charge disproportionnée). */
export const MAX_CAISSES_BEFORE_FILTER = 25;

/** Concurrence bornée de l'éventail `registerSessions` (une requête par caisse). */
export const SESSION_FANOUT_CONCURRENCY = 5;

/** Seuil d'alerte de la jauge de plafond (part du plafond consommée). */
export const NEAR_LIMIT_RATIO = 0.8;

/** Cast des lignes brutes (`unknown[]`, contrat `account_row`) vers la forme typée.
 *  Aucun champ n'est ajouté : on ne fait que nommer ce que le serveur sert déjà. */
export function asAccountRows(rows: unknown[]): CaisseAccountRow[] {
  return rows as CaisseAccountRow[];
}

/** Séance de caisse actuellement OUVERTE pour un compte, ou `null`. */
export function findOpenSession(
  sessions: CashRegisterSessionRow[] | undefined | null,
): CashRegisterSessionRow | null {
  if (!sessions) return null;
  return sessions.find((s) => s.status === 'OPEN') ?? null;
}

export interface Closure {
  session: CashRegisterSessionRow;
  discrepancy: number | null;
  frozen: boolean;
}

/** Dernière séance clôturée (la plus récente, `sessions` triées `-opened_at`),
 *  qu'elle ait gelé (`DISCREPANCY`) ou non (`CLOSED`). Sert la colonne « dernier écart ». */
export function lastClosure(
  sessions: CashRegisterSessionRow[] | undefined | null,
): Closure | null {
  const closed = (sessions ?? []).find((s) => s.status === 'CLOSED' || s.status === 'DISCREPANCY');
  if (!closed) return null;
  return { session: closed, discrepancy: closed.discrepancy, frozen: closed.status === 'DISCREPANCY' };
}

export type ClosureVerdict =
  | { kind: 'discrepancy'; discrepancy: number | null; frozen: true }
  | { kind: 'balanced'; discrepancy: number | null; frozen: false };

/**
 * Verdict d'une clôture de séance — dérivé du SEUL `status` servi.
 *
 * La signature ne reçoit aucun statut HTTP : c'est structurel, un appelant NE PEUT
 * PAS se fier au code HTTP ici. `DISCREPANCY` → gelé + écart affiché ; `CLOSED` →
 * neutre. Le champ `discrepancy` est porté dans les deux cas (le serveur le sert
 * même sans gel), mais seul `DISCREPANCY` déclenche le gel.
 */
export function closureVerdict(
  session: Pick<CashRegisterSessionRow, 'status' | 'discrepancy'>,
): ClosureVerdict {
  if (session.status === 'DISCREPANCY') {
    return { kind: 'discrepancy', discrepancy: session.discrepancy, frozen: true };
  }
  return { kind: 'balanced', discrepancy: session.discrepancy, frozen: false };
}

export type CeilingGaugeState =
  | { kind: 'unlimited' }
  | { kind: 'no-session' }
  | { kind: 'gauged'; used: number; ceiling: number; ratio: number; nearLimit: boolean; over: boolean };

/**
 * État de la jauge de plafond journalier.
 *
 * - `dailyCeiling` nul (ou ≤ 0 servi) → `unlimited` : caisse non plafonnée, fait
 *   structurel indépendant de toute séance — et jamais de division par zéro.
 * - plafond posé mais AUCUNE séance ouverte → `no-session` : le cumul du jour
 *   (`cashInTotal`) n'existe que pendant une séance ; afficher « 0 / Y » serait
 *   rassurant à tort (§9). Le plafond n'est « actif » qu'avec une séance.
 * - plafond posé + séance ouverte → `gauged` : `used = cashInTotal` servi, ratio
 *   borné, alerte à l'approche de la borne. Aucune de ces valeurs n'est recalculée.
 */
export function ceilingGauge(args: {
  dailyCeiling: number | null;
  openSession: Pick<CashRegisterSessionRow, 'cashInTotal'> | null;
}): CeilingGaugeState {
  const { dailyCeiling, openSession } = args;
  if (dailyCeiling == null || !(dailyCeiling > 0)) return { kind: 'unlimited' };
  if (!openSession) return { kind: 'no-session' };
  const used = Number.isFinite(openSession.cashInTotal) ? openSession.cashInTotal : 0;
  const ratio = used / dailyCeiling;
  return {
    kind: 'gauged',
    used,
    ceiling: dailyCeiling,
    ratio,
    nearLimit: ratio >= NEAR_LIMIT_RATIO,
    over: used > dailyCeiling,
  };
}

/** Vrai dès qu'on reçoit exactement la limite serveur : la liste est (au moins)
 *  tronquée, et l'écran doit le mentionner. */
export function sessionsAtServerLimit(
  sessions: CashRegisterSessionRow[] | undefined | null,
): boolean {
  return (sessions?.length ?? 0) >= SERVER_SESSION_LIMIT;
}

/** Mention de troncature à afficher dans le panneau des séances, ou `null`. */
export function serverLimitNote(
  sessions: CashRegisterSessionRow[] | undefined | null,
): string | null {
  return sessionsAtServerLimit(sessions)
    ? '100 séances les plus récentes (limite serveur) — les plus anciennes ne sont pas affichées.'
    : null;
}

/**
 * Un compte gelé (`BLOQUE`) ou archivé (`ARCHIVE`) n'accepte aucun nouveau flux :
 * le serveur le refuserait, et l'affordance ne doit même pas être cliquable
 * (§7.2 — gels appliqués à l'affichage ET au serveur).
 */
export function isFlowDisabled(account: Pick<CaisseAccountRow, 'status'>): boolean {
  return account.status === 'BLOQUE' || account.status === 'ARCHIVE';
}

export interface DeviseTotals { currency: string; total: number; count: number; }

/** Totaux et effectifs PAR devise — jamais fusionnés. Somme de faits servis
 *  (`balance`) à devise constante : présentation admise, pas un recalcul. */
export function totalsByCurrency(accounts: CaisseAccountRow[]): DeviseTotals[] {
  const map = new Map<string, DeviseTotals>();
  for (const a of accounts) {
    const cur = map.get(a.currency) ?? { currency: a.currency, total: 0, count: 0 };
    cur.total += a.balance;
    cur.count += 1;
    map.set(a.currency, cur);
  }
  return [...map.values()].sort((x, y) => x.currency.localeCompare(y.currency));
}

/** Dénombrement d'un statut servi — présentation admise. */
export function countByStatus(accounts: CaisseAccountRow[], status: CaisseAccountRow['status']): number {
  return accounts.filter((a) => a.status === status).length;
}

/** Comptes gelés (statut `BLOQUE`) — alimente la carte « caisses gelées » et le
 *  bloc « Écarts & gels » (lecture seule). */
export function frozenAccounts(accounts: CaisseAccountRow[]): CaisseAccountRow[] {
  return accounts.filter((a) => a.status === 'BLOQUE');
}

export type SessionsFetch =
  | { ok: true; sessions: CashRegisterSessionRow[] }
  | { ok: false };

/**
 * Éventail des séances par caisse — une requête par compte, concurrence bornée,
 * ÉCHEC ISOLÉ : une caisse dont la requête rejette reçoit `{ ok: false }` sans
 * faire tomber les autres lignes. Le tableau tient ; la ligne fautive affichera
 * « séances indisponibles ».
 */
export async function loadSessionsFanned(
  codes: string[],
  fetcher: (code: string) => Promise<CashRegisterSessionRow[]>,
  opts: { concurrency?: number } = {},
): Promise<Record<string, SessionsFetch>> {
  const concurrency = Math.max(1, opts.concurrency ?? SESSION_FANOUT_CONCURRENCY);
  const result: Record<string, SessionsFetch> = {};
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < codes.length) {
      const index = cursor;
      cursor += 1;
      const code = codes[index];
      try {
        result[code] = { ok: true, sessions: await fetcher(code) };
      } catch {
        result[code] = { ok: false };
      }
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, codes.length) }, () => worker());
  await Promise.all(pool);
  return result;
}

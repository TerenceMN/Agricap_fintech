/**
 * Règles de saisie et récapitulatif des mouvements d'épargne.
 *
 * Ce qui se joue ici n'est pas de l'ergonomie. Le dépôt d'épargne partait au
 * serveur au premier clic : aucune de ces règles n'existait, et le seul garde-fou
 * était l'attention du client. Chaque test ci-dessous décrit un versement qui ne
 * doit PAS partir, ou une chose que le client doit relire avant de signer.
 *
 * Le point le plus important est la devise : elle n'est pas saisie, elle est LUE
 * du plan servi par le serveur. Un écran qui la suppose (« USD » par défaut)
 * affiche un montant dans une devise et en crédite une autre.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SAVINGS_DEPOSIT_FORM,
  SAVINGS_CHANNELS,
  buildGroupDecisionSummary,
  buildGroupDeletionSummary,
  buildSavingsDeposit,
  channelRequiresReference,
  formatSavingsAmount,
  groupMemberCount,
  planCurrency,
  planLabel,
  savingsChannelLabel,
  savingsOperationErrors,
  validateSavingsDeposit,
  type SavingsDepositForm,
  type SavingsPlanRef,
} from '@/components/savings/savingsOperations';
import { ApiError } from '@/services/api';

const plan: SavingsPlanRef = { id: 7, name: 'Achat Tracteur', currency: 'CDF' };

function form(over: Partial<SavingsDepositForm> = {}): SavingsDepositForm {
  return { ...EMPTY_SAVINGS_DEPOSIT_FORM, amount: '100', reference: 'TRX-2440', agreed: true, ...over };
}

describe('canaux de dépôt', () => {
  it('propose exactement les canaux que le serveur accepte pour un plan', () => {
    expect(SAVINGS_CHANNELS.map((c) => c.id)).toEqual(['agent', 'mobile_money', 'bank']);
  });

  /**
   * Les canaux de l'épargne ne sont PAS ceux de la trésorerie
   * (`mobile_money` / `bank_transfer`). Réutiliser le formulaire partagé aurait
   * envoyé `bank_transfer` à un endpoint qui ne connaît que `bank`.
   */
  it('ne connaît pas les canaux de la trésorerie', () => {
    expect(SAVINGS_CHANNELS.map((c) => c.id)).not.toContain('bank_transfer');
  });

  it('affiche un code inconnu tel quel plutôt que de le deviner', () => {
    expect(savingsChannelLabel('agent')).toBe('Agent Agricap');
    expect(savingsChannelLabel('crypto')).toBe('crypto');
  });

  it('exige une référence dès que l’argent transite par un tiers', () => {
    expect(channelRequiresReference('mobile_money')).toBe(true);
    expect(channelRequiresReference('bank')).toBe(true);
    expect(channelRequiresReference('agent')).toBe(false);
  });
});

describe('devise du plan', () => {
  it('est lue du serveur et normalisée', () => {
    expect(planCurrency({ id: 1, currency: 'usd' })).toBe('USD');
    expect(planCurrency({ id: 1, currency: ' CDF ' })).toBe('CDF');
  });

  /** Le cœur du défaut : pas de repli sur « USD ». Absence de devise = absence
   *  d'information, pas valeur par défaut. */
  it('vaut null quand le serveur ne l’a pas servie — jamais USD par défaut', () => {
    expect(planCurrency({ id: 1 })).toBeNull();
    expect(planCurrency({ id: 1, currency: '' })).toBeNull();
    expect(planCurrency({ id: 1, currency: null })).toBeNull();
    expect(planCurrency(null)).toBeNull();
  });
});

describe('planLabel', () => {
  it('nomme le plan visé', () => {
    expect(planLabel(plan)).toBe('Achat Tracteur');
  });

  it('retombe sur l’identifiant, jamais sur du vide', () => {
    expect(planLabel({ id: 12 })).toBe('Plan n° 12');
    expect(planLabel({ id: 12, name: '   ' })).toBe('Plan n° 12');
    expect(planLabel(null)).toBe('Plan inconnu');
  });
});

describe('formatSavingsAmount', () => {
  it('garde les centimes et accole la devise du plan', () => {
    // Séparateur de milliers fr-FR : espace (insécable selon l'ICU) — d'où le \s.
    expect(formatSavingsAmount(1000.5, 'CDF')).toMatch(/^1\s?000,50 CDF$/);
    expect(formatSavingsAmount(100.5, 'USD')).toBe('100,50 USD');
  });

  it('dit que la devise est inconnue plutôt que d’en choisir une', () => {
    expect(formatSavingsAmount(100, null)).toBe('100,00 (devise inconnue)');
  });
});

describe('validateSavingsDeposit', () => {
  it('accepte un dépôt complet', () => {
    expect(validateSavingsDeposit(form(), plan)).toEqual({});
  });

  it('refuse un montant absent, nul, négatif ou illisible', () => {
    expect(validateSavingsDeposit(form({ amount: '' }), plan).amount).toBe('Montant invalide');
    expect(validateSavingsDeposit(form({ amount: '0' }), plan).amount).toBe('Montant invalide');
    expect(validateSavingsDeposit(form({ amount: '-10' }), plan).amount).toBe('Montant invalide');
    expect(validateSavingsDeposit(form({ amount: 'abc' }), plan).amount).toBe('Montant invalide');
  });

  it('exige la référence sur mobile money et banque, pas sur un dépôt en agence', () => {
    expect(validateSavingsDeposit(form({ channel: 'mobile_money', reference: '' }), plan).reference)
      .toBe('Référence de transaction requise');
    expect(validateSavingsDeposit(form({ channel: 'bank', reference: '  ' }), plan).reference)
      .toBe('Référence de transaction requise');
    expect(validateSavingsDeposit(form({ channel: 'agent', reference: '' }), plan)).toEqual({});
  });

  /**
   * Sans devise servie, le dépôt ne part pas. C'est plus strict qu'un simple
   * avertissement, et volontairement : on ne demande pas à un client d'arbitrer
   * sur une devise qu'on est incapable de lui nommer.
   */
  it('bloque le dépôt quand la devise du plan manque', () => {
    expect(validateSavingsDeposit(form(), { id: 7, name: 'X' }).currency)
      .toContain('Devise du plan non servie');
  });

  it('exige la case d’attestation', () => {
    expect(validateSavingsDeposit(form({ agreed: false }), plan).agreed)
      .toBe("Confirmez l'exactitude des informations");
  });

  it('collecte TOUTES les causes, pas seulement la première', () => {
    const errors = validateSavingsDeposit(
      { amount: '', channel: 'bank', reference: '', note: '', agreed: false },
      { id: 7 },
    );
    expect(Object.keys(errors).sort()).toEqual(['agreed', 'amount', 'currency', 'reference']);
  });
});

describe('buildSavingsDeposit — le récapitulatif signé par le client', () => {
  it('redit le plan nommément, le montant AVEC la devise du plan, et le canal', () => {
    const pending = buildSavingsDeposit(form({ amount: '1000', channel: 'mobile_money' }), plan)!;
    expect(pending.lines[0]).toEqual({ label: "Plan d'épargne crédité", value: 'Achat Tracteur' });
    expect(pending.lines[1].label).toBe('Montant du dépôt');
    expect(pending.lines[1].value).toMatch(/^1\s?000,00 CDF$/);
    expect(pending.lines[1].emphasis).toBe(true);
    expect(pending.lines[2]).toEqual({ label: 'Canal de dépôt', value: 'Mobile Money' });
  });

  /** Le montant transmis à l'API est le nombre saisi, pas la chaîne formatée. */
  it('porte le montant numérique et l’identifiant du plan pour l’appel serveur', () => {
    const pending = buildSavingsDeposit(form({ amount: '100.50' }), plan)!;
    expect(pending.amount).toBe(100.5);
    expect(pending.planId).toBe(7);
    expect(pending.channel).toBe('mobile_money');
    expect(pending.currency).toBe('CDF');
  });

  it('n’affiche AUCUN chiffre qu’il aurait fallu calculer — ni solde projeté, ni intérêt, ni frais', () => {
    const pending = buildSavingsDeposit(form(), plan)!;
    const labels = pending.lines.map((l) => l.label.toLowerCase()).join(' ');
    expect(labels).not.toContain('solde');
    expect(labels).not.toContain('intérêt');
    expect(labels).not.toContain('frais');
  });

  it('n’ajoute référence et note que si elles ont été saisies', () => {
    const sans = buildSavingsDeposit(form({ channel: 'agent', reference: '', note: '' }), plan)!;
    expect(sans.lines).toHaveLength(3);
    const avec = buildSavingsDeposit(form({ note: 'Vente de maïs' }), plan)!;
    expect(avec.lines.map((l) => l.label)).toContain('Note');
    expect(avec.lines.map((l) => l.label)).toContain('Référence de transaction');
  });

  it('ne construit rien sans plan ni sans montant exploitable', () => {
    expect(buildSavingsDeposit(form(), null)).toBeNull();
    expect(buildSavingsDeposit(form({ amount: '0' }), plan)).toBeNull();
    expect(buildSavingsDeposit(form({ amount: 'abc' }), plan)).toBeNull();
  });

  /** Devise manquante : le récapitulatif le DIT, il n'invente pas « USD ». */
  it('dit la devise inconnue plutôt que d’en supposer une', () => {
    const pending = buildSavingsDeposit(form(), { id: 3, name: 'Sans devise' })!;
    expect(pending.lines[1].value).toBe('100,00 (devise inconnue)');
    expect(pending.currency).toBeNull();
  });
});

describe('récapitulatifs des actions d’administration', () => {
  it('nomme le groupe supprimé et le nombre d’adhésions rompues', () => {
    const lines = buildGroupDeletionSummary({
      id: 4, name: 'Coopérative Kivu', type: 'COOPERATIVE', members: ['A', 'B', 'C'],
    });
    expect(lines[0]).toEqual({ label: 'Groupe supprimé', value: 'Coopérative Kivu', emphasis: true });
    expect(lines.map((l) => l.value)).toContain('3 membre(s)');
  });

  it('préfère l’effectif servi par le serveur à la longueur de la liste', () => {
    expect(groupMemberCount({ id: 1, membersCount: 12, members: ['A'] })).toBe(12);
    expect(groupMemberCount({ id: 1, members: ['A', 'B'] })).toBe(2);
    // Ni l'un ni l'autre : aucun effectif inventé, donc aucune ligne affichée.
    expect(groupMemberCount({ id: 1 })).toBeNull();
    expect(buildGroupDeletionSummary({ id: 1, name: 'X' }).map((l) => l.label))
      .not.toContain('Adhésions rompues');
  });

  it('distingue explicitement approbation et rejet d’une adhésion', () => {
    const req = { id: 9, userName: 'Mutombo A.', groupName: 'AVEC Goma', reason: 'Voisinage' };
    expect(buildGroupDecisionSummary(req, 'approved')[0].value).toBe('Approbation');
    expect(buildGroupDecisionSummary(req, 'rejected')[0].value).toBe('Rejet');
    expect(buildGroupDecisionSummary(req, 'approved').map((l) => l.value)).toContain('Mutombo A.');
    expect(buildGroupDecisionSummary(req, 'approved').map((l) => l.value)).toContain('AVEC Goma');
  });
});

describe('savingsOperationErrors — un refus 422 déplié cause par cause', () => {
  it('rend chaque {code, message} du serveur, pas un message unique', () => {
    const err = new ApiError(422, 'Refus', null, [
      { code: 'AMOUNT_TOO_SMALL', message: 'Montant inférieur au minimum du plan.' },
      { code: 'PLAN_CLOSED', message: 'Ce plan est clôturé.' },
    ]);
    expect(savingsOperationErrors(err)).toEqual([
      { code: 'AMOUNT_TOO_SMALL', message: 'Montant inférieur au minimum du plan.' },
      { code: 'PLAN_CLOSED', message: 'Ce plan est clôturé.' },
    ]);
  });

  it('retombe sur le message principal quand le serveur n’a qu’une cause', () => {
    expect(savingsOperationErrors(new ApiError(404, 'Plan introuvable.', 'NOT_FOUND')))
      .toEqual([{ code: 'NOT_FOUND', message: 'Plan introuvable.' }]);
  });

  it('sait aussi rendre une panne réseau lisible', () => {
    expect(savingsOperationErrors(new Error('Failed to fetch')))
      .toEqual([{ message: 'Failed to fetch' }]);
  });
});

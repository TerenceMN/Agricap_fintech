/**
 * Logique PURE du module d'administration de l'épargne (`savingsApi.ts`).
 *
 * `tsc` ne vérifie pas les `.jsx` (`checkJs: false`) : les cinq modales admin ne
 * sont donc protégées que par ce qu'elles délèguent à ce module `.ts`. Chaque
 * fonction ci-dessous MET EN FORME ce que le serveur sert — elle ne fabrique
 * aucun chiffre métier (le taux mensuel, les métriques et la projection viennent
 * du serveur). Les tests fixent ce contrat : un libellé qui se met à deviner, un
 * « ∞ » rendu comme un nombre, un dépliage de refus qui perd une cause.
 */
import { describe, expect, it } from 'vitest';
import {
  DEPOSIT_MODES,
  GROUP_AUDIT_LABELS,
  RATE_ACTION_LABELS,
  depositModeLabel,
  depositsNeededLabel,
  describeRateChange,
  formatAmount,
  formatPct,
  frequencyLabel,
  groupAuditLabel,
  rateActionLabel,
  rateStatusLabel,
  rateStatusTone,
  summarizeGroupAudit,
  validateAnnualRate,
  type GroupAuditRow,
  type RateChangeRow,
} from '@/services/savingsApi';

describe('statut de taux', () => {
  it('mappe les codes serveur, montre un code inconnu tel quel', () => {
    expect(rateStatusLabel('actif')).toBe('Actif');
    expect(rateStatusLabel('suspendu')).toBe('Suspendu');
    expect(rateStatusLabel('bloque')).toBe('Bloqué');
    expect(rateStatusLabel('zombie')).toBe('zombie');
  });

  it('donne une tonalité par statut, neutre pour l’inconnu', () => {
    expect(rateStatusTone('actif')).toContain('emerald');
    expect(rateStatusTone('suspendu')).toContain('amber');
    expect(rateStatusTone('bloque')).toContain('red');
    expect(rateStatusTone('???')).toContain('slate');
  });
});

describe('actions de taux', () => {
  it('couvre exactement les actions du serveur', () => {
    expect(Object.keys(RATE_ACTION_LABELS).sort()).toEqual(['block', 'rate_update', 'resume', 'suspend']);
  });

  it('libelle une action, montre un code inconnu tel quel', () => {
    expect(rateActionLabel('rate_update')).toBe('Modification du taux');
    expect(rateActionLabel('block')).toBe('Blocage (taux 0%)');
    expect(rateActionLabel('mystere')).toBe('mystere');
  });
});

describe('formatPct — n’affiche que ce que le serveur a servi', () => {
  it('formate un pourcentage fr-FR', () => {
    expect(formatPct(6)).toBe('6 %');
    expect(formatPct(0.5, 4)).toBe('0,5 %');
    expect(formatPct(0.375)).toBe('0,375 %');
  });

  it('rend un tiret plutôt qu’un NaN quand la valeur manque', () => {
    expect(formatPct(null)).toBe('—');
    expect(formatPct(undefined)).toBe('—');
    expect(formatPct(Number.NaN)).toBe('—');
  });
});

describe('formatAmount — montant servi, jamais converti', () => {
  it('accole la devise et garde deux décimales', () => {
    expect(formatAmount(100.5, 'USD')).toBe('100,50 USD');
    expect(formatAmount(1000.5, 'CDF')).toMatch(/^1\s?000,50 CDF$/);
  });

  it('rend 0,00 plutôt qu’un tiret sur une valeur absente (un solde nul est une info)', () => {
    expect(formatAmount(null, 'USD')).toBe('0,00 USD');
    expect(formatAmount(undefined, null)).toBe('0,00');
  });
});

describe('describeRateChange — restitution d’une ligne d’historique servie', () => {
  const row: RateChangeRow = {
    id: 3, annualRate: 6, monthlyRate: 0.5, status: 'actif', action: 'rate_update',
    effectiveDate: '2026-07-01', reason: 'Campagne', actor: 'admin-1', date: '2026-07-01T10:00:00Z',
  };

  it('reprend le taux annuel ET le mensuel du serveur, sans recalcul', () => {
    const { actionLabel, detail } = describeRateChange(row);
    expect(actionLabel).toBe('Modification du taux');
    expect(detail).toBe('Taux annuel 6 % · mensuel 0,5 % · statut Actif · motif : Campagne');
  });

  it('omet le motif quand il est vide', () => {
    expect(describeRateChange({ ...row, reason: '' }).detail)
      .toBe('Taux annuel 6 % · mensuel 0,5 % · statut Actif');
  });
});

describe('modes de dépôt — nomenclature canonique du serveur', () => {
  it('n’expose que les canaux acceptés par le serveur (pas virement/especes)', () => {
    expect(DEPOSIT_MODES.map((m) => m.id)).toEqual(['agent', 'mobile_money', 'bank', 'wallet']);
    expect(DEPOSIT_MODES.map((m) => m.id)).not.toContain('virement');
  });

  it('libelle un mode, montre un code inconnu tel quel', () => {
    expect(depositModeLabel('mobile_money')).toBe('Mobile Money');
    expect(depositModeLabel('virement')).toBe('virement');
  });
});

describe('frequencyLabel', () => {
  it('mappe les fréquences, montre l’inconnu tel quel', () => {
    expect(frequencyLabel('mensuel')).toBe('Mensuel');
    expect(frequencyLabel('trimestriel')).toBe('Trimestriel');
    expect(frequencyLabel('lunaire')).toBe('lunaire');
  });
});

describe('depositsNeededLabel — jamais « ∞ » comme un nombre', () => {
  it('rend le nombre servi', () => {
    expect(depositsNeededLabel(4)).toBe('4');
    expect(depositsNeededLabel(0)).toBe('0');
  });

  it('DIT que ce n’est pas calculable quand le serveur renvoie null', () => {
    expect(depositsNeededLabel(null)).toBe('Non calculable (aucun versement périodique)');
    expect(depositsNeededLabel(undefined)).toBe('Non calculable (aucun versement périodique)');
  });
});

describe('validateAnnualRate — garde-fou de saisie (le serveur reste l’autorité)', () => {
  it('accepte un taux dans les bornes', () => {
    expect(validateAnnualRate('5.5', 6)).toBeNull();
    expect(validateAnnualRate('0', 6)).toBeNull();
    expect(validateAnnualRate('6', 6)).toBeNull();
  });

  it('refuse hors bornes ou illisible, avec un message précis', () => {
    expect(validateAnnualRate('abc', 6)).toBe('Taux invalide.');
    expect(validateAnnualRate('-1', 6)).toBe('Le taux ne peut pas être négatif.');
    expect(validateAnnualRate('7', 6)).toBe('Le taux ne peut excéder 6 %.');
  });

  it('tolère la virgule décimale à la française', () => {
    expect(validateAnnualRate('5,5', 6)).toBeNull();
  });
});

describe('journal d’audit de groupe — mapping serveur', () => {
  it('couvre les actions serveur connues', () => {
    expect(Object.keys(GROUP_AUDIT_LABELS).sort()).toEqual([
      'savings.group.assign_member',
      'savings.group.create',
      'savings.group.integration_decision',
      'savings.group.update',
    ]);
  });

  it('libelle une action, montre un code inconnu tel quel', () => {
    expect(groupAuditLabel('savings.group.assign_member')).toBe('Affectation de membre');
    expect(groupAuditLabel('savings.group.mystere')).toBe('savings.group.mystere');
  });

  const base: GroupAuditRow = { id: 1, action: '', actor: 'admin', details: {}, date: '2026-07-01T00:00:00Z' };

  it('résume une affectation (et une désaffectation)', () => {
    expect(summarizeGroupAudit({ ...base, action: 'savings.group.assign_member', details: { userSub: 'u-9', groupName: 'AVEC Goma' } }))
      .toBe('u-9 affecté au groupe « AVEC Goma »');
    expect(summarizeGroupAudit({ ...base, action: 'savings.group.assign_member', details: { userSub: 'u-9', groupName: null } }))
      .toBe('u-9 retiré de son groupe');
  });

  it('résume une mise à jour de paramètres', () => {
    expect(summarizeGroupAudit({ ...base, action: 'savings.group.update', details: { rate: '5.5', frequency: 'mensuel' } }))
      .toBe('taux 5.5 %, fréquence Mensuel');
  });

  it('résume une décision d’adhésion', () => {
    expect(summarizeGroupAudit({ ...base, action: 'savings.group.integration_decision', details: { decision: 'approved' } }))
      .toBe('Demande approuvée');
    expect(summarizeGroupAudit({ ...base, action: 'savings.group.integration_decision', details: { decision: 'rejected' } }))
      .toBe('Demande rejetée');
  });

  it('ne fabrique aucun sens sur une action inconnue', () => {
    expect(summarizeGroupAudit({ ...base, action: 'savings.group.create', details: {} })).toBe('');
    expect(summarizeGroupAudit({ ...base, action: 'savings.group.???', details: { foo: 'bar' } })).toBe('');
  });
});

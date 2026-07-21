/**
 * Helpers de présentation partagés par les quatre écrans du backoffice crédit
 * (`src/pages/credit/wire.ts`).
 *
 * Trois familles de pièges y sont figées :
 *   1. les formateurs qui confondent « zéro » et « absent » — un montant à 0 est
 *      une information, pas un trou ;
 *   2. `ageInDays`, qui sert au tri de la file d'instruction : une ancienneté
 *      négative (horloge du poste en avance sur le serveur) doit se lire 0, pas
 *      remonter un dossier en tête de file ;
 *   3. `consentState`, seul endroit du front qui DÉRIVE un état que le backend
 *      n'expose pas (« expiré ») — donc le seul qui puisse mentir.
 *
 * Les constantes de troncature (`PENDING_LIST_CAP`, `AUDIT_ROWS_CAP`) sont des
 * MIROIRS de valeurs serveur : ces tests garantissent qu'on ne les change pas
 * par mégarde, ils ne garantissent pas qu'elles soient encore justes côté
 * serveur (cf. l'avertissement en tête de `vitest.config.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_ROWS_CAP,
  PENDING_LIST_CAP,
  STATUS_LABELS,
  ageInDays,
  consentState,
  fmtAmount,
  fmtDate,
  fmtDateTime,
  statusOf,
} from '@/pages/credit/wire';

afterEach(() => {
  vi.useRealTimers();
});

describe('statusOf', () => {
  it('traduit les statuts connus du backoffice', () => {
    expect(statusOf('in_analysis').label).toBe('En analyse');
    expect(statusOf('adjourned').label).toBe('Ajourné');
    expect(statusOf('pending_disbursement').label).toBe('En décaissement');
  });

  it('affiche un statut inconnu tel quel, sans le rattacher', () => {
    const meta = statusOf('escalated_to_committee');

    expect(meta.label).toBe('escalated_to_committee');
    expect(meta.color).toBeTruthy();
  });

  it('couvre les neuf statuts de la machine à états', () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([
      'active', 'adjourned', 'approved', 'closed', 'draft',
      'in_analysis', 'pending_disbursement', 'rejected', 'submitted',
    ]);
  });
});

describe('fmtAmount', () => {
  it('affiche un montant nul comme « 0 », jamais comme « — »', () => {
    // Le piège classique : `if (!amount)` transformerait un solde à zéro en
    // absence de donnée. Une couverture de garantie à 0 est un FAIT.
    expect(fmtAmount(0, 'USD')).toBe('0 USD');
  });

  it('n’affiche « — » que sur une valeur réellement absente', () => {
    expect(fmtAmount(null, 'USD')).toBe('—');
    expect(fmtAmount(undefined, 'USD')).toBe('—');
  });

  it('formate en fr-FR et suffixe la devise servie', () => {
    const s = fmtAmount(1234567.891, 'CDF');

    // Assertions sur la structure et non sur l'octet exact : le séparateur de
    // milliers fr-FR varie selon la version d'ICU (espace fine insécable).
    expect(s.endsWith(' CDF')).toBe(true);
    expect(s).toContain('567,89'); // deux décimales max
    expect(s).not.toContain('1234567');
  });

  it('ne suppose aucune devise par défaut', () => {
    expect(fmtAmount(10, 'USD')).toContain('USD');
    expect(fmtAmount(10, 'CDF')).toContain('CDF');
  });
});

describe('fmtDate / fmtDateTime', () => {
  it('affichent « — » sur une date absente', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('')).toBe('—');
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDateTime('')).toBe('—');
  });

  it('rendent une date ISO serveur au format fr-FR', () => {
    expect(fmtDate('2026-03-09T10:30:00Z')).toMatch(/^\d{2}\/\d{2}\/2026$/);
    expect(fmtDateTime('2026-03-09T10:30:00Z')).toMatch(/^\d{2}\/\d{2}\/2026/);
  });
});

describe('ageInDays — tri de la file d’instruction', () => {
  it('compte des jours PLEINS écoulés', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));

    expect(ageInDays('2026-03-07T12:00:00Z')).toBe(3);
    expect(ageInDays('2026-03-07T13:00:00Z')).toBe(2); // 2 j 23 h → 2 jours pleins
    expect(ageInDays('2026-03-10T11:00:00Z')).toBe(0);
  });

  it('borne à 0 une date future plutôt que de renvoyer un négatif', () => {
    // Poste client en retard sur le serveur : un âge négatif propulserait le
    // dossier en tête (ou en fin) de la file selon le sens du tri.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));

    expect(ageInDays('2026-03-11T12:00:00Z')).toBe(0);
  });

  it('distingue « pas de date » de « zéro jour »', () => {
    expect(ageInDays(null)).toBeNull();
    expect(ageInDays(undefined)).toBeNull();
    expect(ageInDays('')).toBeNull();
  });
});

describe('consentState — le seul état DÉRIVÉ côté front', () => {
  it('renvoie « none » sur un dossier que le client a déposé lui-même', () => {
    // Pas de mandat → pas de consentement à recueillir, quels que soient les
    // autres champs. Aucun badge ne doit apparaître sur ces dossiers.
    expect(consentState({ isOnBehalfOf: false, pendingClientConsent: true })).toBe('none');
    expect(consentState({})).toBe('none');
  });

  it('renvoie « given » dès que le serveur a horodaté le consentement', () => {
    expect(consentState({
      isOnBehalfOf: true,
      clientConsentAt: '2026-03-08T09:00:00Z',
      pendingClientConsent: true,
    })).toBe('given');
  });

  it('renvoie « pending » sur la décision du SERVEUR, pas sur une horloge locale', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));

    // Fenêtre déjà écoulée d'après le navigateur, mais le serveur dit encore
    // « en attente » : c'est le serveur qui tranche.
    expect(consentState({
      isOnBehalfOf: true,
      pendingClientConsent: true,
      clientConsentExpires: '2026-03-09T12:00:00Z',
    })).toBe('pending');
  });

  it('ne conclut « expired » qu’en repli, quand le serveur ne dit plus rien', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));

    expect(consentState({
      isOnBehalfOf: true,
      pendingClientConsent: false,
      clientConsentExpires: '2026-03-09T12:00:00Z',
    })).toBe('expired');
  });

  it('n’invente pas d’expiration sur une fenêtre encore ouverte', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00Z'));

    expect(consentState({
      isOnBehalfOf: true,
      pendingClientConsent: false,
      clientConsentExpires: '2026-03-11T12:00:00Z',
    })).toBe('none');
  });
});

describe('plafonds de troncature serveur (miroirs documentés)', () => {
  it('fige les valeurs recopiées du backend', () => {
    // `_committee_dashboard` sert `[:20]`, `audit.views.entries` `qs[:500]`.
    // Ces constantes servent à ANNONCER la troncature ; les changer sans changer
    // le serveur ferait mentir l'écran dans l'autre sens.
    expect(PENDING_LIST_CAP).toBe(20);
    expect(AUDIT_ROWS_CAP).toBe(500);
  });
});

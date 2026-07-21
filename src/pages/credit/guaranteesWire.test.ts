/**
 * Suivi des garanties : classement par statut, montant opposable, tri, droits.
 *
 * Le principe 9 (« toute garantie est opposable ou n'est pas ») se joue
 * intégralement ici, à deux endroits :
 *
 *   - `retainedAmountOf` doit sélectionner la valeur RETENUE par le serveur et
 *     ne JAMAIS retomber sur la valeur déclarée par le client. Un repli
 *     silencieux transformerait une moto déclarée à 3 000 USD et non encore
 *     vérifiée en couverture de 3 000 USD ;
 *   - `queueOf` doit ranger sur le STATUT SERVEUR seul. Reclasser une caution
 *     parce que l'horloge du navigateur dit que sa fenêtre est écoulée ferait
 *     disparaître une ligne de la file de travail d'un agent alors que le
 *     serveur, lui, l'y attend toujours.
 */
import { describe, expect, it } from 'vitest';
import {
  APPLICATIONS_CAP,
  GUARANTEE_STATUS_META,
  QUEUES,
  type GuaranteeRow,
  type GuaranteeSourceApplication,
  type GuaranteeStatus,
  type WireGuaranteeItem,
  byUrgency,
  canInstruct,
  decisionAt,
  declaredAmountOf,
  isConfirmable,
  isReleasable,
  queueOf,
  retainedAmountOf,
  statusMeta,
  toGuaranteeRows,
} from '@/pages/credit/guaranteesWire';

const TOUS_STATUTS: GuaranteeStatus[] = [
  'pending', 'pending_consent', 'consented', 'declined',
  'active', 'released', 'expired', 'called',
];

function row(guarantee: Partial<WireGuaranteeItem>, extra: Partial<GuaranteeRow> = {}): GuaranteeRow {
  return {
    guarantee: {
      id: 1,
      type: 'morale',
      status: 'pending',
      coveredAmount: null,
      createdAt: '2026-03-01T08:00:00Z',
      ...guarantee,
    },
    applicationCode: 'CR-0001',
    applicationStatus: 'in_analysis',
    applicationCurrency: 'USD',
    clientName: 'Mwamba K.',
    valueChainLabel: 'Maïs',
    ...extra,
  };
}

describe('queueOf — rangement par statut serveur', () => {
  it('range chacun des huit statuts', () => {
    expect(queueOf('pending_consent')).toBe('consent');
    expect(queueOf('consented')).toBe('confirm');
    expect(queueOf('pending')).toBe('confirm');
    expect(queueOf('active')).toBe('release');
    expect(queueOf('released')).toBe('release');
    expect(queueOf('called')).toBe('called');
    expect(queueOf('declined')).toBe('closed');
    expect(queueOf('expired')).toBe('closed');
  });

  it('range un statut inconnu dans « sans suite » plutôt que de le perdre', () => {
    expect(queueOf('some_new_status')).toBe('closed');
    expect(queueOf('')).toBe('closed');
  });

  it('invariant : aucune garantie ne tombe hors des files affichées', () => {
    const ids = new Set(QUEUES.map((q) => q.id));
    for (const statut of TOUS_STATUTS) {
      expect(ids.has(queueOf(statut)), `« ${statut} » tombe hors des files`).toBe(true);
    }
  });

  it('invariant : chaque file déclarée est atteignable par au moins un statut', () => {
    const atteintes = new Set(TOUS_STATUTS.map(queueOf));
    for (const q of QUEUES) {
      expect(atteintes.has(q.id), `la file « ${q.id} » n’est jamais alimentée`).toBe(true);
    }
  });
});

describe('statusMeta', () => {
  it('libelle les huit statuts canoniques', () => {
    for (const statut of TOUS_STATUTS) {
      expect(GUARANTEE_STATUS_META[statut].label).toBeTruthy();
      expect(GUARANTEE_STATUS_META[statut].className).toBeTruthy();
    }
  });

  it('affiche un statut inconnu tel quel', () => {
    expect(statusMeta('subrogated').label).toBe('subrogated');
  });

  it('distingue le refus du garant de l’expiration de la fenêtre', () => {
    // Deux issues très différentes du même parcours : les confondre effacerait
    // la trace d'un refus explicite.
    expect(statusMeta('declined').label).not.toBe(statusMeta('expired').label);
  });
});

describe('retainedAmountOf — jamais la valeur déclarée', () => {
  it('caution solidaire : prend `retainedCoverage` (décote serveur appliquée)', () => {
    const r = retainedAmountOf(row({ type: 'morale', retainedCoverage: 450 }));

    expect(r.value).toBe(450);
    expect(r.currency).toBe('USD');
    expect(r.basis).toContain('serveur');
  });

  it('nantissement épargne : prend `holdAmount` et SA devise', () => {
    const r = retainedAmountOf(row({
      type: 'epargne', holdAmount: 1200, holdCurrency: 'CDF',
    }));

    expect(r.value).toBe(1200);
    expect(r.currency).toBe('CDF');
  });

  it('gage matériel : prend la valeur retenue de l’actif, pas la déclarée', () => {
    const r = retainedAmountOf(row({
      type: 'materiel',
      asset: {
        id: 7, name: 'Motoculteur', category: 'equipement',
        declaredValue: 3000, retainedValue: 1800,
        currency: 'USD', status: 'verifie', verifiedAt: '2026-03-04T09:00:00Z',
      },
    }));

    expect(r.value).toBe(1800);
    expect(r.value).not.toBe(3000);
  });

  it('RÈGLE CARDINALE : un actif non encore évalué ne couvre RIEN', () => {
    const ligne = row({
      type: 'foncier',
      asset: {
        id: 8, name: 'Parcelle Kabinda', category: 'foncier',
        declaredValue: 9000, retainedValue: null,
        currency: 'USD', status: 'declare', verifiedAt: null,
      },
    });

    const r = retainedAmountOf(ligne);

    expect(r.value).toBeNull();
    // La valeur déclarée reste consultable, mais explicitement libellée comme telle.
    expect(declaredAmountOf(ligne).value).toBe(9000);
  });

  it('renvoie null plutôt que 0 quand le serveur n’a pas arrêté de montant', () => {
    // 0 signifierait « couverture nulle constatée » ; null signifie « pas encore
    // évalué ». Les deux ne se disent pas de la même façon à un analyste.
    expect(retainedAmountOf(row({ type: 'morale' })).value).toBeNull();
    expect(retainedAmountOf(row({ type: 'epargne' })).value).toBeNull();
    expect(retainedAmountOf(row({ type: 'materiel' })).value).toBeNull();
  });

  it('retombe sur la devise du dossier quand la garantie n’en porte pas', () => {
    const r = retainedAmountOf(row({ type: 'epargne', holdAmount: 50 }, {
      applicationCurrency: 'CDF',
    }));

    expect(r.currency).toBe('CDF');
  });

  it('privilégie la devise de la couverture serveur pour une caution', () => {
    const r = retainedAmountOf(row({ type: 'morale', retainedCoverage: 100 }, {
      applicationCurrency: 'CDF',
      coverage: {
        retainedTotal: 100, currency: 'USD', requestedAmount: 500,
        ratio: 0.2, activeCount: 1,
      },
    }));

    expect(r.currency).toBe('USD');
  });

  it('declaredAmountOf n’existe que pour les gages sur actif', () => {
    expect(declaredAmountOf(row({ type: 'morale', retainedCoverage: 100 })).value).toBeNull();
  });
});

describe('isConfirmable — miroir de ce que le serveur accepte', () => {
  it('caution : confirmable depuis `consented` et `pending` uniquement', () => {
    expect(isConfirmable(row({ type: 'morale', status: 'consented' }))).toBe(true);
    expect(isConfirmable(row({ type: 'morale', status: 'pending' }))).toBe(true);
    expect(isConfirmable(row({ type: 'morale', status: 'pending_consent' }))).toBe(false);
    expect(isConfirmable(row({ type: 'morale', status: 'declined' }))).toBe(false);
    expect(isConfirmable(row({ type: 'morale', status: 'expired' }))).toBe(false);
    expect(isConfirmable(row({ type: 'morale', status: 'active' }))).toBe(false);
  });

  it('gage : confirmable depuis `pending` seulement', () => {
    for (const type of ['materiel', 'foncier'] as const) {
      expect(isConfirmable(row({ type, status: 'pending' }))).toBe(true);
      expect(isConfirmable(row({ type, status: 'consented' }))).toBe(false);
      expect(isConfirmable(row({ type, status: 'active' }))).toBe(false);
    }
  });

  it('épargne : jamais confirmable — le cash est bloqué au moment du geste', () => {
    for (const statut of TOUS_STATUTS) {
      expect(isConfirmable(row({ type: 'epargne', status: statut }))).toBe(false);
    }
  });

  it('ne propose jamais de confirmer une caution refusée par son garant', () => {
    // Le pire faux positif possible de cet écran : rendre opposable une caution
    // que le garant a explicitement refusée.
    expect(isConfirmable(row({ type: 'morale', status: 'declined' }))).toBe(false);
  });
});

describe('isReleasable', () => {
  it('ne propose la libération que sur ce qui immobilise réellement', () => {
    expect(isReleasable(row({ status: 'active' }))).toBe(true);
    expect(isReleasable(row({ status: 'pending' }))).toBe(true);
  });

  it('ne propose rien sur une garantie déjà sortie du circuit', () => {
    for (const statut of ['released', 'declined', 'expired', 'called',
      'consented', 'pending_consent'] as GuaranteeStatus[]) {
      expect(isReleasable(row({ status: statut })), statut).toBe(false);
    }
  });
});

describe('canInstruct — politesse d’affichage, jamais une sécurité', () => {
  it('reconnaît les rôles de `CAN_INSTRUCT`', () => {
    for (const role of ['agent_terrain', 'agent_cash', 'gest_credit', 'gest_port',
      'manager', 'gest_zone', 'dg', 'dir_ops', 'admin']) {
      expect(canInstruct(role), role).toBe(true);
    }
  });

  it('refuse tout le reste, y compris l’absence de rôle', () => {
    expect(canInstruct('client')).toBe(false);
    expect(canInstruct('investisseur')).toBe(false);
    expect(canInstruct('auditeur')).toBe(false);
    expect(canInstruct(null)).toBe(false);
    expect(canInstruct(undefined)).toBe(false);
    expect(canInstruct('')).toBe(false);
  });

  it('n’accepte pas une variante de casse ou d’espacement', () => {
    expect(canInstruct('ADMIN')).toBe(false);
    expect(canInstruct(' admin')).toBe(false);
  });
});

describe('toGuaranteeRows — aplatissement des dossiers', () => {
  const apps: GuaranteeSourceApplication[] = [
    {
      code: 'CR-0001',
      status: 'in_analysis',
      currency: 'USD',
      client: { displayName: 'Mwamba K.', sub: 'sub-1' },
      valueChain: { code: '01', label: 'Maïs' },
      guarantees: {
        count: 2,
        guaranteeType: 'morale',
        items: [
          { id: 1, type: 'morale', status: 'pending_consent', coveredAmount: null, createdAt: '2026-03-01T08:00:00Z' },
          { id: 2, type: 'epargne', status: 'active', coveredAmount: 300, createdAt: '2026-03-02T08:00:00Z' },
        ],
        coverage: {
          retainedTotal: 300, currency: 'USD', requestedAmount: 1000,
          ratio: 0.3, activeCount: 1,
        },
      },
    },
    {
      code: 'CR-0002',
      status: 'submitted',
      currency: 'CDF',
      client: { sub: 'sub-2' },
      valueChain: null,
      guarantees: { count: 0, guaranteeType: null, items: [] },
    },
    { code: 'CR-0003', status: 'draft', currency: 'USD', client: null, guarantees: undefined },
  ];

  it('produit une ligne par garantie, dossiers sans garantie ignorés', () => {
    const rows = toGuaranteeRows(apps);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.guarantee.id)).toEqual([1, 2]);
  });

  it('replace chaque garantie dans SON dossier', () => {
    const [premiere] = toGuaranteeRows(apps);

    expect(premiere.applicationCode).toBe('CR-0001');
    expect(premiere.applicationStatus).toBe('in_analysis');
    expect(premiere.applicationCurrency).toBe('USD');
    expect(premiere.valueChainLabel).toBe('Maïs');
  });

  it('reprend le `coverage` du serveur tel quel, sans jamais le recomposer', () => {
    const rows = toGuaranteeRows(apps);

    // Le total de couverture n'est PAS la somme des lignes affichées : il est
    // calculé serveur après décotes. Le refaire côté front donnerait un autre
    // chiffre, et le mauvais.
    expect(rows[0].coverage?.retainedTotal).toBe(300);
    expect(rows[0].coverage).toBe(rows[1].coverage);
  });

  it('replie sur le `sub` puis sur « — » quand le nom d’affichage manque', () => {
    const rows = toGuaranteeRows([
      { ...apps[0], client: { sub: 'sub-9' } },
      { ...apps[0], code: 'CR-0009', client: null },
    ]);

    expect(rows[0].clientName).toBe('sub-9');
    expect(rows[2].clientName).toBe('—');
  });

  it('ne plante pas sur un tableau vide', () => {
    expect(toGuaranteeRows([])).toEqual([]);
  });
});

describe('byUrgency — tri, pas priorisation métier', () => {
  it('met en tête l’échéance de consentement la plus proche', () => {
    const rows = [
      row({ id: 1, consentExpiresAt: '2026-03-12T10:00:00Z' }),
      row({ id: 2, consentExpiresAt: '2026-03-10T10:00:00Z' }),
      row({ id: 3, consentExpiresAt: '2026-03-11T10:00:00Z' }),
    ];

    expect([...rows].sort(byUrgency).map((r) => r.guarantee.id)).toEqual([2, 3, 1]);
  });

  it('fait passer toute ligne à échéance avant les lignes sans échéance', () => {
    const avec = row({ id: 1, consentExpiresAt: '2027-01-01T00:00:00Z' });
    const sans = row({ id: 2, createdAt: '2026-03-09T08:00:00Z' });

    expect(byUrgency(avec, sans)).toBeLessThan(0);
    expect(byUrgency(sans, avec)).toBeGreaterThan(0);
  });

  it('classe les lignes sans échéance de la plus récente à la plus ancienne', () => {
    const rows = [
      row({ id: 1, createdAt: '2026-03-01T08:00:00Z' }),
      row({ id: 2, createdAt: '2026-03-05T08:00:00Z' }),
      row({ id: 3, createdAt: '2026-03-03T08:00:00Z' }),
    ];

    expect([...rows].sort(byUrgency).map((r) => r.guarantee.id)).toEqual([2, 3, 1]);
  });

  it('trie un lot mixte de façon déterministe', () => {
    const rows = [
      row({ id: 1, createdAt: '2026-03-01T08:00:00Z' }),
      row({ id: 2, consentExpiresAt: '2026-03-11T10:00:00Z' }),
      row({ id: 3, createdAt: '2026-03-06T08:00:00Z' }),
      row({ id: 4, consentExpiresAt: '2026-03-09T10:00:00Z' }),
    ];

    expect([...rows].sort(byUrgency).map((r) => r.guarantee.id)).toEqual([4, 2, 3, 1]);
  });
});

describe('decisionAt — horodatage de la décision du garant', () => {
  it('donne la priorité au consentement, puis au refus, puis à la constitution', () => {
    expect(decisionAt(row({ consentedAt: '2026-03-05T08:00:00Z' })).label).toBe('Consentement');
    expect(decisionAt(row({ declinedAt: '2026-03-05T08:00:00Z' })).label).toBe('Refus');
    expect(decisionAt(row({ confirmedAt: '2026-03-05T08:00:00Z' })).label).toBe('Constitution');
  });

  it('conserve la trace d’un refus — jamais supprimée (principe 3)', () => {
    const d = decisionAt(row({ status: 'declined', declinedAt: '2026-03-05T08:00:00Z' }));

    expect(d.at).toBe('2026-03-05T08:00:00Z');
    expect(d.label).toBe('Refus');
  });

  it('renvoie une décision vide quand le garant n’a pas répondu', () => {
    const d = decisionAt(row({ status: 'pending_consent' }));

    expect(d.at).toBeNull();
    expect(d.label).toBe('Décision');
  });
});

describe('plafond de troncature (miroir documenté)', () => {
  it('fige `list_applications` à 100 lignes', () => {
    expect(APPLICATIONS_CAP).toBe(100);
  });
});

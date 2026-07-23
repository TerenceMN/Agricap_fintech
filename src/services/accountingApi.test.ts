import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  accountingApi,
  deplierErreur,
  formatMontant,
  formatMontantDevise,
  libelleJournal,
  libelleNature,
  libelleSens,
  libelleSourceTaux,
  libelleStatutDemande,
  libelleStatutPiece,
  libelleUsageTaux,
  pieceEquilibree,
  pourcentDepuisFraction,
  qs,
} from '@/services/accountingApi';

// ─────────────────────────────────────────────────────────────── OUTILLAGE HTTP

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(res: Response) {
  const fn = vi.fn((_url: string, _init?: RequestInit): Promise<Response> => Promise.resolve(res));
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function capture(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw new Error(`exception inattendue : ${String(err)}`);
  }
  throw new Error('la requête aurait dû échouer');
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  sessionStorage.clear(); // pas de refresh_token → un 401 ne déclenche aucun aller-retour IdP
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────── qs()

describe('qs — sérialisation des filtres', () => {
  it('ignore les valeurs vides (undefined, null, chaîne vide)', () => {
    expect(qs({ devise: 'USD', journal: undefined, statut: null, compte: '' })).toBe('?devise=USD');
  });

  it('rend une chaîne vide quand aucun filtre exploitable', () => {
    expect(qs({ a: undefined, b: '' })).toBe('');
  });

  it('sérialise les nombres et les booléens', () => {
    expect(qs({ limit: 50, actif: true })).toBe('?limit=50&actif=true');
  });

  it('encode les caractères spéciaux', () => {
    expect(qs({ q: '413 FC' })).toBe('?q=413+FC');
  });

  it('laisse passer un zéro numérique (offset=0 est un filtre légitime, pas une absence)', () => {
    expect(qs({ offset: 0 })).toBe('?offset=0');
  });
});

// ─────────────────────────────────────────────────────────────── formatMontant()

// Séparateur de milliers fr-FR : ESPACE FINE INSÉCABLE (U+202F), ce que produit
// `Intl.NumberFormat('fr-FR')`. Explicité ici car invisible à l'œil dans une chaîne littérale.
const S = ' ';

describe('formatMontant — un seul formateur, séparateurs fr-FR, sur CHAÎNE Decimal', () => {
  it('groupe les milliers avec une espace fine insécable et une virgule décimale', () => {
    expect(formatMontant('1234.56')).toBe(`1${S}234,56`);
    expect(formatMontant('1234567.89')).toBe(`1${S}234${S}567,89`);
  });

  it('affiche 0 comme un chiffre, jamais comme une absence', () => {
    expect(formatMontant('0')).toBe('0');
    expect(formatMontant('0.00')).toBe('0,00');
  });

  it('rend un tiret sur une absence (null) — une absence n’est pas un zéro', () => {
    expect(formatMontant(null)).toBe('—');
    expect(formatMontant('')).toBe('—');
    expect(formatMontant(null, { vide: 'n/d' })).toBe('n/d');
  });

  it('préserve le signe négatif', () => {
    expect(formatMontant('-1234.5', { decimales: 2 })).toBe(`-1${S}234,50`);
  });

  it('force le nombre de décimales quand demandé, sinon préserve celles reçues', () => {
    expect(formatMontant('12', { decimales: 2 })).toBe('12,00');
    expect(formatMontant('12.5')).toBe('12,5');
  });

  it('ne perd JAMAIS un chiffre sur un très grand montant (pas de passage par float)', () => {
    // 12 345 678 901 234 567 890,99 dépasse la précision d’un double : la chaîne est reine.
    expect(formatMontant('12345678901234567890.99'))
      .toBe(`12${S}345${S}678${S}901${S}234${S}567${S}890,99`);
  });

  it('rend une valeur non parsable telle quelle plutôt que « NaN » — on n’invente rien', () => {
    expect(formatMontant('non-un-nombre')).toBe('non-un-nombre');
  });

  it('accole la devise quand elle est fournie', () => {
    expect(formatMontant('2800', { devise: 'FC' })).toBe(`2${S}800 FC`);
    expect(formatMontantDevise('100.00', 'USD')).toBe('100,00 USD');
    expect(formatMontantDevise(null, 'USD')).toBe('—');
  });
});

// ─────────────────────────────────────────────────────────── pourcentDepuisFraction()

describe('pourcentDepuisFraction — conversion d’unité (× 100), pas calcul métier', () => {
  it('convertit une fraction serveur en pourcentage d’affichage', () => {
    expect(pourcentDepuisFraction('0.2500')).toBe('25,00 %');
    expect(pourcentDepuisFraction('1')).toBe('100,00 %');
    expect(pourcentDepuisFraction('0.0075')).toBe('0,75 %');
  });

  it('affiche 0 comme un taux nul, pas une absence', () => {
    expect(pourcentDepuisFraction('0')).toBe('0,00 %');
    expect(pourcentDepuisFraction('0.0000')).toBe('0,00 %');
  });

  it('rend un tiret sur une absence', () => {
    expect(pourcentDepuisFraction(null)).toBe('—');
  });
});

// ─────────────────────────────────────────────────────────────── libellés

describe('libellés — mappe le code canonique, NE DEVINE JAMAIS un code inconnu', () => {
  it('traduit les codes connus', () => {
    expect(libelleJournal('JOD')).toBe('Journal opérations diverses');
    expect(libelleStatutPiece('VALIDEE')).toBe('Validée');
    expect(libelleStatutDemande('EN_ATTENTE')).toBe('En attente');
    expect(libelleNature('ACTIF')).toBe('Actif');
    expect(libelleUsageTaux('CLOTURE')).toBe('Clôture');
    expect(libelleSourceTaux('BCC')).toBe('Banque Centrale du Congo');
    expect(libelleSens('DEBIT')).toBe('Débit');
  });

  it('rend le code TEL QUEL quand il est inconnu (jamais un libellé inventé)', () => {
    expect(libelleJournal('JXX')).toBe('JXX');
    expect(libelleStatutPiece('ARCHIVEE')).toBe('ARCHIVEE');
  });

  it('rend un tiret sur un code absent', () => {
    expect(libelleJournal(null)).toBe('—');
    expect(libelleNature(undefined)).toBe('—');
  });
});

// ─────────────────────────────────────────────────────────────── pieceEquilibree()

describe('pieceEquilibree — LIT le verdict serveur, ne re-somme pas les lignes', () => {
  it('vrai seulement si TOUTES les devises sont équilibrées', () => {
    expect(pieceEquilibree([
      { devise: 'FC', debit: '100', credit: '100', equilibre: true },
      { devise: 'USD', debit: '5', credit: '5', equilibre: true },
    ])).toBe(true);
  });

  it('faux dès qu’une devise ne l’est pas', () => {
    expect(pieceEquilibree([
      { devise: 'FC', debit: '100', credit: '100', equilibre: true },
      { devise: 'USD', debit: '5', credit: '4', equilibre: false },
    ])).toBe(false);
  });

  it('null quand on ne sait pas (aucun total) — pas de verdict inventé', () => {
    expect(pieceEquilibree([])).toBeNull();
    expect(pieceEquilibree(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────── deplierErreur()

describe('deplierErreur — restitue chaque refus d’un 422 multi-erreurs', () => {
  it('déplie la liste errors[] quand elle existe', () => {
    const err = new ApiError(422, 'Refusé', 'VALIDATION', [
      { code: 'DESEQUILIBRE', message: 'FC : débit ≠ crédit.' },
      { code: 'COMPTE_INCONNU', message: '413ZZ introuvable.' },
    ]);
    expect(deplierErreur(err)).toEqual([
      { code: 'DESEQUILIBRE', message: 'FC : débit ≠ crédit.' },
      { code: 'COMPTE_INCONNU', message: '413ZZ introuvable.' },
    ]);
  });

  it('retombe sur le message principal quand il n’y a pas de liste', () => {
    const err = new ApiError(409, 'Pièce déjà validée.', 'IMMUABLE', []);
    expect(deplierErreur(err)).toEqual([{ code: 'IMMUABLE', message: 'Pièce déjà validée.' }]);
  });

  it('gère une erreur non-ApiError sans planter', () => {
    expect(deplierErreur(new Error('réseau'))).toEqual([{ code: 'ERREUR', message: 'réseau' }]);
  });
});

// ─────────────────────────────────────────────────── accountingApi (routes)

describe('accountingApi — chemins et paramètres', () => {
  it('balance exige la devise et la place en query', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { devise: 'USD', results: [], equilibree: true }));
    await accountingApi.balance({ devise: 'USD', as_of: '2026-07-23' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounting/balance?devise=USD&as_of=2026-07-23',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('grand-livre passe compte et devise', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { compte: '413FC', mouvements: [] }));
    await accountingApi.grandLivre({ compte: '413FC', devise: 'FC' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounting/grand-livre?compte=413FC&devise=FC',
      expect.anything(),
    );
  });

  it('une OD part en POST avec un corps JSON', async () => {
    const fetchMock = stubFetch(jsonResponse(201, { reference: 'OD-20260723-001' }));
    await accountingApi.pieces.od({
      libelle: 'Salaire juillet',
      lignes: [{ compte: '661', devise: 'USD', debit: '100' }, { compte: '531', devise: 'USD', credit: '100' }],
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(init.body as string)).toMatchObject({ libelle: 'Salaire juillet' });
  });

  it('déplie un 422 déséquilibre en ApiError.errors', async () => {
    stubFetch(jsonResponse(422, {
      detail: 'Écriture déséquilibrée.',
      code: 'DESEQUILIBRE',
      errors: [{ code: 'DESEQUILIBRE_FC', message: 'FC : débit 100 ≠ crédit 90.' }],
    }));
    const err = await capture(accountingApi.pieces.od({ libelle: 'x', lignes: [] }));
    expect(err.status).toBe(422);
    expect(err.errors).toEqual([{ code: 'DESEQUILIBRE_FC', message: 'FC : débit 100 ≠ crédit 90.' }]);
  });

  it('remonte la RÈGLE 409 de suppression de compte (append-only)', async () => {
    stubFetch(jsonResponse(409, {
      detail: 'La suppression du compte 413FC n’existe pas : la comptabilité est append-only.',
    }));
    const err = await capture(accountingApi.comptes.suppression('413FC'));
    expect(err.status).toBe(409);
    expect(err.message).toContain('append-only');
  });
});

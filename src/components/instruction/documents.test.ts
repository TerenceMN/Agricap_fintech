import { describe, it, expect } from 'vitest';
import { construireChoixDocuments } from './documents';
import type { CreditSimulateResult, DataSource } from '@/types/api';

/** Forme de `dataio/views.py::_source_dict`. */
function source(p: Partial<DataSource> & { id: number; original_name: string }): DataSource {
  return {
    kind: 'SIMULATEUR', status: 'COMMITTED', revision: 1, is_current: true,
    dataset_key: p.original_name.toLowerCase(), uploaded_at: '2026-07-01T08:00:00Z',
    committed_at: '2026-07-01T09:00:00Z', supersedes: null, n_tables: 12,
    sha256: 'f'.repeat(64), credit_application: null, ...p,
  } as DataSource;
}

/** `refData` sert `source` / `sourceFile` / `sourceMatchesChain`, que le contrat
 *  front `CreditSimulateRefData` ne déclare pas encore : on les pose ici comme le
 *  serveur les envoie. */
function simulation(refData: Record<string, unknown>): CreditSimulateResult {
  return { refData } as unknown as CreditSimulateResult;
}

const MAIS = source({ id: 1, original_name: 'AGRICAP_FIN_SIM_01_Cereales_Mais.xlsx' });
const GENERIQUE = source({
  id: 2, original_name: 'AGRICAP_FIN_Simulateur_Credit_Cycle_Production_v4.xlsx', revision: 3,
});
const FEUILLE_CLIENT = source({
  id: 3, original_name: 'Feuille_besoins_CR-2026-0042.xlsx', kind: 'FEUILLE_BESOINS',
  credit_application: 'CR-2026-0042',
});
const ANCIENNE = source({ id: 4, original_name: 'AGRICAP_FIN_SIM_01_Cereales_Mais.xlsx', revision: 1, is_current: false });

describe('construireChoixDocuments — rendre visible le choix automatique', () => {
  it('ne retient que les classeurs SIMULATEUR courants', () => {
    const c = construireChoixDocuments([MAIS, GENERIQUE, FEUILLE_CLIENT, ANCIENNE], null);
    expect(c.documents.map((d) => d.id)).toEqual([1, 2]);
  });

  it('n’expose JAMAIS la feuille de besoins d’un autre dossier (principe 7)', () => {
    const c = construireChoixDocuments([FEUILLE_CLIENT], null);
    expect(c.documents).toEqual([]);
    expect(c.aucunDocument).toBe(true);
  });

  it('marque le document que le SERVEUR dit avoir retenu, par égalité de nom', () => {
    const c = construireChoixDocuments(
      [MAIS, GENERIQUE],
      simulation({ sourceFile: 'AGRICAP_FIN_SIM_01_Cereales_Mais.xlsx', source: 'AGRICAP_FIN_SIM_01_Cereales_Mais.xlsx', sourceMatchesChain: true }),
    );
    expect(c.documents.filter((d) => d.retenuParLeMoteur).map((d) => d.id)).toEqual([1]);
    expect(c.retenuIntrouvable).toBe(false);
    expect(c.correspondFiliere).toBe(true);
  });

  it('signale une substitution de référentiel : classeur retenu ≠ filière du dossier (P10)', () => {
    const c = construireChoixDocuments(
      [MAIS, GENERIQUE],
      simulation({
        sourceFile: 'AGRICAP_FIN_Simulateur_Credit_Cycle_Production_v4.xlsx',
        source: 'AGRICAP_FIN_Simulateur_Credit_Cycle_Production_v4.xlsx',
        sourceMatchesChain: false,
        referentielFiliere: 'AGRICAP_FIN_SIM_09_Cafe',
      }),
    );
    expect(c.correspondFiliere).toBe(false);
    expect(c.referentielFiliere).toBe('AGRICAP_FIN_SIM_09_Cafe');
  });

  it('ne conclut RIEN quand le serveur n’a pas dit si le classeur colle à la filière', () => {
    const c = construireChoixDocuments([MAIS], simulation({ sourceFile: MAIS.original_name }));
    expect(c.correspondFiliere).toBeNull();
  });

  it('signale un document retenu introuvable parmi les courants', () => {
    const c = construireChoixDocuments([MAIS], simulation({ sourceFile: 'Un_classeur_retire.xlsx' }));
    expect(c.retenuIntrouvable).toBe(true);
    expect(c.documents.some((d) => d.retenuParLeMoteur)).toBe(false);
  });

  it('ne marque aucun document quand le serveur n’a nommé aucune source', () => {
    const c = construireChoixDocuments([MAIS, GENERIQUE], simulation({}));
    expect(c.nomRetenu).toBeNull();
    expect(c.retenuIntrouvable).toBe(false);
    expect(c.documents.every((d) => !d.retenuParLeMoteur)).toBe(true);
  });

  it('survit à l’absence des deux réponses', () => {
    const c = construireChoixDocuments(null, null);
    expect(c).toMatchObject({
      documents: [], nomRetenu: null, libelleRetenu: null,
      correspondFiliere: null, retenuIntrouvable: false, aucunDocument: true,
    });
  });

  it('porte révision et empreinte : sans elles une référence n’est pas rejouable', () => {
    const c = construireChoixDocuments([GENERIQUE], null);
    expect(c.documents[0]).toMatchObject({ revision: 3, sha256: 'f'.repeat(64) });
  });
});

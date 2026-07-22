/**
 * Lecture de `GET /api/assets/history`.
 *
 * Les cas figés ici sont ceux où un écran d'historique peut mentir sans que rien
 * ne casse : un statut de filtre que le serveur refuserait, un écart déclaré →
 * retenu présenté comme une décote, ou une ligne incohérente affichée comme si
 * elle faisait foi (un actif « vérifié » sans valeur retenue ne garantit rien).
 */
import { describe, expect, it } from 'vitest';
import type { AssetRow } from '@/types/api';
import {
  anomalies, ecartDeclareRetenu, effectifsParStatut, estStatutHistorique, recitActe,
  STATUTS_HISTORIQUE,
} from './assetHistoryWire';

/** Ligne servie par `assets/views.py::_row(staff=True)` — clés exactes. */
function actif(over: Partial<AssetRow> = {}): AssetRow {
  return {
    id: 1,
    name: 'Tracteur',
    type: 'materiel',
    value: 5000,
    currency: 'USD',
    description: '',
    localisation: '',
    status: 'verifie',
    image: '',
    documents: [],
    valeurRetenue: 3500,
    isPledgeable: true,
    guaranteeType: 'materiel',
    motifRejet: null,
    verifieLe: '2026-07-10T09:00:00Z',
    createdAt: '2026-07-01T09:00:00Z',
    verifieParSub: 'agent-77',
    gageApplication: null,
    owner: { sub: 'cli-1', displayName: 'Mwamba', phone: '+243900000000' },
    ...over,
  };
}

describe('STATUTS_HISTORIQUE', () => {
  it('reprend exactement le post-déclaratif du backend, sans `declare`', () => {
    // `verification_history` accepte tout `Asset.Status` SAUF `declare`, et
    // refuse le reste en 400 `STATUT_INCONNU`. Un filtre en trop = 400 à l'écran.
    expect([...STATUTS_HISTORIQUE]).toEqual(['verifie', 'gage', 'libere', 'rejete']);
    expect(STATUTS_HISTORIQUE).not.toContain('declare');
  });

  it('reconnaît les statuts filtrables et rejette les autres', () => {
    expect(estStatutHistorique('gage')).toBe(true);
    expect(estStatutHistorique('declare')).toBe(false);
    expect(estStatutHistorique('valide')).toBe(false);
    expect(estStatutHistorique('')).toBe(false);
  });
});

describe('effectifsParStatut', () => {
  it('compte par statut et garde les statuts vides à 0', () => {
    const c = effectifsParStatut([
      actif({ id: 1, status: 'verifie' }),
      actif({ id: 2, status: 'verifie' }),
      actif({ id: 3, status: 'rejete' }),
    ]);
    expect(c).toMatchObject({ verifie: 2, rejete: 1, gage: 0, libere: 0 });
  });

  it('n’efface pas un statut inattendu — il est compté à part, pas ignoré', () => {
    // Si le backend ajoute un statut, on veut le voir, pas le perdre en silence.
    const c = effectifsParStatut([actif({ status: 'sequestre' })]);
    expect(c.sequestre).toBe(1);
  });

  it('accepte une liste vide', () => {
    expect(effectifsParStatut([])).toEqual({ verifie: 0, gage: 0, libere: 0, rejete: 0 });
  });
});

describe('ecartDeclareRetenu', () => {
  it('soustrait deux montants servis par le serveur', () => {
    expect(ecartDeclareRetenu(actif({ value: 5000, valeurRetenue: 3500 }))).toBe(1500);
  });

  it('vaut null sans valeur retenue — on n’invente pas un zéro', () => {
    // Un actif rejeté n'a pas de valeur retenue : afficher « écart 5 000 » y
    // laisserait croire à une décote de 100 %, alors qu'il n'y a pas eu d'acte
    // de valorisation du tout.
    expect(ecartDeclareRetenu(actif({ status: 'rejete', valeurRetenue: null }))).toBeNull();
  });

  it('vaut null si la valeur déclarée n’est pas un nombre exploitable', () => {
    expect(ecartDeclareRetenu(actif({ value: Number.NaN }))).toBeNull();
  });

  it('reste négatif si le serveur a retenu plus que le déclaré', () => {
    // Cas anormal mais possible ; le lisser en valeur absolue masquerait le fait.
    expect(ecartDeclareRetenu(actif({ value: 1000, valeurRetenue: 1200 }))).toBe(-200);
  });
});

describe('anomalies', () => {
  it('ne signale rien sur une ligne complète', () => {
    expect(anomalies(actif())).toEqual([]);
  });

  it('signale un actif engagé sans valeur retenue', () => {
    const codes = anomalies(actif({ status: 'verifie', valeurRetenue: null })).map((a) => a.code);
    expect(codes).toContain('RETENUE_ABSENTE');
  });

  it('ne réclame pas de valeur retenue sur un actif rejeté', () => {
    const codes = anomalies(actif({
      status: 'rejete', valeurRetenue: null, motifRejet: 'Bien non retrouvé.',
    })).map((a) => a.code);
    expect(codes).not.toContain('RETENUE_ABSENTE');
    expect(codes).toEqual([]);
  });

  it('signale un rejet sans motif — le motif est obligatoire côté serveur', () => {
    const codes = anomalies(actif({
      status: 'rejete', valeurRetenue: null, motifRejet: '   ',
    })).map((a) => a.code);
    expect(codes).toContain('MOTIF_ABSENT');
  });

  it('signale un gage qui ne désigne aucun dossier', () => {
    const codes = anomalies(actif({ status: 'gage', gageApplication: null })).map((a) => a.code);
    expect(codes).toContain('GAGE_SANS_DOSSIER');
  });

  it('signale un acte non horodaté, sauf sur les rejets anciens', () => {
    expect(anomalies(actif({ verifieLe: null })).map((a) => a.code))
      .toContain('HORODATAGE_ABSENT');
    // Le backend garde volontairement les rejets sans `verifie_le` en fin de
    // liste plutôt que de les exclure : ce n'est pas un signal à répéter.
    expect(anomalies(actif({
      status: 'rejete', valeurRetenue: null, motifRejet: 'Motif.', verifieLe: null,
    })).map((a) => a.code)).not.toContain('HORODATAGE_ABSENT');
  });

  it('livre chaque anomalie avec un fait ET la question à poser (§4.6)', () => {
    for (const a of anomalies(actif({ status: 'gage', gageApplication: null, valeurRetenue: null }))) {
      expect(a.fait.length).toBeGreaterThan(10);
      expect(a.question.length).toBeGreaterThan(10);
      expect(a.code).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe('recitActe', () => {
  it('nomme le dossier sur un actif gagé', () => {
    expect(recitActe(actif({ status: 'gage', gageApplication: 'CRED-2026-0007' })))
      .toContain('CRED-2026-0007');
  });

  it('reste lisible sur un gage sans dossier rattaché', () => {
    expect(recitActe(actif({ status: 'gage', gageApplication: null })))
      .toContain('Nanti sur un dossier de crédit');
  });

  it('n’interprète pas un statut inconnu', () => {
    expect(recitActe(actif({ status: 'sequestre' }))).toContain('sans interprétation');
  });

  it('couvre les quatre statuts du contrat', () => {
    for (const s of STATUTS_HISTORIQUE) {
      expect(recitActe(actif({ status: s }))).not.toContain('sans interprétation');
    }
  });
});

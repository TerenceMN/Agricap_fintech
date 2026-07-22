
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Scoring from '@/pages/credit/Scoring';
import { api, ApiError } from '@/services/api';
import type { CreditAnalyse, CreditAnalyseCritere } from '@/types/api';

const critere = (over: Partial<CreditAnalyseCritere> = {}): CreditAnalyseCritere => ({
  score: 40, poids: 25, points: 10, details: {}, ...over,
});

function analyse(over: Partial<CreditAnalyse> = {}): CreditAnalyse {
  return {
    id: 7,
    reference: 'CRED-20260722-0001',
    referentiel: 'APICULTURE',
    parametres: {
      dureeMois: 12, differeMois: 3, tauxAnnuel: 18,
      modeDiffere: 'interets_seuls', capital: 4000, devise: 'USD',
    },
    scoreGlobal: 62.4,
    recommandation: 'approbation_cond',
    tarification: {
      tauxPropose: 20, tauxBase: 18, bandeScoreMin: 55, ajustement: 2,
      plancher: 12.6, plancherApplique: false, origineGrille: 'bareme', devise: 'USD',
    },
    dscr: 1.12,
    dscrStress: 0.87,
    criteres: {
      technique: critere({
        details: { quantiteReference: 30, uniteReference: 'ruche', superficieHa: null },
      }),
      dscr: critere(), stress: critere(), comportemental: critere(), garanties: critere(),
    },
    indicateursHorsPlage: [],
    justifications: [],
    echeancier: [],
    totaux: {
      totalInterets: 0, totalInteretsCapitalises: 0, totalCapital: 0,
      serviceDette: 0, crdFinal: 0, nbEcheances: 0,
    },
    devise: 'USD',
    referentielInfo: {
      code: 'APICULTURE', filiere: 'Apiculture', source: 'simulateur',
      estIndicatif: false, nCasReels: 42, version: 2,
    },
    scoreLettre: 'C',
    lignage: { needsSourceId: 12, revision: 3, sha256: 'deadbeef0123' },
    poidsAppliques: { technique: 25, dscr: 20, stress: 10, comportemental: 30, garanties: 15 },
    executeLe: '2026-07-20T09:00:00Z',
    versionMoteur: '4.0',
    ...over,
  };
}

function rendre(code = 'CRED-20260722-0001') {
  return render(
    <MemoryRouter initialEntries={[`/credit/dossiers/${code}/scoring`]}>
      <Routes>
        <Route path="/credit/dossiers/:code/scoring" element={<Scoring />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => { vi.restoreAllMocks(); });

describe('Scoring — analyse disponible', () => {
  it('affiche le score du serveur et le chemin du taux', async () => {
    vi.spyOn(api.credits, 'analyse').mockResolvedValue(analyse());
    rendre();

    // Le score apparaît deux fois (bandeau de recommandation et total du
    // tableau des critères) : les deux viennent du serveur, aucun n'est calculé.
    await waitFor(() => expect(screen.getAllByText('62,4').length).toBeGreaterThan(0));
    // Tarification : chaque étape, servie et non recomposée.
    expect(screen.getByText('18,00 %')).toBeTruthy();
    expect(screen.getByText('+2,00 pt')).toBeTruthy();
    expect(screen.getByText('20,00 % · USD')).toBeTruthy();
  });

  it('affiche la dimension dans l’unité du référentiel, jamais en hectares', async () => {
    vi.spyOn(api.credits, 'analyse').mockResolvedValue(analyse());
    rendre();

    await waitFor(() => expect(screen.getByText('30')).toBeTruthy());
    expect(screen.getByText('ruches')).toBeTruthy();
    // Le dossier apicole n'a pas de superficie : rien ne doit suggérer des « ha ».
    expect(screen.getByText(/ne se mesure pas en hectares/)).toBeTruthy();
  });

  it('n’ajuste pas le score global sur la somme des points servis', async () => {
    // 5 critères à 10 points = 50, mais le serveur annonce 62,4. C'est un défaut
    // moteur à remonter ; l'écran affiche 62,4 (le serveur fait foi) et ne
    // « corrige » rien.
    vi.spyOn(api.credits, 'analyse').mockResolvedValue(analyse());
    rendre();

    await waitFor(() => expect(screen.getAllByText('62,4').length).toBeGreaterThan(0));
    expect(screen.queryByText('50,0')).toBeNull();
  });

  it('dit « non tarifée » plutôt que d’inventer un taux', async () => {
    vi.spyOn(api.credits, 'analyse').mockResolvedValue(analyse({ tarification: null }));
    rendre();

    await waitFor(() => expect(screen.getByText(/ne porte pas de tarification/)).toBeTruthy());
    expect(screen.queryByText(/20,00 %/)).toBeNull();
  });

  it('signale une dimension absente comme une donnée manquante, pas un mauvais dossier', async () => {
    vi.spyOn(api.credits, 'analyse').mockResolvedValue(analyse({
      criteres: {
        ...analyse().criteres,
        technique: critere({ score: 0, points: 0, details: { quantiteReference: null, uniteReference: 'ruche' } }),
      },
    }));
    rendre();

    await waitFor(() => expect(screen.getByText(/Aucune dimension n'est portée par ce dossier/)).toBeTruthy());
  });
});

describe('Scoring — états non nominaux', () => {
  it('restitue le refus du serveur (403) comme une décision d’autorisation', async () => {
    vi.spyOn(api.credits, 'analyse').mockRejectedValue(
      new ApiError(403, 'Permission refusée.'),
    );
    rendre();

    await waitFor(() => expect(screen.getByText(/réservé au personnel habilité/i)).toBeTruthy());
  });

  it('distingue « pas encore analysé » (404) d’une erreur', async () => {
    vi.spyOn(api.credits, 'analyse').mockRejectedValue(
      new ApiError(404, 'Analyse absente.', 'ANALYSE_ABSENTE'),
    );
    rendre();

    await waitFor(() => expect(screen.getByText(/Aucune analyse exécutée sur ce dossier/)).toBeTruthy());
    expect(screen.queryByText(/Analyse indisponible/)).toBeNull();
  });

  it('affiche un 422 cause par cause, avec le code de chaque règle', async () => {
    vi.spyOn(api.credits, 'analyse').mockRejectedValue(
      new ApiError(422, 'Analyse refusée.', 'DIMENSION_INCOHERENTE', [
        { code: 'DIMENSION_INCOHERENTE', message: 'Unité du dossier « ha » ≠ unité du référentiel « ruche ».' },
        { code: 'BAREME_ABSENT', message: 'Le barème « TAUX » n’existe pas ou est inactif.' },
      ]),
    );
    rendre();

    await waitFor(() => expect(screen.getByText(/Unité du dossier/)).toBeTruthy());
    // Le code apparaît aussi dans le paragraphe qui explique quoi en faire :
    // c'est voulu — un code sans conduite à tenir n'aide personne.
    expect(screen.getAllByText('DIMENSION_INCOHERENTE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BAREME_ABSENT').length).toBeGreaterThan(0);
    expect(screen.getByText(/Le barème « TAUX »/)).toBeTruthy();
  });

  it('traite l’expiration de session (401) à part : rien n’est perdu', async () => {
    vi.spyOn(api.credits, 'analyse').mockRejectedValue(new ApiError(401, 'Non authentifié.'));
    rendre();

    await waitFor(() => expect(screen.getByText('Session expirée')).toBeTruthy());
  });
});

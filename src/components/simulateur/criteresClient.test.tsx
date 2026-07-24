/**
 * ANTI-GAMING (principe 7) — ce que l'espace CLIENT ne doit jamais afficher,
 * et RESTITUTION (§4.6) — ce qu'il doit enfin dire.
 *
 * `POST /credits/simulate/` sert au demandeur, dans la même réponse, des blocs
 * qui ne lui sont pas destinés : `breakdown[].maxPoints` et `weight` (le poids
 * de chaque critère), `breakdown[].detail` (phrases d'analyste citant le
 * référentiel, l'écart, le barème), `refData` (plages, DSCR, durée, différé,
 * taux) et `tarification` (la grille de taux : bande, ajustement, plancher).
 * C'est la vue de l'écran qui filtre — le module de simulation, lui, ne connaît
 * pas le rôle de l'appelant.
 *
 * Ce fichier est le garde-fou de ce filtrage. Il échoue si quelqu'un
 * réintroduit un poids, un point, une bande, un seuil ou une plage dans le
 * panneau client : c'est-à-dire précisément le jour où un demandeur pourrait
 * apprendre que l'historique comportemental pèse 30 points et déplacer ses
 * chiffres vers le critère le plus rentable, au lieu d'améliorer son projet.
 *
 * Il verrouille aussi le défaut inverse, que le fondateur a constaté à l'écran :
 * un panneau qui annonce « 4 critères n'ont pas pu être évalués : votre agent
 * AGRICAP peut vous dire ce qui manque » sans jamais nommer ce qui manque. Un
 * client doit pouvoir COMPLÉTER son dossier — jamais l'OPTIMISER contre le
 * barème.
 *
 * Le pendant serveur existe déjà (`serialiser_analyse_resume`, vue client
 * volontairement pauvre) ; celui-ci couvre le chemin du SIMULATEUR, qui n'a pas
 * de sérialiseur par rôle.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CriteresClient } from '@/components/simulateur/SimulationResult';

/**
 * Réponse serveur réaliste : tous les champs sensibles sont PRÉSENTS.
 *
 * Les valeurs sont choisies pour ne collisionner avec AUCUN fait légitimement
 * affiché (révision 2, 6 postes, 5 hectares) : si un chiffre de barème
 * apparaît dans le rendu, il ne peut venir que d'une fuite.
 */
const simResult = {
  score: 62.4,
  eligible: true,
  proposedRate: 20,
  minScoreRequired: 60,
  valuationNote: 'Dossier recevable — approbation sous conditions.',
  breakdown: [
    {
      code: 'technique', label: 'Fiabilité technique',
      points: 8.5, maxPoints: 25, weight: 25, weightedScore: 8.5, score: 34, calculable: true,
      detail: 'Écart moyen de 42 % au référentiel MAIS-v3. Tolérance 30 % / 40 %.',
    },
    {
      code: 'dscr', label: 'Capacité financière (DSCR)',
      points: null, maxPoints: 21, weight: 21, weightedScore: null, score: null, calculable: false,
      detail: 'Capacité financière non calculable : aucun DSCR n’a pu être estimé.',
    },
    {
      code: 'comportemental', label: 'Historique comportemental',
      points: 15, maxPoints: 31, weight: 31, weightedScore: 15, score: 50, calculable: true,
      detail: 'Historique comportemental non disponible : score neutre de 50/100.',
    },
  ],
  refData: {
    source: 'Simulateur MAIS.xlsx', dscr: 0.64, durationMonths: 8, deferredMonths: 4,
    rateAnnual: 0.18, uniteReference: 'ha', uniteDossier: 'ha', quantiteReference: 5,
    referentielFiliere: 'MAIS-v3',
    refTotals: { semences: 210, maindoeuvre: 480 },
  },
  tarification: {
    tauxBase: 18, bandeScoreMin: 55, ajustement: 3, plancher: 12.6,
    plancherApplique: false, taux: 20, origine: 'bareme',
  },
  needsSource: { revision: 2, sha256: 'a1b2c3d4e5f6a7b8' },
  moduleFinancing: [{}, {}, {}, {}, {}, {}],
};

describe('CriteresClient — ce qui est montré', () => {
  it('nomme les critères examinés : c’est utile et ce n’est pas jouable', () => {
    render(<CriteresClient simResult={simResult} />);

    expect(screen.getByText(/Fiabilité technique/)).toBeTruthy();
    expect(screen.getByText(/Capacité financière/)).toBeTruthy();
    expect(screen.getByText(/Historique comportemental/)).toBeTruthy();
  });

  it('signale un critère non évalué — c’est actionnable pour le demandeur', () => {
    render(<CriteresClient simResult={simResult} />);
    expect(screen.getByText(/— non évalué/)).toBeTruthy();
    expect(screen.getByText(/Un critère n’a pas pu être évalué/)).toBeTruthy();
  });

  it('dit sur QUELLES informations du dossier un critère a été évalué', () => {
    render(<CriteresClient simResult={simResult} />);
    expect(screen.getByText(/6 postes de votre feuille de besoins/)).toBeTruthy();
    expect(screen.getByText(/rapportés à 5 hectares/)).toBeTruthy();
  });

  it('dit ce que le critère non évalué AURAIT examiné, jamais un vide muet', () => {
    render(<CriteresClient simResult={simResult} />);
    expect(screen.getByText(/rapporte les revenus attendus de votre projet à vos remboursements/))
      .toBeTruthy();
  });

  it('ne se décharge plus sur l’agent : il assume ce qu’il ne sait pas', () => {
    const { container } = render(<CriteresClient simResult={simResult} />);
    const texte = container.textContent ?? '';
    expect(texte).not.toContain('votre agent AGRICAP peut vous dire ce qui manque');
    expect(texte).toContain('Aucune information manquante n’a été identifiée');
  });

  it('renvoie le détail du calcul à l’instruction, sans le montrer', () => {
    render(<CriteresClient simResult={simResult} />);
    expect(screen.getByText(/relève de l'instruction du dossier/)).toBeTruthy();
  });

  it('ne rend rien tant que le moteur n’a pas répondu', () => {
    const { container } = render(<CriteresClient simResult={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('CriteresClient — le rapport de ce qui manque', () => {
  /** Dimension absente : cause CONSTATÉE sur ce que le serveur dit avoir retenu. */
  const sansDimension = {
    breakdown: [{ code: 'technique', label: 'Fiabilité technique', calculable: false }],
    refData: { uniteReference: 'ruche', uniteDossier: 'ruche', quantiteReference: 0 },
  };

  it('liste ce qu’il manque au dossier, avec l’action qui le débloque', () => {
    const { container } = render(<CriteresClient simResult={sansDimension} />);
    const texte = container.textContent ?? '';
    expect(texte).toContain('Ce qu\'il manque à votre dossier');
    expect(texte).toContain('La dimension de votre projet n’est pas renseignée');
    expect(texte).toContain('Indiquez la taille de votre projet en ruches');
  });

  it('sépare ce qui relève d’AGRICAP : le demandeur n’est pas envoyé corriger un dossier complet', () => {
    // Le cas constaté par le fondateur : les barèmes ne sont pas seedés, quatre
    // critères tombent, et rien ne manque au dossier du client.
    const baremesAbsents = {
      breakdown: [
        { code: 'technique', label: 'Fiabilité technique', calculable: false, cause: { code: 'BAREME_NON_CONFIGURE' } },
        { code: 'garanties', label: 'Garanties & domiciliation', calculable: false, cause: { code: 'BAREME_NON_CONFIGURE' } },
      ],
    };
    const { container } = render(<CriteresClient simResult={baremesAbsents} />);
    const texte = container.textContent ?? '';

    expect(texte).toContain('Ce qui ne dépend pas de vous');
    expect(texte).toContain('Rien à faire de votre côté');
    expect(texte).toContain('rien ne manque de votre côté');
    expect(texte).not.toContain('Ce qu\'il manque à votre dossier');
    // Et surtout : jamais le nom du barème que le serveur a passé en paramètre,
    // ni la formulation d'instruction qui le cite. (Le pied de panneau, lui,
    // parle des barèmes pour dire qu'ils ne sont PAS montrés — c'est l'inverse
    // d'une fuite, et il est exclu de ce contrôle.)
    expect(texte).not.toContain('COUVERTURE_GARANTIES');
    expect(texte).not.toMatch(/barème\s*«/);
    expect(texte).not.toMatch(/n’est pas configuré en base/);
  });

  it('assume l’incertitude quand la comparaison est indicative (§4.6)', () => {
    const indicatif = {
      breakdown: [{ code: 'technique', label: 'Fiabilité technique', calculable: true }],
      dossier: { referentielIndicatif: true },
    };
    const { container } = render(<CriteresClient simResult={indicatif} />);
    expect(container.textContent).toContain('la comparaison est indicative');
  });
});

describe('CriteresClient — états de chargement, d’erreur et vide', () => {
  it('annonce l’attente au lieu d’un panneau vide', () => {
    render(<CriteresClient simResult={null} loading />);
    expect(screen.getByText(/Analyse de votre dossier en cours/)).toBeTruthy();
  });

  it('affiche l’erreur et n’invente aucun critère', () => {
    render(<CriteresClient simResult={null} error="503 — service indisponible" />);
    expect(screen.getByText(/503 — service indisponible/)).toBeTruthy();
    expect(screen.queryByText(/Fiabilité technique/)).toBeNull();
  });

  it('dit le vide et son motif quand le moteur ne sert aucun critère', () => {
    const vide = {
      breakdown: [],
      unavailable: { code: 'SCORE_NON_CALCULABLE', message: 'Aucun critère n’est calculable en l’état.' },
    };
    const { container } = render(<CriteresClient simResult={vide} />);
    const texte = container.textContent ?? '';
    expect(texte).toContain('n\'a renvoyé aucun critère');
    expect(texte).toContain('Aucun critère n’est calculable en l’état.');
  });
});

describe('CriteresClient — ce qui ne doit JAMAIS fuiter (principe 7)', () => {
  /** Tout le texte rendu, sans balises — pour les contrôles de PHRASES. */
  function texteRendu(): string {
    const { container } = render(<CriteresClient simResult={simResult} />);
    return container.textContent ?? '';
  }

  /**
   * Les mêmes textes, mais NŒUD PAR NŒUD, séparés par des sauts de ligne.
   *
   * `textContent` colle les nœuds bout à bout : un `<p>{maxPoints}</p>` glissé
   * entre deux phrases produit « …même nature.25Capacité financière… », où
   * ni `\b25\b` ni un contrôle de frontière ne voit plus le 25. Le garde-fou
   * passait alors au vert sur une fuite réelle — vérifié en injectant
   * volontairement `maxPoints` dans le rendu. Séparer les nœuds rend chaque
   * chiffre isolable, ce qu'il est aussi pour l'œil du demandeur.
   */
  function jetonsRendus(): string {
    const { container } = render(<CriteresClient simResult={simResult} />);
    const morceaux: string[] = [];
    const parcours = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (parcours.nextNode()) morceaux.push(parcours.currentNode.textContent ?? '');
    return morceaux.join('\n');
  }

  it('n’affiche aucun poids de critère', () => {
    const jetons = jetonsRendus();
    // 25, 21 et 31 sont les poids servis dans `maxPoints` / `weight`.
    expect(jetons).not.toMatch(/\b25\b/);
    expect(jetons).not.toMatch(/\b31\b/);
    expect(jetons).not.toMatch(/\b21\b/);
  });

  it('n’affiche aucun point pondéré ni score par critère', () => {
    const jetons = jetonsRendus();
    expect(jetons).not.toContain('8.5');
    expect(jetons).not.toContain('8,5');
    expect(jetons).not.toContain('/100');
  });

  it('n’affiche ni référentiel, ni DSCR, ni durée, ni différé, ni taux', () => {
    const texte = texteRendu();
    expect(texte).not.toContain('MAIS-v3');
    expect(texte).not.toContain('Simulateur MAIS.xlsx');
    expect(texte).not.toContain('0.64');
    expect(texte).not.toMatch(/DSCR\s*=|DSCR calculé/);
    expect(texte).not.toMatch(/%\s*\/?\s*an/);
  });

  it('n’affiche aucune bande de tarification ni son ajustement', () => {
    const jetons = jetonsRendus();
    expect(jetons).not.toContain('55');
    expect(jetons).not.toContain('12,6');
    expect(jetons).not.toContain('12.6');
  });

  it('n’affiche pas les phrases d’analyste servies dans `detail`', () => {
    // « Écart moyen de 42 % au référentiel » cite une plage et une tolérance :
    // c'est du vocabulaire d'instruction, pas une piste d'amélioration.
    const texte = texteRendu();
    expect(texte).not.toContain('Écart moyen');
    expect(texte).not.toContain('42 %');
    expect(texte).not.toContain('Tolérance');
    expect(texte).not.toContain('score neutre');
  });

  /**
   * LE garde-fou : tout chiffre servi sous une clé d'instruction est traqué dans
   * le rendu, quelle que soit la façon dont il y serait arrivé. Ce test n'a pas
   * de liste à maintenir — il relit la réponse serveur elle-même.
   *
   * Sont balayés : les poids et points de chaque critère, les scores, le seuil
   * d'éligibilité, toute la grille de tarification et tout `refData` autre que
   * l'unité et la dimension du DOSSIER (qui, elles, appartiennent au demandeur).
   */
  it('ne laisse passer AUCUN barème, seuil, poids ni plage servi par le moteur', () => {
    const jetons = jetonsRendus();

    // Faits qui appartiennent AU DEMANDEUR et qu'il peut recompter lui-même :
    // la révision de sa feuille, le nombre de postes qu'il a financés, la
    // dimension de son projet. Ils sont affichés à dessein, et un chiffre de
    // barème qui tomberait par hasard sur l'un d'eux n'est de toute façon pas
    // distinguable à l'écran — la fixture est calibrée pour qu'aucun ne collide.
    const faitsDuDossier = new Set<number>([
      simResult.needsSource.revision,
      simResult.moduleFinancing.length,
      simResult.refData.quantiteReference,
    ]);

    const CLES_DOSSIER = new Set(['uniteReference', 'uniteDossier', 'quantiteReference']);
    const interdits = new Set<number>();
    const collecter = (valeur: unknown, cleParente = ''): void => {
      if (CLES_DOSSIER.has(cleParente)) return;
      if (typeof valeur === 'number' && Number.isFinite(valeur)) { interdits.add(valeur); return; }
      if (Array.isArray(valeur)) { valeur.forEach(v => collecter(v, cleParente)); return; }
      if (valeur && typeof valeur === 'object') {
        for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) collecter(v, cle);
      }
    };

    collecter(simResult.tarification);
    collecter(simResult.refData);
    collecter(simResult.minScoreRequired, 'minScoreRequired');
    collecter(simResult.score, 'score');
    for (const critere of simResult.breakdown) {
      const { code: _c, label: _l, calculable: _k, detail: _d, ...chiffres } = critere;
      collecter(chiffres);
    }
    for (const fait of faitsDuDossier) interdits.delete(fait);

    // Le test ne vaut que s'il a réellement quelque chose à chercher.
    expect(interdits.size).toBeGreaterThan(12);

    for (const valeur of interdits) {
      // Le nombre doit être un JETON isolé : ni collé à d'autres chiffres, ni
      // pris dans un mot — sans quoi l'empreinte SHA « a1b2c3d4… » déclencherait
      // sur presque tous les chiffres et le garde-fou crierait au loup.
      const motif = new RegExp(`(?<![\\w.,])${String(valeur).replace('.', '[.,]')}(?![\\w.,])`);
      expect(jetons, `la valeur ${valeur} (barème / seuil / poids / plage) est rendue au client`)
        .not.toMatch(motif);
    }
  });

  it('conserve le lignage de la feuille — une preuve, pas une règle', () => {
    // La révision et l'empreinte disent AU CLIENT sur quel fichier il a été
    // simulé. Rien ne s'en déduit sur le barème : c'est de la traçabilité.
    render(<CriteresClient simResult={simResult} />);
    expect(screen.getByText(/révision 2 de votre feuille/)).toBeTruthy();
  });
});

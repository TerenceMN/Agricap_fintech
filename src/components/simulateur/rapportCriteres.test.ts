/**
 * Rapport client des critères — ce qu'il DIT, et ce qu'il refuse de dire.
 *
 * Le défaut corrigé : l'écran constatait « 4 critères n'ont pas pu être
 * évalués » et renvoyait vers un agent, sans jamais nommer ce qui manquait. Les
 * tests ci-dessous vérifient les deux sens de la restitution — sur quoi un
 * critère a été évalué, et pourquoi il ne l'a pas été — et surtout la frontière
 * du principe 7 : aucune phrase rédigée par le serveur, aucun barème, aucun
 * seuil ne franchit ce module.
 */
import { describe, expect, it } from 'vitest';
import { construireRapport, syntheseNonEvalues } from '@/components/simulateur/rapportCriteres';

const ligne = (code: string, label: string, extra: Record<string, unknown> = {}) => ({
  code, label, calculable: true, ...extra,
});

describe('construireRapport — critère ÉVALUÉ : sur quoi il l’a été', () => {
  it('nomme les postes, la révision et la dimension quand le serveur les sert', () => {
    const rapport = construireRapport({
      breakdown: [ligne('technique', 'Fiabilité technique')],
      refData: { uniteReference: 'ha', uniteDossier: 'ha', quantiteReference: 5 },
      needsSource: { revision: 2 },
      moduleFinancing: [{}, {}, {}, {}, {}, {}],
    });

    expect(rapport?.lignes[0].evalue).toBe(true);
    expect(rapport?.lignes[0].fondement).toContain('6 postes de votre feuille de besoins');
    expect(rapport?.lignes[0].fondement).toContain('révision 2');
    expect(rapport?.lignes[0].fondement).toContain('5 hectares');
  });

  it('omet ce qui n’est pas servi au lieu de l’inventer', () => {
    const rapport = construireRapport({
      breakdown: [ligne('technique', 'Fiabilité technique')],
    });
    const fondement = rapport?.lignes[0].fondement ?? '';
    expect(fondement).toContain('des postes de votre feuille de besoins');
    expect(fondement).not.toMatch(/révision/);
    // Aucun nombre fabriqué pour combler un champ absent.
    expect(fondement).not.toMatch(/\d/);
  });

  it('compte les crédits antérieurs quand le serveur les sert', () => {
    const rapport = construireRapport({
      breakdown: [ligne('comportemental', 'Historique comportemental')],
      dossier: { nbCreditsAnterieurs: 3 },
    });
    expect(rapport?.lignes[0].fondement).toContain('vos 3 crédits antérieurs');
  });

  it('dit qu’un historique VIDE est vide, sans le maquiller en performance', () => {
    const rapport = construireRapport({
      breakdown: [ligne('comportemental', 'Historique comportemental')],
      dossier: { nbCreditsAnterieurs: 0 },
    });
    expect(rapport?.lignes[0].fondement).toContain('aucun crédit antérieur');
    expect(rapport?.lignes[0].fondement).toContain('votre premier prêt');
  });

  it('dit qu’aucune garantie n’est rattachée plutôt que d’afficher un vide muet', () => {
    const rapport = construireRapport({
      breakdown: [ligne('garanties', 'Garanties & domiciliation')],
      dossier: { nbGaranties: 0 },
    });
    expect(rapport?.lignes[0].fondement).toContain('aucune garantie rattachée');
  });

  it('traite un critère sans `calculable` comme évalué (contrat `scoring.py`)', () => {
    const rapport = construireRapport({
      breakdown: [{ code: 'dscr', label: 'Capacité financière (DSCR)' }],
    });
    expect(rapport?.lignes[0].evalue).toBe(true);
    expect(rapport?.nbNonEvalues).toBe(0);
  });
});

describe('construireRapport — critère NON ÉVALUÉ : le fait, la cause, l’action', () => {
  it('traduit un code de cause servi en fait + action, jamais en seuil', () => {
    const rapport = construireRapport({
      breakdown: [
        ligne('technique', 'Fiabilité technique', {
          calculable: false,
          cause: { code: 'DIMENSION_ABSENTE', parametres: { uniteReferentiel: 'ruche' } },
        }),
      ],
    });

    const motif = rapport?.lignes[0].motif;
    expect(motif?.code).toBe('DIMENSION_ABSENTE');
    expect(motif?.origine).toBe('dossier');
    expect(motif?.fait).toContain('dimension de votre projet');
    expect(motif?.action).toContain('ruches');
    expect(rapport?.manquantsDossier).toHaveLength(1);
    expect(rapport?.manquantsInstitution).toHaveLength(0);
  });

  it('sépare ce qui relève d’AGRICAP de ce qui relève du demandeur', () => {
    const rapport = construireRapport({
      breakdown: [
        ligne('garanties', 'Garanties & domiciliation', {
          calculable: false, cause: { code: 'BAREME_NON_CONFIGURE' },
        }),
        ligne('technique', 'Fiabilité technique', {
          calculable: false, cause: { code: 'REFERENTIEL_FILIERE_ABSENT' },
        }),
      ],
    });

    expect(rapport?.manquantsDossier).toHaveLength(0);
    expect(rapport?.manquantsInstitution).toHaveLength(2);
    // Le demandeur n'est pas envoyé corriger un dossier qui n'est pas en cause.
    for (const motif of rapport?.manquantsInstitution ?? []) {
      expect(motif.action).toContain('Rien à faire de votre côté');
    }
  });

  it('constate une dimension absente à partir de ce que le serveur dit avoir retenu', () => {
    // Aucun `cause` servi : le constat porte sur `refData.quantiteReference`,
    // que le moteur sert explicitement — pas sur une règle rejouée au navigateur.
    const rapport = construireRapport({
      breakdown: [ligne('technique', 'Fiabilité technique', { calculable: false })],
      refData: { uniteReference: 'ha', uniteDossier: 'ha', quantiteReference: 0 },
    });
    expect(rapport?.lignes[0].motif?.code).toBe('DIMENSION_ABSENTE');
    expect(rapport?.nbMotifsNonRestitues).toBe(0);
  });

  it('constate une unité incohérente et donne l’unité à ressaisir', () => {
    const rapport = construireRapport({
      breakdown: [ligne('technique', 'Fiabilité technique', { calculable: false })],
      refData: { uniteReference: 'ruche', uniteDossier: 'ha', quantiteReference: 5 },
    });
    const motif = rapport?.lignes[0].motif;
    expect(motif?.code).toBe('DIMENSION_INCOHERENTE');
    expect(motif?.fait).toContain('hectares');
    expect(motif?.fait).toContain('ruches');
    expect(motif?.action).toContain('Ressaisissez');
  });

  it('ne constate rien quand le serveur ne sert pas la dimension', () => {
    // `quantiteReference` absent ≠ dimension absente du dossier : un serveur
    // qui ne sert pas le champ ne dit rien, et l'écran ne conclut pas.
    const rapport = construireRapport({
      breakdown: [ligne('technique', 'Fiabilité technique', { calculable: false })],
      refData: { uniteReference: 'ha' },
    });
    expect(rapport?.lignes[0].motif).toBeUndefined();
    expect(rapport?.nbMotifsNonRestitues).toBe(1);
  });

  it('n’étend pas le constat de dimension aux autres critères', () => {
    const rapport = construireRapport({
      breakdown: [ligne('dscr', 'Capacité financière (DSCR)', { calculable: false })],
      refData: { uniteReference: 'ha', uniteDossier: 'ha', quantiteReference: 0 },
    });
    expect(rapport?.lignes[0].motif).toBeUndefined();
  });

  it('déduplique : une même cause ne produit qu’une action à faire', () => {
    const rapport = construireRapport({
      breakdown: [
        ligne('dscr', 'Capacité financière (DSCR)', {
          calculable: false, cause: { code: 'FEUILLE_BESOINS_ABSENTE' },
        }),
        ligne('stress', 'Résilience au stress', {
          calculable: false, cause: { code: 'FEUILLE_BESOINS_ABSENTE' },
        }),
      ],
    });
    expect(rapport?.nbNonEvalues).toBe(2);
    expect(rapport?.manquantsDossier).toHaveLength(1);
  });

  it('décrit toujours ce que le critère AURAIT examiné, même sans motif', () => {
    const rapport = construireRapport({
      breakdown: [ligne('stress', 'Résilience au stress', { calculable: false })],
    });
    expect(rapport?.lignes[0].fondement).toContain('revenus volontairement dégradés');
  });
});

describe('construireRapport — principe 7 : ce qui ne franchit pas la frontière', () => {
  /** Réponse serveur RÉELLE : tous les champs d'instruction sont présents. */
  const simulationComplete = {
    score: 62.4,
    breakdown: [
      {
        code: 'technique', label: 'Fiabilité technique',
        points: 8.5, maxPoints: 25, weight: 25, weightedScore: 8.5, score: 34,
        calculable: true,
        detail: 'Écart moyen de 42 % au référentiel MAIS-v3. Tolérance 30 % / 40 %.',
      },
      {
        code: 'garanties', label: 'Garanties & domiciliation',
        points: null, maxPoints: 15, weight: 15, score: null, calculable: false,
        detail: 'Garanties non calculables : le barème « COUVERTURE_GARANTIES » '
          + 'n’est pas configuré en base.',
        cause: { code: 'BAREME_NON_CONFIGURE', parametres: { bareme: 'COUVERTURE_GARANTIES' } },
      },
    ],
    refData: {
      uniteReference: 'ha', uniteDossier: 'ha', quantiteReference: 5,
      referentielFiliere: 'MAIS-v3', source: 'Simulateur MAIS.xlsx',
      refTotals: { semences: 210 }, dscr: 0.64, rateAnnual: 0.18,
    },
    minScoreRequired: 60,
    tarification: { tauxBase: 18, bandeScoreMin: 55, ajustement: 2, plancher: 12.6 },
  };

  /** Tout le texte que le rapport produit, motifs et fondements confondus. */
  function texteDuRapport(): string {
    const rapport = construireRapport(simulationComplete);
    const morceaux: string[] = [];
    for (const l of rapport?.lignes ?? []) {
      morceaux.push(l.label, l.fondement, l.motif?.fait ?? '', l.motif?.action ?? '');
    }
    for (const m of [...(rapport?.manquantsDossier ?? []), ...(rapport?.manquantsInstitution ?? [])]) {
      morceaux.push(m.fait, m.action);
    }
    morceaux.push(...(rapport?.reserves ?? []), syntheseNonEvalues(rapport));
    return morceaux.join(' ');
  }

  it('ne reprend AUCUNE phrase rédigée par le serveur (`detail`)', () => {
    const texte = texteDuRapport();
    expect(texte).not.toContain('Écart moyen');
    expect(texte).not.toContain('42 %');
    expect(texte).not.toContain('Tolérance');
    expect(texte).not.toContain('non calculables :');
  });

  it('ne nomme jamais un barème, même quand le serveur le passe en paramètre', () => {
    const texte = texteDuRapport();
    expect(texte).not.toContain('COUVERTURE_GARANTIES');
    expect(texte).not.toContain('ECART_TECHNIQUE');
    expect(texte).not.toMatch(/barème/i);
  });

  it('ne nomme ni référentiel, ni fichier source du moteur', () => {
    const texte = texteDuRapport();
    expect(texte).not.toContain('MAIS-v3');
    expect(texte).not.toContain('Simulateur MAIS.xlsx');
    expect(texte).not.toMatch(/référentiel/i);
  });

  it('n’expose ni poids, ni points, ni score, ni seuil, ni taux', () => {
    const texte = texteDuRapport();
    for (const interdit of ['25', '15', '8.5', '8,5', '34', '62.4', '60', '55', '12.6', '0.64', '18']) {
      expect(texte).not.toContain(interdit);
    }
    expect(texte).not.toMatch(/DSCR\s*=/);
    expect(texte).not.toMatch(/seuil|minimum requis|pondér|coefficient/i);
  });

  it('ignore un code de cause inconnu au lieu de recopier la prose serveur', () => {
    // `detail` n'est PAS déclaré dans `CritereServi` : ce qui n'est pas typé ne
    // peut pas être affiché par inadvertance. Il faut donc une variable
    // intermédiaire pour le faire entrer dans la fixture — et c'est bon signe.
    const avecProseServeur = {
      breakdown: [{
        code: 'dscr', label: 'Capacité financière (DSCR)', calculable: false,
        cause: { code: 'UN_CODE_QUE_LE_FRONT_NE_CONNAIT_PAS' },
        detail: 'Capacité financière non calculable : le barème « DSCR » manque.',
      }],
    };
    const rapport = construireRapport(avecProseServeur);
    expect(rapport?.lignes[0].motif).toBeUndefined();
    expect(rapport?.nbMotifsNonRestitues).toBe(1);
  });
});

describe('construireRapport — réserves et états limites (§4.6)', () => {
  it('assume l’incertitude quand la comparaison est indicative', () => {
    const rapport = construireRapport({
      breakdown: [ligne('technique', 'Fiabilité technique')],
      dossier: { referentielIndicatif: true },
    });
    expect(rapport?.reserves).toHaveLength(1);
    expect(rapport?.reserves[0]).toContain('indicative');
  });

  it('ne porte aucune réserve quand rien ne l’exige', () => {
    const rapport = construireRapport({ breakdown: [ligne('technique', 'Fiabilité technique')] });
    expect(rapport?.reserves).toHaveLength(0);
  });

  it('rend `null` sans critère servi — l’appelant affiche son état vide', () => {
    expect(construireRapport(null)).toBeNull();
    expect(construireRapport(undefined)).toBeNull();
    expect(construireRapport({ breakdown: [] })).toBeNull();
    expect(construireRapport({})).toBeNull();
  });
});

describe('syntheseNonEvalues — la phrase qui a remplacé le renvoi à l’agent', () => {
  it('ne dit rien quand tout a été évalué', () => {
    const rapport = construireRapport({ breakdown: [ligne('technique', 'Fiabilité technique')] });
    expect(syntheseNonEvalues(rapport)).toBe('');
    expect(syntheseNonEvalues(null)).toBe('');
  });

  it('annonce la liste des manques quand le dossier est en cause', () => {
    const rapport = construireRapport({
      breakdown: [ligne('technique', 'Fiabilité technique', {
        calculable: false, cause: { code: 'DIMENSION_ABSENTE' },
      })],
    });
    const phrase = syntheseNonEvalues(rapport);
    expect(phrase).toContain('Un critère n’a pas pu être évalué');
    expect(phrase).toContain('ce qu’il manque à votre dossier');
  });

  it('dit explicitement que rien ne manque quand la cause est chez AGRICAP', () => {
    // C'est le cas du fondateur : quatre critères non évalués parce que les
    // barèmes ne sont pas seedés. Envoyer le client « compléter son dossier »
    // serait faux ; le renvoyer à un agent, une décharge.
    const rapport = construireRapport({
      breakdown: [
        ligne('technique', 'Fiabilité technique', {
          calculable: false, cause: { code: 'BAREME_NON_CONFIGURE' },
        }),
        ligne('dscr', 'Capacité financière (DSCR)', {
          calculable: false, cause: { code: 'BAREME_NON_CONFIGURE' },
        }),
      ],
    });
    const phrase = syntheseNonEvalues(rapport);
    expect(phrase).toContain('2 critères n’ont pas pu être évalués');
    expect(phrase).toContain('rien ne manque de votre côté');
    expect(phrase).toContain('votre demande peut suivre son cours');
  });

  it('assume l’ignorance quand le motif n’est pas restitué', () => {
    const rapport = construireRapport({
      breakdown: [ligne('dscr', 'Capacité financière (DSCR)', { calculable: false })],
    });
    const phrase = syntheseNonEvalues(rapport);
    expect(phrase).toContain('Aucune information manquante n’a été identifiée');
    expect(phrase).toContain('l’instruction');
    // Ce que la phrase ne fait plus : se décharger sur un humain sans rien dire.
    expect(phrase).not.toContain('votre agent AGRICAP peut vous dire ce qui manque');
  });
});

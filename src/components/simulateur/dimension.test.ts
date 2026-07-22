/**
 * Dimension du projet — le refus `DIMENSION_INCOHERENTE` doit être impossible à
 * provoquer par inadvertance depuis un formulaire.
 *
 * Ces tests figent trois choses, dans cet ordre d'importance :
 *   1. l'unité vient TOUJOURS du serveur — aucune table filière → unité côté
 *      front ne doit réapparaître (principes 6 et 8) ;
 *   2. une unité de dossier différente de celle du référentiel est bloquée
 *      AVANT l'envoi, avec le même code que le serveur ;
 *   3. `area_ha` n'est rempli que pour une filière mesurée en hectares — 30
 *      ruches ne doivent jamais entrer dans le dossier comme « 30 ha ».
 *
 * Limite assumée (cf. en-tête de `vitest.config.ts`) : les payloads sont écrits
 * d'après la lecture du contrat serveur, pas capturés sur un vrai serveur.
 */
import { describe, expect, it } from 'vitest';
import {
  dimensionPayload,
  dimensionRetenueParLeServeur,
  etatDimensionProjet,
  libelleUnite,
  normaliserUnite,
  resoudreUniteReference,
  verifierDimension,
} from '@/components/simulateur/dimension';

describe('normaliserUnite', () => {
  it('aligne la comparaison sur celle du serveur (strip + lower)', () => {
    expect(normaliserUnite('  RUCHE ')).toBe('ruche');
    expect(normaliserUnite('Ha')).toBe('ha');
  });

  it('rend une chaîne vide sur tout ce qui n’est pas une unité', () => {
    expect(normaliserUnite(null)).toBe('');
    expect(normaliserUnite(undefined)).toBe('');
    expect(normaliserUnite(42)).toBe('');
  });
});

describe('libelleUnite', () => {
  it('accorde le libellé au nombre', () => {
    expect(libelleUnite('ruche', 1)).toBe('ruche');
    expect(libelleUnite('ruche', 30)).toBe('ruches');
    expect(libelleUnite('t', 300)).toBe('tonnes usinées');
  });

  it('affiche telle quelle une unité inconnue plutôt que de la masquer', () => {
    // Une filière nouvelle ne doit pas devenir invisible parce que le front
    // n'a pas encore son libellé.
    expect(libelleUnite('litre', 5)).toBe('litre');
  });

  it('rend une chaîne vide quand l’unité n’est pas connue du serveur', () => {
    expect(libelleUnite(null)).toBe('');
  });
});

describe('resoudreUniteReference', () => {
  it('privilégie le référentiel réellement résolu par la simulation', () => {
    const r = resoudreUniteReference({
      valueChain: { unite_reference: 'ha' },
      refData: { uniteReference: 'ruche', referentielFiliere: 'APICULTURE' },
    });
    expect(r).toEqual({ unite: 'ruche', source: 'simulation', referentiel: 'APICULTURE' });
  });

  it('retombe sur la filière du préremplissage quand elle porte l’unité', () => {
    const r = resoudreUniteReference({ valueChain: { unite_reference: 'M2' }, refData: null });
    expect(r.unite).toBe('m2');
    expect(r.source).toBe('filiere');
  });

  it('déclare son ignorance au lieu de deviner « ha »', () => {
    // C'est LE point du module : aucune table filière → unité dans le
    // navigateur. Un défaut implicite à « ha » redimensionnerait un rucher en
    // hectares sans que personne ne l'ait décidé.
    expect(resoudreUniteReference({ valueChain: { code: 'APICULTURE' } as never }))
      .toEqual({ unite: null, source: null });
    expect(resoudreUniteReference({})).toEqual({ unite: null, source: null });
  });
});

describe('verifierDimension', () => {
  it('bloque une unité qui ne correspond pas, avec le code du serveur', () => {
    const v = verifierDimension({ quantite: 30, uniteSaisie: 'ha', uniteReferentiel: 'ruche' });
    expect(v.etat).toBe('incoherente');
    expect(v.bloquant).toBe(true);
    expect(v.code).toBe('DIMENSION_INCOHERENTE');
    expect(v.message).toMatch(/ruche/);
  });

  it('signale l’incohérence AVANT de se plaindre d’une quantité vide', () => {
    // L'ordre compte : réclamer une quantité dans une unité fausse ferait
    // corriger le mauvais champ.
    const v = verifierDimension({ quantite: '', uniteSaisie: 'ha', uniteReferentiel: 'sac' });
    expect(v.code).toBe('DIMENSION_INCOHERENTE');
  });

  it('exige une quantité, et la nomme dans l’unité de la filière', () => {
    const v = verifierDimension({ quantite: '', uniteSaisie: 'ruche', uniteReferentiel: 'ruche' });
    expect(v.etat).toBe('manquante');
    expect(v.bloquant).toBe(true);
    expect(v.message).toMatch(/ruches/);
  });

  it('refuse zéro et les valeurs illisibles', () => {
    expect(verifierDimension({ quantite: 0, uniteReferentiel: 'ha', uniteSaisie: 'ha' }).etat)
      .toBe('invalide');
    expect(verifierDimension({ quantite: -3, uniteReferentiel: 'ha', uniteSaisie: 'ha' }).etat)
      .toBe('invalide');
    expect(verifierDimension({ quantite: 'abc', uniteReferentiel: 'ha', uniteSaisie: 'ha' }).etat)
      .toBe('invalide');
  });

  it('n’empêche pas d’avancer quand le serveur n’a pas servi l’unité', () => {
    // Le serveur reste l'autorité : un champ d'API manquant ne doit pas fermer
    // le parcours du demandeur.
    const v = verifierDimension({ quantite: 5, uniteSaisie: 'ha', uniteReferentiel: null });
    expect(v.etat).toBe('unite_inconnue');
    expect(v.bloquant).toBe(false);
  });

  it('valide une dimension exprimée dans la bonne unité', () => {
    expect(verifierDimension({ quantite: '30', uniteSaisie: 'ruche', uniteReferentiel: 'RUCHE' }))
      .toEqual({ etat: 'ok', bloquant: false });
  });
});

describe('dimensionPayload', () => {
  it('n’envoie PAS area_ha pour une filière qui ne se mesure pas en hectares', () => {
    expect(dimensionPayload({ quantite: '30', unite: 'ruche' })).toEqual({
      quantite_reference: 30,
      unite_reference: 'ruche',
    });
  });

  it('envoie area_ha ET la dimension canonique pour une filière en hectares', () => {
    // `workflow.py` exige encore `area_ha` à la soumission : le retirer
    // casserait le parcours des 9 filières mesurées en hectares.
    expect(dimensionPayload({ quantite: 5, unite: 'HA' })).toEqual({
      quantite_reference: 5,
      unite_reference: 'ha',
      area_ha: 5,
    });
  });

  it('sans unité connue, reste sur le comportement historique (area_ha)', () => {
    expect(dimensionPayload({ quantite: 5 })).toEqual({ quantite_reference: 5, area_ha: 5 });
  });

  it('n’envoie rien plutôt qu’un zéro ou un NaN', () => {
    expect(dimensionPayload({ quantite: '', unite: 'ha' })).toEqual({});
    expect(dimensionPayload({ quantite: 0, unite: 'ha' })).toEqual({});
    expect(dimensionPayload({ quantite: 'douze', unite: 'ha' })).toEqual({});
  });
});

describe('etatDimensionProjet', () => {
  it('impose l’unité du référentiel dès que le serveur l’a dite', () => {
    const e = etatDimensionProjet({
      quantite: '30',
      uniteSaisie: 'ruche',
      refData: { uniteReference: 'ruche', referentielFiliere: 'APICULTURE' },
    });
    expect(e.unite).toBe('ruche');
    expect(e.uniteEffective).toBe('ruche');
    expect(e.verdict.etat).toBe('ok');
    expect(e.payload).toEqual({ quantite_reference: 30, unite_reference: 'ruche' });
    expect(e.ressaisieRequise).toBe(false);
  });

  it('retombe sur l’hectare tant que l’unité n’est pas servie — et le dit', () => {
    const e = etatDimensionProjet({ quantite: '5' });
    expect(e.unite).toBeNull();
    expect(e.uniteEffective).toBe('ha');
    expect(e.verdict.etat).toBe('unite_inconnue');
    expect(e.verdict.bloquant).toBe(false);
    expect(e.payload).toEqual({ quantite_reference: 5, unite_reference: 'ha', area_ha: 5 });
  });

  it('exige une ressaisie quand la simulation révèle une autre unité', () => {
    // Le seul chemin par lequel une incohérence peut naître dans un formulaire
    // dont l'unité est imposée : la valeur a été tapée avant que le serveur ne
    // dise que la filière se mesure en ruches.
    const e = etatDimensionProjet({
      quantite: '5',
      uniteSaisie: 'ha',
      refData: { uniteReference: 'ruche' },
    });
    expect(e.ressaisieRequise).toBe(true);
    expect(e.verdict.code).toBe('DIMENSION_INCOHERENTE');
    // Et surtout : rien n'est envoyé. Le refus est porté par le formulaire, pas
    // par l'analyse trois écrans plus loin.
    expect(e.payload).toEqual({});
  });
});

describe('dimensionRetenueParLeServeur', () => {
  it('constate que le serveur a ignoré la dimension envoyée', () => {
    const c = dimensionRetenueParLeServeur({
      refData: { uniteDossier: 'ha', quantiteReference: null },
      quantiteEnvoyee: 30,
      uniteEnvoyee: 'ruche',
    });
    expect(c).toEqual({ retenue: false, uniteServeur: 'ha', quantiteServeur: null });
  });

  it('constate qu’elle a été retenue', () => {
    const c = dimensionRetenueParLeServeur({
      refData: { uniteDossier: 'ruche', quantiteReference: 30 },
      quantiteEnvoyee: '30',
      uniteEnvoyee: 'ruche',
    });
    expect(c?.retenue).toBe(true);
  });

  it('détecte une quantité différente de celle envoyée', () => {
    const c = dimensionRetenueParLeServeur({
      refData: { uniteDossier: 'ha', quantiteReference: 12 },
      quantiteEnvoyee: 5,
      uniteEnvoyee: 'ha',
    });
    expect(c?.retenue).toBe(false);
  });

  it('ne conclut rien sans réponse serveur exploitable', () => {
    expect(dimensionRetenueParLeServeur({ refData: null, quantiteEnvoyee: 5 })).toBeNull();
    expect(dimensionRetenueParLeServeur({ refData: {}, quantiteEnvoyee: 5 })).toBeNull();
  });
});

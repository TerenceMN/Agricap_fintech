/**
 * Onglet **Plages** — le cœur de la transparence interne (principe 7 à l'envers :
 * ces barèmes chiffrés existent pour le PERSONNEL qui instruit, jamais pour le
 * client). Pour chaque chaîne : rendement, coût et prix bornés min/max, perte
 * maximale, statut (indicatif vs appris) et drapeau « à valider ».
 *
 * Rien n'est calculé ici : `formatBounds` ne fait que borner l'intervalle servi
 * par `/referentiel/ranges`. Un filtre par chaîne interroge le serveur (jamais
 * un filtrage financier local).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { referentielApi, formatBounds, groupRangesByChain, fmtNum } from '@/services/referentielApi';
import type { ChainRow } from '@/services/referentielApi';
import { isForbidden } from '@/services/referentielApi';
import type { ReferenceRange } from '@/types/api';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { Btn, Card, CardHead, Note, Pill } from './Bits';

const RangesPanel: React.FC = () => {
  const [version, setVersion] = useState<string | null>(null);
  const [ranges, setRanges] = useState<ReferenceRange[] | null>(null);
  const [chains, setChains] = useState<ChainRow[]>([]);
  const [chain, setChain] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [forbidden, setForbidden] = useState<string | null>(null);

  const load = useCallback(async (chainFilter: string) => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    try {
      const res = await referentielApi.ranges(chainFilter || undefined);
      setVersion(res.version);
      setRanges(res.ranges);
    } catch (e) {
      setRanges(null);
      if (isForbidden(e)) setForbidden(e.message);
      else setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Le catalogue des chaînes alimente le sélecteur de filtre — un échec ici ne
  // bloque pas les plages : on retombe sur les chaînes présentes dans la réponse.
  useEffect(() => {
    let alive = true;
    referentielApi.chains()
      .then((c) => { if (alive) setChains(c); })
      .catch(() => { /* filtre par catalogue indisponible, non bloquant */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => { void load(chain); }, [load, chain]);

  if (forbidden) {
    return (
      <Forbidden
        message="Plages du référentiel réservées au personnel."
        detail={forbidden}
      />
    );
  }

  const grouped = groupRangesByChain(ranges ?? []);
  const chainOptions = chains.length
    ? chains
    : grouped.map((g) => ({ code: g.chain_code, libelle: g.chain_libelle, specialite: '' }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Plages technico-économiques"
          subtitle="Rendement, coût et prix bornés par chaîne de valeur — la référence à laquelle le moteur situe chaque poste d'un dossier. Données internes : elles n'apparaissent sur aucun écran client."
          right={<Btn onClick={() => void load(chain)} busy={loading}>Rafraîchir</Btn>}
        />

        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-white/10">
          <label className="text-xs text-slate-400" htmlFor="chain-filter">Filtrer par chaîne</label>
          <select
            id="chain-filter"
            value={chain}
            onChange={(e) => setChain(e.target.value)}
            className="bg-slate-900/60 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">Toutes les chaînes</option>
            {chainOptions.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.libelle}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500">
            Version active :{' '}
            {version
              ? <span className="font-mono text-slate-300">{version}</span>
              : <span className="text-amber-300">aucune</span>}
          </span>
        </div>

        {loading && <Loading label="Chargement des plages…" />}

        <div className="p-4"><ErrorPanel errors={errors} title="Plages indisponibles" /></div>

        {!loading && errors.length === 0 && !version && (
          <Note tone="warn">
            Aucune version de référentiel n'est active : le moteur n'a pas de plage de
            comparaison, les écarts techniques d'un dossier ne sont pas évaluables. L'activation
            se fait par import côté serveur, pas depuis cet écran.
          </Note>
        )}

        {!loading && errors.length === 0 && version && grouped.length === 0 && (
          <Empty
            title="Aucune plage pour ce filtre."
            hint="La version active ne porte pas de plage pour la chaîne sélectionnée."
          />
        )}

        {!loading && grouped.map((g) => (
          <div key={g.chain_code} className="border-t border-white/5">
            <div className="px-4 pt-4 pb-2 flex items-center gap-2">
              <span className="font-mono text-xs text-slate-500">{g.chain_code}</span>
              <span className="text-white font-medium">{g.chain_libelle}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="text-left p-3">Paramètre</th>
                    <th className="text-left p-3">Système</th>
                    <th className="text-left p-3">Rendement</th>
                    <th className="text-left p-3">Coût</th>
                    <th className="text-left p-3">Prix</th>
                    <th className="text-right p-3">Perte max</th>
                    <th className="text-center p-3">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {g.ranges.map((r, i) => (
                    <tr key={`${r.name}-${i}`} className="border-t border-white/5 hover:bg-white/5">
                      <td className="p-3 text-white">
                        {r.name}
                        {r.a_valider && (
                          <span className="ml-2"><Pill label="à valider" color="text-amber-300 bg-amber-500/20" /></span>
                        )}
                      </td>
                      <td className="p-3 text-slate-400">{r.systeme || '—'}</td>
                      <td className="p-3 text-slate-300">{formatBounds(r.rendement, r.unite)}</td>
                      <td className="p-3 text-slate-300">{formatBounds(r.cout, r.unite)}</td>
                      <td className="p-3 text-slate-300">{formatBounds(r.prix)}</td>
                      <td className="p-3 text-right text-slate-300">
                        {r.perte_max === null || r.perte_max === undefined ? '—' : `${fmtNum(r.perte_max)} %`}
                      </td>
                      <td className="p-3 text-center">
                        <Pill
                          label={r.statut || '—'}
                          color={r.statut === 'indicatif'
                            ? 'text-slate-400 bg-slate-500/20'
                            : 'text-emerald-300 bg-emerald-500/20'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {!loading && grouped.length > 0 && (
          <div className="p-4">
            <Note>
              Un statut « indicatif » signale une plage estimée (N &lt; 30 dossiers, fiabilité
              limitée — CLAUDE.md §4.6) ; une plage apprise porte l'autorité des dossiers réels.
              Le drapeau « à valider » marque une borne en attente de contrôle qualité.
            </Note>
          </div>
        )}
      </Card>
    </div>
  );
};

export default RangesPanel;

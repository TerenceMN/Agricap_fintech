/**
 * Onglet **Filières** — le catalogue des 14 chaînes de valeur (code, libellé,
 * spécialité). C'est le SEUL référentiel non chiffré du lot : le serveur le sert
 * à tout compte authentifié (`IsAuthenticated`), pas seulement au personnel, car
 * il ne porte aucune règle de décision — ni plage, ni seuil, ni poids. Il
 * nomme, il ne barème pas.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { referentielApi, isForbidden } from '@/services/referentielApi';
import type { ChainRow } from '@/services/referentielApi';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { Btn, Card, CardHead, Note } from './Bits';

const ChainsPanel: React.FC = () => {
  const [rows, setRows] = useState<ChainRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [forbidden, setForbidden] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    try {
      setRows(await referentielApi.chains());
    } catch (e) {
      setRows(null);
      if (isForbidden(e)) setForbidden(e.message);
      else setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (forbidden) return <Forbidden detail={forbidden} />;

  const list = rows ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Catalogue des chaînes de valeur"
          subtitle="Les cultures reconnues par AGRICAP (code canonique, libellé, spécialité). Nomenclature unique : tout nouveau code rejoint cette liste ou n'existe pas (principe 6)."
          right={<Btn onClick={() => void load()} busy={loading}>Rafraîchir</Btn>}
        />

        {loading && <Loading label="Chargement du catalogue…" />}

        <div className="p-4"><ErrorPanel errors={errors} title="Catalogue indisponible" /></div>

        {!loading && errors.length === 0 && list.length === 0 && (
          <Empty
            title="Aucune chaîne au catalogue."
            hint="Sans catalogue de filières, aucun dossier ne peut être rattaché à une culture."
          />
        )}

        {!loading && list.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="text-slate-400 border-b border-white/10">
                <tr>
                  <th className="text-left p-3">Code</th>
                  <th className="text-left p-3">Libellé</th>
                  <th className="text-left p-3">Spécialité</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.code} className="border-t border-white/5 hover:bg-white/5">
                    <td className="p-3 font-mono text-slate-300">{c.code}</td>
                    <td className="p-3 text-white">{c.libelle}</td>
                    <td className="p-3 text-slate-400">{c.specialite || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && list.length > 0 && (
          <div className="p-4">
            <Note>
              {list.length} chaîne(s) au catalogue. À la différence des plages, des seuils et des
              poids, ce catalogue n'est pas un secret d'instruction : un demandeur peut savoir que
              « maïs » porte le code 09 sans que cela lui apprenne comment franchir la règle.
            </Note>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ChainsPanel;

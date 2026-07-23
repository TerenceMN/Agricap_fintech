/**
 * Onglet **Historique des versions** — la seule information qui répond à « sous
 * quelle version un dossier a-t-il été jugé ? ». Le référentiel technico-
 * économique est importé par commande (jamais édité depuis l'application) ; ce
 * qui compte pour l'auditeur, c'est de savoir laquelle faisait foi à un instant.
 *
 * L'écran signale deux anomalies d'import que le serveur ne tranche pas seul :
 * aucune version active (pas de plage de référence) et plusieurs actives
 * (ambiguïté). Aucun chiffre calculé — un tri et un décompte d'anomalie.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  referentielApi, isForbidden, sortVersions, versionsAnomaly, fmtDateTime,
} from '@/services/referentielApi';
import type { ReferentielVersionRow } from '@/services/referentielApi';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { Btn, Card, CardHead, Note, Pill } from './Bits';

const VersionsPanel: React.FC = () => {
  const [rows, setRows] = useState<ReferentielVersionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [forbidden, setForbidden] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    try {
      setRows(await referentielApi.versions());
    } catch (e) {
      setRows(null);
      if (isForbidden(e)) setForbidden(e.message);
      else setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (forbidden) {
    return (
      <Forbidden
        message="Historique du référentiel réservé au personnel."
        detail={forbidden}
      />
    );
  }

  const list = rows ? sortVersions(rows) : [];
  const anomaly = rows ? versionsAnomaly(rows) : 'none';

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Versions du référentiel technico-économique"
          subtitle="Importées par commande d'administration, en lecture seule. Cet écran sert à reconstituer laquelle faisait foi au moment d'une analyse."
          right={<Btn onClick={() => void load()} busy={loading}>Rafraîchir</Btn>}
        />

        {loading && <Loading label="Chargement des versions…" />}

        <div className="p-4"><ErrorPanel errors={errors} title="Historique indisponible" /></div>

        {!loading && errors.length === 0 && list.length === 0 && (
          <Empty
            title="Aucune version de référentiel importée."
            hint="Sans référentiel, le moteur n'a aucune plage de comparaison : les écarts techniques d'un dossier ne sont pas évaluables."
          />
        )}

        {!loading && list.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="text-left p-3">Version</th>
                    <th className="text-center p-3">État</th>
                    <th className="text-left p-3">Importée le</th>
                    <th className="text-right p-3">Plages</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((v) => (
                    <tr key={v.id} className="border-t border-white/5 hover:bg-white/5">
                      <td className="p-3 text-white">{v.label}</td>
                      <td className="p-3 text-center">
                        <Pill
                          label={v.is_active ? 'Active' : 'Archivée'}
                          color={v.is_active
                            ? 'text-emerald-300 bg-emerald-500/20'
                            : 'text-slate-400 bg-slate-500/20'}
                        />
                      </td>
                      <td className="p-3 text-slate-400 text-xs">{fmtDateTime(v.imported_at)}</td>
                      <td className="p-3 text-right text-slate-300">{v.n_ranges}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 space-y-2">
              {anomaly === 'no-active' && (
                <Note tone="warn">
                  Aucune version n'est active : les comparaisons de plages du moteur n'ont pas de
                  référence courante. Les écarts techniques ne seront pas évaluables tant qu'une
                  version n'est pas activée par import.
                </Note>
              )}
              {anomaly === 'multiple-active' && (
                <Note tone="warn">
                  Plusieurs versions sont actives simultanément. Le moteur n'en retiendra qu'une ;
                  l'ambiguïté est un défaut d'import à corriger côté serveur, pas un choix à faire
                  depuis cet écran.
                </Note>
              )}
              <Note>
                Les plages elles-mêmes, le catalogue des chaînes et la configuration institution
                sont dans les autres onglets — ils ne sont pas redoublés ici.
              </Note>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default VersionsPanel;

/**
 * Section 4 — **Versions du référentiel technico-économique**.
 *
 * Le référentiel v3 (14 chaînes, plages min/max par paramètre) est importé par
 * commande, jamais édité depuis l'application : il est en lecture seule ici, et
 * c'est volontaire. Ce que cet écran apporte, c'est la seule information qui
 * manquait et qui n'était consultable nulle part : **sous quelle version un
 * dossier a été jugé**. Une analyse produite sous la version « v3-2025 » ne se
 * relit pas à l'aune d'une version importée depuis.
 *
 * Ne duplique volontairement ni les plages (`/referentiel/ranges`), ni les
 * chaînes (`/referentiel/chains`), ni la configuration institution
 * (`/referentiel/config`) : ces trois-là sont déjà servies ailleurs dans
 * l'application, et un second affichage divergerait du premier.
 *
 * Backend : `referentiel/views.py::versions` — seul endpoint du lot en
 * snake_case (pas de serializer camelisant).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { Btn, Card, CardHead, Note, Pill } from './Bits';
import { fmtDateTime, isForbidden, type ReferentielVersionRow } from './wire';

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
      const res = await api.referentielVersions();
      setRows(res as ReferentielVersionRow[]);
    } catch (e) {
      setRows(null);
      if (isForbidden(e)) setForbidden(e.message);
      else setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const list = rows ?? [];
  const actives = list.filter((v) => v.is_active);

  if (forbidden) {
    return (
      <Forbidden
        message="Historique du référentiel réservé aux comptes authentifiés du personnel."
        detail={forbidden}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Versions du référentiel technico-économique"
          subtitle="Plages de rendement, de coût et de prix par chaîne de valeur. Importées par commande d'administration, en lecture seule depuis l'application : cet écran sert à savoir laquelle faisait foi à un moment donné."
          right={<Btn onClick={() => void load()} busy={loading}>Rafraîchir</Btn>}
        />

        {loading && <Loading label="Chargement des versions…" />}

        <ErrorPanel errors={errors} title="Historique indisponible" />

        {!loading && errors.length === 0 && list.length === 0 && (
          <Empty
            title="Aucune version de référentiel importée."
            hint="Sans référentiel, le moteur n'a aucune plage de comparaison : les écarts techniques d'un dossier ne sont pas évaluables."
          />
        )}

        {!loading && list.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[620px]">
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
              {actives.length === 0 && (
                <Note tone="warn">
                  Aucune version n'est marquée active : les comparaisons de plages du moteur
                  n'ont pas de référence courante. Les écarts techniques ne seront pas
                  évaluables tant qu'une version n'est pas activée par import.
                </Note>
              )}
              {actives.length > 1 && (
                <Note tone="warn">
                  {actives.length} versions sont marquées actives simultanément. Le moteur en
                  retiendra une seule ; l'ambiguïté est un défaut d'import à corriger côté
                  serveur, pas un choix à faire depuis cet écran.
                </Note>
              )}
              <Note>
                Les plages elles-mêmes, les 14 chaînes et la configuration institution sont
                servies par d'autres écrans — elles ne sont pas redoublées ici pour éviter
                deux affichages qui divergeraient.
              </Note>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default VersionsPanel;

/**
 * Onglet **Configuration institution** — les réglages qui gouvernent une
 * décision de crédit : seuils DSCR (nominal et stressé), couverture minimale,
 * score global minimum, les cinq poids du scoring, le taux d'intérêt annuel, le
 * plafond de délégation et la phase de déploiement.
 *
 * C'est le référentiel le plus sensible du point de vue anti-gaming : un client
 * qui connaît le seuil DSCR ou les poids construit son dossier pour franchir la
 * barre. Réservé au personnel (`IsStaff`), le serveur re-vérifie.
 *
 * La seule opération « calculée » ici — la somme des cinq poids — n'est pas un
 * chiffre financier d'un client : c'est un CONTRÔLE d'intégrité de la config
 * (invariant CLAUDE.md §5 : Σ poids = 100). On signale un écart, on ne corrige
 * pas depuis l'écran.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { referentielApi, isForbidden, fmtNum, analysePoids } from '@/services/referentielApi';
import type { InstitutionConfigPayload } from '@/services/referentielApi';
import {
  ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { Btn, Card, CardHead, Note, Pill } from './Bits';

const Row: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({
  label, value, hint,
}) => (
  <div className="flex items-start justify-between gap-4 px-4 py-3 border-t border-white/5">
    <div>
      <p className="text-slate-300">{label}</p>
      {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
    </div>
    <p className="text-white font-medium text-right shrink-0">{value}</p>
  </div>
);

const ConfigPanel: React.FC = () => {
  const [cfg, setCfg] = useState<InstitutionConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [forbidden, setForbidden] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(null);
    try {
      setCfg(await referentielApi.config());
    } catch (e) {
      setCfg(null);
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
        message="Configuration institution réservée au personnel."
        detail={forbidden}
      />
    );
  }

  const poids = cfg ? analysePoids(cfg.poids) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title="Configuration de l'institution"
          subtitle="Les seuils et pondérations qui traduisent un dossier en décision. Modifiables par le comité sans redéploiement (principe 8), en lecture seule ici."
          right={<Btn onClick={() => void load()} busy={loading}>Rafraîchir</Btn>}
        />

        {loading && <Loading label="Chargement de la configuration…" />}

        <div className="p-4"><ErrorPanel errors={errors} title="Configuration indisponible" /></div>

        {!loading && cfg && (
          <>
            <Row label="Seuil DSCR (nominal)" value={fmtNum(cfg.seuil_dscr)}
              hint="Sous ce ratio, la capacité de remboursement ne couvre plus le service de la dette." />
            <Row label="Seuil DSCR (stressé)" value={fmtNum(cfg.seuil_dscr_stresse)}
              hint="Le même ratio après application du stress test." />
            <Row label="Couverture minimale des garanties" value={`${fmtNum(cfg.couverture_min)} %`} />
            <Row label="Score global minimum" value={fmtNum(cfg.score_global_min)} />
            <Row label="Taux d'intérêt annuel" value={`${fmtNum(cfg.taux_interet_annuel)} %`} />
            <Row label="Plafond de délégation" value={fmtNum(cfg.plafond_delegue)}
              hint="Au-delà, la décision remonte au comité de crédit." />
            <Row label="Phase de déploiement" value={<Pill label={cfg.phase_deploiement || '—'} />} />
          </>
        )}
      </Card>

      {!loading && cfg && poids && (
        <Card>
          <CardHead
            title="Poids des cinq critères de scoring"
            subtitle="La part de chaque critère dans le score global. Leur somme doit valoir 100."
            right={(
              <Pill
                label={poids.consistent ? `Σ = ${fmtNum(poids.sum)}` : `Σ = ${fmtNum(poids.sum)} ⚠`}
                color={poids.consistent
                  ? 'text-emerald-300 bg-emerald-500/20'
                  : 'text-amber-300 bg-amber-500/20'}
              />
            )}
          />
          {poids.parts.map((p) => (
            <Row key={p.key} label={p.label} value={`${fmtNum(p.value)} %`} />
          ))}
          {!poids.consistent && (
            <div className="p-4">
              <Note tone="warn">
                Les cinq poids totalisent {fmtNum(poids.sum)} au lieu de 100. Un score global calculé
                sur des poids qui ne somment pas à 100 n'a pas l'échelle attendue : c'est un défaut
                de configuration à corriger côté comité, signalé ici et non masqué.
              </Note>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default ConfigPanel;

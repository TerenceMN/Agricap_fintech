/**
 * File de vérification des actifs — `/credit/actifs` (agent de terrain).
 *
 * `GET /api/assets/pending` sert les actifs au statut `declare`, réservé au
 * groupe `CAN_VERIFY_ASSET` (403 sinon). Deux actes possibles, tous deux servis
 * par un endpoint protégé :
 *   - `POST /api/assets/<id>/verify` — `{valeur_verifiee}` : l'agent constate
 *     une valeur sur place ;
 *   - `POST /api/assets/<id>/reject` — `{motif}` OBLIGATOIRE (422 sans).
 *
 * Point cardinal rendu visible à l'écran : **la valeur retenue est calculée par
 * le serveur**, valeur constatée moins la décote institutionnelle
 * (`InstitutionConfig.decote_garantie`, 30 % par défaut — cf.
 * `assets/services.py::valeur_apres_decote`). L'agent constate, il ne négocie
 * pas la décote, et le front n'en simule jamais le résultat : la valeur retenue
 * n'est affichée qu'APRÈS retour du serveur. Le taux de décote n'est d'ailleurs
 * pas exposé par l'API — le front ne pourrait pas la calculer même s'il le
 * voulait, et c'est très bien ainsi.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import type { AssetRow } from '@/types/api';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
import { fmtAmount, fmtDate } from './wire';

const TYPE_LABELS: Record<string, string> = {
  materiel: 'Matériel / équipement',
  foncier: 'Foncier',
  vehicule: 'Véhicule',
  stock: 'Stock',
  autre: 'Autre',
};

/** Résultat d'un acte de vérification, conservé pour montrer la valeur retenue. */
interface Outcome {
  assetId: number;
  name: string;
  kind: 'verified' | 'rejected';
  declaredValue: number;
  retainedValue: number | null;
  currency: string;
  motif?: string;
}

const AssetVerification: React.FC = () => {
  const [items, setItems] = useState<AssetRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const [openId, setOpenId] = useState<number | null>(null);
  const [mode, setMode] = useState<'verify' | 'reject'>('verify');
  const [valeurVerifiee, setValeurVerifiee] = useState('');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionErrors, setActionErrors] = useState<FieldError[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(false);
    try {
      const res = await api.assets.pending();
      setItems(res.items || []);
      setTotalRows(res.total_rows ?? (res.items || []).length);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
      } else {
        setErrors(toFieldErrors(e));
      }
      setItems([]);
      setTotalRows(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openPanel = (asset: AssetRow, next: 'verify' | 'reject') => {
    setOpenId(asset.id);
    setMode(next);
    setValeurVerifiee('');
    setMotif('');
    setActionErrors([]);
  };

  const submit = async (asset: AssetRow) => {
    setActionErrors([]);

    if (mode === 'verify') {
      const raw = valeurVerifiee.trim().replace(',', '.');
      if (!raw) {
        setActionErrors([{ code: 'VALEUR_REQUISE', message: 'La valeur constatée sur place est obligatoire.' }]);
        return;
      }
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) {
        setActionErrors([{ code: 'VALEUR_INVALIDE', message: 'La valeur constatée doit être un nombre strictement positif.' }]);
        return;
      }
      setBusy(true);
      try {
        // `valeur_verifiee` part telle quelle : le serveur applique la décote et
        // renvoie `valeurRetenue`. Aucun calcul ici.
        const updated = await api.assets.verify(asset.id, { valeur_verifiee: raw });
        setOutcomes((prev) => [{
          assetId: asset.id,
          name: asset.name,
          kind: 'verified',
          declaredValue: asset.value,
          retainedValue: updated.valeurRetenue,
          currency: updated.currency || asset.currency,
        }, ...prev]);
        setOpenId(null);
        await load();
      } catch (e) {
        setActionErrors(toFieldErrors(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Rejet — motif obligatoire ; le backend refuse en 422 sans lui.
    if (!motif.trim()) {
      setActionErrors([{ code: 'MOTIF_REQUIS', message: 'Le motif de rejet est obligatoire : il est communiqué au client et journalisé.' }]);
      return;
    }
    setBusy(true);
    try {
      const updated = await api.assets.reject(asset.id, motif.trim());
      setOutcomes((prev) => [{
        assetId: asset.id,
        name: asset.name,
        kind: 'rejected',
        declaredValue: asset.value,
        retainedValue: updated.valeurRetenue,
        currency: updated.currency || asset.currency,
        motif: updated.motifRejet || motif.trim(),
      }, ...prev]);
      setOpenId(null);
      await load();
    } catch (e) {
      setActionErrors(toFieldErrors(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 text-white">
      <Helmet><title>Vérification des actifs — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Vérification des actifs</h1>
          <p className="text-sm text-slate-400 mt-1">
            Actifs déclarés par les clients, en attente d'un contrôle sur place.
            Un actif non vérifié n'existe pas comme garantie.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/credit/dossiers" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            File d'instruction
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
          >
            Rafraîchir
          </button>
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-sm text-blue-100">
        <p className="font-semibold mb-1">Comment est fixée la valeur retenue</p>
        <p className="text-blue-100/80 leading-relaxed">
          Vous saisissez la <strong>valeur constatée</strong> sur le terrain. Le serveur en
          déduit seul la <strong>valeur retenue</strong> en appliquant la décote
          institutionnelle en vigueur. Vous ne négociez pas la décote et cet écran ne la
          prévisualise pas : la valeur retenue s'affiche après enregistrement, telle que le
          serveur l'a calculée. C'est elle, et elle seule, qui couvrira un crédit.
        </p>
      </div>

      {forbidden ? (
        <Forbidden
          message="Vérification des actifs réservée aux agents de terrain."
          detail="Le serveur a refusé l'accès à la file (403). Groupe requis : CAN_VERIFY_ASSET."
        />
      ) : (
        <>
          <ErrorPanel errors={errors} title="Chargement de la file impossible" />

          {/* Journal des actes de la session — la valeur retenue y est visible */}
          {outcomes.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
              <h2 className="text-sm font-semibold text-slate-300">Actes enregistrés dans cette session</h2>
              {outcomes.map((o, i) => (
                <div
                  key={`${o.assetId}-${i}`}
                  className={`rounded-lg p-3 text-sm border ${o.kind === 'verified'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100'
                    : 'bg-red-500/10 border-red-500/30 text-red-100'}`}
                >
                  <p className="font-medium">
                    {o.kind === 'verified' ? 'Actif vérifié' : 'Actif rejeté'} — {o.name}
                  </p>
                  {o.kind === 'verified' ? (
                    <p className="mt-1">
                      Valeur retenue calculée par le serveur :{' '}
                      <span className="font-bold">{fmtAmount(o.retainedValue, o.currency)}</span>
                      <span className="text-emerald-200/70">
                        {' '}(valeur déclarée par le client : {fmtAmount(o.declaredValue, o.currency)})
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1">
                      Valeur retenue effacée par le serveur. Motif transmis : « {o.motif} »
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              {items.length} actif(s) affiché(s) — <code className="font-mono">total_rows</code> = {totalRows}
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              Périmètre : tous les actifs au statut « déclaré », toutes agences
            </span>
          </div>

          <div className="space-y-3">
            {items.map((asset) => (
              <div key={asset.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{asset.name || `Actif #${asset.id}`}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {TYPE_LABELS[asset.type] ?? asset.type}
                      {asset.guaranteeType && (
                        <> · type de garantie : <span className="text-emerald-300">{asset.guaranteeType}</span></>
                      )}
                      {' '}· déclaré le {fmtDate(asset.createdAt)}
                    </p>
                    <p className="text-sm text-slate-300 mt-2">
                      Propriétaire :{' '}
                      <span className="text-white font-medium">
                        {asset.owner?.displayName || asset.owner?.sub || '—'}
                      </span>
                      {asset.owner?.phone && <span className="text-slate-500"> · {asset.owner.phone}</span>}
                    </p>
                    {asset.localisation && (
                      <p className="text-sm text-slate-400">Localisation : {asset.localisation}</p>
                    )}
                    {asset.description && (
                      <p className="text-sm text-slate-400 mt-1">{asset.description}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-2">
                      Documents joints : {(asset.documents?.length ?? 0)}
                      {asset.image ? ' · une photo fournie' : ' · aucune photo'}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-400">Valeur déclarée par le client</p>
                    <p className="text-xl font-bold text-white">{fmtAmount(asset.value, asset.currency)}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Déclarative — non opposable</p>
                    <div className="flex gap-2 mt-3 justify-end">
                      <button
                        type="button"
                        onClick={() => openPanel(asset, 'verify')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
                      >
                        Vérifier
                      </button>
                      <button
                        type="button"
                        onClick={() => openPanel(asset, 'reject')}
                        className="px-3 py-1.5 rounded-lg bg-red-700/60 hover:bg-red-600 text-sm font-medium"
                      >
                        Rejeter
                      </button>
                    </div>
                  </div>
                </div>

                {openId === asset.id && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                    {mode === 'verify' ? (
                      <div>
                        <label className="text-xs text-slate-400" htmlFor={`val-${asset.id}`}>
                          Valeur constatée sur place ({asset.currency}) — obligatoire
                        </label>
                        <input
                          id={`val-${asset.id}`}
                          type="text"
                          inputMode="decimal"
                          value={valeurVerifiee}
                          onChange={(e) => setValeurVerifiee(e.target.value)}
                          placeholder={String(asset.value)}
                          className="w-full max-w-xs mt-1 bg-white/10 border border-white/20 rounded px-3 py-2 text-sm"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          La valeur retenue sera calculée par le serveur après décote et
                          affichée ci-dessus une fois enregistrée.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs text-slate-400" htmlFor={`motif-${asset.id}`}>
                          Motif du rejet — obligatoire, transmis au client et journalisé
                        </label>
                        <textarea
                          id={`motif-${asset.id}`}
                          rows={3}
                          value={motif}
                          onChange={(e) => setMotif(e.target.value)}
                          className="w-full mt-1 bg-white/10 border border-white/20 rounded px-3 py-2 text-sm"
                          placeholder="Ex. : le bien décrit n'a pas été retrouvé à l'adresse indiquée."
                        />
                      </div>
                    )}

                    <ErrorPanel errors={actionErrors} title="Enregistrement refusé" />

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submit(asset)}
                        className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
                      >
                        {busy ? 'Enregistrement…' : mode === 'verify' ? 'Enregistrer la vérification' : 'Enregistrer le rejet'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setOpenId(null)}
                        className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm disabled:opacity-50"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {loading && <Loading label="Chargement de la file de vérification…" />}
          {!loading && items.length === 0 && errors.length === 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl">
              <Empty
                title="Aucun actif en attente de vérification."
                hint="Les actifs déclarés par les clients apparaîtront ici dès leur soumission."
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AssetVerification;

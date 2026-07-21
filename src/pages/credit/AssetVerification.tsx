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
 * (`InstitutionConfig.decote_garantie` — cf. `assets/services.py::valeur_apres_decote`).
 * L'agent constate, il ne négocie pas la décote, et le front n'en simule jamais
 * le résultat : la valeur retenue n'est affichée qu'APRÈS retour du serveur.
 * Le taux de décote n'est exposé par aucun endpoint (`GET /api/referentiel/config`
 * sert les seuils et pondérations, pas `decote_garantie`) — la décote montrée
 * après enregistrement est donc l'écart CONSTATÉ entre les deux montants du
 * serveur, jamais un taux recopié côté écran. Cf. `RetainedValueBreakdown`.
 *
 * L'écran instruit sur pièces : `image` et `documents` (JSONField libre) sont
 * consultables ligne à ligne via `AssetEvidence`, et l'absence de pièce est
 * elle-même signalée.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import type { AssetRow } from '@/types/api';
import {
  Empty, ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError,
} from '@/components/backoffice/States';
// Nomenclature unique des catégories/statuts d'actif (principe 6) : miroir de
// `assets.Asset.Type` / `Asset.Status`, partagé avec l'inventaire client.
import { assetCategory, assetStatus } from '@/components/assets/assetMeta';
import AssetEvidence from '@/components/assets/AssetEvidence';
import RetainedValueBreakdown from '@/components/assets/RetainedValueBreakdown';
import { fmtAmount, fmtDate, fmtDateTime } from './wire';

/** Résultat d'un acte de vérification, conservé pour montrer la valeur retenue. */
interface Outcome {
  assetId: number;
  name: string;
  kind: 'verified' | 'rejected';
  declaredValue: number;
  /** Valeur constatée envoyée au serveur — indispensable pour lire la décote. */
  observedValue: number | null;
  retainedValue: number | null;
  isPledgeable: boolean;
  currency: string;
  verifieLe: string | null;
  motif?: string;
}

/** Nombre de pièces jointes servies pour un actif (photo comprise). */
function pieceCount(asset: AssetRow): number {
  return (asset.documents?.length ?? 0) + (asset.image && asset.image.trim() ? 1 : 0);
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
  const [evidenceOpen, setEvidenceOpen] = useState<number[]>([]);

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
    // On ne tranche pas sans avoir les pièces sous les yeux.
    setEvidenceOpen((prev) => (prev.includes(asset.id) ? prev : [...prev, asset.id]));
  };

  const toggleEvidence = (id: number) => {
    setEvidenceOpen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /** Écho de la saisie de l'agent, uniquement pour l'afficher — aucun calcul métier. */
  const observedInput = useMemo(() => {
    const raw = valeurVerifiee.trim().replace(',', '.');
    if (!raw) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }, [valeurVerifiee]);

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
          observedValue: num,
          retainedValue: updated.valeurRetenue,
          isPledgeable: updated.isPledgeable,
          currency: updated.currency || asset.currency,
          verifieLe: updated.verifieLe,
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
        observedValue: null,
        retainedValue: updated.valeurRetenue,
        isPledgeable: updated.isPledgeable,
        currency: updated.currency || asset.currency,
        verifieLe: updated.verifieLe,
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
          serveur l'a calculée, avec l'abattement qu'elle a subi. C'est elle, et elle seule,
          qui couvrira un crédit.
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
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
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
                    <span className="ml-2 text-xs font-normal opacity-70">
                      {fmtDateTime(o.verifieLe)}
                    </span>
                  </p>
                  {o.kind === 'verified' ? (
                    <div className="mt-2">
                      <RetainedValueBreakdown
                        currency={o.currency}
                        declaredValue={o.declaredValue}
                        observedValue={o.observedValue}
                        retainedValue={o.retainedValue}
                        isPledgeable={o.isPledgeable}
                      />
                    </div>
                  ) : (
                    <p className="mt-1">
                      Valeur retenue effacée par le serveur ({fmtAmount(o.retainedValue, o.currency)}) :
                      cet actif ne peut plus garantir aucun crédit. Motif transmis : « {o.motif} »
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
            {items.map((asset) => {
              const cat = assetCategory(asset.type);
              const st = assetStatus(asset.status);
              const pieces = pieceCount(asset);
              const showEvidence = evidenceOpen.includes(asset.id);
              // `guaranteeType` est servi par le serveur : `null` = catégorie
              // « autre », que `verify_asset` refuse (422). On le dit avant l'acte.
              const notPledgeableCategory = !asset.guaranteeType;

              return (
                <div key={asset.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-white flex items-center gap-2 flex-wrap">
                        {asset.name || `Actif #${asset.id}`}
                        <span className={`px-2 py-0.5 rounded-full border text-[11px] font-normal ${st.badge}`}>
                          {st.label}
                        </span>
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        <span className={cat.color}>{cat.label}</span>
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

                      <button
                        type="button"
                        onClick={() => toggleEvidence(asset.id)}
                        aria-expanded={showEvidence}
                        className="mt-2 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300"
                      >
                        {showEvidence ? 'Masquer' : 'Consulter'} les pièces jointes ({pieces})
                      </button>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-xs text-slate-400">Valeur déclarée par le client</p>
                      <p className="text-xl font-bold text-white">{fmtAmount(asset.value, asset.currency)}</p>
                      <p className="text-[11px] text-slate-500 mt-1">Déclarative — non opposable</p>
                      <p className="text-[11px] text-slate-500">
                        Valeur retenue : aucune tant que l'actif n'est pas vérifié
                      </p>
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

                  {notPledgeableCategory && (
                    <p className="mt-3 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">
                      Catégorie « {cat.label} » : le serveur ne lui associe aucun type de
                      garantie (<code className="font-mono">guaranteeType = null</code>). Une
                      vérification sera refusée tant que le client n'aura pas précisé la
                      catégorie du bien — le rejet motivé est ici la voie normale.
                    </p>
                  )}

                  {showEvidence && (
                    <div className="mt-3">
                      <AssetEvidence image={asset.image} documents={asset.documents} />
                    </div>
                  )}

                  {openId === asset.id && (
                    <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                      {mode === 'verify' ? (
                        <div className="space-y-3">
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
                              Ne recopiez pas la valeur déclarée par réflexe : c'est votre
                              constat qui fonde la garantie.
                            </p>
                          </div>

                          <RetainedValueBreakdown
                            currency={asset.currency}
                            declaredValue={asset.value}
                            observedValue={observedInput}
                            retainedValue={null}
                            pendingLabel="calculée par le serveur"
                          />
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
              );
            })}
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

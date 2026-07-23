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
 * Le taux de décote EN VIGUEUR est désormais servi par `GET /api/referentiel/config`
 * (champ `decote_garantie`, réservé au staff), et affiché ici À TITRE INFORMATIF
 * pour que l'agent sache l'abattement à attendre — mais l'écran ne l'applique
 * jamais lui-même : la valeur retenue reste calculée serveur, et la décote
 * montrée dans le récapitulatif après enregistrement demeure l'écart CONSTATÉ
 * entre les deux montants du serveur, pas un produit du taux côté écran.
 * Cf. `RetainedValueBreakdown`.
 *
 * L'écran instruit sur pièces : `image` et `documents` (JSONField libre) sont
 * consultables ligne à ligne via `AssetEvidence`, et l'absence de pièce est
 * elle-même signalée.
 *
 * Second onglet — **historique de vérification** (`GET /api/assets/history`) :
 * la file ne sert que les `declare`, donc l'acte posé faisait disparaître
 * l'actif sans laisser de trace consultable. L'agent ne pouvait ni revoir une
 * valeur qu'il avait retenue, ni relire le motif d'un rejet qu'on lui opposait,
 * ni constater qu'un actif vérifié était depuis gagé. Une file sans historique
 * oblige à se souvenir. Cet onglet est en LECTURE SEULE absolue : instruire se
 * fait par `verify`/`reject`, et aucun bouton d'action n'y figure.
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
import {
  anomalies, ecartDeclareRetenu, effectifsParStatut, recitActe, STATUTS_HISTORIQUE,
  type StatutHistorique,
} from './assetHistoryWire';

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

/** Libellés des filtres de l'historique — les codes viennent du backend. */
const FILTRE_LABELS: Record<StatutHistorique, string> = {
  verifie: 'Vérifiés',
  gage: 'Gagés',
  libere: 'Libérés',
  rejete: 'Rejetés',
};

/**
 * Historique de vérification — `GET /api/assets/history`, lecture seule.
 *
 * Le filtre de statut est envoyé AU SERVEUR (`?status=`) plutôt qu'appliqué sur
 * la liste déjà chargée : filtrer côté navigateur ferait mentir `total_rows`,
 * qui décrirait alors un périmètre différent de ce qui est affiché.
 */
const VerificationHistory: React.FC = () => {
  const [items, setItems] = useState<AssetRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [statut, setStatut] = useState<StatutHistorique | ''>('');
  const [detailOuvert, setDetailOuvert] = useState<number[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setForbidden(false);
    try {
      const res = await api.assets.history(statut || undefined);
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
  }, [statut]);

  useEffect(() => { void load(); }, [load]);

  const effectifs = useMemo(() => effectifsParStatut(items), [items]);
  const toggleDetail = (id: number) => {
    setDetailOuvert((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  if (forbidden) {
    return (
      <Forbidden
        message="Historique de vérification réservé aux agents de terrain."
        detail="Le serveur applique à l'historique la même garde qu'à la file (403). Groupe requis : CAN_VERIFY_ASSET."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-slate-300">
        <p className="font-semibold text-white mb-1">Lecture seule</p>
        <p className="text-slate-400 leading-relaxed">
          Tout ce qui a déjà été instruit : vérifié, rejeté, gagé, libéré. Aucun acte ne se pose
          depuis cet onglet — une valeur retenue ne se corrige pas, on ré-instruit l'actif depuis
          la file après une nouvelle déclaration du client.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStatut('')}
          aria-pressed={statut === ''}
          className={`px-3 py-1.5 rounded-lg text-sm border ${
            statut === ''
              ? 'bg-white/15 border-white/25 text-white'
              : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
          }`}
        >
          Tous les actes
        </button>
        {STATUTS_HISTORIQUE.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setStatut(code)}
            aria-pressed={statut === code}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              statut === code
                ? 'bg-white/15 border-white/25 text-white'
                : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
            }`}
          >
            {FILTRE_LABELS[code]}
            {statut === '' && (
              <span className="ml-1.5 text-xs text-slate-500">({effectifs[code] ?? 0})</span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
        >
          Rafraîchir
        </button>
      </div>

      <ErrorPanel errors={errors} title="Historique indisponible" />

      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
          {items.length} actif(s) affiché(s) — <code className="font-mono">total_rows</code> = {totalRows}
        </span>
        <span className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
          Périmètre : {statut ? `actifs « ${FILTRE_LABELS[statut]} »` : 'tous les actifs instruits'},
          toutes agences — tri sur la date de vérification, la plus récente en tête
        </span>
      </div>

      <div className="space-y-3">
        {items.map((asset) => {
          const cat = assetCategory(asset.type);
          const st = assetStatus(asset.status);
          const ecart = ecartDeclareRetenu(asset);
          const signaux = anomalies(asset);
          const ouvert = detailOuvert.includes(asset.id);

          return (
            <div
              key={asset.id}
              className={`bg-white/5 border border-white/10 border-l-4 rounded-xl p-4 ${st.accent}`}
            >
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
                    {' '}· déclaré le {fmtDate(asset.createdAt)}
                    {' '}· instruit le {fmtDateTime(asset.verifieLe)}
                  </p>
                  <p className="text-sm text-slate-300 mt-2">
                    Propriétaire :{' '}
                    <span className="text-white font-medium">
                      {asset.owner?.displayName || asset.owner?.sub || '—'}
                    </span>
                    {asset.owner?.phone && <span className="text-slate-500"> · {asset.owner.phone}</span>}
                  </p>
                  <p className="text-sm text-slate-400 mt-1">{recitActe(asset)}</p>
                  {asset.verifieParSub && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Acte posé par <span className="font-mono">{asset.verifieParSub}</span>
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xs text-slate-400">Valeur retenue</p>
                  <p className={`text-xl font-bold ${
                    asset.valeurRetenue == null ? 'text-slate-500' : 'text-emerald-300'
                  }`}>
                    {asset.valeurRetenue == null ? 'aucune' : fmtAmount(asset.valeurRetenue, asset.currency)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Déclarée : {fmtAmount(asset.value, asset.currency)}
                  </p>
                  {ecart !== null && (
                    <p className="text-[11px] text-slate-500">
                      Écart déclaré → retenu : {fmtAmount(ecart, asset.currency)}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500 mt-1">
                    Mobilisable en garantie :{' '}
                    <span className={asset.isPledgeable ? 'text-emerald-300' : 'text-slate-400'}>
                      {asset.isPledgeable ? 'oui' : 'non'}
                    </span>
                  </p>
                </div>
              </div>

              {asset.status === 'rejete' && (
                <p className="mt-3 text-sm text-red-100 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <span className="block text-[11px] uppercase tracking-wide text-red-300/80 mb-1">
                    Motif du rejet transmis au client
                  </span>
                  {asset.motifRejet || '— aucun motif enregistré —'}
                </p>
              )}

              {asset.gageApplication && (
                <p className="mt-3 text-sm text-orange-100 bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 flex flex-wrap items-center gap-2">
                  <span>
                    Nanti sur le dossier{' '}
                    <span className="font-mono font-semibold">{asset.gageApplication}</span>
                  </span>
                  <Link
                    to={`/credit/dossiers/${asset.gageApplication}`}
                    className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-xs"
                  >
                    Ouvrir le dossier
                  </Link>
                </p>
              )}

              {signaux.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {signaux.map((s) => (
                    <li
                      key={s.code}
                      className="text-xs text-amber-100 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5"
                    >
                      <p>{s.fait}</p>
                      <p className="text-amber-200/70 mt-1">Question à poser : {s.question}</p>
                      <p className="text-[10px] font-mono text-amber-200/50 mt-1">{s.code}</p>
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={() => toggleDetail(asset.id)}
                aria-expanded={ouvert}
                className="mt-3 text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300"
              >
                {ouvert ? 'Masquer' : 'Revoir'} la déclaration et les pièces ({pieceCount(asset)})
              </button>

              {ouvert && (
                <div className="mt-3 space-y-2">
                  {asset.localisation && (
                    <p className="text-sm text-slate-400">Localisation : {asset.localisation}</p>
                  )}
                  {asset.description && (
                    <p className="text-sm text-slate-400">{asset.description}</p>
                  )}
                  <AssetEvidence image={asset.image} documents={asset.documents} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {loading && <Loading label="Chargement de l'historique…" />}
      {!loading && items.length === 0 && errors.length === 0 && (
        <div className="bg-white/5 border border-white/10 rounded-xl">
          <Empty
            title={statut
              ? `Aucun actif au statut « ${FILTRE_LABELS[statut]} ».`
              : 'Aucun actif instruit à ce jour.'}
            hint="Les actifs vérifiés, rejetés, gagés ou libérés apparaissent ici dès que l'acte est posé."
          />
        </div>
      )}
    </div>
  );
};

const AssetVerification: React.FC = () => {
  const [onglet, setOnglet] = useState<'file' | 'historique'>('file');
  const [items, setItems] = useState<AssetRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  // Taux de décote EN VIGUEUR (`InstitutionConfig.decote_garantie`), servi par
  // `GET /api/referentiel/config` (donnée staff). Purement informatif : il dit à
  // l'agent l'abattement à attendre, mais l'écran n'applique jamais ce taux —
  // la valeur retenue reste calculée serveur. `null` tant qu'il n'est pas connu
  // (ou si l'appel échoue) : l'écran reste fonctionnel sans lui.
  const [decoteRate, setDecoteRate] = useState<number | null>(null);

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

  // Taux de décote en vigueur — chargé une fois. Échec silencieux : c'est un
  // confort d'affichage, pas un préalable à instruire (la valeur retenue vient
  // du serveur de toute façon).
  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const cfg = await api.config();
        if (vivant && typeof cfg.decote_garantie === 'number') {
          setDecoteRate(cfg.decote_garantie);
        }
      } catch {
        /* config indisponible : on n'affiche simplement pas le taux */
      }
    })();
    return () => { vivant = false; };
  }, []);

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
            {onglet === 'file'
              ? "Actifs déclarés par les clients, en attente d'un contrôle sur place. "
                + "Un actif non vérifié n'existe pas comme garantie."
              : 'Ce qui a déjà été instruit — pour revoir une valeur retenue, relire un motif '
                + 'de rejet, ou constater qu’un actif vérifié est depuis gagé.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/credit/dossiers" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            File d'instruction
          </Link>
          {onglet === 'file' && (
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
            >
              Rafraîchir
            </button>
          )}
        </div>
      </div>

      {/* Deux surfaces, deux endpoints, deux gardes serveur identiques : la file
          (`/assets/pending`, actionnable) et l'historique (`/assets/history`,
          lecture seule). Les mélanger ferait croire qu'un acte se repose. */}
      <div role="tablist" aria-label="Vues de la vérification des actifs" className="flex gap-2 border-b border-white/10">
        {([
          ['file', "File d'attente"],
          ['historique', 'Historique de vérification'],
        ] as const).map(([code, label]) => (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={onglet === code}
            onClick={() => setOnglet(code)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${
              onglet === code
                ? 'border-primary text-white font-medium'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {onglet === 'historique' ? <VerificationHistory /> : (
      <>
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
        {decoteRate != null && (
          <p className="mt-2 text-blue-100/90">
            Décote institutionnelle en vigueur :{' '}
            <strong>{(decoteRate * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %</strong>.
            Chiffre indicatif servi par la configuration institution — le serveur l'applique à
            la valeur constatée ; cet écran ne calcule pas la valeur retenue.
          </p>
        )}
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
      </>
      )}
    </div>
  );
};

export default AssetVerification;

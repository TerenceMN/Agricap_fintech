/**
 * Étape 2 — dépôt de la feuille de besoins, seule entrée possible des montants.
 *
 * SPEC §1.4 points 1, 2 et 5 : tant qu'aucune feuille n'est ingérée, le
 * simulateur est vide ; pour changer un coût, le client change **son fichier**
 * et le re-téléverse. Aucun montant ne se saisit ici.
 *
 * Le panneau n'affiche que ce que l'API a arrêté : totaux, `revision`, `sha256`.
 * Il ne calcule rien.
 */
import React, { useRef } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatMontant } from '@/components/guarantees/format';
import { needsSheetHint } from './needsSheetErrors';

/**
 * Échec NON imputable au fichier (session expirée, service indisponible, réseau).
 *
 * Cadre volontairement distinct de `NeedsSheetErrorList` : ni rouge « refus »,
 * ni vocabulaire de correction. Le client doit repartir avec « réessayez », pas
 * avec « votre classeur est mauvais » — c'est tout l'objet de la séparation.
 */
export const NeedsSheetFailure = ({ failure, onRetry }) => {
  if (!failure) return null;
  return (
    <div className="rounded-2xl border border-slate-500/40 bg-slate-500/[0.08] p-5">
      <p className="font-semibold text-slate-100 flex items-center gap-2">
        <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
        {failure.titre}
      </p>
      <p className="text-sm text-slate-300/85 mt-2 leading-relaxed">{failure.message}</p>
      {!failure.reconnexion && onRetry && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          className="mt-3 border-white/20 hover:bg-white/10"
        >
          <FileUp className="w-4 h-4 mr-2" aria-hidden="true" /> Réessayer avec le même fichier
        </Button>
      )}
    </div>
  );
};

/** Liste de refus 422 : une carte par cause, jamais un message agrégé. */
export const NeedsSheetErrorList = ({ errors, title }) => {
  if (!errors?.length) return null;
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-5">
      <h4 className="font-bold text-red-200 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        {title
          || (errors.length > 1
            ? `${errors.length} points à corriger dans votre fichier`
            : 'Un point à corriger dans votre fichier')}
      </h4>
      <ul className="mt-4 space-y-4">
        {errors.map((cause, i) => {
          const hint = needsSheetHint(cause.code);
          return (
            <li
              key={cause.code ? `${cause.code}-${i}` : i}
              className={`rounded-xl p-3 border ${
                hint?.accent
                  ? 'border-amber-500/40 bg-amber-500/[0.08]'
                  : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <p className="text-sm font-semibold text-red-100 flex items-center gap-2">
                {hint?.titre || 'Refus de validation'}
                {cause.code && (
                  <span className="text-[10px] font-mono font-normal text-gray-500">{cause.code}</span>
                )}
              </p>
              <p className="text-sm text-red-100/85 mt-1">{cause.message}</p>
              {hint?.conseil && (
                <p className="text-xs text-gray-400 mt-2 leading-relaxed">{hint.conseil}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-gray-500 mt-4">
        Corrigez tous ces points en une fois dans le classeur, puis téléversez-le à nouveau.
      </p>
    </div>
  );
};

/**
 * @param {object} props
 * @param {string} props.valueChainCode filière du dossier (pour le bon template)
 * @param {string} props.currency devise du dossier, portée par la donnée
 * @param {string} props.templateUrl URL servie par `api.credits.templateUrl`
 * @param {object|null} props.result réponse de `parse/` (needsSourceId, revision, sha256, grandTotal)
 * @param {boolean} props.uploading
 * @param {Array<{code: string|null, message: string}>} props.errors causes du dernier refus
 * @param {(file: File) => void} props.onUpload
 */
const NeedsSheetPanel = ({
  valueChainCode, currency, templateUrl, result, uploading, errors = [], failure = null,
  onUpload, onRetry,
}) => {
  const inputRef = useRef(null);

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    // Réinitialiser la valeur autorise le re-téléversement du *même* nom de
    // fichier après correction — cas nominal ici, pas un cas limite.
    e.target.value = '';
    if (file) onUpload(file);
  };

  const pickFile = () => inputRef.current?.click();

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="sr-only"
        onChange={handleChange}
        aria-label="Feuille de besoins au format xlsx"
      />

      {!result ? (
        /* ── État vide : rien n'est saisissable tant que le fichier n'est pas là ── */
        <div className="glass-effect rounded-2xl p-6 border border-emerald-500/20">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-emerald-300" aria-hidden="true" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="text-lg font-bold text-white">Votre feuille de besoins</h3>
                <p className="text-sm text-gray-400 mt-1 leading-relaxed">
                  Les montants du simulateur sont <strong className="text-gray-200">lus dans votre
                  fichier</strong>, jamais saisis à l'écran : c'est ce qui garantit que votre
                  analyste et vous regardez exactement les mêmes chiffres.
                </p>
              </div>
              <ol className="text-sm text-gray-300 space-y-1.5 list-decimal list-inside marker:text-emerald-400">
                <li>Téléchargez le template officiel AGRICAP.</li>
                <li>
                  Remplissez la feuille{' '}
                  <span className="font-mono text-xs text-emerald-300">4_Besoins_Financiers</span>,
                  ligne par ligne — la synthèse se calcule toute seule.
                </li>
                <li>Téléversez le classeur rempli ci-dessous.</li>
              </ol>
              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                >
                  <a href={templateUrl} target="_blank" rel="noreferrer">
                    <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                    Télécharger le template{valueChainCode ? ` ${valueChainCode}` : ''}
                  </a>
                </Button>
                <Button
                  size="sm"
                  onClick={pickFile}
                  disabled={uploading}
                  className="bg-gradient-to-r from-emerald-500 to-blue-600"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                      Validation du classeur…
                    </>
                  ) : (
                    <>
                      <FileUp className="w-4 h-4 mr-2" aria-hidden="true" />
                      Téléverser ma feuille (.xlsx)
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Feuille ingérée : lignage affiché, remplacement par le fichier seul ── */
        <div className="glass-effect rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold text-white flex flex-wrap items-center gap-2">
                  Feuille de besoins enregistrée
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 bg-emerald-500/10">
                    révision {result.revision}
                  </Badge>
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  Besoin total du cycle :{' '}
                  <span className="font-semibold text-emerald-300">
                    {formatMontant(result.grandTotal, currency, { decimals: 0 })}
                  </span>
                </p>
                {result.sha256 && (
                  <p className="text-[11px] text-gray-600 mt-1 font-mono" title={result.sha256}>
                    empreinte {String(result.sha256).slice(0, 12)}…
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={pickFile}
                disabled={uploading}
                className="border-white/20 hover:bg-white/10"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                    Validation…
                  </>
                ) : (
                  <>
                    <FileUp className="w-4 h-4 mr-2" aria-hidden="true" />
                    Remplacer le fichier
                  </>
                )}
              </Button>
              <a
                href={templateUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-gray-500 hover:text-gray-300 underline"
              >
                retélécharger le template
              </a>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-4 leading-relaxed border-t border-white/10 pt-3">
            Pour corriger un coût, modifiez votre classeur et téléversez-le à nouveau : chaque
            dépôt crée une révision et l'historique reste consultable par votre analyste. Les
            montants ne se modifient pas depuis cet écran.
          </p>
        </div>
      )}

      <NeedsSheetFailure failure={failure} onRetry={onRetry} />
      <NeedsSheetErrorList errors={errors} />
    </div>
  );
};

export default NeedsSheetPanel;

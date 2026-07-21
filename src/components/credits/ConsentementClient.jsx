import React, { useState } from 'react';
import { AlertCircle, Check, ShieldCheck } from 'lucide-react';
import { api } from '@/services/api';
import { formatMontant } from '@/components/guarantees/format';


function tempsRestant(iso) {
  if (!iso) return null;
  const restant = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(restant)) return null;
  if (restant <= 0) return { expire: true, texte: 'délai expiré' };
  const heures = Math.floor(restant / 3_600_000);
  const jours = Math.floor(heures / 24);
  return {
    expire: false,
    texte: jours >= 1
      ? `${jours} j ${heures % 24} h restantes`
      : `${heures} h restantes`,
  };
}

export default function ConsentementClient({ dossier, onConfirme }) {
  const [envoi, setEnvoi] = useState(false);
  const [erreurs, setErreurs] = useState([]);
  const [fait, setFait] = useState(false);

  const delai = tempsRestant(dossier.clientConsentExpires);
  const montant = dossier.amountRequested;

  const confirmer = async () => {
    setEnvoi(true);
    setErreurs([]);
    try {
     
      await api.credits.consent(dossier.code, { method: 'app' });
      setFait(true);
      if (onConfirme) await onConfirme();
    } catch (e) {
      
      const liste = e?.errors?.length
        ? e.errors.map((x) => x.message || x.code)
        : [e?.message || "Le serveur a refusé la confirmation."];
      setErreurs(liste);
    } finally {
      setEnvoi(false);
    }
  };

  if (fait) {
    return (
      <div className="flex gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
        <Check className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-emerald-100">
          Demande confirmée. Votre conseiller peut maintenant l'instruire.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-amber-300/90 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
        Votre confirmation est requise
        {delai && (
          <span className={delai.expire ? 'text-red-300' : 'text-amber-200/80'}>
            · {delai.texte}
          </span>
        )}
      </p>

      <p className="text-sm text-amber-50">
        Cette demande de crédit a été déposée <strong>en votre nom</strong>
        {dossier.valueChain?.label ? <> pour la filière <strong>{dossier.valueChain.label}</strong></> : null}
        {montant != null ? <>, d'un montant de <strong>{formatMontant(montant, dossier.currency)}</strong></> : null}.
        En confirmant, vous reconnaissez qu'elle émane bien de vous et vous
        autorisez AGRICAP à l'instruire. Tant que vous n'avez pas confirmé,
        aucune analyse ne commence.
      </p>

      <p className="text-xs text-amber-200/70">
        Si cette demande ne vient pas de vous, ne confirmez pas et contactez
        votre agence : le délai s'écoulera et le dossier sera abandonné.
      </p>

      {erreurs.length > 0 && (
        <div className="flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2">
          <AlertCircle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" aria-hidden="true" />
          <ul className="text-sm text-red-100 space-y-0.5">
            {erreurs.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={confirmer}
        disabled={envoi}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm
                   font-semibold text-white hover:bg-emerald-400 disabled:opacity-60"
      >
        <Check className="w-4 h-4" aria-hidden="true" />
        {envoi ? 'Confirmation…' : 'Je confirme ma demande'}
      </button>
    </div>
  );
}

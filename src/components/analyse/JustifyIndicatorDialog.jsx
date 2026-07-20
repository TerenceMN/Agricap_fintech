import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { api } from '@/services/api';
import { ErrorPanel, toFieldErrors } from '@/components/backoffice/States';
import { libelleIndicateur } from './analyseFormat';

/**
 * Canal de justification d'un indicateur hors plage (SPEC Moteur §7,
 * `POST .../analyse/justifier/`).
 *
 * Ce dialogue n'annule pas l'écart et ne recalcule pas le score : il enregistre
 * la lecture de l'analyste. Le serveur journalise, renvoie l'analyse mise à
 * jour, et c'est cette réponse qui rafraîchit l'écran — le front ne fabrique
 * pas l'entrée de justification localement.
 *
 * Chaque justification validée est aussi une donnée d'apprentissage du barème
 * (CLAUDE.md §4.6, boucle de calibrage) : une règle justifiée sur presque tous
 * les dossiers signale une plage à réviser, pas un dossier à sanctionner.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (v: boolean) => void,
 *   code: string,
 *   indicateurs: Array<{indicateur: string, message?: string}>,
 *   defaultIndicateur?: string|null,
 *   onJustified: (analyse: import('@/types/api').CreditAnalyse) => void,
 * }} props
 */
const JustifyIndicatorDialog = ({
  open, onOpenChange, code, indicateurs = [], defaultIndicateur, onJustified,
}) => {
  const [indicateur, setIndicateur] = useState('');
  const [justification, setJustification] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    if (!open) return;
    setIndicateur(defaultIndicateur || indicateurs[0]?.indicateur || '');
    setJustification('');
    setErrors([]);
    setSaving(false);
  }, [open, defaultIndicateur, indicateurs]);

  const submit = async () => {
    const texte = justification.trim();
    if (!indicateur) {
      setErrors([{ message: 'Sélectionnez l’indicateur à justifier.' }]);
      return;
    }
    if (!texte) {
      setErrors([{ message: 'La justification est obligatoire — une décision motivée se motive.' }]);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const maj = await api.credits.justifyIndicator(code, {
        indicateur,
        justification: texte,
      });
      onJustified(maj);
      onOpenChange(false);
    } catch (e) {
      setErrors(toFieldErrors(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect text-white max-w-lg border-slate-700 [&>option]:bg-slate-800 [&>option]:text-white">
        <DialogHeader>
          <DialogTitle>Justifier un indicateur</DialogTitle>
          <DialogDescription>
            Votre justification est jointe à l'analyse et journalisée sous votre identité.
            Elle ne modifie ni le score, ni la recommandation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="analyse-indicateur">Indicateur</Label>
            {indicateurs.length > 0 ? (
              <select
                id="analyse-indicateur"
                value={indicateur}
                onChange={(e) => setIndicateur(e.target.value)}
                className="w-full bg-slate-900/70 border border-slate-700 rounded-md px-3 py-2 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
              >
                {indicateurs.map((i) => (
                  <option key={i.indicateur} value={i.indicateur}>
                    {libelleIndicateur(i.indicateur)} — {i.indicateur}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-slate-400">
                Aucun indicateur hors plage sur cette analyse.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="analyse-justification">Justification</Label>
            <Textarea
              id="analyse-justification"
              rows={5}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Fait constaté, cause la plus probable, et ce que le client a répondu ou doit être questionné."
              className="bg-slate-900/70 border-slate-700 text-white [&>option]:bg-slate-800 [&>option]:text-white"
            />
            <p className="text-[11px] text-slate-500">
              Écrivez pour l'auditeur qui relira ce dossier dans six mois, pas pour vous.
            </p>
          </div>

          <ErrorPanel errors={errors} title="Justification refusée" />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="border-slate-600 hover:bg-slate-700"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Annuler
          </Button>
          <Button onClick={submit} disabled={saving || indicateurs.length === 0}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
            Enregistrer la justification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default JustifyIndicatorDialog;

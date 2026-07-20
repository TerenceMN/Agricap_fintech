import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { DollarSign, TrendingUp, Calendar, Shield } from 'lucide-react';
import { api } from '@/services/api';
import { formatCurrency } from '@/lib/investorSpaceUtils';

const InvestmentDecisionModals = ({ project, isOpen, onClose, onInvest }) => {
  const { toast } = useToast();
  const [bonds, setBonds] = useState(project?.minBonds || 1);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (isOpen && project) setBonds(project.minBonds || 1);
  }, [isOpen, project?.id]);

  if (!project) return null;

  const amount = bonds * project.bondUnitValue;

  const handleInvest = async () => {
    if (bonds < project.minBonds || bonds > project.maxBonds) {
      toast({
        title: "Montant invalide",
        description: `Vous devez investir entre ${project.minBonds} et ${project.maxBonds} obligations`,
        variant: "destructive",
      });
      return;
    }

    if (bonds > project.availableBonds) {
      toast({
        title: "Quantité non disponible",
        description: `Seulement ${project.availableBonds} obligations disponibles`,
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      await api.investments.subscriptions.subscribe(project.offerId, bonds);
      toast({
        title: "Investissement Confirmé",
        description: `Vous avez investi ${formatCurrency(amount)} dans ${project.name}`,
      });
      onClose();
      if (onInvest) onInvest();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || "Souscription impossible.", variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Confirmer Investissement</DialogTitle>
          <DialogDescription className="text-slate-400">{project.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Investment Amount Input */}
          <div className="space-y-3">
            <Label className="text-white">Nombre d'Obligations</Label>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                className="border-slate-700"
                onClick={() => setBonds(Math.max(project.minBonds, bonds - 1))}
                disabled={bonds <= project.minBonds}
              >
                -
              </Button>
              <Input
                type="number"
                value={bonds}
                onChange={(e) => setBonds(Number(e.target.value))}
                className="bg-slate-800 border-slate-700 text-center text-2xl font-bold"
                min={project.minBonds}
                max={Math.min(project.maxBonds, project.availableBonds)}
              />
              <Button
                variant="outline"
                className="border-slate-700"
                onClick={() => setBonds(Math.min(project.maxBonds, project.availableBonds, bonds + 1))}
                disabled={bonds >= Math.min(project.maxBonds, project.availableBonds)}
              >
                +
              </Button>
            </div>
            <p className="text-xs text-slate-400">
              Min: {project.minBonds} | Max: {Math.min(project.maxBonds, project.availableBonds)} obligations
            </p>
          </div>

          {/* Investment Summary */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-emerald-500/20 rounded">
                    <DollarSign className="w-5 h-5 text-emerald-400" />
                  </div>
                  <span className="text-xs text-slate-400">Montant Total</span>
                </div>
                <p className="text-2xl font-bold text-white">{formatCurrency(amount)}</p>
              </CardContent>
            </Card>

            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-blue-500/20 rounded">
                    <TrendingUp className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className="text-xs text-slate-400">Rendement</span>
                </div>
                <p className="text-2xl font-bold text-blue-400">{project.expectedReturn}%</p>
              </CardContent>
            </Card>
          </div>

          {/* Important Notice */}
          <Card className="bg-blue-500/10 border-blue-500/30">
            <CardContent className="p-4">
              <h4 className="font-bold text-blue-300 mb-2 flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Informations Importantes
              </h4>
              <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                <li>Paiements de coupons selon la fréquence définie par l'offre</li>
                <li>Capital remboursé à maturité</li>
                <li>Garanties : voir l'onglet "Structure" pour détails</li>
              </ul>
            </CardContent>
          </Card>

          {/* Terms Acceptance */}
          <div className="flex items-start gap-2 p-3 bg-slate-800 rounded">
            <input type="checkbox" id="terms" className="mt-1" required />
            <label htmlFor="terms" className="text-xs text-slate-300">
              Je confirme avoir lu et compris le prospectus du projet, notamment les risques associés,
              et accepte les conditions générales d'investissement AGRICAP.
            </label>
          </div>
        </div>

        <DialogFooter className="flex gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isProcessing}
          >
            Annuler
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 min-w-[150px]"
            onClick={handleInvest}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                <span>Traitement...</span>
              </div>
            ) : (
              `Confirmer ${formatCurrency(amount)}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InvestmentDecisionModals;

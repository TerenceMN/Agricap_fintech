import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Download, CheckCircle, Clock } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/investorSpaceUtils';
import { formatPercent } from '@/lib/investorSpaceWire';

/**
 * Un poste du rapport : réalisé, prévu, écart.
 *
 * Trois choses viennent du serveur et ne se rejouent pas ici :
 *
 * - **l'écart** (`revenueDeviationPercent`, `costDeviationPercent`,
 *   `productionDeviationPercent`), calculé et FIGÉ à la soumission du rapport —
 *   c'est le chiffre qui déclenche l'observation de risque, et deux formules pour
 *   une grandeur, c'est un incident de données en germe ;
 * - **le sens** (`unfavorable`) : +20 % sur les coûts et +20 % sur le revenu ont
 *   la même forme et le sens INVERSE. La règle est métier, elle vit au serveur,
 *   l'écran lit un booléen ;
 * - **l'existence d'une prévision** (`hasForecast`) : sans prévision posée, un
 *   écart de 0 % ne dit pas « conforme », il dit « rien à comparer ». Afficher
 *   « 0,00 % » serait une conformité inventée.
 */
export const DeviationBlock = ({ label, actual, forecast, deviation, unfavorable, hasForecast, format }) => (
  <div className="p-4 bg-slate-900 rounded border border-slate-700">
    <p className="text-xs text-slate-400 mb-3">{label}</p>
    <div className="flex items-baseline justify-between mb-2 gap-3">
      <span className="text-2xl font-bold text-white">{format(actual)}</span>
      <span className="text-sm text-slate-500">Prévu : {hasForecast ? format(forecast) : '—'}</span>
    </div>
    {!hasForecast ? (
      <p className="text-sm text-slate-500">Aucune prévision posée : il n’y a pas d’écart à mesurer.</p>
    ) : (
      <div className={`flex items-center gap-2 text-sm ${unfavorable ? 'text-red-400' : 'text-emerald-400'}`}>
        {deviation >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        <span>
          {deviation >= 0 ? '+' : ''}{formatPercent(deviation)} vs prévision
          {unfavorable ? ' — défavorable' : ''}
        </span>
      </div>
    )}
  </div>
);

const PerformanceReports = ({ projectCode, projectName }) => {
  const { toast } = useToast();
  const [reports, setReports] = useState([]);

  useEffect(() => {
    if (!projectCode) { setReports([]); return; }
    api.investments.performanceReports.list(projectCode)
      .then(setReports)
      .catch((err) => toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' }));
  }, [projectCode]);

  if (reports.length === 0) {
    return (
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-12 text-center">
          <TrendingUp className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400">Aucun rapport de performance disponible</p>
          <p className="text-sm text-slate-500 mt-2">Les rapports seront publiés trimestriellement</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-white">Rapports de Performance</h3>
        <p className="text-sm text-slate-400">{projectName} - {reports.length} rapport(s) disponible(s)</p>
      </div>

      {reports.map((report) => (
        <Card key={report.id} className="bg-slate-800 border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{report.reportingPeriod || '-'}</CardTitle>
                <Badge variant="outline" className={report.validationStatus === 'VALIDATED' ? 'border-emerald-500 text-emerald-400' : 'border-amber-500 text-amber-400'}>
                  {report.validationStatus === 'VALIDATED' ? (
                    <><CheckCircle className="w-3 h-3 mr-1" /> Validé</>
                  ) : (
                    <><Clock className="w-3 h-3 mr-1" /> En révision</>
                  )}
                </Badge>
              </div>
              <p className="text-xs text-slate-400">Soumis le {formatDate(report.submissionDate)}</p>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <DeviationBlock
                  label="Revenus"
                  actual={report.actualRevenue}
                  forecast={report.forecastRevenue}
                  deviation={report.revenueDeviationPercent ?? report.deviationPercent}
                  unfavorable={report.unfavorable?.revenue}
                  hasForecast={report.hasForecast?.revenue}
                  format={formatCurrency}
                />
                <DeviationBlock
                  label="Coûts"
                  actual={report.actualCosts}
                  forecast={report.forecastCosts}
                  deviation={report.costDeviationPercent}
                  unfavorable={report.unfavorable?.costs}
                  hasForecast={report.hasForecast?.costs}
                  format={formatCurrency}
                />
                <DeviationBlock
                  label="Production réalisée"
                  actual={report.actualProduction}
                  forecast={report.forecastProduction}
                  deviation={report.productionDeviationPercent}
                  unfavorable={report.unfavorable?.production}
                  hasForecast={report.hasForecast?.production}
                  format={(value) => (value ?? 0).toLocaleString('fr-FR')}
                />
              </div>

              {/* Comments */}
              {report.deviationComments && (
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded">
                  <p className="text-xs text-blue-300 font-bold mb-2">Commentaires du Promoteur</p>
                  <p className="text-sm text-slate-300">{report.deviationComments}</p>
                </div>
              )}

              {/* Validation */}
              {report.validationStatus === 'VALIDATED' && (
                <div className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/20 rounded text-sm">
                  <div>
                    <span className="text-emerald-400 font-bold">Validé par: </span>
                    <span className="text-slate-300">{report.validatedBy}</span>
                  </div>
                  <span className="text-slate-400">{formatDate(report.validationDate)}</span>
                </div>
              )}

              {/* Documents */}
              {report.documents && report.documents.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-2">Documents joints ({report.documents.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {report.documents.map((doc, index) => (
                      <Button
                        key={index}
                        size="sm"
                        variant="outline"
                        className="border-slate-700 text-xs"
                      >
                        <Download className="w-3 h-3 mr-1" />
                        {doc}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default PerformanceReports;
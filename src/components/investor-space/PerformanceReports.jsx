import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Download, CheckCircle, Clock } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import { formatCurrency, formatDate } from '@/lib/investorSpaceUtils';

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

      {reports.map((report) => {
        const revDeviation = report.forecastRevenue ? ((report.actualRevenue - report.forecastRevenue) / report.forecastRevenue) * 100 : 0;
        const costDeviation = report.forecastCosts ? ((report.actualCosts - report.forecastCosts) / report.forecastCosts) * 100 : 0;

        return (
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
              {/* Financial Performance */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-900 rounded border border-slate-700">
                  <p className="text-xs text-slate-400 mb-3">Revenus</p>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-2xl font-bold text-white">{formatCurrency(report.actualRevenue)}</span>
                    <span className="text-sm text-slate-500">Prévu: {formatCurrency(report.forecastRevenue)}</span>
                  </div>
                  <div className={`flex items-center gap-2 text-sm ${revDeviation >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {revDeviation >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    <span>{revDeviation >= 0 ? '+' : ''}{revDeviation.toFixed(1)}% vs prévision</span>
                  </div>
                </div>

                <div className="p-4 bg-slate-900 rounded border border-slate-700">
                  <p className="text-xs text-slate-400 mb-3">Coûts</p>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-2xl font-bold text-white">{formatCurrency(report.actualCosts)}</span>
                    <span className="text-sm text-slate-500">Prévu: {formatCurrency(report.forecastCosts)}</span>
                  </div>
                  <div className={`flex items-center gap-2 text-sm ${costDeviation <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {costDeviation >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    <span>{costDeviation >= 0 ? '+' : ''}{costDeviation.toFixed(1)}% vs prévision</span>
                  </div>
                </div>
              </div>

              {/* Production */}
              <div className="p-4 bg-slate-900 rounded border border-slate-700">
                <p className="text-xs text-slate-400 mb-2">Production Réalisée</p>
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-bold text-white">{report.actualProduction}</span>
                  <span className="text-sm text-slate-500">Prévu: {report.forecastProduction}</span>
                </div>
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
        );
      })}
    </div>
  );
};

export default PerformanceReports;
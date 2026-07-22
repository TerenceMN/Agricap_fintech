import React, { useMemo } from 'react';
import { FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { exportToExcel, exportToPDF } from '@/lib/export';
import { buildGlobalReport, flattenReport, formatReportValue } from '@/lib/portfolioTools';

/**
 * Le rapport global du portefeuille — la photo, à l'écran puis sur papier.
 *
 * Trois disciplines, héritées d'incidents de ce projet :
 *
 * 1. **Rien n'est recalculé.** Chaque ligne vient d'une clé de
 *    `GET /investments/metrics/mine` ou de `GET /investments/portfolio-allocation`,
 *    et la clé voyage AVEC la ligne, jusque dans l'export : un chiffre lu sur
 *    papier deux ans plus tard doit rester reconstituable.
 *
 * 2. **Une grandeur absente sort avec son motif**, jamais avec un zéro. Un
 *    rapport qui affiche « TRI 0 % » là où le serveur dit « pas encore de
 *    distribution » ment poliment.
 *
 * 3. **Les réserves de lecture s'impriment AVEC les chiffres.** Le gain latent
 *    n'est pas encaissé, la période couverte est celle des flux réels, l'ESG et
 *    les benchmarks n'existent pas : reléguer ces phrases hors du document
 *    reviendrait à publier les chiffres sans ce qui les rend lisibles.
 */
const GlobalReportDialog = ({
  open, onOpenChange, metrics, metricsError, allocationView, subPortfoliosCount,
  subscriptionsCount,
}) => {
  const report = useMemo(() => (metrics ? buildGlobalReport({
    metrics, allocation: allocationView, subPortfoliosCount, subscriptionsCount,
  }) : null), [metrics, allocationView, subPortfoliosCount, subscriptionsCount]);

  const lignes = useMemo(() => (report ? flattenReport(report) : []), [report]);

  const nomFichier = report ? `rapport-portefeuille-${report.asOf}` : 'rapport-portefeuille';

  const exporterPdf = () => {
    if (!report) return;
    const corps = [
      ...lignes.map((l) => [l.section, l.label, l.value, l.basis, l.source]),
      // Les réserves voyagent avec le tableau : un PDF se transmet sans son écran.
      ...report.disclaimers.map((d) => ['Réserves de lecture', '', d, '', '']),
    ];
    exportToPDF(
      ['Section', 'Ligne', 'Valeur', 'Base / effectif', 'Clé serveur'],
      corps,
      nomFichier,
      `${report.title} — arrêté au ${report.asOf}`,
    );
  };

  const exporterTableur = () => {
    if (!report) return;
    exportToExcel([
      ...lignes.map((l) => ({
        Section: l.section, Ligne: l.label, Valeur: l.value,
        'Base / effectif': l.basis, 'Clé serveur': l.source,
      })),
      ...report.disclaimers.map((d) => ({
        Section: 'Réserves de lecture', Ligne: '', Valeur: d,
        'Base / effectif': '', 'Clé serveur': '',
      })),
    ], nomFichier);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-950 border-slate-800 text-white max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            {report?.title ?? 'Rapport global de portefeuille'}
          </DialogTitle>
          <DialogDescription>
            {report
              ? `Arrêté au ${report.asOf} · ${report.scope} · montants en ${report.currency}`
              : 'Chiffres servis par le serveur, chacun avec sa base et sa clé d’origine.'}
          </DialogDescription>
        </DialogHeader>

        {!report ? (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-amber-200 text-base">Rapport indisponible</CardTitle>
              <CardDescription className="text-amber-200/80">
                {metricsError
                  || 'Vos métriques de portefeuille n’ont pas pu être chargées : aucun rapport '
                    + 'n’est produit plutôt qu’un rapport de zéros.'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 text-xs text-slate-400">
                Période réellement couverte par vos flux : du {report.period.from ?? '—'} au{' '}
                {report.period.to} — {report.period.flowsCount} flux daté(s).{' '}
                {report.period.basis}
              </CardContent>
            </Card>

            {report.sections.map((section) => (
              <Card key={section.key} className="bg-slate-900 border-slate-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white text-base">{section.title}</CardTitle>
                  {section.note && <CardDescription>{section.note}</CardDescription>}
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                    {section.rows.map((r) => (
                      <div key={r.key} className="p-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-200">{r.label}</p>
                          <p className="text-xs text-slate-500 mt-0.5 break-words">{r.basis}</p>
                          <p className="text-[10px] font-mono text-slate-600 mt-1">{r.sourceKey}</p>
                        </div>
                        <p className={`text-sm font-semibold shrink-0 text-right ${
                          r.value === null ? 'text-amber-300 max-w-[18rem]' : 'text-white'}`}>
                          {formatReportValue(r, report.currency)}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}

            <Card className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-white text-base">Réserves de lecture</CardTitle>
                <CardDescription>
                  Elles sont imprimées avec les chiffres, pas rangées en annexe.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {report.disclaimers.map((d) => (
                    <li key={d} className="text-xs text-slate-400 flex gap-2">
                      <span className="text-slate-600 shrink-0">—</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Fermer</Button>
          <Button variant="outline" disabled={!report} onClick={exporterTableur}>
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Tableur
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={!report} onClick={exporterPdf}>
            <FileDown className="w-4 h-4 mr-2" /> PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GlobalReportDialog;

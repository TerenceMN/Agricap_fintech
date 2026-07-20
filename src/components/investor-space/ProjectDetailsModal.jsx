import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  FileText, TrendingUp, Shield, MapPin, DollarSign,
  Leaf, AlertTriangle, Download, MessageSquare, Target
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCurrency, formatDate, getRiskLabel, getRiskFlagColor } from '@/lib/investorSpaceUtils';
import InvestmentDecisionModals from './InvestmentDecisionModals';
import ProjectQA from './ProjectQA';

const RISK_FLAG_LABEL = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

const ProjectDetailsModal = ({ project, isOpen, onClose, onInvest }) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('summary');
  const [showInvestModal, setShowInvestModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [technical, setTechnical] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [collateral, setCollateral] = useState(null);
  const [observations, setObservations] = useState([]);

  useEffect(() => {
    if (!isOpen || !project?.code) return;
    api.investments.projects.detail(project.code).then(setDetail).catch(() => setDetail(null));
    api.investments.projects.technicalAnalysis(project.code).then(setTechnical).catch(() => setTechnical(null));
    api.investments.projects.financialAnalysis(project.code).then(setFinancial).catch(() => setFinancial(null));
    api.investments.observations(project.code).then(setObservations).catch(() => setObservations([]));
    if (project.offerId) {
      api.investments.offers.collateral(project.offerId).then(setCollateral).catch(() => setCollateral(null));
    }
  }, [isOpen, project?.code, project?.offerId]);

  if (!project) return null;

  const fundingProgress = project.targetAmount > 0 ? (project.raisedAmount / project.targetAmount) * 100 : 0;
  const riskInfo = getRiskLabel(project.riskScore);

  const handleDownloadProspectus = () => {
    toast({
      title: 'Télécharger le prospectus',
      description: "Non disponible : la génération de prospectus PDF n'est pas encore implémentée côté serveur.",
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{project.name}</DialogTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline" className="border-slate-600">
                {project.sector}
              </Badge>
              <Badge variant="outline" className="border-slate-600">
                <MapPin className="w-3 h-3 mr-1" />
                {project.location}
              </Badge>
              <Badge className={`${riskInfo.bg} ${riskInfo.color} border-0`}>
                Risque {riskInfo.label} ({project.riskScore}/10)
              </Badge>
            </div>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="bg-slate-800 border border-slate-700 w-full justify-start overflow-x-auto h-auto">
              <TabsTrigger value="summary" className="data-[state=active]:bg-slate-700">
                <FileText className="w-4 h-4 mr-2" /> Synthèse
              </TabsTrigger>
              <TabsTrigger value="technical" className="data-[state=active]:bg-slate-700">
                <Leaf className="w-4 h-4 mr-2" /> Analyse Technique
              </TabsTrigger>
              <TabsTrigger value="financial" className="data-[state=active]:bg-slate-700">
                <TrendingUp className="w-4 h-4 mr-2" /> Analyse Financière
              </TabsTrigger>
              <TabsTrigger value="financing" className="data-[state=active]:bg-slate-700">
                <Shield className="w-4 h-4 mr-2" /> Structure
              </TabsTrigger>
              <TabsTrigger value="qa" className="data-[state=active]:bg-slate-700">
                <MessageSquare className="w-4 h-4 mr-2" /> Q&R
              </TabsTrigger>
            </TabsList>

            {/* Summary Tab */}
            <TabsContent value="summary" className="space-y-6 mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-6">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-lg">Vue d'ensemble</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <p className="text-sm text-slate-400 mb-2">Description</p>
                        <p className="text-sm text-white">{detail?.description || 'Non renseignée.'}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Promoteur</p>
                          <p className="text-sm font-medium text-white">{detail?.promoter || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Contact</p>
                          <p className="text-sm text-blue-400">{detail?.promoterContact || '-'}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Démarrage</p>
                          <p className="text-sm text-white">{formatDate(detail?.startDate)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Maturité prévue</p>
                          <p className="text-sm text-white">{formatDate(detail?.expectedMaturity)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-lg">Métriques Clés</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-slate-900 rounded">
                          <p className="text-xs text-slate-400 mb-1">Rendement Attendu</p>
                          <p className="text-2xl font-bold text-emerald-400">{project.expectedReturn}%</p>
                        </div>
                        <div className="p-3 bg-slate-900 rounded">
                          <p className="text-xs text-slate-400 mb-1">Ticket Minimum</p>
                          <p className="text-2xl font-bold text-white">{formatCurrency(project.minimumTicket)}</p>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-2">
                          <span>Progression Levée</span>
                          <span className="font-bold text-white">{fundingProgress.toFixed(0)}%</span>
                        </div>
                        <Progress value={fundingProgress} className="h-3 mb-2" />
                        <div className="flex justify-between text-sm">
                          <span className="text-emerald-400">{formatCurrency(project.raisedAmount)}</span>
                          <span className="text-slate-500">Objectif: {formatCurrency(project.targetAmount)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-6">
                  <Card className="bg-gradient-to-br from-emerald-900/40 to-slate-800 border-emerald-500/30">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Target className="w-5 h-5 text-emerald-400" />
                        Opportunité d'Investissement
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Valeur Unitaire</p>
                          <p className="text-xl font-bold text-white">{formatCurrency(project.bondUnitValue)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Obligations Disponibles</p>
                          <p className="text-xl font-bold text-emerald-400">{project.availableBonds}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Minimum</p>
                          <p className="text-sm text-white">{project.minBonds} obligations</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Maximum</p>
                          <p className="text-sm text-white">{project.maxBonds} obligations</p>
                        </div>
                      </div>
                      <Button
                        className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-lg"
                        onClick={() => setShowInvestModal(true)}
                        disabled={project.availableBonds === 0}
                      >
                        {project.availableBonds > 0 ? 'Investir Maintenant' : 'Complet'}
                      </Button>
                    </CardContent>
                  </Card>

                  {observations.length > 0 && (
                    <Card className="bg-slate-800 border-slate-700">
                      <CardHeader>
                        <CardTitle className="text-lg">Observations Analyste</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 max-h-[300px] overflow-y-auto">
                        {observations.slice(0, 3).map((obs) => (
                          <div key={obs.id} className="p-3 bg-slate-900 rounded border border-slate-700">
                            <div className="flex items-start justify-between mb-2">
                              <Badge className={getRiskFlagColor(RISK_FLAG_LABEL[obs.riskFlag] || obs.riskFlag)}>
                                {obs.riskFlag}
                              </Badge>
                            </div>
                            <p className="text-xs text-slate-400 mb-1">{obs.category}</p>
                            <p className="text-sm text-white mb-2">{obs.observation}</p>
                            {obs.recommendation && (
                              <p className="text-xs text-blue-400 italic">→ {obs.recommendation}</p>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 border-slate-700" onClick={handleDownloadProspectus}>
                  <Download className="w-4 h-4 mr-2" />
                  Télécharger Prospectus
                </Button>
                <Button variant="outline" className="flex-1 border-slate-700" onClick={() => setActiveTab('qa')}>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Poser une Question
                </Button>
              </div>
            </TabsContent>

            {/* Technical Analysis Tab */}
            <TabsContent value="technical" className="mt-6">
              {technical ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader><CardTitle>Données Techniques</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Superficie</p>
                          <p className="text-lg font-bold text-white">{technical.landSize} ha</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Capacité Production</p>
                          <p className="text-lg font-bold text-white">{technical.productionCapacity}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Cycle de Production</p>
                        <p className="text-sm text-white">{technical.productionCycleMonths} mois</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Prévision Rendement</p>
                        <p className="text-sm text-emerald-400 font-bold">{technical.yieldForecast}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader><CardTitle>Risques & Mitigation</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Risque Climatique</p>
                        <p className="text-sm text-orange-400">{technical.climateRisk || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Stratégie de Mitigation</p>
                        <p className="text-sm text-white">{technical.mitigation || '-'}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <p className="text-center text-slate-400 py-12">Analyse technique non disponible</p>
              )}
            </TabsContent>

            {/* Financial Analysis Tab */}
            <TabsContent value="financial" className="mt-6">
              {financial ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card className="bg-slate-800 border-slate-700">
                      <CardHeader><CardTitle className="text-lg">Ventilation Investissement</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        {Object.entries(financial.investmentBreakdown || {}).map(([key, value]) => (
                          <div key={key} className="flex justify-between text-sm">
                            <span className="text-slate-400 capitalize">{key}</span>
                            <span className="font-mono text-white">{formatCurrency(value)}</span>
                          </div>
                        ))}
                        {Object.keys(financial.investmentBreakdown || {}).length === 0 && (
                          <p className="text-xs text-slate-500">Non renseigné.</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="bg-slate-800 border-slate-700">
                      <CardHeader><CardTitle className="text-lg">Structure Coûts</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        {Object.entries(financial.costStructure || {}).map(([key, value]) => (
                          <div key={key} className="flex justify-between text-sm">
                            <span className="text-slate-400 capitalize">{key}</span>
                            <span className="font-mono text-white">{formatCurrency(value)}</span>
                          </div>
                        ))}
                        {Object.keys(financial.costStructure || {}).length === 0 && (
                          <p className="text-xs text-slate-500">Non renseigné.</p>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="bg-slate-800 border-slate-700">
                      <CardHeader><CardTitle className="text-lg">Indicateurs</CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Marge EBITDA</p>
                          <p className="text-2xl font-bold text-emerald-400">{financial.ebitdaMargin}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">DSCR</p>
                          <p className="text-2xl font-bold text-blue-400">{financial.dscr}x</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">TRI</p>
                          <p className="text-2xl font-bold text-purple-400">{financial.irr}%</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                <p className="text-center text-slate-400 py-12">Analyse financière non disponible</p>
              )}
            </TabsContent>

            {/* Financing Structure Tab */}
            <TabsContent value="financing" className="mt-6">
              {(detail?.typeOfTitle || collateral) ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader><CardTitle>Structure de Dette</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Type de Titre</p>
                        <p className="text-lg font-bold text-white">{detail?.typeOfTitle || '-'}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Taux Coupon</p>
                          <p className="text-2xl font-bold text-emerald-400">{project.expectedReturn}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Maturité</p>
                          <p className="text-2xl font-bold text-white">{detail?.maturityMonths ?? '-'} mois</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Fréquence de Paiement</p>
                        <p className="text-sm text-white">{detail?.paymentFrequency || '-'}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-800 border-slate-700">
                    <CardHeader><CardTitle>Garanties & Sûretés</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      {collateral ? (
                        <>
                          <div>
                            <p className="text-xs text-slate-400 mb-2">Liste des Garanties</p>
                            <ul className="space-y-2">
                              {(collateral.guarantees || []).map((guarantee, index) => (
                                <li key={index} className="flex items-start gap-2 text-sm text-white">
                                  <Shield className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                                  <span>{guarantee}</span>
                                </li>
                              ))}
                              {(collateral.guarantees || []).length === 0 && (
                                <p className="text-xs text-slate-500">Aucune garantie listée.</p>
                              )}
                            </ul>
                          </div>
                          <div className="pt-4 border-t border-slate-700">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs text-slate-400 mb-1">Valeur Collatéral</p>
                                <p className="text-lg font-bold text-white">{formatCurrency(collateral.collateralValue)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400 mb-1">Loan-to-Value</p>
                                <p className="text-lg font-bold text-blue-400">{collateral.loanToValue}%</p>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-slate-500">Aucune garantie renseignée pour cette offre.</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <p className="text-center text-slate-400 py-12">Informations sur la structure non disponibles</p>
              )}
            </TabsContent>

            {/* Q&A Tab */}
            <TabsContent value="qa" className="mt-6">
              <ProjectQA
                projectCode={project.code}
                projectName={project.name}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Investment Modal */}
      <InvestmentDecisionModals
        project={project}
        isOpen={showInvestModal}
        onClose={() => setShowInvestModal(false)}
        onInvest={onInvest}
      />
    </>
  );
};

export default ProjectDetailsModal;

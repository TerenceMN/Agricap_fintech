import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import {
  Search, Filter, MapPin, TrendingUp, Shield, Eye, Leaf
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCurrency, formatDate, getRiskLabel } from '@/lib/investorSpaceUtils';
import { buildOpenOfferCards } from '@/lib/investorSpaceWire';
import ProjectDetailsModal from './ProjectDetailsModal';

/**
 * Les offres OUVERTES — le seul détail projet auquel un investisseur a droit
 * avant d'engager son argent.
 *
 * Tout vient de `GET /investments/offers/open`, y compris le SCORE de risque du
 * projet et les bornes de souscription : afficher une opportunité sans son score,
 * c'est vendre la promesse en taisant le risque. La jointure qu'il fallait faire
 * ici sur `GET /investments/projects` a disparu avec l'enrichissement de la
 * projection serveur — un appel de moins, et une source unique.
 *
 * Les montants (encaissé, réservé, objectif) sont ceux du serveur.
 */
const AvailableProjects = ({ onInvest }) => {
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [filteredProjects, setFilteredProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [selectedProject, setSelectedProject] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [projects, searchQuery, sectorFilter, locationFilter, riskFilter]);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(buildOpenOfferCards(await api.investments.offers.open()));
    } catch (err) {
      const detail = err.errors?.length
        ? err.errors.map((e) => e.message).join(' · ')
        : (err.message || 'Chargement impossible.');
      setError(detail);
      toast({ title: 'Erreur', description: detail, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...projects];

    if (searchQuery) {
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (sectorFilter !== 'all') {
      filtered = filtered.filter(p => p.sector === sectorFilter);
    }

    if (locationFilter !== 'all') {
      filtered = filtered.filter(p => p.location === locationFilter);
    }

    if (riskFilter !== 'all') {
      const riskRange = {
        'low': [0, 3],
        'medium': [4, 5],
        'high': [6, 10],
      };
      const [min, max] = riskRange[riskFilter];
      // Un score absent ne se range dans aucune tranche : `null >= 0` vaut `true`
      // en JavaScript et ferait apparaître les offres sans score dans « faible ».
      filtered = filtered.filter(p => p.riskScore !== null && p.riskScore >= min && p.riskScore <= max);
    }

    setFilteredProjects(filtered);
  };

  const handleViewDetails = (project) => {
    setSelectedProject(project);
    setShowDetailsModal(true);
  };

  const uniqueSectors = [...new Set(projects.map(p => p.sector).filter(Boolean))];
  const uniqueLocations = [...new Set(projects.map(p => p.location).filter(Boolean))];

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Projets Disponibles</h2>
          <p className="text-slate-400">Découvrez des opportunités d'investissement à impact</p>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Rechercher un projet..."
              className="pl-10 bg-slate-800 border-slate-700"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={sectorFilter} onValueChange={setSectorFilter}>
            <SelectTrigger className="bg-slate-800 border-slate-700">
              <SelectValue placeholder="Secteur" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous secteurs</SelectItem>
              {uniqueSectors.map(sector => (
                <SelectItem key={sector} value={sector}>{sector}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="bg-slate-800 border-slate-700">
              <SelectValue placeholder="Province" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes provinces</SelectItem>
              {uniqueLocations.map(loc => (
                <SelectItem key={loc} value={loc}>{loc}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="bg-slate-800 border-slate-700">
              <SelectValue placeholder="Risque" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous niveaux</SelectItem>
              <SelectItem value="low">Faible (1-3)</SelectItem>
              <SelectItem value="medium">Modéré (4-5)</SelectItem>
              <SelectItem value="high">Élevé (6-10)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </motion.div>

      {/* Results Count */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
        <p className="text-sm text-slate-400">
          {loading
            ? 'Chargement des offres ouvertes…'
            : `${filteredProjects.length} offre${filteredProjects.length !== 1 ? 's' : ''} ouverte${filteredProjects.length !== 1 ? 's' : ''}`}
        </p>
      </motion.div>

      {error && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="p-4 text-sm text-red-300">{error}</CardContent>
        </Card>
      )}

      {/* Projects Grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {filteredProjects.length === 0 ? (
          <div className="col-span-full text-center py-16">
            <div className="text-slate-500 mb-4">
              <Filter className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">
                {loading
                  ? 'Chargement…'
                  : projects.length === 0
                    ? 'Aucune levée de fonds n’est ouverte actuellement'
                    : 'Aucune offre ne correspond à vos critères'}
              </p>
              {!loading && projects.length > 0 && <p className="text-sm mt-2">Essayez de modifier vos filtres</p>}
            </div>
          </div>
        ) : (
          filteredProjects.map((project, index) => {
            const riskInfo = project.riskScore === null ? null : getRiskLabel(project.riskScore);

            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * (index % 6) }}
              >
                <Card className="bg-slate-900 border-slate-800 hover:border-slate-600 transition-all hover:-translate-y-1 group h-full flex flex-col">
                  <div className="relative h-32 overflow-hidden rounded-t-lg bg-gradient-to-br from-emerald-900/60 to-slate-900 flex items-center justify-center">
                    <Leaf className="w-12 h-12 text-emerald-500/30" />
                    <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                        Disponible
                      </Badge>
                      {/* Dette ou capital : la nature du titre change la lecture
                          du rendement affiché — un coupon obligataire est
                          contractuel, un rendement d'action ne l'est pas. */}
                      {project.titleType && (
                        <Badge className="bg-slate-800/80 text-slate-200 border-slate-600">
                          {project.titleTypeLabel}
                        </Badge>
                      )}
                    </div>
                    <div className="absolute top-3 right-3">
                      {riskInfo ? (
                        <div className={`px-2 py-1 rounded ${riskInfo.bg} backdrop-blur-sm`}>
                          <div className="flex items-center gap-1">
                            <Shield className={`w-3 h-3 ${riskInfo.color}`} />
                            <span className={`text-xs font-bold ${riskInfo.color}`}>
                              Risque {riskInfo.label} ({project.riskScore}/10)
                            </span>
                          </div>
                        </div>
                      ) : (
                        // Pas de score servi : on l'écrit, on n'en invente pas un.
                        <div className="px-2 py-1 rounded bg-slate-700/60 backdrop-blur-sm">
                          <span className="text-xs font-bold text-slate-300">Score non communiqué</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <CardHeader className="pb-3">
                    <CardTitle className="text-white text-lg line-clamp-1">{project.name}</CardTitle>
                    <CardDescription className="flex items-center gap-4 text-xs">
                      <span className="flex items-center gap-1">
                        <Leaf className="w-3 h-3" />
                        {project.sector || '-'}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {project.location || '-'}
                      </span>
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4 flex-1">
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Financement encaissé</span>
                        <span className="text-slate-500">objectif {formatCurrency(project.targetAmount)}</span>
                      </div>
                      {/* La barre est une REPRÉSENTATION GRAPHIQUE des deux
                          montants servis, affichés en clair juste dessous. Aucun
                          pourcentage d'avancement n'est écrit : cette projection
                          n'en sert pas, et un chiffre calculé ici pourrait
                          diverger de celui du back-office. */}
                      <Progress
                        value={project.targetAmount > 0
                          ? Math.min(100, (project.raisedAmount / project.targetAmount) * 100)
                          : 0}
                        className="h-2"
                      />
                      <div className="flex justify-between text-xs">
                        <span className="text-emerald-400">{formatCurrency(project.raisedAmount)}</span>
                        <span className="text-slate-500">/ {formatCurrency(project.targetAmount)}</span>
                      </div>
                      {/* Engagements pris mais pas encore encaissés : une intention
                          n'est pas de l'argent reçu, les deux se lisent séparément. */}
                      <p className="text-xs text-slate-500">
                        Dont {formatCurrency(project.reservedAmount)} réservés (non encaissés)
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div className="p-3 bg-slate-800/50 rounded border border-slate-700">
                        <p className="text-xs text-slate-400 mb-1">Ticket min.</p>
                        <p className="font-bold text-white text-sm">{formatCurrency(project.minimumTicket)}</p>
                      </div>
                      <div className="p-3 bg-slate-800/50 rounded border border-slate-700">
                        <p className="text-xs text-slate-400 mb-1">Coupon promis</p>
                        <p className="font-bold text-emerald-400 text-sm flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {project.expectedReturn} %
                        </p>
                      </div>
                    </div>

                    <div className="text-xs text-slate-500 space-y-1">
                      <p>Maturité : {project.maturityMonths} mois · coupon {project.paymentFrequency}</p>
                      {project.riskCategory && <p>Catégorie de risque : {project.riskCategory}</p>}
                      <p>
                        Clôture des souscriptions :{' '}
                        {project.subscriptionDeadline ? formatDate(project.subscriptionDeadline) : 'non fixée'}
                      </p>
                      <p>Titres disponibles : {project.availableBonds}</p>
                    </div>
                  </CardContent>

                  <CardFooter className="pt-4 border-t border-slate-800">
                    <Button
                      className="w-full bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-700 hover:to-blue-700"
                      onClick={() => handleViewDetails(project)}
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      Voir Détails
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>
            );
          })
        )}
      </motion.div>

      {/* Project Details Modal */}
      {selectedProject && (
        <ProjectDetailsModal
          project={selectedProject}
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedProject(null);
          }}
          onInvest={() => {
            setShowDetailsModal(false);
            if (onInvest) onInvest();
          }}
        />
      )}
    </div>
  );
};

export default AvailableProjects;

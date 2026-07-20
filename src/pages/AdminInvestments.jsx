import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  LayoutDashboard, Briefcase, TrendingUp, Users,
  CreditCard, AlertCircle, History
} from 'lucide-react';
import { api } from '@/services/api';

// Components
import AdminInvestmentDashboard from '@/components/admin-investments/AdminInvestmentDashboard';
import ProjectsManagement from '@/components/admin-investments/ProjectsManagement';
import OffersManagement from '@/components/admin-investments/OffersManagement';
import InvestorsManagement from '@/components/admin-investments/InvestorsManagement';
import SubscriptionsManagement from '@/components/admin-investments/SubscriptionsManagement';
import AuditLogs from '@/components/admin-investments/AuditLogs';

const AdminInvestments = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [data, setData] = useState({
    projects: [], offers: [], investors: [], subscriptions: [], movements: [], managers: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.investments.projects.list(),
      api.investments.offers.list(),
      api.investments.investors.list(),
      api.investments.subscriptions.list(),
      api.investments.movements(),
    ]).then(([projects, offers, investors, subscriptions, movements]) => {
      const managersMap = new Map();
      projects.forEach((p) => { if (p.managerSub) managersMap.set(p.managerSub, p.managerName || p.managerSub); });
      const managers = Array.from(managersMap, ([sub, name]) => ({ sub, name }));
      setData({ projects, offers, investors, subscriptions, movements, managers });
    }).catch((err) => {
      console.error('Failed to load admin investments data:', err);
      setError(err.message || 'Impossible de charger les données de la plateforme.');
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Erreur</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Helmet><title>Administration Investissements - AGRICAP</title></Helmet>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold gradient-text">Gestion des Investissements</h1>
          <p className="text-slate-400">Plateforme d'administration des opérations d'investissement</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-slate-900 border border-slate-800 w-full justify-start h-auto overflow-x-auto p-1">
            <TabsTrigger value="dashboard" className="data-[state=active]:bg-slate-800"><LayoutDashboard className="w-4 h-4 mr-2"/>Dashboard</TabsTrigger>
            <TabsTrigger value="projects" className="data-[state=active]:bg-slate-800"><Briefcase className="w-4 h-4 mr-2"/>Projets</TabsTrigger>
            <TabsTrigger value="offers" className="data-[state=active]:bg-slate-800"><TrendingUp className="w-4 h-4 mr-2"/>Offres</TabsTrigger>
            <TabsTrigger value="investors" className="data-[state=active]:bg-slate-800"><Users className="w-4 h-4 mr-2"/>Investisseurs</TabsTrigger>
            <TabsTrigger value="subscriptions" className="data-[state=active]:bg-slate-800"><CreditCard className="w-4 h-4 mr-2"/>Souscriptions</TabsTrigger>
            <TabsTrigger value="audit" className="data-[state=active]:bg-slate-800"><History className="w-4 h-4 mr-2"/>Audit</TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="dashboard">
              <AdminInvestmentDashboard
                projects={data.projects}
                offers={data.offers}
                investors={data.investors}
                subscriptions={data.subscriptions}
                onNavigateTab={setActiveTab}
              />
            </TabsContent>
            <TabsContent value="projects">
              <ProjectsManagement projects={data.projects} managers={data.managers} refreshData={loadData} />
            </TabsContent>
            <TabsContent value="offers">
              <OffersManagement offers={data.offers} projects={data.projects} refreshData={loadData} />
            </TabsContent>
            <TabsContent value="investors">
              <InvestorsManagement
                investors={data.investors}
                subscriptions={data.subscriptions}
                offers={data.offers}
                projects={data.projects}
                managers={data.managers}
                refreshData={loadData}
              />
            </TabsContent>
            <TabsContent value="subscriptions">
              <SubscriptionsManagement
                subscriptions={data.subscriptions}
                offers={data.offers}
                projects={data.projects}
                investors={data.investors}
                refreshData={loadData}
              />
            </TabsContent>
            <TabsContent value="audit"><AuditLogs /></TabsContent>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
};

export default AdminInvestments;

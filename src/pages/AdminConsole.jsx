import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import Layout from '@/components/Layout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Briefcase, Users, Repeat, AlertCircle } from 'lucide-react';
import { ProjectsTab } from '@/components/admin-console/ProjectsTab';
import { InvestmentsTab } from '@/components/admin-console/InvestmentsTab';
import { TransactionsTab } from '@/components/admin-console/TransactionsTab';
import { AdminDashboard } from '@/components/admin-console/AdminDashboard';
import { ExpandableDataPanels } from '@/components/admin-console/ExpandableDataPanels';
import { api } from '@/services/api';

const AdminConsole = () => {
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
      console.error('Failed to load admin console data:', err);
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
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
      <Helmet>
        <title>Console d'Administration | AGRICAP FIN</title>
      </Helmet>

      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        <div>
          <h1 className="text-3xl font-bold gradient-text">Console d'Administration</h1>
          <p className="text-muted-foreground">Gestion centralisée en temps réel et Data Visualisation</p>
        </div>

        <AdminDashboard data={data} />

        <ExpandableDataPanels data={data} />

        <Tabs defaultValue="projects" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6 bg-card border border-border">
            <TabsTrigger value="projects" className="flex items-center gap-2 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <Briefcase className="w-4 h-4"/> Gestion Projets
            </TabsTrigger>
            <TabsTrigger value="investments" className="flex items-center gap-2 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <Users className="w-4 h-4"/> Investisseurs
            </TabsTrigger>
            <TabsTrigger value="transactions" className="flex items-center gap-2 data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <Repeat className="w-4 h-4"/> Transactions
            </TabsTrigger>
          </TabsList>

          <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
            <TabsContent value="projects" className="mt-0">
              <ProjectsTab projects={data.projects} managers={data.managers} refreshData={loadData} />
            </TabsContent>
            <TabsContent value="investments" className="mt-0">
              <InvestmentsTab
                investors={data.investors}
                subscriptions={data.subscriptions}
                projects={data.projects}
                managers={data.managers}
                refreshData={loadData}
              />
            </TabsContent>
            <TabsContent value="transactions" className="mt-0">
              <TransactionsTab movements={data.movements} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
};

export default AdminConsole;

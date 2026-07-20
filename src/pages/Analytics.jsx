import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { Store, Banknote, Repeat, TrendingUp, MapPin, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from '@/services/api';

const agentPerformanceData = [];

const operationsByProductData = [];
const PRODUCT_COLORS = ['#3b82f6', '#10b981', '#f97316'];

const operationsByZoneData = [];
const ZONE_COLORS = ['#3b82f6', '#10b981', '#f97316', '#ef4444'];

const accountMovementsData = [];

const Analytics = () => {
  const [overview, setOverview] = useState(null);

  useEffect(() => { api.analytics.overview().then(setOverview).catch(() => {}); }, []);

  // KPI de haut niveau réellement calculés côté backend (agrégation cross-apps en lecture
  // seule). Les graphiques ci-dessous (perf. agents, répartition zone/produit, séries
  // temporelles) resteraient à alimenter par des endpoints d'agrégation dédiés — non
  // construits ici, laissés vides plutôt que simulés.
  const kpiData = overview ? [
    { title: 'Agences actives', value: overview.activeAgencies, Icon: Store, color: 'text-emerald-400' },
    { title: 'Agences suspendues', value: overview.suspendedAgencies, Icon: Store, color: 'text-amber-400' },
    { title: 'Trésorerie totale (USD)', value: `${overview.treasuryTotalUSD.toLocaleString()} $`, Icon: Banknote, color: 'text-blue-400' },
    { title: 'Transactions en attente', value: overview.pendingTransactions, Icon: Repeat, color: 'text-orange-400' },
  ] : [];

  return (
    <Layout>
      <Helmet>
        <title>Analytiques - AGRICAP FINTECH</title>
        <meta name="description" content="Analytiques et rapports sur la performance opérationnelle." />
      </Helmet>

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold gradient-text mb-2">Analytiques de Performance</h1>
        <p className="text-gray-400">Analyse détaillée des opérations et de l'efficacité des agents.</p>
      </motion.div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.1 }}
        className="my-6 p-4 glass-effect rounded-xl flex flex-wrap items-center gap-4"
      >
        <Filter className="w-5 h-5 text-slate-400" />
        <h3 className="text-lg font-semibold text-white mr-4">Filtres</h3>
        <Select defaultValue="last_30_days">
          <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700">
            <SelectValue placeholder="Période" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Aujourd'hui</SelectItem>
            <SelectItem value="last_7_days">7 derniers jours</SelectItem>
            <SelectItem value="last_30_days">30 derniers jours</SelectItem>
            <SelectItem value="this_month">Ce mois-ci</SelectItem>
          </SelectContent>
        </Select>
        <Select>
          <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700">
            <SelectValue placeholder="Zone Géographique" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les zones</SelectItem>
            <SelectItem value="kinshasa">Kinshasa</SelectItem>
            <SelectItem value="kongo_central">Kongo Central</SelectItem>
            <SelectItem value="kasai">Grand Kasaï</SelectItem>
          </SelectContent>
        </Select>
        <Select>
          <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700">
            <SelectValue placeholder="Agence" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les agences</SelectItem>
            <SelectItem value="gombe">Kinshasa-Gombe</SelectItem>
            <SelectItem value="lubum">Lubumbashi-Centre</SelectItem>
          </SelectContent>
        </Select>
        <Button className="ml-auto bg-gradient-to-r from-emerald-500 to-teal-600 text-white">Appliquer</Button>
      </motion.div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-slate-800/50">
          <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
          <TabsTrigger value="geo">Analyse Géographique</TabsTrigger>
          <TabsTrigger value="products">Analyse Produits</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview">
            <motion.div 
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { staggerChildren: 0.1 } }}
            >
                {kpiData.map((kpi, index) => (
                <motion.div key={index} variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}>
                    <Card className="glass-effect">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-300">{kpi.title}</CardTitle>
                        <kpi.Icon className={`h-5 w-5 ${kpi.color}`} />
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-bold text-white">{kpi.value}</div>
                    </CardContent>
                    </Card>
                </motion.div>
                ))}
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
                    <Card className="glass-effect h-full">
                        <CardHeader>
                            <CardTitle className="text-xl text-white">Mouvements des Comptes</CardTitle>
                            <CardDescription>Dépôts vs Retraits sur la période</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <AreaChart data={accountMovementsData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                    <XAxis dataKey="date" stroke="#9ca3af" />
                                    <YAxis stroke="#9ca3af" tickFormatter={(value) => `${value/1000}k`} />
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(30, 41, 59, 0.9)', border: 'none', borderRadius: '0.5rem' }}/>
                                    <Legend />
                                    <Area type="monotone" dataKey="deposits" name="Dépôts" stroke="#10b981" fill="rgba(16, 185, 129, 0.2)" />
                                    <Area type="monotone" dataKey="withdrawals" name="Retraits" stroke="#ef4444" fill="rgba(239, 68, 68, 0.2)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}>
                    <Card className="glass-effect h-full">
                        <CardHeader>
                            <CardTitle className="text-xl text-white">Performance des Agents</CardTitle>
                            <CardDescription>Volume de crédits octroyés ce mois-ci</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={agentPerformanceData} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                    <XAxis type="number" stroke="#9ca3af" tickFormatter={(value) => `${(value / 1000)}k $`} />
                                    <YAxis type="category" dataKey="name" stroke="#9ca3af" width={80} />
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(30, 41, 59, 0.9)', border: 'none', borderRadius: '0.5rem' }}/>
                                    <Legend />
                                    <Bar dataKey="amount" name="Montant Prêté" fill="url(#colorUv)" />
                                    <defs>
                                        <linearGradient id="colorUv" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.8}/>
                                        </linearGradient>
                                    </defs>
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </TabsContent>

        <TabsContent value="geo">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
                <motion.div className="lg:col-span-3" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                    <Card className="glass-effect h-full">
                        <CardHeader>
                            <CardTitle className="text-xl text-white">Répartition par Zone</CardTitle>
                            <CardDescription>Pourcentage des opérations par zone géographique</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={350}>
                                <PieChart>
                                    <Pie data={operationsByZoneData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={150} fill="#8884d8" labelLine={false} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                        {operationsByZoneData.map((entry, index) => <Cell key={`cell-${index}`} fill={ZONE_COLORS[index % ZONE_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(30, 41, 59, 0.9)', border: 'none', borderRadius: '0.5rem' }}/>
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </motion.div>
                <motion.div className="lg:col-span-2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                    <Card className="glass-effect h-full">
                        <CardHeader>
                            <CardTitle className="text-xl text-white">Activité par Agence</CardTitle>
                            <CardDescription>Volume de transactions par agence</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {/* Placeholder for map */}
                            <div className="h-[350px] bg-slate-800/50 rounded-lg flex items-center justify-center">
                                <div className="text-center text-slate-500">
                                    <MapPin className="mx-auto h-12 w-12" />
                                    <p className="mt-2">La carte d'activité des agences sera affichée ici.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </TabsContent>

        <TabsContent value="products">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                    <Card className="glass-effect h-full">
                        <CardHeader>
                            <CardTitle className="text-xl text-white">Volume par Produit</CardTitle>
                            <CardDescription>Répartition du volume total par type de produit</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <PieChart>
                                    <Pie data={operationsByProductData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={80} outerRadius={120} fill="#8884d8" paddingAngle={5} label={({ name, value }) => `${name} (${(value/1000)}k)`}>
                                        {operationsByProductData.map((entry, index) => <Cell key={`cell-${index}`} fill={PRODUCT_COLORS[index % PRODUCT_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ backgroundColor: 'rgba(30, 41, 59, 0.9)', border: 'none', borderRadius: '0.5rem' }}/>
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                    <Card className="glass-effect h-full">
                        <CardHeader>
                            <CardTitle className="text-xl text-white">Analyse des Transferts</CardTitle>
                            <CardDescription>Interactions entre les différents canaux</CardDescription>
                        </CardHeader>
                        <CardContent>
                             <div className="h-[300px] bg-slate-800/50 rounded-lg flex items-center justify-center">
                                <div className="text-center text-slate-500">
                                    <Repeat className="mx-auto h-12 w-12" />
                                    <p className="mt-2">Le graphique des flux de transferts (Sankey) sera affiché ici.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
};

export default Analytics;
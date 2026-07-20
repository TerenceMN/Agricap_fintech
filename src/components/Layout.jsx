import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CreditCard, PiggyBank, TrendingUp, Wallet, Users, FileText,
  BarChart3, Settings, Menu, X, Bell, Search, ChevronDown, LogOut, Repeat,
  UserCog, ShieldAlert, ClipboardCheck, Landmark, BookOpen, UserCheck2,
  ShieldCheck, History, Share2, Eye, Code2, UserX as UserSwitch, MessageSquare,
  FileCheck2, Folder, Package, PieChart, Briefcase, Banknote, ArrowRightLeft,
  Store, Network, LineChart, CheckSquare2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/services/api';

const NavLink = ({ item, isActive }) => {
  const Icon = item.icon;
  return (
    <Link to={item.path}>
      <motion.div
        whileHover={{ x: 4 }}
        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg transition-all ${
          isActive 
            ? 'bg-gradient-to-r from-emerald-500/20 to-blue-500/20 text-emerald-400 border border-emerald-500/30' 
            : 'text-gray-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5" />
          <span className="font-medium">{item.label}</span>
        </div>
        {item.badge && (
           <span className="bg-red-500/80 text-white text-xs font-bold px-2 py-0.5 rounded-full">{item.badge}</span>
        )}
      </motion.div>
    </Link>
  );
};

const NavSection = ({ title }) => (
  <h3 className="px-4 mt-6 mb-2 text-xs font-semibold tracking-wider text-gray-500 uppercase">{title}</h3>
);

const allMenuItems = {
  client: [
      { section: 'Mon Espace' },
      { icon: LayoutDashboard, label: 'Tableau de Bord', path: '/' },
      { icon: Wallet, label: 'Ma Trésorerie', path: '/wallet' },
      { icon: CreditCard, label: 'Mes Crédits', path: '/credits' },
      { icon: CreditCard, label: 'Analyse de crédit', path: '/credit' },
      { icon: PiggyBank, label: 'Mon Épargne', path: '/savings' },
      { icon: Package, label: 'Mes Actifs', path: '/assets' },
      // Surface du GARANT, pas du demandeur : un membre sollicité comme caution
      // dispose de 72 h pour consentir. Sans cette entrée, l'écran n'était
      // atteignable qu'en tapant l'URL — la fenêtre aurait expiré faute d'accès,
      // pas faute de décision.
      { icon: ShieldCheck, label: 'Demandes de caution', path: '/guarantee-requests' },
      { section: 'Gestion & Aide' },
      { icon: FileText, label: 'Mes Contrats', path: '/contracts' },
      { icon: Folder, label: 'Documents & KYC', path: '/documents' },
      { icon: Bell, label: 'Notifications', path: '/notifications' },
      { icon: MessageSquare, label: 'Service Client', path: '/support' },
    ],
    investor: [
      { section: 'Tableau de Bord' },
      { icon: LayoutDashboard, label: 'Vue d\'ensemble', path: '/' },
      { icon: LineChart, label: 'Mon Espace Invest', path: '/investor-space' },
      { icon: PieChart, label: 'Mes Portefeuilles', path: '/portfolios' },
      { icon: Briefcase, label: 'Mes Obligations', path: '/holdings' },
      { section: 'Opportunités' },
      { icon: TrendingUp, label: 'Marché Primaire', path: '/opportunities' },
      { icon: ArrowRightLeft, label: 'Conversions', path: '/conversions' },
      { section: 'Finance' },
      { icon: Banknote, label: 'Flux & Rendements', path: '/financial-flows' },
      { icon: FileText, label: 'Documents', path: '/investor-documents' },
      { section: 'Support' },
      { icon: Bell, label: 'Alertes', path: '/investor-notifications' },
      { icon: MessageSquare, label: 'Support', path: '/support' },
    ],
    admin: [
      { section: 'Opérations' },
      { icon: LayoutDashboard, label: 'Tableau de Bord', path: '/' },
      { icon: Store, label: 'Agences & Réseau', path: '/agencies' },
      { icon: Eye, label: 'Supervision', path: '/supervision' },
      { icon: MessageSquare, label: 'Support Client', path: '/support' },
      { icon: CreditCard, label: 'Crédits Agricoles', path: '/credits' },
      { icon: CreditCard, label: 'Analyse de crédit', path: '/credit' },
      { icon: Package, label: 'Données de référence', path: '/admin/data' },
      { icon: PiggyBank, label: 'Épargne', path: '/savings' },
      { icon: TrendingUp, label: 'Investissements', path: '/investments' },
      { icon: Repeat, label: 'Transactions', path: '/transactions' },
      { icon: Wallet, label: 'Portefeuilles', path: '/wallets' },
    { section: 'Institution' },
    { icon: Landmark, label: 'Trésorerie', path: '/treasury' },
    { icon: BookOpen, label: 'Comptabilité', path: '/accounting' },
    { section: 'Contrôle' },
    { icon: CheckSquare2, label: 'Approbations Caisse', path: '/caisses/approbations' },
    { icon: ClipboardCheck, label: 'Validation', path: '/validation-journal' },
    { icon: ShieldAlert, label: 'Cas Spéciaux', path: '/special-cases' },
    { icon: ShieldCheck, label: 'Conformité', path: '/compliance' },
    { icon: History, label: 'Journal d\'Audit', path: '/audit-log' },
    { icon: Bell, label: 'Mes notifications', path: '/notifications' },
    { section: 'Administration' },
    { icon: UserCog, label: 'Utilisateurs', path: '/users' },
    { icon: UserCheck2, label: 'Rôles & Accès', path: '/roles' },
    { icon: ShieldCheck, label: 'Approbateurs', path: '/admin/approvers' },
    { icon: MessageSquare, label: 'Test SMS', path: '/admin/sms-test' },
    { icon: Users, label: 'Fournisseurs', path: '/suppliers' },
    { icon: FileText, label: 'Contrats', path: '/contracts' },
    { section: 'Système' },
    { icon: BarChart3, label: 'Analytiques', path: '/analytics' },
    { icon: Share2, label: 'API & Partenaires', path: '/api-partners' },
    { icon: Code2, label: 'Documentation API', path: '/api-docs' },
  ],
  comptable: [
    { section: 'Institution' },
    { icon: BookOpen, label: 'Comptabilité', path: '/accounting' },
    { icon: ClipboardCheck, label: 'Validation', path: '/validation-journal' },
    { icon: History, label: 'Journal d\'Audit', path: '/audit-log' },
  ],
  caissier: [
    { section: 'Opérations' },
    { icon: Store, label: 'Mon Agence', path: '/agencies' },
    { icon: Landmark, label: 'Trésorerie', path: '/treasury' },
    { icon: Repeat, label: 'Transactions', path: '/transactions' },
    { icon: Eye, label: 'Supervision', path: '/supervision' },
  ],
  auditeur: [
    { section: 'Contrôle' },
    { icon: Store, label: 'Réseau Agences', path: '/agencies' },
    { icon: ShieldCheck, label: 'Conformité', path: '/compliance' },
    { icon: History, label: 'Journal d\'Audit', path: '/audit-log' },
    { icon: BookOpen, label: 'Comptabilité', path: '/accounting' },
  ],
};

const sharedBottomItems = [
   { icon: Settings, label: 'Paramètres', path: '/settings' },
];

// Bascule le rôle réel (16 rôles + legacy) vers l'un des 6 jeux de menus existants.
// Les personas client-facing (agri_op/invest) sont routées par IDENTITÉ (le capability
// set seul ne distingue pas "client" de "investisseur" — les deux sont read(+create)) ;
// les rôles de staff sont routés par proximité fonctionnelle avec les 4 vues internes
// existantes (admin/comptable/caissier/auditeur). Mapping v1 pragmatique — des menus
// dédiés par rôle seraient un raffinement UX ultérieur.
const ROLE_MENU_MAP = {
  agri_op: 'client', client: 'client',
  invest: 'investor', investor: 'investor',
  dg: 'admin', dir_ops: 'admin', admin_it: 'admin', admin: 'admin', manager: 'admin',
  gest_credit: 'admin', gest_port: 'admin', support: 'admin', partner: 'admin',
  aud_tech: 'auditeur', aud_fin: 'auditeur', risk_analyst: 'auditeur', compliance: 'auditeur',
  gest_agents: 'caissier', gest_zone: 'caissier', gest_caisse: 'caissier',
  agent_terrain: 'caissier', agent_cash: 'caissier',
};
// Accepte soit un rôle (string, usage historique) soit l'objet `user` complet — dans ce
// second cas, une vue assignée manuellement à CET utilisateur (Users.jsx, indépendante de
// son rôle) prend le dessus sur le mapping par défaut, sauf pendant une impersonation
// (RoleSwitcher), où c'est le rôle imité qui doit primer.
export const menuKeyFor = (userOrRole) => {
  if (!userOrRole) return 'client';
  if (typeof userOrRole === 'string') return ROLE_MENU_MAP[userOrRole] || 'client';
  const { role, viewOverride, impersonatedRole } = userOrRole;
  if (!impersonatedRole && viewOverride) return viewOverride;
  return ROLE_MENU_MAP[role] || 'client';
};

const RoleSwitcher = () => {
  const { user, impersonate } = useAuth();
  const navigate = useNavigate();

  if (!user || !user.capabilities?.config) {
    return null;
  }

  const handleRoleChange = (newRole) => {
    impersonate(newRole);
    navigate('/');
  };

  const roles = [
    { value: 'admin', label: 'Admin (Vue complète)' },
    { value: 'client', label: 'Client (Opérateur)' },
    { value: 'investor', label: 'Investisseur' },
    { value: 'comptable', label: 'Comptable' },
    { value: 'caissier', label: 'Caissier' },
  ];

  return (
    <div className="flex items-center gap-2">
      <UserSwitch className="w-5 h-5 text-amber-400" />
      <Select onValueChange={handleRoleChange} value={user.role}>
        <SelectTrigger className="w-[180px] bg-slate-800/60 border-slate-700 text-amber-400">
          <SelectValue placeholder="Changer de vue" />
        </SelectTrigger>
        <SelectContent>
          {roles.map(role => (
            <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [menuItems, setMenuItems] = useState([]);
  const [liveBadges, setLiveBadges] = useState({});

  useEffect(() => {
    if (user) {
      setMenuItems(allMenuItems[menuKeyFor(user)] || []);
    }
  }, [user, location.pathname]);

  // Badges dynamiques — remplacent les nombres fixes codés en dur par de vrais comptages
  // serveur (notifications non lues, tickets support ouverts, cas spéciaux non résolus).
  useEffect(() => {
    if (!user) return;
    const bucket = menuKeyFor(user);
    const counts = {};
    const jobs = [];

    jobs.push(
      api.notifications.mine()
        .then((rows) => { counts['/notifications'] = rows.filter((n) => !n.read).length; counts['/investor-notifications'] = counts['/notifications']; })
        .catch(() => {}),
    );
    if (bucket !== 'client' && bucket !== 'investor') {
      jobs.push(
        api.support.tickets.list()
          .then((rows) => { counts['/support'] = rows.filter((t) => t.status === 'ouvert' || t.status === 'escalade').length; })
          .catch(() => {}),
      );
      jobs.push(
        api.transactions.supervision()
          .then((s) => { counts['/special-cases'] = s.specialCasesCount; })
          .catch(() => {}),
      );
    }
    Promise.all(jobs).then(() => setLiveBadges(counts));
  }, [user, location.pathname]);

  const menuItemsWithBadges = menuItems.map((item) => {
    const live = item.path ? liveBadges[item.path] : undefined;
    return live ? { ...item, badge: live } : item;
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast({
      title: "Déconnexion réussie",
      description: "Vous avez été déconnecté de votre compte.",
    });
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ type: 'spring', damping: 25 }}
            className="w-72 glass-effect border-r border-white/10 flex flex-col z-50 fixed h-full md:relative"
          >
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center">
                  <span className="text-2xl font-bold text-white">A</span>
                </div>
                <div>
                  <h1 className="text-xl font-bold gradient-text">AGRICAP</h1>
                  <p className="text-xs text-gray-400">{menuKeyFor(user) === 'investor' ? 'Investor Portal' : 'Fintech Platform'}</p>
                </div>
              </div>
            </div>

            <nav className="flex-1 px-4 py-2 overflow-y-auto scrollbar-hide">
              <div className="space-y-1">
                {menuItemsWithBadges.map((item, index) =>
                  item.section ? (
                    <NavSection key={`section-${index}`} title={item.section} />
                  ) : (
                    <NavLink
                      key={item.path}
                      item={item}
                      isActive={location.pathname === item.path}
                    />
                  )
                )}
                 <div className="pt-4 mt-4 border-t border-slate-700/50">
                   {sharedBottomItems.map(item => (
                       <NavLink key={item.path} item={item} isActive={location.pathname === item.path} />
                   ))}
                </div>
              </div>
            </nav>

            <div className="p-4 border-t border-white/10 bg-black/20">
               <div className="flex items-center gap-3 p-3 rounded-lg glass-effect mb-2">
                <Avatar>
                  <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-blue-600 text-white">
                    {user ? user.name.substring(0,2).toUpperCase() : 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-semibold text-white truncate">{user ? user.name : 'Utilisateur'}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.role}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                className="w-full flex items-center justify-start gap-3 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={handleLogout}
              >
                <LogOut className="w-5 h-5" />
                <span className="font-medium">Déconnexion</span>
              </Button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col overflow-hidden w-full relative">
        <header className="h-16 glass-effect border-b border-white/10 flex items-center justify-between px-6 z-40">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-gray-400 hover:text-white"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            
            <div className="relative w-64 hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Rechercher..."
                className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <RoleSwitcher />
            <Link to={menuKeyFor(user) === 'investor' ? "/investor-notifications" : "/notifications"}>
                <Button variant="ghost" size="icon" className="relative text-gray-400 hover:text-white">
                <Bell className="w-5 h-5" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                </Button>
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 relative">
          {user && user.impersonatedRole && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-amber-500/80 text-white text-xs font-bold px-4 py-1 rounded-b-lg shadow-lg z-30">
              Mode Vue: {user.impersonatedRole.toUpperCase()}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
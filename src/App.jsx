import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Toaster } from '@/components/ui/toaster';
import AuthProvider, { useAuth } from '@/contexts/AuthContext.jsx';
import Layout, { menuKeyFor } from '@/components/Layout';

// Core Pages
import Dashboard from '@/pages/Dashboard';
import Login from '@/pages/Login';
import AuthCallback from '@/pages/AuthCallback';
import Settings from '@/pages/Settings';

// Système réel — moteur d'analyse crédit (backend Django)
import CreditAnalysis from '@/pages/credit/CreditAnalysis';
import Applications from '@/pages/credit/Applications';
import ApplicationDetail from '@/pages/credit/ApplicationDetail';
import Scoring from '@/pages/credit/Scoring';
import AssetVerification from '@/pages/credit/AssetVerification';
import Committee from '@/pages/credit/Committee';
import AuditJournal from '@/pages/credit/AuditJournal';
import Guarantees from '@/pages/credit/Guarantees';
import ReferenceData from '@/pages/credit/ReferenceData';
import CreditDashboard from '@/pages/credit/Dashboard';
import Instruction from '@/pages/credit/Instruction';
import Referentiel from '@/pages/Referentiel';
import DataAdmin from '@/pages/admin/DataAdmin';

// Client Specific Pages
import ClientWallet from '@/pages/ClientWallet';
import ClientDocuments from '@/pages/ClientDocuments';
import ClientNotifications from '@/pages/ClientNotifications';
import Credits from '@/pages/Credits';
import ClientCreditAnalyse from '@/pages/ClientCreditAnalyse';
import Savings from '@/pages/Savings';
import Transactions from '@/pages/Transactions';
import Contracts from '@/pages/Contracts';
import Support from '@/pages/Support';
import AssetsInventory from '@/pages/AssetsInventory';
import GuaranteeRequests from '@/pages/GuaranteeRequests';

// Investor Specific Pages
import Portfolios from '@/pages/Portfolios';
import Holdings from '@/pages/Holdings';
import Opportunities from '@/pages/Opportunities';
import Conversions from '@/pages/Conversions';
import FinancialFlows from '@/pages/FinancialFlows';
import InvestorDocuments from '@/pages/InvestorDocuments';
import InvestorNotifications from '@/pages/InvestorNotifications';
import Obligations from '@/pages/Obligations';
import InvestorSpace from '@/pages/InvestorSpace';

// Admin Pages
import Users from '@/pages/Users';
import Wallets from '@/pages/Wallets';
import Suppliers from '@/pages/Suppliers';
import Analytics from '@/pages/Analytics';
import ValidationJournal from '@/pages/ValidationJournal';
import SpecialCases from '@/pages/SpecialCases';
import Treasury from '@/pages/Treasury';
import Accounting from '@/pages/Accounting';
import Roles from '@/pages/Roles';
import Compliance from '@/pages/Compliance';
import AuditLog from '@/pages/AuditLog';
import ApiPartners from '@/pages/ApiPartners';
import ApiDocs from '@/pages/ApiDocs';
import Supervision from '@/pages/Supervision';
import Agencies from '@/pages/Agencies';
import AdminInvestments from '@/pages/AdminInvestments';
import AdminConsole from '@/pages/AdminConsole';
import ApproversConfig from '@/pages/ApproversConfig';
import SmsTest from '@/pages/SmsTest';
import CaisseApprobations from '@/pages/CaisseApprobations';
import PaymentsBackOffice from '@/pages/PaymentsBackOffice';
import Caisses from '@/pages/Caisses';

const PrivateRoute = ({ children, roles }) => {
  const { isAuthenticated, loading, user } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-300 bg-background">Chargement…</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  if (roles && user && !roles.includes(menuKeyFor(user))) {
    return <Navigate to="/" />;
  }
  return children;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />

      {/* Système réel — moteur d'analyse crédit (backend Django), enveloppé dans le Layout du design */}
      <Route path="/credit" element={<PrivateRoute><Layout><CreditAnalysis /></Layout></PrivateRoute>} />
      <Route path="/credit/dossiers" element={<PrivateRoute><Layout><Applications /></Layout></PrivateRoute>} />
      <Route path="/credit/dossiers/:code" element={<PrivateRoute><Layout><ApplicationDetail /></Layout></PrivateRoute>} />
      {/* Page de scoring (staff) : la mécanique du score et du taux. Comme les
          autres écrans backoffice, volontairement SANS prop `roles` — c'est le
          serveur qui décide (403 sur `analyse/`), et la page restitue ce refus
          telle quelle. Un garde front reposerait sur `menuKeyFor`, qui écrase
          les 16 rôles canoniques en 5 clés de menu et fermerait la page à des
          rôles qui y ont droit. */}
      <Route path="/credit/dossiers/:code/scoring" element={<PrivateRoute><Layout><Scoring /></Layout></PrivateRoute>} />
      {/* Backoffice crédit. Volontairement SANS prop `roles` : l'autorisation de ces trois
          écrans est décidée par le serveur (403 sur /assets/pending, ?view=committee et
          /audit/entries), et chacun la restitue explicitement. Un garde `roles` côté front
          reposerait sur `menuKeyFor`, qui écrase les 16 rôles canoniques en 5 clés de menu :
          il masquerait ces écrans à `gest_zone` ou `aud_fin`, qui y ont pourtant droit. */}
      <Route path="/credit/actifs" element={<PrivateRoute><Layout><AssetVerification /></Layout></PrivateRoute>} />
      <Route path="/credit/comite" element={<PrivateRoute><Layout><Committee /></Layout></PrivateRoute>} />
      <Route path="/credit/journal" element={<PrivateRoute><Layout><AuditJournal /></Layout></PrivateRoute>} />
      <Route path="/credit/garanties" element={<PrivateRoute><Layout><Guarantees /></Layout></PrivateRoute>} />
      <Route path="/credit/reference" element={<PrivateRoute><Layout><ReferenceData /></Layout></PrivateRoute>} />
      {/* Référentiel technico-économique (barèmes, plages, seuils, poids — P7).
          Comme les autres écrans backoffice ci-dessus, volontairement SANS prop
          `roles` : la page elle-même n'ouvre qu'à `me.is_staff` (calculé par le
          serveur) et chaque endpoint `ranges/config/versions` est `IsStaff` (403).
          Un garde `roles` côté route reposerait sur `menuKeyFor`, qui écrase les
          16 rôles canoniques en 5 clés de menu et fermerait la page à des rôles
          internes qui y ont droit. La restriction « staff, jamais client » est
          portée par la nav (entrée présente dans les seuls menus de personnel). */}
      <Route path="/credit/referentiel" element={<PrivateRoute><Layout><Referentiel /></Layout></PrivateRoute>} />
      <Route path="/credit/tableau-de-bord" element={<PrivateRoute><Layout><CreditDashboard /></Layout></PrivateRoute>} />
      {/* Écran d'instruction de la direction : paramètres du dossier → échéancier et
          DSCR recalculés par le moteur, puis confrontation poste par poste du classeur
          au référentiel de la filière. Deux routes pour un même écran — sans code, il
          propose la liste des dossiers ; une entrée de navigation ne peut pas porter de
          référence de dossier, et un écran inatteignable est un écran qui n'existe pas.
          Volontairement SANS prop `roles`, comme les autres écrans du backoffice crédit :
          `roles` repose sur `menuKeyFor`, qui écrase les 16 rôles canoniques en 5 clés de
          menu et fermerait la page à `gest_credit` ou `gest_zone`, qui y ont droit. Les
          gardes réels sont serveur (`me.is_staff` pour l'affichage, `STAFF_ROLES` sur
          `analyse/`, `CAN_INSTRUCT` sur `reanalyser/`), et la page relaie chaque refus. */}
      <Route path="/credit/instruction" element={<PrivateRoute><Layout><Instruction /></Layout></PrivateRoute>} />
      <Route path="/credit/instruction/:code" element={<PrivateRoute><Layout><Instruction /></Layout></PrivateRoute>} />
      <Route path="/admin/data" element={<PrivateRoute roles={['admin']}><Layout><DataAdmin /></Layout></PrivateRoute>} />
      
      {/* Client Routes */}
      <Route path="/wallet" element={<PrivateRoute roles={['client']}><ClientWallet /></PrivateRoute>} />
      <Route path="/documents" element={<PrivateRoute roles={['client']}><ClientDocuments /></PrivateRoute>} />
      <Route path="/notifications" element={<PrivateRoute roles={['client', 'admin']}><ClientNotifications /></PrivateRoute>} />
      <Route path="/assets" element={<PrivateRoute roles={['client']}><AssetsInventory /></PrivateRoute>} />
      {/* Écran du garant (SPEC §2.5). Volontairement SANS prop `roles`, pour une
          raison différente de celle des écrans backoffice ci-dessus : il n'y a ici
          aucun privilège à garder. `GET /credits/guarantee-requests/` ne sert que
          les lignes dont l'utilisateur connecté est le garant désigné — y compris
          pour un admin. La liste est donc vide par construction pour qui n'est
          garant de rien, et l'écran vide dit exactement cela.
          Un garde `roles={['client']}` serait au contraire nuisible : il repose sur
          `menuKeyFor`, qui écrase les 16 rôles canoniques en 5 clés de menu, et
          fermerait la porte à un salarié ou un agent qui se porte caution d'un
          membre de son groupe — un cas parfaitement légitime, dont le refus se
          traduirait par une caution jamais consentie et un dossier bloqué. */}
      <Route path="/guarantee-requests" element={<PrivateRoute><GuaranteeRequests /></PrivateRoute>} />

      {/* Investor Routes */}
      <Route path="/portfolios" element={<PrivateRoute roles={['investor', 'admin']}><Portfolios /></PrivateRoute>} />
      <Route path="/holdings" element={<PrivateRoute roles={['investor', 'admin']}><Holdings /></PrivateRoute>} />
      <Route path="/opportunities" element={<PrivateRoute roles={['investor', 'admin']}><Opportunities /></PrivateRoute>} />
      <Route path="/conversions" element={<PrivateRoute roles={['investor', 'admin']}><Conversions /></PrivateRoute>} />
      <Route path="/financial-flows" element={<PrivateRoute roles={['investor', 'admin']}><FinancialFlows /></PrivateRoute>} />
      <Route path="/investor-documents" element={<PrivateRoute roles={['investor', 'admin']}><InvestorDocuments /></PrivateRoute>} />
      <Route path="/investor-notifications" element={<PrivateRoute roles={['investor', 'admin']}><InvestorNotifications /></PrivateRoute>} />
      <Route path="/obligations" element={<PrivateRoute roles={['investor', 'admin']}><Obligations /></PrivateRoute>} />
      <Route path="/investor-space" element={<PrivateRoute roles={['investor', 'admin']}><InvestorSpace /></PrivateRoute>} />
      
      {/* Shared / User Routes */}
      <Route path="/credits" element={<PrivateRoute roles={['admin', 'client']}><Credits /></PrivateRoute>} />
      {/* Sous-page d'analyse CLIENT (score-lettre + pistes, principe 7). Route
          `/credits/…` au pluriel = espace client ; `/credit/*` au singulier =
          staff. Accès mêmes rôles que /credits ; le serveur re-vérifie l'accès
          au dossier (403) et distingue « pas encore analysé » (404). */}
      <Route path="/credits/analyse/:code" element={<PrivateRoute roles={['admin', 'client']}><ClientCreditAnalyse /></PrivateRoute>} />
      <Route path="/savings" element={<PrivateRoute roles={['admin', 'client']}><Savings /></PrivateRoute>} />
      <Route path="/transactions" element={<PrivateRoute roles={['admin', 'client', 'caissier']}><Transactions /></PrivateRoute>} />
      <Route path="/contracts" element={<PrivateRoute roles={['admin', 'client']}><Contracts /></PrivateRoute>} />
      <Route path="/support" element={<PrivateRoute roles={['admin', 'client', 'investor']}><Support /></PrivateRoute>} />
      <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />

      {/* Admin Routes - Protected */}
      <Route path="/agencies" element={<PrivateRoute roles={['admin', 'caissier', 'auditeur']}><Agencies /></PrivateRoute>} />
      <Route path="/users" element={<PrivateRoute roles={['admin']}><Users /></PrivateRoute>} />
      <Route path="/wallets" element={<PrivateRoute roles={['admin']}><Wallets /></PrivateRoute>} />
      <Route path="/suppliers" element={<PrivateRoute roles={['admin']}><Suppliers /></PrivateRoute>} />
      <Route path="/analytics" element={<PrivateRoute roles={['admin']}><Analytics /></PrivateRoute>} />
      <Route path="/supervision" element={<PrivateRoute roles={['admin', 'caissier']}><Supervision /></PrivateRoute>} />
      <Route path="/validation-journal" element={<PrivateRoute roles={['admin', 'comptable']}><ValidationJournal /></PrivateRoute>} />
      <Route path="/special-cases" element={<PrivateRoute roles={['admin']}><SpecialCases /></PrivateRoute>} />
      <Route path="/treasury" element={<PrivateRoute roles={['admin', 'caissier']}><Treasury /></PrivateRoute>} />
      <Route path="/accounting" element={<PrivateRoute roles={['admin', 'comptable', 'auditeur']}><Accounting /></PrivateRoute>} />
      <Route path="/roles" element={<PrivateRoute roles={['admin']}><Roles /></PrivateRoute>} />
      <Route path="/compliance" element={<PrivateRoute roles={['admin', 'auditeur']}><Compliance /></PrivateRoute>} />
      <Route path="/audit-log" element={<PrivateRoute roles={['admin', 'auditeur']}><AuditLog /></PrivateRoute>} />
      <Route path="/api-partners" element={<PrivateRoute roles={['admin']}><ApiPartners /></PrivateRoute>} />
      <Route path="/api-docs" element={<PrivateRoute roles={['admin']}><ApiDocs /></PrivateRoute>} />
      {/* `/investments` servait un SECOND espace investisseur, redondant avec
          `/investor-space` : deux écrans, deux « total investi » qui ne comptaient
          pas la même grandeur. L'écran a été supprimé et ses acquis repris dans
          l'espace unique. La redirection reste pour les liens déjà diffusés — un
          404 sur une URL d'investisseur se lit comme une perte d'accès à son
          argent. Côté back-office, la gestion reste `/admin/investments`. */}
      <Route path="/investments" element={<Navigate to="/investor-space" replace />} />
      <Route path="/admin/investments" element={<PrivateRoute roles={['admin']}><AdminInvestments /></PrivateRoute>} />
      <Route path="/admin/console" element={<PrivateRoute roles={['admin']}><AdminConsole /></PrivateRoute>} />
      <Route path="/admin/approvers" element={<PrivateRoute roles={['admin']}><Layout><ApproversConfig /></Layout></PrivateRoute>} />
      <Route path="/admin/sms-test" element={<PrivateRoute roles={['admin']}><Layout><SmsTest /></Layout></PrivateRoute>} />
      {/* Vue des caisses (`kind=CAISSE`) : séances, plafonds, gels sur écart.
          Volontairement SANS prop `roles`, comme les autres écrans `/caisses/*` :
          la lecture exige `IsStaff`+`read` (403 sur `GET /caisses/accounts`) et les
          actions monétaires exigent `validate` — des notions de CAPACITÉ que
          `menuKeyFor` (5 clés de menu) ne sait pas exprimer. Le serveur tranche et
          la page relaie ; la restriction est portée par la nav (admin/caissier/comptable). */}
      <Route path="/caisses" element={<PrivateRoute><Layout><Caisses /></Layout></PrivateRoute>} />
      <Route path="/caisses/approbations" element={<PrivateRoute roles={['admin']}><Layout><CaisseApprobations /></Layout></PrivateRoute>} />
      {/* Back-office des ordres de paiement Makuta (file de réconciliation,
          suivi, actions de caisse). Volontairement SANS prop `roles` : l'écran
          exige la capacité `validate`/`audit`/`config`, notion de CAPACITÉ que
          `menuKeyFor` (5 clés de menu) ne sait pas exprimer. Le serveur tranche
          (403 sur `GET /caisses/payments`) et la page restitue ce refus tel quel ;
          la restriction « staff, jamais client » est portée par la nav. */}
      <Route path="/caisses/paiements" element={<PrivateRoute><Layout><PaymentsBackOffice /></Layout></PrivateRoute>} />
      
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
};

function App() {
  return (
    <Router>
      <Helmet>
        <title>AGRICAP FINTECH</title>
      </Helmet>
      <AuthProvider>
        <div className="min-h-screen text-slate-100 selection:bg-emerald-500/30">
          <AppRoutes />
          <Toaster />
        </div>
      </AuthProvider>
    </Router>
  );
}

export default App;
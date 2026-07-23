import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import CreditsTable from './CreditsTable';
import CreditFormDialog from './CreditFormDialog';
import RepaymentCalendar from '@/components/echeances/RepaymentCalendar';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import { DollarSign, AlertTriangle, Calendar, CheckSquare, BarChart, Repeat, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';

// Icônes du résumé, résolues depuis le nom renvoyé par le backend.
const ICONS = { DollarSign, AlertTriangle, Calendar, CheckSquare, BarChart, Repeat };

const SummaryCard = ({ title, value, icon, trendValue, trendDirection }) => {
  const Icon = ICONS[icon] || BarChart;
  const isUp = trendDirection === 'up';
  const TrendIcon = isUp ? TrendingUp : TrendingDown;
  return (
    <div className="bg-slate-800/50 p-4 rounded-lg flex flex-col justify-between h-full">
      <div className="flex justify-between items-start">
        <p className="font-semibold text-sm text-slate-300">{title}</p>
        <Icon className="w-5 h-5 text-slate-500" />
      </div>
      <div>
        <p className="font-bold text-2xl text-white mt-2">{value}</p>
        {trendValue && (
          <p className={`text-xs font-semibold flex items-center gap-1 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            <TrendIcon className="w-3 h-3" />{trendValue}
          </p>
        )}
      </div>
    </div>
  );
};

const AdminCreditsDashboard = () => {
  const { toast } = useToast();
  const [credits, setCredits] = useState([]);
  const [summaryData, setSummaryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  // Agenda global des remboursements (gap #5) : ouvert par « Vue Échéances ».
  const [calendarOpen, setCalendarOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, cards] = await Promise.all([api.portfolio.loans(), api.portfolio.summary()]);
      setCredits(rows);
      setSummaryData(cards);
    } catch (e) {
      toast({ variant: 'destructive', title: 'Chargement impossible', description: e.message });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Actions irréversibles / sensibles : confirmation explicite avant l'appel
  // serveur (garde-fou §4 du brief). Le libellé dit ce qui va se passer.
  const DESTRUCTIVE = {
    block: 'Bloquer ce crédit ? Le taux sera ramené à 0 %. Action sensible.',
    default: 'Passer ce crédit en DÉFAUT ? Cette qualification est lourde de conséquences.',
    close: 'Clôturer définitivement ce dossier de crédit ?',
    cancel: 'Annuler / rejeter ce crédit ? Le dossier passera au statut « Rejeté ».',
  };

  /**
   * Collecte des paramètres d'une action (MVP : window.prompt).
   * Retourne `null` pour signaler une annulation ou une saisie invalide — dans
   * ce cas aucun appel serveur n'est fait (pas d'action « à vide »).
   */
  const collectParams = (action) => {
    const num = (s) => Number(String(s ?? '').replace(',', '.'));
    switch (action) {
      case 'reassign': {
        const manager = window.prompt('Nouveau gestionnaire (nom ou sub) ?');
        if (manager === null) return null;
        if (!manager.trim()) {
          toast({ variant: 'destructive', title: 'Saisie requise', description: 'Le gestionnaire ne peut pas être vide.' });
          return null;
        }
        return { manager: manager.trim() };
      }
      case 'extend': {
        const months = window.prompt('Prolonger de combien de mois ?', '3');
        if (months === null) return null;
        const n = parseInt(months, 10);
        if (!Number.isFinite(n) || n <= 0) {
          toast({ variant: 'destructive', title: 'Durée invalide', description: 'Indiquez un nombre de mois entier positif.' });
          return null;
        }
        return { months: n };
      }
      case 'note': {
        const text = window.prompt('Note à ajouter :');
        if (text === null) return null;
        if (!text.trim()) {
          toast({ variant: 'destructive', title: 'Note vide', description: 'Rien n\'a été ajouté.' });
          return null;
        }
        return { text: text.trim() };
      }
      case 'approve': {
        const amt = window.prompt('Montant approuvé (vide = conserver le montant demandé) :');
        if (amt === null) return null;
        if (!amt.trim()) return {};               // approbation sans changer le montant
        const n = num(amt);
        if (!Number.isFinite(n) || n < 0) {
          toast({ variant: 'destructive', title: 'Montant invalide', description: 'Saisissez un montant positif ou laissez vide.' });
          return null;
        }
        return { amountApproved: n };
      }
      case 'disburse': {
        const amt = window.prompt('Montant à décaisser ?');
        if (amt === null) return null;
        const n = num(amt);
        if (!Number.isFinite(n) || n <= 0) {
          toast({ variant: 'destructive', title: 'Montant invalide', description: 'Le montant du décaissement doit être positif.' });
          return null;
        }
        const ref = window.prompt('Référence de la transaction (optionnel) :', '');
        if (ref === null) return null;            // annulation au 2e prompt
        const params = { amount: n };
        if (ref.trim()) params.ref = ref.trim();
        return params;
      }
      default:
        return {};                                // pause, resume, block, close, cancel, default, reminder
    }
  };

  const handleAction = async (action, credit) => {
    // Actions globales (barre d'outils).
    if (action === 'add_manual') { setCreateOpen(true); return; }
    if (action === 'sync') { await load(); toast({ title: 'Synchronisé', description: 'Portefeuille rechargé.' }); return; }
    if (action === 'alerts') {
      try {
        const a = await api.portfolio.alerts();
        toast({ title: `Alertes (${a.length})`, description: a.length ? a.map((x) => `• ${x.reference} — ${x.message}`).join('\n') : 'Aucune alerte.' });
      } catch (e) { toast({ variant: 'destructive', title: 'Erreur', description: e.message }); }
      return;
    }
    // Ouvre l'agenda global des remboursements (`GET /portfolio/calendar`), d'où
    // l'on peut plonger dans l'échéancier complet d'un dossier — remplace le
    // toast « allez voir ailleurs » par les données réelles servies par le serveur.
    if (action === 'calendar_view') { setCalendarOpen(true); return; }
    if (action === 'simulator') { toast({ title: 'Simulateur', description: 'Ouvrez « Config. Taux & Maturité » sur un dossier pour simuler.' }); return; }

    // Actions par dossier → endpoint générique.
    if (!credit?.id) return;
    // `contract` et `export` n'ont plus d'entrée de menu (cf. CreditRow.jsx) : aucun
    // endpoint backend ne les sert. Le garde-fou reste ici pour qu'un appel résiduel
    // dise la vérité au lieu d'afficher un faux succès.
    if (action === 'contract' || action === 'export') {
      toast({
        variant: 'destructive',
        title: 'Fonction indisponible',
        description: "Aucun service de génération de document n'existe côté serveur. "
          + "Rien n'a été produit ni enregistré.",
      });
      return;
    }
    // Confirmation explicite avant une action irréversible (block/default/close/
    // cancel). L'opérateur qui décline ne déclenche AUCUN appel serveur.
    if (DESTRUCTIVE[action] && !window.confirm(DESTRUCTIVE[action])) return;

    // Recueil des paramètres de l'action. `collectParams` renvoie `null` pour une
    // annulation ou une saisie invalide : dans ce cas on ne mute rien côté serveur.
    // Sinon un objet (éventuellement vide pour les actions sans paramètre).
    const params = collectParams(action);
    if (params === null) return;

    try {
      const res = await api.portfolio.action(credit.id, action, params);
      // Le serveur répond `{ ok, detail, credit }`. Une action inconnue revient en
      // HTTP 400 (ok:false) → l'ApiError est levée et affichée dans le `catch`.
      toast({ title: 'Action effectuée', description: res.detail });
      await load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e.message });
    }
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h2 className="text-xl font-bold text-white mb-4">Tableau de Bord Résumé</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {summaryData.map((item) => <SummaryCard key={item.title} {...item} />)}
          {loading && summaryData.length === 0 && (
            <div className="col-span-full flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>
          )}
        </div>
      </motion.div>
      <CreditsTable credits={credits} onAction={handleAction} />
      <CreditFormDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      <RepaymentCalendar open={calendarOpen} onClose={() => setCalendarOpen(false)} />
    </div>
  );
};

export default AdminCreditsDashboard;

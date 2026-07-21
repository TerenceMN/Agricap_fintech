/**
 * Tableau de bord crédit **role-aware** — §7.1 point 1.
 *
 * Un seul endpoint (`GET /api/credits/dashboard/`), six formes de réponse : le
 * serveur choisit la vue d'après le rôle et l'annonce dans `role`. Cet écran ne
 * décide donc jamais « qui voit quoi » ; il rend ce que le serveur a servi.
 *
 * ── Ce que cet écran refuse de faire ────────────────────────────────────────
 *
 * 1. **Aucune retombée silencieuse en vue client.** `dashboard.get_dashboard`
 *    termine par `return _client_dashboard(sub)` : un rôle staff mal câblé
 *    (dette P1 « `request.roles` jamais défini ») reçoit donc des KPI de client
 *    sans que rien ne le signale. Sur un écran d'instruction, c'est le pire des
 *    silences — l'utilisateur croit voir l'institution et voit ses propres
 *    dossiers. Ici, `role: 'client'` sur un écran staff est traité comme une
 *    anomalie affichée, et un `role` inconnu comme un refus de rendu.
 *
 * 2. **Aucun chiffre métier calculé côté client.** Pas de somme, pas de
 *    pourcentage, pas de conversion de devise. Quand le serveur sert un agrégat
 *    multi-devises non converti, l'écran l'affiche ET le disqualifie
 *    (`AGREGAT_NON_CONVERTI`) : le maquiller en le convertissant côté front
 *    serait remplacer un chiffre faux par un chiffre faux ET non journalisé.
 *
 * 3. **Aucune carte nue.** Chaque KPI porte son périmètre, sa période et sa
 *    devise (§7.2). Ces trois métadonnées vivent dans `dashboardWire.ts`, au
 *    plus près de la description du calcul serveur.
 *
 * Référence backend : `backend/credits/dashboard.py`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/services/api';
import type { CreditDashboardAgent, CreditDashboardClient, CreditDashboardCommittee } from '@/types/api';
import { ErrorPanel, Forbidden, Loading, toFieldErrors, type FieldError } from '@/components/backoffice/States';
import { fmtAmount, fmtDate } from './wire';
import {
  AGREGAT_NON_CONVERTI, PERIODE, PERIMETRE_REEL, SANS_DEVISE, TAUX_DEFAUT_NOTE,
  VALUE_CHAIN_ROWS_CAP,
  type DashboardAdmin, type DashboardAny, type DashboardBranch, type DashboardRegional,
} from './dashboardWire';

/** Lentille explicite. `''` = celle que le serveur choisit pour le rôle. */
type Lens = '' | 'committee';

/** Libellés des vues servies par `dashboard.py`, pour que l'utilisateur sache
 *  laquelle il regarde. Une clé absente = vue inconnue → rendu refusé. */
const ROLE_LABELS: Record<string, string> = {
  client: 'Vue client',
  agent: "Vue instruction (terrain et gestion de crédit)",
  branch_manager: 'Vue agence',
  regional_director: 'Vue direction',
  credit_committee: 'Vue comité de crédit',
  admin: 'Vue institution',
};

/**
 * Carte de KPI à trois métadonnées obligatoires.
 *
 * `components/backoffice/States.tsx` expose déjà un `KpiCard` (périmètre +
 * période), mais sans emplacement pour la **devise**, troisième exigence du
 * §7.2 — et ce fichier est partagé par quatre autres écrans en cours d'édition.
 * On ne l'élargit pas depuis ici : la carte du tableau de bord est locale et
 * porte les trois lignes. Si `KpiCard` gagne un jour un champ `devise`, cette
 * carte disparaît au profit du composant partagé.
 */
const Carte: React.FC<{
  libelle: string;
  valeur: string;
  perimetre: string;
  periode: string;
  devise: string;
  alerte?: string;
  lien?: { to: string; texte: string };
}> = ({ libelle, valeur, perimetre, periode, devise, alerte, lien }) => (
  <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col">
    <p className="text-xs text-slate-400">{libelle}</p>
    <p className="text-2xl font-bold text-white mt-1 break-words">{valeur}</p>
    <dl className="text-[11px] text-slate-500 mt-2 leading-relaxed space-y-0.5">
      <div><dt className="inline font-medium">Périmètre :</dt> <dd className="inline">{perimetre}</dd></div>
      <div><dt className="inline font-medium">Période :</dt> <dd className="inline">{periode}</dd></div>
      <div><dt className="inline font-medium">Devise :</dt> <dd className="inline">{devise}</dd></div>
    </dl>
    {alerte && (
      <p className="text-[11px] text-amber-300/90 mt-2 bg-amber-500/10 border border-amber-500/25 rounded px-2 py-1.5">
        ⚠ {alerte}
      </p>
    )}
    {lien && (
      <Link to={lien.to} className="text-xs text-primary underline mt-2 self-start">
        {lien.texte}
      </Link>
    )}
  </div>
);

const Section: React.FC<{ titre: string; children: React.ReactNode }> = ({ titre, children }) => (
  <section className="space-y-3">
    <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">{titre}</h2>
    {children}
  </section>
);

const Grille: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{children}</div>
);

/** Nombre entier d'effectif — formatage seul, aucun calcul. */
const eff = (n: number | undefined | null): string =>
  n == null ? '—' : n.toLocaleString('fr-FR');

/** Montant dont le serveur n'a PAS journalisé la conversion : on refuse de lui
 *  coller une devise qu'il n'a pas. Le formateur unique reste `fmtAmount`. */
const montantNonConverti = (n: number | undefined | null): string =>
  fmtAmount(n, '— devises mêlées');

const CreditDashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardAny | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [refus, setRefus] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>('');
  const [chargeA, setChargeA] = useState<string | null>(null);

  const load = useCallback(async (l: Lens) => {
    setLoading(true);
    setErrors([]);
    setRefus(null);
    try {
      const res = await api.credits.dashboard(l === 'committee' ? 'committee' : undefined);
      setData(res as unknown as DashboardAny);
      // Horodatage de la lecture : un KPI sans instant de lecture ne se
      // compare pas d'une session à l'autre. Ce n'est pas un chiffre métier.
      setChargeA(new Date().toISOString());
    } catch (e) {
      setData(null);
      // 403 = décision d'autorisation, pas panne. `?view=committee` est refusé
      // hors direction (`PermissionError` → 403 dans `credits_dashboard`).
      if (e instanceof ApiError && e.status === 403) setRefus(e.message);
      else setErrors(toFieldErrors(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(lens); }, [load, lens]);

  const role = typeof data?.role === 'string' ? data.role : '';
  const roleConnu = role in ROLE_LABELS;
  /** La corbeille comité n'est atteignable que par les rôles que le serveur a
   *  déjà reconnus comme direction/comité — c'est SA réponse qui l'ouvre. */
  const lentilleComiteOfferte = role === 'admin' || role === 'credit_committee' || lens === 'committee';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      <Helmet><title>Tableau de bord crédit — AGRICAP FINTECH</title></Helmet>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord crédit</h1>
          <p className="text-sm text-slate-400 mt-1">
            {roleConnu ? ROLE_LABELS[role] : 'Vue servie par le serveur selon votre rôle.'}
            {chargeA && <> · Lu le {fmtDate(chargeA)} à {new Date(chargeA).toLocaleTimeString('fr-FR')}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lentilleComiteOfferte && (
            <button
              type="button"
              onClick={() => setLens(lens === 'committee' ? '' : 'committee')}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
            >
              {lens === 'committee' ? 'Revenir à ma vue par défaut' : 'Voir la corbeille du comité'}
            </button>
          )}
          <Link to="/credit/dossiers" className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            File d'instruction
          </Link>
          <button
            type="button"
            onClick={() => void load(lens)}
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm"
          >
            Rafraîchir
          </button>
        </div>
      </div>

      <ErrorPanel errors={errors} title="Chargement du tableau de bord impossible" />

      {refus && (
        <Forbidden
          message="Le serveur a refusé cette vue."
          detail={refus}
        />
      )}

      {loading && <Loading label="Chargement des indicateurs…" />}

      {!loading && data && (
        <>
          {/* 1 — Retombée en vue client sur un écran staff : dite, jamais subie. */}
          {role === 'client' && lens === '' && (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-5 space-y-2">
              <p className="text-amber-200 font-semibold">
                Le serveur vous a servi la vue CLIENT.
              </p>
              <p className="text-sm text-amber-200/80">
                `get_dashboard` termine par une retombée en vue client quand aucun groupe de
                rôles ne correspond. Deux lectures possibles, et l'écran ne tranche pas à votre
                place : soit votre compte est bien un compte client, soit votre rôle staff n'est
                pas reconnu par le module crédit (dette P1 sur la résolution des rôles).
              </p>
              <p className="text-sm text-amber-200/80">
                Dans le doute, aucun KPI d'instruction n'est affiché ici : montrer des chiffres
                « institution » calculés sur votre seul portefeuille serait exactement l'erreur
                que cet écran doit empêcher. Votre espace client est sur{' '}
                <Link to="/credits" className="underline">Mes crédits</Link>.
              </p>
              <p className="text-xs text-amber-200/60">
                Effectif servi pour information : {eff((data as unknown as CreditDashboardClient).summary?.totalApplications)} dossier(s)
                sur votre périmètre personnel.
              </p>
            </div>
          )}

          {/* 2 — Rôle inconnu du contrat : rien n'est rendu, et c'est dit. */}
          {!roleConnu && (
            <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-5 space-y-2">
              <p className="text-red-200 font-semibold">
                Vue « {role || 'sans rôle'} » non reconnue par cet écran.
              </p>
              <p className="text-sm text-red-200/80">
                Le serveur a répondu avec un identifiant de vue que le contrat front ne décrit
                pas. Plutôt que de deviner la forme du payload et d'afficher des cartes vides
                ou fausses, l'écran s'abstient. Signalez-le : soit `dashboard.py` a gagné une
                vue, soit le champ `role` n'a pas été servi.
              </p>
            </div>
          )}

          {role === 'agent' && <VueAgent d={data as unknown as CreditDashboardAgent} />}
          {role === 'branch_manager' && <VueAgence d={data as unknown as DashboardBranch} />}
          {role === 'regional_director' && <VueDirection d={data as unknown as DashboardRegional} />}
          {role === 'admin' && <VueInstitution d={data as unknown as DashboardAdmin} />}
          {role === 'credit_committee' && <VueComite d={data as unknown as CreditDashboardCommittee} />}
        </>
      )}

      <p className="text-xs text-slate-500 border-t border-white/10 pt-4">
        Tous les chiffres de cet écran sont produits par
        {' '}<code className="font-mono">GET /api/credits/dashboard/</code>. Aucun n'est
        recalculé, agrégé ni converti côté navigateur — un écart constaté ici est un écart
        du serveur, et se corrige là-bas.
      </p>
    </div>
  );
};

// ── Vue instruction (agent de terrain, gestionnaire de crédit) ────────────────

const VueAgent: React.FC<{ d: CreditDashboardAgent }> = ({ d }) => {
  const s = d.summary;
  const p = PERIMETRE_REEL.agent;
  return (
    <div className="space-y-6">
      <Section titre="Ma file d'instruction">
        <Grille>
          <Carte
            libelle="À prendre en charge (soumis)"
            valeur={eff(s.pendingSubmission)}
            perimetre={p}
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
            lien={{ to: '/credit/dossiers?status=submitted', texte: 'Ouvrir la file' }}
          />
          <Carte
            libelle="En analyse"
            valeur={eff(s.inAnalysis)}
            perimetre={p}
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
            lien={{ to: '/credit/dossiers?status=in_analysis', texte: 'Ouvrir la file' }}
          />
          <Carte
            libelle="Ajournés"
            valeur={eff(s.adjourned)}
            perimetre={p}
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
            lien={{ to: '/credit/dossiers?status=adjourned', texte: 'Ouvrir la file' }}
          />
          <Carte
            libelle="En attente de décaissement"
            valeur={eff(s.pendingDisbursement)}
            perimetre={p}
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
            lien={{ to: '/credit/dossiers?status=pending_disbursement', texte: 'Ouvrir la file' }}
          />
        </Grille>
      </Section>

      <Section titre="Ce qui dort ou expire">
        <Grille>
          <Carte
            libelle="Dossiers sans mouvement > 7 jours"
            valeur={eff(s.staleApplications)}
            perimetre={p}
            periode={PERIODE.STALE_7J}
            devise={SANS_DEVISE}
          />
          <Carte
            libelle="Consentements client expirant sous 24 h"
            valeur={eff(s.consentExpiringSoon)}
            perimetre={p}
            periode={PERIODE.H24}
            devise={SANS_DEVISE}
            lien={{ to: '/credit/dossiers', texte: 'Filtrer la file sur le consentement' }}
          />
          <Carte
            libelle="Approuvés"
            valeur={eff(s.approved)}
            perimetre={p}
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
          />
          <Carte
            libelle="Crédits actifs"
            valeur={eff(s.activeCredits)}
            perimetre={p}
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
          />
        </Grille>
      </Section>

      <Section titre="Décaissements du mois">
        <Grille>
          <Carte
            libelle="Décaissements confirmés"
            valeur={eff(d.monthlyDisbursements.count)}
            perimetre={p}
            periode={PERIODE.MOIS_COURANT}
            devise={SANS_DEVISE}
          />
          <Carte
            libelle="Volume décaissé"
            valeur={montantNonConverti(d.monthlyDisbursements.volumeUsd)}
            perimetre={p}
            periode={PERIODE.MOIS_COURANT}
            devise="Mêlée (USD et CDF additionnés bruts)"
            alerte={AGREGAT_NON_CONVERTI}
          />
          <Carte
            libelle="Total des dossiers"
            valeur={eff(s.totalApplications)}
            perimetre={p}
            periode={PERIODE.DEPUIS_ORIGINE}
            devise={SANS_DEVISE}
          />
        </Grille>
      </Section>
    </div>
  );
};

// ── Vue agence ────────────────────────────────────────────────────────────────

const VueAgence: React.FC<{ d: DashboardBranch }> = ({ d }) => {
  const s = d.summary;
  const p = PERIMETRE_REEL.branch_manager;
  return (
    <div className="space-y-6">
      <Section titre="Dossiers de l'agence">
        <Grille>
          <Carte libelle="En attente d'accord" valeur={eff(s.pendingApproval)} perimetre={p}
            periode={PERIODE.STOCK} devise={SANS_DEVISE}
            lien={{ to: '/credit/dossiers?status=in_analysis', texte: 'Ouvrir la file' }} />
          <Carte libelle="Approuvés" valeur={eff(s.approved)} perimetre={p}
            periode={PERIODE.STOCK} devise={SANS_DEVISE} />
          <Carte libelle="Crédits actifs" valeur={eff(s.activeCredits)} perimetre={p}
            periode={PERIODE.STOCK} devise={SANS_DEVISE} />
          <Carte libelle="Rejetés" valeur={eff(s.rejectedApplications)} perimetre={p}
            periode={PERIODE.DEPUIS_ORIGINE} devise={SANS_DEVISE} />
        </Grille>
      </Section>

      <Section titre="Activité et risque">
        <Grille>
          <Carte libelle="Décaissements du mois" valeur={eff(d.monthlyDisbursements.count)}
            perimetre={p} periode={PERIODE.MOIS_COURANT} devise={SANS_DEVISE} />
          <Carte libelle="Volume décaissé" valeur={montantNonConverti(d.monthlyDisbursements.volumeUsd)}
            perimetre={p} periode={PERIODE.MOIS_COURANT}
            devise="Mêlée (USD et CDF additionnés bruts)" alerte={AGREGAT_NON_CONVERTI} />
          <Carte libelle="« Taux de défaut »" valeur={`${s.defaultRatePct} %`}
            perimetre={p} periode={PERIODE.DEPUIS_ORIGINE}
            devise="Ratio d'effectifs — sans devise" alerte={TAUX_DEFAUT_NOTE} />
          <Carte libelle="Dossiers clôturés" valeur={eff(s.closedCredits)} perimetre={p}
            periode={PERIODE.DEPUIS_ORIGINE} devise={SANS_DEVISE} />
        </Grille>
      </Section>
    </div>
  );
};

// ── Vue direction ─────────────────────────────────────────────────────────────

const VueDirection: React.FC<{ d: DashboardRegional }> = ({ d }) => {
  const s = d.summary;
  const p = PERIMETRE_REEL.regional_director;
  const lignes = d.activeByValueChain ?? [];
  return (
    <div className="space-y-6">
      <Section titre="Portefeuille institution">
        <Grille>
          <Carte libelle="Dossiers en attente" valeur={eff(s.pendingApplications)} perimetre={p}
            periode={PERIODE.STOCK} devise={SANS_DEVISE}
            lien={{ to: '/credit/dossiers', texte: "Ouvrir la file d'instruction" }} />
          <Carte libelle="Crédits actifs" valeur={eff(s.activeCredits)} perimetre={p}
            periode={PERIODE.STOCK} devise={SANS_DEVISE} />
          <Carte libelle="Encours décaissé" valeur={montantNonConverti(s.totalEncoursUsd)}
            perimetre={p} periode={PERIODE.STOCK}
            devise="Mêlée (USD et CDF additionnés bruts)" alerte={AGREGAT_NON_CONVERTI} />
          <Carte libelle="« Taux de défaut »" valeur={`${s.defaultRatePct} %`} perimetre={p}
            periode={PERIODE.DEPUIS_ORIGINE} devise="Ratio d'effectifs — sans devise"
            alerte={TAUX_DEFAUT_NOTE} />
        </Grille>
      </Section>

      <Section titre="Encours actif par filière">
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-slate-400 border-b border-white/10">
              <tr>
                <th className="text-left p-4">Filière</th>
                <th className="text-right p-4">Dossiers actifs</th>
                <th className="text-right p-4">Encours décaissé</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((r, i) => (
                <tr key={r.value_chain__code ?? `sans-filiere-${i}`} className="border-t border-white/5">
                  <td className="p-4">{r.value_chain__label ?? r.value_chain__code ?? 'Sans filière'}</td>
                  <td className="p-4 text-right">{eff(r.count)}</td>
                  <td className="p-4 text-right font-semibold">{montantNonConverti(r.encours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {lignes.length === 0 && (
            <p className="p-6 text-center text-slate-400 text-sm">Aucun crédit actif rattaché à une filière.</p>
          )}
          <p className="text-xs text-amber-300/90 px-4 py-3 border-t border-white/10">
            ⚠ {AGREGAT_NON_CONVERTI} Répartition limitée aux {VALUE_CHAIN_ROWS_CAP} premières
            filières par encours ; le serveur ne renvoie pas le nombre total de filières
            concernées, la liste peut donc être incomplète.
          </p>
        </div>
      </Section>
    </div>
  );
};

// ── Vue institution (admin, DG) ───────────────────────────────────────────────

const VueInstitution: React.FC<{ d: DashboardAdmin }> = ({ d }) => {
  const c = d.counts;
  const p = PERIMETRE_REEL.admin;
  const etapes: Array<[string, number, string]> = [
    ['Brouillons', c.draft, 'draft'],
    ['Soumis', c.submitted, 'submitted'],
    ['En analyse', c.in_analysis, 'in_analysis'],
    ['Ajournés', c.adjourned, 'adjourned'],
    ['Approuvés', c.approved, 'approved'],
    ['En décaissement', c.pending_disbursement, 'pending_disbursement'],
    ['Actifs', c.active, 'active'],
    ['Rejetés', c.rejected, 'rejected'],
    ['Clôturés', c.closed, 'closed'],
  ];
  return (
    <div className="space-y-6">
      <Section titre={`Dossiers par étape — ${eff(c.total)} au total`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {etapes.map(([libelle, valeur, statut]) => (
            <Link
              key={statut}
              to={`/credit/dossiers?status=${statut}`}
              className="bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl p-4 transition-colors"
            >
              <p className="text-xs text-slate-400">{libelle}</p>
              <p className="text-2xl font-bold text-white mt-1">{eff(valeur)}</p>
            </Link>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          Périmètre : {p} · Période : {PERIODE.STOCK} · Devise : {SANS_DEVISE}
          {' '}Base du total : {eff(c.total)} dossiers — les neuf étapes ci-dessus la composent.
        </p>
      </Section>

      <Section titre="Finances">
        <Grille>
          <Carte
            libelle="Encours décaissé (crédits actifs)"
            valeur={montantNonConverti(d.financials.totalEncoursUsd)}
            perimetre={p}
            periode={PERIODE.STOCK}
            devise="Mêlée (USD et CDF additionnés bruts)"
            alerte={AGREGAT_NON_CONVERTI}
          />
          <Carte
            libelle="« Taux de défaut »"
            valeur={`${d.financials.defaultRatePct} %`}
            perimetre={p}
            periode={PERIODE.DEPUIS_ORIGINE}
            devise="Ratio d'effectifs — sans devise"
            alerte={TAUX_DEFAUT_NOTE}
          />
        </Grille>
      </Section>

      <Section titre="Alertes de configuration et de conformité">
        <Grille>
          <Carte
            libelle="Cautions morales en attente de consentement"
            valeur={eff(d.alerts.pendingMoralGuarantees)}
            perimetre="Toutes garanties de type « morale » au statut en attente."
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
            lien={{ to: '/credit/garanties', texte: 'Suivi des garanties' }}
          />
          <Carte
            libelle="Consentements client expirés non traités"
            valeur={eff(d.alerts.expiredConsents)}
            perimetre="Dossiers soumis ou en analyse dont la fenêtre de 72 h est dépassée."
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
            lien={{ to: '/credit/dossiers', texte: 'Filtrer la file sur le consentement' }}
          />
          <Carte
            libelle="Critères de scoring actifs"
            valeur={eff(d.alerts.scoringCriteriaActive)}
            perimetre="Configuration du moteur, pas un volume de dossiers."
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
            lien={{ to: '/credit/reference', texte: 'Données de référence' }}
          />
        </Grille>
      </Section>
    </div>
  );
};

// ── Vue comité (lentille `?view=committee`) ───────────────────────────────────

const VueComite: React.FC<{ d: CreditDashboardCommittee }> = ({ d }) => {
  const s = d.summary;
  const p = PERIMETRE_REEL.credit_committee;
  const lignes = d.pendingApplications ?? [];
  return (
    <div className="space-y-6">
      <Section titre="Corbeille du comité">
        <Grille>
          <Carte
            libelle="Dossiers à statuer"
            valeur={eff(s.pendingReview)}
            perimetre={p}
            periode={PERIODE.STOCK}
            devise={SANS_DEVISE}
            lien={{ to: '/credit/comite', texte: 'Ouvrir la corbeille et voter' }}
          />
          <Carte
            libelle="Volume à statuer"
            valeur={fmtAmount(s.totalVolumeUsd, 'USD')}
            perimetre={p}
            periode={PERIODE.STOCK}
            devise="USD — conversion appliquée et journalisée côté serveur (`_amount_usd`)."
          />
          <Carte
            libelle="Plafond de délégation agence"
            valeur={fmtAmount(s.delegationThresholdUsd, 'USD')}
            perimetre="Paramètre d'institution — au-delà, le comité statue."
            periode="Valeur courante de la configuration."
            devise="USD"
          />
        </Grille>
      </Section>

      <Section titre="Dossiers les plus lourds">
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-slate-400 border-b border-white/10">
              <tr>
                <th className="text-left p-4">Code</th>
                <th className="text-left p-4">Filière</th>
                <th className="text-right p-4">Montant demandé</th>
                <th className="text-left p-4">Créé le</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody>
              {lignes.map((r) => (
                <tr key={r.code} className="border-t border-white/5">
                  <td className="p-4 font-mono text-xs text-emerald-300">{r.code}</td>
                  <td className="p-4 text-slate-300">{r.value_chain__label ?? '—'}</td>
                  <td className="p-4 text-right font-semibold">{fmtAmount(r.amount_requested, r.currency)}</td>
                  <td className="p-4 text-slate-400">{fmtDate(r.created_at)}</td>
                  <td className="p-4 text-right">
                    <Link to={`/credit/dossiers/${r.code}`} className="text-primary text-xs underline">
                      Instruire
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lignes.length === 0 && (
            <p className="p-6 text-center text-slate-400 text-sm">Aucun dossier n'attend le comité.</p>
          )}
          {lignes.length < s.pendingReview && (
            <p className="text-xs text-amber-300/90 px-4 py-3 border-t border-white/10">
              ⚠ Liste tronquée par le serveur : {lignes.length} ligne(s) affichée(s) sur
              {' '}{s.pendingReview}. La corbeille complète est sur{' '}
              <Link to="/credit/comite" className="underline">/credit/comite</Link>.
            </p>
          )}
        </div>
      </Section>
    </div>
  );
};

export default CreditDashboardPage;

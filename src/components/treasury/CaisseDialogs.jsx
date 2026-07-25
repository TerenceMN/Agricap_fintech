/**
 * Dialogues partagés des comptes de trésorerie / caisses (`caisses.TreasuryAccount`).
 *
 * ─── PRINCIPE 6 : UNE SEULE IMPLÉMENTATION, DEUX ÉCRANS ──────────────────────
 * Ces composants vivaient dans `pages/Wallets.jsx`. La vue « Caisses »
 * (`pages/Caisses.tsx`) a besoin EXACTEMENT des mêmes dialogues (séance de caisse,
 * plafond, flux, transfert, réaffectation, partenaire, détails, création). Plutôt
 * que d'en écrire des jumeaux — un second endroit où corriger le prochain bug —
 * ils sont extraits ici et les deux écrans les CONSOMMENT.
 *
 * Aucun de ces dialogues ne calcule un chiffre métier : ils mettent en forme ce
 * que l'API sert et rappellent les actions déjà écrites de `api.caisses.accounts`.
 * Les montants passent par le formateur unique du projet (`formatMontant`, fr-FR,
 * devise portée par la donnée) — jamais un « $ » ni un `toLocaleString()` nu.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError } from '@/services/api';
import { formatMontant, formatDateFr } from '@/components/guarantees/format';

/*
 * Le mapping catégoriel-vers-taux (autrefois `RISK_LABEL_TO_PCT`) reste SUPPRIMÉ :
 * `risk_level` est un champ CATÉGORIEL à trois valeurs, pas une grandeur mesurée.
 * Le convertir en nombre fabriquait une continuité là où il n'y a qu'un classement.
 * On affiche le NIVEAU servi, avec son libellé.
 */
export const RISK_LEVEL_LABEL = { FAIBLE: 'Faible', MODERE: 'Modéré', ELEVE: 'Élevé' };
export const RISK_LEVEL_CLASS = {
  FAIBLE: 'text-emerald-400', MODERE: 'text-yellow-400', ELEVE: 'text-red-400',
};
export const STATUS_CODE_TO_LABEL = {
  ACTIF: 'Actif', EN_TRAITEMENT: 'En traitement', EN_OBSERVATION: 'En observation',
  BLOQUE: 'Bloqué', ARCHIVE: 'Archivé',
};
export const KIND_CODE_TO_LABEL = { CAISSE: 'Caisse', BANQUE: 'Banque', MOBILE_MONEY: 'Mobile Money' };

/** Création / édition d'un compte de trésorerie. `kindLocked` fige le type sur CAISSE
 *  (écran « Caisses »), sans quoi le type reste au choix (écran « Trésorerie »). */
export const AccountFormModal = ({ isOpen, onClose, wallet, agencies, onSave, kindLocked = false }) => {
  const emptyForm = {
    code: '', name: '', kind: 'CAISSE', currency: 'USD', agencyId: '', manager: '',
    initialAmount: '0', scope: '', riskLevel: 'FAIBLE',
  };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    setForm(wallet
      ? {
        code: wallet.id, name: wallet.name, manager: wallet.manager === '-' ? '' : wallet.manager,
        scope: wallet.scope === '-' ? '' : wallet.scope, riskLevel: '',
      }
      : emptyForm);
  }, [wallet, isOpen]);

  const handleSubmit = () => {
    if (!form.name.trim() || (!wallet && !form.code.trim())) return;
    onSave(form);
  };

  const noun = kindLocked ? 'caisse' : 'compte de trésorerie';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="glass-effect text-white sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{wallet ? `Modifier ${wallet.name}` : `Créer une ${noun}`}</DialogTitle>
          <DialogDescription>
            {wallet
              ? 'Nom, gestionnaire et zone du compte de trésorerie.'
              : (kindLocked
                ? 'Nouvelle caisse (billetage physique).'
                : 'Nouveau compte de trésorerie (caisse, banque ou mobile money).')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {!wallet && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Code</Label>
              <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
                placeholder="Ex: CAISSE-KIN-01" className="col-span-3 bg-slate-900 border-slate-700" />
            </div>
          )}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Nom</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="col-span-3 bg-slate-900 border-slate-700" />
          </div>
          {!wallet && (
            <>
              {!kindLocked && (
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Type</Label>
                  <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                    <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CAISSE">Caisse</SelectItem>
                      <SelectItem value="BANQUE">Banque</SelectItem>
                      <SelectItem value="MOBILE_MONEY">Mobile Money</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Devise</Label>
                <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                  <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="CDF">CDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Agence</Label>
                <Select value={form.agencyId ? String(form.agencyId) : 'hq'} onValueChange={v => setForm({ ...form, agencyId: v === 'hq' ? '' : v })}>
                  <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue placeholder="Siège (HQ)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hq">Siège (HQ)</SelectItem>
                    {agencies.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label className="text-right">Montant Initial</Label>
                <Input type="number" value={form.initialAmount} onChange={e => setForm({ ...form, initialAmount: e.target.value })}
                  className="col-span-3 bg-slate-900 border-slate-700" />
              </div>
            </>
          )}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Gestionnaire</Label>
            <Input value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })}
              placeholder="sub du gestionnaire" className="col-span-3 bg-slate-900 border-slate-700" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Zone</Label>
            <Input value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })}
              className="col-span-3 bg-slate-900 border-slate-700" />
          </div>
          {wallet && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Niveau Risque</Label>
              <Select value={form.riskLevel || 'FAIBLE'} onValueChange={v => setForm({ ...form, riskLevel: v })}>
                <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FAIBLE">Faible</SelectItem>
                  <SelectItem value="MODERE">Modéré</SelectItem>
                  <SelectItem value="ELEVE">Élevé</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} className="bg-emerald-600 hover:bg-emerald-700">{wallet ? 'Enregistrer' : 'Créer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const TransferModal = ({ wallet, wallets, onClose, onSubmit }) => {
  const [toCode, setToCode] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => { setToCode(''); setAmount(''); setReason(''); }, [wallet]);

  const others = wallets.filter(w => w.id !== wallet?.id);

  return (
    <Dialog open={!!wallet} onOpenChange={onClose}>
      <DialogContent className="glass-effect text-white sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Transférer des fonds</DialogTitle>
          <DialogDescription>Depuis {wallet?.name} ({formatMontant(wallet?.balance, wallet?.currency)})</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Vers</Label>
            <Select value={toCode} onValueChange={setToCode}>
              <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue placeholder="Compte destination" /></SelectTrigger>
              <SelectContent>
                {others.map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({w.id})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Montant</Label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Motif</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button disabled={!toCode || !amount} onClick={() => onSubmit(toCode, amount, reason)} className="bg-emerald-600 hover:bg-emerald-700">Transférer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const FlowModal = ({ wallet, onClose, onSubmit }) => {
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('in');
  const [reason, setReason] = useState('');

  useEffect(() => { setAmount(''); setDirection('in'); setReason(''); }, [wallet]);

  return (
    <Dialog open={!!wallet} onOpenChange={onClose}>
      <DialogContent className="glass-effect text-white sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Ajouter un flux</DialogTitle>
          <DialogDescription>{wallet?.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Sens</Label>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger className="col-span-3 bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Entrée</SelectItem>
                <SelectItem value="out">Sortie</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Montant</Label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Motif</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button disabled={!amount} onClick={() => onSubmit(amount, direction, reason)} className="bg-emerald-600 hover:bg-emerald-700">Ajouter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** « Changer de gérant » (backend `reassign`) — anciennement « Réaffecter ». */
export const ReassignModal = ({ wallet, onClose, onSubmit }) => {
  const [manager, setManager] = useState('');
  useEffect(() => { setManager(wallet && wallet.manager !== '-' ? wallet.manager : ''); }, [wallet]);

  return (
    <Dialog open={!!wallet} onOpenChange={onClose}>
      <DialogContent className="glass-effect text-white sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Changer de gérant</DialogTitle>
          <DialogDescription>{wallet?.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Gestionnaire</Label>
            <Input value={manager} onChange={e => setManager(e.target.value)} placeholder="sub du nouveau gestionnaire" className="col-span-3 bg-slate-900 border-slate-700" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button disabled={!manager.trim()} onClick={() => onSubmit(manager)} className="bg-emerald-600 hover:bg-emerald-700">Changer de gérant</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const DetailsModal = ({ wallet, onClose }) => (
  <Dialog open={!!wallet} onOpenChange={onClose}>
    <DialogContent className="glass-effect text-white sm:max-w-[450px]">
      <DialogHeader>
        <DialogTitle>{wallet?.name}</DialogTitle>
        <DialogDescription className="font-mono text-xs">{wallet?.id}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2 text-sm">
        {[
          ['Type', KIND_CODE_TO_LABEL[wallet?.type] ?? wallet?.type],
          ['Gestionnaire', wallet?.manager],
          ['Solde Actuel', formatMontant(wallet?.balance, wallet?.currency)],
          ['Montant Initial', formatMontant(wallet?.initialAmount, wallet?.currency)],
          ['Statut', STATUS_CODE_TO_LABEL[wallet?.status] ?? wallet?.status],
          ['Zone', wallet?.scope],
          ['Partenaire', wallet?.partnerName || '—'],
          ['Niveau de risque', RISK_LEVEL_LABEL[wallet?.riskLevel] ?? (wallet?.riskLevel || 'non servi')],
          ['Date Création', formatDateFr(wallet?.createdAt)],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between border-b border-slate-800 pb-1">
            <span className="text-slate-400">{label}</span>
            <span className="text-white">{value}</span>
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Fermer</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

// Discipline de caisse journalière (comptes `kind=CAISSE`) — comptage d'ouverture/clôture
// comparé au solde système ; un écart au-delà de la tolérance gèle automatiquement le compte.
// La clôture répond 200 MÊME en cas d'écart : on lit `status`/`discrepancy`, jamais le code HTTP.
export const RegisterDialog = ({ wallet, onClose, toast: toastProp, onChanged }) => {
  const localToast = useToast().toast;
  const toast = toastProp || localToast;
  const [sessions, setSessions] = useState(undefined);
  const [openingCount, setOpeningCount] = useState('');
  const [closingCount, setClosingCount] = useState('');

  const load = useCallback(() => {
    if (!wallet) return;
    setSessions(undefined);
    api.caisses.accounts.registerSessions(wallet.id).then(setSessions).catch(() => setSessions([]));
  }, [wallet]);

  useEffect(() => { load(); setOpeningCount(''); setClosingCount(''); }, [load]);

  const current = sessions?.find(s => s.status === 'OPEN');

  const handleOpen = async () => {
    try {
      await api.caisses.accounts.registerOpen(wallet.id, Number(openingCount));
      toast({ title: 'Séance de caisse ouverte' });
      load();
      onChanged && onChanged();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleClose = async () => {
    try {
      const result = await api.caisses.accounts.registerClose(wallet.id, Number(closingCount));
      // Le serveur répond 200 même en cas d'écart : c'est `status`/`discrepancy` qui portent le verdict.
      if (result.status === 'DISCREPANCY') {
        toast({
          variant: 'destructive', title: 'Écart constaté — compte gelé',
          description: `Écart : ${formatMontant(result.discrepancy, wallet?.currency)}`,
        });
      } else {
        toast({ title: 'Séance clôturée sans écart' });
      }
      load();
      onChanged && onChanged();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  return (
    <Dialog open={!!wallet} onOpenChange={onClose}>
      <DialogContent className="glass-effect text-white sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Séance de caisse — {wallet?.name}</DialogTitle>
          <DialogDescription>
            Comptage d'ouverture puis de clôture comparé au solde système. Un écart au-delà de la
            tolérance gèle automatiquement le compte.
          </DialogDescription>
        </DialogHeader>
        {sessions === undefined ? (
          <p className="text-slate-500 text-sm py-6 text-center">Chargement...</p>
        ) : current ? (
          <div className="space-y-3 py-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Ouverte par</span><span>{current.openedBy || '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Comptage d'ouverture</span>
              <span>{formatMontant(current.openingCount, wallet?.currency)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Encaissements de la séance</span>
              <span>{formatMontant(current.cashInTotal, wallet?.currency)}</span>
            </div>
            <div className="space-y-2">
              <Label>Comptage de clôture</Label>
              <Input type="number" value={closingCount} onChange={e => setClosingCount(e.target.value)} className="bg-slate-900 border-slate-700" />
            </div>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!closingCount} onClick={handleClose}>
              Clôturer la séance
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Comptage d'ouverture</Label>
              <Input type="number" value={openingCount} onChange={e => setOpeningCount(e.target.value)} className="bg-slate-900 border-slate-700" />
            </div>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!openingCount} onClick={handleOpen}>
              Ouvrir la séance
            </Button>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Fermer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Rattachement + synchronisation partenaire (comptes `kind=MOBILE_MONEY`) — délègue au
// disjoncteur/health-check déjà réel de `partners`.
export const PartnerLinkDialog = ({ wallet, onClose, toast: toastProp, onChanged }) => {
  const localToast = useToast().toast;
  const toast = toastProp || localToast;
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState('');

  useEffect(() => {
    if (!wallet) return;
    api.partners.list().then(setPartners).catch(() => setPartners([]));
    setPartnerId(wallet.partnerId ? String(wallet.partnerId) : '');
  }, [wallet]);

  const handleLink = async () => {
    try {
      await api.caisses.accounts.linkPartner(wallet.id, partnerId ? Number(partnerId) : null);
      toast({ title: 'Partenaire rattaché' });
      onChanged && onChanged();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleSync = async () => {
    try {
      const result = await api.caisses.accounts.syncPartner(wallet.id);
      toast({ title: 'Synchronisation effectuée', description: `Statut : ${result.partnerSyncStatus} · disjoncteur : ${result.partnerCircuitState}` });
      onChanged && onChanged();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  return (
    <Dialog open={!!wallet} onOpenChange={onClose}>
      <DialogContent className="glass-effect text-white sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Partenaire API — {wallet?.name}</DialogTitle>
          <DialogDescription>Rattachement Mobile Money et synchronisation de connectivité.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label>Partenaire</Label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger className="bg-slate-900 border-slate-700"><SelectValue placeholder="Aucun" /></SelectTrigger>
              <SelectContent>
                {partners.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" variant="outline" onClick={handleLink}>Enregistrer le rattachement</Button>
          <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!wallet?.partnerId && !partnerId} onClick={handleSync}>
            Synchroniser maintenant
          </Button>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Fermer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const CeilingModal = ({ wallet, onClose, onSubmit }) => {
  const [ceiling, setCeiling] = useState('');
  useEffect(() => { setCeiling(wallet?.dailyCeiling != null ? String(wallet.dailyCeiling) : ''); }, [wallet]);

  return (
    <Dialog open={!!wallet} onOpenChange={onClose}>
      <DialogContent className="glass-effect text-white sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Plafond journalier de caisse</DialogTitle>
          <DialogDescription>{wallet?.name} — laisser vide pour retirer le plafond.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Plafond</Label>
            <Input type="number" value={ceiling} onChange={e => setCeiling(e.target.value)} className="col-span-3 bg-slate-900 border-slate-700" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={() => onSubmit(ceiling ? Number(ceiling) : null)} className="bg-emerald-600 hover:bg-emerald-700">Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

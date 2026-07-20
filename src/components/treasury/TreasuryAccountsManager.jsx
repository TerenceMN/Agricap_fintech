import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Trash2, Banknote, Landmark, Wallet } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { api, ApiError } from '@/services/api';

const KIND_LABEL_TO_CODE = { 'Caisse': 'CAISSE', 'Banque': 'BANQUE', 'Mobile Money': 'MOBILE_MONEY' };
const KIND_CODE_TO_LABEL = { CAISSE: 'Caisse', BANQUE: 'Banque', MOBILE_MONEY: 'Mobile Money' };

const AccountIcon = ({ type }) => {
  switch (type) {
    case 'Caisse': return <Wallet className="w-4 h-4 text-slate-400" />;
    case 'Banque': return <Landmark className="w-4 h-4 text-slate-400" />;
    case 'Mobile Money': return <Banknote className="w-4 h-4 text-slate-400" />;
    default: return null;
  }
};

const TreasuryAccountsManager = ({ isOpen, onClose }) => {
  const [accounts, setAccounts] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: '', type: '', currency: '', balance: '' });
  const { toast } = useToast();

  const loadAccounts = () => api.caisses.accounts.list().then(rows => setAccounts(rows.map(a => ({
    id: a.code, name: a.name, type: KIND_CODE_TO_LABEL[a.kind] || a.kind, currency: a.currency,
    balance: a.balance.toLocaleString(),
  })))).catch(() => {});
  useEffect(() => { if (isOpen) loadAccounts(); }, [isOpen]);

  const handleAddAccount = async () => {
    if (!newAccount.name || !newAccount.type || !newAccount.currency || !newAccount.balance) {
      toast({
        title: 'Erreur de validation',
        description: 'Veuillez remplir tous les champs.',
        variant: 'destructive',
      });
      return;
    }
    try {
      await api.caisses.accounts.create({
        code: `TR-${Date.now().toString().slice(-6)}`, name: newAccount.name,
        kind: KIND_LABEL_TO_CODE[newAccount.type] || 'CAISSE', currency: newAccount.currency,
        initialAmount: newAccount.balance,
      });
      setNewAccount({ name: '', type: '', currency: '', balance: '' });
      setShowAddForm(false);
      loadAccounts();
      toast({ title: 'Compte ajouté !', description: `Le compte "${newAccount.name}" a été créé avec succès.` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  const handleDeleteAccount = async (id) => {
    try {
      await api.caisses.accounts.archive(id);
      setAccounts(accounts.filter(acc => acc.id !== id));
      toast({ title: 'Compte archivé', description: 'Le compte a été archivé avec succès.' });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Échec', description: e instanceof ApiError ? e.message : String(e) });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl glass-effect text-white">
        <DialogHeader>
          <DialogTitle className="text-2xl gradient-text">Gestion des Comptes de Trésorerie</DialogTitle>
          <DialogDescription className="text-slate-400">
            Ajoutez, modifiez ou supprimez les comptes de caisse, bancaires et de mobile money.
          </DialogDescription>
        </DialogHeader>
        
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-300">Nom du Compte</TableHead>
                <TableHead className="text-slate-300">Type</TableHead>
                <TableHead className="text-slate-300">Devise</TableHead>
                <TableHead className="text-right text-slate-300">Solde</TableHead>
                <TableHead className="text-right text-slate-300">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id} className="border-slate-800">
                  <TableCell className="font-medium">{account.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <AccountIcon type={account.type} />
                      {account.type}
                    </div>
                  </TableCell>
                  <TableCell>{account.currency}</TableCell>
                  <TableCell className="text-right font-mono">{account.balance}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteAccount(account.id)}>
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {showAddForm && (
          <div className="mt-6 p-4 border border-slate-700 rounded-lg bg-slate-900/50">
            <h3 className="text-lg font-semibold mb-4 text-white">Nouveau Compte</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="name">Nom du Compte</Label>
                <Input id="name" value={newAccount.name} onChange={(e) => setNewAccount({...newAccount, name: e.target.value})} className="bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label htmlFor="type">Type</Label>
                <Select onValueChange={(value) => setNewAccount({...newAccount, type: value})}>
                  <SelectTrigger id="type" className="bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Sélectionner..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Caisse">Caisse</SelectItem>
                    <SelectItem value="Banque">Banque</SelectItem>
                    <SelectItem value="Mobile Money">Mobile Money</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="currency">Devise</Label>
                <Select onValueChange={(value) => setNewAccount({...newAccount, currency: value})}>
                  <SelectTrigger id="currency" className="bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Sélectionner..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CDF">CDF</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="balance">Solde Initial</Label>
                <Input id="balance" type="number" value={newAccount.balance} onChange={(e) => setNewAccount({...newAccount, balance: e.target.value})} className="bg-slate-800 border-slate-700" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setShowAddForm(false)}>Annuler</Button>
              <Button onClick={handleAddAccount} className="bg-gradient-to-r from-emerald-500 to-teal-600">Enregistrer</Button>
            </div>
          </div>
        )}

        <DialogFooter className="mt-6">
          {!showAddForm && (
            <Button onClick={() => setShowAddForm(true)} className="bg-gradient-to-r from-blue-500 to-indigo-600">
              <PlusCircle className="w-4 h-4 mr-2" />
              Ajouter un Compte
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TreasuryAccountsManager;
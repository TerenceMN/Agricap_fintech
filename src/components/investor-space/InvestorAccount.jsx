import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Download, FileText, MessageSquare, ShieldCheck } from 'lucide-react';
import { api } from '@/services/api';
import { formatDate } from '@/lib/investorSpaceUtils';

/**
 * Compte investisseur : profil, documents et messagerie.
 *
 * Ces trois blocs venaient de l'écran `Investments`, redondant avec l'espace
 * investisseur et supprimé. Les documents sont ceux servis par
 * `GET /compliance/documents/mine` — les mêmes que l'écran « Documents » du
 * menu, jamais une seconde source.
 */
const InvestorAccount = ({ investor }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [docs, ticketRows] = await Promise.all([
        api.compliance.myDocuments(),
        api.support.tickets.list(),
      ]);
      setDocuments(docs);
      setTickets(ticketRows);
    } catch (err) {
      setError(err.message || 'Chargement impossible.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSend = async () => {
    if (!subject.trim()) return;
    setSending(true);
    try {
      await api.support.tickets.create({ subject, category: 'investissement', priority: 'normal' });
      toast({ title: 'Message envoyé', description: "L'équipe vous répondra depuis cet écran." });
      setSubject('');
      await load();
    } catch (err) {
      toast({
        title: 'Erreur',
        description: err.errors?.length ? err.errors.map((e) => e.message).join(' · ') : (err.message || 'Envoi impossible.'),
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="p-4 text-sm text-red-300">{error}</CardContent>
        </Card>
      )}

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" /> Profil investisseur
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-slate-400 text-xs">Type</span>
              <p className="text-white font-medium">{investor?.investorType || '—'}</p>
            </div>
            <div>
              <span className="text-slate-400 text-xs">Profil de risque</span>
              <p className="text-white font-medium">{investor?.riskProfile || '—'}</p>
            </div>
            <div>
              <span className="text-slate-400 text-xs">Statut KYC</span>
              <p className="text-white font-medium">{investor?.kycStatus || '—'}</p>
            </div>
            <div>
              <span className="text-slate-400 text-xs">Statut du compte</span>
              <p className="text-white font-medium">{investor?.status || '—'}</p>
            </div>
          </div>
          <Button variant="outline" className="border-slate-700" onClick={() => navigate('/settings')}>
            Gérer mes préférences
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-400" /> Mes documents
          </CardTitle>
          <CardDescription>Contrats, pièces KYC et justificatifs rattachés à votre compte.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-slate-500">Chargement…</p>}
          {!loading && documents.length === 0 && (
            <p className="text-sm text-slate-500">Aucun document pour le moment.</p>
          )}
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="p-4 rounded-lg bg-slate-800/40 border border-slate-700 flex items-center justify-between gap-4"
            >
              <div>
                <p className="font-medium text-white">{doc.name}</p>
                <p className="text-xs text-slate-400">
                  {formatDate(doc.date)} · {doc.type}
                </p>
              </div>
              {doc.fileUrl && (
                <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="icon"><Download className="w-5 h-5" /></Button>
                </a>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-purple-400" /> Messages
          </CardTitle>
          <CardDescription>Vos échanges avec l’équipe de gestion.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {!loading && tickets.length === 0 && (
              <p className="text-sm text-slate-500">Aucun message envoyé.</p>
            )}
            {tickets.map((t) => (
              <div key={t.id} className="p-4 rounded-lg bg-slate-800/40 border border-slate-700">
                <div className="flex justify-between items-start gap-3 mb-1">
                  <span className="font-medium text-white">{t.subject}</span>
                  <span className="text-xs text-slate-400 shrink-0">{formatDate(t.createdAt)}</span>
                </div>
                <Badge variant="outline" className="text-xs border-slate-600 text-slate-300">{t.status}</Badge>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Sujet de votre demande…"
              className="bg-slate-800 border-slate-700"
            />
            <Button
              onClick={handleSend}
              disabled={sending || !subject.trim()}
              className="bg-slate-800 hover:bg-slate-700 shrink-0"
            >
              <MessageSquare className="w-4 h-4 mr-2" /> Envoyer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default InvestorAccount;

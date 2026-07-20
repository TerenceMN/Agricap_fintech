import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { MessageSquare, Send, CheckCircle, Clock } from 'lucide-react';
import { api } from '@/services/api';
import { formatDate } from '@/lib/investorSpaceUtils';

const ProjectQA = ({ projectCode, projectName, onQuestionSubmit }) => {
  const { toast } = useToast();
  const [questions, setQuestions] = useState([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadQuestions();
  }, [projectCode]);

  const loadQuestions = () => {
    if (!projectCode) return;
    api.investments.questions.list({ projectCode })
      .then(setQuestions)
      .catch((err) => toast({ title: 'Erreur', description: err.message || 'Chargement impossible.', variant: 'destructive' }));
  };

  const handleSubmit = async () => {
    if (!newQuestion.trim()) {
      toast({
        title: "Question vide",
        description: "Veuillez saisir votre question",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await api.investments.questions.create(projectCode, newQuestion);
      loadQuestions();
      setNewQuestion('');
      toast({
        title: "Question envoyée",
        description: "L'équipe du projet vous répondra sous 48-72h",
      });
      if (onQuestionSubmit) onQuestionSubmit();
    } catch (err) {
      toast({ title: 'Erreur', description: err.message || "Envoi impossible.", variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const pendingCount = questions.filter(q => q.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      {/* Submit New Question */}
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Poser une Question</span>
            {pendingCount > 0 && (
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                {pendingCount} en attente
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea 
            placeholder="Posez votre question concernant ce projet (technique, financière, risques, etc.)..."
            className="bg-slate-900 border-slate-700 min-h-[100px] text-white"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
          />
          <Button 
            className="w-full bg-blue-600 hover:bg-blue-700"
            onClick={handleSubmit}
            disabled={isSubmitting || !newQuestion.trim()}
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                <span>Envoi...</span>
              </div>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Envoyer la Question
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Questions List */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-blue-400" />
          Questions & Réponses ({questions.length})
        </h3>

        {questions.length === 0 ? (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-12 text-center">
              <MessageSquare className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">Aucune question pour ce projet</p>
              <p className="text-sm text-slate-500 mt-2">Soyez le premier à poser une question</p>
            </CardContent>
          </Card>
        ) : (
          questions.map((qa) => (
            <Card key={qa.id} className={`border ${qa.status === 'ANSWERED' ? 'bg-slate-800 border-slate-700' : 'bg-amber-500/5 border-amber-500/20'}`}>
              <CardContent className="p-6 space-y-4">
                {/* Question */}
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <Badge variant="outline" className={qa.status === 'ANSWERED' ? 'border-emerald-500 text-emerald-400' : 'border-amber-500 text-amber-400'}>
                      {qa.status === 'ANSWERED' ? (
                        <><CheckCircle className="w-3 h-3 mr-1" /> Répondu</>
                      ) : (
                        <><Clock className="w-3 h-3 mr-1" /> En attente</>
                      )}
                    </Badge>
                    <span className="text-xs text-slate-500">{formatDate(qa.questionDate)}</span>
                  </div>
                  <p className="text-white font-medium mb-2">Q: {qa.question}</p>
                </div>

                {/* Answer */}
                {qa.status === 'ANSWERED' && qa.answer && (
                  <div className="pl-4 border-l-2 border-emerald-500/30">
                    <p className="text-sm text-slate-300 mb-2">{qa.answer}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">— {qa.answeredBy}</span>
                      <span className="text-slate-500">{formatDate(qa.answerDate)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default ProjectQA;
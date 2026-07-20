import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, File, Loader2 } from 'lucide-react';
import { api } from '@/services/api';

const CLASS_LABELS = {
    1: 'Classe 1 — Capitaux et ressources durables',
    2: 'Classe 2 — Actif immobilisé',
    3: 'Classe 3 — Stocks',
    4: 'Classe 4 — Comptes de tiers',
    5: 'Classe 5 — Trésorerie',
    6: 'Classe 6 — Charges des activités ordinaires',
    7: 'Classe 7 — Produits des activités ordinaires',
    8: 'Classe 8 — Autres charges et autres produits',
};

// Les codes SYSCOHADA sont hiérarchiques (2 chiffres = compte principal, 3 = sous-compte,
// 4 = divisionnaire) : le parent d'un code est toujours "ce code moins son dernier
// chiffre", pas besoin de suivre le `parent` (id) renvoyé par l'API pour reconstruire l'arbre.
const buildTree = (accounts) => {
    const byCode = new Map(accounts.map(a => [a.code, { ...a, children: [] }]));
    const roots = [];
    for (const node of byCode.values()) {
        const parent = node.code.length > 2 ? byCode.get(node.code.slice(0, -1)) : null;
        if (parent) parent.children.push(node); else roots.push(node);
    }
    const byCodeAsc = (a, b) => a.code.localeCompare(b.code);
    for (const node of byCode.values()) node.children.sort(byCodeAsc);
    return roots.sort(byCodeAsc);
};

const AccountNode = ({ node, depth = 0 }) => {
    const [isOpen, setIsOpen] = useState(false);
    const hasChildren = node.children.length > 0;
    const muted = node.isCoreActivity === false;
    return (
        <div className={depth > 0 ? 'ml-4 pl-4 border-l border-slate-700' : ''}>
            <button
                onClick={() => hasChildren && setIsOpen(o => !o)}
                className="w-full flex items-center justify-between py-1.5 text-left"
                disabled={!hasChildren}
            >
                <span className={`flex items-center gap-2 ${muted ? 'text-slate-600 italic' : depth === 0 ? 'font-semibold text-slate-300' : 'text-sm text-slate-400'}`}>
                    {!hasChildren && <File className="w-3 h-3 flex-shrink-0" />}
                    {node.name}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {muted && <Badge variant="outline" className="text-xs text-slate-500 border-slate-700">Conformité</Badge>}
                    {node.currencies?.map(c => <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>)}
                    <span className="font-mono text-slate-500 text-xs">{node.code}</span>
                    {hasChildren && (isOpen
                        ? <ChevronDown className="w-4 h-4 text-slate-500" />
                        : <ChevronRight className="w-4 h-4 text-slate-500" />)}
                </div>
            </button>
            {hasChildren && isOpen && (
                <div className="space-y-1 mt-1 mb-1">
                    {node.children.map(child => <AccountNode key={child.code} node={child} depth={depth + 1} />)}
                </div>
            )}
        </div>
    );
};

const ClassCard = ({ classNo, accounts }) => {
    const classIsCore = accounts.some(a => a.isCoreActivity !== false);
    const [isOpen, setIsOpen] = useState(classIsCore);
    return (
        <div className={`rounded-lg p-3 ${classIsCore ? 'bg-slate-800/30' : 'bg-slate-900/20'}`}>
            <button onClick={() => setIsOpen(o => !o)} className="w-full flex items-center justify-between mb-2 px-1 text-left">
                <span className={`font-bold ${classIsCore ? 'text-white' : 'text-slate-500 italic'}`}>{CLASS_LABELS[classNo] || `Classe ${classNo}`}</span>
                <div className="flex items-center gap-2">
                    {!classIsCore && <Badge variant="outline" className="text-xs text-slate-500 border-slate-700">SYSCOHADA — non utilisée par AGRICAP</Badge>}
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                </div>
            </button>
            {isOpen && (
                <div className="space-y-0.5 border-t border-slate-700/50 pt-2">
                    {buildTree(accounts).map(root => <AccountNode key={root.code} node={root} />)}
                </div>
            )}
        </div>
    );
};

const ChartOfAccountsViewer = () => {
    const [accounts, setAccounts] = useState(null);

    useEffect(() => { api.ledger.accounts.list().then(setAccounts).catch(() => setAccounts([])); }, []);

    if (accounts === null) {
        return (
            <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement du plan comptable...
            </div>
        );
    }
    if (accounts.length === 0) {
        return <div className="text-center text-slate-500 py-12">Plan comptable vide.</div>;
    }

    const byClass = accounts.reduce((acc, a) => {
        (acc[a.classNo] ||= []).push(a);
        return acc;
    }, {});

    return (
        <div>
            <p className="text-xs text-slate-500 mb-4 px-1">
                Les comptes marqués <Badge variant="outline" className="text-xs text-slate-500 border-slate-700 mx-1">Conformité</Badge>
                existent uniquement parce que SYSCOHADA les rend obligatoires pour toute entreprise — AGRICAP FINTECH,
                un établissement de crédit, ne les mouvemente pas en pratique (négoce de marchandises, stocks, production
                immobilisée...). Ils restent utilisables si un besoin réel apparaît.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.keys(byClass).sort((a, b) => Number(a) - Number(b)).map((classNo) => (
                    <ClassCard key={classNo} classNo={classNo} accounts={byClass[classNo]} />
                ))}
            </div>
        </div>
    );
};

export default ChartOfAccountsViewer;

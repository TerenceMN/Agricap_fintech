"""
Comité d'investissement (P04) — décision collégiale à quorum.

**Ce qui est RÉUTILISÉ de `credits/committee.py`, tel quel :**

- `committee_quorum()` — la source du quorum, lue dans `InstitutionConfig`
  (feuille de gouvernance), avec son repli loggé. Le quorum d'investissement
  n'est donc pas un second paramètre parallèle : il hérite de la gouvernance de
  l'institution, sauf si `InvestmentConfig.committee_quorum` le dissocie
  explicitement (principe 8 : la règle vit en base, jamais dans le code).
- Les **exceptions** (`CommitteeError` et ses sous-classes) : mêmes codes, mêmes
  statuts HTTP, donc même contrat pour le front qu'un vote de comité de crédit.
- Le **schéma de vote** : un vote par membre (contrainte d'unicité), motif
  obligatoire, quorum figé au moment du vote, procès-verbal = séquence des votes,
  résolution dès qu'un sens atteint le quorum, maker ≠ checker.

**Ce qui NE PEUT PAS l'être, et pourquoi.** `credits.committee.cast_vote` est écrit
contre `CreditApplication` sans aucun point d'injection : il lit `app.committee_votes`
(FK vers `CreditApplication`), teste `app.status == "in_analysis"`, déduit la nécessité
du comité de `app.amount_requested`/`app.currency`, et **résout en appelant
`credits.workflow.approve`/`reject`** — trois statuts et une machine à états qui
n'existent pas ici. La rendre générique demanderait de refactorer `credits/`
(dépendance injectée sur le modèle de vote, la garde de statut et le résolveur), ce
que le périmètre de cette tâche interdit — un autre agent travaille sur `credits/`.
Ce module réutilise donc les *pièces* réutilisables et réimplémente uniquement le
câblage vers `Project` / `investments.workflow`.

Les différences de fond, elles, sont voulues :

- **Pas de seuil de délégation.** Tout projet d'investissement passe en comité :
  il n'existe pas de « petit projet » qu'un gestionnaire approuve seul. Il n'y a donc
  pas d'équivalent de `requires_committee()`.
- **La résolution favorable ne transitionne pas toute seule.** Un vote favorable rend
  P04→P05 *possible* ; c'est un humain qui liste les conditions et pose la transition
  (principe 2 de `CLAUDE.md` : le moteur recommande, l'humain décide). Une résolution
  défavorable, elle, mène à P13 — sur action explicite, également.
"""
from __future__ import annotations

import logging

from django.db import IntegrityError, transaction

# Réutilisation directe du module crédit : mêmes exceptions (donc mêmes codes côté
# front) et même source de quorum.
from credits.committee import (  # noqa: F401  (ré-export volontaire)
    CommitteeAlreadyVoted,
    CommitteeError,
    CommitteeInvalidDecision,
    CommitteeMakerChecker,
    CommitteeStateError,
    committee_quorum as credit_committee_quorum,
)

from .models import InvestmentCommitteeVote, InvestmentConfig, Project

logger = logging.getLogger(__name__)


def quorum() -> int:
    """Quorum du comité d'investissement.

    `InvestmentConfig.committee_quorum` s'il est renseigné (l'institution a voulu
    dissocier les deux comités), sinon le quorum de gouvernance partagé lu par
    `credits.committee.committee_quorum()`.
    """
    cfg = InvestmentConfig.active()
    if cfg.committee_quorum:
        return int(cfg.committee_quorum)
    return credit_committee_quorum()


# ── Lecture (procès-verbal) ───────────────────────────────────────────────────

def _tally(project: Project):
    votes = list(project.committee_votes.all())
    approve = sum(1 for v in votes if v.decision == InvestmentCommitteeVote.Decision.APPROVE)
    reject = sum(1 for v in votes if v.decision == InvestmentCommitteeVote.Decision.REJECT)
    return votes, approve, reject


def resolution(project: Project) -> tuple[bool, str | None]:
    """(résolu, sens) — d'après le décompte ET le statut déjà atteint par le projet.

    Un projet qui a dépassé P04 porte la décision dans son statut : la relire dans
    les votes seuls ferait « perdre » la résolution si le quorum était modifié après
    coup.
    """
    _, approve, reject = _tally(project)
    q = quorum()
    if approve >= q:
        return True, "approve"
    if reject >= q:
        return True, "reject"
    if project.status in (Project.Status.P05, Project.Status.P06, Project.Status.P07,
                          Project.Status.P08, Project.Status.P09, Project.Status.P10,
                          Project.Status.P11, Project.Status.P12):
        return True, "approve"
    return False, None


def _serialize_vote(v: InvestmentCommitteeVote) -> dict:
    return {
        "voter": v.voter_sub,
        "decision": v.decision,
        "comment": v.comment,
        "conditions": v.conditions or None,
        "votedAt": v.created_at.isoformat(),
    }


def votes_summary(project: Project) -> dict:
    """Payload `GET projects/<code>/committee-votes` — quorum, votes, décompte, résolution."""
    votes, approve, reject = _tally(project)
    resolved, decision = resolution(project)
    return {
        "projectCode": project.code,
        "quorum": quorum(),
        "votes": [_serialize_vote(v) for v in votes],
        "tally": {"approve": approve, "reject": reject},
        "resolved": resolved,
        "decision": decision,
        "conditions": project.committee_conditions or "",
    }


def proces_verbal(project: Project) -> str:
    """Procès-verbal lisible — la séquence des votes, pas un résumé."""
    votes, approve, reject = _tally(project)
    resolved, decision = resolution(project)
    entete = "sans décision (quorum non atteint)"
    if resolved:
        entete = "APPROBATION" if decision == "approve" else "REJET"
    lignes = [
        f"Comité d'investissement — projet {project.code} : {entete}.",
        f"Quorum requis : {quorum()} — pour {approve}, contre {reject}.",
    ]
    for v in votes:
        cond = f" — conditions : {v.conditions}" if v.conditions else ""
        lignes.append(f"• {v.voter_sub} : {v.decision} — {v.comment}{cond}")
    return "\n".join(lignes)


# ── Vote ──────────────────────────────────────────────────────────────────────

@transaction.atomic
def cast_vote(project: Project, *, voter_sub: str, decision: str, comment: str = "",
              conditions: str = "") -> dict:
    """Enregistre un vote de comité sur un projet en P04. Append-only.

    Le vote ne transitionne rien : il alimente le procès-verbal et, quand le quorum
    est atteint, ouvre (ou ferme) la transition P04→P05 que posera un humain avec les
    conditions écrites. Les conditions votées sont agrégées sur le projet au fil des
    votes favorables — pour qu'aucune ne se perde entre le vote et l'approbation.
    """
    decision = (decision or "").strip().lower()
    if decision not in (InvestmentCommitteeVote.Decision.APPROVE,
                        InvestmentCommitteeVote.Decision.REJECT):
        raise CommitteeInvalidDecision("Sens de vote invalide : attendu « approve » ou « reject ».")
    if not (comment or "").strip():
        raise CommitteeInvalidDecision(
            "Chaque vote du comité exige un motif : le commentaire est obligatoire."
        )
    if project.status != Project.Status.P04:
        raise CommitteeStateError(
            "Le comité d'investissement ne vote que sur un projet en P04 "
            f"(statut courant : « {project.status} »)."
        )

    # maker ≠ checker : ni le créateur du dossier ni son gestionnaire ne siègent dessus.
    if voter_sub and voter_sub in {project.created_by, project.manager_sub}:
        raise CommitteeMakerChecker(
            "Vous avez créé ou vous gérez ce projet : vous ne pouvez pas voter sa "
            "décision en comité (maker ≠ checker)."
        )

    q = quorum()
    try:
        with transaction.atomic():
            vote = InvestmentCommitteeVote.objects.create(
                project=project, voter_sub=voter_sub or "", decision=decision,
                comment=comment.strip(), conditions=(conditions or "").strip(),
                quorum_at_vote=q,
            )
    except IntegrityError as exc:
        raise CommitteeAlreadyVoted(
            "Vous avez déjà voté sur ce projet : un membre ne vote qu'une fois "
            "(le procès-verbal est append-only)."
        ) from exc

    from .workflow import _audit_transition
    _audit_transition(
        project, actor=voter_sub or "", action="investments.committee.vote",
        etape="comite_vote", decision=decision, motif=comment.strip(),
        conditions=(conditions or "").strip() or None, quorum=q,
    )

    cond = (conditions or "").strip()
    if cond and decision == InvestmentCommitteeVote.Decision.APPROVE:
        existantes = (project.committee_conditions or "").strip()
        ligne = f"[{voter_sub}] {cond}"
        if ligne not in existantes:
            project.committee_conditions = f"{existantes}\n{ligne}".strip()
            project.save(update_fields=["committee_conditions", "updated_at"])

    votes, approve, reject = _tally(project)
    resolved, outcome = resolution(project)
    if resolved:
        _audit_transition(
            project, actor=voter_sub or "", action="investments.committee.resolved",
            etape="comite_decision", decision=outcome, quorum=q,
            procesVerbal=[_serialize_vote(v) for v in votes],
        )

    return {
        "vote": _serialize_vote(vote),
        "tally": {"approve": approve, "reject": reject},
        "quorum": q,
        "resolved": resolved,
        "decision": outcome,
    }

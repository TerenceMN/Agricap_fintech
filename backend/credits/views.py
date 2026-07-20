"""
Vues Crédits Agricoles (Étapes 2-4).

Endpoints :
  GET  /api/credits/application/prefill/                        → préremplissage
  POST /api/credits/needs-sheet/parse/                          → parse Feuille de Besoins
  GET  /api/credits/needs-sheet-template/                       → modèle Excel
  POST /api/credits/simulate/                                   → simulation scoring
  POST /api/credits/applications/<code>/score/                  → re-scorer un dossier
  GET  /api/credits/applications/<code>/guarantees/             → liste garanties
  POST /api/credits/applications/<code>/guarantees/savings/     → bloc épargne
  POST /api/credits/applications/<code>/guarantees/moral/       → caution morale
  POST /api/credits/applications/<code>/guarantees/<id>/confirm/ → confirmer caution morale
  POST /api/credits/applications/<code>/guarantees/<id>/release/ → libérer garantie
"""
from __future__ import annotations

import os
import tempfile

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from credits.permissions import IsDesignatedGuarantor

from credits.needs_parser import NeedsSheetParseError, parse_needs_sheet
from credits.needs_template import generate_needs_sheet_template
from credits.prefill import get_prefill_data
from credits.dataio_simulator import dataio_simulate
from credits.roles import (
    CAN_CONFIRM_DISBURSEMENT,
    CAN_DECIDE,
    CAN_INSTRUCT,
    CAN_REQUEST_DISBURSEMENT,
    STAFF_ROLES,
    in_group,
    roles_of,
)
from credits.view_context import ViewContextService


def _roles(request: Request) -> list[str]:
    """Rôles canoniques de la requête — remplace `request.roles`, jamais posé.

    Voir `credits.roles.roles_of` : un middleware ne peut pas remplir cet
    attribut ici, l'authentification DRF s'exécutant après les middlewares.
    """
    return roles_of(request)


def _vcs(request: Request) -> ViewContextService:
    """Construit un ViewContextService depuis la requête courante."""
    return ViewContextService(
        sub=getattr(request.user, "sub", "") or "",
        roles=_roles(request),
    )


def _require_read(request: Request) -> bool:
    """Tout utilisateur authentifié — les données sont filtrées par ViewContextService."""
    return bool(request.user and hasattr(request.user, "sub"))


def _workflow_error(exc) -> Response:
    """Réponse unique pour tout refus du workflow.

    `code` ET statut HTTP viennent de l'exception (`credits.workflow`), jamais
    d'une valeur réécrite dans la vue : c'est la duplication qui avait produit
    deux vocabulaires parallèles pour les mêmes concepts (`delegation_exceeded`
    vs `DELEGATION_EXCEEDED`) — le défaut que le principe 6 interdit. Une règle
    nouvelle définit son code et son statut à un seul endroit, et toutes les vues
    la relaient correctement sans être modifiées.

    `errors` détaille cause par cause quand il y en a plusieurs, et préserve les
    codes et messages d'origine — notamment `GUARANTEE_TYPE_NOT_ELIGIBLE`, dont
    le message énumère les types admis pour la filière : le front ne peut pas
    reconstituer cette liste et ne doit pas la connaître autrement (principe 7).
    """
    return Response(
        {"detail": str(exc), "code": exc.code, "errors": exc.as_errors()},
        status=exc.http_status,
    )


def _require_group(request: Request, group) -> bool:
    """Vérifie l'appartenance à un groupe fonctionnel de `credits.roles`.

    Remplace l'ancien `_require_permission(request, "agent"|"analyst")`, qui
    comparait `user.role` à des libellés (« agent », « analyst ») n'existant
    dans aucun registre : seul `admin` franchissait ces gardes, et le workflow
    crédit était de fait inaccessible à tous les rôles métier.
    """
    if not _require_read(request):
        return False
    return in_group(request, group)


# ── 1. Préremplissage ────────────────────────────────────────────────────────

@api_view(["GET"])
def prefill_application(request: Request) -> Response:
    """
    GET /api/credits/application/prefill/?client_sub=<sub>

    Retourne les données préremplies pour un nouveau dossier de crédit.
    Si client_sub est omis, utilise le sub du demandeur lui-même.
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    requester_sub: str = getattr(request.user, "sub", "") or ""
    client_sub: str = request.query_params.get("client_sub", requester_sub)

    if not client_sub:
        return Response({"detail": "client_sub est requis."}, status=400)

    # Pour créer un dossier pour un tiers, il faut la permission agent
    if client_sub != requester_sub and not _require_group(request, CAN_INSTRUCT):
        return Response(
            {"detail": "Permission 'agent' requise pour créer un dossier au nom d'un client."},
            status=403,
        )

    data = get_prefill_data(client_sub=client_sub, requester_sub=requester_sub)

    if "error" in data:
        return Response({"detail": "Client introuvable.", "code": data["error"]}, status=404)

    return Response(data)


# ── 2. Parse Feuille de Besoins ──────────────────────────────────────────────

@api_view(["POST"])
@parser_classes([MultiPartParser])
def parse_needs_sheet_view(request: Request) -> Response:
    """
    POST /api/credits/needs-sheet/parse/
    Content-Type: multipart/form-data

    Champs requis  : file (xlsx)
    Champs optionnels : value_chain_code, area_ha, currency (USD|CDF), application_code

    Avec `application_code` (mode SPEC chantier 1) : le classeur est validé (6
    contrôles, 422 structuré) puis **ingéré en tables** (`dataio`, kind
    FEUILLE_BESOINS) et rattaché au dossier. Simulation et scoring liront ensuite
    ces tables — plus jamais le fichier.

    Sans `application_code` (parcours client avant création du dossier) : parsing
    en mémoire hérité, conservé pour ne pas casser l'étape 2 du simulateur.
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    file = request.FILES.get("file")
    if not file:
        return Response({"detail": "Fichier manquant (champ 'file' requis)."}, status=400)

    if not file.name.lower().endswith(".xlsx"):
        return Response(
            {"errors": [{
                "code": "FORMAT_INVALIDE",
                "message": "Seuls les classeurs .xlsx sont acceptés (pas de .xls ni .xlsm).",
            }]},
            status=422,
        )

    application_code: str = (request.data.get("application_code") or "").strip()
    if application_code:
        return _ingest_needs_sheet(request, file, application_code)

    value_chain_code: str = request.data.get("value_chain_code", "")
    area_ha_raw: str = request.data.get("area_ha", "")
    currency: str = request.data.get("currency", "USD").upper()

    if currency not in ("USD", "CDF"):
        return Response({"detail": "currency doit être USD ou CDF."}, status=400)

    # Résoudre la filière
    value_chain = None
    if value_chain_code:
        try:
            from reference_data.models import ValueChain
            value_chain = ValueChain.objects.get(code=value_chain_code, active=True)
        except Exception:
            return Response(
                {"detail": f"Filière '{value_chain_code}' introuvable ou inactive."},
                status=400,
            )

    # Convertir area_ha
    import decimal
    area_ha = None
    if area_ha_raw:
        try:
            area_ha = decimal.Decimal(area_ha_raw.replace(",", "."))
        except Exception:
            return Response({"detail": "area_ha invalide."}, status=400)

    # Sauvegarder temporairement
    suffix = os.path.splitext(file.name)[1]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        for chunk in file.chunks():
            tmp.write(chunk)
        tmp.flush()
        tmp.close()

        try:
            result = parse_needs_sheet(
                file_path=tmp.name,
                value_chain=value_chain,
                area_ha=area_ha,
                currency=currency,
            )
        except NeedsSheetParseError as exc:
            return Response({"detail": str(exc), "code": "PARSE_ERROR"}, status=422)
        except Exception as exc:
            return Response({"detail": f"Erreur de traitement : {exc}"}, status=500)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    # Persister en base
    sub = getattr(request.user, "sub", "") or ""
    needs_sheet_id = _persist_needs_sheet(
        file=file,
        result=result,
        value_chain=value_chain,
        area_ha=area_ha,
        currency=currency,
        uploaded_by=sub,
    )

    # Analyse documentaire (Partie H) — silencieuse, ne bloque pas la réponse
    analysis_summary = {}
    if needs_sheet_id:
        try:
            from credits.analysis import run_analysis
            analysis_summary = run_analysis(
                needs_sheet_id=needs_sheet_id,
                value_chain=value_chain,
                area_ha=area_ha,
                currency=currency,
            )
        except Exception:
            pass

    return Response(
        {
            "ok": result["ok"],
            "needsSheetId": needs_sheet_id,
            "grandTotal": result["grandTotal"],
            "totalByModule": result["totalByModule"],
            "warnings": result["warnings"],
            "anomalies": result["anomalies"],
            "items": result["items"],
            "analysis": analysis_summary or None,
        },
        status=201,
    )


def _persist_needs_sheet(
    file, result: dict, value_chain, area_ha, currency: str, uploaded_by: str
) -> int | None:
    """Crée un NeedsSheet + ses NeedItem en base."""
    try:
        from credits.models import NeedsSheet, NeedItem
        import decimal

        ns = NeedsSheet.objects.create(
            uploaded_by=uploaded_by,
            raw_file=file,
            value_chain=value_chain,
            area_ha=area_ha,
            currency=currency,
            parsed_ok=result["ok"],
            warnings=result["warnings"],
            anomalies=result["anomalies"],
            total_by_module=result["totalByModule"],
            grand_total=decimal.Decimal(str(result["grandTotal"])),
        )

        NeedItem.objects.bulk_create([
            NeedItem(
                sheet=ns,
                module=item["module"],
                label=item["label"],
                quantity=decimal.Decimal(item["quantity"]) if item.get("quantity") else None,
                unit=item.get("unit", ""),
                unit_price=decimal.Decimal(item["unit_price"]) if item.get("unit_price") else None,
                declared_total=decimal.Decimal(item["declared_total"]) if item.get("declared_total") else None,
                computed_total=decimal.Decimal(item["computed_total"]) if item.get("computed_total") else None,
                suggested_supplier=item.get("suggested_supplier", ""),
                supplier_warning=item.get("supplier_warning", ""),
            )
            for item in result.get("items", [])
        ])

        return ns.pk
    except Exception:
        return None


def _ingest_needs_sheet(request: Request, file, application_code: str) -> Response:
    """Validation + ingestion dataio de la feuille de besoins d'un dossier.

    Le dossier doit être en `draft` : après soumission, la base de calcul est figée
    (une révision de plus changerait rétroactivement ce qui a été instruit).
    """
    from credits.models import CreditApplication
    from credits.needs_sheet import NeedsSheetValidationError, parse_and_ingest

    app = CreditApplication.objects.filter(code=application_code).first()
    if app is None:
        return Response({"detail": "Dossier introuvable."}, status=404)

    requester_sub: str = getattr(request.user, "sub", "") or ""
    if app.client.sub != requester_sub and not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Accès interdit à ce dossier."}, status=403)

    if app.status != CreditApplication.Status.DRAFT:
        return Response(
            {"detail": (f"Le dossier {app.code} n'est plus modifiable "
                        f"(statut « {app.get_status_display()} »)."),
             "errors": [{"code": "APPLICATION_NOT_DRAFT",
                         "message": "La feuille de besoins ne peut être remplacée "
                                    "qu'en brouillon."}]},
            status=409,
        )

    try:
        result = parse_and_ingest(file, app, uploaded_by=requester_sub)
    except NeedsSheetValidationError as exc:
        return Response({"errors": exc.errors}, status=422)

    return Response(
        {
            "ok": True,
            "applicationCode": app.code,
            "needsSourceId": result["needs_source_id"],
            "revision": result["revision"],
            "sha256": result["sha256"],
            "totalByModule": result["totals"],
            "grandTotal": result["grand_total"],
        },
        status=201,
    )


# ── 3. Modèle Excel (template) ───────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([])
def download_needs_sheet_template(request: Request) -> HttpResponse:
    """ 
    GET /api/credits/needs-sheet-template/?value_chain_code=<code>

    Endpoint public — retourne le gabarit Excel AGRICAP (pas de données sensibles).
    Sert le fichier statique embarqué ; le code filière est ajouté au nom du fichier.
    """
    import os

    static_path = os.path.join(
        os.path.dirname(__file__), "static", "credits", "feuille_besoins_template.xlsx",
    )

    value_chain_code: str = request.query_params.get("value_chain_code", "")

    if os.path.exists(static_path):
        with open(static_path, "rb") as f:
            xlsx_bytes = f.read()
    else:
        # Fallback : génération dynamique si le fichier statique est absent
        value_chain = None
        if value_chain_code:
            try:
                from reference_data.models import ValueChain
                value_chain = ValueChain.objects.get(code=value_chain_code, active=True)
            except Exception:
                pass
        xlsx_bytes = generate_needs_sheet_template(value_chain=value_chain)

    vc_slug = value_chain_code.lower() if value_chain_code else "generic"
    filename = f"AGRICAP_Feuille_Besoins_{vc_slug}.xlsx"

    response = HttpResponse(
        xlsx_bytes,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Access-Control-Allow-Origin"] = "*"
    return response


# ── 4. Simulation scoring ────────────────────────────────────────────────────

@api_view(["POST"])
def simulate_scoring(request: Request) -> Response:
    """
    POST /api/credits/simulate/

    Simule le scoring et le plan de remboursement sans créer de dossier en base.

    Corps JSON :
      application_code   (str, optionnel) — mode SPEC : les montants par module sont
                         LUS dans les DataRecord de `application.needs_source`. Tout
                         `ns_totals` du payload est alors ignoré (principe 1).
      client_sub         (str, requis si pas d'application_code)
      value_chain_code   (str, optionnel)
      needs_sheet_id     (int, optionnel) — legacy, NeedsSheet déjà parsée
      area_ha            (float, optionnel)
      amount_requested   (float, optionnel)
      currency           (str, "USD"|"CDF", défaut "USD")
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    data = request.data
    if (application_code := (data.get("application_code") or "").strip()):
        return _simulate_from_source(request, application_code, data)

    client_sub: str = data.get("client_sub", "")
    requester_sub: str = getattr(request.user, "sub", "") or ""

    if not client_sub:
        client_sub = requester_sub
    if not client_sub:
        return Response({"detail": "client_sub requis."}, status=400)

    # Agent simulant pour un tiers → permission agent
    if client_sub != requester_sub and not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission 'agent' requise."}, status=403)

    value_chain_code: str = data.get("value_chain_code", "")
    needs_sheet_id = data.get("needs_sheet_id")
    currency: str = data.get("currency", "USD").upper()
    # ns_totals envoyé directement par le frontend (nsResult.totalByModule)
    ns_totals_raw = data.get("ns_totals") or {}
    ns_totals = {k: float(v) for k, v in ns_totals_raw.items() if v} if isinstance(ns_totals_raw, dict) else {}

    try:
        area_ha = float(data["area_ha"]) if data.get("area_ha") else None
    except (ValueError, TypeError):
        return Response({"detail": "area_ha invalide."}, status=400)

    try:
        amount_requested = float(data["amount_requested"]) if data.get("amount_requested") else None
    except (ValueError, TypeError):
        return Response({"detail": "amount_requested invalide."}, status=400)

    # Charger le client et la feuille de besoins depuis la base
    from accounts.models import FintechUser
    from credits.models import NeedsSheet

    try:
        client = FintechUser.objects.select_related("kyc_profile").get(sub=client_sub)
    except FintechUser.DoesNotExist:
        return Response({"detail": "Client introuvable.", "code": "CLIENT_NOT_FOUND"}, status=404)

    needs_sheet = None
    if needs_sheet_id:
        try:
            needs_sheet = NeedsSheet.objects.get(pk=int(needs_sheet_id), uploaded_by=client_sub)
            # Si pas de ns_totals du frontend, utiliser ceux de la feuille
            if not ns_totals and needs_sheet.total_by_module:
                ns_totals = {k: float(v) for k, v in needs_sheet.total_by_module.items()}
        except NeedsSheet.DoesNotExist:
            pass

    result = dataio_simulate(
        client=client,
        value_chain_code=value_chain_code or None,
        needs_sheet=needs_sheet,
        ns_totals=ns_totals or None,
        area_ha=area_ha,
        amount_requested=amount_requested,
        currency=currency,
        guarantees_data=None,
    )

    if "error" in result:
        return Response({"detail": result["error"]}, status=400)

    return Response(result)


def _load_needs_totals(app):
    """(totaux par module en float, lignage) depuis la révision courante en base.

    Retourne `(None, {})` si le dossier n'a pas encore de feuille ingérée : c'est
    au appelant de refuser — on ne calcule jamais un score sur des montants absents
    ou fournis par le client.
    """
    from credits.needs_sheet import extract_module_totals, needs_source_lineage

    source = app.needs_source
    if source is None:
        return None, {}
    totals = extract_module_totals(source)
    return {k: float(v) for k, v in totals.items()}, needs_source_lineage(source)


def _simulate_from_source(request: Request, application_code: str, data) -> Response:
    """Simulation adossée aux tables du dossier — aucun montant n'est accepté du client."""
    from credits.models import CreditApplication

    app = (CreditApplication.objects
           .select_related("client__kyc_profile", "value_chain", "needs_source")
           .filter(code=application_code).first())
    if app is None:
        return Response({"detail": "Dossier introuvable."}, status=404)

    vcs = _vcs(request)
    if not vcs.can_read_app(app):
        return Response({"detail": "Accès interdit."}, status=403)

    ns_totals, lineage = _load_needs_totals(app)
    if ns_totals is None:
        return Response(
            {"errors": [{
                "code": "NEEDS_SOURCE_MISSING",
                "message": (f"Le dossier {app.code} n'a pas de feuille de besoins ingérée. "
                            f"Téléversez-la via POST /api/credits/needs-sheet/parse/ "
                            f"avec application_code={app.code}."),
            }]},
            status=422,
        )

    currency: str = (data.get("currency") or app.currency or "USD").upper()
    result = dataio_simulate(
        client=app.client,
        value_chain_code=app.value_chain.code if app.value_chain else None,
        needs_sheet=None,
        ns_totals=ns_totals,
        area_ha=float(app.area_ha) if app.area_ha else None,
        amount_requested=float(app.amount_requested) if app.amount_requested else None,
        currency=currency,
        guarantees_data=None,
    )
    if "error" in result:
        return Response({"detail": result["error"]}, status=400)

    result["needsSource"] = lineage
    return Response(result)


# ── 5. Re-scoring d'un dossier existant ───────────────────────────────────────

@api_view(["POST"])
def score_application(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/score/

    Calcule (ou recalcule) le score d'un dossier existant et le persiste dans score_result.
    Réservé au staff (permission 'analyst' ou 'agent').

    Les montants par module sont relus dans les `DataRecord` de la révision courante
    de la feuille de besoins ; le rapport conserve `needs_source_id + revision +
    sha256` — une analyse est rejouable à l'identique des mois plus tard.
    """
    if not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission refusée."}, status=403)

    from credits.models import CreditApplication
    from credits.scoring import CreditScoringEngine

    try:
        app = CreditApplication.objects.select_related(
            "client__kyc_profile", "value_chain", "needs_sheet", "needs_source"
        ).get(code=code)
    except CreditApplication.DoesNotExist:
        return Response({"detail": "Dossier introuvable."}, status=404)

    needs_totals, lineage = _load_needs_totals(app)

    engine = CreditScoringEngine(app, needs_totals=needs_totals)
    result = engine.compute()
    result["needsSource"] = lineage
    result["needsTotals"] = needs_totals or {}

    app.score_result = result
    app.save(update_fields=["score_result", "updated_at"])

    return Response(result)


# ── Dossiers : liste et détail ────────────────────────────────────────────────

@api_view(["GET", "POST"])
def list_applications(request: Request) -> Response:
    """
    GET  /api/credits/applications/           → liste (filtrée par rôle)
    POST /api/credits/applications/           → crée un dossier DRAFT
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    from credits.models import CreditApplication
    from credits.workflow import serialize_application

    vcs = _vcs(request)
    qs = CreditApplication.objects.select_related(
        "client__kyc_profile", "value_chain", "needs_sheet"
    ).prefetch_related("guarantees")

    qs = vcs.filter_qs(qs)

    # Filtres query params
    if status_filter := request.query_params.get("status"):
        qs = qs.filter(status=status_filter)
    if client_sub := request.query_params.get("client_sub"):
        if vcs.is_staff:
            qs = qs.filter(client__sub=client_sub)
    if vc_code := request.query_params.get("value_chain_code"):
        qs = qs.filter(value_chain__code=vc_code)

    if request.method == "POST":
        return _create_application(request)

    apps = qs.order_by("-created_at")[:100]
    return Response([vcs.serialize_for_role(a) for a in apps])


def _create_application(request: Request) -> Response:
    """
    POST /api/credits/applications/
    Crée un dossier de crédit en DRAFT.

    Corps JSON :
      client_sub          (str, optionnel — sinon = requester_sub)
      value_chain_code    (str, optionnel)
      area_ha             (float, optionnel)
      currency            (str, défaut USD)
      amount_requested    (float, requis)
      needs_sheet_id      (int, optionnel)
      guarantee_type      (str, optionnel: epargne|morale)
    """
    from credits.models import CreditApplication, NeedsSheet
    from accounts.models import FintechUser
    from reference_data.models import ValueChain

    data = request.data
    requester_sub: str = getattr(request.user, "sub", "") or ""
    client_sub: str = data.get("client_sub") or requester_sub

    if not client_sub:
        return Response({"detail": "client_sub est requis."}, status=400)

    # Seul un agent peut créer pour un tiers
    if client_sub != requester_sub and not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission 'agent' requise."}, status=403)

    try:
        client = FintechUser.objects.get(sub=client_sub)
    except FintechUser.DoesNotExist:
        return Response({"detail": "Client introuvable.", "code": "CLIENT_NOT_FOUND"}, status=404)

    try:
        amount_requested = float(data.get("amount_requested", 0) or 0)
    except (ValueError, TypeError):
        return Response({"detail": "amount_requested invalide."}, status=400)

    if amount_requested <= 0:
        return Response({"detail": "Le montant demandé doit être positif."}, status=400)

    # Filière
    vc = None
    if vc_code := data.get("value_chain_code"):
        try:
            vc = ValueChain.objects.get(code=vc_code, active=True)
        except ValueChain.DoesNotExist:
            return Response({"detail": f"Filière '{vc_code}' introuvable."}, status=404)

    # Feuille de besoins
    ns = None
    if ns_id := data.get("needs_sheet_id"):
        try:
            ns = NeedsSheet.objects.get(pk=int(ns_id))
        except (NeedsSheet.DoesNotExist, ValueError):
            return Response({"detail": "Feuille de besoins introuvable."}, status=404)

    area_ha = None
    if raw_area := data.get("area_ha"):
        try:
            area_ha = float(raw_area)
        except (ValueError, TypeError):
            pass

    guarantee_type = data.get("guarantee_type") or ""

    # Génération du code automatique
    from datetime import date
    import random, string
    today = date.today()
    suffix = ''.join(random.choices(string.digits, k=4))
    code = f"CRED-{today.strftime('%Y%m%d')}-{suffix}"
    while CreditApplication.objects.filter(code=code).exists():
        suffix = ''.join(random.choices(string.digits, k=4))
        code = f"CRED-{today.strftime('%Y%m%d')}-{suffix}"

    app = CreditApplication.objects.create(
        code=code,
        client=client,
        initiated_by_sub=requester_sub,
        value_chain=vc,
        area_ha=area_ha,
        currency=(data.get("currency") or "USD").upper(),
        amount_requested=amount_requested,
        needs_sheet=ns,
        guarantee_type=guarantee_type if guarantee_type in ("epargne", "morale") else "",
        status=CreditApplication.Status.DRAFT,
        prefill_snapshot=data.get("prefill_snapshot") or {},
    )

    from credits.workflow import serialize_application
    vcs = _vcs(request)
    return Response(vcs.serialize_for_role(app), status=201)


@api_view(["GET"])
def application_detail(request: Request, code: str) -> Response:
    """GET /api/credits/applications/<code>/"""
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    from credits.models import CreditApplication
    from credits.workflow import serialize_application

    try:
        app = CreditApplication.objects.select_related(
            "client__kyc_profile", "value_chain", "needs_sheet"
        ).prefetch_related("guarantees").get(code=code)
    except CreditApplication.DoesNotExist:
        return Response({"detail": "Dossier introuvable."}, status=404)

    vcs = _vcs(request)
    if not vcs.can_read_app(app):
        return Response({"detail": "Accès interdit."}, status=403)

    return Response(vcs.serialize_for_role(app))


# ── Workflow ──────────────────────────────────────────────────────────────────

def _load_app(code: str, select_related: list[str] | None = None):
    from credits.models import CreditApplication
    qs = CreditApplication.objects.select_related(
        "client__kyc_profile", "value_chain", "needs_sheet",
        *(select_related or [])
    )
    try:
        return qs.get(code=code)
    except CreditApplication.DoesNotExist:
        return None


@api_view(["POST"])
def submit_application(request: Request, code: str) -> Response:
    """POST /api/credits/applications/<code>/submit/"""
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    sub = getattr(request.user, "sub", "") or ""
    is_owner = str(app.client.sub) == sub
    is_agent = in_group(request, CAN_INSTRUCT)

    if not (is_owner or is_agent):
        return Response({"detail": "Accès interdit."}, status=403)

    from credits.workflow import submit, WorkflowError
    try:
        submit(app, submitter_sub=sub)
    except WorkflowError as exc:
        # Statut porté par la règle : 409 pour un dossier déjà soumis (conflit
        # d'état), 422 pour un dossier incomplet (principe 5).
        return _workflow_error(exc)

    from credits.workflow import serialize_application
    return Response(serialize_application(app))


@api_view(["POST"])
def start_analysis(request: Request, code: str) -> Response:
    """POST /api/credits/applications/<code>/start-analysis/"""
    if not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    from credits.workflow import start_analysis as _start, WorkflowError
    try:
        _start(app, analyst_sub=getattr(request.user, "sub", "") or "")
    except WorkflowError as exc:
        return _workflow_error(exc)

    from credits.workflow import serialize_application
    return Response(serialize_application(app))


@api_view(["POST"])
def approve_application(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/approve/
    Corps JSON : { amount_approved, comment? }
    """
    if not _require_group(request, CAN_DECIDE):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    data = request.data
    if not data.get("amount_approved"):
        return Response({"detail": "amount_approved requis."}, status=400)

    import decimal
    try:
        amount = decimal.Decimal(str(data["amount_approved"]))
    except Exception:
        return Response({"detail": "amount_approved invalide."}, status=400)

    roles = _roles(request)
    from credits.workflow import approve, WorkflowError
    try:
        approve(
            app,
            approver_sub=getattr(request.user, "sub", "") or "",
            amount_approved=amount,
            comment=data.get("comment", ""),
            approver_roles=roles,
        )
    except WorkflowError as exc:
        return _workflow_error(exc)

    from credits.workflow import serialize_application
    return Response(serialize_application(app))


@api_view(["POST"])
def reject_application(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/reject/
    Corps JSON : { reason_code, comment? }
    """
    if not _require_group(request, CAN_DECIDE):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    data = request.data
    if not data.get("reason_code"):
        return Response({"detail": "reason_code requis."}, status=400)

    from credits.workflow import reject, WorkflowError
    try:
        result = reject(
            app,
            rejector_sub=getattr(request.user, "sub", "") or "",
            reason_code=data["reason_code"],
            comment=data.get("comment", ""),
        )
    except WorkflowError as exc:
        return _workflow_error(exc)

    return Response(result)


@api_view(["POST"])
def adjourn_application(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/adjourn/
    Corps JSON : { comment }
    """
    if not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    comment = request.data.get("comment", "")
    from credits.workflow import adjourn, WorkflowError
    try:
        adjourn(app, approver_sub=getattr(request.user, "sub", "") or "", comment=comment)
    except WorkflowError as exc:
        return _workflow_error(exc)

    from credits.workflow import serialize_application
    return Response(serialize_application(app))


@api_view(["POST"])
def reopen_analysis(request: Request, code: str) -> Response:
    """POST /api/credits/applications/<code>/reopen-analysis/"""
    if not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    from credits.workflow import reopen_analysis as _reopen, WorkflowError
    try:
        _reopen(app, analyst_sub=getattr(request.user, "sub", "") or "")
    except WorkflowError as exc:
        return _workflow_error(exc)

    from credits.workflow import serialize_application
    return Response(serialize_application(app))


@api_view(["POST"])
def client_consent(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/client-consent/
    Corps JSON : { method? } — "app" | "sms" | "ussd"
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    sub = getattr(request.user, "sub", "") or ""
    method = request.data.get("method", "app")

    from credits.workflow import record_client_consent, WorkflowError
    try:
        record_client_consent(app, client_sub=sub, method=method)
    except WorkflowError as exc:
        return _workflow_error(exc)

    from credits.workflow import serialize_application
    return Response(serialize_application(app))


# ── Garanties ─────────────────────────────────────────────────────────────────

def _get_application(code: str):
    from credits.models import CreditApplication
    try:
        return CreditApplication.objects.select_related("client__kyc_profile").get(code=code)
    except CreditApplication.DoesNotExist:
        return None


@api_view(["GET"])
def list_guarantees(request: Request, code: str) -> Response:
    """GET /api/credits/applications/<code>/guarantees/"""
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)
    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)
    from credits.guarantees import get_guarantee_summary
    return Response(get_guarantee_summary(app))


@api_view(["POST"])
def place_savings_guarantee(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/guarantees/savings/

    Corps JSON : { savings_plan_id, amount, notes? }
    """
    if not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission refusée."}, status=403)
    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    data = request.data
    savings_plan_id = data.get("savings_plan_id")
    amount_raw = data.get("amount")
    if not savings_plan_id or not amount_raw:
        return Response({"detail": "savings_plan_id et amount sont requis."}, status=400)

    import decimal
    try:
        amount = decimal.Decimal(str(amount_raw))
        if amount <= 0:
            raise ValueError
    except Exception:
        return Response({"detail": "amount invalide (doit être > 0)."}, status=400)

    from credits.guarantees import (
        place_savings_hold, InsufficientSavingsError, GuaranteeError
    )
    try:
        place_savings_hold(
            application=app,
            savings_plan_id=int(savings_plan_id),
            amount=amount,
            registered_by_sub=getattr(request.user, "sub", "") or "",
            notes=data.get("notes", ""),
        )
    except InsufficientSavingsError as exc:
        return Response({"detail": str(exc), "code": "INSUFFICIENT_BALANCE",
                         "errors": [{"code": "INSUFFICIENT_BALANCE", "message": str(exc)}]}, status=422)
    except GuaranteeError as exc:
        return Response({"detail": str(exc), "code": exc.code,
                         "errors": [{"code": exc.code, "message": str(exc)}]}, status=400)

    from credits.guarantees import get_guarantee_summary
    return Response(get_guarantee_summary(app), status=201)


@api_view(["POST"])
def register_moral_guarantee(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/guarantees/moral/

    Corps JSON :
      guarantor_sub                (sub du garant — REQUIS, il doit pouvoir consentir)
      guarantor_name, guarantor_phone, guarantor_id_number
      montant_couvert?             (défaut : le montant du dossier)
      notes?

    Les permissions de cet endpoint sont INCHANGÉES (`CAN_INSTRUCT`) : qui, du
    client ou de l'agent, désigne le garant est une décision de gouvernance qui
    n'appartient pas au backend — cf. le rapport de lot. Le mécanisme fonctionne
    des deux côtés ; seul ce garde-fou tranche aujourd'hui.
    """
    if not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission refusée."}, status=403)
    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    data = request.data
    required = ["guarantor_name", "guarantor_phone", "guarantor_id_number"]
    missing = [f for f in required if not (data.get(f) or "").strip()]
    if missing:
        return Response({"detail": f"Champs requis : {', '.join(missing)}."}, status=400)

    montant_raw = data.get("montant_couvert")
    montant = None
    if montant_raw is not None:
        import decimal
        try:
            montant = decimal.Decimal(str(montant_raw))
        except Exception:
            return Response({"detail": "montant_couvert invalide."}, status=400)

    from credits.guarantees import register_moral_guarantee as _register, GuaranteeError
    from credits.guarantor import GuarantorError

    try:
        _register(
            application=app,
            guarantor_name=data["guarantor_name"],
            guarantor_phone=data["guarantor_phone"],
            guarantor_id_number=data["guarantor_id_number"],
            registered_by_sub=getattr(request.user, "sub", "") or "",
            guarantor_sub=data.get("guarantor_sub", ""),
            montant_couvert=montant,
            notes=data.get("notes", ""),
        )
    except GuarantorError as exc:
        # Chaque règle de capacité porte son code et son statut (cf.
        # `credits.guarantor`) : le front guide le client au lieu d'afficher
        # « erreur », et une reformulation de message ne casse rien.
        return Response(
            {"detail": str(exc), "code": exc.code, "errors": exc.as_errors()},
            status=exc.http_status,
        )
    except GuaranteeError as exc:
        return Response(
            {"detail": str(exc), "code": exc.code,
             "errors": [{"code": exc.code, "message": str(exc)}]},
            status=422,
        )

    from credits.guarantees import get_guarantee_summary
    return Response(get_guarantee_summary(app), status=201)


# ── Demandes de caution du garant (SPEC §2.5) ─────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_guarantee_requests(request: Request) -> Response:
    """GET /api/credits/guarantee-requests/

    Les demandes de caution dont l'utilisateur connecté est le garant désigné.
    Aucun rôle n'élargit ce périmètre : la liste est celle de SES engagements.

    Les demandes expirées, consenties et refusées sont servies avec les autres —
    le front doit pouvoir afficher « expirée » sans l'inférer d'une date passée
    (aucun chiffre ni statut métier calculé côté client).
    """
    from credits.guarantees import guarantee_requests_for, serialize_guarantee_request
    from credits.guarantor import consent_window_hours

    status_filter = request.query_params.get("status", "")
    requests_qs = guarantee_requests_for(request.user, status=status_filter)
    items = [serialize_guarantee_request(g) for g in requests_qs]

    return Response({
        "total_rows": len(items),
        # Fenêtre CONFIGURÉE, jamais une constante : le front décompte dessus et
        # n'écrit « 72 h » nulle part (principe 8 jusque dans l'affichage).
        "consent_window_hours": consent_window_hours(),
        "items": items,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsDesignatedGuarantor])
def consent_guarantee_request(request: Request, guarantee_id: int) -> Response:
    """POST /api/credits/guarantee-requests/<id>/consent/  {"accept": bool}

    L'acte par lequel une caution devient opposable. La permission
    `IsDesignatedGuarantor` est déclarative et s'exécute avant ce corps : le
    contrôle d'identité ne dépend pas de l'ordre des `return` ci-dessous.
    """
    from credits.guarantees import record_guarantor_consent, serialize_guarantee_request
    from credits.guarantor import GuarantorError, GuarantorNotDesignated
    from credits.models import CreditGuarantee

    accept = (request.data or {}).get("accept")
    if not isinstance(accept, bool):
        return Response(
            {"detail": "Le champ `accept` est requis et doit valoir true ou false.",
             "code": "ACCEPT_REQUIRED",
             "errors": [{"code": "ACCEPT_REQUIRED",
                         "message": "Réponse attendue : accepter ou refuser."}]},
            status=400,
        )

    guarantee = (
        CreditGuarantee.objects
        .select_related("application__client", "application__value_chain", "guarantor")
        .filter(pk=guarantee_id,
                guarantee_type=CreditGuarantee.GuaranteeType.MORALE)
        .first()
    )
    if guarantee is None:
        return Response({"detail": "Demande de caution introuvable."}, status=404)

    try:
        record_guarantor_consent(
            guarantee,
            responder_sub=str(getattr(request.user, "pk", "")),
            accept=accept,
            channel="app",
            ip=_client_ip(request),
        )
    except GuarantorError as exc:
        # `code` et statut HTTP viennent de la règle, jamais de la vue —
        # même discipline que `_workflow_error`.
        return Response(
            {"detail": str(exc), "code": exc.code, "errors": exc.as_errors()},
            status=exc.http_status,
        )

    guarantee.refresh_from_db()
    return Response({
        "detail": "Consentement enregistré." if accept else "Refus enregistré.",
        "item": serialize_guarantee_request(guarantee),
    })


def _client_ip(request: Request) -> str | None:
    """IP d'origine, journalisée dans `consent_meta` comme preuve d'origine.

    `X-Forwarded-For` est renseigné par le reverse proxy du VPS ; on prend la
    première entrée (le client), pas la dernière (le proxy).
    """
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.META.get("REMOTE_ADDR") or None


@api_view(["POST"])
def confirm_guarantee(request: Request, code: str, guarantee_id: int) -> Response:
    """
    POST /api/credits/applications/<code>/guarantees/<id>/confirm/

    Confirmation par le garant (ou un agent avec preuve physique).
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)
    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    from credits.models import CreditGuarantee
    try:
        guarantee = CreditGuarantee.objects.get(pk=guarantee_id, application=app)
    except CreditGuarantee.DoesNotExist:
        return Response({"detail": "Garantie introuvable."}, status=404)

    from credits.guarantees import (
        GuaranteeError, confirm_asset_guarantee, confirm_moral_guarantee,
    )
    from credits.guarantor import GuarantorError

    confirmer = getattr(request.user, "sub", "") or ""
    try:
        if guarantee.guarantee_type in CreditGuarantee.ASSET_BACKED_TYPES:
            # Le gage effectif de l'actif est posé ici, sous verrou atomique —
            # réservé au staff : un client ne nantit pas son propre actif.
            if not _require_group(request, CAN_INSTRUCT):
                return Response(
                    {"detail": "La confirmation d'un gage est réservée aux agents."},
                    status=403,
                )
            confirm_asset_guarantee(guarantee, confirmer_sub=confirmer)
        else:
            confirm_moral_guarantee(guarantee, confirmer_sub=confirmer)
    except GuarantorError as exc:
        return Response(
            {"detail": str(exc), "code": exc.code, "errors": exc.as_errors()},
            status=exc.http_status,
        )
    except GuaranteeError as exc:
        return Response({"detail": str(exc)}, status=400)

    from credits.guarantees import get_guarantee_summary
    return Response(get_guarantee_summary(app))


@api_view(["POST"])
def place_asset_guarantee_view(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/guarantees/asset/
    Corps JSON : { asset_id }

    Propose un actif vérifié du client en garantie. L'actif n'est effectivement
    nanti qu'à la confirmation par un agent.
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)
    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    # Le propriétaire du dossier ou un agent qui l'instruit
    sub = getattr(request.user, "sub", "") or ""
    if str(app.client.sub) != sub and not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission refusée."}, status=403)

    asset_id = (request.data or {}).get("asset_id")
    if not asset_id:
        return Response({"detail": "asset_id requis."}, status=400)

    from credits.guarantees import GuaranteeError, place_asset_guarantee

    try:
        place_asset_guarantee(app, asset_id=int(asset_id), registered_by_sub=sub)
    except GuaranteeError as exc:
        # Chaque règle porte son propre code (cf. `credits.guarantees`) : le front
        # branche sur `code`, jamais sur la formulation de `detail`.
        return Response(
            {"detail": str(exc), "code": exc.code,
             "errors": [{"code": exc.code, "message": str(exc)}]},
            status=422,
        )
    except (TypeError, ValueError):
        return Response({"detail": "asset_id invalide."}, status=400)

    from credits.guarantees import get_guarantee_summary
    return Response(get_guarantee_summary(app), status=201)


@api_view(["POST"])
def release_guarantee(request: Request, code: str, guarantee_id: int) -> Response:
    """
    POST /api/credits/applications/<code>/guarantees/<id>/release/

    Libère une garantie épargne (rejet ou annulation du dossier).
    Réservé aux agents.
    """
    if not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Permission refusée."}, status=403)
    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    from credits.models import CreditGuarantee
    try:
        guarantee = CreditGuarantee.objects.get(pk=guarantee_id, application=app)
    except CreditGuarantee.DoesNotExist:
        return Response({"detail": "Garantie introuvable."}, status=404)

    from credits.guarantees import _do_release, release_savings_hold, GuaranteeError
    if guarantee.guarantee_type == CreditGuarantee.GuaranteeType.EPARGNE:
        try:
            release_savings_hold(guarantee)
        except GuaranteeError as exc:
            return Response({"detail": str(exc)}, status=400)
    else:
        # Passe par `_do_release` : une écriture directe de `status` laissait
        # l'actif sous-jacent nanti indéfiniment, donc ingageable ailleurs.
        _do_release(guarantee)

    from credits.guarantees import get_guarantee_summary
    return Response(get_guarantee_summary(app))


# ── Décaissement (Étape 6) ────────────────────────────────────────────────────

@api_view(["GET"])
def disbursement_detail(request: Request, code: str) -> Response:
    """GET /api/credits/applications/<code>/disbursement/"""
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)
    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)
    from credits.disbursement import serialize_disbursement
    data = serialize_disbursement(app)
    if data is None:
        return Response({"detail": "Aucune demande de décaissement pour ce dossier."}, status=404)
    return Response(data)


@api_view(["POST"])
def request_disbursement_view(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/disbursement/request/
    Transition : APPROVED → PENDING_DISBURSEMENT (maker)
    """
    if not _require_group(request, CAN_REQUEST_DISBURSEMENT):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    from credits.disbursement import request_disbursement as _request, DisbursementError
    from credits.workflow import WorkflowError
    try:
        _request(
            app,
            requester_sub=getattr(request.user, "sub", "") or "",
            notes=request.data.get("notes", ""),
        )
    except (DisbursementError, WorkflowError) as exc:
        return _workflow_error(exc)

    from credits.workflow import serialize_application
    return Response(serialize_application(app), status=201)


@api_view(["POST"])
def confirm_disbursement_view(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/disbursement/confirm/
    Transition : PENDING_DISBURSEMENT → ACTIVE (checker, maker≠checker)
    """
    if not _require_group(request, CAN_CONFIRM_DISBURSEMENT):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    from credits.disbursement import confirm_disbursement as _confirm, DisbursementError
    from credits.workflow import WorkflowError
    try:
        result = _confirm(app, confirmer_sub=getattr(request.user, "sub", "") or "")
    except DisbursementError as exc:
        return _workflow_error(exc)
    except WorkflowError as exc:
        return _workflow_error(exc)

    return Response(result)


@api_view(["POST"])
def cancel_disbursement_view(request: Request, code: str) -> Response:
    """
    POST /api/credits/applications/<code>/disbursement/cancel/
    Annule la demande PENDING (retour à APPROVED).
    """
    if not _require_group(request, CAN_REQUEST_DISBURSEMENT):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _load_app(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    from credits.disbursement import cancel_disbursement_request, DisbursementError
    from credits.workflow import WorkflowError
    try:
        cancel_disbursement_request(app, cancelled_by_sub=getattr(request.user, "sub", "") or "")
    except (DisbursementError, WorkflowError) as exc:
        return _workflow_error(exc)

    from credits.workflow import serialize_application
    return Response(serialize_application(app))


# ── Tableau de bord — Étape 7 ─────────────────────────────────────────────────

@api_view(["GET"])
def credits_dashboard(request: Request) -> Response:
    """
    GET /api/credits/dashboard/

    Retourne des KPIs adaptés au rôle du demandeur.
    Chaque rôle reçoit une vue agrégée différente.
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    from credits.dashboard import get_dashboard

    sub: str = getattr(request.user, "sub", "") or ""
    roles: set[str] = set(_roles(request))
    view: str = request.query_params.get("view", "")

    try:
        return Response(get_dashboard(sub=sub, roles=roles, view=view))
    except PermissionError as exc:
        return Response({"detail": str(exc)}, status=403)


# ── Partie H : Rapport d'analyse documentaire ────────────────────────────────

@api_view(["GET", "POST"])
def analysis_report(request: Request, code: str) -> Response:
    """
    GET  /api/credits/applications/<code>/analysis-report/
         → Rapport d'analyse complet (findings, module summaries, chaîne de preuve).

    POST /api/credits/applications/<code>/analysis-report/
         → Décision analyste sur un finding : {finding_id, status, comment}
           status : justifie | corrige | confirme_anomalie
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    try:
        from credits.models import CreditApplication
        app = CreditApplication.objects.get(code=code)
    except CreditApplication.DoesNotExist:
        return Response({"detail": "Dossier introuvable."}, status=404)

    # Étanchéité : un client ne voit que son propre dossier
    sub = getattr(request.user, "sub", "") or ""
    if not in_group(request, STAFF_ROLES) and app.client.sub != sub:
        return Response({"detail": "Dossier introuvable."}, status=404)

    ns = app.needs_sheet
    if ns is None:
        return Response({"detail": "Aucune feuille de besoins attachée à ce dossier."}, status=404)

    if request.method == "GET":
        from credits.analysis import serialize_analysis_report
        return Response(serialize_analysis_report(ns))

    # POST : décision analyste sur un finding
    # Ancienne garde : role in ("analyste", "admin", "superviseur") — trois libellés
    # français qui n'existaient dans aucun registre, donc seul "admin" passait.
    if not _require_group(request, CAN_INSTRUCT):
        return Response({"detail": "Seul un analyste peut mettre à jour un finding."}, status=403)

    data = request.data
    finding_id = data.get("finding_id")
    new_status = data.get("status", "").strip()
    comment = data.get("comment", "").strip()

    VALID_STATUSES = {"justifie", "corrige", "confirme_anomalie"}
    if new_status not in VALID_STATUSES:
        return Response(
            {"detail": f"status invalide. Valeurs acceptées : {', '.join(sorted(VALID_STATUSES))}."},
            status=400,
        )
    if new_status == "justifie" and len(comment) < 10:
        return Response(
            {"detail": "Un commentaire d'au moins 10 caractères est requis pour justifier un finding."},
            status=400,
        )

    try:
        import datetime
        from credits.models import LineFinding
        finding = LineFinding.objects.get(pk=finding_id, needs_sheet=ns)
        finding.analyst_status = new_status
        finding.analyst_comment = comment
        finding.analyst_updated_at = datetime.datetime.now(datetime.timezone.utc)
        finding.save(update_fields=["analyst_status", "analyst_comment", "analyst_updated_at"])
    except LineFinding.DoesNotExist:
        return Response({"detail": "Finding introuvable."}, status=404)

    # Recompute document_confidence after analyst override (justifié retire la pénalité)
    _recompute_confidence_after_override(ns)

    from credits.analysis import serialize_analysis_report
    return Response(serialize_analysis_report(ns))


def _recompute_confidence_after_override(ns) -> None:
    """Recalcule document_confidence en excluant les findings justifiés/corrigés."""
    from credits.models import LineFinding
    _SEV_WEIGHT = {"bloquant": 20, "anomalie": 8, "a_justifier": 3, "info": 0, "point_fort": 0}
    active_findings = LineFinding.objects.filter(
        needs_sheet=ns,
    ).exclude(analyst_status__in=("justifie", "corrige"))
    penalty = sum(_SEV_WEIGHT.get(f.severity, 0) for f in active_findings)
    ns.document_confidence = max(0.0, min(100.0, 100.0 - penalty))
    ns.save(update_fields=["document_confidence"])


# ── Moteur d'analyse technico-économique (SPEC Moteur) ────────────────────────
#
# Routes alignées sur la convention du module — `applications/<code>/…` — et NON
# sur celles de la SPEC (`admin/demandes/<ref>/…`), qui adressent des modèles
# inexistants ici (`DemandeCredit`, `PlanFinancierUpload`). Le contrat publié
# dans `src/services/api.ts` est celui-ci.
#
# Convention d'absence, arrêtée avec l'agent front : **404 + code
# `ANALYSE_ABSENTE`** quand aucune analyse n'a encore été exécutée. Jamais un 200
# à corps vide — un écran ne doit pas avoir à distinguer « pas encore analysé »
# d'« analysé sans résultat » en inspectant la forme de la réponse.


def _analyse_error(exc) -> Response:
    """Réponse unique pour tout refus du moteur — même contrat que `_workflow_error`."""
    return Response(
        {"detail": str(exc), "code": exc.code, "errors": exc.as_errors()},
        status=exc.http_status,
    )


def _derniere_analyse(app):
    from credits.models import AnalyseCredit
    return (AnalyseCredit.objects
            .filter(application=app)
            .select_related("application", "referentiel", "needs_source")
            .order_by("-execute_le", "-id")
            .first())


def _parametres_analyse(app, data: dict):
    """Durée / différé / taux / mode, depuis le corps de la requête ou le dossier.

    Ce sont les leviers du simulateur analyste (`RateMaturityModal`) : l'analyste
    fait varier la maturité et relance le moteur. Aucune valeur n'est inventée —
    à défaut de saisie, on prend le cycle et le taux de base de la filière.
    """
    import decimal

    chain = app.value_chain
    duree = data.get("duree_mois", data.get("dureeMois"))
    if duree in (None, ""):
        duree = getattr(chain, "cycle_months", None) or 12
    differe = data.get("differe_mois", data.get("differeMois")) or 0
    taux = data.get("taux_annuel", data.get("tauxAnnuel"))
    mode = (data.get("mode_differe") or data.get("modeDiffere") or "interets_seuls")

    try:
        duree = int(duree)
        differe = int(differe)
        taux = decimal.Decimal(str(taux)) if taux not in (None, "") else None
    except (TypeError, ValueError, decimal.InvalidOperation):
        return None, Response(
            {"detail": "Paramètres de crédit invalides : duree_mois et differe_mois "
                       "doivent être entiers, taux_annuel un nombre.",
             "code": "PARAMETRES_INVALIDES"},
            status=400,
        )
    return {"duree_mois": duree, "differe_mois": differe,
            "taux_annuel": taux, "mode_differe": mode}, None


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def analyse_detail(request: Request, code: str) -> Response:
    """GET /api/credits/applications/<code>/analyse/ — dernière analyse, vue STAFF.

    Réservée au staff : cette réponse expose les barèmes appliqués, les plages du
    référentiel et les tolérances par module (principe 7). Un client authentifié
    et propriétaire du dossier n'y a PAS accès — il a `analyse-resume`.
    """
    if not _require_group(request, STAFF_ROLES):
        return Response(
            {"detail": "L'analyse détaillée est réservée au personnel d'instruction.",
             "code": "STAFF_REQUIS"},
            status=403,
        )

    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    analyse = _derniere_analyse(app)
    if analyse is None:
        return Response(
            {"detail": "Aucune analyse n'a encore été exécutée sur ce dossier.",
             "code": "ANALYSE_ABSENTE"},
            status=404,
        )

    from credits.analyse import serialiser_analyse_staff
    return Response(serialiser_analyse_staff(analyse))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def analyse_justifier(request: Request, code: str) -> Response:
    """POST /api/credits/applications/<code>/analyse/justifier/

    Corps : `{"indicateur": "cout_module:semences", "justification": "..."}`.
    Ajoute une justification à la DERNIÈRE analyse — append only, journalisée.
    Retourne l'analyse complète mise à jour (contrat `api.ts`).
    """
    if not _require_group(request, CAN_INSTRUCT):
        return Response(
            {"detail": "Seul un agent instructeur peut justifier un indicateur.",
             "code": "INSTRUCTION_REQUISE"},
            status=403,
        )

    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    analyse = _derniere_analyse(app)
    if analyse is None:
        return Response(
            {"detail": "Aucune analyse à justifier sur ce dossier.",
             "code": "ANALYSE_ABSENTE"},
            status=404,
        )

    from credits.analyse import (
        AnalyseError, justifier_indicateur, serialiser_analyse_staff,
    )

    data = request.data or {}
    try:
        justifier_indicateur(
            analyse,
            indicateur=data.get("indicateur") or data.get("indicator") or "",
            justification=data.get("justification") or "",
            agent=getattr(request.user, "sub", "") or "",
        )
    except AnalyseError as exc:
        return _analyse_error(exc)

    analyse.refresh_from_db()
    return Response(serialiser_analyse_staff(analyse))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def reanalyser(request: Request, code: str) -> Response:
    """POST /api/credits/applications/<code>/reanalyser/

    Corps optionnel : `{duree_mois, differe_mois, taux_annuel, mode_differe}`.

    Crée une NOUVELLE `AnalyseCredit` — l'ancienne reste intacte (principe 3).
    C'est le simulateur de l'analyste : faire varier la maturité et relancer.
    Cette route ne déplace JAMAIS le dossier dans la machine à états : le moteur
    recommande, l'humain décide (principe 2).
    """
    if not _require_group(request, CAN_INSTRUCT):
        return Response(
            {"detail": "Seul un agent instructeur peut lancer une analyse.",
             "code": "INSTRUCTION_REQUISE"},
            status=403,
        )

    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    params, erreur = _parametres_analyse(app, request.data or {})
    if erreur is not None:
        return erreur

    from credits.analyse import (
        AnalyseError, executer_analyse, serialiser_analyse_staff,
    )

    try:
        analyse = executer_analyse(
            app,
            execute_par=getattr(request.user, "sub", "") or "",
            **params,
        )
    except AnalyseError as exc:
        return _analyse_error(exc)

    return Response(serialiser_analyse_staff(analyse), status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def analyse_resume(request: Request, code: str) -> Response:
    """GET /api/credits/applications/<code>/analyse-resume/ — vue CLIENT.

    Anti-gaming (principe 7) : ni barème, ni seuil, ni tolérance, ni plage du
    référentiel, ni score chiffré, ni DSCR, ni recommandation. Le client voit sa
    lettre et des pistes d'amélioration formulées en actions.

    Accessible au titulaire du dossier ; le staff peut la consulter pour voir ce
    que le client voit — c'est le seul moyen de vérifier l'écran client depuis le
    backoffice sans se connecter au compte d'un membre.
    """
    if not _require_read(request):
        return Response({"detail": "Permission refusée."}, status=403)

    app = _get_application(code)
    if not app:
        return Response({"detail": "Dossier introuvable."}, status=404)

    if not _vcs(request).can_read_app(app):
        return Response({"detail": "Accès interdit."}, status=403)

    analyse = _derniere_analyse(app)
    if analyse is None:
        return Response(
            {"detail": "Votre dossier n'a pas encore été analysé.",
             "code": "ANALYSE_ABSENTE"},
            status=404,
        )

    from credits.analyse import serialiser_analyse_resume
    return Response(serialiser_analyse_resume(analyse))

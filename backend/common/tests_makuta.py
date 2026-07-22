"""Signature Makuta — les propriétés qui, si elles cassent, font rejeter chaque
paiement sans que rien dans nos journaux ne dise pourquoi.

Aucun test n'atteint le réseau : `settings.MAKUTA` est neutralisé sous `test`
(cf. `config/settings.py`) et chaque cas fabrique sa propre paire de clés en
mémoire. Une suite qui joindrait le vrai fournisseur enverrait de vrais ordres.
"""
from __future__ import annotations

import base64
import json

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from django.test import SimpleTestCase, override_settings

from common import makuta
from common.makuta import MakutaConfigurationError, MakutaError


def _paire_rsa(bits: int = 2048):
    cle = rsa.generate_private_key(public_exponent=65537, key_size=bits)
    prive = cle.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public = cle.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return prive, public


PRIVEE, PUBLIQUE = _paire_rsa()


def _config(**extra):
    base = {
        "BASE_URL": "https://api.makuta.cash",
        "PRIVATE_KEY_PEM": PRIVEE,
        "PRIVATE_KEY_PATH": "",
        "PRIVATE_KEY_PASSPHRASE": "",
        "CALLBACK_PUBLIC_KEY_PEM": "",
        "SIGNATURE_HEADER": makuta.DEFAULT_SIGNATURE_HEADER,
    }
    base.update(extra)
    return base


class CorpsCanoniqueTests(SimpleTestCase):
    """Le corps signé doit être exactement le corps transmis."""

    def test_format_compact_sans_espace_ni_saut_de_ligne(self):
        corps = makuta.canonical_body({"owner": "John Doe", "email": "john.doe@example.com"})
        self.assertEqual(corps, b'{"owner":"John Doe","email":"john.doe@example.com"}')
        self.assertNotIn(b" ", corps.replace(b"John Doe", b"JohnDoe"))
        self.assertNotIn(b"\n", corps)

    def test_ordre_d_insertion_conserve_jamais_trie(self):
        """L'exemple de la documentation n'est PAS trié (`owner` avant `email`) :
        le fournisseur vérifie sur les octets reçus. Trier les clés produirait un
        corps différent de celui qu'on croit signer."""
        corps = makuta.canonical_body({"zebre": 1, "alpha": 2})
        self.assertEqual(corps, b'{"zebre":1,"alpha":2}')

    def test_accents_transmis_en_utf8_non_echappes(self):
        """Les noms congolais portent des accents. `json.dumps` échappe par
        défaut en \\uXXXX ; on signe et transmet les mêmes octets UTF-8."""
        corps = makuta.canonical_body({"nom": "Kabédi Mwepu"})
        self.assertIn("é".encode("utf-8"), corps)
        self.assertEqual(json.loads(corps.decode("utf-8"))["nom"], "Kabédi Mwepu")


@override_settings(MAKUTA=_config())
class SignatureTests(SimpleTestCase):

    def test_signature_verifiable_avec_la_cle_publique(self):
        corps, signature = makuta.sign_payload({"owner": "John Doe"})
        self.assertTrue(makuta.verify(corps, signature, PUBLIQUE))

    def test_signature_est_du_base64(self):
        _, signature = makuta.sign_payload({"a": 1})
        base64.b64decode(signature, validate=True)  # lève si ce n'en est pas

    def test_padding_pkcs1_v15_et_sha256(self):
        """La documentation annonce « PKCS#8 v1.5 », qui est un format de CLÉ et
        non un padding de signature. Son propre exemple PHP utilise
        `RSA::SIGNATURE_PKCS1`. Ce test fige PKCS#1 v1.5 + SHA-256 en vérifiant
        avec ces paramètres explicites — s'ils changeaient, chaque requête serait
        rejetée par le fournisseur sans message exploitable."""
        corps, signature = makuta.sign_payload({"a": 1})
        cle = serialization.load_pem_public_key(PUBLIQUE.encode())
        cle.verify(base64.b64decode(signature), corps, padding.PKCS1v15(), hashes.SHA256())

    def test_corps_modifie_invalide_la_signature(self):
        corps, signature = makuta.sign_payload({"montant": "100.00"})
        falsifie = corps.replace(b"100.00", b"900.00")
        self.assertFalse(makuta.verify(falsifie, signature, PUBLIQUE))

    def test_get_signe_le_chemin_seul(self):
        signature = makuta.sign_path("/api/transactions/XYZ123")
        self.assertTrue(makuta.verify(b"/api/transactions/XYZ123", signature, PUBLIQUE))

    def test_chemin_relatif_refuse(self):
        with self.assertRaises(MakutaError):
            makuta.sign_path("api/transactions/XYZ123")

    def test_deux_montants_differents_donnent_deux_signatures(self):
        _, un = makuta.sign_payload({"ref": "A", "montant": "10.00"})
        _, deux = makuta.sign_payload({"ref": "A", "montant": "20.00"})
        self.assertNotEqual(un, deux)

    def test_deux_paiements_identiques_donnent_LA_MEME_signature(self):
        """Propriété du protocole, pas de notre code : RSA PKCS#1 v1.5 est
        déterministe et le contenu signé ne porte ni horodatage ni nonce. Deux
        ordres identiques sont donc indistinguables pour le destinataire, et une
        requête capturée reste rejouable indéfiniment.

        Ce test existe pour que ce fait reste VISIBLE : la protection contre le
        double paiement ne peut venir que de notre côté (`common.idempotency` et
        une référence propre à chaque opération dans le corps). À soulever auprès
        de Wolf Technologies."""
        _, un = makuta.sign_payload({"montant": "10.00"})
        _, deux = makuta.sign_payload({"montant": "10.00"})
        self.assertEqual(un, deux)


class ConfigurationTests(SimpleTestCase):

    @override_settings(MAKUTA=_config(PRIVATE_KEY_PEM=""))
    def test_sans_cle_on_leve_au_lieu_de_simuler(self):
        """Contrairement au SMS, qui dégrade en log parce qu'il est un canal
        secondaire, un paiement non configuré doit s'arrêter net."""
        with self.assertRaises(MakutaConfigurationError):
            makuta.sign_payload({"a": 1})

    @override_settings(MAKUTA=_config(PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\nnope\n"))
    def test_pem_illisible_message_sans_contenu_de_cle(self):
        with self.assertRaises(MakutaConfigurationError) as ctx:
            makuta.sign_payload({"a": 1})
        self.assertNotIn("nope", str(ctx.exception))

    @override_settings(MAKUTA=_config(BASE_URL=""))
    def test_sans_url_pas_de_requete(self):
        with self.assertRaises(MakutaConfigurationError):
            makuta.post("/api/payment", {"a": 1})

    @override_settings(MAKUTA=_config())
    def test_is_configured_vrai_quand_cle_et_url_presentes(self):
        self.assertTrue(makuta.is_configured())

    @override_settings(MAKUTA=_config(PRIVATE_KEY_PEM=""))
    def test_is_configured_faux_sans_lever(self):
        self.assertFalse(makuta.is_configured())

    def test_cle_non_rsa_refusee(self):
        """Makuta n'accepte que RSA. Une clé EC signerait sans erreur ici et
        serait rejetée à distance : mieux vaut refuser au chargement."""
        cle_ec = ec.generate_private_key(ec.SECP256R1())
        pem = cle_ec.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
        with override_settings(MAKUTA=_config(PRIVATE_KEY_PEM=pem)):
            with self.assertRaises(MakutaConfigurationError):
                makuta.sign_payload({"a": 1})

    @override_settings(MAKUTA=_config(SIGNATURE_HEADER="X-Signature"))
    def test_nom_d_entete_configurable(self):
        """La documentation se contredit : `X-Makuta-Signature` dans le tableau
        normatif, `X-Signature` dans l'exemple POST. Une signature juste sous un
        mauvais nom d'en-tête est rejetée exactement comme une fausse."""
        entetes = makuta._headers("sig", json_body=True)
        self.assertEqual(entetes["X-Signature"], "sig")
        self.assertNotIn("X-Makuta-Signature", entetes)

    def test_defaut_suit_le_tableau_normatif(self):
        with override_settings(MAKUTA=_config()):
            self.assertIn("X-Makuta-Signature", makuta._headers("sig", json_body=False))


@override_settings(MAKUTA=_config(PRIVATE_KEY_PEM=PRIVEE))
class RappelEntrantTests(SimpleTestCase):
    """Sens Makuta → nous : non couvert par la documentation fournie."""

    def test_signature_d_un_tiers_rejetee(self):
        autre_prive, _ = _paire_rsa()
        with override_settings(MAKUTA=_config(PRIVATE_KEY_PEM=autre_prive)):
            corps, signature = makuta.sign_payload({"paiement": "recu"})
        # Signé par une autre clé que celle qu'on tient pour légitime.
        self.assertFalse(makuta.verify(corps, signature, PUBLIQUE))

    def test_signature_absurde_rejetee_sans_exception(self):
        self.assertFalse(makuta.verify(b"{}", "pas-du-base64!!", PUBLIQUE))

    def test_cle_publique_invalide_leve(self):
        with self.assertRaises(MakutaConfigurationError):
            makuta.verify(b"{}", base64.b64encode(b"x").decode(), "pas un PEM")

"""Verrous de nomenclature (principe 6) sur `common.choices`.

Ces tests ne valident pas un comportement métier : ils empêchent une nomenclature
centralisée de re-diverger silencieusement dans les apps qui la consomment.
"""
from __future__ import annotations

from django.test import TestCase

from common.choices import CANAUX_EXTERNES, CANAUX_INTERNES, Channel


class ChannelEstLaSourceUniqueTests(TestCase):
    def test_savings_porte_exactement_le_meme_vocabulaire_valeurs_ET_libelles(self):
        """`savings.SavingsPlan.Channel` est le jumeau historique. Tant qu'il n'est pas
        raccordé (app tenue par un autre lot), ce test tient la porte ouverte : valeurs ET
        libellés doivent rester identiques, faute de quoi le jour du raccordement
        produirait une migration `savings` — les `choices` étant sérialisés dans les
        migrations. Si ce test tombe, il ne faut PAS aligner `common` sur `savings` sans
        réfléchir : c'est le signe que quelqu'un a fait diverger la nomenclature.
        """
        from savings.models import SavingsPlan

        self.assertEqual(list(SavingsPlan.Channel.choices), list(Channel.choices))

    def test_caisses_ne_declare_plus_ses_propres_codes(self):
        from caisses import channels

        self.assertEqual(channels.AGENT, Channel.AGENT.value)
        self.assertEqual(channels.MOBILE_MONEY, Channel.MOBILE_MONEY.value)
        self.assertEqual(channels.BANK, Channel.BANK.value)

    def test_tout_canal_connu_de_caisses_appartient_au_vocabulaire_commun(self):
        """La chaîne vide exceptée : c'est une compatibilité ascendante de `caisses`
        (l'ancien dépôt ne portait pas de canal), pas un canal du vocabulaire."""
        from caisses import channels

        codes = set(Channel.values)
        self.assertTrue({c for c in channels.KNOWN_CHANNELS if c} <= codes)

    def test_caisses_exclut_wallet_deliberement(self):
        """`caisses` EST le portefeuille : « déposer par portefeuille sur le
        portefeuille » ne désigne aucune porte. Décision épinglée ici pour qu'un
        futur alignement mécanique sur `CANAUX_INTERNES` ne l'efface pas par
        inadvertance — ce serait ouvrir un canal de dépôt qui n'existe pas."""
        from caisses import channels

        self.assertIn(Channel.WALLET.value, CANAUX_INTERNES)
        self.assertNotIn(Channel.WALLET.value, channels.KNOWN_CHANNELS)

    def test_la_frontiere_interne_externe_est_la_meme_des_deux_cotes(self):
        """`caisses` décide QUELS canaux il accepte, pas ce qu'« externe » veut dire :
        un canal externe engage un tiers, et ça ne dépend pas de l'app."""
        from caisses import channels

        self.assertEqual(set(channels.EXTERNAL_CHANNELS), set(CANAUX_EXTERNES))
        self.assertEqual(CANAUX_EXTERNES & CANAUX_INTERNES, frozenset())
        self.assertEqual(CANAUX_EXTERNES | CANAUX_INTERNES, set(Channel.values))

package org.mage.test.probe;

import mage.constants.PhaseStep;
import mage.constants.Zone;
import mage.game.Game;
import org.junit.Test;
import org.mage.test.serverside.base.CardTestPlayerBaseWithMonteCarloAIHelps;

/**
 * The XMage probe (Dandan lab, 17 Nov 2026; Fable's stage 3 brief): how fast XMage copies a mid-game Modern position, the
 * step every look-ahead takes, and how many play-outs its own Monte Carlo player (copy, deal hidden cards again, play at random
 * to the end) gets through a second there. Copied into Mage.Tests by lab's xmage-probe workflow; nothing goes to XMage's repo.
 */
public class ProbeTest extends CardTestPlayerBaseWithMonteCarloAIHelps {

    private void deck(org.mage.test.player.TestPlayer p, String... cards) {
        for (String c : cards) addCard(Zone.LIBRARY, p, c, 4);
    }

    @Test
    public void probe() {
        // a mid-game board: Boros-ish aggro against Izzet tempo, lands and threats down, cards in hand, real spells in the libraries
        addCard(Zone.BATTLEFIELD, playerA, "Sacred Foundry", 2);
        addCard(Zone.BATTLEFIELD, playerA, "Mountain", 2);
        addCard(Zone.BATTLEFIELD, playerA, "Ragavan, Nimble Pilferer", 1);
        addCard(Zone.BATTLEFIELD, playerA, "Guide of Souls", 1);
        addCard(Zone.BATTLEFIELD, playerA, "Ocelot Pride", 1);
        addCard(Zone.HAND, playerA, "Lightning Bolt", 2);
        addCard(Zone.HAND, playerA, "Galvanic Discharge", 1);
        addCard(Zone.HAND, playerA, "Phlage, Titan of Fire's Fury", 1);
        deck(playerA, "Lightning Bolt", "Path to Exile", "Guide of Souls", "Ragavan, Nimble Pilferer", "Arid Mesa", "Plains", "Mountain");

        addCard(Zone.BATTLEFIELD, playerB, "Steam Vents", 2);
        addCard(Zone.BATTLEFIELD, playerB, "Island", 2);
        addCard(Zone.BATTLEFIELD, playerB, "Psychic Frog", 1);
        addCard(Zone.BATTLEFIELD, playerB, "Tarmogoyf", 1);
        addCard(Zone.HAND, playerB, "Counterspell", 2);
        addCard(Zone.HAND, playerB, "Consider", 1);
        addCard(Zone.HAND, playerB, "Murktide Regent", 1);
        addCard(Zone.HAND, playerB, "Snapcaster Mage", 1);
        deck(playerB, "Counterspell", "Consider", "Thoughtseize", "Snapcaster Mage", "Scalding Tarn", "Island", "Murktide Regent");

        // XMage's Monte Carlo player decides one main phase; it logs "Simulated N games in T seconds - nodes in tree"
        aiPlayPriority(3, PhaseStep.PRECOMBAT_MAIN, playerA);
        setStopAt(3, PhaseStep.END_TURN);
        setStrictChooseMode(false);
        long t0 = System.nanoTime();
        execute();
        System.out.println("PROBE ai turn took " + (System.nanoTime() - t0) / 1_000_000 + " ms");

        Game g = currentGame;
        System.out.println("PROBE cards in game " + g.getCards().size() + ", permanents " + g.getBattlefield().getAllPermanents().size());
        for (int round = 0; round < 3; round++) {   // the first round warms the JIT up
            int n = 2000;
            long t = System.nanoTime();
            for (int i = 0; i < n; i++) g.createSimulationForAI();
            double us = (System.nanoTime() - t) / 1000.0 / n;
            System.out.println("PROBE copy round " + round + ": " + String.format("%.1f", us) + " us a copy, " + String.format("%.0f", 1e6 / us) + " copies a second (one thread)");
        }
    }
}

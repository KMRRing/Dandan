package org.mage.test.probe;

import mage.constants.PhaseStep;
import mage.constants.RangeOfInfluence;
import mage.constants.Zone;
import mage.game.Game;
import mage.player.ai.SimulatedPlayerMCTS;
import mage.players.Player;
import org.junit.Test;
import org.mage.test.player.TestComputerPlayer;
import org.mage.test.player.TestPlayer;
import org.mage.test.serverside.base.CardTestPlayerBase;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The XMage probe (Dandan lab, 17 Nov 2026; Fable's stage 3 brief). In the middle of a Modern game (turn 3, PlayerA's first
 * main phase, the game live), it times what every look-ahead does: copy the game (createSimulationForAI), and a play-out:
 * the copy with both players made random (XMage's own SimulatedPlayerMCTS, restored from the real players), the opponent's
 * hand dealt again from its library (as XMage's MCTSNode.randomizePlayers), played to the end of the next turn but one, as
 * Monte's look-ahead does. Copied into Mage.Tests by lab's xmage-probe workflow; nothing goes to XMage's repository.
 */
public class ProbeTest extends CardTestPlayerBase {

    static boolean done = false;

    /** A test player that runs the probe at its first priority on turn 3, first main phase. */
    class ProbePlayer extends TestPlayer {
        ProbePlayer(TestComputerPlayer cp) { super(cp); }

        @Override
        public boolean priority(Game game) {
            if (!done && game.getTurnNum() == 3 && game.getStep().getType() == PhaseStep.PRECOMBAT_MAIN && game.isActivePlayer(getId())) {
                done = true;
                probe(game, getId());
            }
            return super.priority(game);
        }
    }

    @Override
    protected TestPlayer createPlayer(String name, RangeOfInfluence range) {
        return new ProbePlayer(new TestComputerPlayer(name, range));
    }

    static void probe(Game game, UUID me) {
        System.out.println("PROBE position: turn " + game.getTurnNum() + ", cards in game " + game.getCards().size()
                + ", permanents " + game.getBattlefield().getAllPermanents().size());
        for (int round = 0; round < 3; round++) {   // the first round warms the JIT up
            int n = 2000;
            long t = System.nanoTime();
            for (int i = 0; i < n; i++) game.createSimulationForAI();
            double us = (System.nanoTime() - t) / 1000.0 / n;
            System.out.println("PROBE copy, round " + round + ": " + String.format("%.1f", us) + " us a copy, " + String.format("%.0f", 1e6 / us) + " a second (one thread)");
        }
        for (int round = 0; round < 2; round++) {
            int n = round == 0 ? 50 : 300, ok = 0, failed = 0;
            long actions = 0;
            long t = System.nanoTime();
            for (int i = 0; i < n; i++) {
                try {
                    Game sim = game.createSimulationForAI();
                    List<SimulatedPlayerMCTS> players = new ArrayList<>();
                    for (Player old : sim.getState().getPlayers().values()) {
                        Player orig = game.getPlayer(old.getId());
                        Player state = orig instanceof TestPlayer ? ((TestPlayer) orig).getComputerPlayer().copy() : orig.copy();
                        SimulatedPlayerMCTS p = new SimulatedPlayerMCTS(old, true);
                        p.restore(state);
                        sim.getState().getPlayers().put(old.getId(), p);
                        players.add(p);
                    }
                    // the hidden cards dealt again: the opponent's hand back into its library, shuffled, the same number drawn
                    for (Player p : sim.getState().getPlayers().values()) {
                        if (!p.getId().equals(me)) {
                            int h = p.getHand().size();
                            p.getLibrary().addAll(p.getHand().getCards(sim), sim);
                            p.getHand().clear();
                            p.getLibrary().shuffle();
                            for (int k = 0; k < h; k++) { mage.cards.Card c = p.getLibrary().drawFromTop(sim); c.setZone(Zone.HAND, sim); p.getHand().add(c); }
                        } else p.getLibrary().shuffle();
                    }
                    // to the end of the turn after next, as Monte's look-ahead
                    sim.getOptions().stopOnTurn = game.getTurnNum() + 2;
                    sim.getOptions().stopAtStep = PhaseStep.END_TURN;
                    sim.resume();
                    for (SimulatedPlayerMCTS p : players) actions += p.getActionCount();
                    ok++;
                } catch (Throwable e) {
                    failed++;
                    if (failed <= 2) { System.out.println("PROBE play-out failed: " + e); e.printStackTrace(System.out); }
                }
            }
            double ms = (System.nanoTime() - t) / 1e6 / n;
            System.out.println("PROBE play-out to turn " + (game.getTurnNum() + 2) + ", round " + round + ": " + String.format("%.2f", ms) + " ms each, "
                    + String.format("%.0f", 1000 / ms) + " a second (one thread), " + (ok > 0 ? actions / ok : 0) + " actions each, " + failed + " failed of " + n);
        }
    }

    private void deck(TestPlayer p, String... cards) {
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

        setStopAt(3, PhaseStep.END_TURN);
        setStrictChooseMode(false);
        execute();
        System.out.println("PROBE ran: " + done);
    }
}

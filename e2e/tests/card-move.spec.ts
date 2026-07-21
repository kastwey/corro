// card-move.spec.ts — SMOKE TEST of the card-driven-move flow: landing on a deck square whose
// top card teleports you (here "advance to start") must resolve cleanly — you end on the new
// square and the turn is completable (End turn works, play passes on).
//
// Scope caveat (important): this does NOT guard playtest #10 (bus → card → advance-to-GO left the
// turn stranded with no End turn button). That bug was a CLIENT animation-timing race — the action
// bar's deferred refresh fired mid-hop and never re-fired. The E2E suite runs with `reducedMotion`
// (tokens snap, no animation), which removes the very timing the bug needs, so this test passes
// with OR without the fix. The real regression guard for #10 is the server unit test
// `CardMoveAnnouncementTests` (it asserts the MOVE-phase `game.card_move` line and fails if the fix
// is removed). This spec only proves the end-to-end card-teleport path isn't grossly broken.
//
// On the galactic board the fortune deck's first card (cards.json order, unshuffled in E2E) is
// "advance to start" (moveTo 0), and square 7 is a fortune-deck square. From start (0) a 3+4 lands
// Ana on 7, she draws that card and is teleported back to 0.

import { test, expect } from '../helpers/test';
import { actionButton, createGame, joinGame, newPlayerPage, resetDice, roll, square, startGame } from '../helpers/game';

const BOARD = 'galactic-empire';

test.beforeEach(async () => {
	await resetDice();
});

test('a card that moves you after landing resolves cleanly and the turn completes', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// 0 → 7 (fortune deck); its top card advances her to start, so she ends the turn back on 0.
	await roll(ana, 3, 4);
	const reveal = ana.locator('.card-reveal-overlay');
	await expect(reveal).toBeVisible();
	await expect(reveal.locator('svg[data-card-art="package"]')).toBeVisible();

	// End turn is available (the turn resolved), and the card really moved her: she left the deck
	// square (7) and is back on start (0) alongside Berto, who never left it — so this exercises
	// the card-driven move, not a plain landing.
	await expect(actionButton(ana, 'endTurn')).toBeVisible();
	await expect(square(ana, 7).locator('.player-token')).toHaveCount(0);
	await expect(square(ana, 0).locator('.player-token')).toHaveCount(2);

	// She can actually end the turn — play passes to Berto.
	await actionButton(ana, 'endTurn').click();
	await expect(actionButton(berto, 'rollDice')).toBeVisible();
});

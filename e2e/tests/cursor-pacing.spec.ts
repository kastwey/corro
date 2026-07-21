// cursor-pacing.spec.ts — the exploration cursor must not spoil the landing square.
//
// Live-play report: while the token was still hopping, the destination square already
// wore the cursor ring, so a sighted player knew where the roll would land before the
// token got there. Cause: the DICE_ROLLED response arrives BEFORE the turn sequencer
// plays the roll's announcements+state segment, so the announcement gate was still
// unarmed and deferVisual ran the cursor move immediately. The handler now arms the
// gate itself, pacing the cursor to the hop.
//
// This spec runs with MOTION ON (its own contexts — the shared helpers force reduced
// motion, which would snap the token and hide the race). It samples the board with a
// MutationObserver, so the assertion is on event ORDER, not on timings.

import { test, expect, type Browser } from '../helpers/test';
import { createGame, joinGame, newPlayerPage, resetDice, roll, startGame } from '../helpers/game';

const BOARD = 'galactic-empire';

test.beforeEach(async () => {
	await resetDice();
});

async function animatedPlayerPage(browser: Browser) {
	return newPlayerPage(browser, 'es-ES', { reducedMotion: 'no-preference' });
}

test('the cursor reaches the landing square only after the token hop, never before', async ({ browser }) => {
	const ana = await animatedPlayerPage(browser);
	const berto = await animatedPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Snapshot the destination square (0 + 4+6 = 10) on every class/child mutation.
	await ana.evaluate(() => {
		const log: Array<{ t: number; focused10: boolean; anyMoving: boolean }> = [];
		(window as any).__cursorLog = log;
		const board = document.getElementById('board')!;
		const snap = () => {
			const sq10 = board.querySelector('.square[data-index="10"]');
			log.push({
				t: Math.round(performance.now()),
				focused10: !!sq10?.classList.contains('focused'),
				anyMoving: !!board.querySelector('.player-token--moving'),
			});
		};
		new MutationObserver(snap).observe(board, {
			subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
		});
	});

	await roll(ana, 4, 6); // 0 → 10
	await expect(ana.locator('#board .square[data-index="10"] .player-token')).toHaveCount(1, { timeout: 20_000 });
	await ana.waitForTimeout(300); // let the settle-time mutations drain into the log

	const log: Array<{ t: number; focused10: boolean; anyMoving: boolean }> =
		await ana.evaluate(() => (window as any).__cursorLog);
	console.log('cursor-pacing log:', JSON.stringify(log)); // forensics for a failure under load
	const firstFocused = log.findIndex(e => e.focused10);
	const firstMoving = log.findIndex(e => e.anyMoving);
	expect(firstFocused, 'the cursor must reach the landing square eventually').toBeGreaterThan(-1);
	expect(firstMoving, 'the hop itself must have been observed (motion is ON here)').toBeGreaterThan(-1);
	// The spoiler: pre-fix the cursor ringed square 10 BEFORE the token even started moving.
	expect(
		firstFocused,
		'the cursor ringed the destination before/while the token was travelling (spoiler)',
	).toBeGreaterThan(firstMoving);
	expect(log[firstFocused].anyMoving, 'the cursor must land after the hop settled, not mid-hop').toBe(false);
});

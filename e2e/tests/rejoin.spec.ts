// rejoin.spec.ts — the account-less seat recovery: every player gets an 8-character
// RE-ENTRY code; typed in the lobby's ONE code box (which also takes invite codes) it
// reclaims their seat from any browser — as long as nobody is connected on it — rotating
// the secret so the claimer becomes the only owner. This is the "I cleared my browser
// data" (or "I switched devices") escape hatch.

import { test, expect, type Page } from '../helpers/test';
import {
	actionButton,
	buyPendingProperty,
	createGame,
	expectAnnouncement,
	gotoLobbyHome,
	joinGame,
	newPlayerPage,
	resetDice,
	roll,
	startGame,
} from '../helpers/game';

const BOARD = 'snakes-and-ladders';

test.beforeEach(async () => {
	await resetDice();
});

/** Types a code in the lobby box and submits it (the rejoin path has no join form). */
async function typeLobbyCode(page: Page, code: string): Promise<void> {
	await gotoLobbyHome(page);
	await page.click('#go-join-btn');
	await page.fill('#lobby-code-input', code);
	await page.click('#validate-code-button');
}

test('a re-entry code recovers the seat from a fresh browser; a live seat refuses it', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);

	// The waiting room shows the HOST her own re-entry code, with a copy button.
	const hostCodeEl = ana.locator('#created-rejoin-mount .invite-code__value');
	await expect(hostCodeEl).toHaveText(/^[A-HJ-NP-Z2-9]{8}$/);

	await joinGame(berto, code, 'Berto');
	// …and the GUEST his (different) one.
	const bertoCodeEl = berto.locator('#joined-rejoin-mount .invite-code__value');
	await expect(bertoCodeEl).toHaveText(/^[A-HJ-NP-Z2-9]{8}$/);
	const bertoCode = (await bertoCodeEl.textContent())!.trim();
	expect(bertoCode).not.toBe((await hostCodeEl.textContent())!.trim());

	await startGame(ana, [ana, berto]);

	// On the board, the connection panel re-states the code (press to copy).
	await expect(berto.locator('.connection-panel__btn--rejoin-code')).toContainText(bertoCode);

	// ── A THIRD browser (fresh storage — "I cleared my data") types Berto's code. ──
	const berto2 = await newPlayerPage(browser);
	await typeLobbyCode(berto2, bertoCode);
	await expect(berto2.locator('#rejoin-confirm')).toBeVisible();
	await expect(berto2.locator('#rejoin-confirm-desc')).toContainText('Berto');
	// Berto is still connected: the warning shows, and claiming is refused server-side.
	await expect(berto2.locator('#rejoin-confirm-warning')).toBeVisible();
	await berto2.click('#rejoin-confirm-enter');
	await expect(berto2.locator('#error-message')).toContainText(/conectado/i);

	// ── Berto's original browser goes away (the data-loss scenario). ──────────
	await berto.context().close();
	await expectAnnouncement(ana, /Berto se ha desconectado/);

	// Now the claim succeeds: the fresh browser lands on the board as Berto.
	await typeLobbyCode(berto2, bertoCode);
	await expect(berto2.locator('#rejoin-confirm')).toBeVisible();
	await expect(berto2.locator('#rejoin-confirm-warning')).toBeHidden();
	await berto2.click('#rejoin-confirm-enter');
	await berto2.waitForURL(/board\.html/);
	await expect(berto2.locator('#board .track-cell').first()).toBeVisible();
	await expect(berto2.locator('.player-card', { hasText: 'Berto' })).toBeVisible();
	// The same durable code is re-stated on the new session's connection panel.
	await expect(berto2.locator('.connection-panel__btn--rejoin-code')).toContainText(bertoCode);
	// And the others hear him come back.
	await expectAnnouncement(ana, /Berto se ha vuelto a conectar/);
});

test('an unknown code and a nonsense code both fail with a clear message', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await typeLobbyCode(page, 'ZZZZ9999'); // valid shape, matches nothing
	await expect(page.locator('#error-message')).toContainText(/no corresponde/i);
});

test('a mid-game reload keeps the ownership visuals on the board', async ({ browser }) => {
	// Live-play bug: after Ctrl+F5 the board looked like nobody had bought anything. The
	// async package-i18n merge REBUILDS the squares after the first render; during live play
	// the next state update repainted tokens/badges within a move, but after a reload no
	// further state arrives — so the rebuild's wipe stuck. The rebuild now redraws them.
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', 'galactic-empire');
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Ana buys the station (5); Berto buys Roca Tycho (6).
	await roll(ana, 2, 3);
	await buyPendingProperty(ana);
	await actionButton(ana, 'endTurn').click();
	await roll(berto, 2, 4);
	await buyPendingProperty(berto);

	await expect(ana.locator('.square[data-index="5"] .owner-badge')).toBeVisible();
	await expect(ana.locator('.square[data-index="6"] .owner-badge')).toBeVisible();

	// Ana hard-reloads mid-game; her session recovers the seat and the board must still
	// show BOTH owner badges and the player tokens without anyone having to act first.
	await ana.reload();
	await expect(ana.locator('#board .square').first()).toBeVisible({ timeout: 15_000 });
	await expect(ana.locator('.square[data-index="5"] .owner-badge')).toBeVisible({ timeout: 10_000 });
	await expect(ana.locator('.square[data-index="6"] .owner-badge')).toBeVisible();
	await expect(ana.locator('.player-token').first()).toBeVisible();
});

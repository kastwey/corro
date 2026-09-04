// shedding.spec.ts — the shedding family on "Four Colours", end to end.
//
// Two real browsers, Spanish, real SignalR. The E2E identity shuffle keeps the deck in
// cards.json order and DEALS from its tail: both openers hold the MIRRORED hand
// [5 rojo, Saltar rojo, 5 azul, 7 verde, Roba dos azul, 2 verde, 7 amarillo], the flip is
// 0 amarillo (`yellow` in force) and the first draws are the blue-2 pair, then red-1.
// Reordering that tail breaks this spec (pinned in FourColoursPackageTests).
//
// The story: colour and VALUE matches, the drawn-card pause (draw with Space, play the
// drawn card with Enter), a Roba dos suffered before the lost turn, and the on-demand
// counts (S / Shift+S) that replace the classic shout by design.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	resetDice,
	startGame,
} from '../helpers/game';

const BOARD = 'four-colours';

test.beforeEach(async () => {
	await resetDice();
});

test('shedding: matches, the drawn-card pause, a penalty and the on-demand counts', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// ── The table at start: 7-card hands containing held cards only, plus a separate visual
	// deck/discard table. Space draws in this family; D reads the shared piles. ──
	const anaCards = ana.locator('.hand-card:not(.hand-card--info)');
	await expect(anaCards).toHaveCount(7);
	await expect(anaCards.locator('[data-card-art="package"]')).toHaveCount(7);
	await expect(ana.locator('.shedding-discard [data-card-art="package"]')).toBeVisible();
	await expect(ana.locator('.hand-card--info')).toHaveCount(0);
	await expect(ana.locator('.shedding-draw .gcard__back-label')).toHaveText('93');
	await expect(ana.locator('.hand-panel__draw')).toBeVisible();
	await expect(ana.locator('.dice-control')).toBeHidden();
	await anaCards.first().focus();
	await ana.keyboard.press('d');
	await expectAnnouncement(ana, /Mazo: 93\. Arriba: 0 amarillo, color en vigor amarillo\./);
	await expect(anaCards.first()).toBeFocused();
	// C is the same question without the preamble: what is on the table, and what may be
	// played on it. The engine's own C repeats S word for word here, so the board takes it.
	await ana.keyboard.press('c');
	// Just the card: no label, and no colour — yellow on yellow would only repeat itself.
	await expectAnnouncement(ana, /^0 amarillo\.$/);
	await expect(anaCards.first()).toBeFocused();

	const cardOf = (page: typeof ana, name: RegExp) =>
		page.locator('.hand-card:not(.hand-card--info)', { hasText: name }).first();

	// ── Ana opens on the colour; Berto answers ACROSS colours by VALUE (7 on 7). ──
	await ana.locator('#board').focus();
	await cardOf(ana, /7 amarillo/).focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana juega un 7 amarillo/);
	await expectAnnouncement(ana, /Juegas un 7 amarillo/);
	await expect(ana.locator('.visual-narrative--shedding')).toContainText(/Juegas un 7 amarillo/i);
	await expect(ana.locator('.visual-narrative--shedding')).toHaveAttribute('data-kind', 'card-play-discard');

	await berto.locator('#board').focus();
	await cardOf(berto, /7 verde/).focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto juega un 7 verde/);

	// ── Two more colour plays leave 2 verde on top with Berto stranded. ──
	await ana.locator('#board').focus();
	await cardOf(ana, /7 verde/).focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana juega un 7 verde/);
	await berto.locator('#board').focus();
	await cardOf(berto, /2 verde/).focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto juega un 2 verde/);
	await ana.locator('#board').focus();
	await cardOf(ana, /2 verde/).focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana juega un 2 verde/);

	// ── Berto has nothing green and no 2. Filtering therefore leaves a real zero-item
	// list: its name and item count are sufficient, with no extra "all filtered" phrase.
	const bertoFilter = berto.locator('.hand-panel__list-actions [data-focus-id="filter-playable"]');
	await bertoFilter.click();
	const bertoList = berto.locator('.hand-panel__list');
	await expect(bertoList.locator('.hand-card')).toHaveCount(0);
	await expect(bertoList).not.toHaveAttribute('aria-describedby', /./);
	await expect(berto.locator('.hand-panel__empty')).toBeHidden();
	await flushAxeAudit(berto);
	await berto.locator('.hand-panel__list-actions [data-focus-id="show-all-cards"]').click();

	// Berto DRAWS (Space) — and the drawn 2 azul
	// matches by value, so the game pauses on his play-it-or-keep-it choice. ──
	await berto.locator('#board').focus();
	await berto.keyboard.press(' ');
	await expectAnnouncement(ana, /Berto roba una carta/);
	await expectAnnouncement(berto, /Robas un 2 azul: Intro la juega, Espacio te la quedas/);
	await expect(berto.locator('.visual-narrative--shedding')).toContainText(/Robas un 2 azul/i);
	const drawnRow = berto.locator('.hand-card:not(.hand-card--info)', { hasText: /recién robada/ });
	await expect(drawnRow).toHaveCount(1);
	await drawnRow.focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto juega un 2 azul/);

	// ── Ana follows the new colour; Berto lands the Roba dos: Ana suffers BEFORE the
	// lost turn — two known cards, their identities hers alone. ──
	await ana.locator('#board').focus();
	await cardOf(ana, /5 azul/).focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana juega un 5 azul/);

	await berto.locator('#board').focus();
	await cardOf(berto, /Roba dos azul/).focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Robas 2 cartas de castigo/);
	await expectAnnouncement(ana, /Te llevas 2 azul y 1 rojo\./);
	await expectAnnouncement(ana, /Pierdes el turno/);
	await expectAnnouncement(berto, /Ana pierde el turno/);

	// Berto keeps the turn after the penalty and plays on the colour in force.
	await cardOf(berto, /5 azul/).focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto juega un 5 azul/);

	// ── The on-demand counts (the deliberate replacement of the shout): S = my story,
	// Shift+S = the rivals' cards and points. ──
	await ana.locator('#board').focus();
	await ana.keyboard.press('s');
	await expectAnnouncement(ana, /5 cartas, arriba 5 azul, color en vigor azul, 0 puntos/);

	await ana.keyboard.press('Shift+S');
	await expectAnnouncement(ana, /Berto: 3 cartas, 0 puntos/);
	const heard: string[] = await ana.evaluate(() => (window as any).__announcements ?? []);
	const rivals = heard.filter(line => /^Berto: /.test(line)).pop()!;
	expect(rivals).not.toMatch(/Ana:/);
});

test('shedding: the penalty scoring house rule words the points against their holder', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	// The host flips the count around in the lobby: points now run AGAINST whoever holds them.
	const code = await createGame(ana, 'Ana', BOARD, { houseRules: { sheddingScoring: 'penalty' } });
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// ── The same number, worded as what it now is: points against you, on both surfaces. ──
	await ana.locator('#board').focus();
	await ana.keyboard.press('s');
	await expectAnnouncement(ana, /7 cartas, .*0 puntos de castigo/);

	await ana.keyboard.press('Shift+S');
	await expectAnnouncement(ana, /Berto: 7 cartas, 0 puntos de castigo/);

	// ── The active-rules document states the direction, and the target line says what
	// reaching it DOES — the classic "Puntos para ganar" would say the exact opposite. ──
	await ana.keyboard.press('Control+Shift+F1');
	const rules = ana.locator('.game-dialog.dialog-game-rules');
	await expect(rules).toBeVisible();
	const lines = rules.locator('.game-rules-list li');
	await expect(lines.filter({ hasText: 'Puntuación:' }))
		.toHaveText(/cada jugador se apunta los puntos que le quedan en la mano, y gana la puntuación más baja/);
	await expect(lines.filter({ hasText: 'Llegar a 500 puntos hace perder la partida' })).toHaveCount(1);
	await expect(lines.filter({ hasText: 'Puntos para ganar' })).toHaveCount(0);
	await flushAxeAudit(ana);

	// With the dialog holding the keyboard, the surface's read-only keys still answer: keys.ts
	// keeps the engine's own queries alive here so "a blind player can check their situation
	// without first dismissing the dialog", and a card family's S is the same kind of question.
	// (A screen reader in browse mode swallows the letter first — that half is the reader's
	// mode switch, and the same one every engine query already asks for.)
	// Counted, not awaited: expectAnnouncement scans the whole log, and Shift+S above already
	// put a matching line in it — a plain wait would pass with this route removed.
	const myStatus = /^\d+ cartas?, arriba /;
	const before = (await ana.evaluate(() => (window as any).__announcements ?? []) as string[])
		.filter(line => myStatus.test(line)).length;
	await ana.keyboard.press('s');
	await expect.poll(async () => {
		const heard: string[] = await ana.evaluate(() => (window as any).__announcements ?? []);
		return heard.filter(line => myStatus.test(line)).length;
	}).toBe(before + 1);
	await rules.locator('.btn-primary').click();
});

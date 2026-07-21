// shedding.spec.ts — the shedding family on "Four Colours", end to end.
//
// Two real browsers, Spanish, real SignalR. The E2E identity shuffle keeps the deck in
// cards.json order and DEALS from its tail: both openers hold the MIRRORED hand
// [Rojo 5, Salto rojo, Azul 5, Verde 7, Roba dos azul, Verde 2, Amarillo 7], the flip is
// Amarillo 0 (`yellow` in force) and the first draws are the blue-2 pair, then red-1.
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
	await expectAnnouncement(ana, /Mazo: 93\. Arriba: Amarillo 0, color en vigor amarillo\./);
	await expect(anaCards.first()).toBeFocused();

	const cardOf = (page: typeof ana, name: RegExp) =>
		page.locator('.hand-card:not(.hand-card--info)', { hasText: name }).first();

	// ── Ana opens on the colour; Berto answers ACROSS colours by VALUE (7 on 7). ──
	await ana.locator('#board').focus();
	await cardOf(ana, /Amarillo 7/).focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana juega Amarillo 7/);
	await expectAnnouncement(ana, /Juegas Amarillo 7/);

	await berto.locator('#board').focus();
	await cardOf(berto, /Verde 7/).focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto juega Verde 7/);

	// ── Two more colour plays leave Verde 2 on top with Berto stranded. ──
	await ana.locator('#board').focus();
	await cardOf(ana, /Verde 7/).focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana juega Verde 7/);
	await berto.locator('#board').focus();
	await cardOf(berto, /Verde 2/).focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto juega Verde 2/);
	await ana.locator('#board').focus();
	await cardOf(ana, /Verde 2/).focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana juega Verde 2/);

	// ── Berto has nothing green and no 2. Filtering therefore leaves a real zero-item
	// list: its name and item count are sufficient, with no extra "all filtered" phrase.
	const bertoFilter = berto.locator('.hand-panel__list-actions [data-focus-id="filter-playable"]');
	await bertoFilter.click();
	const bertoList = berto.locator('.hand-panel__list');
	await expect(bertoList.locator('.hand-card')).toHaveCount(0);
	await expect(bertoList).not.toHaveAttribute('aria-describedby', /./);
	await expect(berto.locator('.hand-panel__empty')).toBeHidden();
	await flushAxeAudit(berto);
	await bertoFilter.click();

	// Berto DRAWS (Space) — and the drawn Azul 2
	// matches by value, so the game pauses on his play-it-or-keep-it choice. ──
	await berto.locator('#board').focus();
	await berto.keyboard.press(' ');
	await expectAnnouncement(ana, /Berto roba una carta/);
	await expectAnnouncement(berto, /Robas Azul 2: Intro la juega, Espacio te la quedas/);
	const drawnRow = berto.locator('.hand-card:not(.hand-card--info)', { hasText: /recién robada/ });
	await expect(drawnRow).toHaveCount(1);
	await drawnRow.focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto juega Azul 2/);

	// ── Ana follows the new colour; Berto lands the Roba dos: Ana suffers BEFORE the
	// lost turn — two known cards, their identities hers alone. ──
	await ana.locator('#board').focus();
	await cardOf(ana, /Azul 5/).focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana juega Azul 5/);

	await berto.locator('#board').focus();
	await cardOf(berto, /Roba dos azul/).focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Robas 2 cartas de castigo/);
	await expectAnnouncement(ana, /Te llevas Azul 2 y Rojo 1\./);
	await expectAnnouncement(ana, /Pierdes el turno/);
	await expectAnnouncement(berto, /Ana pierde el turno/);

	// Berto keeps the turn after the penalty and plays on the colour in force.
	await cardOf(berto, /Azul 5/).focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto juega Azul 5/);

	// ── The on-demand counts (the deliberate replacement of the shout): S = my story,
	// Shift+S = the rivals' cards and points. ──
	await ana.locator('#board').focus();
	await ana.keyboard.press('s');
	await expectAnnouncement(ana, /5 cartas, arriba Azul 5, color en vigor azul, 0 puntos/);

	await ana.keyboard.press('Shift+S');
	await expectAnnouncement(ana, /Berto: 3 cartas, 0 puntos/);
	const heard: string[] = await ana.evaluate(() => (window as any).__announcements ?? []);
	const rivals = heard.filter(line => /^Berto: /.test(line)).pop()!;
	expect(rivals).not.toMatch(/Ana:/);
});

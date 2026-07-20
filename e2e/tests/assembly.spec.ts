// assembly.spec.ts — the assembly family on "Taller Galáctico", end to end.
//
// Two real browsers, Spanish, real SignalR. The E2E identity shuffle keeps the deck in
// cards.json order and DEALS from its tail — the package deliberately ends with
// [refrigerante×4, sobrecarga×4, reactor×5], so the opening two-player deal is KNOWN:
//   Ana:   [reactor#4, reactor#2, reactor#0]
//   Berto: [reactor#3, reactor#1, sobrecarga#3]
// and the refills pop sobrecarga#2, #1, #0, then refrigerante#3, #2… in that order.
//
// The story exercises the whole loop: install a piece, an auto-targeted attack (single
// victim + single slot: no picker), the colour-taken refusal, a face-down discard with its
// private refill voice, repairs on both sides, and the shared status line (panel + S key).

import { test, expect } from '../helpers/test';
import {
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	resetDice,
	startGame,
} from '../helpers/game';

const BOARD = 'taller-galactico';

test.beforeEach(async () => {
	await resetDice();
});

test('assembly: install, auto-targeted breakdown, refusal, face-down discard, repairs and status', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// ── The table at start: 3-card hands, both piles counted, one rack per player. ──
	const anaCards = ana.locator('.hand-card:not(.hand-card--info)');
	await expect(anaCards).toHaveCount(3);
	await expect(anaCards.locator('[data-card-art="package"]')).toHaveCount(3);
	await expect(anaCards.first()).toHaveAttribute('aria-label', /Reactor/);
	await expect(ana.locator('.hand-card--info')).toHaveAttribute('aria-label', /Mazo: 62/);
	await expect(ana.locator('#board .assembly-rack')).toHaveCount(2);
	// No draw button: the refill is automatic in this family.
	await expect(ana.locator('.hand-panel__draw')).toHaveCount(0);
	await expect(ana.locator('.dice-control')).toBeHidden();

	// ── Per-card HELP (live-play request): the row's Ayuda opens a reading dialog with
	// what the card does, and lands back on the hand when closed. ──
	await anaCards.first().locator('[data-focus-id="help"]').click();
	const helpDialog = ana.locator('.game-dialog.dialog-card-help');
	await expect(helpDialog).toBeVisible();
	await expect(helpDialog).toContainText(/4 sistemas distintos operativos/);
	await helpDialog.locator('.btn-primary').click();
	await expect(helpDialog).toBeHidden();

	// ── Ana installs her Reactor (Enter, no targeting) and hears her refill privately. ──
	await ana.locator('#board').focus();
	await expect(anaCards.first()).toBeFocused();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana instala un módulo/);
	await expectAnnouncement(berto, /Reactor/);
	await expectAnnouncement(ana, /Robas 1/);
	await expectAnnouncement(ana, /Sobrecarga/); // the drawn identity: hers alone
	await expect(ana.locator('#board .assembly-rack').first().locator('.assembly-module')).toHaveCount(1);
	await expect(ana.locator('#board .assembly-rack').first().locator('[data-card-art="package"]')).toHaveCount(1);
	await expect(ana.locator('#board .assembly-rack').first()).toContainText('1/4');

	// ── Berto throws his Sobrecarga: ONE victim with ONE slot → no picker, straight hit. ──
	await berto.locator('#board').focus();
	const bertoCards = berto.locator('.hand-card:not(.hand-card--info)');
	await bertoCards.nth(2).focus();
	await expect(bertoCards.nth(2)).toHaveAttribute('aria-label', /Sobrecarga/);
	await berto.keyboard.press('Enter');
	// The victim hears the themed second-person line; her slot shows broken everywhere.
	await expectAnnouncement(ana, /sobrecarga tu reactor/i);
	await expect(berto.locator('.player-card[data-player-id]').first()).toContainText('averiado');
	await expect(ana.locator('#board .assembly-rack').first()).toContainText('0/4');
	// Visual echo: her reactor module reads as broken, and the three bays still to fill show as
	// empty placeholders (progress toward the goal at a glance). All aria-hidden.
	const anaRack = ana.locator('#board .assembly-rack').first();
	await expect(anaRack.locator('.assembly-module--afflicted')).toHaveCount(1);
	await expect(anaRack.locator('.assembly-bay')).toHaveCount(3);

	// ── Ana: a second Reactor is REFUSED with the reason — the panel offers the discard
	// in the same breath (its designed unplayable-card flow) and she takes it. ──
	await ana.locator('#board').focus();
	await ana.keyboard.press('Enter');
	const discardOffer = ana.locator('.game-dialog', { hasText: /Ya tienes un módulo de ese sistema/ });
	await expect(discardOffer).toBeVisible();
	await discardOffer.locator('.btn-primary').click();
	await expectAnnouncement(berto, /Ana descarta 1 carta/);
	await expect(ana.locator('.hand-card--info')).toHaveAttribute('aria-label', /Descartes: 1/);

	// ── Berto installs his own Reactor; Ana breaks it right back. ──
	await berto.locator('#board').focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto instala un módulo/);

	await ana.locator('#board').focus();
	const anaAttack = ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Sobrecarga/ }).first();
	await anaAttack.focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /sobrecarga tu reactor/i);

	// ── Berto repairs with his Refrigerante (single own slot → no picker). ──
	await berto.locator('#board').focus();
	const bertoFix = berto.locator('.hand-card:not(.hand-card--info)', { hasText: /Refrigerante/ }).first();
	await bertoFix.focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto hace mantenimiento/);
	await expectAnnouncement(ana, /Refrigerante/);
	// The remedy OUTCOME is voiced too (live-play: cure/shield/lock all sounded alike).
	await expectAnnouncement(ana, /Berto repara su Reactor/);
	await expectAnnouncement(berto, /Reparas tu Reactor/);

	// ── Ana repairs hers too, and the S key tells the shared story: 1 of 4 running. ──
	await ana.locator('#board').focus();
	const anaFix = ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Refrigerante/ }).first();
	await anaFix.focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana hace mantenimiento/);

	await ana.locator('#board').focus();
	await ana.keyboard.press('s');
	await expectAnnouncement(ana, /1 de 4 sistemas operativos/);
	await expectAnnouncement(ana, /Reactor \(operativo\)/);

	// ── Shift+S surveys the OTHERS only (live-play: "mi info ya me la sé con la S"). ──
	await ana.keyboard.press('Shift+S');
	await expectAnnouncement(ana, /Berto: 1 de 4 sistemas operativos/);
	const heard: string[] = await ana.evaluate(() => (window as any).__announcements ?? []);
	const table = heard.filter(line => /Berto: 1 de 4/.test(line)).pop()!;
	expect(table).not.toMatch(/Ana:/);
});

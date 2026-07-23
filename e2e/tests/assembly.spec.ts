// assembly.spec.ts — the assembly family on "Galactic Workshop", end to end.
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
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	resetDice,
	startGame,
	watchAnnouncementBeforeHandUpdate,
} from '../helpers/game';

const BOARD = 'galactic-workshop';

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
	await expect(ana.locator('.hand-card--info')).toHaveCount(0);
	await expect(ana.locator('.assembly-piles [data-pile="deck"] .gcard__back-label')).toHaveText('62');
	await expect(ana.locator('.assembly-piles [data-pile="discard"] .gcard__back-label')).toHaveText('0');
	await expect(ana.locator('#board .assembly-rack')).toHaveCount(2);
	const pileSize = await ana.locator('.assembly-piles [data-pile="deck"] .gcard').evaluate(element => {
		const style = getComputedStyle(element);
		return { width: style.width, height: style.height };
	});
	expect(pileSize).toEqual({ width: '92px', height: '128px' });
	// No draw button: the refill is automatic in this family.
	await expect(ana.locator('.hand-panel__draw')).toHaveCount(0);
	await expect(ana.locator('.dice-control')).toBeHidden();
	await anaCards.first().focus();
	await ana.keyboard.press('d');
	await expectAnnouncement(ana, /Mazo: 62\. Descartes: 0\./);
	await expect(anaCards.first()).toBeFocused();

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
	const finishInstallOrder = await watchAnnouncementBeforeHandUpdate(ana, /Instalas un módulo/);
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /Ana instala un módulo/);
	await expectAnnouncement(berto, /Reactor/);
	await expectAnnouncement(ana, /Robas 1/);
	await expectAnnouncement(ana, /Sobrecarga/); // the drawn identity: hers alone
	// Exact JAWS regression: the complete ARIA sentence gets a substantial head start
	// before playing removes the focused card and auto-refill inserts its replacement.
	const installOrder = await finishInstallOrder();
	expect(installOrder.handUpdateAt - installOrder.announcementAt).toBeGreaterThanOrEqual(300);
	const installStory = ana.locator('.visual-narrative');
	await expect(installStory).toBeVisible();
	await expect(installStory).toContainText(/Instalas un módulo.*Robas 1.*Sobrecarga/i);
	await expect(installStory).toHaveAttribute('aria-hidden', 'true');
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
	await expect(ana.locator('.visual-narrative')).toContainText(/sobrecarga tu reactor/i);
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
	const finishDiscardOrder = await watchAnnouncementBeforeHandUpdate(ana, /Descartas 1 carta/);
	await discardOffer.locator('.btn-primary').click();
	await expectAnnouncement(berto, /Ana descarta 1 carta/);
	const discardOrder = await finishDiscardOrder();
	expect(discardOrder.handUpdateAt - discardOrder.announcementAt).toBeGreaterThanOrEqual(300);
	await expect(ana.locator('.assembly-piles [data-pile="discard"] .gcard__back-label')).toHaveText('1');
	await ana.locator('.hand-card').first().focus();
	await ana.keyboard.press('d');
	await expectAnnouncement(ana, /Descartes: 1\./);

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

	// ── Shift+S surveys the OTHERS only; S already covers the local player's status. ──
	await ana.keyboard.press('Shift+S');
	await expectAnnouncement(ana, /Berto: 1 de 4 sistemas operativos/);
	const heard: string[] = await ana.evaluate(() => (window as any).__announcements ?? []);
	const table = heard.filter(line => /Berto: 1 de 4/.test(line)).pop()!;
	expect(table).not.toMatch(/Ana:/);
});

test('assembly: a scrapped empty hand passes and refills automatically instead of blocking', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	const discardAndAdvance = async (
		page: typeof ana,
		nextPage: typeof ana,
		nextPlayer: string,
	): Promise<void> => {
		const previousTurnLines = await nextPage.evaluate(() =>
			((window as any).__announcements as string[] ?? [])
				.filter(line => /Es tu turno/i.test(line)).length);
		await page.locator('#board').focus();
		const discarded = page.locator('.hand-card:not(.hand-card--info)').first();
		const discardedId = await discarded.getAttribute('data-focus-id');
		await discarded.focus();
		await page.keyboard.press('Delete');
		const confirmation = page.locator('.game-dialog.dialog-confirm');
		await expect(confirmation).toBeVisible();
		await flushAxeAudit(page);
		await confirmation.locator('.btn-primary').click();
		if (discardedId) {
			await expect(page.locator(`.hand-card[data-focus-id="${discardedId}"]`)).toHaveCount(0);
		}
		await expect(nextPage.locator('#turn-indicator .turn-indicator__name')).toHaveText(nextPlayer);
		await nextPage.waitForFunction((previous: number) =>
			((window as any).__announcements as string[] ?? [])
				.filter(line => /Es tu turno/i.test(line)).length > previous,
		previousTurnLines);
	};

	// Identity shuffle deals from the package tail. Five discard/refill cycles per player
	// bring Imperial Inspection into Ana's hand without bypassing the real UI or server.
	for (let cycle = 0; cycle < 5; cycle++) {
		await discardAndAdvance(ana, berto, 'Berto');
		await discardAndAdvance(berto, ana, 'Ana');
	}

	const inspection = ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Inspección imperial/i });
	await expect(inspection).toHaveCount(1);
	await inspection.focus();
	await ana.keyboard.press('Enter');

	// Berto has no decision to make: the server passes his empty turn, gives him three
	// private cards and returns play to Ana. No draw/pass button or client rescue is needed.
	await expectAnnouncement(berto, /Pasas \(sin cartas\)/i);
	await expectAnnouncement(berto, /Robas 3:/i);
	await expect(berto.locator('.hand-card:not(.hand-card--info)')).toHaveCount(3);
	await expect(berto.locator('.visual-narrative')).toContainText(/Robas 3:/i);
	await expect(ana.locator('#turn-indicator .turn-indicator__name')).toHaveText('Ana');
});

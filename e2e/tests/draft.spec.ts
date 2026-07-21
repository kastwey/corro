// draft.spec.ts — the draft family (simultaneous pick-and-pass genre) on "The Grand Tapas Feast",
// end to end.
//
// Two real browsers, Spanish, real SignalR. The E2E identity shuffle keeps the deck in
// cards.json order and DEALS from its tail — the package deliberately ends with
// [spicy-sauce×6, tortilla×10, gamba×4] = exactly the 20 cards two players are dealt, so
// both opening hands are KNOWN: 2 prawn skewers, 5 omelette bites and 3 brava sauces.
//
// The story exercises the whole loop: the secret pick (identity private, "who picked"
// public), the RE-pick, the simultaneous reveal, the leftward tray rotation, a points
// card landing on a waiting multiplier, the shared status line (S / Shift+S), a full
// round played out to its scoring, the round-two redeal — and the tongs: round two
// deals them (the 4 pinzas sit right before the round-one tail), so the double pick
// rides the REAL multi-select mode (Ctrl+Space, Space marks, Enter sends).

import { test, expect } from '../helpers/test';
import {
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	resetDice,
	startGame,
} from '../helpers/game';

const BOARD = 'grand-tapas-feast';

test.beforeEach(async () => {
	await resetDice();
});

test('draft: secret pick, re-pick, reveal, tray rotation, boosted serve, status and a full scored round', async ({ browser }) => {
	test.setTimeout(120_000); // a full 10-trick round is many interactions

	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// ── The table at start: 10-card hands, the deck counted, one table per player,
	// and NO dice / draw / discard — the pick is the whole turn. (The round-opening
	// line is announced while the browsers are still navigating, so it isn't
	// assertable here; round TWO's is, below.) ──
	const anaCards = ana.locator('.hand-card:not(.hand-card--info)');
	await expect(anaCards).toHaveCount(10);
	await expect(anaCards.locator('[data-card-art="package"]')).toHaveCount(10);
	await expect(ana.locator('.hand-card--info')).toHaveAttribute('aria-label', /Mazo: 89/);
	await expect(ana.locator('#board .draft-table')).toHaveCount(2);
	await expect(ana.locator('.hand-panel__draw')).toHaveCount(0);
	await expect(ana.locator('.dice-control')).toBeHidden();
	await expect(anaCards.first().locator('[data-focus-id="discard"]')).toHaveCount(0);

	// ── Per-card HELP: the sauce explains its multiplier and lands back on the hand. ──
	const anaSauce = ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Salsa brava/ }).first();
	await anaSauce.locator('[data-focus-id="help"]').click();
	const helpDialog = ana.locator('.game-dialog.dialog-card-help');
	await expect(helpDialog).toBeVisible();
	await expect(helpDialog).toContainText(/multiplica por 3/);
	await helpDialog.locator('.btn-primary').click();
	await expect(helpDialog).toBeHidden();

	// ── Trick 1: Ana picks a skewer, hears it PRIVATELY, then CHANGES to the sauce.
	// Berto only ever hears WHO picked, never what. ──
	await ana.locator('#board').focus();
	const anaGamba = ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Pincho de gamba/ }).first();
	await anaGamba.focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /Pides Pincho de gamba\. Esperando al resto de la mesa\./);
	await expectAnnouncement(berto, /Ana ya ha pedido/);

	await anaSauce.focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /Cambias tu petición a Salsa brava/);

	// Berto commits his skewer: the LAST pick fires the simultaneous reveal.
	await berto.locator('#board').focus();
	const bertoGamba = berto.locator('.hand-card:not(.hand-card--info)', { hasText: /Pincho de gamba/ }).first();
	await bertoGamba.focus();
	await berto.keyboard.press('Enter');

	await expectAnnouncement(ana, /¡Toda la mesa ha pedido!/);
	// Ana's own PLAIN reveal is deliberately NOT echoed back to her (she already heard her pick,
	// then her re-pick): the picker only hears the RIVALS' serves and the belt turning. Her own
	// line returns when it is BOOSTED — see trick 2 below ("Te sirves … con tu Salsa brava").
	await expectAnnouncement(ana, /Berto se sirve Pincho de gamba/);
	await expectAnnouncement(ana, /Gira la cinta de bandejas: 9 tapas en cada una/);

	// The reveal is public on every table (Ana's sauce chip, Berto's skewer chip).
	await expect(berto.locator('#board .draft-table').first()).toContainText('Salsa brava');
	await expect(berto.locator('#board .draft-table').nth(1)).toContainText('Pincho de gamba');
	await expect(anaCards).toHaveCount(9);

	// ── Trick 2: the rotated tray brings Ana a new skewer — it lands ON her sauce. ──
	await ana.locator('#board').focus();
	await ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Pincho de gamba/ }).first().focus();
	await ana.keyboard.press('Enter');
	await berto.locator('#board').focus();
	await berto.locator('.hand-card:not(.hand-card--info)', { hasText: /Pincho de gamba/ }).first().focus();
	await berto.keyboard.press('Enter');

	await expectAnnouncement(ana, /Te sirves Pincho de gamba con tu Salsa brava \(por 3\)/);
	await expectAnnouncement(berto, /Ana se sirve Pincho de gamba con su Salsa brava \(por 3\)/);
	await expectAnnouncement(ana, /cinta de bandejas: 8 tapas/);

	// ── The shared status line: S = my story, Shift+S = the rivals only. ──
	await ana.locator('#board').focus();
	await ana.keyboard.press('s');
	await expectAnnouncement(ana, /ronda 1 de 3/);
	await expectAnnouncement(ana, /Pincho de gamba con Salsa brava \(por 3\)/);

	await ana.keyboard.press('Shift+S');
	await expectAnnouncement(ana, /Berto: ronda 1 de 3/);
	const heard: string[] = await ana.evaluate(() => (window as any).__announcements ?? []);
	const rivals = heard.filter(line => /^Berto: ronda/.test(line)).pop()!;
	expect(rivals).not.toMatch(/Ana:/);

	// ── Play the round out: both keep taking the top of whatever tray arrives. The
	// rotation line's shrinking count proves every trick resolved in order. ──
	for (let trick = 3; trick <= 9; trick++) {
		await ana.locator('#board').focus();
		await ana.keyboard.press('Enter');
		await berto.locator('#board').focus();
		await berto.keyboard.press('Enter');
		await expectAnnouncement(ana, new RegExp(`cinta de bandejas: ${10 - trick} tapas`));
	}
	await ana.locator('#board').focus();
	await ana.keyboard.press('Enter');
	await berto.locator('#board').focus();
	await berto.keyboard.press('Enter');

	// ── The hands ran out: the round is scored out loud and round two is dealt. ──
	await expectAnnouncement(ana, /Ronda 1: sumas \d+ puntos, \d+ en total/);
	await expectAnnouncement(ana, /Ronda 1: Berto suma \d+ puntos/);
	await expectAnnouncement(ana, /Ronda 2: se reparten 10 cartas/);
	await expect(anaCards).toHaveCount(10);
	await expect(ana.locator('.hand-card--info')).toHaveAttribute('aria-label', /Mazo: 69/);

	// ── Round two dealt the tongs. Trick 1: Ana serves them (a plain pick). ──
	await ana.locator('#board').focus();
	await ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Pinzas de servir/ }).first().focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /Pides Pinzas de servir/);
	await berto.locator('#board').focus();
	await berto.locator('.hand-card:not(.hand-card--info)', { hasText: /Montadito/ }).first().focus();
	await berto.keyboard.press('Enter');
	await expect(berto.locator('#board .draft-table').first()).toContainText('Pinzas de servir');

	// ── Trick 2: the double pick through the REAL multi-select mode. Ctrl+Space
	// switches (spoken), Space marks with a running count, Enter sends — the first
	// marked card is served first. ──
	await ana.locator('#board').focus();
	await ana.keyboard.press('Control+Space');
	await expectAnnouncement(ana, /Modo selección múltiple: marca cartas con Espacio/);

	await ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Banderilla/ }).first().focus();
	await ana.keyboard.press('Space');
	await expectAnnouncement(ana, /Banderilla, marcada\. Seleccionadas: 1\./);
	await ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Montadito/ }).first().focus();
	await ana.keyboard.press('Space');
	await expectAnnouncement(ana, /Montadito, marcada\. Seleccionadas: 2\./);
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /Pides Banderilla y Montadito/);

	await berto.locator('#board').focus();
	await berto.locator('.hand-card:not(.hand-card--info)', { hasText: /Montadito/ }).first().focus();
	await berto.keyboard.press('Enter');

	// The reveal serves both tapas and the tongs rejoin the passing tray — the
	// spender hears the second person, the table the third.
	await expectAnnouncement(ana, /Gastas tus Pinzas de servir: vuelven a la bandeja que pasas/);
	await expectAnnouncement(berto, /Ana gasta sus Pinzas de servir: vuelven a la bandeja que pasa/);
	await expect(berto.locator('#board .draft-table').first()).not.toContainText('Pinzas de servir');
	await expect(berto.locator('#board .draft-table').first()).toContainText('Banderilla');
	await expect(anaCards).toHaveCount(8); // played two, and the tongs left with the tray
});

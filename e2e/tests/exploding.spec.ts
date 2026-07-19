// exploding.spec.ts — the exploding family on "La Mina", end to end.
//
// Two real browsers, Spanish, real SignalR. The E2E identity shuffle keeps the deck in
// cards.json order and DEALS from its tail, so the opening hands and the draw pile are KNOWN
// (pinned in LaMinaPackageTests): both openers hold a defuse ("Cortar la mecha") and the single
// planted bomb ("Grisú") sits on TOP of the pile. The story: draw the bomb, defuse it and tuck
// it back on top, and — a defuse spent — explode into the last-player-standing win.

import { test, expect } from '../helpers/test';
import {
	createGame, expectAnnouncement, joinGame, newPlayerPage, resetDice, startGame,
} from '../helpers/game';

const BOARD = 'la-mina';

test.beforeEach(async () => {
	await resetDice();
});

test('exploding: draw the bomb, defuse and tuck it, then explode into a win', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// 8-card opening hands (1 defuse + 7), the draw affordance (Space), no dice.
	await expect(ana.locator('.hand-card:not(.hand-card--info)')).toHaveCount(8);
	await expect(ana.locator('.hand-panel__draw')).toBeVisible();
	await expect(ana.locator('.dice-control')).toBeHidden();

	const tuckOnTop = (page: typeof ana) =>
		page.locator('.popup-menu__item', { hasText: /Arriba/ }).click();

	// ── Ana's first draw is the planted bomb; she holds a defuse and tucks it back on top. ──
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(berto, /Ana destapa gris.*corta la mecha/i);
	await expectAnnouncement(ana, /Destapas gris.*cortas la mecha/i);
	await tuckOnTop(ana);
	await expectAnnouncement(ana, /Escondes el gris/i);

	// ── Berto meets the same bomb on top; he defuses and tucks it back on top too. ──
	await berto.locator('#board').focus();
	await berto.keyboard.press(' ');
	await expectAnnouncement(ana, /Berto destapa gris/i);
	await tuckOnTop(berto);

	// ── Ana draws the bomb again — her defuse is spent, so she explodes and Berto wins. ──
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(berto, /Estalla el gris.*Ana queda sepultad/i);
	await expectAnnouncement(ana, /Estalla el gris.*quedas sepultad/i);

	// The game is over: the last miner standing wins.
	await expect(ana.locator('.end-screen')).toBeVisible();
});

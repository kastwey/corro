// exploding.spec.ts — the exploding family on "The Mine", end to end.
//
// Two real browsers, Spanish, real SignalR. The E2E identity shuffle keeps the deck in
// cards.json order and DEALS from its tail, so the opening hands and the draw pile are KNOWN
// (pinned in MinePackageTests): both openers hold a defuse and the single planted bomb sits on
// TOP of the pile. The story: draw the bomb, defuse it and tuck
// it back on top, and — a defuse spent — explode into the last-player-standing win.

import { test, expect } from '../helpers/test';
import {
	createGame, expectAnnouncement, joinGame, newPlayerPage, resetDice, scriptDice, startGame,
} from '../helpers/game';

const BOARD = 'the-mine';

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
	await ana.evaluate(() => {
		const timeline = { announcement: 0, reveal: 0, menu: 0 };
		(window as any).__defuseTimeline = timeline;
		const sample = () => {
			const now = performance.now();
			const liveText = [...document.querySelectorAll('#sr-live, #sr-live-assertive')]
				.map(node => node.textContent ?? '').join(' ');
			if (!timeline.announcement && /grisú/i.test(liveText)) timeline.announcement = now;
			if (!timeline.reveal && document.querySelector('.exploding-reveal--defusing')) timeline.reveal = now;
			if (!timeline.menu && document.querySelector('.popup-menu[role="menu"]')) timeline.menu = now;
		};
		const observer = new MutationObserver(sample);
		observer.observe(document.body, { subtree: true, childList: true, characterData: true });
		(window as any).__defuseTimelineObserver = observer;
	});
	await ana.keyboard.press(' ');
	const anaReveal = ana.locator('.exploding-reveal--defusing');
	await expect(anaReveal).toBeVisible();
	await expect(anaReveal).toHaveClass(/exploding-reveal--static/);
	await expect(ana.locator('.exploding-reveal__defuse .xcard--defuse')).toBeVisible();
	await expect(ana.locator('.popup-menu[role="menu"]')).toHaveCount(0);
	await expectAnnouncement(berto, /Ana destapa gris.*corta la mecha/i);
	await expectAnnouncement(ana, /Destapas gris.*cortas la mecha/i);
	await expect(ana.locator('.popup-menu[role="menu"]')).toBeVisible();
	const timeline = await ana.evaluate(() => {
		(window as any).__defuseTimelineObserver?.disconnect();
		return (window as any).__defuseTimeline as { announcement: number; reveal: number; menu: number };
	});
	expect(timeline.announcement).toBeGreaterThan(0);
	expect(timeline.reveal).toBeGreaterThanOrEqual(timeline.announcement);
	expect(timeline.menu - timeline.announcement).toBeGreaterThanOrEqual(1800);
	await tuckOnTop(ana);
	await expectAnnouncement(ana, /Escondes el gris/i);

	// Exercise the same transient animation and picker in the dark theme. The package-driven
	// defuse face is shared by every exploding-family board; only its art and wording differ.
	await berto.locator('#theme-toggle').click();
	await expect(berto.locator('html')).toHaveAttribute('data-theme', 'dark');

	// ── Berto meets the same bomb on top; he defuses and tucks it back on top too. ──
	await berto.locator('#board').focus();
	await berto.keyboard.press(' ');
	const bertoReveal = berto.locator('.exploding-reveal--defusing');
	await expect(bertoReveal).toBeVisible();
	await expect(bertoReveal).toHaveClass(/exploding-reveal--static/);
	await expect(berto.locator('.popup-menu[role="menu"]')).toHaveCount(0);
	await expectAnnouncement(ana, /Berto destapa gris/i);
	await expectAnnouncement(berto, /Destapas gris.*cortas la mecha/i);
	await expect(berto.locator('.popup-menu[role="menu"]')).toBeVisible();
	await tuckOnTop(berto);

	// ── Ana draws the bomb again — her defuse is spent, so she explodes and Berto wins. ──
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(berto, /Estalla el gris.*Ana queda sepultad/i);
	await expectAnnouncement(ana, /Estalla el gris.*quedas sepultad/i);

	// The game is over: the last miner standing wins.
	await expect(ana.locator('.end-screen')).toBeVisible();
	await expect(berto.locator('.end-screen')).toBeVisible();
});

test('exploding: announces an ordinary draw before adding the card to the hand', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Move the planted bomb to the bottom so Berto's next draw is the known ordinary
	// card immediately below it (defuse #5).
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(ana, /Destapas gris.*cortas la mecha/i);
	await ana.locator('.popup-menu__item', { hasText: /Abajo del todo/ }).click();
	await expectAnnouncement(berto, /Es tu turno/i);

	const cards = berto.locator('.hand-card:not(.hand-card--info)');
	await expect(cards).toHaveCount(8);
	await berto.locator('#board').focus();

	// The screen-reader regression is about DOM mutation order. The own-action line must
	// reach the assertive live region synchronously, before the state repaint mutates the
	// hand list; otherwise the reader starts describing the changed list first.
	await berto.evaluate(() => {
		const order: string[] = [];
		(window as any).__drawMutationOrder = order;
		const observer = new MutationObserver(records => {
			for (const record of records) {
				const target = record.target instanceof Element
					? record.target
					: record.target.parentElement;
				if (target?.closest('[aria-live]')) {
					const addedText = [...record.addedNodes].map(node => node.textContent ?? '').join('').trim();
					if (addedText && !order.includes('announcement')) order.push('announcement');
				}
				if (target?.closest('.hand-panel__list') && !order.includes('hand')) order.push('hand');
			}
		});
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
		});
		(window as any).__drawMutationObserver = observer;
	});

	await berto.keyboard.press(' ');
	await expectAnnouncement(berto, /Robas Cortar la mecha/i);
	await expect(cards).toHaveCount(9);

	const mutationOrder = await berto.evaluate(() => {
		(window as any).__drawMutationObserver?.disconnect();
		return (window as any).__drawMutationOrder as string[];
	});
	expect(mutationOrder.indexOf('announcement')).toBeGreaterThanOrEqual(0);
	expect(mutationOrder.indexOf('hand')).toBeGreaterThanOrEqual(0);
	expect(mutationOrder.indexOf('announcement')).toBeLessThan(mutationOrder.indexOf('hand'));

	// Continue through the known identity-shuffled pile until Berto holds two matching
	// Escarabajos. Selecting either ONE row is deliberately enough: there is no legal
	// one-cat play and the matching copies are interchangeable, so the client sends both.
	const anaCards = ana.locator('.hand-card:not(.hand-card--info)');
	const drawAndExpect = async (page: typeof ana, expectedCards: number) => {
		await page.locator('#board').focus();
		await page.keyboard.press(' ');
		await expect(page.locator('.hand-card:not(.hand-card--info)')).toHaveCount(expectedCards);
	};
	await drawAndExpect(ana, 8);    // Cortar la mecha #4
	await drawAndExpect(berto, 10); // Cortar la mecha #3
	await drawAndExpect(ana, 9);    // Cortar la mecha #2
	await drawAndExpect(berto, 11); // Escarabajo #3
	await drawAndExpect(ana, 10);   // Escarabajo #2
	await drawAndExpect(berto, 12); // Escarabajo #1: Berto now has a pair
	await drawAndExpect(ana, 11);   // Escarabajo #0: back to Berto's turn

	const beetles = berto.locator('.hand-card:not(.hand-card--info)', {
		hasText: 'Escarabajo pelotero',
	});
	await expect(beetles).toHaveCount(2);
	await beetles.first().focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(berto,
		/Elige a quién robar con dos cartas iguales de Escarabajo pelotero/i);
	// The E2E random source fails loudly without a scripted index. Steal Ana's first card.
	await scriptDice(0);
	await berto.locator('.popup-menu__item', { hasText: 'Ana' }).click();

	await expectAnnouncement(berto,
		/Juegas dos cartas iguales de Escarabajo pelotero para robar una carta a Ana/i);
	await expectAnnouncement(ana,
		/Berto juega dos cartas iguales de Escarabajo pelotero para robar una carta a Ana/i);
	await expect(beetles).toHaveCount(0); // both copies were spent by that one activation
	await expectAnnouncement(berto, /Robas .* a Ana/i);
	await expect(anaCards).toHaveCount(10); // the resolved steal removed one of Ana's cards
});

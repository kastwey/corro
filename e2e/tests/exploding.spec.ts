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
	watchAnnouncementBeforeHandUpdate,
} from '../helpers/game';
import { flushAxeAudit } from '../helpers/axeAudit';

const BOARD = 'the-mine';

test.beforeEach(async () => {
	await resetDice();
});

test('exploding: the playable filter keeps the hand stable when an action ends the turn', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	const cards = ana.locator('.hand-card:not(.hand-card--info)');
	const allCards = ana.locator('.hand-panel__list-actions [data-focus-id="show-all-cards"]');
	const filter = ana.locator('.hand-panel__list-actions [data-focus-id="filter-playable"]');
	await expect(cards).toHaveCount(8);
	await expect(ana.locator('.player-card.is-current .player-card__turn')).toHaveText('Turno');
	await expect(allCards).toHaveAttribute('aria-pressed', 'true');
	await filter.click();
	await expect(filter).toHaveAttribute('aria-pressed', 'true');
	await expect(allCards).toHaveAttribute('aria-pressed', 'false');
	await expect(cards).toHaveCount(7); // the Defuse is not hand-playable

	// Playing Skip removes only that card. The one-second Nope window must not transiently
	// empty the rest of the filtered hand while the action waits to resolve.
	const skip = cards.filter({ hasText: 'Salir del pozo' }).first();
	await skip.focus();
	await ana.keyboard.press('Enter');
	await expect(ana.locator('.exploding-discard--pending')).toBeVisible();
	await expect(ana.locator('.visual-narrative')).toContainText(/Juegas Salir del pozo/i);
	await expect(cards).toHaveCount(6);
	await flushAxeAudit(ana);

	// Skip resolves by ending Ana's turn. The same six rule-playable cards remain in the
	// filtered list instead of disappearing merely because Berto now owns the turn.
	await expectAnnouncement(ana, /Sales del pozo sin picar/i);
	await expectAnnouncement(berto, /Es tu turno/i);
	await expect(cards).toHaveCount(6);
	await expect(cards.locator('.hand-card--unplayable')).toHaveCount(0);
	await expect(filter).toHaveAttribute('aria-pressed', 'true');

	// Turn ownership is still enforced at activation time and spoken without mutating the hand.
	await cards.first().focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /No es tu turno/i);
	await expect(cards).toHaveCount(6);
	await flushAxeAudit(ana);
});

test('exploding: playable-first priority composes with family orders and is persisted', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	const cards = ana.locator('.hand-card:not(.hand-card--info)');
	const allCards = ana.locator(
		'.hand-panel__list-actions [data-focus-id="show-all-cards"]');
	const priority = ana.locator(
		'.hand-panel__list-actions [data-focus-id="prioritize-playable"]');
	const filter = ana.locator(
		'.hand-panel__list-actions [data-focus-id="filter-playable"]');
	await expect(cards).toHaveCount(8);
	await expect(ana.locator(
		'.hand-card:not(.hand-card--info).hand-card--unplayable')).toHaveCount(1);
	await expect(priority).toHaveText('Jugables primero');
	await expect(allCards).toHaveAttribute('aria-pressed', 'true');
	await expect(priority).toHaveAttribute('aria-pressed', 'false');

	// Original order and card display are separate radio choices. The row menu exposes the
	// display modes as one named radio submenu, including the neutral way back to all cards.
	await ana.locator('[data-focus-id="sort-hand"]').click();
	await cards.first().focus();
	await ana.keyboard.press('Shift+F10');
	const menu = ana.locator('.hand-context-menu');
	expect(await menu.evaluate(element => element.closest('main') !== null)).toBe(true);
	await menu.getByRole('menuitem', { name: 'Mostrar cartas', exact: true }).click();
	const displayRadios = menu.getByRole('menuitemradio');
	await expect(displayRadios).toHaveCount(3);
	await expect(displayRadios).toHaveText(['Todas las cartas', 'Jugables primero', 'Solo jugables']);
	await expect(displayRadios.nth(0)).toHaveAttribute('aria-checked', 'true');
	await expect(displayRadios.nth(1)).toHaveAttribute('aria-checked', 'false');
	await expect(displayRadios.nth(2)).toHaveAttribute('aria-checked', 'false');
	await flushAxeAudit(ana);

	// Once playable-first is selected, it replaces all-cards and every playable card forms
	// the leading tier.
	await displayRadios.nth(1).click();
	await expect(priority).toHaveAttribute('aria-pressed', 'true');
	await expect(allCards).toHaveAttribute('aria-pressed', 'false');
	await expect(filter).toHaveAttribute('aria-pressed', 'false');
	await expectAnnouncement(ana, /Las cartas jugables aparecen ahora antes que las demás/i);
	const tiers = () => cards.evaluateAll(rows => rows.map(row =>
		!row.classList.contains('hand-card--unplayable')));
	expect(await tiers()).toEqual([true, true, true, true, true, true, true, false]);
	await flushAxeAudit(ana);

	// Changing the secondary family order cannot move an unplayable card above that tier.
	await ana.locator('[data-focus-id="sort-name"]').click();
	expect(await tiers()).toEqual([true, true, true, true, true, true, true, false]);
	await expect(priority).toHaveAttribute('aria-pressed', 'true');
	await flushAxeAudit(ana);

	expect(await ana.evaluate(() => JSON.parse(
		localStorage.getItem('corro.handPreferences.exploding') ?? '{}'))).toEqual({
		sort: 'name', playabilityMode: 'first',
	});
});

test('exploding: asks for a target only when several active rivals remain', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const carla = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await joinGame(carla, code, 'Carla');
	await startGame(ana, [ana, berto, carla]);

	// In the deterministic three-player deal Ana starts with a Favor. Two legal victims are
	// a real decision, so the accessible picker remains and lists both in seat order.
	const favor = ana.locator('.hand-card:not(.hand-card--info)', { hasText: 'Pico prestado' });
	await expect(favor).toBeVisible();
	await favor.focus();
	await ana.keyboard.press('Enter');

	const menu = ana.locator('.popup-menu[role="menu"]');
	await expect(menu).toBeVisible();
	await expect(menu.locator('.popup-menu__item')).toHaveText(['Berto', 'Carla']);
	await expectAnnouncement(ana, /Elige a quién aplicar Pico prestado/i);
	await flushAxeAudit(ana);

	await menu.locator('.popup-menu__item', { hasText: 'Berto' }).click();
	await expectAnnouncement(ana, /Pides un favor a Berto/i);
	await expectAnnouncement(berto, /Ana te pide un favor/i);
	await expect(berto.locator('.visual-narrative')).toContainText(/Ana te pide un favor/i);
	await expect(berto.locator('.hand-panel')).toHaveClass(/hand-panel--favor-choice/);

	// Finish the pending Favor so the scenario leaves the real-time flow settled.
	const payment = berto.locator('.hand-card:not(.hand-card--info)').first();
	await payment.focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /Berto te da/i);
	await expect(ana.locator('.visual-narrative')).toContainText(/Berto te da/i);
	await expect(berto.locator('.hand-panel')).not.toHaveClass(/hand-panel--favor-choice/);
});

test('exploding: future, attack and shuffle keep a persistent visual account', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// See the Future is private: Ana gets three real faces; Berto gets three backs with the
	// public action sentence. Both remain visible after the transient emphasis settles.
	const future = ana.locator('.hand-card:not(.hand-card--info)', { hasText: 'El canario' }).first();
	await future.focus();
	await ana.keyboard.press('Enter');
	await expect(ana.locator('.exploding-discard--pending')).toBeVisible();
	await flushAxeAudit(ana);
	await expectAnnouncement(ana, /Arriba del mazo:/i);
	await expect(ana.locator('.visual-narrative__peek-card .xcard:not(.xcard--back)')).toHaveCount(3);
	await expect(berto.locator('.visual-narrative__peek-card .xcard--back')).toHaveCount(3);
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);

	// Attack names and highlights the affected next player and leaves the extra-draw story.
	const attack = ana.locator('.hand-card:not(.hand-card--info)', { hasText: 'Derrumbe' }).first();
	await attack.focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /Provocas un derrumbe/i);
	await expect(ana.locator('.visual-narrative')).toContainText(/Provocas un derrumbe/i);
	await expect(ana.locator('.visual-narrative__route')).toHaveText(/Ana.*Berto/i);
	await flushAxeAudit(ana);

	// Berto can act before paying the two draws. Shuffle gets its own persistent deck state.
	const shuffle = berto.locator('.hand-card:not(.hand-card--info)', { hasText: 'Revuelto de galería' });
	await shuffle.focus();
	await berto.keyboard.press('Enter');
	await expectAnnouncement(berto, /Revuelves la galería/i);
	await expect(berto.locator('.visual-narrative')).toContainText(/Revuelves la galería/i);
	await flushAxeAudit(berto);
});

test('exploding: draw the bomb, defuse and tuck it, then explode into a win', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// 8-card opening hands (1 defuse + 7), the draw affordance (Space), no dice. The visual
	// table keeps its pile count, but the accessible hand contains held cards only; D reads
	// that table state without moving focus away from the current card.
	await expect(ana.locator('.hand-card:not(.hand-card--info)')).toHaveCount(8);
	await expect(ana.locator('.hand-card--info')).toHaveCount(0);
	await expect(ana.locator('.exploding-draw .xcard__back-label')).toHaveText(/^\d+$/);
	expect(await ana.locator('.exploding-piles').evaluate(element =>
		getComputedStyle(element).justifyContent)).toBe('center');
	await expect(ana.locator('.hand-panel__draw')).toBeVisible();
	await expect(ana.locator('.dice-control')).toBeHidden();
	const sortTools = ana.locator('.hand-panel__list-actions [data-focus-id^="sort-"]');
	await expect(sortTools).toHaveCount(4);
	expect(await sortTools.evaluateAll(buttons => buttons.map(button =>
		(button as HTMLElement).dataset.focusId))).toEqual([
		'sort-pairs', 'sort-attacks', 'sort-name', 'sort-hand',
	]);
	await expect(ana.locator('[data-focus-id="sort-value"]')).toHaveCount(0);
	await expect(ana.locator('[data-focus-id="sort-pairs"]')).toHaveAttribute('aria-pressed', 'true');

	// No pair card is dealt yet: P says so without moving focus. The shortcut is discoverable
	// in the live help table, and the attack order puts the two Derrumbes at the front.
	const firstCard = ana.locator('.hand-card').first();
	await firstCard.focus();
	await ana.keyboard.press('p');
	await expectAnnouncement(ana, /No tienes ninguna carta de pareja en la mano/i);
	await expect(firstCard).toBeFocused();
	await ana.keyboard.press('Control+F1');
	const shortcuts = ana.locator('.game-dialog.dialog-help:has(.help-shortcuts)');
	await expect(shortcuts).toBeVisible();
	await expect(shortcuts.locator('.help-shortcuts')).toContainText('Ir a la siguiente carta de pareja');
	await flushAxeAudit(ana);
	await shortcuts.locator('.btn-primary').click();
	await ana.locator('[data-focus-id="sort-attacks"]').click();
	await expect(ana.locator('.hand-card:not(.hand-card--info)').first()).toContainText('Derrumbe');
	await flushAxeAudit(ana);

	await firstCard.focus();
	await ana.keyboard.press('d');
	await expectAnnouncement(ana, /Mazo: \d+\. Última carta:/i);
	await expect(firstCard).toBeFocused();

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
	await expect(ana.locator('.visual-narrative')).toContainText(/Escondes el gris/i);

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

	// A guest leaving the finished game navigates only that browser. This is the exact
	// regression for the intermittent report that "Back home" might eject everybody.
	await berto.locator('.dialog-end-screen .btn-primary').click();
	await expect(berto).toHaveURL(/\/$/);
	await expect(ana.locator('.end-screen')).toBeVisible();
	await expect(ana).toHaveURL(/board\.html/);
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

	// The live-region write must complete an event-loop turn before the authoritative
	// repaint inserts the card; simple mutation order inside one turn is not enough for NVDA.
	const finishDrawOrder = await watchAnnouncementBeforeHandUpdate(berto, /Robas Cortar la mecha/i);
	await berto.keyboard.press(' ');
	await expectAnnouncement(berto, /Robas Cortar la mecha/i);
	await expect(cards).toHaveCount(9);
	await expect(berto.locator('.visual-narrative')).toContainText(/Robas Cortar la mecha/i);

	const drawOrder = await finishDrawOrder();
	expect(drawOrder.handUpdateAt - drawOrder.announcementAt).toBeGreaterThanOrEqual(300);

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
	// Pair-first is Berto's default: both matching cards lead the hand and are adjacent. P
	// reaches one directly from the board, without knowing the package's themed card name.
	await expect(berto.locator('[data-focus-id="sort-pairs"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(cards.nth(0)).toContainText('Escarabajo pelotero');
	await expect(cards.nth(1)).toContainText('Escarabajo pelotero');
	await berto.locator('#board').focus();
	await berto.keyboard.press('p');
	await expect(berto.locator('.hand-card:focus')).toContainText('Escarabajo pelotero');
	await flushAxeAudit(berto);
	// The random steal resolves after the Nope window. Open it first, wait for the synchronous
	// play announcement, then enqueue the victim-card index before the one-second timer expires.
	await berto.keyboard.press('Enter');
	await expect(berto.locator('.popup-menu[role="menu"]')).toHaveCount(0);

	await expectAnnouncement(berto,
		/Juegas dos cartas iguales de Escarabajo pelotero para robar una carta a Ana/i);
	await expectAnnouncement(ana,
		/Berto juega dos cartas iguales de Escarabajo pelotero para robar una carta a Ana/i);
	await scriptDice(0);
	await expect(beetles).toHaveCount(0); // both copies were spent by that one activation
	await expectAnnouncement(berto, /Robas .* a Ana/i);
	await expect(anaCards).toHaveCount(10); // the resolved steal removed one of Ana's cards
});

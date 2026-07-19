// journey.spec.ts — the journey family end to end on the shipped "La Gran Ruta" deck.
//
// Two real browsers, Spanish locale. In the E2E environment the deck keeps its cards.json
// order (identity shuffle) and deals from the END, so the opening hands are known:
//   Ana:   As del volante, Camión cisterna, Reparación ×3, Rueda de recambio
//   Berto: Rueda maciza, Prioridad de paso, Reparación ×3, Rueda de recambio
// Covers: the lobby offering the deck tokens-only, the HAND as the family's home surface
// (board focus dives into it), Space drawing with the identity spoken ONLY to the drawer,
// Enter playing an immunity (announced to all with the card's own line), the turn handover,
// the players-panel status line (kilómetros + state), and S speaking my own status.

import { test, expect } from '../helpers/test';
import {
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	resetDice,
	startGame,
} from '../helpers/game';

const BOARD = 'la-gran-ruta';

test.beforeEach(async () => {
	await resetDice();
});

test('the lobby offers the journey deck with tokens and ITS OWN house rules (no seats)', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await page.goto('/');
	await expect(page.locator('#your-games-empty, #your-games-list li').first()).toBeVisible();
	await page.click('#go-create-btn');

	await page.selectOption('#board-selector', BOARD);
	await expect(page.locator('.token-list:not(#join-token-list) input[value="coche"]')).toBeAttached();
	// The journey rules render as the package's own panel (the built-in property fieldsets
	// are replaced), with the official defaults pre-filled and the package's ES labels.
	await expect(page.locator('#rules-details')).toHaveClass(/rules-details--package/);
	await expect(page.locator('#package-rules [data-rule-id="journeyTargetScore"]')).toHaveValue('5000');
	await expect(page.locator('#package-rules [data-rule-id="journeyGoalKm"]')).toHaveValue('1000');
	await expect(page.locator('#package-rules [data-rule-id="journeyStackHazards"]')).not.toBeChecked();
	await expect(page.locator('#package-rules [data-rule-id="journeyAllImmunitiesBonus"]')).toHaveValue('300');
	await expect(page.locator('#package-rules')).toContainText('Puntos para ganar la partida');
	await expect(page.locator('#seat-fieldset')).toBeHidden(); // still no race seats
});

test('journey: the hand is home — private draw, playing an immunity, statuses and S', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// ── The hand renders my six known cards; the visual echoes stay aria-hidden. ──
	const anaCards = ana.locator('.hand-card:not(.hand-card--info)');
	await expect(anaCards).toHaveCount(6);
	await expect(anaCards.first()).toHaveAttribute('aria-label', /As del volante/);
	// The draw pile rides the hand as a read-only last row: 106 cards minus two hands.
	await expect(ana.locator('.hand-card--info')).toHaveAttribute('aria-label', 'Cartas en el mazo: 94');
	await expect(ana.locator('#board .journey-visual')).toHaveAttribute('aria-hidden', 'true');
	// One car per seat sits on the strip — each drawn as ITS chosen vehicle (live-play
	// bug: a motorbike player saw a car). Join order picks the first free tokens, so Ana
	// drives the "coche" and Berto the "furgoneta": two different vehicles on screen.
	await expect(ana.locator('#board .journey-car')).toHaveCount(2);
	await expect(ana.locator('#board .journey-car[data-vehicle="coche"]')).toHaveCount(1);
	await expect(ana.locator('#board .journey-car[data-vehicle="furgoneta"]')).toHaveCount(1);
	// Each dashboard wears its battle-state chip (live-play request: the sighted player
	// couldn't read his own state). At the start everyone waits for the green light: red
	// "parado" chips, unnamed — nobody threw you anything yet.
	await expect(ana.locator('.journey-dash__flag--stopped')).toHaveCount(2);
	await expect(ana.locator('.journey-dash__flag--stopped').first()).toHaveText('parado');
	// No board in this family: the container carries NO label (the hand list names itself —
	// a container label would read "Tu mano" twice), the die is gone, and the visible draw
	// button stands in its place.
	await expect(ana.locator('#board')).not.toHaveAttribute('aria-label', /./);
	await expect(ana.locator('#board .hand-panel__list')).toHaveAttribute('aria-label', 'Tu mano');
	await expect(ana.locator('.dice-control')).toBeHidden();
	await expect(ana.locator('.hand-panel__draw')).toHaveText('Robar carta');

	// ── Board focus dives into the hand (the family's home surface). ─────────────
	await ana.locator('#board').focus();
	await expect(anaCards.first()).toBeFocused();

	// ── Ana draws with Space: everyone hears THAT, only Ana hears WHAT. ─────────
	await ana.keyboard.press(' ');
	await expectAnnouncement(berto, /Ana roba una carta/);
	await expectAnnouncement(ana, /Robas:/);
	await expectAnnouncement(ana, /Rueda de recambio/);
	await expect(anaCards).toHaveCount(7);
	// …and the deck counter row followed the draw.
	await expect(ana.locator('.hand-card--info')).toHaveAttribute('aria-label', 'Cartas en el mazo: 93');

	// ── Enter plays the focused immunity: its own THEMED line names it to the table. ──
	await ana.keyboard.press('Enter');
	await expectAnnouncement(berto, /¡Ana se corona como As del volante!/);
	await expectAnnouncement(ana, /¡Te coronas como As del volante!/);
	await expectAnnouncement(ana, /Turno de Berto/);
	await expect(anaCards).toHaveCount(6);

	// Regression: Space in the hand must DRAW only. It is also the global "roll dice" key,
	// and both layers once fired together ("robas una carta… ¡y suena el dado!").
	for (const page of [ana, berto]) {
		const heard: string[] = await page.evaluate(() => (window as any).__announcements ?? []);
		expect(heard.filter(line => /saca un|dado/i.test(line))).toEqual([]);
	}

	// ── Berto draws and answers with Prioridad de paso: it clears his initial stop. ──
	await berto.locator('#board').focus();
	await berto.keyboard.press(' ');
	await expectAnnouncement(berto, /Robas:/);
	await berto.keyboard.press('ArrowDown'); // Rueda maciza → Prioridad de paso
	await berto.keyboard.press('Enter');
	await expectAnnouncement(ana, /¡Berto juega la Prioridad de paso!/);
	// Clearing his LAST stopper is celebrated, not just named.
	await expectAnnouncement(ana, /¡Berto se pone en marcha!/);
	await expectAnnouncement(berto, /¡Estás en marcha!/);
	await expectAnnouncement(berto, /Turno de Ana/);

	// ── The players panel speaks each seat's dashboard as its identity line. ─────
	const bertoRow = ana.locator('.player-card', { hasText: 'Berto' });
	await expect(bertoRow).toHaveAttribute('aria-label', /0 kilómetros/);
	await expect(bertoRow).toHaveAttribute('aria-label', /en marcha/);
	await expect(bertoRow).toHaveAttribute('aria-label', /Prioridad de paso/);
	// Ana never played a green light: her row says stopped — PLAIN. The initial hazard is
	// never blamed on a red light nobody threw (a real breakdown WOULD be named).
	const anaRow = berto.locator('.player-card', { hasText: 'Ana' });
	await expect(anaRow).toHaveAttribute('aria-label', /parado/);
	await expect(anaRow).not.toHaveAttribute('aria-label', /Semáforo/);

	// ── S says how I am doing, from anywhere on the journey surface — with the LIVE
	// points: Berto's played immunity is already worth 100. ──────────────────────
	await berto.locator('#board').focus();
	await berto.keyboard.press('s');
	await expectAnnouncement(berto, /0 kilómetros, en marcha, inmunidades: Prioridad de paso, 100 puntos/);
});

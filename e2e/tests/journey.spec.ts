// journey.spec.ts — the journey family end to end on the shipped "The Great Route" deck.
//
// Two real browsers, Spanish locale. In the E2E environment the deck keeps its cards.json
// order (identity shuffle) and deals from the END, so the opening hands are known:
//   Ana:   driving ace, tanker truck, repairs ×3, spare wheel
//   Berto: puncture-proof wheel, right of way, repairs ×3, spare wheel
// Covers: the lobby offering the deck tokens-only, the HAND as the family's home surface
// (board focus dives into it), Space drawing with the identity spoken ONLY to the drawer,
// Enter playing an immunity (announced to all with the card's own line), the turn handover,
// the players-panel status line (kilometres + state), and S speaking my own status.

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

const BOARD = 'great-route';

test.beforeEach(async () => {
	await resetDice();
});

test('the lobby offers the journey deck with tokens and ITS OWN house rules (no seats)', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await page.goto('/');
	await expect(page.locator('#your-games-empty, #your-games-list li').first()).toBeVisible();
	await page.click('#go-create-btn');

	await page.selectOption('#board-selector', BOARD);
	await expect(page.locator('.token-list:not(#join-token-list) input[value="car"]')).toBeAttached();
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

test('journey: F1 guide discovers rules, shortcuts, card help and screen-reader play', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Card families enter the hand automatically; the page must not teach the spatial-board
	// workflow or tell the player to press Tab before they can begin.
	const intro = ana.locator('#game-surface-intro');
	await expect(intro).toHaveAttribute('data-i18n', 'game.surface_intro.hand');
	await expect(intro).toHaveText('El foco se coloca automáticamente en tu mano. Usa Flecha arriba y Flecha abajo para recorrer las cartas; tu lector de pantalla anunciará cada una. Pulsa Control más F1 para consultar los atajos de este juego.');
	await expect(ana.locator('.hand-card:not(.hand-card--info)').first()).toBeFocused();

	// F1 is the package guide. It teaches all three companion help routes and gives
	// this card family a concrete screen-reader workflow rather than generic board advice.
	await ana.keyboard.press('F1');
	const guide = ana.locator('.game-dialog.dialog-help:has(.board-help)');
	await expect(guide).toBeVisible();
	await expect(guide.locator('.board-help__contents h2')).toHaveText('Contenido');
	await expect(guide.locator('.board-help h2', { hasText: 'Ayuda durante la partida' })).toBeVisible();
	await expect(guide.locator('.board-help h2', { hasText: 'Cómo jugar con lector de pantalla' })).toBeVisible();
	await expect(guide.locator('.board-help')).toContainText('Ctrl+F1');
	await expect(guide.locator('.board-help')).toContainText('Ctrl+Shift+F1');
	await expect(guide.locator('.board-help')).toContainText('Shift+F1');
	await expect(guide.locator('.board-help')).toContainText('Ctrl+Shift+R');
	const screenReaderSection = guide.locator('#como-jugar-con-lector-de-pantalla');
	await guide.getByRole('link', { name: 'Cómo jugar con lector de pantalla' }).click();
	await expect(screenReaderSection).toBeFocused();
	await flushAxeAudit(ana);
	await guide.locator('.btn-primary').click();

	// The new contents surface uses theme tokens; reach it in dark mode as well so the
	// automatic Axe monitor checks its links, border and background in both palettes.
	await ana.locator('#theme-toggle').click();
	await ana.keyboard.press('F1');
	await expect(guide).toBeVisible();
	await expect(guide.locator('.board-help__contents')).toBeVisible();
	await flushAxeAudit(ana);
	await guide.locator('.btn-primary').click();

	// The documented contextual route works from the focused card itself.
	const firstCard = ana.locator('.hand-card:not(.hand-card--info)').first();
	// Send the shortcut through the row locator so a concurrent state repaint cannot move
	// focus between a separate focus call and the key event on slower CI runners.
	await firstCard.press('Shift+F1');
	const cardHelp = ana.locator('.game-dialog.dialog-card-help');
	await expect(cardHelp).toBeVisible();
	await expect(cardHelp.locator('.dialog-content')).not.toBeEmpty();
	await flushAxeAudit(ana);
	await cardHelp.locator('.btn-primary').click();

	// Ctrl+F1 exposes the contextual card-help shortcut in the live, family-filtered table.
	await ana.keyboard.press('Control+F1');
	const shortcuts = ana.locator('.game-dialog.dialog-help:has(.help-shortcuts)');
	await expect(shortcuts).toBeVisible();
	await expect(shortcuts.locator('.help-shortcuts')).toContainText('Mayús + F1');
	await expect(shortcuts.locator('.help-shortcuts')).toContainText('Leer la ayuda de la carta seleccionada');
	await flushAxeAudit(ana);
	await shortcuts.locator('.btn-primary').click();

	// Ctrl+Shift+F1 is a separate reading document containing this match's effective rules.
	await ana.keyboard.press('Control+Shift+F1');
	const rules = ana.locator('.game-dialog.dialog-game-rules');
	await expect(rules).toBeVisible();
	await expect(rules.locator('.dialog-title')).toHaveText('Reglas activas');
	await expect(rules.locator('.game-rules-list li').first()).toBeVisible();
	await flushAxeAudit(ana);
	await rules.locator('.btn-primary').click();
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
	await expect(anaCards.locator('[data-card-art="package"]')).toHaveCount(6);
	await expect(anaCards.first()).toHaveAttribute('aria-label', /As del volante/);
	// The draw pile rides the hand as a read-only last row: 106 cards minus two hands.
	await expect(ana.locator('.hand-card--info')).toHaveAttribute('aria-label', 'Cartas en el mazo: 94');
	await expect(ana.locator('#board .journey-visual')).toHaveAttribute('aria-hidden', 'true');
	// One marker per seat sits on the strip, using the actual SVG token supplied by the
	// package. The engine neither knows token ids nor redraws their content.
	await expect(ana.locator('#board .journey-car')).toHaveCount(2);
	await expect(ana.locator('#board .journey-car[data-token]')).toHaveCount(2);
	const tokenPaths = await ana.locator('#board .journey-car .journey-car__svg path')
		.evaluateAll(paths => paths.map(path => path.getAttribute('d')));
	expect(new Set(tokenPaths).size).toBe(2);
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
	// and both layers once fired together ("you draw a card… and the die sounds!").
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

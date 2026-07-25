// forbidden.spec.ts — the accessible spoken-clue family end to end.
//
// Four real browser contexts form two host-arranged teams. The host chooses English game
// content while three players keep a Spanish interface, proving that private words and UI
// locale are independent. The scenario reaches the protected-card, active timer,
// correct, violation and pass states, with an explicit Axe flush before each transition.

import { test, expect, type Page } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	appI18n,
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	resetDice,
	startGame,
} from '../helpers/game';

const BOARD = 'forbidden-words';

async function assign(host: Page, teamIndex: number, playerName: string): Promise<void> {
	await host.locator('#host-team-panel .team-box').nth(teamIndex).locator('.team-box__add').click();
	await host.locator('[role="menu"] [role="menuitem"]').filter({ hasText: playerName }).click();
	await expect(host.locator('#host-team-panel .team-box').nth(teamIndex)).toContainText(playerName);
}

test.beforeEach(async () => {
	await resetDice();
});

test('an assigned host is not reported as a complete two-team roster', async ({ browser }) => {
	const host = await newPlayerPage(browser, 'es-ES');
	await createGame(host, 'Ana', BOARD, { maxPlayers: 4, teamCount: 2 });

	await expect(host.locator('#host-team-panel .team-box')).toHaveCount(2);
	await assign(host, 0, 'Ana');
	await expect(host.locator('#host-team-panel .team-box').nth(0).locator('legend')).toHaveText(/1\/2/);
	await expect(host.locator('#host-team-panel .team-box').nth(1).locator('legend')).toHaveText(/0\/2/);
	// Nobody else has joined, so no Add button can act yet; use the assigned row as the safe fallback.
	await expect(host.locator('#host-team-panel .team-member').filter({ hasText: 'Ana' })).toBeFocused();

	const expected = (appI18n('es').lobby.teamRosterWaitingMany as string)
		.replace('{{assigned}}', '1')
		.replace('{{capacity}}', '4')
		.replace('{{missing}}', '3');
	await expect(host.locator('#host-team-panel .team-pool')).toHaveText(expected);
	await expect(host.locator('#host-team-panel .team-pool')).not.toContainText('completos');
	await flushAxeAudit(host);
});

test('private English cards, per-player Spanish UI and authoritative role actions', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'en-US');
	const berto = await newPlayerPage(browser, 'es-ES');
	const carla = await newPlayerPage(browser, 'es-ES');
	const david = await newPlayerPage(browser, 'es-ES');

	const code = await createGame(ana, 'Ana', BOARD, { maxPlayers: 4, teamCount: 2 });
	await joinGame(berto, code, 'Berto');
	await joinGame(carla, code, 'Carla');
	await joinGame(david, code, 'David');

	await expect(ana.locator('#host-team-panel .team-box')).toHaveCount(2);
	await assign(ana, 0, 'Ana');
	await expect(ana.locator('#host-team-panel .team-box').nth(0).locator('.team-box__add')).toBeFocused();
	await assign(ana, 0, 'Berto');
	// Team zero is now full, so the vanished opener hands focus to the next usable Add button.
	await expect(ana.locator('#host-team-panel .team-box').nth(1).locator('.team-box__add')).toBeFocused();

	// Each team's players form one AccessibleList-style keyboard surface: arrows walk rows,
	// Right enters the action toolbar, Left returns, and Shift+F10 mirrors actions in a menu.
	const firstTeamRows = ana.locator('#host-team-panel .team-box').nth(0).locator('.team-member');
	await firstTeamRows.first().focus();
	await ana.keyboard.press('ArrowDown');
	await expect(firstTeamRows.nth(1)).toBeFocused();
	await ana.keyboard.press('ArrowRight');
	await expect(firstTeamRows.nth(1).locator('.team-member__actions button')).toBeFocused();
	await ana.keyboard.press('ArrowLeft');
	await expect(firstTeamRows.nth(1)).toBeFocused();
	await ana.keyboard.press('Shift+F10');
	const teamMenu = ana.locator('.team-context-menu');
	await expect(teamMenu).toBeVisible();
	await expect(teamMenu.locator('[role="menuitem"]')).toHaveText('Remove Berto from their team');
	expect(await teamMenu.evaluate(menu => menu.closest('main') !== null)).toBe(true);
	await flushAxeAudit(ana);
	await ana.keyboard.press('Escape');
	await expect(firstTeamRows.nth(1)).toBeFocused();

	await assign(ana, 1, 'Carla');
	await expect(ana.locator('#host-team-panel .team-box').nth(1).locator('.team-box__add')).toBeFocused();
	await assign(ana, 1, 'David');
	await expect(ana.locator('#host-team-panel .team-box').nth(1)
		.locator('.team-member[data-player-id]').filter({ hasText: 'David' })).toBeFocused();
	await expect(ana.locator('#host-team-panel .team-pool'))
		.toHaveText(appI18n('en').lobby.teamPoolEmpty as string);
	await startGame(ana, [ana, berto, carla, david]);

	await expect(ana.locator('#game-surface-intro')).toContainText('role and actions');
	await expect(berto.locator('#game-surface-intro')).toContainText('función y tus acciones');
	await expect(ana.locator('.forbidden-title')).toHaveText('Forbidden Words');
	await expect(berto.locator('.forbidden-title')).toHaveText('Palabras prohibidas');

	const anaCard = ana.locator('.forbidden-secret__text');
	const bertoCard = berto.locator('.forbidden-secret__text');
	const carlaCard = carla.locator('.forbidden-secret__text');
	const davidCard = david.locator('.forbidden-secret__text');

	// Ana gives clues and opposing Carla monitors: only those two projections contain the
	// private English card. Berto (guesser) and David (supporter) receive no secret DOM value.
	await expect(anaCard).toBeVisible();
	await expect(carlaCard).toBeVisible();
	await expect(bertoCard).toBeHidden();
	await expect(davidCard).toBeHidden();
	await expect(anaCard).toHaveAttribute('aria-readonly', 'true');
	await expect(anaCard).not.toHaveAttribute('readonly', /.*/);
	await expect(anaCard).toHaveAttribute('rows', '7');
	await expect(ana.locator('#forbidden-card-hint')).toContainText('Up and Down Arrow');
	await expect(carla.locator('#forbidden-card-hint')).toContainText('Flecha arriba y Flecha abajo');
	await expect(anaCard).toHaveValue(
		'Target word: lighthouse.\nForbidden words:\nlight,\ncoast,\ntower,\nsea,\nship.');
	await expect(carlaCard).toHaveValue(
		'Palabra objetivo: lighthouse.\nPalabras prohibidas:\nlight,\ncoast,\ntower,\nsea,\nship.');
	await expect(bertoCard).toHaveValue('');
	await expect(davidCard).toHaveValue('');

	const originalCard = await anaCard.inputValue();
	await anaCard.focus();
	await ana.keyboard.type('MUTATION');
	await expect(anaCard).toHaveValue(originalCard);

	// The untimed role assignment is a persistent state, so audit every projection before
	// the clue-giver starts. No one else has to confirm readiness.
	for (const page of [ana, berto, carla, david]) await flushAxeAudit(page);

	await expect(ana.locator('.forbidden-start')).toBeVisible();
	for (const page of [berto, carla, david]) {
		await expect(page.locator('.forbidden-controls button:not([hidden])')).toHaveCount(0);
	}
	await ana.locator('.forbidden-start').click();

	await expect(ana.locator('.forbidden-correct')).toBeVisible();
	await expect(ana.locator('.forbidden-pass')).toBeVisible();
	await expect(carla.locator('.forbidden-violation')).toBeVisible();
	await expect(berto.locator('.forbidden-controls button:not([hidden])')).toHaveCount(0);
	await expect(ana.locator('.forbidden-timer')).toBeVisible();
	await expect.poll(async () => ana.locator('.forbidden-timer__progress').evaluate(
		el => (el as HTMLProgressElement).value,
	), { timeout: 5_000 }).toBeLessThan(60);
	await expectAnnouncement(berto, /Ana inicia el turno/);
	for (const page of [ana, berto, carla, david]) await flushAxeAudit(page);

	await ana.locator('.forbidden-correct').click();
	await expectAnnouncement(berto, /Berto acierta lighthouse/);
	await expect(anaCard).not.toHaveValue(originalCard);
	await expect(ana.locator('.forbidden-score').first()).toContainText('1');
	await flushAxeAudit(ana);

	await carla.locator('.forbidden-violation').click();
	await expectAnnouncement(david, /Carla señala.*palabra prohibida/);
	await expect(ana.locator('.forbidden-score').first()).toContainText('0');
	await flushAxeAudit(carla);

	const beforePass = await anaCard.inputValue();
	await ana.locator('.forbidden-pass').click();
	await expectAnnouncement(berto, /Ana pasa/);
	await expect(anaCard).not.toHaveValue(beforePass);
	await expect(ana.locator('.forbidden-score').first()).toContainText('0');

	// Reach a narrow, dark rendering of the live monitor state and verify it neither clips
	// horizontally nor loses its role control. Automatic teardown audits the final state too.
	await carla.setViewportSize({ width: 390, height: 844 });
	await carla.locator('#theme-toggle').click();
	await expect(carla.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(carla.locator('.forbidden-violation')).toBeVisible();
	const overflow = await carla.evaluate(() => {
		const viewport = document.documentElement.clientWidth;
		return Array.from(document.querySelectorAll<HTMLElement>('body *'))
			.map(element => ({
				element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
					element.className && typeof element.className === 'string'
						? `.${element.className.trim().replace(/\s+/g, '.')}`
						: ''}`,
				left: Math.round(element.getBoundingClientRect().left),
				right: Math.round(element.getBoundingClientRect().right),
			}))
			.filter(entry => entry.right > viewport + 1)
			.slice(0, 20);
	});
	expect(overflow, `horizontal overflow at 390px: ${JSON.stringify(overflow)}`).toEqual([]);
	await flushAxeAudit(carla);
});

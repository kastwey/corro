// forbidden.spec.ts — the accessible spoken-clue family end to end.
//
// Four real browser contexts form two host-arranged teams. The host explicitly chooses one
// shared Spanish word deck while interfaces remain personal, proving that private words and UI
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
	await host.locator('#table-team-panel .team-box').nth(teamIndex).locator('.team-box__add').click();
	await host.locator('[role="menu"] [role="menuitem"]').filter({ hasText: playerName }).click();
	await expect(host.locator('#table-team-panel .team-box').nth(teamIndex)).toContainText(playerName);
}

test.beforeEach(async () => {
	await resetDice();
});

test('an assigned host is not reported as a complete two-team roster', async ({ browser }) => {
	const host = await newPlayerPage(browser, 'es-ES');
	await createGame(host, 'Ana', BOARD, { maxPlayers: 4, teamCount: 2 });

	await expect(host.locator('#table-team-panel .team-box')).toHaveCount(2);
	await assign(host, 0, 'Ana');
	await expect(host.locator('#table-team-panel .team-box').nth(0).locator('legend')).toHaveText(/1\/2/);
	await expect(host.locator('#table-team-panel .team-box').nth(1).locator('legend')).toHaveText(/0\/2/);
	// Nobody else has joined, so no Add button can act yet; use the assigned row as the safe fallback.
	await expect(host.locator('#table-team-panel .team-member').filter({ hasText: 'Ana' })).toBeFocused();

	const expected = (appI18n('es').lobby.teamRosterWaitingMany as string)
		.replace('{{assigned}}', '1')
		.replace('{{capacity}}', '4')
		.replace('{{missing}}', '3');
	await expect(host.locator('#table-team-panel .team-pool')).toHaveText(expected);
	await expect(host.locator('#table-team-panel .team-pool')).not.toContainText('completos');
	await flushAxeAudit(host);
});

test('shared Spanish cards, per-player UI and authoritative role actions', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'en-US');
	const berto = await newPlayerPage(browser, 'es-ES');
	const carla = await newPlayerPage(browser, 'es-ES');
	const david = await newPlayerPage(browser, 'es-ES');

	const code = await createGame(ana, 'Ana', BOARD, {
		maxPlayers: 4,
		teamCount: 2,
		contentLanguage: 'es',
	});
	await expect(ana.locator('#table-content-language-group')).toBeVisible();
	await expect(ana.locator('#table-content-language')).toHaveValue('es');
	await ana.reload();
	await expect(ana.locator('#table-view')).toBeVisible();
	await expect(ana.locator('#table-content-language')).toHaveValue('es');
	await joinGame(berto, code, 'Berto');
	await joinGame(carla, code, 'Carla');
	await joinGame(david, code, 'David');
	for (const page of [berto, carla, david]) {
		await expect(page.locator('#table-content-language-current')).toHaveText(
			appI18n('es').lobby.contentLanguageCurrent.replace('{{language}}', appI18n('es').language.spanish),
		);
	}

	// The host can still change the shared deck while everyone is in the waiting room. Every
	// listener sees and hears the authoritative update; the final Spanish choice survives start.
	await berto.evaluate(() => { ((window as any).__announcements as string[]).length = 0; });
	await ana.locator('#table-content-language').selectOption('en');
	await expect(berto.locator('#table-content-language-current')).toContainText('Inglés');
	await expectAnnouncement(berto, /idioma del contenido ahora es Inglés/);
	await ana.locator('#table-content-language').selectOption('es');
	await expect(berto.locator('#table-content-language-current')).toContainText('Español');

	await expect(ana.locator('#table-team-panel .team-box')).toHaveCount(2);
	await assign(ana, 0, 'Ana');
	await expect(ana.locator('#table-team-panel .team-box').nth(0).locator('.team-box__add')).toBeFocused();
	await assign(ana, 0, 'Berto');
	// Team zero is now full, so the vanished opener hands focus to the next usable Add button.
	await expect(ana.locator('#table-team-panel .team-box').nth(1).locator('.team-box__add')).toBeFocused();

	// Each team's players form one AccessibleList-style keyboard surface: arrows walk rows,
	// Right enters the action toolbar, Left returns, and Shift+F10 mirrors actions in a menu.
	const firstTeamRows = ana.locator('#table-team-panel .team-box').nth(0).locator('.team-member');
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
	await expect(ana.locator('#table-team-panel .team-box').nth(1).locator('.team-box__add')).toBeFocused();
	await assign(ana, 1, 'David');
	await expect(ana.locator('#table-team-panel .team-box').nth(1)
		.locator('.team-member[data-player-id]').filter({ hasText: 'David' })).toBeFocused();
	await expect(ana.locator('#table-team-panel .team-pool'))
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
	// private Spanish card. Berto (guesser) and David (supporter) receive no secret DOM value.
	await expect(anaCard).toBeVisible();
	await expect(carlaCard).toBeVisible();
	await expect(bertoCard).toBeHidden();
	await expect(davidCard).toBeHidden();
	await expect(anaCard).toHaveAttribute('aria-readonly', 'true');
	await expect(anaCard).not.toHaveAttribute('readonly', /.*/);
	await expect(anaCard).toHaveAttribute('rows', '7');
	// One word, the same for every role, and no paragraph read out on every single focus.
	await expect(anaCard).toHaveAccessibleName('Words');
	await expect(carlaCard).toHaveAccessibleName('Palabras');
	await expect(ana.locator('#forbidden-card-hint')).toHaveCount(0);
	await expect(anaCard).not.toHaveAttribute('aria-describedby', /.*/);
	// The turn has not started, so not even those two hold the words yet — the server keeps
	// them until the clock runs. The card is there, saying so in each player's own language.
	await expect(anaCard).toHaveValue('The word appears when the turn starts.');
	await expect(carlaCard).toHaveValue('La palabra aparece al empezar el turno.');
	await expect(bertoCard).toHaveValue('');
	await expect(davidCard).toHaveValue('');

	// "Who is playing" is its own section, and it is the same fact for everyone at the table.
	await expect(ana.locator('.forbidden-now h3')).toHaveText('Who is playing');
	await expect(berto.locator('.forbidden-now h3')).toHaveText('Quién juega');
	// Reported live: this line used to open with "Turn 1 of cycle 1", counting bookkeeping at a
	// player who had asked one thing — whose turn is it.
	await expect(ana.locator('.forbidden-now__line')).toHaveText('Your Red team is about to play.');
	await expect(david.locator('.forbidden-now__line')).toHaveText('El Equipo Rojo va a jugar.');
	// Three named sibling regions, no nesting and no skipped level.
	await expect(ana.locator('.forbidden-shell > section')).toHaveCount(3);
	await expect(ana.locator('.forbidden-shell h4')).toHaveCount(0);
	// Headings that ANNOUNCE as the same level must also LOOK like the same level: a new
	// section that misses the shared rule renders at the UA default, which no Axe rule sees.
	const headingSizes = await ana.evaluate(() =>
		[...document.querySelectorAll('.forbidden-shell > section > h3')]
			.map(h => getComputedStyle(h).fontSize));
	expect(new Set(headingSizes).size, `section headings differ in size: ${headingSizes}`).toBe(1);

	// The turn card says MY duty, and lists the three jobs the turn actually has.
	await expect(ana.locator('.forbidden-role-detail')).toHaveText(
		'You are the clue-giver: describe the target without saying it or using its forbidden words.');
	await expect(berto.locator('.forbidden-role-detail')).toHaveText(
		'Este turno adivinas la palabra objetivo, en voz alta.');
	await expect(carla.locator('.forbidden-role-detail')).toHaveText(
		'Eres el supervisor: pulsa V si Ana dice el objetivo o cualquiera de las palabras prohibidas.');
	await expect(david.locator('.forbidden-role-detail')).toHaveText(
		'Este turno apoyas a tu equipo, sin ninguna acción propia.');
	// Three lines, one per job, and nobody is named for holding no job at all — David used to get
	// a line saying he was "supporting", which pushed the three that matter further down.
	await expect(ana.locator('.forbidden-role-list li')).toHaveText([
		'You give the clues.',
		'Berto guesses.',
		'Carla monitors.',
	]);
	await expect(david.locator('.forbidden-role-list li')).toHaveText([
		'Ana da las pistas.',
		'Berto adivina.',
		'Carla supervisa.',
	]);

	// T is short now: the team, then the three people the turn runs through. It used to read the
	// whole duty paragraph and every spectator's name, several times a turn.
	for (const [page, focus, announcement] of [
		[ana, anaCard, /^Your Red team is about to play\. You give the clues\. Berto guesses\. Carla monitors\.$/],
		[berto, berto.locator('.forbidden-shell'), /^Tu Equipo Rojo va a jugar\. Ana da las pistas\. Tú adivinas\. Carla supervisa\.$/],
		[carla, carlaCard, /^El Equipo Rojo va a jugar\. Ana da las pistas\. Berto adivina\. Tú supervisas\.$/],
		[david, david.locator('.forbidden-shell'), /^El Equipo Rojo va a jugar\. Ana da las pistas\. Berto adivina\. Carla supervisa\.$/],
	] as const) {
		await page.evaluate(() => { ((window as any).__announcements as string[]).length = 0; });
		await focus.focus();
		await page.keyboard.press('t');
		await expectAnnouncement(page, announcement);
		await expect(focus).toBeFocused();
	}
	await ana.evaluate(() => { ((window as any).__announcements as string[]).length = 0; });
	await anaCard.focus();
	await ana.keyboard.press('s');
	await expectAnnouncement(ana, /^Red team: 0 points; your role is clue-giver\.$/);
	await expect(anaCard).toBeFocused();

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
	await carlaCard.focus();
	await carla.keyboard.press('Enter');
	await expect(carlaCard).toBeFocused();
	await expect(ana.locator('.forbidden-start')).toBeVisible();
	await expect(carla.locator('.forbidden-timer')).toBeHidden();
	await anaCard.focus();
	await ana.keyboard.press('Enter');
	await expect(anaCard).toBeFocused();

	// Starting the clock is what delivers the card, to the clue-giver and the monitor alike,
	// in the one shared deck language. Nobody else's projection gains anything.
	await expect(anaCard).toHaveValue(
		'Target word: faro.\nForbidden words:\nluz,\ncosta,\ntorre,\nmar,\nbarco.');
	await expect(carlaCard).toHaveValue(
		'Palabra objetivo: faro.\nPalabras prohibidas:\nluz,\ncosta,\ntorre,\nmar,\nbarco.');
	await expect(bertoCard).toHaveValue('');
	await expect(davidCard).toHaveValue('');

	await expect(ana.locator('.forbidden-correct')).toBeVisible();
	await expect(ana.locator('.forbidden-pass')).toBeVisible();
	await expect(carla.locator('.forbidden-violation')).toBeVisible();
	await expect(carla.locator('.forbidden-violation')).toHaveAttribute('aria-keyshortcuts', 'V');
	await expect(berto.locator('.forbidden-controls button:not([hidden])')).toHaveCount(0);
	await expect(ana.locator('.forbidden-timer')).toBeVisible();
	await expect.poll(async () => ana.locator('.forbidden-timer__progress').evaluate(
		el => (el as HTMLProgressElement).value,
	), { timeout: 5_000 }).toBeLessThan(60);
	// Reported live: NVDA sonifies a progress bar, and this one moves every second and runs
	// BACKWARDS, so it beeped its way down the whole turn over the top of the conversation. The
	// clock is heard as the ticking loop and read on demand with R; the bar is for the sighted.
	await expect(ana.locator('.forbidden-timer')).toHaveAttribute('aria-hidden', 'true');
	await expect(ana.locator('.forbidden-timer__progress')).not.toHaveAttribute('aria-label', /.*/);
	await expectAnnouncement(berto, /Ana inicia el turno/);

	// R is a family-local, read-only timer query for every role. It works both from the
	// protected private card and from the role surface without moving focus or mutating state.
	for (const [page, focus, announcement] of [
		// The number FIRST: a listener who only wanted the seconds sits through no preamble.
		[ana, anaCard, /^\d+ seconds remaining\.$/],
		[berto, berto.locator('.forbidden-shell'), /^\d+ segundos restantes\.$/],
	] as const) {
		await page.evaluate(() => { ((window as any).__announcements as string[]).length = 0; });
		await focus.focus();
		await page.keyboard.press('r');
		await expectAnnouncement(page, announcement);
		await expect(focus).toBeFocused();
	}
	for (const page of [ana, berto, carla, david]) await flushAxeAudit(page);

	// V is role-authorized as well as family-local: the clue-giver cannot use it, and the
	// protected card remains unchanged rather than accepting the typed character.
	const beforeUnauthorizedViolation = await anaCard.inputValue();
	await anaCard.focus();
	await ana.keyboard.press('v');
	await expect(anaCard).toHaveValue(beforeUnauthorizedViolation);
	await expect(ana.locator('.forbidden-score').first()).toContainText('0');

	// Reported live: pressing "correct" left the clue-giver standing on a button while the next
	// word — the only thing they need — sat behind them. The words ARE the board here, so acting
	// comes straight back to them however the action was taken.
	await ana.locator('.forbidden-correct').focus();
	await ana.locator('.forbidden-correct').click();
	await expectAnnouncement(berto, /Berto acierta faro/);
	await expect(anaCard).not.toHaveValue(originalCard);
	await expect(anaCard).toBeFocused();
	await expect(ana.locator('.forbidden-score').first()).toContainText('1');
	await flushAxeAudit(ana);

	// …and Enter from the words does the same thing, so a clue-giver never leaves the card at all.
	const beforeEnterCorrect = await anaCard.inputValue();
	await ana.keyboard.press('Enter');
	await expect(anaCard).not.toHaveValue(beforeEnterCorrect);
	await expect(anaCard).toBeFocused();
	await expect(ana.locator('.forbidden-score').first()).toContainText('2');

	// Escape is how you leave anything else and land where you came from; here that is the words.
	await ana.locator('.forbidden-pass').focus();
	await ana.keyboard.press('Escape');
	await expect(anaCard).toBeFocused();

	await carlaCard.focus();
	await carla.keyboard.press('v');
	await expect(carlaCard).toBeFocused();
	await expectAnnouncement(david, /Carla señala.*objetivo o una palabra prohibida/);
	// Two banked words less one reported slip.
	await expect(ana.locator('.forbidden-score').first()).toContainText('1');
	await flushAxeAudit(carla);

	// P skips the word from the words themselves. Passing used to be the one clue-giver action
	// that needed a tab away from the card, with the clock running.
	const beforePass = await anaCard.inputValue();
	await anaCard.focus();
	await ana.keyboard.press('p');
	await expectAnnouncement(berto, /Ana pasa/);
	await expect(anaCard).not.toHaveValue(beforePass);
	await expect(anaCard).toBeFocused();
	await expect(ana.locator('.forbidden-score').first()).toContainText('1');

	// The button is the same action for a mouse or a switch, and the turn allows three passes.
	// Counting the lines rather than waiting for one more: `expectAnnouncement` scans the whole
	// log, so a second wait for "Ana pasa" would match the keyboard one and prove nothing.
	const beforeSecondPass = await anaCard.inputValue();
	await ana.locator('.forbidden-pass').click();
	await expect(anaCard).not.toHaveValue(beforeSecondPass);
	await expect(anaCard).toBeFocused();
	await expect.poll(async () => {
		const heard: string[] = await berto.evaluate(() => (window as any).__announcements ?? []);
		return heard.filter(line => /Ana pasa/.test(line)).length;
	}).toBe(2);

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

	// The headline is two boxes in ONE grid cell's flow, never two items stacked in the same
	// cell: the subtitle used to be painted over the title, which no Axe rule can see.
	for (const page of [carla, berto]) {
		const headline = await page.evaluate(() => {
			const title = document.querySelector('.forbidden-title')!.getBoundingClientRect();
			const subtitle = document.querySelector('.forbidden-subtitle')!.getBoundingClientRect();
			return { titleBottom: title.bottom, titleHeight: title.height, subtitleTop: subtitle.top, subtitleHeight: subtitle.height };
		});
		expect(headline.titleHeight, 'the title is rendered').toBeGreaterThan(0);
		expect(headline.subtitleHeight, 'the subtitle is rendered').toBeGreaterThan(0);
		expect(headline.subtitleTop, `subtitle overlaps the title: ${JSON.stringify(headline)}`)
			.toBeGreaterThanOrEqual(headline.titleBottom - 1);
	}
	await flushAxeAudit(carla);
});

test('the host can deal the whole room into the teams in one move', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'es-ES');
	const berto = await newPlayerPage(browser, 'es-ES');
	const carla = await newPlayerPage(browser, 'es-ES');
	const david = await newPlayerPage(browser, 'es-ES');

	const code = await createGame(ana, 'Ana', BOARD, { maxPlayers: 4, teamCount: 2 });
	await joinGame(berto, code, 'Berto');
	await joinGame(carla, code, 'Carla');
	await joinGame(david, code, 'David');

	const shuffle = ana.locator('#table-team-panel .team-panel__shuffle');
	await expect(shuffle).toHaveText('Repartir los equipos al azar');
	// Guests watch the same picture without the controls.
	await expect(berto.locator('#table-team-panel .team-panel__shuffle')).toHaveCount(0);
	await flushAxeAudit(ana);

	await berto.evaluate(() => { ((window as any).__announcements as string[]).length = 0; });
	await shuffle.click();

	// Everybody is placed, the teams come out even, and the pool is empty.
	await expect(ana.locator('#table-team-panel .team-box').nth(0).locator('legend')).toHaveText(/2\/2/);
	await expect(ana.locator('#table-team-panel .team-box').nth(1).locator('legend')).toHaveText(/2\/2/);
	await expect(ana.locator('#table-team-panel .team-pool'))
		.toHaveText(appI18n('es').lobby.teamPoolEmpty as string);
	// The room HEARS the arrangement — the repaint alone says nothing to a screen reader.
	await expectAnnouncement(berto, /Equipos repartidos al azar\..*Equipo Rojo: .*Equipo azul: /);
	await flushAxeAudit(ana);

	// And the deal is a real arrangement the game can start from.
	await startGame(ana, [ana, berto, carla, david]);
	// A random deal may or may not put Ana on the team that opens, so only the team is asserted.
	await expect(ana.locator('.forbidden-now__line')).toContainText('Equipo Rojo va a jugar.');
});

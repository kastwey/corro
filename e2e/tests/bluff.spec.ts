// bluff.spec.ts — the bluffing hall end to end.
//
// Three real browser contexts play one full round of Tall Tales: the host picks a shared Spanish
// deck while the interfaces stay personal, nobody picks a piece or a seat count, everybody writes
// at once, everybody votes on a two-question ballot, and the reveal is read in each player's own
// language. The scenario reaches the piece-less lobby forms, the preparing, writing, voting and
// reveal states and a clock expiry, with an explicit Axe flush before each transition — including
// the hidden-information checks that a rival's tall tale and the truth never reach another
// player's DOM before their time.

import { test, expect, type Page } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	createGame,
	expectAnnouncement,
	expireRoundClock,
	joinGame,
	newPlayerPage,
	openJoinForm,
	resetDice,
	startGame,
} from '../helpers/game';

const BOARD = 'tall-tales';

/** The scripted E2E randomness shuffles as the identity, so the deck arrives in file order:
 *  the first Spanish question is the shortest war, whose truth is "38 minutos". */
const TRUTH = '38 minutos';

const lieInput = (page: Page) => page.locator('.bluff-lie-input');
const truthRadios = (page: Page) => page.locator('.bluff-options--truth input[type="radio"]');
const funnyRadios = (page: Page) => page.locator('.bluff-options--funny input[type="radio"]');
const optionByText = (page: Page, group: 'truth' | 'funny', text: string) =>
	page.locator(`.bluff-options--${group} label`, { hasText: text }).locator('input[type="radio"]');

async function writeLie(page: Page, text: string): Promise<void> {
	await lieInput(page).fill(text);
	// Clicking the finish button blurs the field first, which flushes the save before the finish.
	await page.locator('.bluff-finish').click();
}

test.beforeEach(async () => {
	await resetDice();
});

test('a hall with no pieces and no seat count plays one full bluffing round in two languages', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'en-US');
	const berto = await newPlayerPage(browser, 'es-ES');
	const carla = await newPlayerPage(browser, 'es-ES');

	// ── The lobby asks for a name and nothing else ────────────────────────────
	const code = await createGame(ana, 'Ana', BOARD, { contentLanguage: 'es' });
	await expect(ana.locator('#table-content-language')).toHaveValue('es');

	await openJoinForm(berto, code, 'Berto');
	await expect(berto.locator('#join-token-fieldset')).toBeHidden();
	await expect(berto.locator('#join-no-pieces')).toBeVisible();
	await flushAxeAudit(berto);
	await berto.locator('#join-final-button').click();
	await expect(berto.locator('#table-view')).toBeVisible();
	await joinGame(carla, code, 'Carla');
	await startGame(ana, [ana, berto, carla]);

	// ── Preparing: the master opens, the question stays unread ────────────────
	await expect(ana.locator('.bluff-title')).toHaveText('Tall Tales');
	await expect(berto.locator('.bluff-title')).toHaveText('Trola');
	await expect(ana.locator('.bluff-start')).toBeVisible();
	await expect(berto.locator('.bluff-start')).toBeHidden();
	await expect(berto.locator('.bluff-question')).toBeHidden();
	await expect(berto.locator('.bluff-duty')).toContainText('Ana');
	// Named sibling regions, no nesting and no skipped level.
	await expect(ana.locator('.bluff-shell > section:not([hidden])')).toHaveCount(2);
	await expect(ana.locator('.bluff-shell h4')).toHaveCount(0);
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);

	// ── Writing ───────────────────────────────────────────────────────────────
	await ana.locator('.bluff-start').click();
	await expectAnnouncement(berto, /La guerra más corta/);
	await expect(berto.locator('.bluff-question')).toContainText('Zanzíbar');
	await expect(ana.locator('.bluff-question')).toContainText('Zanzíbar');
	await expect(ana.locator('.bluff-timer')).toBeVisible();
	await expect(ana.locator('.bluff-timer')).toHaveAttribute('aria-hidden', 'true');
	const field = berto.locator('.bluff-lie-input');
	await expect(field).toBeVisible();
	await expect(berto.locator(`label[for="${await field.getAttribute('id')}"]`)).toBeVisible();
	await flushAxeAudit(ana);

	// Writing the truth by accident is refused privately and the field keeps its text.
	await field.fill(TRUTH.toUpperCase());
	await field.blur();
	await expectAnnouncement(berto, /la verdad de verdad/);
	await expect(field).toHaveValue(TRUTH.toUpperCase());

	await writeLie(berto, 'tres días');
	await writeLie(carla, 'una semana');
	// Hidden information: a tall tale is in its writer's page and nowhere else, and the truth
	// is in nobody's.
	expect(await carla.locator('body').innerText()).not.toContain('tres días');
	expect(await ana.locator('body').innerText()).not.toContain('tres días');
	expect(await ana.locator('body').innerText()).not.toContain(TRUTH);
	// A finished writer keeps the control, with a spoken reason instead of a vanished button.
	const bertoFinish = berto.locator('.bluff-finish');
	await expect(bertoFinish).toBeVisible();
	await expect(bertoFinish).toHaveAttribute('aria-disabled', 'true');
	await expect(bertoFinish).not.toHaveAttribute('disabled', /.*/);
	await expect(ana.locator('.bluff-progress')).toContainText('1');
	await flushAxeAudit(berto);
	await writeLie(ana, 'dos horas');

	// ── Voting: two questions, one radio group each ───────────────────────────
	await expectAnnouncement(berto, /Se abre la votación/);
	await expect(ana.locator('.bluff-vote')).toBeVisible();
	await expect(ana.locator('.bluff-write')).toBeHidden();
	await expect(truthRadios(ana)).toHaveCount(3);
	await expect(ana.locator('.bluff-ballot--truth legend')).toHaveText('Which one is the truth?');
	await expect(berto.locator('.bluff-ballot--truth legend')).toHaveText('¿Cuál es la verdad?');
	await expect(ana.locator('.bluff-ballot--funny')).toBeHidden();
	// Nobody is offered their own tall tale, and no line carries a name.
	expect(await ana.locator('.bluff-options--truth').innerText()).not.toContain('dos horas');
	expect(await ana.locator('.bluff-options--truth').innerText()).not.toContain('Berto');
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);

	// Ana finds the truth; the second question appears from the first answer and omits it.
	await optionByText(ana, 'truth', TRUTH).check();
	await expect(ana.locator('.bluff-ballot--funny')).toBeVisible();
	await expect(funnyRadios(ana)).toHaveCount(2);
	expect(await ana.locator('.bluff-options--funny').innerText()).not.toContain(TRUTH);
	await flushAxeAudit(ana);
	await optionByText(ana, 'funny', 'una semana').check();
	await expect(ana.locator('.bluff-vote-status')).toContainText('ballot is in');

	// Berto falls for Ana's tale; Carla finds the truth.
	await optionByText(berto, 'truth', 'dos horas').check();
	await optionByText(berto, 'funny', 'una semana').check();
	await optionByText(carla, 'truth', TRUTH).check();
	await optionByText(carla, 'funny', 'tres días').check();

	// ── The reveal, in each player's own language ─────────────────────────────
	await expectAnnouncement(berto, /La verdad era 38 minutos/);
	await expect(ana.locator('.bluff-reveal')).toBeVisible();
	const anaLines = ana.locator('.bluff-reveal__line');
	await expect(anaLines.nth(0)).toHaveText('The truth was 38 minutos. Players who found it: 2.');
	await expect(anaLines.nth(1)).toContainText('dos horas, by Ana: it fooled 1');
	await expect(anaLines.nth(2)).toContainText('una semana, by Carla');
	await expect(anaLines.nth(3)).toHaveText(/^You found the truth for 1000 points, and your tall tale fooled 1 of the 2 who saw it, for 500 more\. Total: 1500\./);
	await expect(berto.locator('.bluff-reveal__line').nth(3)).toHaveText(/^No has acertado la verdad, y tu trola no ha engañado a nadie/);
	await expect(ana.locator('.bluff-score--me')).toContainText('1. Ana (you): 1500 points.');
	await expect(ana.locator('.bluff-next')).toBeVisible();
	await expect(berto.locator('.bluff-next')).toBeHidden();
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
	await flushAxeAudit(carla);

	// ── The next round, and a clock that runs out ─────────────────────────────
	await ana.locator('.bluff-next').click();
	await expectAnnouncement(berto, /Ronda 2 de 5/);
	await expect(ana.locator('.bluff-reveal')).toBeHidden();
	await ana.locator('.bluff-start').click();
	await expect(berto.locator('.bluff-lie-input')).toBeVisible();
	const tableId = new URL(ana.url()).searchParams.get('gameId')!;
	await expireRoundClock(tableId);
	await expectAnnouncement(berto, /^Tiempo\./);
	// Nobody wrote: the ballot carries the truth alone and asks for nothing funny.
	await expect(truthRadios(berto)).toHaveCount(1);
	await expect(berto.locator('.bluff-ballot--funny')).toBeHidden();
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
	await flushAxeAudit(carla);
});

test('the surface answers the reading keys without a screen reader having to hunt', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'en-US');
	const berto = await newPlayerPage(browser, 'en-US');
	const carla = await newPlayerPage(browser, 'en-US');

	const code = await createGame(ana, 'Ana', BOARD, { contentLanguage: 'en' });
	await joinGame(berto, code, 'Berto');
	await joinGame(carla, code, 'Carla');
	await startGame(ana, [ana, berto, carla]);

	// Before the round opens, P says there is no question yet and R that the clock is idle.
	await berto.locator('.bluff-shell').focus();
	await berto.keyboard.press('p');
	await expectAnnouncement(berto, /has not been read yet/i);
	await berto.keyboard.press('r');
	await expectAnnouncement(berto, /clock is not running/i);

	// S is my own standing; Shift+S the leaders without me.
	await berto.keyboard.press('s');
	await expectAnnouncement(berto, /in place/i);
	await berto.keyboard.press('Shift+S');
	await expectAnnouncement(berto, /Ana/);

	await ana.locator('.bluff-start').click();
	await expect(berto.locator('.bluff-lie-input')).toBeVisible();
	await berto.locator('.bluff-shell').focus();
	await berto.keyboard.press('p');
	await expectAnnouncement(berto, /The question is: The shortest war/);
	await berto.keyboard.press('r');
	await expectAnnouncement(berto, /seconds remaining/i);
	const echo = berto.locator('.bluff-echo');
	await expect(echo).toBeVisible();
	await expect(echo).toHaveAttribute('aria-hidden', 'true');

	// Inside the text box the bare letters type themselves; the command prefix arms one keystroke.
	const field = berto.locator('.bluff-lie-input');
	await field.focus();
	await berto.keyboard.type('p');
	await expect(field).toHaveValue('p');
	await berto.keyboard.press('Control+Shift+Space');
	await berto.keyboard.press('r');
	await expectAnnouncement(berto, /seconds remaining/i);
	await expect(field).toHaveValue('p', 'neither the prefix nor the command typed anything');

	// Enter in the box lands on "I have finished" without pressing it.
	await berto.keyboard.press('Enter');
	await expect(berto.locator('.bluff-finish')).toBeFocused();
	await expect(berto.locator('.bluff-finish')).not.toHaveAttribute('aria-disabled', 'true');

	await berto.keyboard.press('Control+F1');
	const help = berto.locator('.help-shortcuts');
	await expect(help).toBeVisible();
	await expect(help).toContainText(/question/i);
	await flushAxeAudit(berto);
	await berto.keyboard.press('Escape');
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
	await flushAxeAudit(carla);
});

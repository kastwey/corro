// categories.spec.ts — the simultaneous written family end to end.
//
// Three real browser contexts play one full round: the host picks a shared Spanish category
// deck while the interfaces stay personal, everybody writes at once, and the rotating judge
// rules on the answers. The scenario reaches the preparing, writing, finished-writer, review
// and next-round states, with an explicit Axe flush before each transition — including the
// hidden-information check that a rival's answer never reaches another player's DOM.

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

const BOARD = 'letter-rush';

/** The scripted E2E randomness shuffles as the identity, so the deck arrives in file order. */
const LETTER = 'A';

const sheetInput = (page: Page, index: number) =>
	page.locator('.categories-sheet-input').nth(index);
const answerRows = (page: Page) => page.locator('.categories-answer');

async function writeSheet(page: Page, answers: string[]): Promise<void> {
	for (const [index, text] of answers.entries()) {
		await sheetInput(page, index).fill(text);
	}
	// Leaving the last field flushes the debounce, so the sheet is on the server before we act.
	await page.locator('.categories-finish').focus();
}

test.beforeEach(async () => {
	await resetDice();
});

test('a shared Spanish deck, per-player interfaces and one full judged round', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'en-US');
	const berto = await newPlayerPage(browser, 'es-ES');
	const carla = await newPlayerPage(browser, 'es-ES');

	const code = await createGame(ana, 'Ana', BOARD, { maxPlayers: 3, contentLanguage: 'es' });
	await expect(ana.locator('#table-content-language')).toHaveValue('es');
	await joinGame(berto, code, 'Berto');
	await joinGame(carla, code, 'Carla');
	await startGame(ana, [ana, berto, carla]);

	// The interface is each player's own; the categories are the table's, and Spanish for all.
	await expect(ana.locator('.categories-title')).toHaveText('Categories');
	await expect(berto.locator('.categories-title')).toHaveText('Categorías');
	await expect(berto.locator('.categories-sheet-label').first()).toHaveText('Un animal');
	await expect(carla.locator('.categories-sheet-label').first()).toHaveText('Un animal');

	// Ana judges the first round, so she has no sheet at all and the others do.
	await expect(ana.locator('.categories-sheet')).toBeHidden();
	await expect(ana.locator('.categories-start')).toBeVisible();
	await expect(berto.locator('.categories-sheet-input')).toHaveCount(12);
	await expect(berto.locator('.categories-start')).toBeHidden();
	await expect(ana.locator('.categories-duty')).toHaveText(/do not write this round/i);
	await expect(berto.locator('.categories-duty')).toContainText('Ana');

	// Named sibling regions, no nesting and no skipped level; the headings that ANNOUNCE as one
	// level also LOOK like one level (a miss no Axe rule would ever see).
	await expect(ana.locator('.categories-shell > section:not([hidden])')).toHaveCount(2);
	await expect(ana.locator('.categories-shell h4')).toHaveCount(0);
	const headingSizes = await berto.evaluate(() =>
		[...document.querySelectorAll('.categories-shell > section:not([hidden]) > h3')]
			.map(h => getComputedStyle(h).fontSize));
	expect(new Set(headingSizes).size, `section headings differ in size: ${headingSizes}`).toBe(1);
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);

	// ── The clock starts ──────────────────────────────────────────────────────
	await ana.locator('.categories-start').click();
	await expectAnnouncement(berto, new RegExp(`letra ${LETTER}`));
	await expect(berto.locator('.categories-sheet-title, #categories-sheet-title'))
		.toContainText(LETTER);
	await expect(ana.locator('.categories-timer')).toBeVisible();
	// The clock is decoration for everyone: it is hidden from assistive technology outright.
	await expect(ana.locator('.categories-timer')).toHaveAttribute('aria-hidden', 'true');
	await flushAxeAudit(ana);

	// ── Writing ───────────────────────────────────────────────────────────────
	// Every field sits in a group naming its category AND the round's letter, so arriving at
	// the tenth box still says which letter the answer has to start with.
	const firstGroup = berto.locator('.categories-sheet-group').first();
	await expect(firstGroup).toHaveAttribute('role', 'group');
	await expect(firstGroup).toHaveAttribute('aria-label', new RegExp(`Un animal.*letra ${LETTER}`));

	// Enter walks the sheet and stops ON the finish button rather than pressing it.
	await sheetInput(berto, 0).focus();
	await berto.keyboard.type('avestruz');
	await berto.keyboard.press('Enter');
	await expect(sheetInput(berto, 1)).toBeFocused();
	// The letters this surface uses as commands are typed, not swallowed, inside a field.
	await berto.keyboard.type('Argentina');
	await expect(sheetInput(berto, 1)).toHaveValue('Argentina');

	await writeSheet(berto, ['avestruz', 'Argentina', 'Ávila', 'arroz', 'agua', 'azul']);
	await writeSheet(carla, ['araña', 'Argentina', 'Alicante', '', 'anís', 'cereza']);
	// Twelve categories are dealt; the six left blank exercise the "nothing to rule" path.

	// Hidden information: while the clock runs, an answer is in its writer's page and nowhere
	// else — not in a rival's DOM, and not in the judge's.
	await expect(sheetInput(berto, 0)).toHaveValue('avestruz');
	expect(await carla.locator('body').innerText()).not.toContain('avestruz');
	expect(await ana.locator('body').innerText()).not.toContain('avestruz');
	await flushAxeAudit(carla);

	// Finishing early is on offer, keeps its place once used, and says why it no longer acts.
	await berto.locator('.categories-finish').click();
	await expectAnnouncement(carla, /Berto/);
	const bertoFinish = berto.locator('.categories-finish');
	await expect(bertoFinish).toBeVisible();
	await expect(bertoFinish).toHaveAttribute('aria-disabled', 'true');
	await expect(bertoFinish).not.toHaveAttribute('disabled', /.*/);
	await expect(berto.locator('.categories-control-hint')).toBeVisible();
	await expect(ana.locator('.categories-progress')).toContainText('1');
	await flushAxeAudit(berto);

	// ── Review ────────────────────────────────────────────────────────────────
	await carla.locator('.categories-finish').click();
	await expect(ana.locator('.categories-review')).toBeVisible();
	await expect(berto.locator('.categories-sheet')).toBeHidden();
	await expect(ana.locator('.categories-review__category')).toContainText('Un animal');

	// Every answer is one focus stop that reads as a single sentence, and the judge's rows carry
	// the three verdicts. A writer reads the same rows with nothing to press.
	await expect(answerRows(ana)).toHaveCount(2);
	await expect(answerRows(berto)).toHaveCount(2);
	await expect(berto.locator('.categories-verdict')).toHaveCount(0);
	await expect(berto.locator('.categories-confirm')).toBeHidden();
	await expect(answerRows(ana).first()).toHaveAttribute('aria-label', /Berto wrote avestruz\./);
	// A hint is not a ruling: a writer is never told a verdict the judge has not made.
	await expect(answerRows(berto).first())
		.not.toHaveAttribute('aria-label', /marcada como/i);
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);

	// Up/Down walk the answers; Right enters the verdicts and Left comes back out.
	await answerRows(ana).first().focus();
	await ana.keyboard.press('ArrowDown');
	await expect(answerRows(ana).nth(1)).toBeFocused();
	await ana.keyboard.press('ArrowRight');
	await expect(answerRows(ana).nth(1).locator('.categories-verdict').first()).toBeFocused();
	await ana.keyboard.press('ArrowLeft');
	await expect(answerRows(ana).nth(1)).toBeFocused();

	// The hints open the category pre-marked; the judge has the last word over any of them.
	await expect(answerRows(ana).first().locator('.categories-verdict[data-verdict="accepted"]'))
		.toHaveAttribute('aria-pressed', 'true');
	await answerRows(ana).nth(1).locator('.categories-verdict[data-verdict="rejected"]').click();
	await expect(answerRows(ana).nth(1).locator('.categories-verdict[data-verdict="rejected"]'))
		.toHaveAttribute('aria-pressed', 'true');
	await ana.locator('.categories-confirm').click();

	// The table hears the shape of the ruling; each writer hears their own answer's fate.
	await expectAnnouncement(berto, /avestruz/);
	await expectAnnouncement(carla, /araña/);
	await expect(ana.locator('.categories-review__category')).toContainText('Un país');

	// …and every player SEES what was just decided, which is the part a watcher would otherwise
	// miss entirely: the review moves straight on to the next category.
	for (const page of [ana, berto, carla]) {
		const strip = page.locator('.categories-last-ruling');
		await expect(strip).toBeVisible();
		await expect(strip).toHaveAttribute('aria-hidden', 'true');
		await expect(strip).toContainText('Un animal');
		await expect(strip).toContainText('avestruz');
		await expect(strip).toContainText('araña');
	}
	await flushAxeAudit(ana);

	// ── The rest of the round, and the rotation ───────────────────────────────
	for (let category = 1; category < 12; category++) {
		await ana.locator('.categories-confirm').click();
	}

	// Scoring is announced per writer, and the judge moves on to the next player.
	await expectAnnouncement(berto, /Ronda 1/);
	await expect(berto.locator('.categories-start')).toBeVisible();
	await expect(ana.locator('.categories-sheet-input')).toHaveCount(12);
	await expect(ana.locator('.categories-duty')).toContainText('Berto');
	await expect(berto.locator('.categories-review')).toBeHidden();
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
	await flushAxeAudit(carla);
});

test('the surface answers the reading keys without a screen reader having to hunt', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'en-US');
	const berto = await newPlayerPage(browser, 'en-US');
	const carla = await newPlayerPage(browser, 'en-US');

	const code = await createGame(ana, 'Ana', BOARD, { maxPlayers: 3, contentLanguage: 'en' });
	await joinGame(berto, code, 'Berto');
	await joinGame(carla, code, 'Carla');
	await startGame(ana, [ana, berto, carla]);

	// R before the round starts confirms the clock is idle rather than inventing a number.
	await ana.locator('.categories-shell').focus();
	await ana.keyboard.press('r');
	await expectAnnouncement(ana, new RegExp(appI18n('en').game.categories_timer_not_running as string));

	// S is my own standing; Shift+S surveys the others and leaves me out.
	await ana.keyboard.press('s');
	await expectAnnouncement(ana, /judge/i);
	await ana.keyboard.press('Shift+S');
	await expectAnnouncement(ana, /Berto/);

	// R reports the AUTHORITATIVE clock, so wait for the started round to arrive before asking:
	// pressed between the click and the state, it would correctly still say "not running".
	await ana.locator('.categories-start').click();
	await expect(ana.locator('.categories-timer')).toBeVisible();
	await ana.keyboard.press('r');
	await expectAnnouncement(ana, /seconds remaining/i);
	await flushAxeAudit(ana);
	await flushAxeAudit(berto);
	await flushAxeAudit(carla);
});

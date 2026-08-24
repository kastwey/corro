// lobby-accessibility.spec.ts — exercise lobby-only states that board-flow tests do not
// naturally reach. The shared fixture runs Axe after every settled mutation, so keeping each
// state visible long enough for an assertion makes its accessibility part of the suite gate.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	chooseBoard,
	appI18n,
	createGame,
	expectAnnouncement,
	gotoLobbyHome,
	joinGame,
	newPlayerPage,
	packageManifest,
} from '../helpers/game';
import { enlargeText, expectNoSidewaysScroll } from '../helpers/reflow';
import { E2E_BASE_URL } from '../playwright.config';

const TRACK_BOARD = 'snakes-and-ladders';
const FORBIDDEN_BOARD = 'forbidden-words';
const SHEDDING_BOARD = 'four-colours';
const TRIVIA_BOARD = 'wheel-of-wits';

/** A small, real .corro archive used to exercise the browser's successful upload state. */
async function uploadedTrackPackage(): Promise<Buffer> {
	const source = path.resolve(__dirname, '..', '..', 'server', 'Packages', TRACK_BOARD);
	const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
	manifest.id = 'e2e-upload-accessibility';
	manifest.name = { es: 'Pista E2E subida', en: 'Uploaded E2E Track' };
	manifest.warning = 'notices.e2e';
	const en = JSON.parse(await readFile(path.join(source, 'i18n', 'en.json'), 'utf8'));
	const es = JSON.parse(await readFile(path.join(source, 'i18n', 'es.json'), 'utf8'));
	en.notices = { e2e: 'Review this uploaded game before creating the table.' };
	es.notices = { e2e: 'Revisa este juego subido antes de crear la mesa.' };

	const files: Record<string, Uint8Array> = {
		'manifest.json': strToU8(JSON.stringify(manifest)),
		'board.json': await readFile(path.join(source, 'board.json')),
		'i18n/en.json': strToU8(JSON.stringify(en)),
		'i18n/es.json': strToU8(JSON.stringify(es)),
	};
	for (const token of manifest.tokens as Array<{ id: string }>) {
		files[`assets/tokens/${token.id}.svg`] = await readFile(
			path.join(source, 'assets', 'tokens', `${token.id}.svg`),
		);
	}
	return Buffer.from(zipSync(files, { level: 0 }));
}

async function waitForDefaultPackage(page: import('../helpers/test').Page): Promise<void> {
	// The picker's field holds the game's NAME now, so the default board is read off the list's
	// selected option, which is where the id lives.
	const boardId = await page.locator('#board-listbox [aria-selected="true"]')
		.getAttribute('data-item-id');
	const firstToken = packageManifest(boardId!).tokens[0].id as string;
	await expect(page.locator(`#create-form input.token-radio[value="${firstToken}"]`)).toBeAttached();
}

test('switching shipped games keeps the loading feedback visual-only', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);
	await page.locator('#go-create-btn').click();
	await waitForDefaultPackage(page);

	// Keep the request pending so both the transient visual state and its accessibility semantics
	// can be asserted — which means NOT waiting for the staging this test exists to watch.
	await page.route(`**/api/packages/shipped/${TRACK_BOARD}`, async route => {
		await new Promise(resolve => setTimeout(resolve, 400));
		await route.continue();
	});
	await page.evaluate(() => { ((window as any).__announcements as string[]).length = 0; });
	await chooseBoard(page, TRACK_BOARD, { waitForStaging: false });

	const loading = appI18n('es').game.loading_board as string;
	const visualStatus = page.locator('#board-loading-status');
	await expect(visualStatus).toHaveText(loading);
	await expect(visualStatus).toBeVisible();
	await expect(visualStatus).toHaveAttribute('aria-hidden', 'true');
	await expect(visualStatus).not.toHaveAttribute('role', /.+/);
	await expect(visualStatus).not.toHaveAttribute('aria-live', /.+/);
	await flushAxeAudit(page);

	const firstToken = packageManifest(TRACK_BOARD).tokens[0].id as string;
	await expect(page.locator(`#create-form input.token-radio[value="${firstToken}"]`)).toBeAttached();
	const tokenPreview = page.locator(`#create-form input.token-radio[value="${firstToken}"]`)
		.locator('..').locator('.token-icon');
	expect(await tokenPreview.evaluate(icon => parseFloat(getComputedStyle(icon).width))).toBeGreaterThanOrEqual(44);
	await expect(visualStatus).toBeEmpty();
	const heard = await page.evaluate(() => (window as any).__announcements as string[]);
	expect(heard).not.toContain(loading);
});

// Reported from a real session: choosing a game made a screen reader suddenly read the
// player-count combo's selected text, out of nowhere. Staging a board rebuilt that <select>'s
// whole option list every time — even when the new board offered exactly the same range — inside a
// form whose aria-busy was flipping back to false, which is precisely when assistive technology
// re-reads what changed underneath it. A rebuilt <select> re-reads as its selected option.
test('choosing a game does not rewrite the controls it did not change', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(page);
	await page.locator('#go-create-btn').click();
	await waitForDefaultPackage(page);

	// Both of these seat 2–4, so the player-count choices are identical either side of the switch.
	// (A board with a genuinely different range SHOULD rebuild it — that is not this bug.)
	await chooseBoard(page, 'galactic-empire');
	await expect(page.locator('#max-players option')).toHaveCount(3);

	// Watch the control for ANY mutation while another board with the same range is staged.
	await page.evaluate(() => {
		const target = document.getElementById('max-players')!;
		(window as any).__maxPlayersMutations = 0;
		(window as any).__maxPlayersDetail = [];
		(window as any).__maxPlayersWatcher = new MutationObserver(records => {
			(window as any).__maxPlayersMutations += records.length;
			for (const record of records) {
				(window as any).__maxPlayersDetail.push(
					`${record.type}:${record.attributeName ?? ''}:${(record.target as HTMLElement).nodeName}`);
			}
		});
		(window as any).__maxPlayersWatcher.observe(target, {
			childList: true, subtree: true, characterData: true, attributes: true,
		});
	});

	await chooseBoard(page, 'galactic-race');
	const firstToken = packageManifest('galactic-race').tokens[0].id as string;
	await expect(page.locator(`#create-form input.token-radio[value="${firstToken}"]`)).toBeAttached();
	// The staging is finished, so anything that was going to touch the control already has.
	await expect(page.locator('#create-form')).not.toHaveAttribute('aria-busy', 'true');

	// Not "fewer announcements": none, because nothing about this control changed.
	expect(await page.evaluate(() => (window as any).__maxPlayersDetail))
		.toEqual([]);
});

// The game picker is an editable combobox whose list you can also just walk — because somebody who
// does not know the catalogue cannot type its name, and somebody who does should not have to
// arrow past twenty games to reach it.
test('the game picker filters by typing and is walked with the arrows, never with Tab', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(page);
	await page.locator('#go-create-btn').click();
	await waitForDefaultPackage(page);

	const field = page.locator('#board-selector');
	const listbox = page.locator('#board-listbox');
	const options = listbox.locator('[role="option"]');

	// It announces itself as a combobox with a list, and the list is named.
	await expect(field).toHaveRole('combobox');
	await expect(field).toHaveAttribute('aria-controls', 'board-listbox');
	await expect(field).toHaveAttribute('aria-autocomplete', 'list');
	await expect(field).toHaveAttribute('aria-expanded', 'true');
	await expect(listbox).toHaveAccessibleName('Selecciona el juego:');

	// Alphabetical, in the reader's language.
	const names = await options.allTextContents();
	expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'es')));

	// The list is not in the tab order — the APG's one hard rule for a combobox popup. Asserted by
	// naming where focus MUST land, not by ruling out the first option: the original version of
	// this check only excluded the option, and missed the list itself sitting in the tab sequence.
	//
	// It got there on its own. This list scrolls, and Chrome makes a scroll container
	// keyboard-focusable when it has no tabbable children — which is exactly a listbox whose
	// options are all tabindex="-1". The explicit tabindex="-1" on the list opts out of that.
	await field.focus();
	await page.keyboard.press('Tab');
	await expect(page.locator('#board-upload')).toBeFocused();

	// …and from inside the list, Tab leaves the whole control rather than walking the options.
	await field.focus();
	await page.keyboard.press('ArrowDown');
	await expect(options.first()).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(page.locator('#board-upload')).toBeFocused();

	// Down enters at the game already chosen (the APG's listbox rule), Up is the shortcut to the end.
	const chosen = listbox.locator('[aria-selected="true"]');
	await field.focus();
	await page.keyboard.press('ArrowDown');
	await expect(chosen).toBeFocused();
	await field.focus();
	await page.keyboard.press('ArrowUp');
	await expect(options.last()).toBeFocused();
	await flushAxeAudit(page);

	// Typing from inside the list lands in the field and narrows what is left. It REPLACES the
	// game already chosen rather than extending its name: appending to "Carrera Galácticas" would
	// search for something nobody asked for and find nothing.
	await page.keyboard.press('s');
	await expect(field).toBeFocused();
	await expect(field).toHaveValue('s');
	const narrowed = await options.count();
	expect(narrowed).toBeGreaterThan(0);
	expect(narrowed).toBeLessThan(names.length);

	// The count is on screen for the eye and hidden from assistive tech, so it is never said twice.
	const visible = page.locator('#board-results');
	await expect(visible).toHaveText(/resultados? encontrados?/);
	await expect(visible).toHaveAttribute('aria-hidden', 'true');
	// …and the spoken copy arrives after the typing stops, once, through a live region.
	await expect(page.locator('#board-results-live')).toHaveText(/resultados? encontrados?/);
	await flushAxeAudit(page);

	// A search that matches nothing is a real, reachable state: no options, and no popup to expand.
	await field.fill('zzzzz');
	await expect(options).toHaveCount(0);
	await expect(field).toHaveAttribute('aria-expanded', 'false');
	await expect(visible).toHaveText('Sin resultados');
	await expect(page.locator('#board-results-live')).toHaveText('Sin resultados');
	await flushAxeAudit(page);
});

// Both families whose CONTENT is language-split reach the same picker: the words a Forbidden
// Words table guesses, and the questions a trivia table answers. It is one shared deck for the
// whole table, deliberately separate from each player's own interface language.
for (const board of [
	{ id: FORBIDDEN_BOARD, label: 'Forbidden Words' },
	{ id: TRIVIA_BOARD, label: 'trivia' },
]) {
	test(`${board.label} offers one accessible shared content-language choice`, async ({ browser }) => {
		const page = await newPlayerPage(browser, 'es-ES');
		await gotoLobbyHome(page);
		await page.locator('#go-create-btn').click();
		await chooseBoard(page, board.id);
		const firstToken = packageManifest(board.id).tokens[0].id as string;
		await expect(page.locator(`#create-form input.token-radio[value="${firstToken}"]`)).toBeAttached();

		const group = page.locator('#content-language-group');
		const select = page.locator('#content-language');
		await expect(group).toBeVisible();
		await expect(select).toHaveAccessibleName('Idioma del contenido');
		await expect(select).toHaveAttribute('aria-describedby', 'content-language-hint');
		await expect(select.locator('option')).toHaveText(['Inglés', 'Español']);
		await expect(select).toHaveValue('es');
		await flushAxeAudit(page);

		// The host's explicit deck choice is theirs to keep, and nothing about their own interface
		// rewrites it: the labels stay in the interface language while the VALUE stays as chosen.
		// (Applying an interface language leaves this form altogether for that language's own lobby
		// — one URL per language — which lobby-localization.spec.ts covers.)
		await select.selectOption('en');
		await expect(select).toHaveValue('en');
		await expect(select.locator('option')).toHaveText(['Inglés', 'Español']);
		await flushAxeAudit(page);

		// A board whose content is NOT language-split offers no choice at all.
		await chooseBoard(page, TRACK_BOARD);
		await expect(group).toBeHidden();
	});

}

test('Four Colours offers the scoring direction as a named, accessible radio group', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(page);
	await page.locator('#go-create-btn').click();
	await chooseBoard(page, SHEDDING_BOARD);
	const firstToken = packageManifest(SHEDDING_BOARD).tokens[0].id as string;
	await expect(page.locator(`#create-form input.token-radio[value="${firstToken}"]`)).toBeAttached();

	await page.locator('#rules-details').evaluate(el => { (el as HTMLDetailsElement).open = true; });
	const options = page.locator('#package-rules [data-rule-id="sheddingScoring"]');
	await expect(options).toHaveCount(2);
	// The radios live in their OWN fieldset, whose legend is what names the group for a
	// screen reader (the `has` locator resolves relative to that fieldset).
	const group = page.locator('#package-rules fieldset.rule-choice', {
		has: page.locator('[data-rule-id="sheddingScoring"]'),
	});
	await expect(group.locator('legend')).toHaveText('Cómo se cuentan los puntos');
	await expect(options.nth(0)).toBeChecked(); // the classic count is the default
	await expect(options.nth(1)).not.toBeChecked();
	await flushAxeAudit(page);

	// The other selection is a state of its own: keep it visible long enough to be audited.
	await options.nth(1).dispatchEvent('click');
	await expect(options.nth(1)).toBeChecked();
	await expect(options.nth(0)).not.toBeChecked();
	await flushAxeAudit(page);
});

test('Four Colours lets the host say how the match ends, and with which number', async ({ browser }) => {
	// Both endings existed in the engine; neither could be chosen without editing the package.
	const page = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(page);
	await page.locator('#go-create-btn').click();
	await chooseBoard(page, SHEDDING_BOARD);
	const firstToken = packageManifest(SHEDDING_BOARD).tokens[0].id as string;
	await expect(page.locator(`#create-form input.token-radio[value="${firstToken}"]`)).toBeAttached();
	await page.locator('#rules-details').evaluate(el => { (el as HTMLDetailsElement).open = true; });

	const ending = page.locator('#package-rules [data-rule-id="sheddingEndMode"]');
	const group = page.locator('#package-rules fieldset.rule-choice', {
		has: page.locator('[data-rule-id="sheddingEndMode"]'),
	});
	await expect(group.locator('legend')).toHaveText('Cuándo termina la partida');
	await expect(ending).toHaveCount(2);
	await expect(ending.nth(0)).toBeChecked(); // by points, as this game always did

	// Only the number that decides THIS match is on the form. Reported from use: offering both
	// leaves one control that changes nothing, and a host walking the form has to pass it.
	const points = page.locator('#package-rules [data-rule-id="sheddingTargetScore"]');
	const rounds = page.locator('#package-rules [data-rule-id="sheddingRounds"]');
	await expect(points).toBeVisible();
	await expect(rounds).toBeHidden();
	await expect(points).toHaveValue('500');
	await expect(points).toHaveAttribute('step', '1');
	await expect(points).toHaveAttribute('min', '1'); // no zero, no negatives; no ceiling either
	await expect(points).not.toHaveAttribute('max', /.*/);
	await flushAxeAudit(page);

	await ending.nth(1).dispatchEvent('click');
	await expect(ending.nth(1)).toBeChecked();
	await expect(rounds).toBeVisible();
	await expect(points).toBeHidden();
	await rounds.fill('7');
	await expect(rounds).toHaveValue('7');
	// Hidden, not emptied: the points keep the figure, so switching back needs no retyping.
	await expect(points).toHaveValue('500');
	await flushAxeAudit(page);
});

test('Forbidden Words offers the same ending choice, with its own numbers', async ({ browser }) => {
	// The point of the rule: one mechanism, values that belong to each game. A party word game
	// counts in tens of points and a handful of rotations, not in hundreds.
	const page = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(page);
	await page.locator('#go-create-btn').click();
	await chooseBoard(page, FORBIDDEN_BOARD);
	const firstToken = packageManifest(FORBIDDEN_BOARD).tokens[0].id as string;
	await expect(page.locator(`#create-form input.token-radio[value="${firstToken}"]`)).toBeAttached();
	await page.locator('#rules-details').evaluate(el => { (el as HTMLDetailsElement).open = true; });

	const ending = page.locator('#package-rules [data-rule-id="forbiddenEndMode"]');
	const group = page.locator('#package-rules fieldset.rule-choice', {
		has: page.locator('[data-rule-id="forbiddenEndMode"]'),
	});
	await expect(group.locator('legend')).toHaveText('Cuándo termina la partida');
	await expect(ending.nth(0)).toBeChecked(); // by rounds, as this family always did
	const cycles = page.locator('#package-rules [data-rule-id="forbiddenCycles"]');
	const target = page.locator('#package-rules [data-rule-id="forbiddenTargetScore"]');
	await expect(cycles).toBeVisible();
	await expect(cycles).toHaveValue('5');
	await expect(target).toBeHidden();
	await flushAxeAudit(page);

	await ending.nth(1).dispatchEvent('click');
	await expect(ending.nth(1)).toBeChecked();
	await expect(target).toBeVisible();
	await expect(target).toHaveValue('30'); // tens of points, not hundreds: this game's own figure
	await expect(cycles).toBeHidden();
	await flushAxeAudit(page);
});

test('home, dark theme, runtime language and create/join validation states are Axe-clean', async ({ browser }) => {
	const host = await newPlayerPage(browser);
	await gotoLobbyHome(host);
	const brand = host.locator('.brand-heading');
	await expect(brand).toHaveAccessibleName('All Welcome');
	await expect(host.locator('[data-site-tagline]')).toHaveText('Juega en compañía, juega a tu manera.');
	await expect(host).toHaveTitle('All Welcome');
	await expect(brand.locator('.brand-logo__image--light')).toBeVisible();
	await expect(brand.locator('.brand-logo__image--dark')).toBeHidden();
	await expect(brand.locator('.brand-logo__image--light')).toHaveAttribute(
		'src', 'assets/brand/all-welcome-logo-on-light.svg');
	await expect(brand.locator('.brand-logo__image--dark')).toHaveAttribute(
		'src', 'assets/brand/all-welcome-logo-on-dark.svg');
	await expect(host.locator('link[data-site-favicon]')).toHaveCount(2);
	const preferences = host.locator('.language-selector');
	const corro = host.locator('.app-footer a[data-footer-link="corro"]');
	const license = host.locator('.app-footer a[data-footer-link="license"]');
	await expect(corro).toHaveAttribute('href', 'https://github.com/kastwey/corro');
	await expect(corro).toContainText('Corro');
	await expect(corro).toHaveAttribute('target', '_blank');
	await expect(corro).toHaveAttribute('aria-label', appI18n('es').footer.corroNewWindowLabel as string);
	await expect(host.locator('.app-footer a[data-footer-link="repository"]')).toHaveCount(0);
	await expect(license).toHaveAttribute('target', '_blank');
	await expect(license).toHaveAttribute('aria-label', appI18n('es').footer.licenseNewWindowLabel as string);
	for (const link of [corro, license]) {
		await expect(link.locator('.app-footer__external-icon')).toHaveAttribute('aria-hidden', 'true');
	}
	const brandBox = (await brand.boundingBox())!;
	const logoBox = (await brand.locator('.brand-logo').boundingBox())!;
	const preferencesBox = (await preferences.boundingBox())!;
	expect(logoBox.width).toBeLessThanOrEqual(241);
	expect(brandBox.y + brandBox.height).toBeLessThan(preferencesBox.y);

	// Initial Spanish/light home is scanned by gotoLobbyHome; now exercise the other palette and
	// the English lobby the selector navigates to, before entering the forms.
	await host.locator('#theme-toggle').click();
	await expect(host.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(brand.locator('.brand-logo__image--light')).toBeHidden();
	await expect(brand.locator('.brand-logo__image--dark')).toBeVisible();
	await host.locator('#language-selector').selectOption('en');
	await host.locator('#language-apply-btn').click();
	await expect(host).toHaveURL(new RegExp(`${E2E_BASE_URL}/?$`));
	// Applying a language NAVIGATES to that language's own lobby, so what follows must wait for
	// the new page to finish booting — the same readiness anchor gotoLobbyHome uses. Without it,
	// a click can land before init() has attached its handlers (and be undone by its final
	// showView), which is a race the old in-place retranslation never had.
	await expect(host.locator('#your-games-empty, #your-games-list li').first()).toBeVisible();
	await expect(host.locator('#home-heading')).toHaveText(appI18n('en').lobby.home.heading as string);
	await expect(host.locator('[data-site-tagline]')).toHaveText('Play together, play your way.');
	await expect(corro).toHaveAttribute('aria-label', appI18n('en').footer.corroNewWindowLabel as string);
	await expect(license).toHaveAttribute('aria-label', appI18n('en').footer.licenseNewWindowLabel as string);

	await host.locator('#go-create-btn').click();
	await expect(host.locator('#view-create')).toBeVisible();
	await waitForDefaultPackage(host);

	// Client-side error states are persistent DOM states too; scan both validation branches.
	await host.locator('#create-button').click();
	await expect(host.locator('#error-message')).toContainText('Please enter your name');
	// Reported from a real session, about a refusal on a different screen: the message existed,
	// said the right thing, and rendered four hundred pixels below the fold of a page taller than
	// the window, where nobody saw it. It lives ABOVE the views now, and is an alert rather than a
	// box that gets revealed — asserted structurally, because where it ends up scrolled to is a
	// race against its own five-second clock and this is the part that decides it.
	expect(await host.locator('#error-message').evaluate(el => ({
		role: el.getAttribute('role'),
		beforeTheViews: !!(el.compareDocumentPosition(document.getElementById('view-home')!)
			& Node.DOCUMENT_POSITION_FOLLOWING),
		insideAView: !!el.closest('.lobby-view'),
	}))).toEqual({ role: 'alert', beforeTheViews: true, insideAView: false });
	await host.locator('#host-name').fill('Ana');
	await host.locator('#create-form input.token-radio').evaluateAll(radios => {
		for (const radio of radios) (radio as HTMLInputElement).checked = false;
	});
	await host.locator('#create-button').click();
	await expect(host.locator('#error-message')).toContainText('Please select a token');
	await host.locator('#create-form input.token-radio').first().dispatchEvent('click');
	await host.locator('#create-button').click();
	// Creating lands the host at their TABLE, on the game page.
	await expect(host.locator('#table-view')).toBeVisible();
	const inviteCode = (await host.locator('#table-code').textContent())!.trim();

	const guest = await newPlayerPage(browser);
	await gotoLobbyHome(guest);
	await guest.locator('#go-join-btn').click();
	await guest.locator('#validate-code-button').click();
	await expect(guest.locator('#error-message')).toContainText(/código/i);

	await guest.locator('#lobby-code-input').fill(inviteCode);
	await guest.locator('#validate-code-button').click();
	await expect(guest.locator('#join-step2')).toBeVisible();
	await guest.locator('#join-final-button').click();
	await expect(guest.locator('#error-message')).toContainText(/nombre/i);
	await guest.locator('#player-name-step2').fill('Berto');
	await guest.locator('#join-token-list input.token-radio').evaluateAll(radios => {
		for (const radio of radios) (radio as HTMLInputElement).checked = false;
	});
	await guest.locator('#join-final-button').click();
	await expect(guest.locator('#error-message')).toContainText(/ficha/i);
	await guest.locator('#join-token-list input.token-radio:not([data-taken])').first().dispatchEvent('click');
	await guest.locator('#join-final-button').click();
	// The guest lands at the same table, and the host sees them arrive there.
	await expect(guest.locator('#table-view')).toBeVisible();
	await expect(host.locator('#table-players')).toContainText('Berto');
	await flushAxeAudit(guest);

	// A guest gets the LEAVE variant of the saved-game row (the host gets delete, covered below):
	// somebody else's table is not yours to delete, and giving up the seat is asked first, because
	// it is not reversible and the rest of the table sees it.
	await guest.locator('#table-back').click();
	await expect(guest.locator('#view-home')).toBeVisible();
	const guestSaved = guest.locator('#your-games-list .saved-game-item');
	await expect(guestSaved.locator('.saved-game-delete')).toHaveCount(0);
	await expect(guestSaved.locator('.saved-game-leave')).toBeVisible();
	await guestSaved.locator('.saved-game-leave').dispatchEvent('click');
	const leaveConfirm = guest.locator('.game-dialog.dialog-confirm');
	await expect(leaveConfirm).toBeVisible();
	await flushAxeAudit(guest);
	await leaveConfirm.locator('.btn-primary').click();
	await expect(guest.locator('#your-games-empty')).toBeVisible();
	// And it is a real departure, not a row hidden on one device: the table has the seat back.
	await expect(host.locator('#table-players')).not.toContainText('Berto');
});

test('compact lobby keeps brand, preferences, content and footer in one vertical flow', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await page.setViewportSize({ width: 360, height: 800 });
	await gotoLobbyHome(page);

	const brand = page.locator('.brand-heading');
	const brandBox = (await brand.boundingBox())!;
	const logoBox = (await brand.locator('.brand-logo').boundingBox())!;
	const preferencesBox = (await page.locator('.language-selector').boundingBox())!;
	const mainBox = (await page.locator('main.container').boundingBox())!;
	const footerBox = (await page.locator('.app-footer').boundingBox())!;

	expect(logoBox.width).toBeLessThanOrEqual(199);
	expect(brandBox.y + brandBox.height).toBeLessThan(preferencesBox.y);
	expect(footerBox.y).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 1);
	const horizontalExtent = await page.evaluate(() => ({
		client: document.documentElement.clientWidth,
		scroll: document.documentElement.scrollWidth,
	}));
	expect(horizontalExtent.scroll).toBeLessThanOrEqual(horizontalExtent.client);
	await expect(page.locator('.app-footer a[data-footer-link="corro"]')).toContainText('Corro');
});

// What a host may publish about their server: how many tables have somebody at them and how many
// people are connected. It answers "is anyone else here?", which is what decides whether a visitor
// bothers creating a table at all.
test('a deployment that publishes its activity says so in the footer, quietly', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);

	const line = page.locator('#site-activity');
	await expect(line).toBeVisible();
	// One flowing line carrying both facts — nobody is at a table on this server yet.
	await expect(line).toHaveText('0 mesas activas, 0 jugadores conectados.');

	// Never a live region. A footer that speaks over somebody reading the page is worse than a
	// footer with one fact fewer, and these numbers move whenever anybody anywhere sits down.
	await expect(line).not.toHaveAttribute('aria-live', /.*/);
	await expect(line).not.toHaveAttribute('role', /.*/);

	// It lives with the line about what this SITE is, not inside the navigation of ways OUT of it.
	await expect(page.locator('.app-footer__nav #site-activity')).toHaveCount(0);

	// Those ways out ARE navigation, and a named landmark: somebody jumping by region should find
	// them by name instead of hunting the end of the document.
	const footerNav = page.getByRole('navigation', { name: 'Navegación del pie' });
	await expect(footerNav).toBeVisible();
	await expect(footerNav.getByRole('link')).not.toHaveCount(0);
	await flushAxeAudit(page);

	// It counts people, not rows — and says "1 mesa activa", never "1 mesas activas".
	const host = await newPlayerPage(browser);
	const code = await createGame(host, 'Ana', 'snakes-and-ladders');
	await page.reload();
	await expect(page.locator('#site-activity'))
		.toHaveText('1 mesa activa, 1 jugador conectado.');
	await flushAxeAudit(page);

	// A second person at the SAME table is another player, not another table.
	const guest = await newPlayerPage(browser);
	await joinGame(guest, code, 'Berto');
	await page.reload();
	await expect(page.locator('#site-activity'))
		.toHaveText('1 mesa activa, 2 jugadores conectados.');
	await flushAxeAudit(page);
});

test('invalid and successful .corro upload states, including removal, are Axe-clean', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);
	await page.locator('#go-create-btn').click();
	await waitForDefaultPackage(page);

	// Hold each HTTP upload long enough for the mutation monitor to audit the live "Uploading…"
	// status rather than observing only the final response.
	await page.route('**/api/packages', async route => {
		await new Promise(resolve => setTimeout(resolve, 180));
		await route.continue();
	});

	const input = page.locator('#board-upload');
	await input.setInputFiles({
		name: 'broken.corro',
		mimeType: 'application/zip',
		buffer: Buffer.from('not a zip archive'),
	});
	await expect(page.locator('#error-message')).toBeVisible();
	await expect(page.locator('#error-message')).not.toBeEmpty();

	await input.setInputFiles({
		name: 'uploaded-track.corro',
		mimeType: 'application/zip',
		buffer: await uploadedTrackPackage(),
	});
	await expect(page.locator('#board-upload-status')).toContainText(/Subiendo|Uploading/);
	await expect(page.locator('#board-uploaded-group')).toBeVisible();
	await expect(page.locator('#board-uploaded-name')).toContainText('Pista E2E subida');
	await expect(page.locator('#board-upload-remove')).toBeVisible();

	// The uploaded-package chrome must also remain readable under the dark palette.
	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	// Uploaded packages may carry a create-time notice; keep that confirmation state under Axe too.
	await page.locator('#host-name').fill('Ana');
	await page.locator('#create-button').dispatchEvent('click');
	const notice = page.locator('.game-dialog.dialog-confirm');
	await expect(notice).toBeVisible();
	await expect(notice.locator('.dialog-content')).toContainText('Revisa este juego subido');
	await flushAxeAudit(page);
	await notice.locator('.btn-secondary').click();

	await page.locator('#board-upload-remove').click();
	await expect(page.locator('#board-selector-group')).toBeVisible();
	await expect(page.locator('#board-upload-remove')).toBeHidden();
	await waitForDefaultPackage(page);
});

test('unlock prompt and its feedback are Axe-clean and announced from every lobby view', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);
	await page.locator('#go-create-btn').click();
	await expect(page.locator('#view-create')).toBeVisible();
	await page.locator('#host-name').focus();
	// Regression: a focused create-form control may consume the bubbling keydown. The unlock
	// chord is page-global and must be caught before that target handler.
	await page.locator('#host-name').evaluate(input => {
		input.addEventListener('keydown', event => event.stopPropagation());
	});

	await page.keyboard.press('Control+Shift+Alt+C');
	const dialog = page.locator('.game-dialog.dialog-unlock');
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('#unlock-code-input')).toBeFocused();
	await dialog.locator('#unlock-code-input').fill('NO-EXISTE');
	await flushAxeAudit(page);
	await dialog.locator('#unlock-code-input').press('Enter');
	await expect(dialog).toBeHidden();
	await expectAnnouncement(page, /Ningún juego se ha desbloqueado/);

	// Regression: this live region used to sit inside the hidden waiting-room view, making home-screen
	// unlock feedback silent to real assistive technology.
	expect(await page.locator('#lobby-live').evaluate(element => element.closest('.lobby-view') === null)).toBe(true);
	// …and what it says does not STAY said. It is visually hidden but perfectly readable with the
	// virtual cursor, so a line left behind would sit at the bottom of the lobby to be stumbled on
	// long after it was spoken (the same debt the chat's spoken log carried).
	await expect(page.locator('#lobby-live')).toBeEmpty({ timeout: 10_000 });
});

test('an unlocked hidden shipped package can be selected and used to create a game', async ({ browser }) => {
	const host = await newPlayerPage(browser);
	await gotoLobbyHome(host);
	await host.locator('#go-create-btn').click();
	await expect(host.locator('#board-listbox [data-item-id="hidden"]')).toHaveCount(0);

	await host.keyboard.press('Control+Shift+Alt+C');
	const unlock = host.locator('.game-dialog.dialog-unlock');
	await unlock.locator('#unlock-code-input').fill('e2e-hidden');
	await unlock.locator('#unlock-code-input').press('Enter');
	await expectAnnouncement(host, /Desbloqueado: Hidden \(prueba E2E\)/);
	await expect(host.locator('#board-listbox [data-item-id="hidden"]')).toHaveCount(1);

	// The code is browser state, not one-shot UI state: after a fresh navigation the hidden
	// package must still be listed because the client replays the stored unlock header.
	await gotoLobbyHome(host);
	await host.locator('#go-create-btn').click();
	await expect(host.locator('#board-listbox [data-item-id="hidden"]')).toHaveCount(1);

	// Reproduce the original race: stage the hidden package slowly and submit immediately.
	// Create must wait for this POST+i18n chain rather than using the previously staged game.
	await host.route('**/api/packages/shipped/hidden', async route => {
		await new Promise(resolve => setTimeout(resolve, 400));
		await route.continue();
	});
	await chooseBoard(host, 'hidden');
	await host.locator('#host-name').fill('Ana');
	await host.locator('#create-button').dispatchEvent('click');

	const notice = host.locator('.game-dialog.dialog-confirm');
	await expect(notice).toBeVisible();
	await expect(notice.locator('.dialog-content')).toContainText('Este juego oculto solo existe');
	await expect(host.locator('#create-form input.token-radio[value="circle"]')).toBeChecked();
	await flushAxeAudit(host);
	await notice.locator('.btn-primary').click();
	await expect(host.locator('#table-view')).toBeVisible();
	const inviteCode = (await host.locator('#table-code').textContent())!.trim();

	// Joining never requires the unlock code: the invite identifies an already-created game.
	const guest = await newPlayerPage(browser);
	await joinGame(guest, inviteCode, 'Berto');
	await host.locator('#table-start-btn').click();
	await expect.poll(() => host.url()).toMatch(/board\.html/);
	await expect.poll(() => guest.url()).toMatch(/board\.html/);
	await expect(host.locator('#board .track-cell[data-square="12"]')).toBeVisible();
	await expect(guest.locator('#board .track-cell[data-square="12"]')).toBeVisible();
	await expect(host.locator('#board .track-cell[data-square="13"]')).toHaveCount(0);
});

test('saved-game card, resume, dark palette and delete confirmation states are Axe-clean', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await createGame(page, 'Ana', TRACK_BOARD);
	// Copy actions briefly replace their labels; scan those transient feedback states explicitly.
	await page.evaluate(() => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: async () => {} },
		});
	});
	await page.locator('#table-copy-code').dispatchEvent('click');
	await expect(page.locator('#table-copy-code')).toContainText(/Copiado|Copied/);
	await flushAxeAudit(page);
	await page.locator('#table-copy-link').dispatchEvent('click');
	await expect(page.locator('#table-copy-link')).toContainText(/Copiado|Copied/);
	await flushAxeAudit(page);

	await page.locator('#table-back').click();
	await expect(page.locator('#view-home')).toBeVisible();
	const saved = page.locator('#your-games-list .saved-game-item');
	await expect(saved).toHaveCount(1);
	await expect(saved.locator('.saved-game-resume')).toBeVisible();
	await expect(saved.locator('.saved-game-delete')).toBeVisible();

	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	// Resuming a table with no match running takes you back to the table itself.
	await saved.locator('.saved-game-resume').dispatchEvent('click');
	await expect(page.locator('#table-view')).toBeVisible();
	await page.locator('#table-back').click();
	await expect(page.locator('#view-home')).toBeVisible();
	await expect(saved).toHaveCount(1);

	// Scan both decisions: cancel keeps the card; confirm removes it and restores the empty home.
	await saved.locator('.saved-game-delete').dispatchEvent('click');
	let confirm = page.locator('.game-dialog.dialog-confirm');
	await expect(confirm).toBeVisible();
	await flushAxeAudit(page);
	await confirm.locator('.btn-secondary').click();
	await expect(saved).toHaveCount(1);

	await saved.locator('.saved-game-delete').dispatchEvent('click');
	confirm = page.locator('.game-dialog.dialog-confirm');
	await expect(confirm).toBeVisible();
	await flushAxeAudit(page);
	await confirm.locator('.btn-primary').click();
	await expect(page.locator('#your-games-empty')).toBeVisible();
});

// Nothing in this suite had ever enlarged the text, so nothing could see what happens to a
// layout that only reflows through breakpoints: the viewport keeps its width, everything sized
// in rem grows, and a fixed-column grid bursts its container. The token picker did exactly that
// — the row of pieces ran off the right edge and the whole page scrolled sideways, which is what
// our own rule forbids and what a low-vision player pays for, since a game cannot be created
// without reaching a piece (issue #14).
//
// 900 CSS px at 200% is about 450px of usable width, comfortably inside what WCAG 1.4.10 asks
// for; the walk covers the lobby views this file already scans at normal size.
test('the lobby reflows at 200% text instead of scrolling sideways', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await page.setViewportSize({ width: 900, height: 900 });
	await enlargeText(page, 200);

	await gotoLobbyHome(page);
	await expectNoSidewaysScroll(page, 'the lobby home');

	await page.locator('#go-create-btn').click();
	await expectNoSidewaysScroll(page, 'the create form, before a board is chosen');

	// The piece picker is the part that broke: it arrives with the staged package and is as wide
	// as that package has pieces.
	await chooseBoard(page, SHEDDING_BOARD);
	const firstToken = packageManifest(SHEDDING_BOARD).tokens[0].id as string;
	await expect(page.locator(`.token-list:not(#join-token-list) input[value="${firstToken}"]`))
		.toBeAttached();
	await expectNoSidewaysScroll(page, 'the create form with a package staged');
	await flushAxeAudit(page);

	// The house rules the same package declares, open.
	await page.locator('#rules-details').evaluate(el => { (el as HTMLDetailsElement).open = true; });
	await expect(page.locator('#package-rules')).toBeVisible();
	await expectNoSidewaysScroll(page, 'the create form with the house rules open');
	await flushAxeAudit(page);

	// A race board asks for a SEAT as well as a piece: two of these grids, one above the other.
	await chooseBoard(page, 'galactic-race');
	await expect(page.locator('#seat-fieldset')).toBeVisible();
	await expectNoSidewaysScroll(page, 'the create form with both a piece and a seat to choose');

	await gotoLobbyHome(page);
	await page.locator('#go-join-btn').click();
	await expect(page.locator('#lobby-code-input')).toBeVisible();
	await expectNoSidewaysScroll(page, 'the join form');
	await flushAxeAudit(page);
});

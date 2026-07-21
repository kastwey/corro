// lobby-accessibility.spec.ts — exercise lobby-only states that board-flow tests do not
// naturally reach. The shared fixture runs Axe after every settled mutation, so keeping each
// state visible long enough for an assertion makes its accessibility part of the suite gate.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	appI18n,
	createGame,
	expectAnnouncement,
	gotoLobbyHome,
	joinGame,
	newPlayerPage,
	packageManifest,
} from '../helpers/game';

const TRACK_BOARD = 'snakes-and-ladders';

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
	const boardId = await page.locator('#board-selector').inputValue();
	const firstToken = packageManifest(boardId).tokens[0].id as string;
	await expect(page.locator(`#create-form input.token-radio[value="${firstToken}"]`)).toBeAttached();
}

test('switching shipped games keeps the loading feedback visual-only', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);
	await page.locator('#go-create-btn').click();
	await waitForDefaultPackage(page);

	// Keep the request pending so both the transient visual state and its accessibility semantics
	// can be asserted. Arrowing a native select fires the same change path as selectOption().
	await page.route(`**/api/packages/shipped/${TRACK_BOARD}`, async route => {
		await new Promise(resolve => setTimeout(resolve, 400));
		await route.continue();
	});
	await page.evaluate(() => { ((window as any).__announcements as string[]).length = 0; });
	await page.locator('#board-selector').selectOption(TRACK_BOARD);

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
	await expect(visualStatus).toBeEmpty();
	const heard = await page.evaluate(() => (window as any).__announcements as string[]);
	expect(heard).not.toContain(loading);
});

test('home, dark theme, runtime language and create/join validation states are Axe-clean', async ({ browser }) => {
	const host = await newPlayerPage(browser);
	await gotoLobbyHome(host);
	const brand = host.locator('.brand-heading');
	await expect(brand).toHaveAccessibleName('Corro');
	await expect(brand.locator('.brand-logo__image--light')).toBeVisible();
	await expect(brand.locator('.brand-logo__image--dark')).toBeHidden();
	const preferences = host.locator('.language-selector');
	const repository = host.locator('.app-footer a[data-i18n="footer.repository"]');
	await expect(repository).toHaveAttribute('href', 'https://github.com/kastwey/corro');
	await expect(repository).toHaveText(appI18n('es').footer.repository as string);
	const brandBox = (await brand.boundingBox())!;
	const logoBox = (await brand.locator('.brand-logo').boundingBox())!;
	const preferencesBox = (await preferences.boundingBox())!;
	expect(logoBox.width).toBeLessThanOrEqual(241);
	expect(brandBox.y + brandBox.height).toBeLessThan(preferencesBox.y);

	// Initial Spanish/light home is scanned by gotoLobbyHome; now exercise the other palette and
	// a live language rebind before entering the forms.
	await host.locator('#theme-toggle').click();
	await expect(host.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(brand.locator('.brand-logo__image--light')).toBeHidden();
	await expect(brand.locator('.brand-logo__image--dark')).toBeVisible();
	await host.locator('#language-selector').selectOption('en');
	await host.locator('#language-apply-btn').click();
	await expect(host.locator('#home-heading')).toHaveText('Your games');
	await expect(repository).toHaveText(appI18n('en').footer.repository as string);

	await host.locator('#go-create-btn').click();
	await expect(host.locator('#view-create')).toBeVisible();
	await waitForDefaultPackage(host);

	// Client-side error states are persistent DOM states too; scan both validation branches.
	await host.locator('#create-button').click();
	await expect(host.locator('#error-message')).toContainText('Please enter your name');
	await host.locator('#host-name').fill('Ana');
	await host.locator('#create-form input.token-radio').evaluateAll(radios => {
		for (const radio of radios) (radio as HTMLInputElement).checked = false;
	});
	await host.locator('#create-button').click();
	await expect(host.locator('#error-message')).toContainText('Please select a token');
	await host.locator('#create-form input.token-radio').first().dispatchEvent('click');
	await host.locator('#create-button').click();
	await expect(host.locator('#lobby-created')).toBeVisible();
	const inviteCode = (await host.locator('#lobby-code').textContent())!.trim();

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
	await expect(guest.locator('#lobby-joined')).toBeVisible();
	await expect(host.locator('#host-player-list')).toContainText('Berto');

	// A guest gets the remove-only saved-game variant (the host gets delete, covered below).
	await guest.locator('#waiting-back-btn').dispatchEvent('click');
	await expect(guest.locator('#view-home')).toBeVisible();
	const guestSaved = guest.locator('#your-games-list .saved-game-item');
	await expect(guestSaved.locator('.saved-game-remove')).toBeVisible();
	await guestSaved.locator('.saved-game-remove').dispatchEvent('click');
	await expect(guest.locator('#your-games-empty')).toBeVisible();
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
	await expect(page.locator('.app-footer a[data-i18n="footer.repository"]')).toHaveText(
		appI18n('es').footer.repository as string,
	);
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
});

test('an unlocked hidden shipped package can be selected and used to create a game', async ({ browser }) => {
	const host = await newPlayerPage(browser);
	await gotoLobbyHome(host);
	await host.locator('#go-create-btn').click();
	await expect(host.locator('#board-selector option[value="hidden"]')).toHaveCount(0);

	await host.keyboard.press('Control+Shift+Alt+C');
	const unlock = host.locator('.game-dialog.dialog-unlock');
	await unlock.locator('#unlock-code-input').fill('e2e-hidden');
	await unlock.locator('#unlock-code-input').press('Enter');
	await expectAnnouncement(host, /Desbloqueado: Hidden \(prueba E2E\)/);
	await expect(host.locator('#board-selector option[value="hidden"]')).toHaveCount(1);

	// The code is browser state, not one-shot UI state: after a fresh navigation the hidden
	// package must still be listed because the client replays the stored unlock header.
	await gotoLobbyHome(host);
	await host.locator('#go-create-btn').click();
	await expect(host.locator('#board-selector option[value="hidden"]')).toHaveCount(1);

	// Reproduce the original race: stage the hidden package slowly and submit immediately.
	// Create must wait for this POST+i18n chain rather than using the previously staged game.
	await host.route('**/api/packages/shipped/hidden', async route => {
		await new Promise(resolve => setTimeout(resolve, 400));
		await route.continue();
	});
	await host.locator('#board-selector').selectOption('hidden');
	await host.locator('#host-name').fill('Ana');
	await host.locator('#create-button').dispatchEvent('click');

	const notice = host.locator('.game-dialog.dialog-confirm');
	await expect(notice).toBeVisible();
	await expect(notice.locator('.dialog-content')).toContainText('Este juego oculto solo existe');
	await expect(host.locator('#create-form input.token-radio[value="circle"]')).toBeChecked();
	await flushAxeAudit(host);
	await notice.locator('.btn-primary').click();
	await expect(host.locator('#lobby-created')).toBeVisible();
	const inviteCode = (await host.locator('#lobby-code').textContent())!.trim();

	// Joining never requires the unlock code: the invite identifies an already-created game.
	const guest = await newPlayerPage(browser);
	await joinGame(guest, inviteCode, 'Berto');
	await host.locator('#start-game-btn').click();
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
	await page.locator('#copy-code-btn').dispatchEvent('click');
	await expect(page.locator('#copy-code-btn')).toContainText(/Copiado|Copied/);
	await flushAxeAudit(page);
	await page.locator('#copy-link-btn').dispatchEvent('click');
	await expect(page.locator('#copy-link-btn')).toContainText(/Copiado|Copied/);
	await flushAxeAudit(page);

	await page.locator('#waiting-back-btn').dispatchEvent('click');
	await expect(page.locator('#view-home')).toBeVisible();
	const saved = page.locator('#your-games-list .saved-game-item');
	await expect(saved).toHaveCount(1);
	await expect(saved.locator('.saved-game-resume')).toBeVisible();
	await expect(saved.locator('.saved-game-delete')).toBeVisible();

	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await saved.locator('.saved-game-resume').dispatchEvent('click');
	await expect(page.locator('#lobby-created')).toBeVisible();
	await page.locator('#waiting-back-btn').dispatchEvent('click');
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

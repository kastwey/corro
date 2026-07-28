// account.spec.ts — the optional player account control in the lobby.
//
// The server registers a stand-in sign-in provider ONLY under ASPNETCORE_ENVIRONMENT=E2E. It
// replaces the trip to a real provider's consent screen and nothing else: the route, the account
// resolution and the session cookie are all the production ones, so every state the audit sees here
// is the state a real player gets.
//
// The states covered are the ones the accessibility gate needs: signed out, signed in, and the
// failed sign-in notice. The shared fixture runs Axe after each settled mutation.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { appI18n, gotoLobbyHome, newPlayerPage } from '../helpers/game';

const es = appI18n('es').account as Record<string, string> & { provider: Record<string, string> };

/** The sign-in affordance for the E2E stand-in, as a player sees it. */
function signInLinkName(): string {
	return es.signInWith.replace('{{provider}}', es.provider.e2e);
}

test('signed out, the lobby offers a sign-in link that navigates rather than a button', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);

	const bar = page.locator('#account-bar');
	await expect(bar).toBeVisible();
	await expect(bar).toContainText(es.signInPrompt);

	// A LINK, not a button: it leaves the page, and announcing "button" would misdescribe that.
	const link = page.getByRole('link', { name: signInLinkName() });
	await expect(link).toBeVisible();
	await expect(link).toHaveAttribute('href', /\/api\/auth\/signin\/e2e\?returnUrl=/);
	await expect(page.getByRole('button', { name: signInLinkName() })).toHaveCount(0);

	// The provider links read as one named set without adding a landmark to the lobby.
	await expect(page.locator('#account-bar .account-providers')).toHaveAttribute('role', 'group');
});

test('signing in names the player and offers signing out again', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);

	await page.getByRole('link', { name: signInLinkName() }).click();

	// Back on the lobby, now with a session. The status is one flowing sentence.
	const status = page.locator('#account-bar .account-status');
	await expect(status).toHaveText(es.signedInAs.replace('{{name}}', 'E2E e2e-player'));
	await expect(page.getByRole('link', { name: signInLinkName() })).toHaveCount(0);

	// Signing in must not have disturbed the lobby itself.
	await expect(page.locator('#go-create-btn')).toBeVisible();

	const signOut = page.getByRole('button', { name: es.signOut });
	await expect(signOut).toBeVisible();
	await signOut.click();

	await expect(page.locator('#account-bar .account-status')).toHaveCount(0);
	await expect(page.getByRole('link', { name: signInLinkName() })).toBeVisible();
});

test('a session survives a reload', async ({ browser }) => {
	// The whole point of the server-issued cookie: the player stays signed in without the client
	// holding anything itself.
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);
	await page.getByRole('link', { name: signInLinkName() }).click();
	await expect(page.locator('#account-bar .account-status')).toBeVisible();

	await gotoLobbyHome(page);

	await expect(page.locator('#account-bar .account-status'))
		.toHaveText(es.signedInAs.replace('{{name}}', 'E2E e2e-player'));
});

test('two players signing in separately get their own accounts', async ({ browser }) => {
	// Separate contexts are separate browsers, so each holds its own session cookie.
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	await ana.goto('/api/auth/signin/e2e?returnUrl=%2F&subject=ana');
	await berto.goto('/api/auth/signin/e2e?returnUrl=%2F&subject=berto');

	await expect(ana.locator('#account-bar .account-status'))
		.toHaveText(es.signedInAs.replace('{{name}}', 'E2E ana'));
	await expect(berto.locator('#account-bar .account-status'))
		.toHaveText(es.signedInAs.replace('{{name}}', 'E2E berto'));
});

test('a failed sign-in is announced and says playing without an account still works', async ({ browser }) => {
	// The server sends an incomplete sign-in back here rather than to an error page, because the
	// player can still do everything that matters without an account.
	const page = await newPlayerPage(browser);
	await page.goto('/?signInError=1');

	const alert = page.locator('#account-bar .account-error');
	await expect(alert).toBeVisible();
	await expect(alert).toHaveAttribute('role', 'alert');
	await expect(alert).toHaveText(es.signInFailed);

	// Retrying stays available beside the explanation.
	await expect(page.getByRole('link', { name: signInLinkName() })).toBeVisible();

	// Audit this state before the marker is gone from the URL and a reload could drop it.
	await flushAxeAudit(page);

	// The marker is consumed so a later reload cannot replay a stale failure.
	await expect(page).toHaveURL(/\/$|\/\?$/);
	await page.reload();
	await expect(page.locator('#account-bar .account-error')).toHaveCount(0);
});

// ── the account settings dialog ──────────────────────────────────────────────

const settings = appI18n('es').account.settings as Record<string, string>;

/** Signs in and opens the account settings, the starting point for the tests below. */
async function openSettings(page: import('../helpers/test').Page, subject = 'e2e-player') {
	await page.goto(`/api/auth/signin/e2e?returnUrl=%2F&subject=${subject}`);
	await expect(page.locator('#account-bar .account-status')).toBeVisible();
	await page.getByRole('button', { name: appI18n('es').account.manage as string }).click();
	await expect(page.locator('.account-settings')).toBeVisible();
	// The dialog places its own initial focus shortly after opening. Wait for that to settle, so a
	// test that moves focus is not racing it — and so the intended landing spot stays pinned.
	await expect(page.locator('#account-name-input')).toBeFocused();
}

/**
 * Closes the settings dialog. Exact match: "Cerrar" is otherwise a prefix of "Cerrar sesión".
 * Closing hides the dialog rather than emptying it, so visibility — not presence — is what changes.
 */
async function closeSettings(page: import('../helpers/test').Page) {
	await page.getByRole('button', { name: appI18n('es').common.close as string, exact: true }).click();
	await expect(page.locator('.account-settings')).not.toBeVisible();
}

test('the settings show the account, its sign-in methods and how to erase it', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await openSettings(page);

	// The name field starts from the current name and is capped at what the server accepts.
	const name = page.locator('#account-name-input');
	await expect(name).toHaveValue('E2E e2e-player');
	await expect(name).toHaveAttribute('maxlength', '40');

	// The one linked method reads as a single sentence.
	await expect(page.locator('.account-method-line').first())
		.toHaveText(settings.methodLinkedTo
			.replace('{{provider}}', appI18n('es').account.provider.e2e)
			.replace('{{email}}', 'e2e-player@e2e.invalid'));

	await expect(page.locator('#account-delete-btn')).toBeVisible();
});

test('the only sign-in method is refused with a spoken reason, never a disabled attribute', async ({ browser }) => {
	// The project rule: a control that will not act stays focusable and says why, so a
	// screen-reader user can reach it and understand instead of meeting a dead control.
	const page = await newPlayerPage(browser);
	await openSettings(page);

	const unlink = page.locator('button.account-unlink-btn').first();
	await expect(unlink).toHaveAttribute('aria-disabled', 'true');
	await expect(unlink).not.toHaveAttribute('disabled', /.*/);

	// It is genuinely reachable by keyboard: in the tab order and able to hold focus. Playwright's
	// own focus()/click() refuse to drive an aria-disabled control, which is itself confirmation
	// that the state is exposed properly — so focus it the way the browser would.
	expect(await unlink.evaluate((element: HTMLElement) => element.tabIndex)).toBe(0);
	await unlink.evaluate((element: HTMLElement) => element.focus());
	await expect(unlink).toBeFocused();

	const hintId = await unlink.getAttribute('aria-describedby');
	await expect(page.locator(`#${hintId}`)).toHaveText(settings.lastMethodHint);

	// Activating it explains itself rather than doing nothing. Driven from the keyboard because
	// that is the path this control exists for — and because Playwright refuses to click an
	// aria-disabled element, which is itself confirmation that the state is exposed correctly.
	await page.keyboard.press('Enter');
	await expect(page.locator('.account-settings-status')).toHaveText(settings.lastMethodHint);
});

test('renaming the account updates what the lobby says about you', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await openSettings(page);

	await page.locator('#account-name-input').fill('Ana la Roja');
	await page.locator('#account-name-save').click();

	await expect(page.locator('.account-settings-status')).toHaveText(settings.nameSaved);

	// The bar behind the dialog reflects it immediately.
	await closeSettings(page);
	await expect(page.locator('#account-bar .account-status'))
		.toHaveText((appI18n('es').account.signedInAs as string).replace('{{name}}', 'Ana la Roja'));

	// And it survives the next sign-in, where the provider sends its own version of the name.
	await gotoLobbyHome(page);
	await expect(page.locator('#account-bar .account-status'))
		.toHaveText((appI18n('es').account.signedInAs as string).replace('{{name}}', 'Ana la Roja'));
});

test('clearing the name falls back to the localized placeholder', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await openSettings(page);

	await page.locator('#account-name-input').fill('');
	await page.locator('#account-name-save').click();
	await expect(page.locator('.account-settings-status')).toHaveText(settings.nameSaved);

	await closeSettings(page);
	await expect(page.locator('#account-bar .account-status')).toHaveText(appI18n('es').account.signedIn as string);
});

test('erasing asks first, defaults to keeping the account, and then really erases it', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await openSettings(page, 'to-be-erased');

	await page.locator('#account-delete-btn').click();

	// Irreversible, so the safe answer holds focus.
	const cancel = page.locator('#account-delete-cancel');
	await expect(cancel).toBeFocused();
	await expect(page.locator('#account-delete-confirm')).toBeVisible();
	// Audit the confirmation state before it is dismissed.
	await flushAxeAudit(page);

	// Backing out restores the original control.
	await cancel.click();
	await expect(page.locator('#account-delete-confirm')).toHaveCount(0);
	await expect(page.locator('#account-delete-btn')).toBeFocused();

	await page.locator('#account-delete-btn').click();
	await page.locator('#account-delete-confirm').click();

	// The dialog closes and the lobby is back to its signed-out state.
	await expect(page.locator('.account-settings')).not.toBeVisible();
	await expect(page.locator('#account-bar .account-status')).toHaveCount(0);
	await expect(page.getByRole('link', { name: signInLinkName() })).toBeVisible();

	// Erasure is real: signing in with the same login starts a genuinely new account, so the
	// name that was set before is gone.
	await page.goto('/api/auth/signin/e2e?returnUrl=%2F&subject=to-be-erased');
	await expect(page.locator('#account-bar .account-status'))
		.toHaveText((appI18n('es').account.signedInAs as string).replace('{{name}}', 'E2E to-be-erased'));
});

test('the settings and every refusal state are Axe-clean in the dark theme too', async ({ browser }) => {
	// Axe only ever audits the theme actually rendered, so the dark palette needs its own pass —
	// the refused control in particular, whose state must not be carried by dimming alone.
	const page = await newPlayerPage(browser);
	await page.goto('/api/auth/signin/e2e?returnUrl=%2F&subject=dark-theme');
	await expect(page.locator('#account-bar .account-status')).toBeVisible();

	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

	await page.getByRole('button', { name: appI18n('es').account.manage as string }).click();
	await expect(page.locator('.account-settings')).toBeVisible();
	await expect(page.locator('#account-name-input')).toBeFocused();

	// The refused control keeps a readable foreground in this palette, not just a faded one.
	await expect(page.locator('button.account-unlink-btn').first()).toHaveAttribute('aria-disabled', 'true');
	await flushAxeAudit(page);

	// The erase confirmation is its own colour scheme; audit it before it is dismissed.
	await page.locator('#account-delete-btn').click();
	await expect(page.locator('#account-delete-confirm')).toBeVisible();
	await flushAxeAudit(page);
	await page.locator('#account-delete-cancel').click();

	// And a status message, which lands on the dialog's own surface.
	await page.locator('#account-name-input').fill('Ana en oscuro');
	await page.locator('#account-name-save').click();
	await expect(page.locator('.account-settings-status')).toHaveText(settings.nameSaved);
	await flushAxeAudit(page);
});

test('a login another account owns cannot be linked away from it', async ({ browser }) => {
	// The takeover the whole design prevents, approached from the linking side.
	const berto = await newPlayerPage(browser);
	await berto.goto('/api/auth/signin/e2e?returnUrl=%2F&subject=berto');
	await expect(berto.locator('#account-bar .account-status')).toBeVisible();

	const ana = await newPlayerPage(browser);
	await openSettings(ana, 'ana');

	// Ana tries to add the login Berto already holds. The E2E provider takes the subject
	// directly, standing in for Berto consenting at a real provider's screen.
	await ana.goto('/api/auth/link/e2e?returnUrl=%2F&subject=berto');

	// She lands back on the lobby with the settings reopened, explaining the refusal.
	await expect(ana.locator('.account-settings')).toBeVisible();
	await expect(ana.locator('.account-settings-status')).toHaveText(
		settings.linkClaimed.replace('{{provider}}', appI18n('es').account.provider.e2e));

	// Berto still holds his own account.
	await gotoLobbyHome(berto);
	await expect(berto.locator('#account-bar .account-status'))
		.toHaveText((appI18n('es').account.signedInAs as string).replace('{{name}}', 'E2E berto'));
});

test('the link markers are consumed so a reload cannot replay a stale outcome', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await openSettings(page, 'marker-test');
	await page.goto('/api/auth/link/e2e?returnUrl=%2F&subject=marker-test');

	await expect(page.locator('.account-settings-status')).toHaveText(
		settings.linkAlready.replace('{{provider}}', appI18n('es').account.provider.e2e));
	await expect(page).toHaveURL(/\/$|\/\?$/);

	await gotoLobbyHome(page);
	await expect(page.locator('.account-settings')).toHaveCount(0);
});

test('creating a game still works without signing in', async ({ browser }) => {
	// The rule the whole feature rests on: accounts are additive and never a precondition.
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);

	await expect(page.locator('#account-bar .account-status')).toHaveCount(0);
	await page.locator('#go-create-btn').click();

	await expect(page.locator('#create-form')).toBeVisible();
	await expect(page.locator('#host-name')).toBeEditable();
});

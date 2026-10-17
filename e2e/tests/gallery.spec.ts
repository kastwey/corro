// gallery.spec.ts — the component gallery: every reusable widget alone, every state through Axe.
//
// gallery.html mounts ONE widget from plain data (frontend/src/gallery/). This spec walks each
// story the way a keyboard user would and flushes the Axe monitor at every state it reaches — the
// open menu, the submenu, the refused action, the filtered list, the modal — so a contrast or ARIA
// regression in a shared widget is caught here, in isolation, rather than wherever a game flow
// happens to pass through it. The screen-reader suite (screen-reader/) drives NVDA over the same
// pages; this is the half that runs on every PR.

import { test, expect, type Page } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { newPlayerPage } from '../helpers/game';

const STORIES = ['popup-menu', 'tabs', 'combobox', 'toolbar', 'list-with-actions', 'checkbox-list', 'dialog'];

async function openStory(page: Page, id: string): Promise<void> {
	await page.goto(`/gallery.html?story=${id}`);
	await expect(page.locator('#story-title')).not.toBeEmpty();
	await expect(page.locator('#story-host > *').first()).toBeVisible();
}

/** The gallery's announcement log: what the widget would have said through the game's announcer. */
function log(page: Page) {
	return page.locator('#gallery-log-entries li');
}

test('the index lists every story and each one mounts Axe-clean in both themes', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await page.goto('/gallery.html');
	await expect(page.locator('main')).toHaveCount(1);
	await expect(page.locator('h1')).toHaveText('Component gallery');
	const links = page.locator('#gallery-stories a');
	await expect(links).toHaveCount(STORIES.length);
	await expect(page.locator('#gallery-story')).toBeHidden();
	await flushAxeAudit(page);

	for (const id of STORIES) {
		await page.locator(`#gallery-stories a[href$="story=${id}"]`).click();
		await expect(page.locator(`#gallery-stories a[href$="story=${id}"]`)).toHaveAttribute('aria-current', 'page');
		await expect(page.locator('#story-host > *').first()).toBeVisible();
		await flushAxeAudit(page);
	}

	// The other theme, on a story with the most kinds of control in it.
	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await flushAxeAudit(page);
	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await flushAxeAudit(page);
});

test('popup menu: open, submenu, refused entry, radio choice, Escape back to the opener', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'popup-menu');

	const opener = page.locator('#story-menu-opener');
	await expect(opener).toHaveAttribute('aria-expanded', 'false');
	await opener.focus();
	await page.keyboard.press('Enter');

	const menu = page.locator('[role="menu"]');
	await expect(menu).toHaveAttribute('aria-label', 'Square actions');
	await expect(opener).toHaveAttribute('aria-expanded', 'true');
	await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
	// Hosted inside the landmark, not as orphan content under <body>.
	await expect(page.locator('main [role="menu"]')).toHaveCount(1);
	await flushAxeAudit(page);

	// Down to the refused entry: it is focusable, aria-disabled, and speaks its reason.
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	const refused = menu.locator('[role="menuitem"]', { hasText: 'Build a house' });
	await expect(refused).toBeFocused();
	await expect(refused).toHaveAttribute('aria-disabled', 'true');
	await expect(refused).toHaveAccessibleDescription('You need to own every square of the group first.');
	await page.keyboard.press('Enter');
	await expect(menu).toBeVisible();
	await expect(log(page).last()).toHaveText('You need to own every square of the group first.');
	await flushAxeAudit(page);

	// Up to the submenu entry; Right opens it in place as a radio set.
	await page.keyboard.press('ArrowUp');
	await expect(menu.locator('[aria-haspopup="menu"]')).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(menu).toHaveAttribute('aria-label', 'Sort by');
	const radios = menu.locator('[role="menuitemradio"]');
	await expect(radios).toHaveCount(2);
	await expect(radios.first()).toBeFocused();
	await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
	await flushAxeAudit(page);

	// Left returns to the parent menu, on the entry that opened the submenu.
	await page.keyboard.press('ArrowLeft');
	await expect(menu).toHaveAttribute('aria-label', 'Square actions');
	await expect(menu.locator('[aria-haspopup="menu"]')).toBeFocused();

	// Escape closes and returns focus to the opener, which is collapsed again.
	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(opener).toBeFocused();
	await expect(opener).toHaveAttribute('aria-expanded', 'false');

	// Typeahead: a unique first letter activates outright.
	await page.keyboard.press('Enter');
	await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
	await page.keyboard.press('m');
	await expect(menu).toHaveCount(0);
	await expect(log(page).last()).toHaveText('Mortgage chosen.');
	await flushAxeAudit(page);
});

test('tabs: one tab stop, arrows select and reveal, Tab goes into the panel', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'tabs');

	const tabs = page.locator('[role="tab"]');
	const panels = page.locator('[role="tabpanel"]');
	await expect(tabs).toHaveCount(3);
	await expect(panels.nth(0)).toBeVisible();
	await expect(panels.nth(1)).toBeHidden();

	await tabs.first().focus();
	await page.keyboard.press('ArrowRight');
	await expect(tabs.nth(1)).toBeFocused();
	await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
	await expect(panels.nth(0)).toBeHidden();
	await expect(panels.nth(1)).toBeVisible();
	await expect(log(page).last()).toHaveText('Showing Lobby notices.');
	await flushAxeAudit(page);

	await page.keyboard.press('End');
	await expect(tabs.nth(2)).toBeFocused();
	await expect(panels.nth(2)).toBeVisible();
	await page.keyboard.press('Tab');
	await expect(panels.nth(2)).toBeFocused();
	await flushAxeAudit(page);
});

test('combobox: typing filters, the count is spoken late, Down enters the list, Enter chooses', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'combobox');

	const input = page.locator('[role="combobox"]');
	const options = page.locator('[role="option"]');
	await expect(options).toHaveCount(12);
	await expect(page.locator('#story-combo-results')).toHaveText('12 games match.');

	await input.focus();
	await page.keyboard.type('harb');
	await expect(options).toHaveCount(1);
	await expect(options.first()).toHaveText('Harbour Lights');
	await expect(page.locator('#story-combo-results')).toHaveText('1 game matches.');
	// The live copy waits for the typing to stop, then says the same thing.
	await expect(page.locator('#story-combo-live')).toHaveText('1 game matches.');
	await flushAxeAudit(page);

	await page.keyboard.press('ArrowDown');
	await expect(options.first()).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(input).toBeFocused();
	await expect(input).toHaveValue('Harbour Lights');
	// Choosing clears the SEARCH, so the whole catalogue is on offer again, with the choice marked.
	await expect(options).toHaveCount(12);
	await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveText('Harbour Lights');
	await expect(log(page).last()).toHaveText('Harbour Lights chosen.');
	await flushAxeAudit(page);

	await page.keyboard.type('zzz');
	await expect(options).toHaveCount(0);
	await expect(input).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('#story-combo-results')).toHaveText('No games match.');
	await flushAxeAudit(page);
});

test('toolbar: one tab stop, arrows wrap, the refused action speaks instead of acting', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'toolbar');

	const toolbar = page.locator('#story-toolbar');
	await expect(toolbar).toHaveAttribute('role', 'toolbar');
	const buttons = toolbar.locator('button');
	await expect(buttons).toHaveCount(4);
	await buttons.first().focus();
	await page.keyboard.press('ArrowRight');
	await expect(buttons.nth(1)).toBeFocused();
	await expect(buttons.nth(1)).toHaveAttribute('aria-disabled', 'true');
	await expect(buttons.nth(1)).toHaveAccessibleDescription('You are not standing on a square for sale.');
	await page.keyboard.press('Enter');
	await expect(log(page).last()).toHaveText('You are not standing on a square for sale.');
	await flushAxeAudit(page);

	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await expect(buttons.last()).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(log(page).last()).toHaveText('Turn ended.');
	await flushAxeAudit(page);
});

test('list with row actions: rows, row toolbar, and the Shift+F10 menu with its sort submenu', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'list-with-actions');

	const rows = page.locator('.gallery-list__row');
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(1)).toHaveAccessibleName('Carmen, 900 credits, muted.');
	await rows.first().focus();
	await page.keyboard.press('ArrowDown');
	await expect(rows.nth(1)).toBeFocused();

	// Right enters the row's toolbar; the toggle reads pressed; Escape comes back.
	await page.keyboard.press('ArrowRight');
	const muteButton = rows.nth(1).locator('button', { hasText: 'Mute' });
	await expect(rows.nth(1).locator('button').first()).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(muteButton).toBeFocused();
	await expect(muteButton).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Escape');
	await expect(rows.nth(1)).toBeFocused();
	await flushAxeAudit(page);

	// Shift+F10 mirrors those actions into a menu, hosted in the landmark; the toggle is a check
	// item, and the list's sort buttons collapse into one submenu read as radios.
	await page.keyboard.press('Shift+F10');
	const menu = page.locator('main [role="menu"]');
	await expect(menu).toHaveAttribute('aria-label', 'Player actions');
	await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
	await expect(menu.locator('[role="menuitemcheckbox"]')).toHaveAttribute('aria-checked', 'true');
	await flushAxeAudit(page);

	await page.keyboard.press('End');
	await expect(menu.locator('[aria-haspopup="menu"]')).toBeFocused();
	await page.keyboard.press('ArrowRight');
	const radios = menu.locator('[role="menuitemradio"]');
	await expect(radios).toHaveCount(2);
	await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
	await flushAxeAudit(page);

	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	await expect(menu).toHaveCount(0);
	await expect(rows.nth(1)).toBeFocused();
	await expect(log(page).last()).toHaveText('Sort by cash.');
	await expect(page.locator('#story-list-actions button').nth(1)).toHaveAttribute('aria-pressed', 'true');
	await flushAxeAudit(page);
});

test('checkbox list: one tab stop, arrows move, Space toggles natively', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'checkbox-list');

	const boxes = page.locator('#story-rules input[type="checkbox"]');
	await expect(boxes).toHaveCount(4);
	await boxes.first().focus();
	await page.keyboard.press('ArrowDown');
	await expect(boxes.nth(1)).toBeFocused();
	await expect(boxes.nth(1)).not.toBeChecked();
	await page.keyboard.press('Space');
	await expect(boxes.nth(1)).toBeChecked();
	await expect(log(page).last()).toHaveText('Fines go to a pot won on Free Parking: on.');
	await flushAxeAudit(page);

	await page.keyboard.press('End');
	await expect(boxes.last()).toBeFocused();
	await page.keyboard.press('Home');
	await expect(boxes.first()).toBeFocused();
});

test('dialogs: a native modal question with arrow-walked answers, and a reading dialog', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'dialog');

	const dialog = page.locator('dialog#game-dialog');
	await page.locator('#story-dialog-confirm').click();
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute('open', '');
	await expect(dialog).toHaveAccessibleName('Discard Night Train?');
	await expect(dialog.locator('.dialog-buttons')).toHaveAttribute('role', 'application');
	// The expected answer takes the initial focus; the arrows walk the answers.
	const confirm = dialog.locator('button', { hasText: 'Confirm' });
	const cancel = dialog.locator('button', { hasText: 'Cancel' });
	await expect(confirm).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(cancel).toBeFocused();
	await flushAxeAudit(page);

	// Answering closes the dialog and returns focus to the opener.
	await page.keyboard.press('Enter');
	await expect(dialog).toBeHidden();
	await expect(page.locator('#story-dialog-confirm')).toBeFocused();
	await expect(log(page).last()).toHaveText('Kept the card.');

	// Escape dismisses it silently: no answer was given, so nothing is announced.
	await page.keyboard.press('Enter');
	await expect(dialog).toBeVisible();
	await expect(confirm).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(page.locator('#story-dialog-confirm')).toBeFocused();
	await expect(log(page)).toHaveCount(1);

	// The reading dialog: no application role, focus on the title, the content reads as a document.
	await page.locator('#story-dialog-guide').click();
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAccessibleName('How to play');
	await expect(dialog.locator('.dialog-buttons')).not.toHaveAttribute('role', 'application');
	await expect(dialog.locator('.dialog-title')).toBeFocused();
	await expect(dialog.locator('.dialog-content h3')).toHaveText('Rent');
	await flushAxeAudit(page);

	await dialog.locator('button', { hasText: 'Close' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('#story-dialog-guide')).toBeFocused();
	await flushAxeAudit(page);
});

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

const STORIES = ['popup-menu', 'tabs', 'combobox', 'toolbar', 'list-with-actions', 'checkbox-list', 'dialog', 'hand', 'chat', 'trade'];

async function openStory(page: Page, id: string): Promise<void> {
	await page.goto(`/gallery.html?story=${id}`);
	await expect(page.locator('#story-title')).not.toBeEmpty();
	await expect(page.locator('#story-host > *').first()).toBeVisible();
}

/** The gallery's announcement log: what the widget would have said through the game's announcer. */
function log(page: Page) {
	return page.locator('#gallery-log-entries p');
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
	// Selection is not announced: the focused tab's own report is the voice, as in the lobby.
	await expect(log(page)).toHaveCount(0);
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

test('card hand: rows read as one line, play, the refused card offers a discard, help, menu, draw', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'hand');

	const rows = page.locator('.hand-card');
	await expect(rows).toHaveCount(5);
	await expect(page.locator('.hand-panel__list')).toHaveAccessibleName('Your hand');
	await rows.first().focus();
	await expect(rows.first()).toHaveAccessibleName('Move 75');
	await page.keyboard.press('ArrowDown');
	await expect(rows.nth(1)).toBeFocused();
	await expect(rows.nth(1)).toHaveAccessibleName('Move 25');

	// Right enters the row's own toolbar; Escape comes back to the card.
	await page.keyboard.press('ArrowRight');
	await expect(rows.nth(1).locator('.hand-card__actions button').first()).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(rows.nth(1)).toBeFocused();
	await flushAxeAudit(page);

	// An unplayable card says so in its line; Enter reads the reason and offers the discard.
	const flat = page.locator('.hand-card', { hasText: 'Flat tyre' });
	await expect(flat).toHaveAccessibleName('Flat tyre. not playable');
	await flat.focus();
	await page.keyboard.press('Enter');
	const dialog = page.locator('dialog#game-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.locator('.dialog-content')).toHaveText('No rival is on the road. Discard Flat tyre?');
	await expect(dialog.locator('button', { hasText: 'Discard' })).toBeFocused();
	await flushAxeAudit(page);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(flat).toBeFocused();

	// Shift+F1 reads the card's help as a document; Shift+F10 opens the hand's menu.
	await rows.first().focus();
	await page.keyboard.press('Shift+F1');
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAccessibleName('Move 75');
	await expect(dialog.locator('.dialog-content')).toContainText('Advance seventy-five');
	await flushAxeAudit(page);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(rows.first()).toBeFocused();
	await page.keyboard.press('Shift+F10');
	const menu = page.locator('.hand-context-menu[role="menu"]');
	await expect(menu).toBeVisible();
	await expect(menu.locator('[role="menuitem"]', { hasText: 'Play' })).toBeFocused();
	await expect(menu.locator('[aria-haspopup="menu"]').first()).toBeVisible();
	await flushAxeAudit(page);
	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(rows.first()).toBeFocused();
	// The same menu in the dark theme: it used to wear hard-coded light colours whatever the theme.
	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await rows.first().focus();
	await page.keyboard.press('Shift+F10');
	await expect(menu.locator('[role="menuitem"]', { hasText: 'Play' })).toBeFocused();
	await flushAxeAudit(page);
	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await rows.first().focus();

	// Enter plays, Space draws, Delete discards after the confirmation.
	await page.keyboard.press('Enter');
	await expect(log(page).last()).toHaveText('You played Move 75.');
	await expect(rows).toHaveCount(4);
	await page.keyboard.press('Space');
	await expect(log(page).last()).toHaveText('You drew Move 100.');
	await expect(rows).toHaveCount(5);
	await flushAxeAudit(page);
	await page.locator('.hand-card', { hasText: 'Green light' }).focus();
	await page.keyboard.press('Delete');
	await expect(dialog.locator('.dialog-content')).toHaveText('Discard Green light?');
	// The player asked to discard, so the answer takes the focus (a moment after opening).
	await expect(dialog.locator('button', { hasText: 'Discard' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(dialog).toBeHidden();
	await expect(log(page).last()).toHaveText('You discarded Green light.');
	await expect(rows).toHaveCount(4);
	await flushAxeAudit(page);
});

test('text chat: the panel, the mention list, sending, and a message arriving while closed', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'chat');

	const toggle = page.locator('#chat-toggle');
	const panel = page.locator('#chat-panel');
	// The panel's state travels in the label, which says what a press will do; no aria-expanded.
	await expect(toggle).toHaveAccessibleName('Open text chat');
	await expect(toggle).not.toHaveAttribute('aria-expanded', /.*/);
	await toggle.click();
	await expect(panel).toBeVisible();
	await expect(toggle).toHaveAccessibleName('Close text chat');
	// First contact lands on the unencrypted-messages notice, a focusable stop.
	await expect(page.locator('#chat-disclaimer-text')).toBeFocused();
	await expect(page.locator('#chat-messages li')).toHaveCount(2);
	await flushAxeAudit(page);
	await page.locator('#chat-disclaimer-dismiss').click();
	const input = page.locator('#chat-input');
	await expect(input).toBeFocused();

	// "@C" opens the players listbox on its one match and moves focus into it; Enter completes.
	await page.keyboard.type('@C');
	const options = page.locator('#chat-mention-list [role="option"]');
	await expect(options).toHaveCount(1);
	await expect(options.first()).toHaveText('Carmen');
	await expect(options.first()).toBeFocused();
	await flushAxeAudit(page);
	await page.keyboard.press('Enter');
	await expect(input).toBeFocused();
	await expect(input).toHaveValue(/^@Carmen /);
	await page.keyboard.type('shall we trade?');
	await page.keyboard.press('Enter');
	await expect(page.locator('#chat-messages li')).toHaveCount(3);
	await expect(page.locator('#chat-messages li').last()).toContainText('shall we trade?');
	await expect(input).toHaveValue('');
	await flushAxeAudit(page);

	// The toggle closes the panel (on the board, Escape only parks focus on the board and leaves
	// it open) and focus returns to the toggle; a message arriving while closed shows the badge.
	await toggle.click();
	await expect(panel).toBeHidden();
	await expect(toggle).toHaveAccessibleName('Open text chat');
	await expect(toggle).toBeFocused();
	await page.locator('#story-chat-receive').click();
	await expect(page.locator('#chat-notification')).toBeVisible();
	await expect(toggle).toHaveAccessibleName(/unread messages: 1/);
	await flushAxeAudit(page);
	await page.locator('#chat-notification').click();
	await expect(panel).toBeVisible();
	await expect(page.locator('#chat-messages li').last()).toContainText('Anyone trading the harbour?');
	await expect(page.locator('#chat-notification')).toBeHidden();
	await flushAxeAudit(page);
});

test('trade: the modal builder with its spoken validation, and the non-modal review', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await openStory(page, 'trade');

	await page.locator('#story-trade-propose').click();
	const dialog = page.locator('dialog#trade-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute('data-modal', 'true');
	await expect(dialog).toHaveAccessibleName('Propose a trade');
	const target = dialog.locator('#trade-target');
	await expect(target).toHaveValue('p2');
	await flushAxeAudit(page);

	// Ana's three squares are checkboxes in one roving group; the valuation follows the choice.
	const give = dialog.locator('.trade-give-props input.trade-prop-check');
	await expect(give).toHaveCount(3);
	await give.first().focus();
	await page.keyboard.press('Space');
	await expect(give.first()).toBeChecked();
	await expect(dialog.locator('.trade-valuation')).toContainText('You give 60');

	// Too much cash is refused with a spoken reason, on the field, while typing.
	const money = dialog.locator('#trade-give-money');
	await money.fill('2000');
	await expect(dialog.locator('#trade-give-money-error')).toBeVisible();
	await expect(dialog.locator('#trade-give-money-error')).toContainText('You only have');
	await flushAxeAudit(page);
	await money.fill('100');
	await expect(dialog.locator('#trade-give-money-error')).toBeHidden();
	await dialog.locator('.trade-propose-btn').click();
	await expect(dialog).toBeHidden();
	await expect(log(page).last()).toHaveText('Offer sent to Berto: you give Harbour Road, 100 in cash for nothing.');
	await expect(page.locator('#story-trade-propose')).toBeFocused();
	await flushAxeAudit(page);

	// The partner's side: a non-modal review that reads the offer and asks for an answer.
	await page.locator('#story-trade-review').click();
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute('data-modal', 'false');
	await expect(dialog).toHaveAccessibleName('Trade offer from Berto');
	await expect(dialog).toContainText('Orchard Street');
	await expect(dialog).toContainText('North Station');
	await flushAxeAudit(page);
	await dialog.locator('.trade-accept-btn').click();
	await expect(dialog).toBeHidden();
	await expect(log(page).last()).toHaveText('You accepted the trade with Berto.');
	await flushAxeAudit(page);
});

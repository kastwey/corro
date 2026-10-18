// gallery-nvda.spec.ts — what NVDA says about each widget of the component gallery.
//
// Each test opens one story of gallery.html, puts the keyboard where a player would and listens.
// The assertions are about FACTS being spoken — an entry counted inside a menu, a submenu called a
// submenu, a refused action called unavailable and its reason read, a tab called selected, the
// result count of a search spoken once the typing stops — never about the exact sentence, which
// belongs to NVDA (see helpers/speech.ts). A fact that stops being spoken is a regression: in the
// widget, in Chromium's accessibility tree, or in NVDA itself, and this is the only layer that
// notices the last two.
//
// NVDA is started with its default settings by Guidepup, which installs a portable NVDA of its own
// and reads its speech over the same remote protocol the NVDA Remote add-on speaks. The browser is
// Playwright's Chromium, headed, as the config requires.

import { nvdaTest as test, type NVDAPlaywright } from '@guidepup/playwright';
import { expect, type Page } from '@playwright/test';
import { attachSpeech, heard, NVDA } from '../helpers/speech';
import { bringWindowToFront } from '../helpers/windowFocus';

// Every phrase until a second of silence, not just the first (helpers/speech.ts says why).
test.use({ nvdaStartOptions: { capture: true } });

/** Open one story, hand the page to NVDA, and move the reader onto the first control of the story. */
async function openStory(page: Page, nvda: NVDAPlaywright, id: string, firstControl: string): Promise<void> {
	await page.goto(`/gallery.html?story=${id}`, { waitUntil: 'load' });
	await page.locator('#story-host > *').first().waitFor();
	// The browser window above every other application FIRST (helpers/windowFocus.ts): Guidepup
	// only looks through the next ten windows, and a developer's desktop has more than that.
	await page.bringToFront();
	await bringWindowToFront(await page.title());
	await nvda.navigateToWebContent();
	// DOM focus on the first control of the story. Moving focus from the page is how a player's
	// Tab lands there too; NVDA reports the newly focused control, and from here on the test
	// presses keys through NVDA so that the screen reader, not Playwright, owns the keyboard.
	await page.locator(firstControl).first().focus();
	await nvda.clearSpokenPhraseLog();
	// Re-report the focused control so the log starts with what a player hears on arrival.
	await nvda.perform(nvda.keyboardCommands.reportCurrentFocus);
}

test.describe('component gallery with NVDA', () => {
	test.afterEach(async ({ nvda }, testInfo) => {
		await attachSpeech(nvda, testInfo, 'nvda-spoken-phrases');
	});

	test('popup menu: a menu, its submenu, a refused entry with its reason, and the way back', async ({ page, nvda }) => {
		await openStory(page, nvda, 'popup-menu', '#story-menu-opener');
		expect(await heard(nvda), 'the opener is a button').toMatch(NVDA.button);
		expect(await heard(nvda)).toContain('open menu');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		const opened = await heard(nvda);
		expect(opened).toContain('rename');
		expect(opened, 'the entry is counted inside a menu').toMatch(NVDA.position(1, 4));

		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowDown');
		const onSubmenuEntry = await heard(nvda);
		expect(onSubmenuEntry).toContain('sort by');
		expect(onSubmenuEntry, 'an entry that opens a submenu says so').toMatch(NVDA.submenu);

		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowDown');
		const onRefused = await heard(nvda);
		expect(onRefused).toContain('build a house');
		expect(onRefused, 'a refused entry is unavailable, never gone').toMatch(NVDA.unavailable);
		expect(onRefused, 'the described-by reason is read with the entry').toContain('own every square');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		expect(await heard(nvda), 'activating the refused entry speaks its reason through the live log')
			.toContain('own every square of the group first');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowUp');
		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowRight');
		const inSubmenu = await heard(nvda);
		expect(inSubmenu).toContain('name');
		expect(inSubmenu, 'the submenu is a set with one option checked').toMatch(NVDA.checked);
		expect(inSubmenu).toMatch(NVDA.position(1, 2));

		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowDown');
		const onPrice = await heard(nvda);
		expect(onPrice).toContain('price');
		expect(onPrice).toMatch(NVDA.notChecked);

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Escape');
		await nvda.press('Escape');
		const back = await heard(nvda);
		expect(back, 'Escape twice returns to the opener').toContain('open menu');
		expect(back).toMatch(NVDA.button);
	});

	test('tabs: the strip is a tab list and the arrows select', async ({ page, nvda }) => {
		await openStory(page, nvda, 'tabs', '#story-tab-profile');
		const arrival = await heard(nvda);
		expect(arrival).toContain('profile');
		expect(arrival).toMatch(NVDA.tab);
		expect(arrival, 'the current tab is selected').toMatch(NVDA.selected);

		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowRight');
		const next = await heard(nvda);
		expect(next).toContain('lobby notices');
		expect(next, 'the arrow both moves and selects').toMatch(NVDA.selected);
	});

	test('combobox: a combo box whose result count is spoken once the typing stops', async ({ page, nvda }) => {
		await openStory(page, nvda, 'combobox', '#story-combo-input');
		expect(await heard(nvda)).toMatch(NVDA.comboBox);

		await nvda.clearSpokenPhraseLog();
		await nvda.type('harb');
		// The live count waits half a second for the typing to pause, then NVDA reads it — inside
		// the capture window of the typing, which closes only after a second of silence.
		expect(await heard(nvda), 'the result count is spoken after the typing pauses').toContain('1 game matches');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowDown');
		expect(await heard(nvda), 'Down moves into the list onto the one match').toContain('harbour lights');
	});

	test('toolbar: a tool bar whose refused action is unavailable and explains itself', async ({ page, nvda }) => {
		// A container's role is spoken when focus ENTERS it, and NVDA's "report current focus"
		// describes the object alone ("Roll the dice, button, R"). So the story is opened on the
		// control just before the toolbar — the LAST link of the story index, since the index comes
		// before the mounted story and nothing between them is focusable — and the toolbar is
		// reached the way a player reaches it: with a Tab that NVDA sends. (The current story's
		// link is not the last one: Tab from it only reached the next link.)
		await openStory(page, nvda, 'toolbar', '#gallery-stories li:last-child a');
		await nvda.clearSpokenPhraseLog();
		await nvda.press('Tab');
		const arrival = await heard(nvda);
		expect(arrival, 'entering says tool bar, which is what makes the arrows mean something').toMatch(NVDA.toolbar);
		expect(arrival).toContain('roll the dice');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowRight');
		const onBuy = await heard(nvda);
		expect(onBuy).toContain('buy');
		expect(onBuy).toMatch(NVDA.unavailable);
		expect(onBuy).toContain('not standing on a square for sale');
	});

	test('dialogs: a modal question is a dialog with its title, the guide reads as a document', async ({ page, nvda }) => {
		await openStory(page, nvda, 'dialog', '#story-dialog-confirm');
		expect(await heard(nvda)).toContain('discard a card');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		const opened = await heard(nvda);
		expect(opened, 'a native <dialog> is announced as a dialog').toMatch(NVDA.dialog);
		expect(opened, 'the title names the dialog').toContain('discard night train');
		expect(opened, 'the described-by message is read on entry').toContain('discard pile');
		expect(opened, 'focus lands on the expected answer').toContain('confirm');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowLeft');
		expect(await heard(nvda), 'the arrows walk the answers inside the application region').toContain('cancel');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Escape');
		expect(await heard(nvda), 'Escape returns to the opener').toContain('discard a card');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Tab');
		expect(await heard(nvda)).toContain('open the guide');
		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		const guide = await heard(nvda);
		expect(guide).toMatch(NVDA.dialog);
		expect(guide, 'the reading dialog opens on its title').toContain('how to play');

		// In a document, Down reads the next line: NVDA is in browse mode, not stuck in focus mode.
		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowDown');
		await nvda.press('ArrowDown');
		expect(await heard(nvda), 'browse mode walks the guide text').toContain('move your token');
	});
	test('card hand: every row reads as one line, a refused card offers its discard, play and draw are heard', async ({ page, nvda }) => {
		await openStory(page, nvda, 'hand', '.hand-card');
		const arrival = await heard(nvda);
		expect(arrival).toContain('move 75');
		expect(arrival, 'the card is counted inside the hand').toMatch(NVDA.position(1, 5));

		await nvda.clearSpokenPhraseLog();
		await nvda.press('ArrowDown');
		await nvda.press('ArrowDown');
		const onRefused = await heard(nvda);
		expect(onRefused).toContain('flat tyre');
		expect(onRefused, 'an unplayable card says so in its own line').toContain('not playable');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		const offer = await heard(nvda);
		expect(offer, 'the refusal and the offer to discard come as one dialog').toMatch(NVDA.dialog);
		expect(offer).toContain('no rival is on the road');
		expect(offer).toContain('discard flat tyre');
		expect(offer, 'focus lands on the answer the player asked for').toContain('discard');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Escape');
		expect(await heard(nvda), 'Escape returns to the card').toContain('flat tyre');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Home');
		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		expect(await heard(nvda), 'playing is announced').toContain('you played move 75');

		await nvda.clearSpokenPhraseLog();
		await nvda.press(' ');
		expect(await heard(nvda), 'drawing is announced').toContain('you drew move 100');
	});

	test('text chat: the toggle, the players listbox on "@", a sent line and an arriving one', async ({ page, nvda }) => {
		// The first-contact notice is a focusable stop of its own; it is not what this scenario
		// listens for, so it is marked as already read.
		await page.addInitScript(() => { try { localStorage.setItem('corro.chatDisclaimerDismissed', '1'); } catch { /* session only */ } });
		await openStory(page, nvda, 'chat', '#chat-toggle');
		const arrival = await heard(nvda);
		expect(arrival).toContain('open text chat');
		expect(arrival).toMatch(NVDA.button);

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		expect(await heard(nvda), 'opening lands in the message field').toContain('message');

		await nvda.clearSpokenPhraseLog();
		await nvda.type('@c');
		const list = await heard(nvda);
		expect(list, 'the players list opens on the one match and takes focus').toContain('carmen');
		expect(list).toMatch(NVDA.position(1, 1));

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		await nvda.type(' hello');
		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		expect(await heard(nvda), 'the sent line is spoken from the log').toContain('hello');

		// The toggle closes the panel (on the board, Escape only parks focus on the board).
		await page.locator('#chat-toggle').click();
		await page.locator('#story-chat-receive').focus();
		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		const incoming = await heard(nvda);
		expect(incoming, 'a message arriving while the panel is closed is spoken').toContain('anyone trading the harbour');
	});

	test('trade: the builder is a dialog with a partner combo box and spoken property checkboxes', async ({ page, nvda }) => {
		await openStory(page, nvda, 'trade', '#story-trade-propose');
		expect(await heard(nvda)).toContain('propose a trade');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Enter');
		const opened = await heard(nvda);
		expect(opened, 'the builder is a native dialog').toMatch(NVDA.dialog);
		expect(opened).toContain('propose a trade');
		expect(opened, 'focus lands on the partner choice').toMatch(NVDA.comboBox);
		expect(opened).toContain('berto');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Tab');
		const onProperty = await heard(nvda);
		expect(onProperty).toContain('harbour road');
		expect(onProperty, 'a property is a checkbox').toMatch(/check ?box/);
		expect(onProperty).toMatch(NVDA.notChecked);

		await nvda.clearSpokenPhraseLog();
		await nvda.press(' ');
		const ticked = await heard(nvda);
		expect(ticked).toMatch(NVDA.checked);
		expect(ticked, 'the valuation line follows the choice, as a live status').toContain('you give 60');

		await nvda.clearSpokenPhraseLog();
		await nvda.press('Escape');
		expect(await heard(nvda), 'Escape returns to the opener').toContain('propose a trade');
	});
});

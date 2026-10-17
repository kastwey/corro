// gallery-nvda.spec.ts — what NVDA says about each widget of the component gallery.
//
// Each test opens one story of gallery.html, puts the keyboard where a player would and listens.
// The assertions are about FACTS being spoken — a menu called a menu, a submenu called a submenu,
// a refused action called unavailable and its reason read, a tab called selected, the result
// count of a search spoken once the typing stops — never about the exact sentence, which belongs
// to NVDA (see helpers/speech.ts). A fact that stops being spoken is a regression: in the widget,
// in Chromium's accessibility tree, or in NVDA itself, and this is the only layer that notices
// the last two.
//
// NVDA is started with its default settings by Guidepup, which installs a portable NVDA of its own
// and reads its speech over the same remote protocol the NVDA Remote add-on speaks. The browser is
// Playwright's Chromium, headed, as the config requires.

import { nvdaTest as test } from '@guidepup/playwright';
import { expect } from '@playwright/test';
import { attachSpeech, heard, NVDA, pressAndSettle } from '../helpers/speech';

/** Open one story, hand the page to NVDA, and move the reader onto the first control of the story. */
async function openStory(page: import('@playwright/test').Page, nvda: import('@guidepup/playwright').NVDAPlaywright, id: string, firstControl: string) {
	await page.goto(`/gallery.html?story=${id}`, { waitUntil: 'load' });
	await page.locator('#story-host > *').first().waitFor();
	await nvda.navigateToWebContent();
	// DOM focus on the first control of the story. Moving focus from the page is how a player's
	// Tab lands there too; NVDA reports the newly focused control, and from here on the test
	// presses keys through NVDA so that the screen reader, not Playwright, owns the keyboard.
	await page.locator(firstControl).focus();
	await nvda.clearSpokenPhraseLog();
	// Re-report the focused control so the log starts with what a player hears on arrival.
	await nvda.perform(nvda.keyboardCommands.reportCurrentFocus);
}

test.describe('component gallery with NVDA', () => {
	test.afterEach(async ({ nvda }, testInfo) => {
		await attachSpeech(nvda, testInfo, 'nvda-spoken-phrases');
	});

	test('popup menu: a menu, its submenu, a refused entry with its reason, and the way back', async ({ page, nvda }, testInfo) => {
		await openStory(page, nvda, 'popup-menu', '#story-menu-opener');
		expect(await heard(nvda), 'the opener is a button with a popup').toMatch(NVDA.button);
		expect(await heard(nvda)).toContain('open menu');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'Enter');
		const opened = await heard(nvda);
		expect(opened, 'opening lands on the first entry of a MENU').toMatch(NVDA.menu);
		expect(opened).toContain('rename');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowDown');
		const onSubmenuEntry = await heard(nvda);
		expect(onSubmenuEntry).toContain('sort by');
		expect(onSubmenuEntry, 'an entry that opens a submenu says so').toMatch(NVDA.submenu);

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowDown');
		const onRefused = await heard(nvda);
		expect(onRefused).toContain('build a house');
		expect(onRefused, 'a refused entry is unavailable, never gone').toMatch(NVDA.unavailable);
		expect(onRefused, 'the described-by reason is read with the entry').toContain('own every square');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'Enter');
		expect(await heard(nvda), 'activating the refused entry speaks its reason through the live log')
			.toContain('own every square of the group first');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowUp');
		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowRight');
		const inSubmenu = await heard(nvda);
		expect(inSubmenu).toContain('name');
		expect(inSubmenu, 'the submenu is a radio set').toMatch(NVDA.radioMenuItem);
		expect(inSubmenu).toMatch(NVDA.checked);

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowDown');
		const onPrice = await heard(nvda);
		expect(onPrice).toContain('price');
		expect(onPrice).toMatch(NVDA.notChecked);

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'Escape');
		await pressAndSettle(nvda, 'Escape');
		const back = await heard(nvda);
		expect(back, 'Escape twice returns to the opener').toContain('open menu');
		expect(back).toMatch(NVDA.button);
		await attachSpeech(nvda, testInfo, 'popup-menu-final-log');
	});

	test('tabs: the strip is a tab list and the arrows select', async ({ page, nvda }) => {
		await openStory(page, nvda, 'tabs', '#story-tab-profile');
		const arrival = await heard(nvda);
		expect(arrival).toContain('profile');
		expect(arrival).toMatch(NVDA.tab);
		expect(arrival, 'the current tab is selected').toMatch(NVDA.selected);

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowRight');
		const next = await heard(nvda);
		expect(next).toContain('lobby notices');
		expect(next, 'the arrow both moves and selects').toMatch(NVDA.selected);
	});

	test('combobox: a combo box whose result count is spoken once the typing stops', async ({ page, nvda }) => {
		await openStory(page, nvda, 'combobox', '#story-combo-input');
		expect(await heard(nvda)).toMatch(NVDA.comboBox);

		await nvda.clearSpokenPhraseLog();
		await nvda.type('harb');
		// The live count waits ANNOUNCE_DELAY_MS for the typing to pause, then NVDA reads it.
		await expect.poll(() => heard(nvda), { timeout: 10_000 }).toContain('1 game matches');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowDown');
		expect(await heard(nvda), 'Down moves into the list onto the one match').toContain('harbour lights');
	});

	test('toolbar: a tool bar whose refused action is unavailable and explains itself', async ({ page, nvda }) => {
		await openStory(page, nvda, 'toolbar', '#story-toolbar button');
		const arrival = await heard(nvda);
		expect(arrival, 'entering says tool bar, which is what makes the arrows mean something').toMatch(NVDA.toolbar);
		expect(arrival).toContain('roll the dice');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowRight');
		const onBuy = await heard(nvda);
		expect(onBuy).toContain('buy');
		expect(onBuy).toMatch(NVDA.unavailable);
		expect(onBuy).toContain('not standing on a square for sale');
	});

	test('dialogs: a modal question is a dialog with its title, the guide reads as a document', async ({ page, nvda }) => {
		await openStory(page, nvda, 'dialog', '#story-dialog-confirm');
		expect(await heard(nvda)).toContain('discard a card');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'Enter', 1500);
		const opened = await heard(nvda);
		expect(opened, 'a native <dialog> is announced as a dialog').toMatch(NVDA.dialog);
		expect(opened, 'the title names the dialog').toContain('discard night train');
		expect(opened, 'the described-by message is read on entry').toContain('discard pile');
		expect(opened, 'focus lands on the expected answer').toContain('confirm');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowLeft');
		expect(await heard(nvda), 'the arrows walk the answers inside the application region').toContain('cancel');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'Escape', 1500);
		expect(await heard(nvda), 'Escape returns to the opener').toContain('discard a card');

		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'Tab');
		expect(await heard(nvda)).toContain('open the guide');
		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'Enter', 1500);
		const guide = await heard(nvda);
		expect(guide).toMatch(NVDA.dialog);
		expect(guide, 'the reading dialog opens on its title').toContain('how to play');

		// In a document, Down reads the next line: NVDA is in browse mode, not stuck in focus mode.
		await nvda.clearSpokenPhraseLog();
		await pressAndSettle(nvda, 'ArrowDown');
		await pressAndSettle(nvda, 'ArrowDown');
		expect(await heard(nvda), 'browse mode walks the guide text').toContain('move your token');
	});
});

// helpers/speech.ts — reading what NVDA said, in a form a test can assert against.
//
// A screen reader's output is a stream of phrases, and the exact wording of a phrase is the screen
// reader's business, not ours: "menu item", "sub menu", "unavailable", "checked" are NVDA's English
// words and a version may rephrase, re-split or re-order them. What a test owns is whether the
// FACT was spoken at all — that a submenu was called a submenu, that a refused action was called
// unavailable, that the reason the component gave was heard. So assertions run over the whole log
// since the last clearing, lower-cased and whitespace-normalised, with regular expressions that
// name the fact loosely, and the log itself is attached to the report so a failure can be read.

import type { TestInfo } from '@playwright/test';
import type { NVDAPlaywright } from '@guidepup/playwright';

/** Everything NVDA has said since the log was last cleared, as one normalised line. */
export async function heard(nvda: NVDAPlaywright): Promise<string> {
	const phrases = await nvda.spokenPhraseLog();
	return phrases.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Attach the raw phrase log to the test report, so what was heard can be read on a failure. */
export async function attachSpeech(nvda: NVDAPlaywright, testInfo: TestInfo, name: string): Promise<void> {
	const phrases = await nvda.spokenPhraseLog();
	await testInfo.attach(name, { body: phrases.join('\n'), contentType: 'text/plain' });
}

/**
 * Press a key and give NVDA the time to speak about it. Guidepup waits for the speech that a key
 * press causes, but a key that moves focus inside the page can start a second utterance (the
 * live-region echo of the component's announcement) that lands a moment later.
 */
export async function pressAndSettle(nvda: NVDAPlaywright, key: string, settleMs = 750): Promise<void> {
	await nvda.press(key);
	await new Promise(resolve => setTimeout(resolve, settleMs));
}

/** NVDA's English words for the states the gallery widgets depend on. */
export const NVDA = {
	menu: /\bmenu\b/,
	submenu: /sub ?menu/,
	menuItem: /menu item/,
	radioMenuItem: /radio menu item|menu item radio/,
	checkMenuItem: /check menu item|menu item check/,
	checked: /(?<!not )\bchecked\b/,
	notChecked: /not checked|unchecked/,
	unavailable: /\bunavailable\b/,
	expanded: /\bexpanded\b/,
	collapsed: /\bcollapsed\b/,
	tab: /\btab\b/,
	selected: /\bselected\b/,
	comboBox: /combo ?box/,
	toolbar: /tool ?bar/,
	dialog: /\bdialog\b/,
	button: /\bbutton\b/,
	heading: /\bheading\b/,
};

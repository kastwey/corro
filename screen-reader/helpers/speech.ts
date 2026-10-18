// helpers/speech.ts — reading what NVDA said, in a form a test can assert against.
//
// A screen reader's output is a stream of phrases, and the exact wording of a phrase is the screen
// reader's business, not ours: "sub menu", "unavailable", "selected", "checked" are NVDA's English
// words and a version may rephrase, re-split or re-order them. What a test owns is whether the
// FACT was spoken at all — that a submenu was called a submenu, that a refused action was called
// unavailable, that the reason the component gave was heard. So assertions run over the whole log
// since the last clearing, lower-cased and whitespace-normalised, with regular expressions that
// name the fact loosely, and the log itself is attached to the report so a failure can be read.
//
// What the log HOLDS depends on Guidepup's capture mode, and the suite must start NVDA with
// `capture: true` (see the `test.use` in the spec). The default, "initial", keeps only the first
// phrase NVDA utters after a key — and the gallery's widgets say their most important things
// second: the answer button a dialog focuses fifty milliseconds after opening, the tab that a
// strip selects as the arrow lands, the search count a combobox speaks once the typing pauses.
// With `true`, every phrase until a second of silence is kept. Speech that nobody's key caused
// is never recorded either way, so a live-region line is only heard when it arrives inside the
// window of the key that caused it.

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
 * NVDA's English words for the states the gallery widgets depend on. Position ("1 of 4") is
 * listed with them: NVDA counts position only inside a menu or a list, so hearing it IS hearing
 * that the entry sits in a menu, whether or not NVDA names the menu itself.
 */
export const NVDA = {
	submenu: /sub ?menu/,
	position: (index: number, count: number) => new RegExp(`\\b${index} of ${count}\\b`),
	checked: /(?<!not )\bchecked\b/,
	notChecked: /not checked|unchecked/,
	unavailable: /\bunavailable\b/,
	tab: /\btab\b/,
	selected: /\bselected\b/,
	comboBox: /combo ?box/,
	toolbar: /tool ?bar/,
	dialog: /\bdialog\b/,
	button: /\bbutton\b/,
};

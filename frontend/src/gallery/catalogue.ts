// gallery/catalogue.ts — every story the gallery shows, in the order the index lists them.
//
// Adding a reusable widget means adding its story here (and a spec for it in
// e2e/tests/gallery.spec.ts, so the Axe monitor reaches its states, plus a screen-reader scenario
// when what it SAYS matters — see screen-reader/README.md).

import type { Story } from './stories.js';
import { popupMenuStory } from './stories/popupMenuStory.js';
import { tabsStory } from './stories/tabsStory.js';
import { comboBoxStory } from './stories/comboBoxStory.js';
import { toolbarStory } from './stories/toolbarStory.js';
import { actionListStory } from './stories/actionListStory.js';
import { checkboxListStory } from './stories/checkboxListStory.js';
import { dialogStory } from './stories/dialogStory.js';

export const stories: readonly Story[] = [
	popupMenuStory,
	tabsStory,
	comboBoxStory,
	toolbarStory,
	actionListStory,
	checkboxListStory,
	dialogStory,
];

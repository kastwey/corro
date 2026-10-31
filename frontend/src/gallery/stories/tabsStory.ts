// gallery/stories/tabsStory.ts — the tab strip (tabs.ts) over three panels.
//
// The settings and friends views use this strip. Selection follows the arrows, so the story's
// panels are plain text and cheap to reveal, exactly the case the component was built for.

import { Tabs } from '../../tabs.js';
import type { Story } from '../stories.js';

const PANELS = [
	{ id: 'profile', label: 'Profile', text: 'Your name and the colour of your token.' },
	{ id: 'notices', label: 'Lobby notices', text: 'Who to be told about when they arrive.' },
	{ id: 'sound', label: 'Sound', text: 'Earcons on or off, and how loud.' },
];

export const tabsStory: Story = {
	id: 'tabs',
	title: 'Tabs',
	description: 'One tab stop for the whole strip. Left and Right move between tabs and show their '
		+ 'panel at once; Home and End jump to the ends; Tab goes into the open panel.',
	mount(host) {
		const tablist = document.createElement('div');
		tablist.id = 'story-tabs';
		tablist.className = 'gallery-tabs';
		tablist.setAttribute('role', 'tablist');
		tablist.setAttribute('aria-label', 'Settings sections');
		host.appendChild(tablist);

		for (const [index, panel] of PANELS.entries()) {
			const tab = document.createElement('button');
			tab.type = 'button';
			tab.id = `story-tab-${panel.id}`;
			tab.className = 'gallery-tabs__tab';
			tab.setAttribute('role', 'tab');
			tab.setAttribute('aria-controls', `story-panel-${panel.id}`);
			tab.setAttribute('aria-selected', String(index === 0));
			tab.textContent = panel.label;
			tablist.appendChild(tab);

			const tabpanel = document.createElement('div');
			tabpanel.id = `story-panel-${panel.id}`;
			tabpanel.className = 'gallery-tabs__panel';
			tabpanel.setAttribute('role', 'tabpanel');
			tabpanel.setAttribute('aria-labelledby', tab.id);
			// A panel of plain text has nothing focusable, so it is itself the keyboard stop that
			// lets somebody reach the text (the lobby's rule: a tabpanel gets a tabindex only then).
			tabpanel.tabIndex = 0;
			tabpanel.hidden = index !== 0;
			const paragraph = document.createElement('p');
			paragraph.textContent = panel.text;
			tabpanel.appendChild(paragraph);
			host.appendChild(tabpanel);
		}

		// Nothing is announced on selection, exactly as in the lobby: the selected tab takes focus
		// and the screen reader's own report of it ("Lobby notices, tab, selected") IS the voice. A
		// live-region line on top of that would talk over the report, and did in the first NVDA run.
		new Tabs({ tablist });
	},
};

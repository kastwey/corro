// gallery/stories/comboBoxStory.ts — the game picker (comboBox.ts) over an invented catalogue.
//
// The list is always on screen and never a tab stop; Down enters it, typing filters it, and the
// result count is shown at once but SPOKEN only once the typing pauses. That last part is the
// behaviour worth hearing with a real screen reader: four keystrokes should be one announcement.

import { ComboBox } from '../../comboBox.js';
import type { Story } from '../stories.js';

const GAMES = [
	'Capital Streets', 'Galactic Race', 'Four Colours', 'Ancient Trails', 'Market Day',
	'Night Train', 'River Crossing', 'Harbour Lights', 'Mountain Pass', 'Desert Caravan',
	'Castle Siege', 'Orchard Season',
].map((label, index) => ({ id: `game-${index + 1}`, label }));

export const comboBoxStory: Story = {
	id: 'combobox',
	title: 'Combobox',
	description: 'The game picker. Type to filter, Down enters the list and Up jumps to its end, '
		+ 'Enter or Space chooses, a letter typed inside the list goes back to the field and keeps '
		+ 'searching. The result count is spoken once the typing stops.',
	mount(host, context) {
		const wrapper = document.createElement('div');
		wrapper.className = 'combo gallery-combo';

		const label = document.createElement('label');
		label.htmlFor = 'story-combo-input';
		label.textContent = 'Game';
		wrapper.appendChild(label);

		const input = document.createElement('input');
		input.id = 'story-combo-input';
		input.className = 'combo-input';
		input.type = 'text';
		input.autocomplete = 'off';
		input.setAttribute('role', 'combobox');
		input.setAttribute('aria-autocomplete', 'list');
		input.setAttribute('aria-controls', 'story-combo-listbox');
		input.setAttribute('aria-expanded', 'false');
		input.setAttribute('aria-describedby', 'story-combo-results');
		wrapper.appendChild(input);

		const listbox = document.createElement('ul');
		listbox.id = 'story-combo-listbox';
		listbox.className = 'combo-listbox';
		listbox.setAttribute('role', 'listbox');
		listbox.setAttribute('aria-label', 'Games');
		wrapper.appendChild(listbox);

		const visualStatus = document.createElement('p');
		visualStatus.id = 'story-combo-results';
		visualStatus.className = 'combo-results';
		visualStatus.setAttribute('aria-hidden', 'true');
		wrapper.appendChild(visualStatus);

		const liveStatus = document.createElement('p');
		liveStatus.id = 'story-combo-live';
		liveStatus.className = 'sr-only';
		liveStatus.setAttribute('role', 'status');
		wrapper.appendChild(liveStatus);

		host.appendChild(wrapper);

		const combo = new ComboBox({
			input,
			listbox,
			visualStatus,
			liveStatus,
			locale: document.documentElement.lang || 'en',
			describeResults: count => count === 0 ? 'No games match.'
				: count === 1 ? '1 game matches.' : `${count} games match.`,
			onSelect: item => { if (item) context.announce(`${item.label} chosen.`); },
		});
		combo.setItems(GAMES);
	},
};

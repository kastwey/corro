// gallery/stories/checkboxListStory.ts — native checkboxes as one roving list (accessibleList.ts,
// RovingCheckboxList).
//
// The house-rules picker: the group is a single tab stop, Up and Down move between the boxes, and
// Space still toggles natively, so the screen reader keeps saying "checked" and "not checked"
// without anybody re-implementing a checkbox.

import { RovingCheckboxList } from '../../accessibleList.js';
import type { Story } from '../stories.js';

const RULES = [
	{ id: 'double-start', label: 'Double cash for landing exactly on Start', checked: true },
	{ id: 'free-parking-pot', label: 'Fines go to a pot won on Free Parking', checked: false },
	{ id: 'no-auctions', label: 'Declined squares are not auctioned', checked: false },
	{ id: 'short-game', label: 'The match ends after one lap of everyone', checked: true },
];

export const checkboxListStory: Story = {
	id: 'checkbox-list',
	title: 'Checkbox list',
	description: 'House rules. Tab reaches the group once; Up and Down move between the boxes, '
		+ 'Home and End jump to the ends, Space toggles the one under the cursor.',
	mount(host, context) {
		const fieldset = document.createElement('fieldset');
		fieldset.id = 'story-rules';
		fieldset.className = 'gallery-checkboxes';
		const legend = document.createElement('legend');
		legend.textContent = 'House rules';
		fieldset.appendChild(legend);

		for (const [index, rule] of RULES.entries()) {
			const row = document.createElement('div');
			row.className = 'gallery-checkboxes__row';
			const input = document.createElement('input');
			input.type = 'checkbox';
			input.id = `story-rule-${rule.id}`;
			input.checked = rule.checked;
			input.tabIndex = index === 0 ? 0 : -1;
			input.addEventListener('change', () => context.announce(`${rule.label}: ${input.checked ? 'on' : 'off'}.`));
			const label = document.createElement('label');
			label.htmlFor = input.id;
			label.textContent = rule.label;
			row.append(input, label);
			fieldset.appendChild(row);
		}
		host.appendChild(fieldset);

		new RovingCheckboxList({ container: fieldset, itemSelector: 'input[type="checkbox"]' });
	},
};

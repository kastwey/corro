// gallery/stories/popupMenuStory.ts — the ARIA menu popup (popupMenu.ts), opened from a button.
//
// The board's square menu, with every kind of entry it can hold: a plain action, a submenu that
// replaces the menu in place, a pair of mutually exclusive options, and an option that is refused
// with a spoken reason rather than removed.

import { popupMenu } from '../../popupMenu.js';
import type { Story } from '../stories.js';

export const popupMenuStory: Story = {
	id: 'popup-menu',
	title: 'Popup menu',
	description: 'The square menu of the board. Open it with Enter or Space; Up and Down move, '
		+ 'Right opens the submenu and Left comes back, a letter jumps to the entry starting with '
		+ 'it, Escape closes and returns to the button.',
	mount(host, context) {
		const opener = document.createElement('button');
		opener.type = 'button';
		opener.id = 'story-menu-opener';
		opener.className = 'btn';
		opener.textContent = 'Open menu';
		opener.setAttribute('aria-haspopup', 'menu');
		opener.setAttribute('aria-expanded', 'false');

		let sort: 'name' | 'price' = 'name';
		const open = () => popupMenu.open({
			ariaLabel: 'Square actions',
			anchor: opener,
			announce: context.announce,
			onClose: () => opener.focus(),
			items: [
				{ label: 'Rename', onSelect: () => context.announce('Rename chosen.') },
				{
					label: 'Sort by',
					submenu: {
						items: [
							{ label: 'Name', checked: sort === 'name', onSelect: () => { sort = 'name'; context.announce('Sorted by name.'); } },
							{ label: 'Price', checked: sort === 'price', onSelect: () => { sort = 'price'; context.announce('Sorted by price.'); } },
						],
					},
				},
				{ label: 'Build a house', disabled: true, reason: 'You need to own every square of the group first.' },
				{ label: 'Mortgage', onSelect: () => context.announce('Mortgage chosen.') },
			],
		});

		opener.addEventListener('click', open);
		host.appendChild(opener);
	},
};

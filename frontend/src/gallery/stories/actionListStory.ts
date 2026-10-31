// gallery/stories/actionListStory.ts — a roster list with per-row actions and a context menu
// (accessibleList.ts, RovingToolbarList).
//
// The players panel, the table roster, the friends list and the message log all are this: rows
// that are single focus stops reading their whole content, a small toolbar inside each row that
// Right enters, and Shift+F10 (or the Applications key) opening a menu that mirrors those actions
// — with the list's own sort toggles collapsed into one submenu read as a radio set.

import { RovingToolbarList } from '../../accessibleList.js';
import type { Story } from '../stories.js';

const PLAYERS = [
	{ name: 'Berto', money: 1500, muted: false },
	{ name: 'Carmen', money: 900, muted: true },
	{ name: 'Dani', money: 2100, muted: false },
];

export const actionListStory: Story = {
	id: 'list-with-actions',
	title: 'List with row actions',
	description: 'A roster. Up and Down move between players, Right enters a player\'s actions and '
		+ 'Left or Escape comes back. Shift+F10 or the Applications key opens a menu with the same '
		+ 'actions plus the sorting options as a submenu.',
	mount(host, context) {
		const sortBar = document.createElement('div');
		sortBar.id = 'story-list-actions';
		sortBar.className = 'gallery-list__sort';
		sortBar.setAttribute('role', 'toolbar');
		sortBar.setAttribute('aria-label', 'Sort players');
		let sortBy: 'name' | 'money' = 'name';
		const sortButtons: HTMLButtonElement[] = [];
		for (const [key, label] of [['name', 'Sort by name'], ['money', 'Sort by cash']] as const) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'btn';
			button.textContent = label;
			button.dataset.menuGroup = 'Sort by';
			button.setAttribute('aria-pressed', String(sortBy === key));
			button.addEventListener('click', () => {
				sortBy = key;
				sortButtons.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
				context.announce(`${label}.`);
			});
			sortButtons.push(button);
			sortBar.appendChild(button);
		}
		host.appendChild(sortBar);

		const list = document.createElement('ul');
		list.id = 'story-roster';
		list.className = 'gallery-list';
		list.setAttribute('aria-label', 'Players');
		host.appendChild(list);

		for (const [index, player] of PLAYERS.entries()) {
			const row = document.createElement('li');
			row.className = 'gallery-list__row';
			row.tabIndex = index === 0 ? 0 : -1;
			row.setAttribute('aria-label', `${player.name}, ${player.money} credits${player.muted ? ', muted' : ''}.`);

			const text = document.createElement('span');
			text.className = 'gallery-list__text';
			text.setAttribute('aria-hidden', 'true');
			text.textContent = `${player.name} — ${player.money}`;
			row.appendChild(text);

			const actions = document.createElement('div');
			actions.className = 'gallery-list__row-actions';
			actions.setAttribute('role', 'toolbar');
			actions.setAttribute('aria-label', `Actions for ${player.name}`);
			row.appendChild(actions);

			const trade = document.createElement('button');
			trade.type = 'button';
			trade.className = 'btn';
			trade.tabIndex = -1;
			trade.textContent = 'Trade';
			trade.addEventListener('click', () => context.announce(`Trade with ${player.name} opened.`));
			actions.appendChild(trade);

			const mute = document.createElement('button');
			mute.type = 'button';
			mute.className = 'btn';
			mute.tabIndex = -1;
			mute.textContent = 'Mute';
			mute.setAttribute('aria-pressed', String(player.muted));
			mute.addEventListener('click', () => {
				const next = mute.getAttribute('aria-pressed') !== 'true';
				mute.setAttribute('aria-pressed', String(next));
				context.announce(next ? `${player.name} muted.` : `${player.name} unmuted.`);
			});
			actions.appendChild(mute);

			list.appendChild(row);
		}

		new RovingToolbarList({
			list,
			itemSelector: '.gallery-list__row',
			toolbarButtonSelector: '.gallery-list__row-actions button',
			listActionsSelector: '#story-list-actions button',
			menuLabel: () => 'Player actions',
			menuClass: 'player-context-menu',
			menuItemClass: 'player-context-menu-item',
			menuHost: () => document.querySelector('main'),
		});
	},
};

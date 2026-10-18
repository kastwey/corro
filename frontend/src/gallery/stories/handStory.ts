// gallery/stories/handStory.ts — the card hand (handPanel.ts), the most reused client component.
//
// Every card family plays from this panel: a roving list of cards whose rows read as one line
// each ("Flat tyre. Not playable"), a toolbar inside each row, Enter to play, Space to draw,
// Delete to discard behind a confirmation, Shift+F1 for the card's help, Shift+F10 for a menu
// mirroring all of that plus the sort and display options. The story fakes the match around it:
// playing or discarding removes the card, drawing adds one, and every outcome is announced the
// way a family would announce it.

import { HandPanel, type HandCard } from '../../handPanel.js';
import type { Story } from '../stories.js';

function startingHand(): HandCard[] {
	return [
		{ id: 'c1', label: 'Move 75', typeKey: 'distance', value: 75, playable: true,
			help: 'Advance seventy-five on your trip. You need a green light first.' },
		{ id: 'c2', label: 'Move 25', typeKey: 'distance', value: 25, playable: true },
		{ id: 'c3', label: 'Flat tyre', typeKey: 'attack', value: 0, playable: false,
			unplayableReason: 'No rival is on the road.' },
		{ id: 'c4', label: 'Spare tyre', typeKey: 'remedy', value: 0, playable: false,
			unplayableReason: 'You have no flat tyre to fix.' },
		{ id: 'c5', label: 'Green light', typeKey: 'remedy', value: 0, playable: true,
			help: 'Lets you move again after a stop.' },
	];
}

const DRAW_PILE: HandCard[] = [
	{ id: 'd1', label: 'Move 100', typeKey: 'distance', value: 100, playable: true },
	{ id: 'd2', label: 'Out of fuel', typeKey: 'attack', value: 0, playable: false, unplayableReason: 'No rival is on the road.' },
];

export const handStory: Story = {
	id: 'hand',
	title: 'Card hand',
	description: 'The hand every card family plays from. Up and Down move between cards, Right '
		+ 'enters a card\'s actions, Enter plays, Space draws, Delete discards after a confirmation, '
		+ 'Shift+F1 reads the card\'s help and Shift+F10 opens the menu with all of it plus sorting.',
	mount(host, context) {
		// On the board the hand sits inside the game surface, `#board role="application"`, and
		// that is not decoration: inside an application a screen reader hands the arrow keys to
		// the page instead of walking its own browse buffer, which is how Up and Down move between
		// cards at all. Mounted on a plain page the rows are list items, so NVDA stayed in browse
		// mode and Down read the row's buttons instead of moving (the first NVDA run). The story
		// gives the hand the same surface the board gives it.
		const surface = document.createElement('div');
		surface.className = 'gallery-surface';
		surface.setAttribute('role', 'application');
		surface.setAttribute('aria-label', 'Game surface');
		host.appendChild(surface);

		// The journey family's wrapper: it is what lays the rows out as a fan of cards.
		const mount = document.createElement('div');
		mount.className = 'journey-hand';
		surface.appendChild(mount);

		let cards = startingHand();
		const pile = [...DRAW_PILE];
		const panel = new HandPanel();
		const remove = (card: HandCard) => { cards = cards.filter(c => c.id !== card.id); };

		panel.init(mount, {
			getCards: () => cards,
			canDraw: () => pile.length > 0 ? { ok: true } : { ok: false, reason: 'The draw pile is empty.' },
			onDraw: () => {
				const drawn = pile.shift();
				if (!drawn) return;
				cards = [...cards, drawn];
				context.announce(`You drew ${drawn.label}.`);
				panel.update();
			},
			onPlay: card => {
				remove(card);
				context.announce(`You played ${card.label}.`);
				panel.update();
			},
			canDiscard: () => ({ ok: true }),
			onDiscard: card => {
				remove(card);
				context.announce(`You discarded ${card.label}.`);
				panel.update();
			},
			announce: context.announce,
			t: context.t,
			shortcutText: {
				play: 'game.help_cmd_play_card',
				draw: 'game.help_cmd_draw_card',
				discard: 'game.help_cmd_discard_card',
			},
		});
	},
};

// gallery/stories/tradeStory.ts — the trade dialog (tradeDialog.ts) on both sides of an offer.
//
// The proposer's builder is a modal native <dialog>: a partner select, two fieldsets of what is
// given and what is asked (properties as checkboxes, cash and release passes as numbers with
// spoken validation), a valuation line that follows the choices, and Propose. The partner's
// review is a non-modal one: the offer summarised as flowing sentences, Accept and Decline. The
// story invents a small board with properties on both sides; proposing or answering is announced.

import { tradeDialog } from '../../tradeDialog.js';
import type { Player, Square, TradeSideDto } from '../../models.js';
import type { Story } from '../stories.js';

const ME = 'me';
const BERTO = 'p2';

function square(id: number, over: Partial<Square>): Square {
	return { id, name: `Square ${id}`, x: 0, y: 0, ...over };
}

/**
 * A board with a brown pair and a station for Ana, a light-blue pair and a utility for Berto. A
 * trade names a property by its INDEX in the board (as every deck and command does), so the story
 * keeps id and index equal: square 2 is `squares[2]`.
 */
function board(): Square[] {
	return [
		square(0, { type: 'property', name: 'Harbour Road', color: 'brown', ownerId: ME, price: 60 }),
		square(1, { type: 'property', name: 'Harbour Lane', color: 'brown', ownerId: ME, price: 60 }),
		square(2, { type: 'railroad', name: 'North Station', ownerId: ME, price: 200 }),
		square(3, { type: 'property', name: 'Orchard Street', color: 'lightblue', ownerId: BERTO, price: 100 }),
		square(4, { type: 'property', name: 'Orchard Avenue', color: 'lightblue', ownerId: BERTO, price: 100 }),
		square(5, { type: 'utility', name: 'Waterworks', ownerId: BERTO, price: 150 }),
	];
}

const ANA = { id: ME, name: 'Ana', token: 'story-piece-a', position: 0, money: 1500, properties: [0, 1, 2], releasePasses: 1 } as unknown as Player;
const BERTO_PLAYER = { id: BERTO, name: 'Berto', token: 'story-piece-b', position: 0, money: 900, properties: [3, 4, 5], releasePasses: 0 } as unknown as Player;
const CARMEN = { id: 'p3', name: 'Carmen', token: 'story-piece-c', position: 0, money: 2100, properties: [], releasePasses: 0 } as unknown as Player;

export const tradeStory: Story = {
	id: 'trade',
	title: 'Trade',
	description: 'Propose a trade as Ana, or review one Berto proposed. The builder is a modal '
		+ 'dialog: pick the partner, tick properties, type cash; a wrong amount is refused with a '
		+ 'spoken reason and the valuation line follows every change. The review reads the offer '
		+ 'as sentences and asks for an answer.',
	mount(host, context) {
		const squares = board();
		const describe = (side: { properties: number[]; money: number; releasePasses: number }) => {
			const names = side.properties.map(index => squares[index]?.name ?? `square ${index}`);
			const parts = [...names];
			if (side.money > 0) parts.push(`${side.money} in cash`);
			if (side.releasePasses > 0) parts.push(`${side.releasePasses} release pass`);
			return parts.length > 0 ? parts.join(', ') : 'nothing';
		};

		const propose = document.createElement('button');
		propose.type = 'button';
		propose.id = 'story-trade-propose';
		propose.className = 'btn';
		propose.textContent = 'Propose a trade';
		propose.addEventListener('click', () => tradeDialog.openBuilder({
			myPlayer: ANA,
			others: [BERTO_PLAYER, CARMEN],
			squares,
			onPropose: (targetId, offered, requested) => {
				const target = [BERTO_PLAYER, CARMEN].find(p => p.id === targetId)?.name ?? targetId;
				context.announce(`Offer sent to ${target}: you give ${describe(offered)} for ${describe(requested)}.`);
			},
		}));
		host.appendChild(propose);

		const review = document.createElement('button');
		review.type = 'button';
		review.id = 'story-trade-review';
		review.className = 'btn';
		review.textContent = 'Review an offer';
		review.addEventListener('click', () => {
			const offered: TradeSideDto = {
				properties: [{ index: 3, name: 'Orchard Street', color: 'lightblue', price: 100 }],
				money: 150,
				releasePasses: 0,
			};
			const requested: TradeSideDto = {
				properties: [{ index: 2, name: 'North Station', price: 200 }],
				money: 0,
				releasePasses: 0,
			};
			tradeDialog.openReview({
				initiatorName: 'Berto',
				offered,
				requested,
				squares,
				// Accepting sends the answer and waits for the server's resolution to close the
				// review; the story resolves it on the spot. Declining closes by itself.
				onAccept: () => {
					tradeDialog.close();
					context.announce('You accepted the trade with Berto.');
				},
				onDecline: () => context.announce('You declined the trade with Berto.'),
			});
		});
		host.appendChild(review);
	},
};

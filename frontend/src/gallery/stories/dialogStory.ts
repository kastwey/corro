// gallery/stories/dialogStory.ts — the native <dialog> manager (dialogManager.ts) in its two
// voices.
//
// A QUESTION dialog (confirm) wraps its buttons in role="application", so NVDA stays in focus mode
// and the arrows walk the answers; a READING dialog (documentMode) drops that role, so the reader
// lands on the title in browse mode and the content reads like a page. Both return focus to the
// button that opened them. Which of the two a screen reader actually gets is exactly the sort of
// thing a browser update can break without any test on the DOM noticing.

import { dialogManager } from '../../dialogManager.js';
import type { Story } from '../stories.js';

export const dialogStory: Story = {
	id: 'dialog',
	title: 'Dialogs',
	description: 'A confirmation and a reading dialog, both native dialog elements. In the '
		+ 'confirmation, Tab and the arrows move between the answers and Escape cancels; the guide '
		+ 'opens on its title and reads like a document. Focus returns to the opener on close.',
	mount(host, context) {
		dialogManager.init();

		const confirmButton = document.createElement('button');
		confirmButton.type = 'button';
		confirmButton.id = 'story-dialog-confirm';
		confirmButton.className = 'btn';
		confirmButton.textContent = 'Discard a card';
		confirmButton.addEventListener('click', () => dialogManager.showConfirm({
			title: 'Discard Night Train?',
			message: 'The card goes to the discard pile and your turn ends.',
			focusConfirm: true,
			onConfirm: () => context.announce('Night Train discarded.'),
			onCancel: () => context.announce('Kept the card.'),
		}));
		host.appendChild(confirmButton);

		const guideButton = document.createElement('button');
		guideButton.type = 'button';
		guideButton.id = 'story-dialog-guide';
		guideButton.className = 'btn';
		guideButton.textContent = 'Open the guide';
		guideButton.addEventListener('click', () => {
			const content = document.createElement('div');
			content.className = 'board-help';
			const intro = document.createElement('p');
			intro.textContent = 'Move your token the sum of both dice. Landing on a square nobody owns lets you buy it.';
			const heading = document.createElement('h3');
			heading.textContent = 'Rent';
			const rent = document.createElement('p');
			rent.textContent = 'Landing on a square somebody else owns costs the rent printed on it.';
			content.append(intro, heading, rent);
			dialogManager.show({
				title: 'How to play',
				contentElement: content,
				className: 'dialog-help',
				documentMode: true,
				buttons: [{ label: 'Close', i18nKey: 'common.close', action: () => dialogManager.close() }],
			});
		});
		host.appendChild(guideButton);
	},
};

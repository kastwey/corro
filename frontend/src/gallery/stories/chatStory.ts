// gallery/stories/chatStory.ts — the in-game text chat (chatPanel.ts + mentionList.ts).
//
// A toggle button opens a floating panel: the message list, a textarea, Send, and a listbox of
// players that opens as soon as "@" is typed and completes the mention. A message that arrives
// while the panel is closed is spoken through a log region and shows an unread badge. The story
// plays both sides: sending echoes the message as the server would, and a button next to the
// toggle delivers one from another player.

import { ChatPanel } from '../../chatPanel.js';
import type { ChatMessageDto, Player } from '../../models.js';
import type { Story } from '../stories.js';

const ME = 'me';
const PLAYERS = [
	{ id: ME, name: 'Ana' },
	{ id: 'p2', name: 'Berto' },
	{ id: 'p3', name: 'Carmen' },
] as unknown as Player[];

const INCOMING = [
	'Anyone trading the harbour?',
	'I can offer the station for it.',
	'Deal, send it over.',
];

export const chatStory: Story = {
	id: 'chat',
	title: 'Text chat',
	description: 'The in-game chat. Open it with the toggle, type a message and send it with Enter; '
		+ 'an "@" opens the list of players, Down walks it and Enter completes the name. "Receive '
		+ 'a message" delivers one from Berto, spoken even while the panel is closed.',
	mount(host, context) {
		// The panel, its log and its unread badge carry fixed ids and live outside the host (in
		// the landmark and in <body>), so a second mount on the same document starts clean.
		for (const id of ['chat-panel', 'chat-log', 'chat-notification']) document.getElementById(id)?.remove();

		const controls = document.createElement('div');
		controls.className = 'gallery-chat__controls';
		host.appendChild(controls);

		let nextId = 1;
		const message = (playerId: string, playerName: string, text: string): ChatMessageDto => ({
			id: `m${nextId++}`,
			playerId,
			playerName,
			text,
			sentAt: new Date().toISOString(),
		});

		const chat = new ChatPanel();
		chat.init(controls, {
			t: context.t,
			getPlayers: () => PLAYERS,
			getMyPlayerId: () => ME,
			send: text => {
				chat.addMessage(message(ME, 'Ana', text));
				return Promise.resolve();
			},
			focusBoard: () => host.querySelector<HTMLButtonElement>('#chat-toggle')?.focus(),
			recordHistory: text => context.announce(text),
		});
		chat.setHistory([
			message('p2', 'Berto', 'Good luck everyone.'),
			message('p3', 'Carmen', 'Same to you.'),
		]);

		let incoming = 0;
		const receive = document.createElement('button');
		receive.type = 'button';
		receive.id = 'story-chat-receive';
		receive.className = 'btn';
		receive.textContent = 'Receive a message';
		receive.addEventListener('click', () => {
			chat.addMessage(message('p2', 'Berto', INCOMING[incoming % INCOMING.length]));
			incoming++;
		});
		controls.appendChild(receive);
	},
};

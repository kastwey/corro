import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { LobbyChat, describeLine, matchingCandidates, readHistory } from '../src/lobbyChat.js';

/**
 * Writing to people from the lobby.
 *
 * The rule the whole panel exists to enforce: a message goes to the people it NAMES, and a line
 * that names nobody is refused with the reason. A general lobby channel would be a stream of
 * strangers talking, which for somebody listening to every line is not a feature.
 *
 * And the refusals all say the same thing on purpose. Away, no such name, and "does not accept
 * messages from you" must be impossible to tell apart, or this becomes a way to learn who exists,
 * who is around, and who has quietly shut somebody out.
 */

setupDom();

const translate = (key: string, vars?: Record<string, unknown>) => {
	switch (key) {
		case 'lobby.chat.line': return `${vars?.from} dice: ${vars?.text}`;
		case 'lobby.chat.lineToGroup':
			return `${vars?.from}, también a ${vars?.others}, dice: ${vars?.text}`;
		case 'lobby.chat.lineMine': return `Tú, a ${vars?.to}: ${vars?.text}`;
		case 'lobby.chat.matches': return `${vars?.count} usuarios encontrados.`;
		case 'lobby.chat.noRecipient': return 'Aquí no hay chat general.';
		case 'lobby.chat.noOneToReplyTo': return 'Todavía no te ha escrito nadie.';
		case 'lobby.chat.nothingToSay': return 'El mensaje está vacío.';
		case 'lobby.chat.sent': return `Enviado a ${vars?.to}.`;
		case 'lobby.chat.unreachable': return `${vars?.handles} no lo ha recibido.`;
		default: return key;
	}
};

/** A storage that behaves, without touching the real one. */
function fakeStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear(),
		key: () => null,
		length: 0,
	} as unknown as Storage;
}

function harness(options: {
	candidates?: string[];
	delivered?: string[];
	unreachable?: string[];
	storage?: Storage;
} = {}) {
	document.body.innerHTML = `
		<div class="lobby-chat">
			<ul id="chat-log" role="list"></ul>
			<textarea id="chat-input"></textarea>
			<button id="chat-send" type="button">Enviar</button>
			<div id="chat-suggestions" hidden></div>
			<p id="chat-status" role="status" aria-live="polite"></p>
		</div>`;
	const sent: Array<{ handles: string[]; text: string }> = [];
	const storage = options.storage ?? fakeStorage();
	const chat = new LobbyChat({
		log: document.getElementById('chat-log') as HTMLElement,
		input: document.getElementById('chat-input') as HTMLTextAreaElement,
		send: document.getElementById('chat-send') as HTMLButtonElement,
		status: document.getElementById('chat-status'),
		suggestions: document.getElementById('chat-suggestions') as HTMLElement,
		t: translate,
		candidates: () => options.candidates ?? ['ana', 'anabel', 'berto'],
		me: () => 'kastwey',
		storage,
		deliver: async (handles, text) => {
			sent.push({ handles, text });
			return {
				delivered: options.delivered ?? handles,
				unreachable: options.unreachable ?? [],
			};
		},
	});
	return {
		chat,
		sent,
		storage,
		input: document.getElementById('chat-input') as HTMLTextAreaElement,
		status: document.getElementById('chat-status') as HTMLElement,
		suggestions: document.getElementById('chat-suggestions') as HTMLElement,
		lines: () => Array.from(document.querySelectorAll('.lobby-chat__line'))
			.map(el => el.textContent),
	};
}

test('a line names who wrote it, who else heard it, and what was said', () => {
	assert.equal(
		describeLine({ from: 'ana', to: ['kastwey'], text: 'hola', mine: false }, 'kastwey', translate),
		'ana dice: hola');
	// Who ELSE heard it is part of what was said.
	assert.equal(
		describeLine(
			{ from: 'ana', to: ['kastwey', 'berto'], text: 'hola', mine: false }, 'kastwey', translate),
		'ana, también a berto, dice: hola');
	assert.equal(
		describeLine({ from: 'kastwey', to: ['ana'], text: 'hola', mine: true }, 'kastwey', translate),
		'Tú, a ana: hola');
});

test('a message that names nobody is refused with the reason, never sent somewhere', async () => {
	const h = harness();
	h.input.value = 'hola a todos';

	await h.chat.submit();

	assert.deepEqual(h.sent, []);
	assert.equal(h.status.textContent, 'Aquí no hay chat general.');
	// And what they typed is still there to fix, rather than swallowed.
	assert.equal(h.input.value, 'hola a todos');
});

test('naming somebody sends to them, and the names come out of what is said', async () => {
	const h = harness();
	h.input.value = 'buenas @ana y @berto, ¿jugamos?';

	await h.chat.submit();

	assert.deepEqual(h.sent, [{ handles: ['ana', 'berto'], text: 'buenas y, ¿jugamos?' }]);
	assert.equal(h.status.textContent, 'Enviado a ana, berto.');
	assert.equal(h.input.value, '');
});

test('a bare @ replies to whoever last wrote, to the whole group', async () => {
	const h = harness();
	h.chat.receive({ from: 'ana', to: ['kastwey', 'berto'], text: 'hola', mine: false });

	h.input.value = '@ claro';
	await h.chat.submit();

	assert.deepEqual(h.sent, [{ handles: ['ana', 'berto'], text: 'claro' }]);
});

test('a bare @ with nobody to reply to says so rather than going nowhere in silence', async () => {
	const h = harness();
	h.input.value = '@ hola';

	await h.chat.submit();

	assert.deepEqual(h.sent, []);
	assert.equal(h.status.textContent, 'Todavía no te ha escrito nadie.');
});

test('a name with nothing after it is not a message', async () => {
	const h = harness();
	h.input.value = '@ana';

	await h.chat.submit();

	assert.deepEqual(h.sent, []);
	assert.equal(h.status.textContent, 'El mensaje está vacío.');
});

// Away, unknown, and "does not accept messages from you" are ONE outcome. Telling them apart is
// what turns a chat box into a way to find out who is about.
test('a message that reached nobody says so without saying why', async () => {
	const h = harness({ delivered: [], unreachable: ['ana'] });
	h.input.value = '@ana hola';

	await h.chat.submit();

	assert.equal(h.status.textContent, 'ana no lo ha recibido.');
	// Nothing was added to the log: it did not happen.
	assert.deepEqual(h.lines(), []);
	assert.equal(h.input.value, '@ana hola');
});

test('a message that reached some of its recipients keeps the ones it reached', async () => {
	const h = harness({ delivered: ['ana'], unreachable: ['berto'] });
	h.input.value = '@ana @berto hola';

	await h.chat.submit();

	assert.equal(h.status.textContent, 'berto no lo ha recibido.');
	assert.deepEqual(h.lines(), ['Tú, a ana: hola']);
});

// A list that silently appears is a list somebody listening never learns about.
test('the matching names are counted out loud, and Down walks them', () => {
	const h = harness();
	h.input.value = 'hola @an';
	h.input.setSelectionRange(8, 8);
	h.input.dispatchEvent(new window.Event('input'));

	assert.equal(h.status.textContent, '2 usuarios encontrados.');
	assert.equal(h.suggestions.hidden, false);
	assert.deepEqual(
		Array.from(h.suggestions.querySelectorAll('button')).map(b => b.textContent),
		['ana', 'anabel']);
});

test('choosing a name replaces what was typed and leaves room for the next word', () => {
	const h = harness();
	h.input.value = 'hola @an';
	h.input.setSelectionRange(8, 8);
	h.input.dispatchEvent(new window.Event('input'));

	(h.suggestions.querySelector('button') as HTMLButtonElement).click();

	assert.equal(h.input.value, 'hola @ana ');
	assert.equal(h.suggestions.hidden, true);
});

test('matching is by prefix and case-insensitive', () => {
	assert.deepEqual(matchingCandidates('AN', ['ana', 'anabel', 'berto']), ['ana', 'anabel']);
	assert.deepEqual(matchingCandidates('', ['ana', 'berto']), ['ana', 'berto']);
	assert.deepEqual(matchingCandidates('z', ['ana']), []);
});

// Kept per tab, so a reload does not silently lose a conversation — and nothing is left behind on
// a shared computer once the tab closes.
test('what was said survives a reload, and nothing goes to the server', () => {
	const storage = fakeStorage();
	const first = harness({ storage });
	first.chat.receive({ from: 'ana', to: ['kastwey'], text: 'hola', mine: false });

	const reopened = harness({ storage });

	assert.deepEqual(reopened.lines(), ['ana dice: hola']);
	assert.equal(readHistory(storage).length, 1);
});

test('a storage that refuses to answer costs the history, not the panel', () => {
	const broken = {
		getItem: () => { throw new Error('blocked'); },
		setItem: () => { throw new Error('blocked'); },
	} as unknown as Storage;

	const h = harness({ storage: broken });
	h.chat.receive({ from: 'ana', to: ['kastwey'], text: 'hola', mine: false });

	// Still shown; simply not remembered.
	assert.deepEqual(h.lines(), ['ana dice: hola']);
	assert.deepEqual(readHistory(broken), []);
});

test('the log is one tab stop, walked with the arrows like every other list here', () => {
	const h = harness();
	h.chat.receive({ from: 'ana', to: ['kastwey'], text: 'una', mine: false });
	h.chat.receive({ from: 'ana', to: ['kastwey'], text: 'dos', mine: false });

	const items = Array.from(document.querySelectorAll<HTMLElement>('.lobby-chat__line'));
	assert.deepEqual(items.map(i => i.tabIndex), [0, -1]);

	items[0].focus();
	items[0].dispatchEvent(
		new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
	assert.equal(document.activeElement, items[1]);
});

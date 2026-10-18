import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { selectStory, storyHref, validateStories, type Story, type StoryContext } from '../src/gallery/stories.js';

/**
 * The component gallery (gallery.html): the catalogue is sound, the URL picks a story, and every
 * story mounts its real widget from plain data — in jsdom, with no server. The browser-level
 * checks (Axe on each state, what a screen reader says) live in e2e/tests/gallery.spec.ts and in
 * screen-reader/; this is what proves a story is not broken before either of those runs.
 */

before(() => {
	setupDom();
	installFakeI18next('en');
});

const FAKE: Story[] = [
	{ id: 'alpha', title: 'Alpha', description: 'first', mount: () => undefined },
	{ id: 'beta-two', title: 'Beta', description: 'second', mount: () => undefined },
];

// === Pure catalogue logic ===

test('validateStories accepts hyphenated unique ids and reports the rest', () => {
	assert.deepEqual(validateStories(FAKE), []);
	const problems = validateStories([
		...FAKE,
		{ id: 'alpha', title: 'Again', description: 'dup', mount: () => undefined },
		{ id: 'Not Valid', title: '', description: ' ', mount: () => undefined },
	]);
	assert.ok(problems.some(p => p.includes('"alpha" is used twice')));
	assert.ok(problems.some(p => p.includes('"Not Valid" is not lowercase-hyphenated')));
	assert.ok(problems.some(p => p.includes('has no title')));
	assert.ok(problems.some(p => p.includes('has no description')));
});

test('selectStory reads ?story=, and an unknown or missing id is the index', () => {
	assert.equal(selectStory(FAKE, '?story=beta-two')?.id, 'beta-two');
	assert.equal(selectStory(FAKE, '?lang=es&story=alpha')?.id, 'alpha');
	assert.equal(selectStory(FAKE, ''), null);
	assert.equal(selectStory(FAKE, '?story=nope'), null);
});

test('storyHref keeps the other query parameters (the language) and sets the story', () => {
	assert.equal(storyHref('alpha', ''), '?story=alpha');
	assert.equal(storyHref('alpha', '?lang=es'), '?lang=es&story=alpha');
	assert.equal(storyHref('beta-two', '?story=alpha&lang=es'), '?story=beta-two&lang=es');
});

// === The real catalogue, mounted ===

function context(): StoryContext & { announced: string[] } {
	const announced: string[] = [];
	return {
		announced,
		announce: text => announced.push(text),
		// The real English strings (installFakeI18next), as the gallery page has them.
		t: (key, vars) => (globalThis as any).window.i18next.t(key, vars),
	};
}

test('the shipped catalogue is valid', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	assert.ok(stories.length >= 7, `expected the seven first stories, got ${stories.length}`);
	assert.deepEqual(validateStories(stories), []);
});

/**
 * A fresh <main> with an empty host for each test. Only the landmark is replaced, never the whole
 * body: dialogManager creates its <dialog> in <body> once and keeps the reference, exactly as on
 * the real page, so wiping the body would leave the singleton pointing at a detached element.
 */
function freshHost(): void {
	document.querySelector('main')?.remove();
	const main = document.createElement('main');
	main.innerHTML = '<div id="host"></div>';
	document.body.appendChild(main);
}

beforeEach(freshHost);

test('every story mounts into an empty host without throwing and renders something', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	for (const story of stories) {
		freshHost();
		const host = document.getElementById('host')!;
		story.mount(host, context());
		assert.ok(host.children.length > 0, `story "${story.id}" rendered nothing`);
	}
});

test('the popup menu story opens the real ARIA menu with a submenu and a refused entry', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'popup-menu')!;
	const ctx = context();
	const host = document.getElementById('host')!;
	story.mount(host, ctx);

	const opener = host.querySelector<HTMLButtonElement>('#story-menu-opener')!;
	assert.equal(opener.getAttribute('aria-expanded'), 'false');
	opener.click();

	const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
	assert.ok(menu, 'the menu is in the document');
	assert.equal(opener.getAttribute('aria-expanded'), 'true');
	// Hosted inside the page's landmark, never as orphan content under <body>.
	assert.ok(menu.closest('main'), 'the menu is hosted inside <main>');
	const items = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
	assert.deepEqual(items.map(i => i.textContent), ['Rename', 'Sort by', 'Build a house', 'Mortgage']);
	assert.equal(items[1].getAttribute('aria-haspopup'), 'menu');
	assert.equal(items[2].getAttribute('aria-disabled'), 'true');
	assert.ok(items[2].getAttribute('aria-describedby'));

	// A refused entry speaks its reason through the gallery's announcer instead of acting.
	items[2].click();
	assert.deepEqual(ctx.announced, ['You need to own every square of the group first.']);
	assert.ok(document.querySelector('[role="menu"]'), 'the menu stays open after a refusal');

	// The submenu replaces the menu in place and is read as a radio set.
	items[1].click();
	const radios = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
	assert.deepEqual(radios.map(r => [r.textContent, r.getAttribute('aria-checked')]), [['Name', 'true'], ['Price', 'false']]);
	radios[1].click();
	assert.equal(document.querySelector('[role="menu"]'), null, 'choosing closes the menu');
	assert.equal(opener.getAttribute('aria-expanded'), 'false');
	assert.equal(ctx.announced.at(-1), 'Sorted by price.');
});

test('the tabs story shows exactly one panel and follows the arrows', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'tabs')!;
	const ctx = context();
	const host = document.getElementById('host')!;
	story.mount(host, ctx);

	const tabs = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
	const panels = Array.from(host.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
	assert.equal(tabs.length, 3);
	assert.deepEqual(panels.map(p => p.hidden), [false, true, true]);
	assert.deepEqual(tabs.map(t => t.tabIndex), [0, -1, -1]);

	tabs[0].focus();
	tabs[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
	assert.equal(document.activeElement, tabs[1]);
	assert.deepEqual(panels.map(p => p.hidden), [true, false, true]);
	// The focused tab's own screen-reader report is the voice; the story adds nothing on top.
	assert.deepEqual(ctx.announced, []);
});

test('the combobox story filters and describes its results from the live region', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'combobox')!;
	const host = document.getElementById('host')!;
	story.mount(host, context());

	const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
	const listbox = host.querySelector<HTMLElement>('[role="listbox"]')!;
	assert.equal(listbox.querySelectorAll('[role="option"]').length, 12);
	assert.equal(host.querySelector('#story-combo-results')!.textContent, '12 games match.');

	input.value = 'ra';
	input.dispatchEvent(new window.Event('input', { bubbles: true }));
	const shown = Array.from(listbox.querySelectorAll('[role="option"]')).map(o => o.textContent);
	// Case-insensitive substring match anywhere in the name, alphabetical in the page's language.
	assert.deepEqual(shown, ['Ancient Trails', 'Desert Caravan', 'Galactic Race', 'Night Train']);
	assert.equal(host.querySelector('#story-combo-results')!.textContent, '4 games match.');
	assert.equal(input.getAttribute('aria-expanded'), 'true');
});

test('the toolbar story keeps the refused action focusable and speaks its reason', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'toolbar')!;
	const ctx = context();
	const host = document.getElementById('host')!;
	story.mount(host, ctx);

	const toolbar = host.querySelector<HTMLElement>('[role="toolbar"]')!;
	assert.equal(toolbar.getAttribute('aria-label'), 'Turn actions');
	const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button'));
	assert.deepEqual(buttons.map(b => b.textContent), ['Roll the dice', 'Buy', 'Trade', 'End turn']);
	assert.deepEqual(buttons.map(b => b.tabIndex), [0, -1, -1, -1]);
	assert.equal(buttons[1].getAttribute('aria-disabled'), 'true');
	assert.equal(buttons[1].hasAttribute('disabled'), false);
	buttons[1].click();
	assert.deepEqual(ctx.announced, ['You are not standing on a square for sale.']);
	assert.equal(buttons[0].getAttribute('aria-keyshortcuts'), 'R');
});

test('the list story opens a context menu whose sort group is one submenu of radio items', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'list-with-actions')!;
	const ctx = context();
	const host = document.getElementById('host')!;
	story.mount(host, ctx);

	const rows = Array.from(host.querySelectorAll<HTMLElement>('.gallery-list__row'));
	assert.equal(rows.length, 3);
	assert.deepEqual(rows.map(r => r.tabIndex), [0, -1, -1]);
	assert.equal(rows[1].getAttribute('aria-label'), 'Carmen, 900 credits, muted.');

	rows[0].focus();
	rows[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
	const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
	assert.ok(menu, 'Shift+F10 opens the context menu');
	assert.ok(menu.closest('main'), 'the menu is hosted inside <main>');
	const entries = Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
	assert.deepEqual(entries.map(e => [e.textContent, e.getAttribute('role')]), [
		['Trade', 'menuitem'],
		['Mute', 'menuitemcheckbox'],
		['Sort by', 'menuitem'],
	]);
	assert.equal(entries[1].getAttribute('aria-checked'), 'false');
	assert.equal(entries[2].getAttribute('aria-haspopup'), 'menu');

	entries[2].click();
	const radios = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
	assert.deepEqual(radios.map(r => [r.textContent, r.getAttribute('aria-checked')]), [['Sort by name', 'true'], ['Sort by cash', 'false']]);
	radios[1].click();
	assert.equal(document.querySelector('[role="menu"]'), null, 'choosing closes the menu');
	assert.equal(document.activeElement, rows[0], 'focus returns to the row');
	assert.deepEqual(ctx.announced, ['Sort by cash.']);
});

test('the checkbox list story is one tab stop with native checkboxes', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'checkbox-list')!;
	const host = document.getElementById('host')!;
	story.mount(host, context());

	const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
	assert.equal(boxes.length, 4);
	assert.deepEqual(boxes.map(b => b.tabIndex), [0, -1, -1, -1]);
	assert.ok(boxes.every(b => host.querySelector(`label[for="${b.id}"]`)), 'every box has a label');
	boxes[0].focus();
	boxes[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
	assert.equal(document.activeElement, boxes[1]);
	assert.deepEqual(boxes.map(b => b.tabIndex), [-1, 0, -1, -1]);
});

test('the dialog story opens a native modal confirmation and a reading dialog', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'dialog')!;
	const ctx = context();
	const host = document.getElementById('host')!;
	story.mount(host, ctx);

	host.querySelector<HTMLButtonElement>('#story-dialog-confirm')!.click();
	const dialog = document.querySelector<HTMLDialogElement>('dialog#game-dialog')!;
	assert.equal(dialog.open, true);
	assert.equal(dialog.querySelector('.dialog-title')!.textContent, 'Discard Night Train?');
	assert.equal(dialog.querySelector('.dialog-buttons')!.getAttribute('role'), 'application');
	const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('.dialog-buttons button'));
	assert.deepEqual(buttons.map(b => b.textContent), ['Cancel', 'Confirm']);
	buttons[1].click();
	assert.equal(dialog.open, false);
	assert.deepEqual(ctx.announced, ['Night Train discarded.']);

	host.querySelector<HTMLButtonElement>('#story-dialog-guide')!.click();
	assert.equal(dialog.open, true);
	assert.equal(dialog.querySelector('.dialog-buttons')!.hasAttribute('role'), false, 'a reading dialog has no application role');
	assert.equal(dialog.hasAttribute('aria-describedby'), false);
	assert.equal(dialog.querySelector('.dialog-content h3')!.textContent, 'Rent');
	assert.equal(dialog.querySelector<HTMLButtonElement>('.dialog-buttons button')!.textContent, 'Close');
});

test('the hand story mounts the real hand: rows that read as one line, play, refuse, draw', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'hand')!;
	const ctx = context();
	const host = document.getElementById('host')!;
	story.mount(host, ctx);

	const list = host.querySelector<HTMLElement>('.hand-panel__list')!;
	assert.equal(list.getAttribute('role'), 'list');
	assert.equal(list.getAttribute('aria-label'), 'Your hand');
	const rows = Array.from(list.querySelectorAll<HTMLElement>('.hand-card'));
	assert.equal(rows.length, 5);
	// Sorted by value by default; an unplayable card says so in its own line.
	assert.equal(rows[0].getAttribute('aria-label'), 'Move 75');
	const flat = rows.find(r => r.getAttribute('aria-label')?.startsWith('Flat tyre'))!;
	assert.equal(flat.getAttribute('aria-label'), 'Flat tyre. not playable');

	// Enter on an unplayable card: the family discards, so the refusal and the offer to discard
	// come in one breath, as a confirmation dialog landing on the answer.
	flat.focus();
	flat.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	const dialog = document.querySelector<HTMLDialogElement>('dialog#game-dialog')!;
	assert.equal(dialog.open, true);
	assert.equal(dialog.querySelector('.dialog-content')!.textContent, 'No rival is on the road. Discard Flat tyre?');
	dialog.querySelector<HTMLButtonElement>('.dialog-buttons button')!.click(); // Cancel
	assert.equal(dialog.open, false);
	assert.deepEqual(ctx.announced, [], 'nothing is announced: the dialog carried the reason');

	// Enter on a playable card plays it and the hand shrinks.
	rows[0].focus();
	rows[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	assert.equal(ctx.announced.at(-1), 'You played Move 75.');
	assert.equal(list.querySelectorAll('.hand-card').length, 4);

	// The draw button draws from the story's pile.
	host.querySelector<HTMLButtonElement>('.hand-panel__draw')!.click();
	assert.equal(ctx.announced.at(-1), 'You drew Move 100.');
	assert.equal(list.querySelectorAll('.hand-card').length, 5);
});

test('the chat story opens the panel, completes a mention and delivers an incoming message', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'chat')!;
	const ctx = context();
	const host = document.getElementById('host')!;
	story.mount(host, ctx);

	const toggle = host.querySelector<HTMLButtonElement>('#chat-toggle')!;
	assert.equal(toggle.getAttribute('aria-expanded'), 'false');
	toggle.click();
	const panel = document.getElementById('chat-panel')!;
	assert.equal(panel.hidden, false);
	assert.ok(panel.closest('main'), 'the panel is hosted inside the landmark');
	assert.equal(document.querySelectorAll('#chat-messages li').length, 2, 'the history is shown');
	document.getElementById('chat-disclaimer-dismiss')!.click();

	// "@B" opens the listbox with the one matching player; choosing completes the name.
	const input = document.getElementById('chat-input') as HTMLTextAreaElement;
	input.value = '@B';
	input.setSelectionRange(2, 2);
	input.dispatchEvent(new window.Event('input', { bubbles: true }));
	const options = Array.from(document.querySelectorAll<HTMLElement>('#chat-mention-list [role="option"]'));
	assert.deepEqual(options.map(o => o.textContent), ['Berto']);
	options[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	assert.ok(input.value.startsWith('@Berto'), `completed to "${input.value}"`);

	// An incoming message while the panel is closed shows the unread badge.
	toggle.click();
	assert.equal(panel.hidden, true);
	host.querySelector<HTMLButtonElement>('#story-chat-receive')!.click();
	assert.equal(document.querySelectorAll('#chat-messages li').length, 3);
	assert.equal(document.getElementById('chat-notification')!.hidden, false);
});

test('the trade story opens the modal builder and the non-modal review', async () => {
	const { stories } = await import('../src/gallery/catalogue.js');
	const story = stories.find(s => s.id === 'trade')!;
	const ctx = context();
	const host = document.getElementById('host')!;
	story.mount(host, ctx);

	host.querySelector<HTMLButtonElement>('#story-trade-propose')!.click();
	const dialog = document.getElementById('trade-dialog') as HTMLDialogElement;
	assert.equal(dialog.open, true);
	assert.equal(dialog.dataset.modal, 'true');
	assert.equal(dialog.querySelector('.dialog-title')!.textContent, 'Propose a trade');
	const partners = Array.from(dialog.querySelectorAll<HTMLOptionElement>('#trade-target option')).map(o => o.textContent);
	assert.deepEqual(partners, ['Berto', 'Carmen']);
	assert.equal(dialog.querySelectorAll('.trade-give-props input.trade-prop-check').length, 3, 'Ana\'s three squares');
	const give = dialog.querySelector<HTMLInputElement>('.trade-give-props input.trade-prop-check')!;
	give.click();
	dialog.querySelector<HTMLButtonElement>('.trade-propose-btn')!.click();
	assert.match(ctx.announced.at(-1) ?? '', /^Offer sent to Berto: you give Harbour Road for nothing\.$/);
	assert.equal(dialog.open, false);

	host.querySelector<HTMLButtonElement>('#story-trade-review')!.click();
	assert.equal(dialog.open, true);
	assert.equal(dialog.dataset.modal, 'false');
	assert.ok(dialog.querySelector('.dialog-title')!.textContent?.includes('Berto'));
	dialog.querySelector<HTMLButtonElement>('.trade-accept-btn')!.click();
	assert.equal(ctx.announced.at(-1), 'You accepted the trade with Berto.');
});

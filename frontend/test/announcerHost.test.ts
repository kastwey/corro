import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { createAnnouncer, setAnnouncerHost, announceHistoryNext, announceHistoryLast, flushAnnouncerNow } from '../src/announcer.js';
import { managePropertiesDialog } from '../src/managePropertiesDialog.js';
// Regression: a native modal (showModal) makes the page background inert, which silences
// body-level ARIA live regions (JAWS stops reading). The fix hosts the live regions INSIDE
// the open dialog while it is up, and restores them to <body> on close. These tests verify
// that DOM re-parenting.

before(() => {
	setupDom();
	installFakeI18next('es');
	// Create the singleton once; both regions are appended to <body> on construction.
	createAnnouncer();
});

function polite() { return document.getElementById('sr-live')!; }
function assertive() { return document.getElementById('sr-live-assertive')!; }

test('live regions are appended to <body> by default', () => {
	assert.equal(polite().parentElement, document.body);
	assert.equal(assertive().parentElement, document.body);
});

test('setAnnouncerHost moves both live regions into the host dialog', () => {
	const dialog = document.createElement('dialog');
	document.body.appendChild(dialog);

	setAnnouncerHost(dialog);

	assert.equal(polite().parentElement, dialog);
	assert.equal(assertive().parentElement, dialog);
});

test('setAnnouncerHost(null) restores both live regions to <body>', () => {
	const dialog = document.createElement('dialog');
	document.body.appendChild(dialog);
	setAnnouncerHost(dialog);

	setAnnouncerHost(null);

	assert.equal(polite().parentElement, document.body);
	assert.equal(assertive().parentElement, document.body);
});

// Bug 2: an instant (assertive) announcement must be re-spoken even when the text is
// identical to the previous one. The old code only appended a trailing space, which some
// screen readers (JAWS) dedupe, so a repeated query (e.g. checking the same value twice)
// went silent. The fix clears the region and re-writes on the next frame, guaranteeing a
// real DOM mutation every time.
const nextFrame = () => new Promise(resolve => setTimeout(resolve, 30));

test('an instant announcement clears the region then writes the message on the next frame', async () => {
	const announce = createAnnouncer();

	announce({ key: '_raw', vars: { text: 'Money 1500' } }, { instant: true });
	// Synchronously the region is cleared (the empty → text transition forces a re-read).
	assert.equal(assertive().textContent, '');

	await nextFrame();
	assert.equal(assertive().textContent, 'Money 1500.');
});

test('repeating the same instant message re-announces it (clears then re-writes)', async () => {
	const announce = createAnnouncer();

	announce({ key: '_raw', vars: { text: 'Money 1500' } }, { instant: true });
	await nextFrame();
	assert.equal(assertive().textContent, 'Money 1500.');

	// Same text again: the region must momentarily clear, then show the message anew.
	announce({ key: '_raw', vars: { text: 'Money 1500' } }, { instant: true });
	assert.equal(assertive().textContent, '');

	await nextFrame();
	assert.equal(assertive().textContent, 'Money 1500.');
});

// Bug ("abajo del todo leo el último mensaje con el cursor virtual"): the assertive region
// was written but never wiped, so the last instant line (board navigation, an on-demand
// query, history playback) stayed at the bottom of the page and could be re-read in browse
// mode. It must be cleared a short while after being spoken, like the polite region.
test('an instant announcement is wiped after the clear delay so it cannot be re-read in browse mode', async () => {
	const announce = createAnnouncer();
	// Capture the long "clear text" timer so the test does not have to wait the full delay.
	const realSetTimeout = window.setTimeout.bind(window);
	let clearCb: (() => void) | null = null;
	(window as any).setTimeout = (fn: () => void, ms?: number) => {
		if (ms && ms >= 200) { clearCb = fn; return 0 as any; }
		return realSetTimeout(fn, ms);
	};
	try {
		announce({ key: '_raw', vars: { text: 'Board Old Kent Road' } }, { instant: true });
		await nextFrame();
		assert.equal(assertive().textContent, 'Board Old Kent Road.');

		assert.ok(clearCb, 'a text-clear timer is scheduled after the instant message is written');
		clearCb!();
		assert.equal(assertive().textContent, '', 'the stale instant line is wiped');
	} finally {
		(window as any).setTimeout = realSetTimeout;
	}
});

// Bug 10: two instant announcements fired in the SAME frame (e.g. a navigation command
// that voices "who" then "where") used to clobber each other — both cleared and both
// scheduled a write, so only the last survived and the first line went silent. They must
// now be coalesced into a single assertive utterance so BOTH lines are spoken.
test('two instant messages in the same frame are both spoken (coalesced, no clobbering)', async () => {
	const announce = createAnnouncer();

	announce({ key: '_raw', vars: { text: 'Alice, Bob' } }, { instant: true });
	announce({ key: '_raw', vars: { text: 'on Old Kent Road' } }, { instant: true });
	// Synchronously the region is cleared once, ahead of the single batched write.
	assert.equal(assertive().textContent, '');

	await nextFrame();
	assert.equal(assertive().textContent, 'Alice, Bob. on Old Kent Road.');
});

// Bug ("pulso C y oigo el dinero y, rezagado, 'no hay subasta activa'"): instant
// announcements used to flush via requestAnimationFrame, which the browser PAUSES while a
// tab is in the background. When testing multiplayer with two windows, an instant line
// spoken in the backgrounded window never flushed and piled up, then spilled out as a
// merged burst when the window regained focus. The flush must use a timer (which still
// fires in the background), so a stuck rAF can no longer swallow the announcement.
test('an instant announcement is spoken even when requestAnimationFrame never fires (backgrounded tab)', async () => {
	const announce = createAnnouncer();
	const originalRaf = window.requestAnimationFrame;
	// Simulate a backgrounded tab: rAF callbacks are never invoked.
	(window as any).requestAnimationFrame = () => 0;
	try {
		announce({ key: '_raw', vars: { text: 'You have 1500 euros' } }, { instant: true });
		await nextFrame();
		assert.equal(assertive().textContent, 'You have 1500 euros.');
	} finally {
		window.requestAnimationFrame = originalRaf;
	}
});


// Bug ("pulso la c y pasa de mí"): the manage-properties modal silenced read-only
// announcements because it never hosted the live region. It must host it while open
// and restore it to <body> on close.
test('the manage-properties modal hosts the live region while open and restores it on close', () => {
	setAnnouncerHost(null); // ensure a clean starting point
	managePropertiesDialog.open({
		getProperties: () => [{
			index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0,
			mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true,
		}],
		onBuild: () => {}, onSell: () => {}, onMortgage: () => {}, onUnmortgage: () => {},
	});

	const dialog = document.querySelector('dialog.manage-dialog') as HTMLElement;
	assert.ok(dialog, 'the manage dialog is rendered');
	assert.equal(polite().closest('dialog.manage-dialog'), dialog, 'polite region lives inside the open modal');
	assert.equal(assertive().closest('dialog.manage-dialog'), dialog, 'assertive region lives inside the open modal');

	managePropertiesDialog.close();
	assert.equal(polite().parentElement, document.body, 'polite region returns to body on close');
	assert.equal(assertive().parentElement, document.body, 'assertive region returns to body on close');
});

// Bug: an announcement triggered by an in-modal action could be dropped when the modal
// closed (its hosted live region was torn down before the screen reader read it). Closing
// the modal must re-emit a freshly written polite announcement in the restored body region.
const settle = () => new Promise(resolve => setTimeout(resolve, 240));

test('closing a modal re-emits a freshly written polite announcement so it survives teardown', async () => {
	const announce = createAnnouncer();
	const dialog = document.createElement('dialog');
	document.body.appendChild(dialog);
	setAnnouncerHost(dialog);

	announce({ key: '_raw', vars: { text: 'You paid 120 euros' } });
	await settle(); // let the coalesced burst flush into the modal-hosted region
	assert.match(polite().textContent ?? '', /You paid 120 euros/);

	setAnnouncerHost(null);
	assert.equal(polite().parentElement, document.body, 'region is restored to body');
	assert.equal(polite().textContent, '', 'region is cleared before the re-emit');

	await new Promise(resolve => setTimeout(resolve, 10));
	assert.match(polite().textContent ?? '', /You paid 120 euros/, 're-emitted in the body region');
});

test('closing a modal long after the last announcement does not re-read a stale line', async () => {
	const announce = createAnnouncer();
	const dialog = document.createElement('dialog');
	document.body.appendChild(dialog);
	setAnnouncerHost(dialog);

	announce({ key: '_raw', vars: { text: 'An old event' } });
	await settle();
	// Simulate the announcement going stale (older than the recency gate).
	await new Promise(resolve => setTimeout(resolve, 500));

	const before = polite().textContent;
	setAnnouncerHost(null);
	await new Promise(resolve => setTimeout(resolve, 10));
	// A stale line must NOT be actively re-cleared and re-written; the text is left as-is.
	assert.equal(polite().textContent, before);
});

// Bug: stepping past the newest announcement used to speak a boundary message ("you're at
// the latest"). It must instead simply repeat the latest entry.
test('historyNext at the newest boundary repeats the latest entry', async () => {
	const announce = createAnnouncer();
	announce({ key: '_raw', vars: { text: 'First event' } });
	announce({ key: '_raw', vars: { text: 'Second event' } });

	announceHistoryNext(); // -1 -> latest
	await new Promise(resolve => setTimeout(resolve, 30));
	assert.match(assertive().textContent ?? '', /Second event/);

	announceHistoryNext(); // already at latest -> repeat, not a boundary message
	await new Promise(resolve => setTimeout(resolve, 30));
	assert.match(assertive().textContent ?? '', /Second event/);
	assert.ok(!(assertive().textContent ?? '').includes('history_at_latest'));
});

// Bug ("Eric tiró mientras estaba retenido, sin dobles"): a "move" line (the dice roll) is spoken
// immediately, then a "resolve" line that involves NO token movement (staying in holding) is
// released right behind it. Both polite flushes landed inside the clearGapMs window, and
// the second flush cancelled the first's pending write — so JAWS only ever read the second
// line ("Sigues retenido"), silently dropping the dice roll. The two must now MERGE
// into one utterance so both lines are spoken.
test('a second polite flush within the clear gap merges with the first instead of dropping it', async () => {
	const announce = createAnnouncer();

	// First line flushes and schedules its write (clearGapMs away).
	announce({ key: '_raw', vars: { text: 'You rolled 3 + 1 = 4' } });
	// Let the first batch flush run, but stay well inside the clear gap before its write.
	await new Promise(resolve => setTimeout(resolve, 5));
	assert.equal(polite().textContent, '', 'first line not written yet (inside the clear gap)');

	// Second line arrives behind it (no token movement, so it is released immediately).
	announce({ key: '_raw', vars: { text: 'You stay in holding. 2 turns left' } });

	await new Promise(resolve => setTimeout(resolve, 80));
	const spoken = polite().textContent ?? '';
	assert.match(spoken, /You rolled 3 \+ 1 = 4/, 'the dice roll line survives');
	assert.match(spoken, /You stay in holding\. 2 turns left/, 'the holding line is also present');
});

// Live-play ("tedioso de cojones"): when a played card leaves the hand, the screen reader
// reads the newly-focused card FIRST and the polite line describing the player's own action
// queues behind it. An own-action batch must therefore flush through the ASSERTIVE region
// (interrupting that focus reading) while keeping the polite pipeline's ordering, coalescing
// and history.
test('an assertive-flagged line flushes its whole batch through the assertive region, in order', async () => {
	const announce = createAnnouncer();

	announce({ key: '_raw', vars: { text: 'You play Reactor' } }, { assertive: true });
	announce({ key: '_raw', vars: { text: 'You draw 1: Coolant' } });

	await nextFrame();
	assert.equal(assertive().textContent, 'You play Reactor. You draw 1: Coolant.');
	assert.ok(!(polite().textContent ?? '').includes('You play Reactor'), 'the polite region is not used');
});

test('an assertive batch is still recorded in the reviewable history', async () => {
	const announce = createAnnouncer();

	announce({ key: '_raw', vars: { text: 'You place the flux capacitor' } }, { assertive: true });
	await nextFrame();

	announceHistoryLast();
	await nextFrame();
	assert.match(assertive().textContent ?? '', /You place the flux capacitor/);
});

test('the assertive upgrade does not leak into the next (rival) batch', async () => {
	const announce = createAnnouncer();

	announce({ key: '_raw', vars: { text: 'Mine goes loud' } }, { assertive: true });
	await nextFrame();

	announce({ key: '_raw', vars: { text: 'Rival plays quietly' } });
	await new Promise(resolve => setTimeout(resolve, 80)); // flush + clear gap + write
	assert.match(polite().textContent ?? '', /Rival plays quietly/, 'the rival line stays polite');
	assert.ok(!(assertive().textContent ?? '').includes('Rival plays quietly'));
});

// Live-play timing ("primero leo la nueva carta y luego el anuncio"): the turn sequencer
// delivers the announcement and THEN applies the state (which moves focus off the played
// card). If the assertive line only lands on a later tick, the reader voices the new card
// first. flushAnnouncerNow writes the own-action line SYNCHRONOUSLY, so it precedes the move.
test('flushAnnouncerNow writes the own-action line synchronously (ahead of the focus move)', () => {
	const announce = createAnnouncer();

	announce({ key: '_raw', vars: { text: 'You play Sashimi' } }, { assertive: true });
	// Without the fast-track it would wait for the coalesce timer; flushing NOW lands it at once.
	flushAnnouncerNow();
	assert.equal(assertive().textContent, 'You play Sashimi.');
	assert.ok(!(polite().textContent ?? '').includes('Sashimi'), 'the polite region is not used');
});

test('flushAnnouncerNow is a no-op for a polite (rival) batch', () => {
	const announce = createAnnouncer();

	announce({ key: '_raw', vars: { text: 'Rival plays Nigiri' } }); // polite, not own-action
	flushAnnouncerNow();
	assert.ok(!(assertive().textContent ?? '').includes('Nigiri'), 'a rival line is never fast-tracked to assertive');
});


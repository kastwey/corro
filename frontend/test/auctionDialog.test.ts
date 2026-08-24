import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { auctionDialog } from '../src/auctionDialog.js';

// Regression: the auction modal's buttons/labels were built once in init(), which can run
// BEFORE i18next has loaded — leaving them showing raw keys/empty. The fix re-localizes all
// static text on every render(). This test reproduces the timing: build the dialog while
// i18next is absent, THEN load it and open the dialog, and assert the text is localized.

before(() => {
	setupDom();
});

test('open() localizes buttons and labels even when init() ran before i18next loaded', () => {
	// init() runs now, while window.i18next is still undefined (worst-case timing).
	auctionDialog.init();

	// i18next becomes available only afterwards.
	installFakeI18next('en');

	auctionDialog.open({
		squareIndex: 1,
		squareName: 'Main Square',
		currentBid: 0,
		highestBidderName: null,
		secondsRemaining: 20,
		playerMoney: 1500,
		onBid: () => {},
		onPass: () => {},
	});

	const dialog = document.getElementById('auction-dialog')!;
	const bidBtn = dialog.querySelector('.auction-bid-btn')!;
	const passBtn = dialog.querySelector('.auction-pass-btn')!;
	const bidLabel = dialog.querySelector('.auction-dlg-bid-label')!;

	assert.equal(bidBtn.textContent, 'Place Bid');
	assert.equal(passBtn.textContent, 'Pass');
	// Labels must show the translation, never the raw "auction_*" key.
	assert.ok(bidLabel.textContent && bidLabel.textContent.length > 1);
	assert.ok(!bidLabel.textContent!.includes('auction_'));

	auctionDialog.end();
});

test('a subsequent render() re-localizes the title with the current square name', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 3,
		squareName: 'Park Lane',
		currentBid: 0,
		highestBidderName: null,
		secondsRemaining: 20,
		playerMoney: 1500,
		onBid: () => {},
		onPass: () => {},
	});

	const title = document.getElementById('auction-dialog-title')!;
	assert.ok(title.textContent!.includes('Park Lane'));
	assert.ok(!title.textContent!.includes('auction_title'));

	auctionDialog.end();
});

// The auction floats like the bus/trade dialogs: non-modal + minimizable, so the player can
// read the board (owners, prices) before bidding. Escape (handled globally in keys.ts for any
// data-modal="false" dialog carrying syncMinimize) MINIMIZES it to its title bar rather than
// closing, and Ctrl+D re-expands it via the shared 'dialog' panel region.
test('the auction dialog floats (non-modal), draggable and minimizable', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 7, squareName: 'Mayfair', currentBid: 0, highestBidderName: null,
		secondsRemaining: 20, playerMoney: 1500, onBid: () => {}, onPass: () => {},
	});
	const dialog = document.getElementById('auction-dialog') as HTMLDialogElement;
	assert.equal(dialog.open, true);
	assert.equal(dialog.dataset.modal, 'false', 'one more panel, not a focus trap');
	assert.ok(dialog.classList.contains('dialog--draggable'), 'the title bar drags it aside');
	assert.ok(dialog.querySelector('.dialog-minimize'), 'has a minimize button like the other floating dialogs');
	assert.equal(typeof (dialog as any).syncMinimize, 'function', 'exposes syncMinimize for Escape / Ctrl+D');
	auctionDialog.end();
});

// Regression (bug 5 + playtest #12): minimizing must NOT pass — the player stays an active
// bidder — and re-expanding (what Ctrl+D's 'dialog' region does) restores the controls.
test('minimizing the auction keeps the player in it (does not pass) and it can re-expand', () => {
	installFakeI18next('en');
	let passed = false;
	auctionDialog.open({
		squareIndex: 7, squareName: 'Mayfair', currentBid: 0, highestBidderName: null,
		secondsRemaining: 20, playerMoney: 1500, onBid: () => {}, onPass: () => { passed = true; },
	});
	const dialog = document.getElementById('auction-dialog') as HTMLDialogElement;
	const minimizeBtn = dialog.querySelector('.dialog-minimize') as HTMLButtonElement;

	minimizeBtn.click();
	assert.ok(dialog.classList.contains('dialog--minimized'), 'minimize shrinks it to the title bar');
	assert.equal(dialog.open, true, 'it stays OPEN (minimized), not closed');
	assert.equal(passed, false, 'minimizing must NOT pass — the player stays an active bidder');
	assert.equal(auctionDialog.isOpen(), true);

	// Re-expand as the 'dialog' panel region does on Ctrl+D.
	dialog.classList.remove('dialog--minimized');
	(dialog as any).syncMinimize();
	assert.ok(!dialog.classList.contains('dialog--minimized'), 'Ctrl+D restores the full dialog');
	auctionDialog.end();
});

// Regression (live-play): the bid field kept the amount typed in the PREVIOUS auction, so a
// second auction opened proposing e.g. "25" instead of the fresh minimum bid.
test('a fresh open() resets the bid field to the current minimum', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 1, squareName: 'First', currentBid: 0, highestBidderName: null,
		secondsRemaining: 20, playerMoney: 1500, onBid: () => {}, onPass: () => {},
	});
	const input = document.getElementById('auction-bid-input') as HTMLInputElement;
	input.value = '400'; // the player types a big bid, then the auction ends
	auctionDialog.end();

	auctionDialog.open({
		squareIndex: 2, squareName: 'Second', currentBid: 0, highestBidderName: null,
		secondsRemaining: 20, playerMoney: 1500, onBid: () => {}, onPass: () => {},
	});
	assert.equal(input.value, '1', 'the second auction proposes the minimum, not the stale 400');
	auctionDialog.end();
});

// Regression (live-play): a rival's dialog must SHOW a bid pushed via update() — the current
// bid line is state, not open-time decoration.
test('update() refreshes the current bid and bidder on screen', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 1, squareName: 'Main Square', currentBid: 0, highestBidderName: null,
		secondsRemaining: 20, playerMoney: 1500, onBid: () => {}, onPass: () => {},
	});
	const dialog = document.getElementById('auction-dialog')!;

	auctionDialog.update({ currentBid: 25, highestBidderName: 'Ana' });

	assert.ok(dialog.querySelector('.auction-dlg-bid')!.textContent!.includes('25'));
	// The bidder carries its connective ("by Ana"): the reader runs the row together as one
	// line, and a bare name glued to the amount reads as number soup.
	assert.equal(dialog.querySelector('.auction-dlg-bidder')!.textContent, 'by Ana');
	auctionDialog.end();
});

test('an accepted bid reselects the amount only when the bid field already has focus', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 1, squareName: 'Main Square', currentBid: 10, highestBidderName: 'Ana',
		secondsRemaining: 20, playerMoney: 1500, onBid: () => {}, onPass: () => {},
	});
	const input = document.getElementById('auction-bid-input') as HTMLInputElement;
	let selectCalls = 0;
	input.select = () => { selectCalls++; };
	input.focus();
	auctionDialog.update({ currentBid: 25, highestBidderName: 'Berto' });
	assert.equal(selectCalls, 1, 'the next typed bid replaces the accepted amount');

	const board = document.createElement('button');
	document.body.appendChild(board);
	board.focus();
	auctionDialog.update({ currentBid: 40, highestBidderName: 'Ana' });
	assert.equal(document.activeElement, board, 'a rival bid never steals focus from the board');
	assert.equal(selectCalls, 1, 'selection is unnecessary while another surface owns focus');
	board.remove();
	auctionDialog.end();
});

// Prosody (live-play): the reader hears each row as one line, so every row must flow as a
// sentence. The countdown's big visible "20 s" says nothing when read bare — it ships an
// aria-hidden visual plus a screen-reader sentence.
test('the countdown row reads as a full sentence, its bare digits hidden from the reader', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 1, squareName: 'Main Square', currentBid: 0, highestBidderName: null,
		secondsRemaining: 42, playerMoney: 1500, onBid: () => {}, onPass: () => {},
	});
	const dialog = document.getElementById('auction-dialog')!;

	const visual = dialog.querySelector('.auction-dlg-timer-value')!;
	assert.equal(visual.textContent, '42');
	assert.equal(visual.getAttribute('aria-hidden'), 'true');
	assert.equal(dialog.querySelector('.auction-dlg-timer-sr')!.textContent, '42 seconds left to bid');
	auctionDialog.end();
});

// Regression (bug #8): the bid field must select its whole value on focus, so refocusing a
// "100" and typing "150" REPLACES it (→ "150") instead of appending ("100150").
test('the bid field selects its contents on focus, so a new bid overwrites the old amount', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 1, squareName: 'Main Square', currentBid: 100, highestBidderName: 'Ana',
		secondsRemaining: 20, playerMoney: 1500, onBid: () => {}, onPass: () => {},
	});
	const input = document.getElementById('auction-bid-input') as HTMLInputElement;
	let selectCalls = 0;
	input.select = () => { selectCalls++; };
	input.dispatchEvent(new input.ownerDocument.defaultView!.Event('focus'));
	assert.equal(selectCalls, 1, 'focusing the bid field selects all so the next keystrokes overwrite');
	auctionDialog.end();
});

// Project rule: NEVER the native disabled attribute — an unaffordable bid keeps the controls
// focusable (aria-disabled) so a screen-reader user can reach them; submitBid() validates.
test('an unaffordable minimum stays focusable, exposes its reason and announces it on activation', () => {
	installFakeI18next('en');
	const announced: string[] = [];
	auctionDialog.setUnavailableAnnouncer(text => announced.push(text));
	auctionDialog.open({
		squareIndex: 1, squareName: 'Main Square', currentBid: 100, highestBidderName: 'Nuria',
		secondsRemaining: 20, playerMoney: 50, onBid: () => {}, onPass: () => {},
	});
	const input = document.getElementById('auction-bid-input') as HTMLInputElement;
	const bidBtn = document.querySelector('.auction-bid-btn') as HTMLButtonElement;

	assert.equal(input.hasAttribute('disabled'), false);
	assert.equal(bidBtn.hasAttribute('disabled'), false);
	assert.equal(input.getAttribute('aria-disabled'), 'true');
	assert.equal(bidBtn.getAttribute('aria-disabled'), 'true');
	const hint = document.getElementById('auction-bid-unavailable')!;
	assert.equal(hint.hidden, false);
	assert.match(hint.textContent!, /minimum bid.*101.*money.*50/i);
	assert.equal(input.getAttribute('aria-describedby'), hint.id);
	assert.equal(bidBtn.getAttribute('aria-describedby'), hint.id);

	bidBtn.click();
	assert.deepEqual(announced, [hint.textContent]);
	auctionDialog.end();
});

// Regression (issue #23): "reenter auction" is about FOCUS, not about opening. The panel is
// non-modal, so a bidder can be outside it while it is open — Escape parks focus on the board
// and minimizes it, and a dialog that opened behind a modal one never received focus at all.
// The control used to call the OPEN helper, which returns immediately when the dialog is
// already open: it could therefore only ever act on a dialog that wasn't there, which is to
// say never. focus() is the door back in.
test('focus() puts focus back on the bid field of an already-open auction', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 7, squareName: 'Mayfair', currentBid: 0, highestBidderName: null,
		secondsRemaining: 20, playerMoney: 1500, onBid: () => {}, onPass: () => {},
	});
	const input = document.getElementById('auction-bid-input') as HTMLInputElement;
	// The player left for the board, as Escape does.
	const board = document.createElement('div');
	board.id = 'board';
	board.tabIndex = -1;
	document.body.appendChild(board);
	board.focus();
	assert.notEqual(document.activeElement, input);

	assert.equal(auctionDialog.focus(), true, 'it reports that it took focus');
	assert.equal(document.activeElement, input);
	auctionDialog.end();
});

test('focus() expands a minimized auction first, since its controls cannot take focus there', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 7, squareName: 'Mayfair', currentBid: 0, highestBidderName: null,
		secondsRemaining: 20, playerMoney: 1500, onBid: () => {}, onPass: () => {},
	});
	const dialog = document.getElementById('auction-dialog') as HTMLDialogElement;
	(dialog.querySelector('.dialog-minimize') as HTMLButtonElement).click();
	assert.ok(dialog.classList.contains('dialog--minimized'));

	assert.equal(auctionDialog.focus(), true);
	assert.ok(!dialog.classList.contains('dialog--minimized'), 'expanded on the way back in');
	assert.equal(document.activeElement, document.getElementById('auction-bid-input'));
	// The minimize button agrees it is expanded again (it is what a screen reader reads).
	assert.equal(dialog.querySelector('.dialog-minimize')!.getAttribute('aria-expanded'), 'true');
	auctionDialog.end();
});

test('focus() lands on Pass when the player cannot afford the minimum, as a fresh open does', () => {
	installFakeI18next('en');
	auctionDialog.open({
		squareIndex: 7, squareName: 'Mayfair', currentBid: 100, highestBidderName: 'Nuria',
		secondsRemaining: 20, playerMoney: 50, onBid: () => {}, onPass: () => {},
	});
	const passBtn = document.querySelector('.auction-pass-btn') as HTMLButtonElement;
	document.body.focus();

	assert.equal(auctionDialog.focus(), true);
	assert.equal(document.activeElement, passBtn, 'the only thing they can do');
	auctionDialog.end();
});

test('focus() reports false when no auction is open, so the caller can fall back to opening one', () => {
	installFakeI18next('en');
	auctionDialog.end();
	assert.equal(auctionDialog.isOpen(), false);
	assert.equal(auctionDialog.focus(), false);
});

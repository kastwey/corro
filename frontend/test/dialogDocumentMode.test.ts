import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';

// READING dialogs (documentMode: the shortcuts help and the board guide) carry no
// role="application" anywhere inside and no aria-describedby: inside an application NVDA
// never builds a virtual buffer — even browse mode read NOTHING of the help table — and a
// describedby pointing at the whole guide would dump it all on entry. Their initial focus
// goes to the TITLE (tabindex=-1), not the close button, so the screen reader starts
// reading from the top of the document. Game dialogs keep the application buttons row,
// the short description and the focus-first-button behaviour.
// The <dialog> element is REUSED between shows, so the semantics must flip BOTH ways.

let dialogManager: typeof import('../src/dialogManager.js').dialogManager;
let showHelpDialog: typeof import('../src/helpDialog.js').showHelpDialog;
let showBoardHelpDialog: typeof import('../src/boardHelp.js').showBoardHelpDialog;
let showEndScreen: typeof import('../src/endScreen.js').showEndScreen;

before(async () => {
	setupDom();
	installFakeI18next('es');
	({ dialogManager } = await import('../src/dialogManager.js'));
	({ showHelpDialog } = await import('../src/helpDialog.js'));
	({ showBoardHelpDialog } = await import('../src/boardHelp.js'));
	({ showEndScreen } = await import('../src/endScreen.js'));
});

function dialog(): HTMLDialogElement {
	return document.getElementById('game-dialog') as HTMLDialogElement;
}

/** The initial focus is applied on a short timer (50 ms); wait it out. */
const focusSettled = () => new Promise(resolve => setTimeout(resolve, 80));

test('the shortcuts help (Ctrl+F1) opens as a reading dialog: browseable, no application role', async () => {
	showHelpDialog({ c: 'AnnounceCurrentPlayerMoney' });
	const dlg = dialog();
	assert.equal(dlg.open, true);
	assert.ok(dlg.classList.contains('dialog-help'));
	assert.equal(dlg.querySelectorAll('[role="application"]').length, 0,
		'nothing inside the help is wrapped in role="application"');
	assert.equal(dlg.getAttribute('aria-describedby'), null,
		'the help is not its own accessible description (no full-table dump on entry)');
	assert.ok(dlg.querySelector('.help-shortcuts'), 'the shortcuts table rendered');
	// Focus starts at the TITLE — the top of the document — not on the close button.
	const title = dlg.querySelector('.dialog-title') as HTMLElement;
	assert.equal(title.getAttribute('tabindex'), '-1', 'the title is programmatically focusable');
	assert.equal((dlg.querySelector('.dialog-content') as HTMLElement).tabIndex, 0,
		'the scrollable help document has keyboard access');
	await focusSettled();
	assert.equal(document.activeElement, title, 'reading starts at the title');
	dialogManager.close();
});

test('the board guide (F1) is a reading dialog too', async () => {
	showBoardHelpDialog();
	const dlg = dialog();
	assert.equal(dlg.open, true);
	assert.equal(dlg.querySelectorAll('[role="application"]').length, 0);
	assert.equal(dlg.getAttribute('aria-describedby'), null);
	await focusSettled();
	assert.equal(document.activeElement, dlg.querySelector('.dialog-title'));
	dialogManager.close();
});

test('a game dialog on the SAME reused element restores the operating semantics', async () => {
	showHelpDialog({ c: 'AnnounceCurrentPlayerMoney' });
	dialogManager.close();

	dialogManager.showConfirm({
		title: 'Confirmar', message: '¿Seguro?', onConfirm: () => {},
	});
	const dlg = dialog();
	assert.equal(dlg.querySelector('.dialog-buttons')?.getAttribute('role'), 'application',
		'the buttons row is an operating surface again');
	assert.equal(dlg.getAttribute('aria-describedby'), 'game-dialog-content',
		'the short description is back');
	const title = dlg.querySelector('.dialog-title') as HTMLElement;
	assert.equal(title.getAttribute('tabindex'), null, 'the title is no longer a focus stop');
	assert.equal((dlg.querySelector('.dialog-content') as HTMLElement).getAttribute('tabindex'), null,
		'the reused short message is not an extra tab stop');
	await focusSettled();
	assert.equal((document.activeElement as HTMLElement).tagName, 'BUTTON',
		'an operating dialog starts on its first button');
	dialogManager.close();
});

// LAST on purpose: showEndScreen has a module-level once-guard, so it can only run once
// per process.
test('the END SCREEN is a reading dialog too (banner + standings must be browseable)', async () => {
	showEndScreen({
		winnerId: 'A', winnerName: 'Ana', isGameOver: true,
		players: [
			{ id: 'A', name: 'Ana', finishPlace: 1 },
			{ id: 'B', name: 'Berto', finishPlace: 2 },
		],
	} as any, 'B');
	const dlg = dialog();
	assert.equal(dlg.open, true);
	assert.ok(dlg.classList.contains('dialog-end-screen'));
	assert.equal(dlg.querySelectorAll('[role="application"]').length, 0,
		'NVDA must build a browse buffer: who won and the standings are there to READ');
	assert.equal(dlg.getAttribute('aria-describedby'), null);
	await focusSettled();
	assert.equal(document.activeElement, dlg.querySelector('.dialog-title'),
		'reading starts at the title, not on the back-home button');
	assert.ok(dlg.querySelector('.end-screen__standings'), 'the standings table rendered');
});

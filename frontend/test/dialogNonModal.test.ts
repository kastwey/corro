import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';

// Non-modal dialogs (modal: false — the race piece choice): they take focus but do NOT
// trap it, the body-hosted live region keeps working (the page never goes inert), and a
// MODAL dialog (help, a confirm) can open OVER one and closing it leaves the non-modal
// dialog standing. They render in a SEPARATE <dialog> element for exactly that reason.

let dialogManager: typeof import('../src/dialogManager.js').dialogManager;
let createAnnouncer: typeof import('../src/announcer.js').createAnnouncer;

before(async () => {
	setupDom();
	installFakeI18next('es');
	({ dialogManager } = await import('../src/dialogManager.js'));
	({ createAnnouncer } = await import('../src/announcer.js'));
	createAnnouncer(); // live regions in <body>
});

function polite() { return document.getElementById('sr-live')!; }

test('modal: false opens a separate non-modal dialog flagged with data-modal="false"', () => {
	dialogManager.show({
		title: 'Elige ficha',
		modal: false,
		buttons: [{ label: 'Nave 1', action: () => {} }],
	});

	const dlg = document.getElementById('game-dialog-nonmodal') as HTMLDialogElement;
	assert.ok(dlg, 'the non-modal dialog element exists');
	assert.equal(dlg.open, true, 'it is open');
	assert.equal(dlg.dataset.modal, 'false', 'flagged non-modal for the keyboard layer and CSS');
	// The title is the dialog's accessible NAME, so screen readers announce the reason
	// for the dialog when focus enters it (there is no focus trap holding you inside).
	const titleId = dlg.getAttribute('aria-labelledby');
	assert.ok(titleId, 'the dialog has aria-labelledby');
	const titleEl = document.getElementById(titleId!);
	assert.equal(titleEl?.closest('dialog'), dlg, 'aria-labelledby resolves inside this dialog');
	assert.equal(titleEl?.textContent, 'Elige ficha', 'the accessible name is the title');
	// An explicit description (the content div, WITHOUT the buttons) keeps NVDA from
	// dumping every option button when focus enters the dialog.
	const descId = dlg.getAttribute('aria-describedby');
	assert.ok(descId, 'the dialog has aria-describedby');
	const descEl = document.getElementById(descId!);
	assert.equal(descEl?.classList.contains('dialog-content'), true, 'described by the content, not the buttons');
	assert.equal(descEl?.querySelector('button'), null, 'the description holds no buttons');
	const modal = document.getElementById('game-dialog') as HTMLDialogElement | null;
	assert.ok(!modal?.open, 'the modal singleton stays closed');
	dialogManager.closeNonModal();
});

test('a non-modal dialog leaves the announcer live region hosted in <body>', () => {
	dialogManager.show({
		title: 'Elige ficha',
		modal: false,
		buttons: [{ label: 'Nave 1', action: () => {} }],
	});

	assert.equal(polite().parentElement, document.body,
		'the page is not inert, so the live region must stay in <body>');
	dialogManager.closeNonModal();
});

test('a modal dialog can open OVER a non-modal one and closing it leaves the choice standing', () => {
	dialogManager.show({
		title: 'Elige ficha',
		modal: false,
		buttons: [{ label: 'Nave 1', action: () => {} }],
	});
	dialogManager.show({
		title: 'Ayuda',
		buttons: [{ label: 'Cerrar', action: () => dialogManager.close() }],
	});

	const nonModal = document.getElementById('game-dialog-nonmodal') as HTMLDialogElement;
	const modal = document.getElementById('game-dialog') as HTMLDialogElement;
	assert.equal(modal.open, true, 'the modal (help) is open');
	assert.equal(nonModal.open, true, 'the piece choice is still open underneath');

	dialogManager.close();
	assert.equal(modal.open, false, 'the modal closed');
	assert.equal(nonModal.open, true, 'the piece choice survives the modal round-trip');
	dialogManager.closeNonModal();
	assert.equal(nonModal.open, false);
});

test('re-showing a non-modal dialog re-renders its content in place', () => {
	dialogManager.show({
		title: 'Mueve 5',
		modal: false,
		buttons: [{ label: 'Nave 1', action: () => {} }],
	});
	dialogManager.show({
		title: 'Mueve 20',
		modal: false,
		buttons: [{ label: 'Nave 2', action: () => {} }, { label: 'Nave 3', action: () => {} }],
	});

	const dlg = document.getElementById('game-dialog-nonmodal') as HTMLDialogElement;
	assert.equal(dlg.open, true);
	assert.equal(dlg.querySelector('.dialog-title')!.textContent, 'Mueve 20');
	assert.equal(dlg.querySelectorAll('.dialog-buttons button').length, 2);
	dialogManager.closeNonModal();
});

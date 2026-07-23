import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { boardToast } from '../src/boardToast.js';

before(() => setupDom());

function resetBoard(): HTMLElement {
	document.body.innerHTML = '<div id="board"><div class="board-center" aria-hidden="true"></div></div>';
	return document.querySelector('.board-center') as HTMLElement;
}

test('show renders an explicit error with the requested tone and no accessible duplicate', () => {
	const center = resetBoard();
	boardToast.show('No es tu turno', 'loss');

	const toast = center.querySelector('.board-toast') as HTMLElement | null;
	assert.ok(toast);
	assert.equal(toast.getAttribute('aria-hidden'), 'true');
	assert.ok(toast.classList.contains('board-toast--show'));
	assert.ok(toast.classList.contains('board-toast--loss'));
	assert.equal(toast.textContent, 'No es tu turno');
});

test('show with empty text creates no toast', () => {
	const center = resetBoard();
	boardToast.show('', 'loss');
	assert.equal(center.querySelector('.board-toast'), null);
});

test('back-to-back explicit cues replace text and tone instead of stacking', () => {
	const center = resetBoard();
	boardToast.show('Acción rechazada', 'loss');
	boardToast.show('Casilla no encontrada', 'neutral');

	const toast = center.querySelector('.board-toast') as HTMLElement;
	assert.equal(toast.textContent, 'Casilla no encontrada');
	assert.ok(toast.classList.contains('board-toast--neutral'));
	assert.ok(!toast.classList.contains('board-toast--loss'));
});

test('the error host is recreated after the board center is rendered again', () => {
	resetBoard();
	boardToast.show('Primero', 'loss');
	const fresh = resetBoard();
	boardToast.show('Segundo', 'loss');
	assert.equal(fresh.querySelector('.board-toast')?.textContent, 'Segundo');
});

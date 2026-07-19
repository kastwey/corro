import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { boardToast, toastToneForAnnouncement } from '../src/boardToast.js';

before(() => {
	setupDom();
	installFakeI18next('es');
});

// ── Pure decision: which announcements toast and with what tone ──

test('money-out and setbacks are loss-toned (base and first-person variant)', () => {
	assert.equal(toastToneForAnnouncement('game.rent_paid'), 'loss');
	assert.equal(toastToneForAnnouncement('game.rent_paid_self'), 'loss');
	assert.equal(toastToneForAnnouncement('game.tax_paid'), 'loss');
	assert.equal(toastToneForAnnouncement('game.paid_repairs'), 'loss');
	assert.equal(toastToneForAnnouncement('game.send_to_holding'), 'loss');
	assert.equal(toastToneForAnnouncement('game.player_bankrupt'), 'loss');
});

test('money-in and milestones are gain-toned', () => {
	assert.equal(toastToneForAnnouncement('game.passed_through_go'), 'gain');
	assert.equal(toastToneForAnnouncement('game.passed_through_go_self'), 'gain');
	assert.equal(toastToneForAnnouncement('game.free_parking_collect'), 'gain');
	assert.equal(toastToneForAnnouncement('game.group_completed'), 'gain');
	assert.equal(toastToneForAnnouncement('game.game_over'), 'gain');
});

test('clearing all debt is gain-toned (base and first-person variant)', () => {
	assert.equal(toastToneForAnnouncement('game.debt_cleared'), 'gain');
	assert.equal(toastToneForAnnouncement('game.debt_cleared_self'), 'gain');
});

test('acquisitions and building are neutral-toned', () => {
	assert.equal(toastToneForAnnouncement('game.property_purchased'), 'neutral');
	assert.equal(toastToneForAnnouncement('game.auction_won'), 'neutral');
	assert.equal(toastToneForAnnouncement('game.building_built'), 'neutral');
	assert.equal(toastToneForAnnouncement('game.buildings_sold'), 'neutral');
});

test('mortgaging, unmortgaging and completed trades are neutral-toned (base and first-person)', () => {
	assert.equal(toastToneForAnnouncement('game.property_mortgaged'), 'neutral');
	assert.equal(toastToneForAnnouncement('game.property_mortgaged_self'), 'neutral');
	assert.equal(toastToneForAnnouncement('game.property_unmortgaged'), 'neutral');
	assert.equal(toastToneForAnnouncement('game.property_unmortgaged_self'), 'neutral');
	assert.equal(toastToneForAnnouncement('game.trade_completed'), 'neutral');
});

test('frequent chatter and unknown keys never toast', () => {
	assert.equal(toastToneForAnnouncement('game.dice_rolled'), null);
	assert.equal(toastToneForAnnouncement('game.turn_of'), null);
	assert.equal(toastToneForAnnouncement('game.landed_on_property'), null);
	assert.equal(toastToneForAnnouncement(''), null);
});

// ── DOM behaviour: hosting, text, tone class and aria-hidden ──

function resetBoard(): HTMLElement {
	document.body.innerHTML = '<div id="board"><div class="board-center" aria-hidden="true"></div></div>';
	return document.querySelector('.board-center') as HTMLElement;
}

test('a rent toast renders the server phrase, loss tone and aria-hidden in the board center', () => {
	const center = resetBoard();

	boardToast.playForAnnouncement('game.rent_paid', { player: 'Ana', amount: 50, landlord: 'Luis' });

	const toast = center.querySelector('.board-toast') as HTMLElement | null;
	assert.ok(toast, 'toast host should be created inside the board center');
	assert.equal(toast!.getAttribute('aria-hidden'), 'true');
	assert.ok(toast!.classList.contains('board-toast--show'));
	assert.ok(toast!.classList.contains('board-toast--loss'));
	assert.equal(toast!.textContent, 'Ana paga 50 euros de alquiler a Luis');
});

test('the first-person variant uses the personalized phrase', () => {
	const center = resetBoard();

	boardToast.playForAnnouncement('game.rent_paid_self', { amount: 120, landlord: 'Luis' });

	const toast = center.querySelector('.board-toast') as HTMLElement;
	assert.equal(toast.textContent, 'Pagaste 120 euros de alquiler a Luis');
});

test('a per-locale square-name var is resolved, not shown as [object Object] (bug #1)', () => {
	const center = resetBoard();

	// A package board sends the square name as a { locale: text } map (as the spoken line receives it).
	boardToast.playForAnnouncement('game.property_purchased', {
		player: 'Ana',
		property: { es: 'Acería Tubal', en: 'Tubal Steelworks' },
		price: 300,
		currencyName: 'créditos',
	});

	const toast = center.querySelector('.board-toast') as HTMLElement;
	assert.ok(toast.textContent!.includes('Acería Tubal'), toast.textContent!);
	assert.ok(!toast.textContent!.includes('object Object'), 'must not leak the raw name object');
});

test('back-to-back toasts swap the tone class instead of stacking it', () => {
	const center = resetBoard();

	boardToast.playForAnnouncement('game.rent_paid', { player: 'Ana', amount: 50, landlord: 'Luis' });
	boardToast.playForAnnouncement('game.passed_through_go', { player: 'Ana', amount: 200 });

	const toast = center.querySelector('.board-toast') as HTMLElement;
	assert.ok(toast.classList.contains('board-toast--gain'));
	assert.ok(!toast.classList.contains('board-toast--loss'));
});

test('a non-toast announcement creates no toast', () => {
	const center = resetBoard();

	boardToast.playForAnnouncement('game.dice_rolled', { player: 'Ana', total: 7 });

	assert.equal(center.querySelector('.board-toast'), null);
});

test('the toast host is re-created after the board center is re-rendered', () => {
	boardToast.playForAnnouncement('game.rent_paid', { player: 'Ana', amount: 50, landlord: 'Luis' });
	// Simulate a full board re-render that replaces the center (detaches the old host).
	const fresh = resetBoard();

	boardToast.playForAnnouncement('game.rent_paid', { player: 'Eva', amount: 80, landlord: 'Luis' });

	const toast = fresh.querySelector('.board-toast') as HTMLElement;
	assert.equal(toast.textContent, 'Eva paga 80 euros de alquiler a Luis');
});

// ── show(): explicit, already-translated one-off cues (server error / invalid square) ──

test('show renders explicit text with the requested tone, aria-hidden, in the center', () => {
	const center = resetBoard();

	boardToast.show('No es tu turno', 'loss');

	const toast = center.querySelector('.board-toast') as HTMLElement | null;
	assert.ok(toast, 'toast host should be created');
	assert.equal(toast!.getAttribute('aria-hidden'), 'true');
	assert.ok(toast!.classList.contains('board-toast--show'));
	assert.ok(toast!.classList.contains('board-toast--loss'));
	assert.equal(toast!.textContent, 'No es tu turno');
});

test('show with empty text creates no toast', () => {
	const center = resetBoard();

	boardToast.show('', 'loss');

	assert.equal(center.querySelector('.board-toast'), null);
});

test('show swaps the tone class on back-to-back cues instead of stacking it', () => {
	const center = resetBoard();

	boardToast.show('Acción rechazada', 'loss');
	boardToast.show('Casilla no encontrada', 'neutral');

	const toast = center.querySelector('.board-toast') as HTMLElement;
	assert.equal(toast.textContent, 'Casilla no encontrada');
	assert.ok(toast.classList.contains('board-toast--neutral'));
	assert.ok(!toast.classList.contains('board-toast--loss'));
});

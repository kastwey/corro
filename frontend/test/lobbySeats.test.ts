import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { renderSeatSelector, getUsedSeats, installTakenGuard } from '../src/lobby/seats.js';
import type { LobbySeatInfo, LobbyPlayer } from '../src/models.js';

/**
 * The lobby's race seat picker: seats render as an exclusive radio group, taken seats say
 * WHO holds them and stay focusable (accessible unavailability — the `disabled` attribute
 * is forbidden in this codebase), and the change guard bounces any attempt to grab a taken
 * seat back to a free one so the form can never submit somebody else's colour.
 */

before(() => setupDom());

const SEATS: LobbySeatInfo[] = [
	{ id: 'rojo', color: '#e00', nameKey: 'seats.rojo' },
	{ id: 'azul', color: '#00e', nameKey: 'seats.azul' },
	{ id: 'verde', color: '#0a0', nameKey: 'seats.verde' },
];

const t = (key: string, fallback?: string) => fallback ?? key;

/** jsdom requires ITS OWN Event constructor, not Node's global one. */
const changeEvent = () => new (globalThis as any).window.Event('change', { bubbles: true });

function render(used?: Map<string, string>): HTMLElement {
	document.body.innerHTML = '';
	const ul = document.createElement('ul');
	document.body.appendChild(ul);
	renderSeatSelector(ul, SEATS, t, used);
	return ul;
}

function radios(ul: HTMLElement): HTMLInputElement[] {
	return Array.from(ul.querySelectorAll<HTMLInputElement>('input[name="seat"]'));
}

test('renders every seat and auto-selects the first free one', () => {
	const ul = render(new Map([['rojo', 'Ana']]));
	const rs = radios(ul);
	assert.equal(rs.length, 3);
	assert.equal(rs.find(r => r.checked)?.value, 'azul', 'rojo is taken, azul is the first free');
});

test('a taken seat is aria-disabled and says who holds it — but is NEVER disabled', () => {
	const ul = render(new Map([['rojo', 'Ana']]));
	const rojo = radios(ul).find(r => r.value === 'rojo')!;
	assert.equal(rojo.getAttribute('aria-disabled'), 'true');
	assert.equal(rojo.disabled, false, 'the disabled attribute is forbidden: the option must stay focusable');
	const label = rojo.closest('label')!;
	assert.match(label.textContent!, /\(taken by Ana\)/);
});

test('selecting a taken seat bounces back to the previous valid pick', () => {
	const ul = render(new Map([['rojo', 'Ana']]));
	const rs = radios(ul);
	const verde = rs.find(r => r.value === 'verde')!;
	const rojo = rs.find(r => r.value === 'rojo')!;

	verde.checked = true;
	verde.dispatchEvent(changeEvent());
	rojo.checked = true;
	rojo.dispatchEvent(changeEvent());

	assert.equal(rojo.checked, false, 'the taken seat cannot hold the selection');
	assert.equal(verde.checked, true, 'the selection returns to the previous valid pick');
});

test('getUsedSeats maps seatId to the holding player name (players without a seat are skipped)', () => {
	const players = [
		{ id: '1', name: 'Ana', seatId: 'rojo' },
		{ id: '2', name: 'Berto', seatId: null },
	] as unknown as LobbyPlayer[];
	const used = getUsedSeats(players);
	assert.equal(used.get('rojo'), 'Ana');
	assert.equal(used.size, 1);
});

test('the guard also protects the token selector pattern (data-taken on any radio group)', () => {
	document.body.innerHTML = '';
	const ul = document.createElement('ul');
	document.body.appendChild(ul);
	ul.innerHTML = `
		<li><label><input type="radio" name="token" value="a" checked></label></li>
		<li><label><input type="radio" name="token" value="b" data-taken="1" aria-disabled="true"></label></li>`;
	installTakenGuard(ul);
	const taken = ul.querySelector<HTMLInputElement>('input[value="b"]')!;
	taken.checked = true;
	taken.dispatchEvent(changeEvent());
	assert.equal(taken.checked, false);
	assert.equal(ul.querySelector<HTMLInputElement>('input[value="a"]')!.checked, true);
});

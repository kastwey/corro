import test from 'node:test';
import assert from 'node:assert/strict';
import { busDestinationLabel } from '../src/busChoice.js';
import type { Square } from '../src/models.js';

const t = (key: string, vars: Record<string, any> = {}) => {
	if (key === 'game.bus_color_suffix_colored') return ` (${vars.colorKey})`;
	if (key === 'game.bus_owner_self') return 'yours';
	if (key === 'game.bus_owner_other') return `owned by ${vars.owner}`;
	if (key === 'game.bus_owner_unowned') return 'unowned';
	if (key === 'game.bus_dest_buildings') return `${vars.count} domes`;
	if (key === 'game.bus_dest_big_building') return 'city';
	if (key === 'game.bus_rent_due') return `pay ${vars.amount}`;
	return key;
};

test('Bus option prefers the client-localized square and composes ownership, buildings and rent', () => {
	const squares = [
		{ id: 0, name: 'Start' },
		{ id: 1, name: 'Mina Ferro', type: 'property', price: 100, ownerId: 'b', smallBuildings: 3 },
	] as Square[];
	const label = busDestinationLabel('Iron Mine', 'groups.brown', 1, {
		fromPosition: 0,
		squares,
		players: [{ id: 'b', name: 'Berto' }],
		myId: 'a',
		t,
	}, 80);

	assert.equal(label, 'Mina Ferro (groups.brown), owned by Berto, 3 domes, pay 80');
});

test('Bus option identifies my own big-building destination without a rent line', () => {
	const squares = [
		{ id: 0, name: 'Start' },
		{ id: 1, name: 'Capital', type: 'property', price: 100, ownerId: 'a', bigBuildings: 1 },
	] as Square[];
	const label = busDestinationLabel(undefined, undefined, 1, {
		fromPosition: 0, squares, players: [], myId: 'a', t,
	});
	assert.equal(label, 'Capital, yours, city');
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupSquareIndex } from '../src/groupKeys.js';

test('squares are bucketed by group in ascending board order', () => {
	// Order is what makes "next brown" and "previous brown" walk the board the way the player
	// sees it, so it is part of the contract, not an accident of iteration.
	const index = buildGroupSquareIndex([
		{ color: 'brown' }, { color: 'blue' }, { color: 'brown' }, { color: 'blue' }, { color: 'brown' },
	]);

	assert.deepEqual(index.get('brown'), [0, 2, 4]);
	assert.deepEqual(index.get('blue'), [1, 3]);
});

test('casing and punctuation collapse, but a different WORD is a different group', () => {
	// Packages write their groups freely, so "Brown", "brown" and "BROWN" must be one navigation
	// target. "dark-brown" is not a spelling of "brown" — it is the board's own separate group,
	// and merging the two would make "next brown" stop on squares the player never asked for.
	const index = buildGroupSquareIndex([
		{ color: 'Brown' }, { color: 'brown' }, { color: 'dark-brown' }, { color: 'BROWN' },
	]);

	assert.deepEqual(index.get('brown'), [0, 1, 3]);
	assert.deepEqual(index.get('darkbrown'), [2]);
	assert.equal(index.size, 2);
});

test('squares that belong to no group are simply absent', () => {
	// Corners, taxes and card squares have no colour and must not create an empty bucket that
	// group navigation would then offer as a destination.
	const index = buildGroupSquareIndex([
		{}, { color: 'brown' }, { color: undefined }, { color: '' },
	]);

	assert.deepEqual([...index.keys()], ['brown']);
	assert.deepEqual(index.get('brown'), [1]);
});

test('a colour with no letters names no group', () => {
	// A hex-only group ("#123456") normalizes to the empty string. Bucketing it would create a
	// nameless group the player can never ask for — and would swallow every other hex group with it.
	const index = buildGroupSquareIndex([
		{ color: '#123456' }, { color: '###' }, { color: 'red' },
	]);

	assert.deepEqual([...index.keys()], ['red']);
	assert.equal(index.has(''), false);
});

test('an empty board yields an empty index rather than throwing', () => {
	assert.equal(buildGroupSquareIndex([]).size, 0);
});

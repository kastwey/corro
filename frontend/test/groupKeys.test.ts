import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupKeyMap } from '../src/groupKeys.js';

test('a group with a key gets forward + reverse GroupNext shortcuts (with its name key)', () => {
	const map = buildGroupKeyMap([{ id: 'brown', color: 'brown', colorName: 'game.color_brown', key: 'b' }]);
	assert.deepEqual(map['b'], { cmd: 'GroupNext', args: { group: 'brown', nameKey: 'game.color_brown' } });
	assert.deepEqual(map['shift+b'], { cmd: 'GroupNext', args: { group: 'brown', nameKey: 'game.color_brown', forward: false } });
});

test('keys are lowercased and a hex colour passes through verbatim', () => {
	const map = buildGroupKeyMap([{ id: 'g1', color: '#8a5a2b', colorName: 'groups.g1', key: 'P' }]);
	assert.ok(map['p'], 'uppercase P is normalized to p');
	assert.equal((map['p'] as { args: { group: string } }).args.group, '#8a5a2b');
});

test('groups without a key or without a colour contribute nothing; undefined is empty', () => {
	assert.deepEqual(buildGroupKeyMap(undefined), {});
	assert.deepEqual(buildGroupKeyMap([
		{ id: 'transit', color: 'transit' }, // no key -> navigated by the type-based s/k keys instead
		{ id: 'x', key: 'z' },               // no colour -> nothing to match
	]), {});
});

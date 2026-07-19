import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStatusMessage, type GroupStatusContext } from '../src/groupStatus.js';
import type { Square } from '../src/models.js';

/**
 * Pure-logic tests for the buy-prompt group-ownership hint. They pin the two things the integration
 * can't: that PACKAGE words (groupMember.*, the group name key) resolve via `pkg` (top-level) while
 * the TEMPLATES + fallbacks go through `t` (game-prefixed) — the exact split a regression broke — and
 * that none/some/other, the count/total, the gender context and the generic fallback are all correct.
 */

function sq(p: Partial<Square>): Square {
	return { id: 0, name: '', x: 0, y: 0, ...p } as Square;
}

interface Recorder extends GroupStatusContext {
	calls: { key: string; vars?: Record<string, any> }[];
}

// `pkg` resolves from a map (a missing key returns the key, exercising the generic fallback). `t`
// records every template/fallback call and returns the key so callers can assert what was rendered.
function ctx(pkgMap: Record<string, string>, overrides: Partial<GroupStatusContext> = {}): Recorder {
	const calls: { key: string; vars?: Record<string, any> }[] = [];
	return {
		squares: [],
		players: [],
		myId: 'me',
		t: (key, vars) => { calls.push({ key, vars }); return key; },
		pkg: (k) => pkgMap[k] ?? k,
		calls,
		...overrides,
	};
}

const GALACTIC = {
	'groupMember.utility': 'central',
	'groupMemberPlural.utility': 'centrales',
	'groupMemberGender.utility': 'f',
	'groups.utility': 'Suministros',
};

const utilityTarget = sq({ id: 12, name: 'Central de Antimateria', key: 'utility', price: 150, groupNameKey: 'groups.utility' });
const utilityOther = (over: Partial<Square> = {}) => sq({ id: 28, name: 'Soporte Vital', key: 'utility', price: 150, ...over });

test('none owned: uses the package member noun + gender (pkg), not the generic fallback', () => {
	const c = ctx(GALACTIC, { squares: [utilityTarget, utilityOther()] });
	groupStatusMessage(utilityTarget, c);

	const none = c.calls.find(x => x.key === 'group_member_none');
	assert.ok(none, 'should render group_member_none');
	assert.equal(none!.vars!.member, 'central');      // came from pkg(groupMember.utility), proving the split
	assert.equal(none!.vars!.context, 'f');           // gender from pkg -> i18next context
	assert.equal(none!.vars!.group, 'Suministros');   // group name key resolved via pkg
	assert.equal(none!.vars!.total, 2);
	assert.ok(!c.calls.some(x => x.key === 'property_generic'), 'must not hit the generic fallback');
});

test('I own one: group_member_some with count/total and the plural noun', () => {
	const c = ctx(GALACTIC, { squares: [utilityTarget, utilityOther({ ownerId: 'me' })] });
	groupStatusMessage(utilityTarget, c);

	const some = c.calls.find(x => x.key === 'group_member_some');
	assert.ok(some);
	assert.equal(some!.vars!.count, 1);
	assert.equal(some!.vars!.total, 2);
	assert.equal(some!.vars!.memberPlural, 'centrales');
	assert.ok(!c.calls.some(x => x.key === 'group_member_none'));
});

test('a rival owns some: appends group_member_other with the rival and count', () => {
	const c = ctx(GALACTIC, {
		squares: [utilityTarget, utilityOther({ ownerId: 'p2' })],
		players: [{ id: 'p2', name: 'Ana' }],
	});
	groupStatusMessage(utilityTarget, c);

	const other = c.calls.find(x => x.key === 'group_member_other');
	assert.ok(other);
	assert.equal(other!.vars!.player, 'Ana');
	assert.equal(other!.vars!.count, 1);
	assert.equal(other!.vars!.memberPlural, 'centrales');
});

test('a board without member nouns falls back to the generic noun via t (not a leaked key)', () => {
	// pkg only knows the group name; groupMember.* are absent -> generic fallback through t.
	const c = ctx({ 'groups.brown': 'Marrón' }, {
		squares: [
			sq({ id: 1, name: 'A', key: 'brown', price: 60, groupNameKey: 'groups.brown' }),
			sq({ id: 3, name: 'B', key: 'brown', price: 60 }),
		],
	});
	groupStatusMessage(sq({ id: 1, name: 'A', key: 'brown', price: 60, groupNameKey: 'groups.brown' }), c);

	const none = c.calls.find(x => x.key === 'group_member_none');
	assert.ok(none);
	assert.equal(none!.vars!.member, 'property_generic'); // resolved via t fallback, never the raw key
	assert.equal(none!.vars!.group, 'Marrón');
});

test('not a group/ownable square (or a group of one) says nothing', () => {
	const c = ctx(GALACTIC);
	assert.equal(groupStatusMessage(undefined, c), '');
	assert.equal(groupStatusMessage(sq({ id: 0, name: 'GO', type: 'corner' }), c), '');            // no key/price
	assert.equal(groupStatusMessage(sq({ id: 4, name: 'Tax', type: 'tax', key: undefined }), c), ''); // no key
	// ownable but the only one of its group -> nothing to compare
	const lone = sq({ id: 9, name: 'Solo', key: 'g9', price: 100 });
	assert.equal(groupStatusMessage(lone, { ...ctx(GALACTIC), squares: [lone] }), '');
});

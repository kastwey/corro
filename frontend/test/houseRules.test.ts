import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { renderHouseRules, readHouseRuleValues } from '../src/houseRules.js';

const tr = (k: string) => (({
	'rules.group.money': 'Money',
	'rules.passStartBonus': 'Salary',
	'rules.finesToCenterPot': 'Fines to pot',
}) as Record<string, string>)[k] ?? k;

before(() => setupDom());

test('renderHouseRules renders editable rules grouped, with package labels + data attrs', () => {
	const html = renderHouseRules(
		[{ id: 'money', nameKey: 'rules.group.money' }],
		[
			{ id: 'passStartBonus', group: 'money', type: 'number', default: 200, min: 0, max: 1000, step: 50, editableByHost: true, nameKey: 'rules.passStartBonus' },
			{ id: 'finesToCenterPot', group: 'money', type: 'toggle', default: true, editableByHost: true, nameKey: 'rules.finesToCenterPot' },
		], tr);

	assert.match(html, /<legend>Money<\/legend>/);
	assert.match(html, /Salary/);
	assert.match(html, /data-rule-id="passStartBonus"/);
	assert.match(html, /value="200"/);
	assert.match(html, /data-rule-id="finesToCenterPot"/);
	assert.match(html, /type="checkbox"[^>]*checked|checked/); // default true -> checked
});

test('renderHouseRules omits non-editable rules (and returns "" when none)', () => {
	assert.equal(renderHouseRules([], [{ id: 'x', type: 'toggle', editableByHost: false }], tr), '');
});

test('renderHouseRules escapes labels (package content is untrusted)', () => {
	const html = renderHouseRules([], [{ id: 'x', type: 'toggle', editableByHost: true, nameKey: 'x' }],
		() => '<img src=x onerror=alert(1)>');
	assert.doesNotMatch(html, /<img/);
});

test('readHouseRuleValues reads checkboxes (bool) and numbers', () => {
	const c = document.createElement('div');
	c.innerHTML = renderHouseRules(
		[{ id: 'money', nameKey: 'rules.group.money' }],
		[
			{ id: 'passStartBonus', group: 'money', type: 'number', default: 200, editableByHost: true, nameKey: 'rules.passStartBonus' },
			{ id: 'finesToCenterPot', group: 'money', type: 'toggle', default: true, editableByHost: true, nameKey: 'rules.finesToCenterPot' },
		], tr);

	const values = readHouseRuleValues(c);
	assert.equal(values.passStartBonus, 200);
	assert.equal(values.finesToCenterPot, true);
});

// A "choice" rule renders a radio group (mutually exclusive), the default pre-selected,
// and reads back the SELECTED option id as a string.
test('renderHouseRules renders a choice as a radio group with the default checked', () => {
	const html = renderHouseRules([], [{
		id: 'stacking', type: 'choice', default: 'sameType', editableByHost: true, nameKey: 'stacking',
		options: [
			{ id: 'none', nameKey: 'opt.none' },
			{ id: 'sameType', nameKey: 'opt.same' },
			{ id: 'cross', nameKey: 'opt.cross' },
		],
	}], k => k);

	assert.match(html, /<fieldset[^>]*class="[^"]*rule-choice/);
	assert.match(html, /type="radio"[^>]*name="rule-stacking"/);
	// Exactly one radio is checked, and it is the default option.
	const checked = html.match(/value="([^"]+)"[^>]*checked/);
	assert.ok(checked && checked[1] === 'sameType', 'the default option is pre-selected');
	assert.equal((html.match(/checked/g) ?? []).length, 1);
});

test('readHouseRuleValues reads a choice back as the selected option id (string)', () => {
	const c = document.createElement('div');
	c.innerHTML = renderHouseRules([], [{
		id: 'stacking', type: 'choice', default: 'none', editableByHost: true, nameKey: 'stacking',
		options: [{ id: 'none' }, { id: 'sameType' }, { id: 'cross' }],
	}], k => k);
	// Move the selection to "cross".
	const cross = c.querySelector<HTMLInputElement>('input[value="cross"]')!;
	cross.checked = true;

	assert.equal(readHouseRuleValues(c).stacking, 'cross');
});

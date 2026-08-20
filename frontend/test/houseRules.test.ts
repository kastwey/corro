import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import {
	renderHouseRules, readHouseRuleValues, syncHouseRuleVisibility, watchHouseRuleVisibility,
} from '../src/houseRules.js';

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

	assert.match(html, /<legend><span data-i18n="rules\.group\.money">Money<\/span><\/legend>/);
	assert.match(html, /Salary/);
	assert.match(html, /data-rule-id="passStartBonus"/);
	assert.match(html, /value="200"/);
	assert.match(html, /data-rule-id="finesToCenterPot"/);
	assert.match(html, /type="checkbox"[^>]*checked|checked/); // default true -> checked
});

// A package's words arrive AFTER its rule catalogue does, and this panel is built once. Without a
// key on each label the first paint froze, and the table showed a rulebook written in identifiers
// ("rules.passStartBonus") — reported from a real session. Two guarantees: every label carries the
// key it was built from, and an unresolved key is shown as the readable id rather than raw.
test('every label carries its key, so a late translation resolves it in place', () => {
	const html = renderHouseRules(
		[{ id: 'money', nameKey: 'rules.group.money' }],
		[
			{ id: 'passStartBonus', group: 'money', type: 'number', default: 200, editableByHost: true, nameKey: 'rules.passStartBonus' },
			{ id: 'stacking', type: 'choice', default: 'none', editableByHost: true, nameKey: 'rules.stacking',
				options: [{ id: 'none', nameKey: 'opt.none' }] },
		], tr);

	assert.match(html, /<span data-i18n="rules\.group\.money">Money<\/span>/);
	assert.match(html, /<span data-i18n="rules\.passStartBonus">Salary<\/span>/);
	assert.match(html, /data-i18n="rules\.stacking"/, 'a choice legend carries its key too');
	assert.match(html, /data-i18n="opt\.none"/, 'and so does each option');
});

test('an unresolved key is shown as the rule id, never as the key itself', () => {
	const html = renderHouseRules(
		[{ id: 'money', nameKey: 'rules.group.money' }],
		[{ id: 'passStartBonus', group: 'money', type: 'toggle', default: true, editableByHost: true, nameKey: 'rules.passStartBonus' }],
		k => k); // nothing translates yet — the package bundle is still in flight

	// The keys are still on the elements (that is how they get fixed), but not in the text.
	const text = html.replace(/<[^>]*>/g, '');
	assert.doesNotMatch(text, /rules\./);
	assert.match(text, /passStartBonus/);
	assert.match(text, /money/, 'the group falls back to its id as well');
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
	const checked = /value="([^"]+)"[^>]*checked/.exec(html);
	assert.ok(checked?.[1] === 'sameType', 'the default option is pre-selected');
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

// A number that belongs to one branch of a choice — the points of a "play to a score" ending,
// the rounds of a "play N rounds" one — is noise on the form for every host who chose the other
// branch, and one more control to walk past. It appears only under the branch it belongs to.
test('a conditional rule is shown only while its choice sits on the option it belongs to', () => {
	const container = document.createElement('div');
	container.innerHTML = renderHouseRules([], [
		{
			id: 'endMode', type: 'choice', default: 'score', editableByHost: true,
			options: [{ id: 'score' }, { id: 'rounds' }],
		},
		{ id: 'target', type: 'number', default: 500, editableByHost: true, showWhen: { rule: 'endMode', is: 'score' } },
		{ id: 'rounds', type: 'number', default: 15, editableByHost: true, showWhen: { rule: 'endMode', is: 'rounds' } },
		{ id: 'always', type: 'toggle', default: false, editableByHost: true },
	], k => k);
	document.body.appendChild(container);
	syncHouseRuleVisibility(container);
	watchHouseRuleVisibility(container);

	const box = (ruleId: string) => container.querySelector<HTMLElement>(
		`.rule-conditional:has([data-rule-id="${ruleId}"])`)!;
	assert.equal(box('target').hidden, false);
	assert.equal(box('rounds').hidden, true);
	// A rule with no condition is never wrapped: existing packages render exactly as before.
	assert.equal(container.querySelector('.rule-conditional [data-rule-id="always"]'), null);

	// Switching the choice swaps which number is offered.
	const roundsRadio = container.querySelector<HTMLInputElement>('[data-rule-id="endMode"][value="rounds"]')!;
	roundsRadio.checked = true;
	roundsRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.equal(box('target').hidden, true);
	assert.equal(box('rounds').hidden, false);

	// Hidden, NOT emptied: switching back offers the figure the host typed, and both values are
	// still read — the engine ignores the one its mode does not use.
	const target = container.querySelector<HTMLInputElement>('[data-rule-id="target"]')!;
	target.value = '300';
	assert.deepEqual(readHouseRuleValues(container),
		{ endMode: 'rounds', target: 300, rounds: 15, always: false });

	container.remove();
});

test('focus never stays on a rule that is being hidden', () => {
	const container = document.createElement('div');
	container.innerHTML = renderHouseRules([], [
		{
			id: 'endMode', type: 'choice', default: 'score', editableByHost: true,
			options: [{ id: 'score' }, { id: 'rounds' }],
		},
		{ id: 'target', type: 'number', default: 500, editableByHost: true, showWhen: { rule: 'endMode', is: 'score' } },
	], k => k);
	document.body.appendChild(container);
	syncHouseRuleVisibility(container);
	watchHouseRuleVisibility(container);

	container.querySelector<HTMLInputElement>('[data-rule-id="target"]')!.focus();
	const roundsRadio = container.querySelector<HTMLInputElement>('[data-rule-id="endMode"][value="rounds"]')!;
	roundsRadio.checked = true;
	roundsRadio.dispatchEvent(new window.Event('change', { bubbles: true }));

	// Left on the vanishing field, focus would fall to the document and the host would lose their
	// place in a long form.
	assert.equal(document.activeElement, roundsRadio);
	container.remove();
});

import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import {
	renderHouseRules, readHouseRuleValues, syncHouseRuleVisibility, watchHouseRuleVisibility,
	requiredTeamCountUnder, houseRuleDefaults, syncSeatingWithPlayerCount, bounceLockedChoice, lockSeatingAtTable,
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

// The panel is a FIXED element whose innerHTML is replaced, and both callers re-render it on
// every board the host tries. Watching it once per render left one more listener behind each
// time. Nothing visibly broke — the sync is idempotent — it just piled up.
test('re-rendering the same panel does not stack another visibility listener', () => {
	const container = document.createElement('div');
	document.body.appendChild(container);
	let listeners = 0;
	const addEventListener = container.addEventListener.bind(container);
	container.addEventListener = ((type: string, ...rest: unknown[]) => {
		if (type === 'change') listeners++;
		(addEventListener as (...args: unknown[]) => void)(type, ...rest);
	}) as typeof container.addEventListener;

	for (let board = 0; board < 3; board++) {
		container.innerHTML = renderHouseRules([], [
			{
				id: 'endMode', type: 'choice', default: 'score', editableByHost: true,
				options: [{ id: 'score' }, { id: 'rounds' }],
			},
			{ id: 'rounds', type: 'number', default: 15, editableByHost: true, showWhen: { rule: 'endMode', is: 'rounds' } },
		], k => k);
		syncHouseRuleVisibility(container);
		watchHouseRuleVisibility(container);
	}

	assert.equal(listeners, 1);

	// The one that survived is on the container, so it still reaches the LAST render's radios.
	const roundsRadio = container.querySelector<HTMLInputElement>('[data-rule-id="endMode"][value="rounds"]')!;
	roundsRadio.checked = true;
	roundsRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
	assert.equal(container.querySelector<HTMLElement>('.rule-conditional')!.hidden, false);

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

// A team-only board's requirement can hang on one of its own rules: Forbidden Words seated
// "everyone for themselves" has no teams to arrange. The lobby asks this with whatever the panel
// reads, so the sizes it offers follow the host's pick.
test('requiredTeamCountUnder lifts a board\'s team requirement only under the waiving choice', () => {
	const board = { requiredTeamCount: 2, teamsWaivedWhen: { rule: 'forbiddenMode', is: 'solo' } };
	assert.equal(requiredTeamCountUnder(board, {}), 2);
	assert.equal(requiredTeamCountUnder(board, { forbiddenMode: 'teams' }), 2);
	assert.equal(requiredTeamCountUnder(board, { forbiddenMode: 'solo' }), null);
	// A value of another rule, or of another kind, waives nothing.
	assert.equal(requiredTeamCountUnder(board, { forbiddenEndMode: 'solo' }), 2);
	assert.equal(requiredTeamCountUnder(board, { forbiddenMode: true }), 2);
	// A board with no requirement has nothing to waive; one with no waiver keeps it whatever is chosen.
	assert.equal(requiredTeamCountUnder({ requiredTeamCount: null, teamsWaivedWhen: null }, { forbiddenMode: 'solo' }), null);
	assert.equal(requiredTeamCountUnder({ requiredTeamCount: 2 }, { forbiddenMode: 'solo' }), 2);
});

test('houseRuleDefaults reads what the panel would say before the host touches it', () => {
	assert.deepEqual(houseRuleDefaults([
		{ id: 'mode', type: 'choice', default: 'teams', editableByHost: true, options: [{ id: 'teams' }, { id: 'solo' }] },
		{ id: 'unset', type: 'choice', editableByHost: true, options: [{ id: 'first' }, { id: 'second' }] },
		{ id: 'cycles', type: 'number', default: 5, editableByHost: true },
		{ id: 'auctions', type: 'toggle', default: true, editableByHost: true },
		{ id: 'shortage', type: 'toggle', editableByHost: true },
	]), { mode: 'teams', unset: 'first', cycles: 5, auctions: true, shortage: false });
	assert.deepEqual(houseRuleDefaults(undefined), {});
});

// The count decides the seating. Reported from the first evening a family of three tried
// Forbidden Words: the player count offered only even tables until a rule further down the form
// was flipped, and nothing on the count said so. Now a count that cannot split into the board's
// teams locks the seating onto the option that needs none — focusable, with the reason — and a
// count that can gives the host back what they had chosen.
const seatingBoard = { requiredTeamCount: 2, teamsWaivedWhen: { rule: 'forbiddenMode', is: 'solo' } };
const seatingRules = [
	{
		id: 'forbiddenMode', type: 'choice', default: 'teams', editableByHost: true, nameKey: 'rules.mode',
		options: [{ id: 'teams', nameKey: 'rules.teams' }, { id: 'solo', nameKey: 'rules.solo' }],
	},
	{ id: 'forbiddenCycles', type: 'number', default: 5, editableByHost: true, nameKey: 'rules.cycles' },
];
const seatingLabels = (k: string) => (({
	'rules.mode': 'How the table plays', 'rules.teams': 'In two teams', 'rules.solo': 'Everyone for themselves',
	'rules.cycles': 'Rounds',
}) as Record<string, string>)[k] ?? k;
const reason = (option: string) => `Three players cannot split into teams, so the table plays as ${option}.`;

function seatingPanel(): HTMLElement {
	const container = document.createElement('div');
	container.innerHTML = renderHouseRules([], seatingRules as any, seatingLabels);
	document.body.appendChild(container);
	return container;
}
const radio = (c: HTMLElement, value: string) =>
	c.querySelector<HTMLInputElement>(`[data-rule-id="forbiddenMode"][value="${value}"]`)!;

test('an odd count locks the seating onto the waiving option, with the reason on the locked radio', () => {
	const container = seatingPanel();

	const odd = syncSeatingWithPlayerCount(container, seatingBoard, 3, reason);

	assert.deepEqual(odd, { forced: true, changed: true });
	assert.equal(radio(container, 'solo').checked, true);
	const teams = radio(container, 'teams');
	assert.equal(teams.checked, false);
	assert.equal(teams.getAttribute('aria-disabled'), 'true');
	assert.equal(teams.disabled, false, 'the disabled attribute is forbidden: the option must stay focusable');
	const hint = container.querySelector<HTMLElement>(`#${teams.getAttribute('aria-describedby')}`)!;
	assert.equal(hint.hidden, false);
	assert.equal(hint.textContent, 'Three players cannot split into teams, so the table plays as Everyone for themselves.');
	// The waiving option itself is never locked: it is the one thing the host can have.
	assert.equal(radio(container, 'solo').hasAttribute('aria-disabled'), false);
	// Saying it again for the same count changes nothing, so nothing is spoken twice.
	assert.deepEqual(syncSeatingWithPlayerCount(container, seatingBoard, 5, reason), { forced: true, changed: false });
	container.remove();
});

test('an even count unlocks the seating and gives back what the host had chosen', () => {
	const container = seatingPanel();
	// The host chose teams at four (the default), went to five, and comes back to six.
	syncSeatingWithPlayerCount(container, seatingBoard, 5, reason);
	assert.equal(radio(container, 'solo').checked, true);

	const even = syncSeatingWithPlayerCount(container, seatingBoard, 6, reason);

	assert.deepEqual(even, { forced: false, changed: true });
	assert.equal(radio(container, 'teams').checked, true, 'a lock is not a choice: teams comes back');
	assert.equal(radio(container, 'teams').hasAttribute('aria-disabled'), false);
	assert.equal(radio(container, 'teams').hasAttribute('aria-describedby'), false);
	assert.equal(container.querySelector<HTMLElement>('#seating-count-hint')!.hidden, true);

	// A host who had chosen everyone-for-themselves at four keeps it through five and six.
	radio(container, 'solo').checked = true;
	syncSeatingWithPlayerCount(container, seatingBoard, 5, reason);
	assert.deepEqual(syncSeatingWithPlayerCount(container, seatingBoard, 6, reason), { forced: false, changed: false });
	assert.equal(radio(container, 'solo').checked, true);
	container.remove();
});

test('boards without a waiver, or without the rule on the form, are left alone', () => {
	const container = seatingPanel();
	assert.deepEqual(syncSeatingWithPlayerCount(container, { requiredTeamCount: 2 }, 3, reason), { forced: false, changed: false });
	assert.deepEqual(syncSeatingWithPlayerCount(container, { requiredTeamCount: null, teamsWaivedWhen: null }, 3, reason), { forced: false, changed: false });
	assert.equal(radio(container, 'teams').checked, true);
	const empty = document.createElement('div');
	assert.deepEqual(syncSeatingWithPlayerCount(empty, seatingBoard, 3, reason), { forced: false, changed: false });
	container.remove();
});

test('a locked radio the browser checked is bounced back, and the reason is handed over to be spoken', () => {
	const container = seatingPanel();
	syncSeatingWithPlayerCount(container, seatingBoard, 3, reason);
	const teams = radio(container, 'teams');
	teams.checked = true; // what a click does before any listener runs

	const spoken = bounceLockedChoice(container, teams);

	assert.equal(radio(container, 'solo').checked, true);
	assert.equal(teams.checked, false);
	assert.match(spoken!, /cannot split into teams/);
	// An ordinary change is not the guard's business.
	assert.equal(bounceLockedChoice(container, radio(container, 'solo')), null);
	assert.equal(bounceLockedChoice(container, container.querySelector('[data-rule-id="forbiddenCycles"]')), null);
	container.remove();
});

test('at a table the seating that would need a different shape is locked, with the reason', () => {
	// A table of three without teams: "in two teams" would need teams nobody arranged.
	const solo = seatingPanel();
	lockSeatingAtTable(solo, seatingBoard, false, 'The shape is settled.');
	assert.equal(radio(solo, 'teams').getAttribute('aria-disabled'), 'true');
	assert.equal(radio(solo, 'solo').checked, true, 'the only option this table can play is the one checked');
	assert.equal(solo.querySelector('#seating-table-hint')!.textContent, 'The shape is settled.');

	// A table arranged in two teams: everyone-for-themselves would drop them.
	const teams = seatingPanel();
	lockSeatingAtTable(teams, seatingBoard, true, 'The shape is settled.');
	assert.equal(radio(teams, 'solo').getAttribute('aria-disabled'), 'true');
	assert.equal(radio(teams, 'teams').hasAttribute('aria-disabled'), false);
	assert.equal(radio(teams, 'teams').checked, true);

	// A board whose seating is not tied to the table's shape has nothing to lock.
	const plain = seatingPanel();
	lockSeatingAtTable(plain, { requiredTeamCount: null }, false, 'The shape is settled.');
	assert.equal(plain.querySelectorAll('[aria-disabled="true"]').length, 0);
	assert.equal(plain.querySelector('#seating-table-hint'), null);
	solo.remove(); teams.remove(); plain.remove();
});

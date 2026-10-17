import { escapeHtml } from './escapeHtml.js';
import type { RuleGroupDef, HouseRuleDef } from './models.js';

/**
 * Every label a package contributes is painted through here: escaped (package content is
 * untrusted) and carrying its own `data-i18n`, so the standard translation pass re-resolves it
 * in place.
 *
 * That attribute is not decoration. A package's words arrive over the network, and this panel is
 * built from the package DEFINITION, which arrives first: rendered once at that moment, every
 * label froze as its raw key ("rules.passStartBonus") and nothing ever came back to fix it — the
 * table showed a rulebook written in identifiers. The same gap swallowed a language change, which
 * repaints `data-i18n` markup and left this panel in the old language. A key that is still
 * unresolved is left as the readable id rather than shown raw.
 */
function label(key: string | undefined, fallback: string, translate: (key: string) => string): string {
	if (!key) return escapeHtml(fallback);
	const text = translate(key);
	return `<span data-i18n="${escapeHtml(key)}">${escapeHtml(text === key ? fallback : text)}</span>`;
}

/**
 * Builds the HTML for a package's host-customizable rules, grouped (declared groups first, then any
 * ungrouped). Each rule is a checkbox (toggle) or number input carrying data-rule-id/data-rule-type
 * so {@link readHouseRuleValues} can read it back. Labels come from the package's i18n via
 * `translate(nameKey)` and are escaped (package content). Returns '' when nothing is editable.
 */
export function renderHouseRules(
	groups: RuleGroupDef[], rules: HouseRuleDef[], translate: (key: string) => string,
): string {
	const editable = rules.filter(r => r.editableByHost !== false);
	if (editable.length === 0) return '';

	const groupIds = groups.map(g => g.id);
	const buckets: { legend: string; items: HouseRuleDef[] }[] = [];
	for (const g of groups) {
		const items = editable.filter(r => r.group === g.id);
		if (items.length) buckets.push({ legend: g.nameKey ? label(g.nameKey, g.id, translate) : '', items });
	}
	const ungrouped = editable.filter(r => !r.group || !groupIds.includes(r.group));
	if (ungrouped.length) buckets.push({ legend: '', items: ungrouped });

	return buckets.map(b => {
		const legend = b.legend ? `<legend>${b.legend}</legend>` : '';
		return `<fieldset class="rules-fieldset">${legend}${b.items.map(r => renderRule(r, translate)).join('')}</fieldset>`;
	}).join('');
}

/**
 * Wraps a rule that only applies under a choice in a marker its visibility is driven from
 * (see {@link syncHouseRuleVisibility}). Rules with no condition are returned untouched, so
 * the markup of every existing package is exactly what it was.
 */
function conditioned(rule: HouseRuleDef, html: string): string {
	if (!rule.showWhen) return html;
	return `<div class="rule-conditional" data-show-when-rule="${escapeHtml(rule.showWhen.rule)}"`
		+ ` data-show-when-is="${escapeHtml(rule.showWhen.is)}">${html}</div>`;
}

/**
 * Shows each conditional rule only while its choice sits on the option it belongs to. Called
 * after rendering, after restoring saved values, and on every change — the panel must never
 * offer a number that decides nothing.
 *
 * Hidden, never disabled: the project's rule is that a control a player can reach must be able
 * to act. A field that does not apply is not a dead control, it is absent — and its value stays
 * in the DOM, so switching back offers the figure the host typed rather than a default.
 */
export function syncHouseRuleVisibility(container: HTMLElement): void {
	container.querySelectorAll<HTMLElement>('.rule-conditional').forEach(box => {
		const rule = box.dataset.showWhenRule!;
		// Matched by walking the radios rather than building a selector out of a rule id: the id
		// comes from a package, and package content is never trusted to be a safe selector.
		let selected: HTMLInputElement | undefined;
		container.querySelectorAll<HTMLInputElement>('[data-rule-type="choice"]').forEach(input => {
			if (!selected && input.checked && input.dataset.ruleId === rule) selected = input;
		});
		const applies = selected?.value === box.dataset.showWhenIs;
		if (!applies && box.contains(document.activeElement)) {
			// Never strand the focus on something about to vanish: hand it to the radio that did it.
			selected?.focus();
		}
		box.hidden = !applies;
	});
}

/**
 * Keeps the conditional rules in step with their choice while the host edits the form.
 *
 * Called once per RENDER, but the container it watches outlives every render — both callers own a
 * fixed element and only replace its innerHTML — so a host trying four boards left four listeners
 * behind. Marking the container makes the second call a no-op: nothing visibly broke, since the
 * sync is idempotent, it just piled up.
 */
export function watchHouseRuleVisibility(container: HTMLElement): void {
	if (container.dataset.ruleVisibilityWatched === 'yes') return;
	container.dataset.ruleVisibilityWatched = 'yes';
	container.addEventListener('change', event => {
		const target = event.target as HTMLElement | null;
		if (target?.dataset?.ruleType !== 'choice') return;
		syncHouseRuleVisibility(container);
	});
}

function renderRule(rule: HouseRuleDef, translate: (key: string) => string): string {
	const label_ = label(rule.nameKey, rule.id, translate);
	const id = escapeHtml(rule.id);
	if (rule.type === 'number') {
		const attrs = [`data-rule-id="${id}"`, 'data-rule-type="number"', `value="${Number(rule.default ?? 0)}"`];
		if (rule.min != null) attrs.push(`min="${Number(rule.min)}"`);
		if (rule.max != null) attrs.push(`max="${Number(rule.max)}"`);
		if (rule.step != null) attrs.push(`step="${Number(rule.step)}"`);
		return conditioned(rule, `<div class="form-group"><label>${label_} <input type="number" ${attrs.join(' ')}></label></div>`);
	}
	if (rule.type === 'choice') {
		// A radio group: mutually-exclusive options, grouped by the rule id (its name), the
		// default pre-selected. A fieldset/legend names the group for the screen reader.
		const def = typeof rule.default === 'string' ? rule.default : rule.options?.[0]?.id ?? '';
		const radios = (rule.options ?? []).map(opt => {
			const optId = escapeHtml(opt.id);
			const optLabel = label(opt.nameKey, opt.id, translate);
			const checked = opt.id === def ? ' checked' : '';
			return `<label class="rule-choice__option"><input type="radio" name="rule-${id}" `
				+ `data-rule-id="${id}" data-rule-type="choice" value="${optId}"${checked}> ${optLabel}</label>`;
		}).join('');
		return conditioned(rule, `<fieldset class="form-group rule-choice"><legend>${label_}</legend>${radios}</fieldset>`);
	}
	const checked = rule.default === true ? ' checked' : '';
	return conditioned(rule, `<div class="form-group"><label><input type="checkbox" data-rule-id="${id}" data-rule-type="toggle"${checked}> ${label_}</label></div>`);
}

/**
 * Puts previously chosen values back into freshly rendered inputs, which otherwise show the
 * package's defaults. A table keeps the host's choices between matches, so the panel it offers
 * for the next game must open on the rules the last one was played with, not on the board's.
 * Rules the saved map says nothing about keep their default.
 */
export function applyHouseRuleValues(
	container: HTMLElement,
	values: Record<string, boolean | number | string> | null | undefined,
): void {
	if (!values) return;
	container.querySelectorAll<HTMLInputElement>('[data-rule-id]').forEach(el => {
		const value = values[el.dataset.ruleId!];
		if (value === undefined) return;
		if (el.dataset.ruleType === 'number') el.value = String(Number(value));
		else if (el.dataset.ruleType === 'choice') el.checked = el.value === String(value);
		else el.checked = value === true;
	});
}

/**
 * How many teams a board requires UNDER the host's current choices: its declared count, unless
 * the choice that waives them is selected — the forbidden family seated "everyone for
 * themselves" has no teams to arrange, and offers every table size from three up. The values
 * are whatever the rules panel currently reads (or the package defaults before it is rendered),
 * so the player-count and team-count selectors follow the host's pick as they make it.
 */
export function requiredTeamCountUnder(
	pkg: TeamWaiverBoard,
	values: Record<string, boolean | number | string>,
): number | null {
	const required = pkg.requiredTeamCount ?? null;
	const waiver = pkg.teamsWaivedWhen;
	if (required && waiver && values[waiver.rule] === waiver.is) return null;
	return required;
}

/** A board whose team requirement one of its own choice rules can waive. */
export interface TeamWaiverBoard {
	requiredTeamCount?: number | null;
	teamsWaivedWhen?: { rule: string; is: string } | null;
}

/** Does a table of this many players split into the board's required teams, two players each at least? */
export function fitsRequiredTeams(required: number, players: number): boolean {
	return players % required === 0 && players / required >= 2;
}

/** The radios of one choice rule, in option order. Walked rather than selected by id: the id
 *  comes from a package, and package content is never trusted to be a safe selector. */
function choiceRadios(container: HTMLElement, ruleId: string): HTMLInputElement[] {
	return Array.from(container.querySelectorAll<HTMLInputElement>('[data-rule-type="choice"]'))
		.filter(input => input.dataset.ruleId === ruleId);
}

/** The visible label of a radio option, for a sentence that names it. */
function optionLabel(radio: HTMLInputElement): string {
	return (radio.closest('label')?.textContent ?? radio.value).trim();
}

/**
 * Locks every radio of the rule except those in <paramref>allowed</paramref>, each kept focusable
 * and told WHY (aria-disabled + a hint it is described by), and makes sure the checked option is
 * one that is allowed. Never the `disabled` attribute, and never removed from the group: a host
 * who lands on the option hears the reason instead of a gap. Returns what is now checked.
 */
function lockChoice(
	container: HTMLElement,
	ruleId: string,
	allowed: (value: string) => boolean,
	reason: string | null,
	hintId: string,
): { checked: string | null; changed: boolean } {
	const radios = choiceRadios(container, ruleId);
	if (radios.length === 0) return { checked: null, changed: false };
	const group = radios[0].closest('fieldset') ?? container;
	let hint = group.querySelector<HTMLElement>(`#${hintId}`);
	if (!hint) {
		hint = document.createElement('p');
		hint.id = hintId;
		hint.className = 'form-hint rule-choice__hint';
		group.appendChild(hint);
	}
	hint.textContent = reason ?? '';
	hint.hidden = !reason;

	const before = radios.find(radio => radio.checked)?.value ?? null;
	for (const radio of radios) {
		const locked = !!reason && !allowed(radio.value);
		if (locked) {
			radio.setAttribute('aria-disabled', 'true');
			radio.setAttribute('aria-describedby', hintId);
			radio.dataset.locked = '1';
		} else {
			radio.removeAttribute('aria-disabled');
			radio.removeAttribute('aria-describedby');
			delete radio.dataset.locked;
		}
	}
	const checked = radios.find(radio => radio.checked);
	if (!checked || checked.dataset.locked) {
		const fallback = radios.find(radio => !radio.dataset.locked);
		if (fallback) fallback.checked = true;
	}
	const after = radios.find(radio => radio.checked)?.value ?? null;
	return { checked: after, changed: after !== before };
}

/**
 * Keeps a board's seating rule in step with the player count the host picked, so the count is
 * the only thing they have to decide: a table that cannot split into the board's required teams
 * is seated under the option that waives them (Forbidden Words: everyone for themselves), and the
 * other options are locked with the reason until the count fits again. What the host had chosen
 * before the lock is remembered and put back when it does.
 *
 * Returns whether the rule is forced right now, and whether its value just changed — the caller
 * speaks the change, since a radio moving on its own says nothing to a screen reader.
 */
export function syncSeatingWithPlayerCount(
	container: HTMLElement,
	board: TeamWaiverBoard,
	players: number,
	reason: (waiverOption: string) => string,
	hintId = 'seating-count-hint',
): { forced: boolean; changed: boolean } {
	const waiver = board.teamsWaivedWhen;
	const required = board.requiredTeamCount ?? null;
	if (!waiver || !required) return { forced: false, changed: false };
	const radios = choiceRadios(container, waiver.rule);
	const waiverRadio = radios.find(radio => radio.value === waiver.is);
	if (!waiverRadio) return { forced: false, changed: false };
	const group = waiverRadio.closest('fieldset') ?? container;

	if (!fitsRequiredTeams(required, players)) {
		// Remembered once, on the way in, so a host who picked teams at four and then six
		// players gets teams back — a lock is not a choice.
		if (group.dataset.seatingBefore === undefined) {
			group.dataset.seatingBefore = radios.find(radio => radio.checked)?.value ?? '';
		}
		const { changed } = lockChoice(
			container, waiver.rule, value => value === waiver.is, reason(optionLabel(waiverRadio)), hintId);
		return { forced: true, changed };
	}

	const { changed: unlocked } = lockChoice(container, waiver.rule, () => true, null, hintId);
	let changed = unlocked;
	const remembered = group.dataset.seatingBefore;
	if (remembered !== undefined) {
		delete group.dataset.seatingBefore;
		const restore = radios.find(radio => radio.value === remembered);
		if (restore && !restore.checked) {
			restore.checked = true;
			changed = true;
		}
	}
	return { forced: false, changed };
}

/**
 * At a table that already exists the shape is settled — its size, and whether it was arranged in
 * teams — so the seating options that would need a different shape are locked with the reason.
 * The server refuses them too; this says so before the host asks.
 */
export function lockSeatingAtTable(
	container: HTMLElement,
	board: TeamWaiverBoard,
	hasTeams: boolean,
	reason: string,
	hintId = 'seating-table-hint',
): void {
	const waiver = board.teamsWaivedWhen;
	if (!waiver || !board.requiredTeamCount) return;
	const fits = (value: string) => (requiredTeamCountUnder(board, { [waiver.rule]: value }) !== null) === hasTeams;
	const anyLocked = choiceRadios(container, waiver.rule).some(radio => !fits(radio.value));
	lockChoice(container, waiver.rule, fits, anyLocked ? reason : null, hintId);
}

/**
 * The change guard for a locked radio: the browser has already checked it, so this puts the
 * group back on an option that is allowed and says which. Returns the reason to speak, or null
 * when the change was an ordinary one.
 */
export function bounceLockedChoice(container: HTMLElement, target: EventTarget | null): string | null {
	const radio = target instanceof HTMLInputElement ? target : null;
	if (!radio?.dataset.locked || radio.dataset.ruleType !== 'choice') return null;
	const fallback = choiceRadios(container, radio.dataset.ruleId ?? '').find(other => !other.dataset.locked);
	if (fallback) fallback.checked = true;
	const hint = radio.getAttribute('aria-describedby');
	return (hint && container.querySelector<HTMLElement>(`#${hint}`)?.textContent) || '';
}

/** The value each declared rule starts on, as {ruleId: default}: what the panel would read
 *  before the host touches anything, and the answer when it has not been rendered yet. */
export function houseRuleDefaults(rules: HouseRuleDef[] | undefined): Record<string, boolean | number | string> {
	const out: Record<string, boolean | number | string> = {};
	for (const rule of rules ?? []) {
		if (rule.type === 'number') out[rule.id] = Number(rule.default ?? 0);
		else if (rule.type === 'choice') out[rule.id] = typeof rule.default === 'string' ? rule.default : rule.options?.[0]?.id ?? '';
		else out[rule.id] = rule.default === true;
	}
	return out;
}

/** Reads the rendered rule inputs back into a {ruleId: value} map: boolean for toggles,
 *  number for numbers, the selected option id (string) for a choice's radio group. */
export function readHouseRuleValues(container: HTMLElement): Record<string, boolean | number | string> {
	const out: Record<string, boolean | number | string> = {};
	container.querySelectorAll<HTMLInputElement>('[data-rule-id]').forEach(el => {
		const id = el.dataset.ruleId!;
		if (el.dataset.ruleType === 'number') out[id] = Number(el.value);
		else if (el.dataset.ruleType === 'choice') { if (el.checked) out[id] = el.value; }
		else out[id] = el.checked;
	});
	return out;
}

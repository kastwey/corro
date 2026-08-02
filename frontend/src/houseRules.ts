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

function renderRule(rule: HouseRuleDef, translate: (key: string) => string): string {
	const label_ = label(rule.nameKey, rule.id, translate);
	const id = escapeHtml(rule.id);
	if (rule.type === 'number') {
		const attrs = [`data-rule-id="${id}"`, 'data-rule-type="number"', `value="${Number(rule.default ?? 0)}"`];
		if (rule.min != null) attrs.push(`min="${Number(rule.min)}"`);
		if (rule.max != null) attrs.push(`max="${Number(rule.max)}"`);
		if (rule.step != null) attrs.push(`step="${Number(rule.step)}"`);
		return `<div class="form-group"><label>${label_} <input type="number" ${attrs.join(' ')}></label></div>`;
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
		return `<fieldset class="form-group rule-choice"><legend>${label_}</legend>${radios}</fieldset>`;
	}
	const checked = rule.default === true ? ' checked' : '';
	return `<div class="form-group"><label><input type="checkbox" data-rule-id="${id}" data-rule-type="toggle"${checked}> ${label_}</label></div>`;
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

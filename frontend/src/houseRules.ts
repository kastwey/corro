import { escapeHtml } from './escapeHtml.js';
import type { RuleGroupDef, HouseRuleDef } from './models.js';

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
		if (items.length) buckets.push({ legend: g.nameKey ? translate(g.nameKey) : '', items });
	}
	const ungrouped = editable.filter(r => !r.group || !groupIds.includes(r.group));
	if (ungrouped.length) buckets.push({ legend: '', items: ungrouped });

	return buckets.map(b => {
		const legend = b.legend ? `<legend>${escapeHtml(b.legend)}</legend>` : '';
		return `<fieldset class="rules-fieldset">${legend}${b.items.map(r => renderRule(r, translate)).join('')}</fieldset>`;
	}).join('');
}

function renderRule(rule: HouseRuleDef, translate: (key: string) => string): string {
	const label = escapeHtml(rule.nameKey ? translate(rule.nameKey) : rule.id);
	const id = escapeHtml(rule.id);
	if (rule.type === 'number') {
		const attrs = [`data-rule-id="${id}"`, 'data-rule-type="number"', `value="${Number(rule.default ?? 0)}"`];
		if (rule.min != null) attrs.push(`min="${Number(rule.min)}"`);
		if (rule.max != null) attrs.push(`max="${Number(rule.max)}"`);
		if (rule.step != null) attrs.push(`step="${Number(rule.step)}"`);
		return `<div class="form-group"><label>${label} <input type="number" ${attrs.join(' ')}></label></div>`;
	}
	if (rule.type === 'choice') {
		// A radio group: mutually-exclusive options, grouped by the rule id (its name), the
		// default pre-selected. A fieldset/legend names the group for the screen reader.
		const def = typeof rule.default === 'string' ? rule.default : rule.options?.[0]?.id ?? '';
		const radios = (rule.options ?? []).map(opt => {
			const optId = escapeHtml(opt.id);
			const optLabel = escapeHtml(opt.nameKey ? translate(opt.nameKey) : opt.id);
			const checked = opt.id === def ? ' checked' : '';
			return `<label class="rule-choice__option"><input type="radio" name="rule-${id}" `
				+ `data-rule-id="${id}" data-rule-type="choice" value="${optId}"${checked}> ${optLabel}</label>`;
		}).join('');
		return `<fieldset class="form-group rule-choice"><legend>${label}</legend>${radios}</fieldset>`;
	}
	const checked = rule.default === true ? ' checked' : '';
	return `<div class="form-group"><label><input type="checkbox" data-rule-id="${id}" data-rule-type="toggle"${checked}> ${label}</label></div>`;
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

// mergedNotice.ts — "your accounts are now one", said the moment it happens.
//
// Merging is silent from the outside: the session carries on, the lobby looks the same, and the
// only visible difference is that a list which was empty a second ago is not. Somebody who has
// just been through the two-account surprise deserves to be told plainly that it is over, and
// that nothing was lost — which is the question they will actually have.

import { dialogManager } from './dialogManager.js';
import { tSync } from './i18nBinder.js';

/** The service's own name, localized — "Google", not "google". */
function providerName(id: string): string {
	const name = tSync(`account.provider.${id}`);
	return name === `account.provider.${id}` ? id : name;
}

/** Confirm the join, and say how many tables came across. */
export function showMergedNotice(newProvider: string, existingProviders: string[], tablesMoved: number): void {
	const added = providerName(newProvider);
	const existing = existingProviders.map(providerName).join(' / ') || added;

	const content = document.createElement('div');
	content.className = 'merged-notice';

	const body = document.createElement('p');
	body.textContent = tSync('account.merged.body')
		.replace(/\{\{existing\}\}/g, existing)
		.replace(/\{\{new\}\}/g, added);

	// The count is the reassurance, so it is stated either way rather than left out when it is
	// zero: "no tables to bring" is an answer, and silence is not.
	const tables = document.createElement('p');
	tables.textContent = tablesMoved > 0
		? tSync('account.merged.tables').replace('{{count}}', String(tablesMoved))
		: tSync('account.merged.noTables');

	content.append(body, tables);

	dialogManager.init();
	dialogManager.show({
		title: tSync('account.merged.heading'),
		contentElement: content,
		documentMode: true,
		modal: true,
		buttons: [{
			label: 'Good',
			i18nKey: 'account.merged.dismiss',
			variant: 'primary',
			action: () => dialogManager.close(),
		}],
	});
}

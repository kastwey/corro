// secondAccountNotice.ts — "this made a second account", said before anybody has to work it out.
//
// Corro matches accounts on (provider, provider's id for you) and never on the email address,
// because two providers reporting the same address are not proof of the same person — and one of
// them, a work/school Microsoft account, reports an address a tenant administrator can set to
// anything. That rule is right and it stays.
//
// Its consequence, though, is genuinely surprising: sign in with Google and later with Microsoft
// using the same address and you have TWO accounts. Somebody meets that as "where did my tables
// go?", which is the worst possible way to learn it. So the server notices and the lobby explains
// it — in the words of what to DO about it, not in the words of the rule behind it.
//
// The way out is four steps from where they already are: add the other service from account
// settings, and the two become one. That IS the deliberate act — signed into this account and
// completing the other's login is what proves one person holds both — so nothing about the rule
// has been relaxed to make it short.

import { dialogManager } from './dialogManager.js';
import { tSync } from './i18nBinder.js';

/** The provider's own name, localized — "Google", not "google". */
function providerName(id: string): string {
	const name = tSync(`account.provider.${id}`);
	return name === `account.provider.${id}` ? id : name;
}

/** Fill {{existing}} and {{new}} in one of the notice's sentences. */
function say(key: string, existing: string, added: string): string {
	return tSync(key).replace(/\{\{existing\}\}/g, existing).replace(/\{\{new\}\}/g, added);
}

/**
 * Explain what just happened, and the steps out of it — naming the services rather than saying
 * "the one you used last time", which is precisely what somebody in this situation cannot
 * remember. Both names are known: the one just used, and the one on the account we found.
 */
export function showSecondAccountNotice(newProvider: string, existingProviders: string[]): void {
	const added = providerName(newProvider);
	// More than one provider on the old account is possible (they linked two, then made a third
	// login). Listing them all is the honest answer and any of them opens it.
	const existing = existingProviders.map(providerName).join(' / ') || added;
	const content = document.createElement('div');
	content.className = 'second-account-notice';

	const body = document.createElement('p');
	body.textContent = say('account.secondAccount.body', existing, added);

	const why = document.createElement('p');
	why.className = 'second-account-notice__why';
	why.textContent = tSync('account.secondAccount.why');

	const howHeading = document.createElement('h3');
	howHeading.textContent = tSync('account.secondAccount.howHeading');

	// A numbered list because the steps are IN ORDER and each one is a thing to do. A screen
	// reader announces the count and the position, which is exactly the help someone needs when
	// they are being walked through something they did not expect to be doing.
	const steps = document.createElement('ol');
	// Spelled out rather than built in a loop: the project's translation guard scans the source for
	// the keys it can SEE, and a key assembled from a variable is a key nobody can check.
	for (const text of [
		say('account.secondAccount.step1', existing, added),
		say('account.secondAccount.step2', existing, added),
		say('account.secondAccount.step3', existing, added),
		say('account.secondAccount.step4', existing, added),
	]) {
		const step = document.createElement('li');
		step.textContent = text;
		steps.appendChild(step);
	}

	content.append(body, why, howHeading, steps);

	dialogManager.init();
	dialogManager.show({
		title: tSync('account.secondAccount.heading'),
		contentElement: content,
		// Instructions to READ, not controls to operate: documentMode leaves a screen reader in
		// browse mode, where the steps can be arrowed through and re-read, instead of announcing
		// only the button at the bottom.
		documentMode: true,
		modal: true,
		buttons: [{
			label: 'Got it',
			i18nKey: 'account.secondAccount.dismiss',
			variant: 'primary',
			action: () => dialogManager.close(),
		}],
	});
}

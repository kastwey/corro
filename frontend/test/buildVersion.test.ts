import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import {
	buildVersionDetails, deploymentSentence, initializeBuildVersion, parseBuildVersion, renderVersion,
	type BuildVersion,
} from '../src/buildVersion.js';

/**
 * The footer's "when did this last change?" line.
 *
 * Corro ships continuously, so the stamp is a date and that day's ordinal rather than a semantic
 * version. What is tested here is mostly what the lobby REFUSES to show: a build that was never
 * stamped, a stamp that is not a date and an ordinal, a commit link that is not something a
 * browser should open. Each of those is silence, because a made-up version is worse than none.
 */

// The dialog says the date in the READER's time zone, so the assertions below need a known one:
// otherwise "23 August at 14:32" is only true for whoever happens to run the suite in UTC.
process.env.TZ = 'UTC';

setupDom();

/** Stands in for the translation layer, close enough to see the composed sentences. */
const translate = (key: string, vars?: Record<string, unknown>) => {
	switch (key) {
		case 'footer.version':
			return `Version ${vars?.version}`;
		case 'footer.versionDeployed':
			return `Version ${vars?.version}, deployed on ${vars?.date}.`;
		case 'footer.versionOnly':
			return `Version ${vars?.version}.`;
		case 'footer.versionCommit':
			return `See commit ${vars?.commit} on GitHub`;
		case 'footer.versionCommitNewWindowLabel':
			return `See commit ${vars?.commit} on GitHub, opens in a new window`;
		case 'footer.versionCommitPlain':
			return `Built from commit ${vars?.commit}.`;
		default:
			return key;
	}
};

const SHA = '0123456789abcdef0123456789abcdef01234567';

const stamped = (over: Partial<Record<string, unknown>> = {}) => ({
	configured: true,
	version: '20260823-001',
	commit: SHA,
	commitUrl: `https://github.com/kastwey/corro/commit/${SHA}`,
	deployedAt: '2026-08-23T14:32:10Z',
	...over,
});

function footer(): HTMLElement {
	document.body.innerHTML = '<p id="site-version" hidden><button type="button"></button></p>';
	return document.getElementById('site-version') as HTMLElement;
}

test('a stamped build is read as a date, an ordinal and a commit worth reading aloud', () => {
	assert.deepEqual(parseBuildVersion(stamped()), {
		version: '20260823-001',
		// Shortened: seven characters identify the commit and can still be said out loud.
		commit: '0123456',
		commitUrl: `https://github.com/kastwey/corro/commit/${SHA}`,
		deployedAt: new Date('2026-08-23T14:32:10Z'),
	});
});

test('a build that was never stamped is no version at all', () => {
	for (const payload of [
		{ configured: false },
		{ configured: false, version: '20260823-001' },
		{ version: '20260823-001' },
		{},
		null,
		'not an object',
	]) {
		assert.equal(parseBuildVersion(payload), null, JSON.stringify(payload));
	}
});

// The shape is the promise. A number that is not a date and an ordinal tells the reader nothing,
// and showing it anyway would make a mis-scripted build look like a release.
test('only a date and an ordinal is a version', () => {
	for (const version of ['', '1.0.0', '20260823', '20260823-1', '2026-08-23-001', 'main', 42]) {
		assert.equal(parseBuildVersion(stamped({ version })), null, String(version));
	}
	// A day busy enough to need a fourth digit grows rather than repeating a stamp.
	assert.equal(parseBuildVersion(stamped({ version: '20260823-1042' }))?.version, '20260823-1042');
});

test('a link the browser should not open is dropped, and the version survives it', () => {
	for (const commitUrl of [
		'http://github.com/kastwey/corro/commit/abc',
		'javascript:alert(1)',
		'/commit/abc',
		'',
		null,
		12,
	]) {
		const info = parseBuildVersion(stamped({ commitUrl }));
		assert.equal(info?.version, '20260823-001', String(commitUrl));
		assert.equal(info?.commitUrl, null, String(commitUrl));
	}
});

test('a commit that is not a hash is not offered, with or without an address', () => {
	for (const commit of ['', 'not-a-hash', 'abc', null, 7]) {
		const info = parseBuildVersion(stamped({ commit }));
		assert.equal(info?.commit, null, String(commit));
		assert.equal(info?.commitUrl, null, 'nothing to point at means nothing to link');
	}
});

test('a build with no recorded date still says which build it is', () => {
	for (const deployedAt of ['', 'last Tuesday', null, 1756000000000]) {
		const info = parseBuildVersion(stamped({ deployedAt }));
		assert.equal(info?.version, '20260823-001', String(deployedAt));
		assert.equal(info?.deployedAt, null, String(deployedAt));
	}
});

test('the build is stated as one flowing sentence, in the reader\'s own time', () => {
	const info = parseBuildVersion(stamped()) as BuildVersion;

	const english = deploymentSentence(info, translate, 'en-GB');
	assert.equal(english, 'Version 20260823-001, deployed on 23 August 2026 at 14:32.');

	// Same instant, said the way the reader's language says it.
	const spanish = deploymentSentence(info, translate, 'es-ES');
	assert.match(spanish, /^Version 20260823-001, deployed on 23 de agosto de 2026[ ,] ?(a las )?14:32\.$/);

	// No date recorded: the sentence is shorter, never half-finished.
	const undated = { ...info, deployedAt: null };
	assert.equal(deploymentSentence(undated, translate, 'en-GB'), 'Version 20260823-001.');
});

test('an unusable language tag loses the formatting, never the date', () => {
	const info = parseBuildVersion(stamped()) as BuildVersion;
	assert.match(deploymentSentence(info, translate, 'not a language'), /^Version 20260823-001, deployed on .+\.$/);
});

test('the dialog states the build and offers the commit as a link out', () => {
	const info = parseBuildVersion(stamped()) as BuildVersion;
	const details = buildVersionDetails(info, translate, 'en-GB');

	const paragraphs = details.querySelectorAll('p');
	assert.equal(paragraphs.length, 2);
	assert.match(paragraphs[0].textContent ?? '', /^Version 20260823-001, deployed on /);

	const link = details.querySelector('a') as HTMLAnchorElement;
	assert.equal(link.getAttribute('href'), `https://github.com/kastwey/corro/commit/${SHA}`);
	assert.equal(link.textContent, 'See commit 0123456 on GitHub');
	// The rest of the footer says so too: a new window is announced before it opens.
	assert.equal(
		link.getAttribute('aria-label'), 'See commit 0123456 on GitHub, opens in a new window');
	assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
	// The accessible name contains the visible text, so saying what is written activates it.
	assert.ok((link.getAttribute('aria-label') ?? '').startsWith(link.textContent ?? ''));

	// And it carries the same mark as every other link out of this site, hidden from the reader
	// who was already told about the new window in words.
	const mark = link.querySelector('svg');
	assert.equal(mark?.getAttribute('class'), 'version-details__icon');
	assert.equal(mark?.getAttribute('aria-hidden'), 'true');
	assert.equal(mark?.getAttribute('focusable'), 'false');
});

test('a deployment that cannot point at its commit still names it, without a dead link', () => {
	const info = parseBuildVersion(stamped({ commitUrl: '' })) as BuildVersion;
	const details = buildVersionDetails(info, translate, 'en-GB');

	assert.equal(details.querySelector('a'), null);
	assert.equal(details.querySelectorAll('p')[1].textContent, 'Built from commit 0123456.');
});

test('a build with no commit at all is one sentence and nothing else', () => {
	const info = parseBuildVersion(stamped({ commit: null })) as BuildVersion;
	assert.equal(buildVersionDetails(info, translate, 'en-GB').querySelectorAll('p').length, 1);
});

test('the footer entry is a button labelled with the stamp, and it opens the dialog', () => {
	const host = footer();
	const opened: string[] = [];

	assert.equal(
		renderVersion(host, parseBuildVersion(stamped()), translate, () => opened.push('dialog')),
		true);

	const button = host.querySelector('button') as HTMLButtonElement;
	assert.equal(host.hidden, false);
	assert.equal(button.textContent, 'Version 20260823-001');
	// A button, not a link: there is nowhere to navigate to, and it announces what it opens.
	assert.equal(button.getAttribute('href'), null);
	button.click();
	assert.deepEqual(opened, ['dialog']);
});

// Rendering twice used to leave two handlers on the button, and the second press would have
// opened the dialog on top of itself.
test('rendering the entry again replaces its handler rather than stacking another', () => {
	const host = footer();
	const opened: string[] = [];
	const info = parseBuildVersion(stamped());

	renderVersion(host, info, translate, () => opened.push('first'));
	renderVersion(host, info, translate, () => opened.push('second'));

	(host.querySelector('button') as HTMLButtonElement).click();
	assert.deepEqual(opened, ['second']);
});

test('an unstamped build leaves the footer as it was: no entry, nothing to read', () => {
	const host = footer();

	assert.equal(renderVersion(host, null, translate, () => { }), false);

	assert.equal(host.hidden, true);
	assert.equal(host.querySelector('button')?.textContent, '');
});

test('the entry is never a live region, however it is filled', () => {
	const host = footer();
	renderVersion(host, parseBuildVersion(stamped()), translate, () => { });

	// Stated once, on arrival — never spoken over whatever the reader is doing.
	assert.equal(host.hasAttribute('aria-live'), false);
	assert.equal(host.hasAttribute('aria-atomic'), false);
	assert.equal(host.getAttribute('role'), null);
});

test('the lobby asks once, and a server that will not answer costs it nothing', async () => {
	const host = footer();
	const calls: string[] = [];
	const ok = async (url: string) => {
		calls.push(url);
		return { ok: true, json: async () => stamped() } as unknown as Response;
	};

	const info = await initializeBuildVersion(
		host, translate, () => 'en-GB', ok as unknown as typeof fetch);

	assert.equal(info?.version, '20260823-001');
	assert.deepEqual(calls, ['/api/config/version'], 'asked once, and only once');
	assert.equal(host.querySelector('button')?.textContent, 'Version 20260823-001');

	// Offline, a 500, a body that is not JSON: the footer says nothing and the lobby is unaffected.
	for (const broken of [
		async () => { throw new Error('offline'); },
		async () => ({ ok: false, json: async () => ({}) }) as unknown as Response,
		async () => ({ ok: true, json: async () => { throw new Error('not json'); } }) as unknown as Response,
	]) {
		const quiet = footer();
		assert.equal(
			await initializeBuildVersion(quiet, translate, () => 'en-GB', broken as unknown as typeof fetch),
			null);
		assert.equal(quiet.hidden, true);
	}
});

test('a page without the footer entry simply has none', async () => {
	document.body.innerHTML = '';
	assert.equal(renderVersion(null, parseBuildVersion(stamped()), translate, () => { }), false);
	// And the entry cannot be labelled if its button was removed from the markup.
	document.body.innerHTML = '<p id="site-version" hidden></p>';
	assert.equal(
		renderVersion(document.getElementById('site-version'), parseBuildVersion(stamped()), translate, () => { }),
		false);
});

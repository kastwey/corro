// buildVersion.ts — which build of Corro this is, in the lobby footer.
//
// Corro ships continuously: things arrive a few at a time, all week, so a semantic version would
// be a number nobody could interpret. What a player actually wants to know is WHEN the thing in
// front of them last changed, and a date says that directly — the stamp is the UTC day of the
// commit plus that day's ordinal, "20260823-001" (see tools/build-version.ps1).
//
// Three rules shape this module:
//
//  * A build that was never stamped shows NOTHING. A clone somebody is running from source has no
//    honest answer, and "development" would be a version number meaning "unknown". Same for a
//    stamp that arrives malformed: the server is not believed on shape alone.
//  * The footer entry is a BUTTON, not a link: it opens a dialog that states the build in words,
//    because "20260823-001" on its own is a code, and the sentence around it is the answer.
//  * The date is formatted here, in the reader's language and time zone. It travels from the
//    server as a UTC instant precisely so nobody has to read a timestamp in somebody else's day.

import { dialogManager } from './dialogManager.js';

/** What the lobby knows about the running build, after everything unusable has been dropped. */
export interface BuildVersion {
	/** The stamp itself: a UTC date and that day's ordinal, "20260823-001". */
	readonly version: string;
	/** The commit, shortened for reading aloud, or null when the build did not record one. */
	readonly commit: string | null;
	/** Where that commit can be read, or null when there is nothing a browser could open. */
	readonly commitUrl: string | null;
	/** When the build went live, or null when it was not recorded. */
	readonly deployedAt: Date | null;
}

export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** A stamp is a UTC day and an ordinal. A day busy enough to need a fourth digit simply grows. */
const VERSION_PATTERN = /^\d{8}-\d{3,}$/;
/** Hexadecimal, at least the seven characters GitHub shortens to and at most a full hash. */
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
/** How much of a hash is worth reading out. Long enough to identify, short enough to say. */
const SHORT_COMMIT_LENGTH = 7;

/**
 * Read a version payload defensively. Anything the reader could be misled by is dropped rather
 * than shown: a stamp that is not a date and an ordinal means no version at all, and a commit or
 * an address that is not one means the version is stated without a link to nowhere.
 *
 * Only https addresses survive, because this one ends up in a link the player opens.
 */
export function parseBuildVersion(payload: unknown): BuildVersion | null {
	const body = payload as {
		configured?: unknown; version?: unknown; commit?: unknown;
		commitUrl?: unknown; deployedAt?: unknown;
	} | null;
	if (body?.configured !== true) return null;

	const version = typeof body.version === 'string' ? body.version.trim() : '';
	if (!VERSION_PATTERN.test(version)) return null;

	const hash = typeof body.commit === 'string' ? body.commit.trim() : '';
	const commit = COMMIT_PATTERN.test(hash) ? hash.slice(0, SHORT_COMMIT_LENGTH).toLowerCase() : null;

	const url = typeof body.commitUrl === 'string' ? body.commitUrl.trim() : '';
	const commitUrl = commit !== null && /^https:\/\/\S+$/i.test(url) ? url : null;

	const deployed = typeof body.deployedAt === 'string' ? new Date(body.deployedAt) : null;
	const deployedAt = deployed !== null && !Number.isNaN(deployed.getTime()) ? deployed : null;

	return { version, commit, commitUrl, deployedAt };
}

/**
 * The build as one flowing sentence: "Version 20260823-001, deployed on 23 August 2026 at 16:32."
 *
 * The date is rendered in the reader's own language and time zone — a UTC timestamp is precise and
 * unreadable, and "yesterday evening" is what somebody is actually trying to work out. A build with
 * no recorded date states the version alone rather than an empty half-sentence.
 */
export function deploymentSentence(info: BuildVersion, translate: Translate, language: string): string {
	if (!info.deployedAt) return translate('footer.versionOnly', { version: info.version });
	let date: string;
	try {
		date = new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' })
			.format(info.deployedAt);
	} catch {
		// An unknown language tag is not a reason to lose the date: fall back to the platform's.
		date = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' })
			.format(info.deployedAt);
	}
	return translate('footer.versionDeployed', { version: info.version, date });
}

/**
 * The mark every link that leaves this site carries, drawn exactly as the footer's own (see
 * index.html). A screen reader is told about the new window by the link's accessible name; this
 * is the same promise for somebody who is looking at it, and it is decorative on purpose.
 */
function externalMark(doc: Document): SVGElement {
	const NS = 'http://www.w3.org/2000/svg';
	const svg = doc.createElementNS(NS, 'svg');
	svg.setAttribute('class', 'version-details__icon');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	for (const d of ['M14 5h5v5', 'M10 14 19 5', 'M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4']) {
		const path = doc.createElementNS(NS, 'path');
		path.setAttribute('d', d);
		svg.appendChild(path);
	}
	return svg;
}

/**
 * The dialog's body: what this build is, and the way to read the commit behind it.
 *
 * Built as elements rather than as markup so nothing from the server is ever parsed as HTML, and
 * so the link carries the same "opens in a new window" courtesy as the rest of the footer.
 */
export function buildVersionDetails(
	info: BuildVersion,
	translate: Translate,
	language: string,
	doc: Document = document,
): HTMLElement {
	const container = doc.createElement('div');
	container.className = 'version-details';

	const deployment = doc.createElement('p');
	deployment.textContent = deploymentSentence(info, translate, language);
	container.appendChild(deployment);

	if (info.commit) {
		const commit = doc.createElement('p');
		if (info.commitUrl) {
			const link = doc.createElement('a');
			link.className = 'version-details__link';
			link.href = info.commitUrl;
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
			link.textContent = translate('footer.versionCommit', { commit: info.commit });
			link.setAttribute(
				'aria-label', translate('footer.versionCommitNewWindowLabel', { commit: info.commit }));
			link.appendChild(externalMark(doc));
			commit.appendChild(link);
		} else {
			// The build knows what it was made from; this deployment just cannot point at it.
			commit.textContent = translate('footer.versionCommitPlain', { commit: info.commit });
		}
		container.appendChild(commit);
	}

	return container;
}

/**
 * Open the dialog. A reading dialog: its content is two sentences and a link to follow, so it is
 * marked as a document (screen readers then land in browse mode and read the whole thing) rather
 * than as a set of controls to operate.
 */
export function showVersionDialog(
	info: BuildVersion,
	translate: Translate,
	language: string,
	opener?: HTMLElement | string,
): void {
	dialogManager.show({
		title: translate('footer.versionTitle'),
		titleI18nKey: 'footer.versionTitle',
		contentElement: buildVersionDetails(info, translate, language),
		className: 'dialog-version',
		documentMode: true,
		returnFocusTo: opener,
		buttons: [
			{
				label: translate('common.close'),
				i18nKey: 'common.close',
				variant: 'secondary',
				action: () => dialogManager.close(),
			},
		],
	});
}

/**
 * Reveal the footer entry and label it with the stamp. Returns whether anything was shown, which
 * is what the tests asserting the quiet case care about.
 *
 * The entry is deliberately not a live region and is never re-read: it is a fact stated once, on
 * arrival, like the rest of the footer.
 */
export function renderVersion(
	host: HTMLElement | null,
	info: BuildVersion | null,
	translate: Translate,
	onOpen: (opener: HTMLElement) => void,
): boolean {
	if (!host) return false;
	const button = host.querySelector('button');
	if (!button) return false;
	if (!info) {
		host.hidden = true;
		button.textContent = '';
		return false;
	}
	button.textContent = translate('footer.version', { version: info.version });
	// Assigned rather than added: rendering twice (a language change, a re-read of the stamp) must
	// leave ONE handler behind, not two dialogs opening on top of each other.
	button.onclick = () => onOpen(button);
	host.hidden = false;
	return true;
}

/**
 * Ask the server once and paint the answer. Every failure — offline, a 500, a body that is not
 * JSON — is the quiet case: the footer says nothing, exactly as it did before anybody thought to
 * stamp a build.
 */
export async function initializeBuildVersion(
	host: HTMLElement | null,
	translate: Translate,
	language: () => string,
	fetchImpl: typeof fetch = fetch,
): Promise<BuildVersion | null> {
	let info: BuildVersion | null = null;
	try {
		const response = await fetchImpl('/api/config/version', { headers: { Accept: 'application/json' } });
		if (response.ok) info = parseBuildVersion(await response.json());
	} catch {
		// Nothing to report and nothing to say about it: the lobby works either way.
	}
	renderVersion(host, info, translate, (opener) => {
		// Read at open time, not at load time: the language is a preference the player can change.
		if (info) showVersionDialog(info, translate, language(), opener);
	});
	return info;
}

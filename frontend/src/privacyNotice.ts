// privacyNotice.ts — this deployment's privacy notice, if it has one.
//
// Storing an email address makes whoever runs the server a data controller, and saying who that is
// is a legal obligation rather than a courtesy. The obligation belongs to the DEPLOYMENT, not to
// Corro, so the notice appears only when a host has filled in who they are (see PrivacyOptions);
// a server nobody can sign in to collects nothing and owes nothing. An empty "Privacy" link would
// be worse than none — it looks like an answer.
//
// The text is a document to READ, so it opens the way the board guide does: rendered from markdown
// into the dialog's documentMode, where a screen reader lands in browse mode and reads it as an
// ordinary page instead of a widget with one focusable control.

import { renderMarkdown } from './boardHelp.js';
import { dialogManager } from './dialogManager.js';
import { i18nBinder, tSync } from './i18nBinder.js';

interface PrivacyNotice {
	configured: boolean;
	/** A host who publishes their own policy elsewhere: link out instead of showing ours. */
	url?: string;
	markdown?: string;
}

/** Ask the server what this deployment says about itself. Never throws: no notice is a state. */
export async function loadPrivacyNotice(
	request: typeof fetch = fetch,
	language = 'en',
): Promise<PrivacyNotice> {
	try {
		const response = await request(`/api/config/privacy?language=${encodeURIComponent(language)}`, {
			headers: { Accept: 'application/json' },
		});
		if (!response.ok) return { configured: false };
		const body = await response.json() as PrivacyNotice;
		return body?.configured ? body : { configured: false };
	} catch {
		return { configured: false };
	}
}

/**
 * Reveal the footer entry when there is something behind it, and open the notice when it is
 * pressed. A deployment that says nothing keeps the entry hidden, so nobody is offered a door
 * into an empty room.
 */
export async function initPrivacyNotice(
	loader: typeof loadPrivacyNotice = loadPrivacyNotice,
): Promise<void> {
	const item = document.getElementById('privacy-link-item');
	const button = document.getElementById('privacy-link');
	if (!item || !button) return;

	const notice = await loader(fetch, i18nBinder.getCurrentLanguage());
	if (!notice.configured) return;

	item.hidden = false;
	button.addEventListener('click', () => {
		if (notice.url) {
			window.open(notice.url, '_blank', 'noopener,noreferrer');
			return;
		}
		showPrivacyNotice(notice.markdown ?? '');
	});
}

/** Open the notice as a reading dialog (see documentMode in dialogManager). */
export function showPrivacyNotice(markdown: string): void {
	const content = document.createElement('div');
	content.className = 'privacy-notice';
	content.innerHTML = renderMarkdown(markdown, tSync('game.help_contents'));

	dialogManager.init();
	dialogManager.show({
		title: tSync('footer.privacy'),
		contentElement: content,
		// A document, not a set of controls: browse mode reads it, and the close button is not
		// wrapped in an application that would swallow the text around it.
		documentMode: true,
		modal: true,
		buttons: [{ label: 'Close', i18nKey: 'common.close', variant: 'secondary', action: () => dialogManager.close() }],
	});
}

// privacyNotice.ts — this deployment's privacy notice, if it has one.
//
// Account-less play still processes chosen names, seat credentials, game records, chat and
// technical connection data; signing in adds profile and provider data. Saying who controls that
// data is an obligation of the DEPLOYMENT, not of Corro, so the notice appears only when a host has
// filled in who they are (see PrivacyOptions). The empty state supports local development, but is
// not a claim that a public account-less server needs no notice. A link to an empty notice would be
// worse than none — it looks like an answer.
//
// The footer exposes an ordinary link. The built-in notice lives on its own localized page; a host
// that supplies PolicyUrl gets a link straight to that page instead.

import { i18nBinder } from './i18nBinder.js';

export interface PrivacyNotice {
	configured: boolean;
	/** A host who publishes their own policy elsewhere: link out instead of showing ours. */
	url?: string;
	markdown?: string;
}

export function privacyPagePath(language: string): string {
	return language === 'es' ? '/es/privacy/' : '/privacy/';
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
		if (!body?.configured) return { configured: false };
		if (typeof body.url === 'string' && body.url.trim()) {
			return { configured: true, url: body.url };
		}
		if (typeof body.markdown === 'string' && body.markdown.trim()) {
			return { configured: true, markdown: body.markdown };
		}
		return { configured: false };
	} catch {
		return { configured: false };
	}
}

/**
 * Reveal the footer entry when there is something behind it. A deployment that says nothing keeps
 * the entry hidden, so nobody is offered a link to an unavailable document.
 */
export async function initPrivacyNotice(
	loader: typeof loadPrivacyNotice = loadPrivacyNotice,
): Promise<void> {
	const item = document.getElementById('privacy-link-item');
	const link = document.getElementById('privacy-link') as HTMLAnchorElement | null;
	if (!item || !link) return;

	const language = i18nBinder.getCurrentLanguage();
	const notice = await loader(fetch, language);
	if (!notice.configured) return;

	link.href = notice.url ?? privacyPagePath(language);
	item.hidden = false;
}

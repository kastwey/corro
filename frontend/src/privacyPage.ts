// privacyPage.ts — load the deployment's notice into its own ordinary document page.

import { renderMarkdown } from './boardHelp.js';
import { i18nBinder } from './i18nBinder.js';
import { loadPrivacyNotice, type PrivacyNotice } from './privacyNotice.js';
import { applyTheme, currentTheme, initThemeToggle } from './themeToggle.js';

/** The API document supplies its own H1; the page shell already has the localized H1. */
export function renderPrivacyBody(markdown: string, contentsLabel: string): string {
	const withoutTitle = markdown
		.replace(/^\uFEFF/, '')
		.replace(/^\s*#\s+[^\r\n]+(?:\r?\n|$)/, '');
	return renderMarkdown(withoutTitle, contentsLabel);
}

function pageLanguage(): 'en' | 'es' {
	return document.documentElement.lang === 'es' ? 'es' : 'en';
}

function rememberLanguageFromLinks(): void {
	document.querySelectorAll<HTMLAnchorElement>('[data-locale-link]').forEach(link => {
		link.addEventListener('click', () => {
			const language = link.dataset.localeLink;
			if (language === 'en' || language === 'es') i18nBinder.rememberLanguage(language);
		});
	});
}

function initializeThemeToggle(): void {
	const mount = document.getElementById('privacy-theme-toggle');
	if (!mount) return;

	applyTheme(currentTheme());
	initThemeToggle(mount, {
		toLight: mount.dataset.themeToLight ?? 'Switch to light theme',
		toDark: mount.dataset.themeToDark ?? 'Switch to dark theme',
	});
}

export async function initPrivacyPage(
	loader: typeof loadPrivacyNotice = loadPrivacyNotice,
): Promise<PrivacyNotice> {
	const main = document.getElementById('privacy-main');
	const loading = document.getElementById('privacy-loading');
	const documentContent = document.getElementById('privacy-document');
	const unavailable = document.getElementById('privacy-unavailable');
	const external = document.getElementById('privacy-external');
	const externalLink = document.getElementById('privacy-external-link') as HTMLAnchorElement | null;
	if (!main || !loading || !documentContent || !unavailable || !external || !externalLink) {
		return { configured: false };
	}

	rememberLanguageFromLinks();
	initializeThemeToggle();

	const language = pageLanguage();
	const notice = await loader(fetch, language);
	loading.hidden = true;

	if (notice.markdown) {
		documentContent.innerHTML = renderPrivacyBody(
			notice.markdown,
			main.dataset.contentsLabel ?? (language === 'es' ? 'Contenido' : 'Contents'),
		);
		documentContent.hidden = false;
	} else if (notice.url) {
		externalLink.href = notice.url;
		external.hidden = false;
	} else {
		unavailable.hidden = false;
	}

	main.setAttribute('aria-busy', 'false');
	return notice;
}

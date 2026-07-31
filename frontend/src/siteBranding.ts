export interface SiteBranding {
	readonly title: string;
	readonly tagline: string | null;
	readonly taglines: Readonly<Record<string, string>>;
	readonly logoUrl: string | null;
	readonly logoDarkUrl: string | null;
	readonly faviconUrl: string | null;
	readonly faviconDarkUrl: string | null;
}

export const DEFAULT_SITE_BRANDING: SiteBranding = Object.freeze({
	title: 'All Welcome',
	tagline: null,
	taglines: Object.freeze({
		en: 'Play together, play your way.',
		es: 'Juega en compañía, juega a tu manera.',
	}),
	logoUrl: 'assets/brand/all-welcome-logo-on-light.svg',
	logoDarkUrl: 'assets/brand/all-welcome-logo-on-dark.svg',
	faviconUrl: 'assets/brand/all-welcome-favicon-light.svg',
	faviconDarkUrl: 'assets/brand/all-welcome-favicon-dark.svg',
});

const MAX_TITLE_LENGTH = 80;
const MAX_TAGLINE_LENGTH = 160;
const MAX_ASSET_URL_LENGTH = 2048;

function text(value: unknown, maxLength: number, trim = true): string | null {
	if (typeof value !== 'string') return null;
	const normalized = trim ? value.trim() : value;
	return normalized.trim() && normalized.length <= maxLength ? normalized : null;
}

/** `null` delegates to localized values; an empty configured string deliberately hides the line. */
function optionalText(value: unknown, maxLength: number): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string' || value !== value.trim() || value.length > maxLength) return null;
	return value;
}

function localizedTextMap(value: unknown): Readonly<Record<string, string>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return DEFAULT_SITE_BRANDING.taglines;
	}
	const localized: Record<string, string> = Object.create(null);
	for (const [rawLocale, rawText] of Object.entries(value)) {
		const locale = rawLocale.trim().toLowerCase();
		const content = optionalText(rawText, MAX_TAGLINE_LENGTH);
		if (!locale || locale.length > 35
			|| locale === '__proto__' || locale === 'prototype' || locale === 'constructor'
			|| !content) continue;
		localized[locale] = content;
	}
	return Object.freeze({ ...localized });
}

function configuredAsset(
	input: Record<string, unknown>,
	key: string,
	fallback: string | null,
): string | null {
	return input[key] === undefined ? fallback : assetUrl(input[key]);
}

function assetUrl(value: unknown): string | null {
	const url = text(value, MAX_ASSET_URL_LENGTH);
	if (!url || url.startsWith('//') || url.includes('\\')) return null;
	const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(url))?.[1]?.toLowerCase();
	return !scheme || scheme === 'https' ? url : null;
}

/** Treat the server payload as untrusted input so a broken proxy cannot corrupt the shell UI. */
export function normalizeSiteBranding(value: unknown): SiteBranding {
	const input = value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		title: text(input.title, MAX_TITLE_LENGTH) ?? DEFAULT_SITE_BRANDING.title,
		tagline: optionalText(input.tagline, MAX_TAGLINE_LENGTH),
		taglines: localizedTextMap(input.taglines),
		logoUrl: configuredAsset(input, 'logoUrl', DEFAULT_SITE_BRANDING.logoUrl),
		logoDarkUrl: configuredAsset(input, 'logoDarkUrl', DEFAULT_SITE_BRANDING.logoDarkUrl),
		faviconUrl: configuredAsset(input, 'faviconUrl', DEFAULT_SITE_BRANDING.faviconUrl),
		faviconDarkUrl: configuredAsset(input, 'faviconDarkUrl', DEFAULT_SITE_BRANDING.faviconDarkUrl),
	};
}

export function siteTagline(branding: SiteBranding, language: string): string {
	if (branding.tagline !== null) return branding.tagline;
	const locale = language.toLowerCase();
	const base = locale.split('-')[0];
	return branding.taglines[locale]
		?? branding.taglines[base]
		?? branding.taglines.en
		?? Object.values(branding.taglines)[0]
		?? '';
}

export async function loadSiteBranding(request: typeof fetch = fetch): Promise<SiteBranding> {
	try {
		const response = await request('/api/config/branding', {
			headers: { Accept: 'application/json' },
		});
		if (!response.ok) throw new Error(`Branding request failed with status ${response.status}.`);
		return normalizeSiteBranding(await response.json());
	} catch (error) {
		console.warn('Could not load site branding; using the built-in identity.', error);
		return DEFAULT_SITE_BRANDING;
	}
}

function themedPair(primary: string | null, dark: string | null): [string, string] | null {
	if (!primary && !dark) return null;
	return [primary ?? dark!, dark ?? primary!];
}

function renderLogo(document: Document, branding: SiteBranding): void {
	const pair = themedPair(branding.logoUrl, branding.logoDarkUrl);
	document.querySelectorAll<HTMLElement>('[data-site-logo]').forEach(container => {
		container.replaceChildren();
		container.hidden = !pair;
		const heading = container.closest<HTMLHeadingElement>('h1');
		const title = heading?.querySelector<HTMLElement>('[data-site-title]');
		title?.classList.toggle('sr-only', !!pair);
		if (!pair) return;

		const addImage = (url: string, modifier?: string) => {
			const image = document.createElement('img');
			image.className = `brand-logo__image${modifier ? ` brand-logo__image--${modifier}` : ''}`;
			image.setAttribute('src', url);
			image.setAttribute('width', '420');
			image.setAttribute('height', '120');
			image.setAttribute('alt', '');
			container.append(image);
		};

		if (pair[0] === pair[1]) {
			addImage(pair[0]);
		} else {
			addImage(pair[0], 'light');
			addImage(pair[1], 'dark');
		}
	});
}

function renderFavicons(document: Document, branding: SiteBranding): void {
	document.querySelectorAll('link[data-site-favicon]').forEach(icon => icon.remove());
	const pair = themedPair(branding.faviconUrl, branding.faviconDarkUrl);
	if (!pair) return;

	const addIcon = (url: string, media?: string) => {
		const icon = document.createElement('link');
		icon.rel = 'icon';
		icon.setAttribute('href', url);
		icon.dataset.siteFavicon = '';
		if (media) icon.media = media;
		document.head.append(icon);
	};

	if (pair[0] === pair[1]) {
		addIcon(pair[0]);
	} else {
		addIcon(pair[0], '(prefers-color-scheme: light)');
		addIcon(pair[1], '(prefers-color-scheme: dark)');
	}
}

export function applySiteBranding(
	branding: SiteBranding,
	document: Document = window.document,
	language = document.documentElement.lang || 'en',
): void {
	document.title = branding.title;
	document.querySelectorAll<HTMLElement>('[data-site-title]').forEach(title => {
		title.textContent = branding.title;
	});
	document.querySelectorAll<HTMLElement>('[data-site-tagline]').forEach(tagline => {
		const content = siteTagline(branding, language);
		tagline.textContent = content;
		tagline.hidden = !content;
	});
	renderLogo(document, branding);
	renderFavicons(document, branding);
}

export async function initializeSiteBranding(
	document: Document = window.document,
	request: typeof fetch = fetch,
	getLanguage: () => string = () => document.documentElement.lang || 'en',
): Promise<SiteBranding> {
	const branding = await loadSiteBranding(request);
	const apply = () => applySiteBranding(branding, document, getLanguage());
	apply();
	document.addEventListener('languageChanged', apply);
	return branding;
}
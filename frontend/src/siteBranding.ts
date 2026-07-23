export interface SiteBranding {
	readonly title: string;
	readonly tagline: string | null;
	readonly logoUrl: string | null;
	readonly logoDarkUrl: string | null;
	readonly faviconUrl: string | null;
	readonly faviconDarkUrl: string | null;
}

export const DEFAULT_SITE_BRANDING: SiteBranding = Object.freeze({
	title: 'All Welcome',
	tagline: 'Play together, play your way.',
	logoUrl: null,
	logoDarkUrl: null,
	faviconUrl: null,
	faviconDarkUrl: null,
});

const MAX_TITLE_LENGTH = 80;
const MAX_TAGLINE_LENGTH = 160;
const MAX_ASSET_URL_LENGTH = 2048;

function text(value: unknown, maxLength: number, trim = true): string | null {
	if (typeof value !== 'string') return null;
	const normalized = trim ? value.trim() : value;
	return normalized.trim() && normalized.length <= maxLength ? normalized : null;
}

function assetUrl(value: unknown): string | null {
	const url = text(value, MAX_ASSET_URL_LENGTH);
	if (!url || url.startsWith('//') || url.includes('\\')) return null;
	const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
	return !scheme || scheme === 'https' ? url : null;
}

/** Treat the server payload as untrusted input so a broken proxy cannot corrupt the shell UI. */
export function normalizeSiteBranding(value: unknown): SiteBranding {
	const input = value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		title: text(input.title, MAX_TITLE_LENGTH) ?? DEFAULT_SITE_BRANDING.title,
		tagline: text(input.tagline, MAX_TAGLINE_LENGTH, false),
		logoUrl: assetUrl(input.logoUrl),
		logoDarkUrl: assetUrl(input.logoDarkUrl),
		faviconUrl: assetUrl(input.faviconUrl),
		faviconDarkUrl: assetUrl(input.faviconDarkUrl),
	};
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

export function applySiteBranding(branding: SiteBranding, document: Document = window.document): void {
	document.title = branding.title;
	document.querySelectorAll<HTMLElement>('[data-site-title]').forEach(title => {
		title.textContent = branding.title;
	});
	document.querySelectorAll<HTMLElement>('[data-site-tagline]').forEach(tagline => {
		tagline.textContent = branding.tagline ?? '';
		tagline.hidden = !branding.tagline;
	});
	renderLogo(document, branding);
	renderFavicons(document, branding);
}

export async function initializeSiteBranding(
	document: Document = window.document,
	request: typeof fetch = fetch,
): Promise<SiteBranding> {
	const branding = await loadSiteBranding(request);
	applySiteBranding(branding, document);
	return branding;
}
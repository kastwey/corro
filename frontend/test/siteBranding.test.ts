import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
	applySiteBranding,
	DEFAULT_SITE_BRANDING,
	loadSiteBranding,
	normalizeSiteBranding,
} from '../src/siteBranding.js';

function shellDocument(): Document {
	return new JSDOM(`<!doctype html><html><head><title>Fallback</title></head><body>
		<h1><span data-site-title>Fallback</span><span data-site-logo aria-hidden="true" hidden></span></h1>
		<p data-site-tagline>Fallback tagline</p>
	</body></html>`).window.document;
}

test('the browser fallback matches the deployment defaults in appsettings', () => {
	const appsettings = JSON.parse(readFileSync(
		fileURLToPath(new URL('../../server/appsettings.json', import.meta.url)),
		'utf8',
	));
	const configured = appsettings.SiteBranding;
	assert.deepEqual(DEFAULT_SITE_BRANDING, {
		title: configured.Title,
		tagline: configured.Tagline,
		logoUrl: configured.LogoUrl,
		logoDarkUrl: configured.LogoDarkUrl,
		faviconUrl: configured.FaviconUrl,
		faviconDarkUrl: configured.FaviconDarkUrl,
	});
});

test('normalization accepts deployment text and safe local or HTTPS assets', () => {
	assert.deepEqual(normalizeSiteBranding({
		title: '  Community Games  ',
		tagline: 'Everyone has a place.',
		logoUrl: 'assets/host/logo.svg',
		logoDarkUrl: 'https://cdn.example.org/logo-dark.svg',
		faviconUrl: '/assets/host/favicon.svg',
	}), {
		title: 'Community Games',
		tagline: 'Everyone has a place.',
		logoUrl: 'assets/host/logo.svg',
		logoDarkUrl: 'https://cdn.example.org/logo-dark.svg',
		faviconUrl: '/assets/host/favicon.svg',
		faviconDarkUrl: null,
	});
});

test('normalization falls back safely and rejects executable or mixed-content URLs', () => {
	const normalized = normalizeSiteBranding({
		title: ' ',
		tagline: 42,
		logoUrl: 'javascript:alert(1)',
		logoDarkUrl: 'http://cdn.example.org/logo.svg',
		faviconUrl: '//cdn.example.org/favicon.svg',
		faviconDarkUrl: 'assets\\favicon.svg',
	});

	assert.deepEqual(normalized, {
		...DEFAULT_SITE_BRANDING,
		tagline: null,
	});
});

test('loading returns normalized server branding', async () => {
	const request = async () => new Response(JSON.stringify({
		title: 'Hosted Games',
		tagline: 'Play here.',
	}), { status: 200, headers: { 'Content-Type': 'application/json' } });

	assert.deepEqual(await loadSiteBranding(request as typeof fetch), {
		...DEFAULT_SITE_BRANDING,
		title: 'Hosted Games',
		tagline: 'Play here.',
	});
});

test('loading keeps the site usable when configuration is unavailable', async () => {
	const request = async () => new Response('', { status: 503 });
	const originalWarn = console.warn;
	console.warn = () => {};
	try {
		assert.equal(await loadSiteBranding(request as typeof fetch), DEFAULT_SITE_BRANDING);
	} finally {
		console.warn = originalWarn;
	}
});

test('text branding updates title and tagline when deployment assets are omitted', () => {
	const document = shellDocument();
	applySiteBranding({
		...DEFAULT_SITE_BRANDING,
		logoUrl: null,
		logoDarkUrl: null,
		faviconUrl: null,
		faviconDarkUrl: null,
	}, document);

	assert.equal(document.title, 'All Welcome');
	assert.equal(document.querySelector('[data-site-title]')?.textContent, 'All Welcome');
	assert.equal(document.querySelector('[data-site-title]')?.classList.contains('sr-only'), false);
	assert.equal(document.querySelector('[data-site-tagline]')?.textContent, 'Play together, play your way.');
	assert.ok(document.querySelector<HTMLElement>('[data-site-logo]')?.hidden);
	assert.equal(document.querySelectorAll('link[rel="icon"]').length, 0);
});

test('one logo remains decorative and becomes the visual replacement for the text title', () => {
	const document = shellDocument();
	applySiteBranding({
		...DEFAULT_SITE_BRANDING,
		logoUrl: 'assets/host/logo.svg',
		logoDarkUrl: null,
		faviconUrl: null,
		faviconDarkUrl: null,
		tagline: null,
	}, document);

	const logo = document.querySelector<HTMLElement>('[data-site-logo]')!;
	assert.equal(logo.hidden, false);
	assert.equal(logo.getAttribute('aria-hidden'), 'true');
	assert.equal(logo.querySelectorAll('img').length, 1);
	assert.equal(logo.querySelector('img')?.getAttribute('src'), 'assets/host/logo.svg');
	assert.equal(logo.querySelector('img')?.getAttribute('alt'), '');
	assert.ok(document.querySelector('[data-site-title]')?.classList.contains('sr-only'));
	assert.ok(document.querySelector<HTMLElement>('[data-site-tagline]')?.hidden);
});

test('light and dark logos and favicons are rendered as theme-aware pairs', () => {
	const document = shellDocument();
	applySiteBranding({
		...DEFAULT_SITE_BRANDING,
		logoUrl: 'assets/host/logo-light.svg',
		logoDarkUrl: 'assets/host/logo-dark.svg',
		faviconUrl: 'assets/host/favicon-light.svg',
		faviconDarkUrl: 'assets/host/favicon-dark.svg',
	}, document);

	const images = [...document.querySelectorAll<HTMLImageElement>('[data-site-logo] img')];
	assert.deepEqual(images.map(image => ({ src: image.getAttribute('src'), className: image.className })), [
		{ src: 'assets/host/logo-light.svg', className: 'brand-logo__image brand-logo__image--light' },
		{ src: 'assets/host/logo-dark.svg', className: 'brand-logo__image brand-logo__image--dark' },
	]);
	const icons = [...document.querySelectorAll<HTMLLinkElement>('link[data-site-favicon]')];
	assert.deepEqual(icons.map(icon => ({ href: icon.getAttribute('href'), media: icon.media })), [
		{ href: 'assets/host/favicon-light.svg', media: '(prefers-color-scheme: light)' },
		{ href: 'assets/host/favicon-dark.svg', media: '(prefers-color-scheme: dark)' },
	]);
});
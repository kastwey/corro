// themeToggle.ts — accessible light/dark theme switch.
//
// The theme is applied to <html data-theme="..."> and persisted in
// localStorage. An inline script in board.html applies it before paint to
// avoid a flash; this module keeps the toggle button in sync.

import { tSync } from './i18nBinder.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

const STORAGE_KEY = 'corro-theme';
type Theme = 'light' | 'dark';

const SUN_ICON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
	'stroke-linecap="round" aria-hidden="true" focusable="false">' +
	'<circle cx="12" cy="12" r="4"/>' +
	'<path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>' +
	'</svg>';

const MOON_ICON =
	'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
	'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>' +
	'</svg>';

function readStored(): Theme | null {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === 'dark' || v === 'light' ? v : null;
	} catch {
		return null;
	}
}

function systemPreference(): Theme {
	return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme(): Theme {
	return (document.documentElement.getAttribute('data-theme') as Theme) || readStored() || systemPreference();
}

export function applyTheme(theme: Theme): void {
	document.documentElement.setAttribute('data-theme', theme);
}

export function initThemeToggle(mount: HTMLElement): void {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.id = 'theme-toggle';
	btn.className = 'icon-btn';

	const sync = () => {
		const isDark = currentTheme() === 'dark';
		btn.innerHTML = isDark ? SUN_ICON : MOON_ICON;
		btn.setAttribute('aria-pressed', String(isDark));
		const label = isDark ? t('theme_to_light') : t('theme_to_dark');
		btn.setAttribute('aria-label', label);
		btn.title = label;
	};

	btn.addEventListener('click', () => {
		const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
		applyTheme(next);
		try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
		sync();
	});

	mount.appendChild(btn);
	sync();

	// The action label is set imperatively (not via data-i18n), so applyI18n never reaches it on
	// a runtime language switch. Re-run sync() on `languageChanged` so it re-translates; sync()
	// reads the current theme from the DOM, so it needs no arguments.
	document.addEventListener('languageChanged', sync);
}

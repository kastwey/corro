import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { initThemeToggle } from '../src/themeToggle.js';

/**
 * DOM regression tests for the header light/dark theme toggle: what it renders, what its action
 * label says, and that pressing it flips both the theme and the label. Its label is set
 * imperatively rather than via data-i18n, which is fine because a language is a property of the
 * page it was loaded into and never changes under it (see i18nBinder.ts).
 */

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	document.body.innerHTML = '';
	document.documentElement.removeAttribute('data-theme');
	// The click test persists 'dark' to localStorage; clear it so each test starts from the
	// light default (currentTheme() falls back to stored preference when no data-theme is set).
	try { localStorage.clear(); } catch { /* ignore */ }
	installFakeI18next('en');
});

function mountToggle(): HTMLButtonElement {
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	initThemeToggle(mount);
	return document.getElementById('theme-toggle') as HTMLButtonElement;
}

test('renders an icon button reflecting the light theme (offers switching to dark)', () => {
	const btn = mountToggle();
	assert.ok(btn, 'button exists');
	assert.equal(btn.type, 'button');
	assert.equal(btn.className, 'icon-btn');
	assert.ok(btn.querySelector('svg'), 'has an icon');
	assert.equal(btn.getAttribute('aria-label'), 'Switch to dark theme');
	assert.equal(btn.title, 'Switch to dark theme');
	// NOT a toggle button: the name changes with the theme, so aria-pressed would be a
	// second, conflicting account of the same fact ("switch to light theme, pressed").
	assert.equal(btn.getAttribute('aria-pressed'), null);
});

test('clicking flips the theme and the action label', () => {
	const btn = mountToggle();
	btn.click();
	assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
	assert.equal(btn.getAttribute('aria-pressed'), null);
	assert.equal(btn.getAttribute('aria-label'), 'Switch to light theme');
});

test('a pre-translated page can supply labels without initializing runtime i18n', () => {
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	initThemeToggle(mount, { toLight: 'Claro', toDark: 'Oscuro' });
	const btn = document.getElementById('theme-toggle') as HTMLButtonElement;

	assert.equal(btn.getAttribute('aria-label'), 'Oscuro');
	btn.click();
	assert.equal(btn.getAttribute('aria-label'), 'Claro');
});


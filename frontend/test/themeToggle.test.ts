import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { initThemeToggle } from '../src/themeToggle.js';

/**
 * DOM regression tests for the header light/dark theme toggle. Beyond the basic render/label,
 * this guards the reported bug: switching language at runtime left the toggle's action label in
 * the old language until a hard reload. Its label is set imperatively (not via data-i18n), so
 * the toggle must re-translate itself when `languageChanged` fires.
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
	assert.equal(btn.getAttribute('aria-pressed'), 'false');
	assert.equal(btn.getAttribute('aria-label'), 'Switch to dark theme');
	assert.equal(btn.title, 'Switch to dark theme');
});

test('clicking flips the theme and the action label', () => {
	const btn = mountToggle();
	btn.click();
	assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
	assert.equal(btn.getAttribute('aria-pressed'), 'true');
	assert.equal(btn.getAttribute('aria-label'), 'Switch to light theme');
});

test('re-translates its label on a runtime language change (regression: stale until reload)', () => {
	const btn = mountToggle();
	assert.equal(btn.getAttribute('aria-label'), 'Switch to dark theme');

	// Simulate the lobby applying Spanish at runtime: i18next swaps, then languageChanged fires.
	installFakeI18next('es');
	document.dispatchEvent(new window.CustomEvent('languageChanged', { bubbles: true }));

	assert.equal(btn.getAttribute('aria-label'), 'Cambiar a tema oscuro');
	assert.equal(btn.title, 'Cambiar a tema oscuro');
});

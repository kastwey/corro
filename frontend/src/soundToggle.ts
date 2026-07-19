// soundToggle.ts — accessible on/off switch for the game-event sound effects.
//
// Mirrors themeToggle.ts: an icon button mounted in the header so a mouse/touch user
// (not only the keyboard shortcut) can mute/unmute. The button reflects the current
// state via aria-pressed and a localized action label; the actual toggle + spoken
// announcement live in app.ts (single source of truth) and call sync() to repaint.

import { tSync } from './i18nBinder.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

const SOUND_ON_ICON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
	'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
	'<path d="M11 5 6 9H2v6h4l5 4z"/>' +
	'<path d="M15.5 8.5a5 5 0 0 1 0 7"/>' +
	'<path d="M18.5 5.5a9 9 0 0 1 0 13"/>' +
	'</svg>';

const SOUND_OFF_ICON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
	'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
	'<path d="M11 5 6 9H2v6h4l5 4z"/>' +
	'<path d="M22 9l-6 6M16 9l6 6"/>' +
	'</svg>';

export interface SoundToggleController {
	/**
	 * Repaint the button. `muted` is the user's on/off preference; `blocked` is true when
	 * the browser is still preventing audio from playing (typically iOS/Safari before a
	 * direct interaction), in which case the button shows a "tap to enable" hint.
	 */
	sync(muted: boolean, blocked?: boolean): void;
}

export interface SoundToggleOptions {
	initialMuted: boolean;
	/** Whether the browser is currently blocking audio (needs a gesture to unlock). */
	initialBlocked?: boolean;
	/** Invoked on click. The handler flips the mute state and calls sync(). */
	onToggle: () => void;
}

export function initSoundToggle(mount: HTMLElement, opts: SoundToggleOptions): SoundToggleController {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.id = 'sound-toggle';
	btn.className = 'icon-btn';

	// Remember the last state so a language switch can repaint the label without new state.
	let lastMuted = opts.initialMuted;
	let lastBlocked = opts.initialBlocked ?? false;

	const sync = (muted: boolean, blocked = false) => {
		lastMuted = muted;
		lastBlocked = blocked;
		// "Blocked" only matters when the player actually wants sound: a muted player
		// chose silence, so we show the plain off state for them.
		const showBlocked = blocked && !muted;
		btn.innerHTML = (muted || showBlocked) ? SOUND_OFF_ICON : SOUND_ON_ICON;
		btn.classList.toggle('is-sound-blocked', showBlocked);
		// aria-pressed reflects whether sounds are actually ON (unmuted AND unblocked).
		btn.setAttribute('aria-pressed', String(!muted && !blocked));
		// Label describes the action a click performs. When blocked, it nudges the user to
		// tap to unlock; otherwise it mirrors the theme toggle (enable / disable).
		const label = showBlocked
			? t('sound_toggle_unlock')
			: muted ? t('sound_toggle_enable') : t('sound_toggle_disable');
		btn.setAttribute('aria-label', label);
		btn.title = label;
	};

	btn.addEventListener('click', () => opts.onToggle());

	mount.appendChild(btn);
	sync(opts.initialMuted, opts.initialBlocked ?? false);

	// The action label is set imperatively (not via data-i18n): repaint it on a runtime language
	// switch, reusing the last-known mute/blocked state.
	document.addEventListener('languageChanged', () => sync(lastMuted, lastBlocked));

	return { sync };
}

// boardHelp.ts — the board's in-game guide (rules + how to play), shipped by the package as
// help.{lang}.md and rendered to HTML here. Opened with F1 or the header Help button, so a player
// who doesn't know the board can read what it's about. The app's keyboard shortcuts live in their
// own dialog (helpDialog.ts), reached with Ctrl+F1.

import { dialogManager } from './dialogManager.js';
import { tSync } from './i18nBinder.js';
import { escapeHtml } from './escapeHtml.js';

/** The rendered help HTML for the active board, or null when the package ships no guide. */
let helpHtml: string | null = null;

/**
 * A tiny, safe Markdown -> HTML renderer for the package guide. It supports the subset a board
 * guide needs (headings, paragraphs, bullet/numbered lists, bold/italic/code, links, rules) and
 * NOTHING that could inject markup: the text is HTML-escaped first, so the only tags emitted are the
 * ones this function produces, and links are restricted to http(s) URLs. Package content is
 * untrusted (uploads), so this must never pass raw markup through.
 */
export function renderMarkdown(md: string): string {
	const lines = md.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	let para: string[] = [];
	let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

	const flushPara = () => {
		if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
	};
	const flushList = () => {
		if (list) {
			out.push(`<${list.type}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
			list = null;
		}
	};
	const flushAll = () => { flushPara(); flushList(); };

	for (const raw of lines) {
		const line = raw.trim();
		if (line === '') { flushAll(); continue; }

		const heading = /^(#{1,4})\s+(.*)$/.exec(line);
		if (heading) { flushAll(); const lvl = heading[1].length; out.push(`<h${lvl}>${inline(heading[2])}</h${lvl}>`); continue; }

		if (/^([-*_])\1{2,}$/.test(line)) { flushAll(); out.push('<hr>'); continue; }

		const bullet = /^[-*]\s+(.*)$/.exec(line);
		if (bullet) {
			flushPara();
			if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
			list.items.push(bullet[1]);
			continue;
		}
		const ordered = /^\d+\.\s+(.*)$/.exec(line);
		if (ordered) {
			flushPara();
			if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
			list.items.push(ordered[1]);
			continue;
		}

		flushList();
		para.push(line);
	}
	flushAll();
	return out.join('\n');
}

/** Inline formatting on already-escaped text: links (http/https only), bold, italic, code. */
function inline(text: string): string {
	let s = escapeHtml(text);
	s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
		(_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
	s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
	return s;
}

/**
 * Loads the board's guide for the first available language (the player's first), rendering it to
 * HTML. Safe to call once the game's package token is known; clears the guide when none ships.
 */
export async function loadBoardHelp(token: string, langs: string[]): Promise<void> {
	helpHtml = null;
	for (const lang of langs) {
		try {
			const resp = await fetch(`/api/packages/${encodeURIComponent(token)}/help/${encodeURIComponent(lang)}`);
			if (!resp.ok) continue; // package ships no guide for this language
			const md = await resp.text();
			if (md && md.trim()) { helpHtml = renderMarkdown(md); return; }
		} catch (error) {
			console.debug('[help] board guide load failed for', lang, error);
		}
	}
}

/** Whether the active board shipped a guide (used to decide if the Help button is offered). */
export function hasBoardHelp(): boolean {
	return helpHtml !== null;
}

/** Opens the board guide dialog (rendered Markdown), or a short note when the board ships none. */
export function showBoardHelpDialog(): void {
	const body = helpHtml ?? `<p>${escapeHtml(tSync('game.help_board_none'))}</p>`;
	dialogManager.show({
		title: tSync('game.help_board_title'),
		content: `<div class="board-help">${body}</div>`,
		className: 'dialog-help',
		// Reading dialog: the guide reads like a normal page in browse mode (see helpDialog).
		documentMode: true,
		buttons: [{ label: tSync('game.help_close'), variant: 'primary', action: () => dialogManager.close() }],
	});
}

const HELP_ICON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
	'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
	'<circle cx="12" cy="12" r="10"/>' +
	'<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/>' +
	'<line x1="12" y1="17" x2="12" y2="17"/>' +
	'</svg>';

/** Mounts the header Help button so a mouse/touch player (not only F1) can open the board guide. */
export function initHelpButton(mount: HTMLElement): void {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.id = 'help-button';
	btn.className = 'icon-btn';
	const label = tSync('game.help_board_open');
	btn.setAttribute('aria-label', label);
	btn.title = label;
	btn.innerHTML = HELP_ICON;
	btn.addEventListener('click', () => showBoardHelpDialog());
	mount.appendChild(btn);
}

// boardHelp.ts — the board's in-game guide (rules + how to play), shipped by the package as
// help.{lang}.md and rendered to HTML here. Opened with F1 or the header Help button, so a player
// who doesn't know the board can read what it's about. The app's keyboard shortcuts live in their
// own dialog (helpDialog.ts), reached with Ctrl+F1.

import { dialogManager } from './dialogManager.js';
import { tSync } from './i18nBinder.js';
import { escapeHtml } from './escapeHtml.js';

/** The rendered help HTML for the active board, or null when the package ships no guide. */
let helpHtml: string | null = null;

interface MarkdownHeading {
	level: number;
	text: string;
	id: string;
}

/** A stable, human-readable fragment id for a Markdown heading. Package help is untrusted,
 *  so the result deliberately contains only ASCII letters, digits and hyphens. */
function plainHeadingText(text: string): string {
	return text
		.replace(/\[([^\]]+)\]\((?:https?:\/\/|#)[^)]+\)/g, '$1')
		.replace(/[\*_`~]/g, '');
}

function headingSlug(text: string): string {
	const plain = plainHeadingText(text)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return plain || 'section';
}

/** Collect headings once so the generated contents list and the rendered document share the
 *  exact same collision-safe ids. `help-contents` is reserved for the generated heading. */
function collectHeadings(lines: string[]): MarkdownHeading[] {
	const used = new Map<string, number>([['help-contents', 1]]);
	const headings: MarkdownHeading[] = [];
	for (const raw of lines) {
		const match = /^(#{1,4})\s+(.*)$/.exec(raw.trim());
		if (!match) continue;
		const base = headingSlug(match[2]);
		const occurrence = (used.get(base) ?? 0) + 1;
		used.set(base, occurrence);
		headings.push({
			level: match[1].length,
			text: match[2],
			id: occurrence === 1 ? base : `${base}-${occurrence}`,
		});
	}
	return headings;
}

/**
 * A tiny, safe Markdown -> HTML renderer for the package guide. It supports the subset a board
 * guide needs (headings, paragraphs, bullet/numbered lists, bold/italic/code, links, rules) and
 * NOTHING that could inject markup: the text is HTML-escaped first, so the only tags emitted are the
 * ones this function produces, and links are restricted to http(s) URLs or safe local fragments.
 * Package content is untrusted (uploads), so this must never pass raw markup through.
 */
export function renderMarkdown(md: string, contentsLabel = 'Contents'): string {
	const lines = md.replace(/\r\n/g, '\n').split('\n');
	const headings = collectHeadings(lines);
	const sections = headings.filter(h => h.level === 2);
	const out: string[] = [];
	let para: string[] = [];
	let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
	let headingIndex = 0;
	let contentsRendered = false;

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
		if (heading) {
			flushAll();
			const current = headings[headingIndex++];
			// Put the generated contents after the title/intro and immediately before the first
			// real section. Only H2s are listed: H3/H4 remain local detail under their section.
			if (!contentsRendered && current.level >= 2 && sections.length > 0) {
				out.push(
					'<div class="board-help__contents">' +
					`<h2 id="help-contents" tabindex="-1">${escapeHtml(contentsLabel)}</h2>` +
					`<ul>${sections.map(section =>
						`<li><a href="#${section.id}">${escapeHtml(plainHeadingText(section.text))}</a></li>`).join('')}</ul>` +
					'</div>',
				);
				contentsRendered = true;
			}
			out.push(`<h${current.level} id="${current.id}" tabindex="-1">${inline(current.text)}</h${current.level}>`);
			continue;
		}

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

/** Inline formatting on already-escaped text: safe fragment/http(s) links, bold, italic, code. */
function inline(text: string): string {
	let s = escapeHtml(text);
	s = s.replace(/\[([^\]]+)\]\(#([a-z0-9][a-z0-9-]*)\)/gi,
		(_m, label, fragment) => `<a href="#${fragment}">${label}</a>`);
	s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
		(_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
	s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
	return s;
}

/** Focus an in-guide fragment without changing the board page's URL. Moving real DOM focus to
 *  the destination makes the jump meaningful to keyboard and screen-reader users, not merely a
 *  visual scroll. The strict id grammar mirrors headingSlug and keeps querySelector safe. */
export function focusHelpFragment(root: HTMLElement, href: string): boolean {
	const match = /^#([a-z0-9][a-z0-9-]*)$/.exec(href);
	if (!match) return false;
	const target = root.querySelector<HTMLElement>(`[id="${match[1]}"]`);
	if (!target) return false;
	target.focus();
	return true;
}

function wireHelpFragmentLinks(root: HTMLElement): void {
	root.addEventListener('click', event => {
		const origin = event.target as HTMLElement | null;
		const link = origin?.closest<HTMLAnchorElement>('a[href^="#"]');
		if (!link || !root.contains(link)) return;
		if (focusHelpFragment(root, link.getAttribute('href') ?? '')) event.preventDefault();
	});
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
			if (md && md.trim()) { helpHtml = renderMarkdown(md, tSync('game.help_contents')); return; }
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
	const root = document.querySelector<HTMLElement>('#game-dialog .board-help');
	if (root) wireHelpFragmentLinks(root);
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

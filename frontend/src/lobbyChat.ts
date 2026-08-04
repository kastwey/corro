// lobbyChat.ts — writing to people from the lobby.
//
// There is no room to shout into here, and that is deliberate: a general channel in a lobby is a
// stream of strangers talking, which for somebody listening to every line is not a feature. So a
// message goes to the people it NAMES, with "@", and a line that names nobody is refused with the
// reason rather than sent somewhere surprising.
//
// The panel is permanent rather than a dialog. A message arriving must not steal focus or open
// anything, and somebody who wants to write should not have to remember a chord first.
//
// Nothing is stored on the server (see GameHub.DirectMessages). What has been said this session is
// kept in sessionStorage — per tab, gone when it closes — so a reload does not silently lose a
// conversation while still leaving nothing behind on a shared computer.

import { RovingToolbarList } from './accessibleList.js';
import {
	addressMessage,
	completeMention,
	mentionAtCaret,
	resolveRecipients,
} from './mentions.js';

/** One line as it is kept and read back. */
export interface ChatLine {
	/** Who wrote it. */
	readonly from: string;
	/** Everybody it went to, so a reply reaches the same group. */
	readonly to: readonly string[];
	readonly text: string;
	/** True when this reader wrote it. */
	readonly mine: boolean;
}

export interface LobbyChatDeps {
	log: HTMLElement;
	input: HTMLTextAreaElement;
	send: HTMLButtonElement;
	/** Where the outcome of a send is said, once. */
	status: HTMLElement | null;
	/** The floating list of matching names. */
	suggestions: HTMLElement;
	t: (key: string, vars?: Record<string, unknown>) => string;
	/** Public names this reader may write to: who is visible, plus their friends. */
	candidates: () => readonly string[];
	/** Hand the message to the server; resolves with who it actually reached. */
	deliver: (handles: string[], text: string) => Promise<{ delivered: string[]; unreachable: string[] }>;
	/** This reader's own public name, so their own lines read as theirs. */
	me: () => string | null;
	storage?: Storage;
}

const STORAGE_KEY = 'corro.lobbyChat';
const MAX_LINES = 200;

/** Everything said this session, newest last. Capped so a long session cannot grow without end. */
export function readHistory(storage: Storage | undefined): ChatLine[] {
	try {
		const raw = storage?.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isChatLine) : [];
	} catch {
		return [];
	}
}

function isChatLine(value: unknown): value is ChatLine {
	const line = value as ChatLine | null;
	return !!line && typeof line.from === 'string' && typeof line.text === 'string'
		&& Array.isArray(line.to);
}

/**
 * One line as it is read: who it is from or to, then what was said, as a single sentence. A message
 * to several people says so, because "who else heard this" is part of what was said.
 */
export function describeLine(
	line: ChatLine, me: string | null, t: LobbyChatDeps['t'],
): string {
	const others = line.to.filter(handle => handle.toLowerCase() !== (me ?? '').toLowerCase());
	if (line.mine) {
		return t('lobby.chat.lineMine', { to: others.join(', '), text: line.text });
	}
	return others.length > 0
		? t('lobby.chat.lineToGroup', { from: line.from, others: others.join(', '), text: line.text })
		: t('lobby.chat.line', { from: line.from, text: line.text });
}

/** Public names that match what is being typed, in the order they were offered. */
export function matchingCandidates(
	typed: string, candidates: readonly string[],
): string[] {
	const needle = typed.toLowerCase();
	return candidates
		.filter(handle => handle.toLowerCase().startsWith(needle))
		.slice(0, 20);
}

export class LobbyChat {
	private history: ChatLine[] = [];
	private lastConversation: string[] = [];
	private nav: RovingToolbarList | null = null;
	private open = false;

	constructor(private readonly deps: LobbyChatDeps) {
		this.history = readHistory(this.storage());
		this.render();
		this.wire();
	}

	private storage(): Storage | undefined {
		try {
			return this.deps.storage ?? sessionStorage;
		} catch {
			return undefined;
		}
	}

	/** A message that arrived. Added to the log; never spoken over whatever is happening. */
	receive(line: ChatLine): void {
		this.remember(line);
		if (!line.mine) {
			// Everybody in that conversation except this reader: replying to yourself is not a
			// thing anybody meant to do, and it would arrive as a message from themselves.
			const me = (this.deps.me() ?? '').toLowerCase();
			this.lastConversation = [line.from, ...line.to]
				.filter(handle => handle.toLowerCase() !== me);
		}
		this.render();
	}

	private remember(line: ChatLine): void {
		this.history.push(line);
		if (this.history.length > MAX_LINES) this.history = this.history.slice(-MAX_LINES);
		try {
			this.storage()?.setItem(STORAGE_KEY, JSON.stringify(this.history));
		} catch {
			/* A full or blocked storage costs the history on reload, which is not worth failing over. */
		}
	}

	/** What is in the log right now, which is what the tests assert. */
	lines(): readonly ChatLine[] {
		return this.history;
	}

	private render(): void {
		const me = this.deps.me();
		this.deps.log.replaceChildren(...this.history.map(line => {
			const item = document.createElement('li');
			item.className = 'lobby-chat__line';
			item.tabIndex = -1;
			const text = describeLine(line, me, this.deps.t);
			item.textContent = text;
			item.setAttribute('aria-label', text);
			return item;
		}));
		this.ensureNav();
		this.nav?.refreshRovingTabindex();
	}

	private ensureNav(): void {
		if (this.nav) return;
		this.nav = new RovingToolbarList({
			list: this.deps.log,
			itemSelector: '.lobby-chat__line',
			toolbarButtonSelector: '.lobby-chat__line button',
			menuLabel: () => this.deps.t('lobby.chat.menuLabel'),
			menuClass: 'player-context-menu',
			menuItemClass: 'player-context-menu-item',
			menuHost: () => this.deps.log.closest('.lobby-chat'),
		});
	}

	private wire(): void {
		this.deps.send.addEventListener('click', () => void this.submit());
		this.deps.input.addEventListener('keydown', event => this.onKeyDown(event));
		this.deps.input.addEventListener('input', () => this.refreshSuggestions());
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			if (this.open) this.closeSuggestions();
			void this.submit();
			return;
		}
		// Down from the box walks into the matches, which is what the announcement invites.
		if (event.key === 'ArrowDown' && this.open) {
			event.preventDefault();
			(this.deps.suggestions.querySelector('button') as HTMLElement | null)?.focus();
			return;
		}
		if (event.key === 'Escape' && this.open) {
			event.preventDefault();
			this.closeSuggestions();
		}
	}

	/**
	 * Offer the names that match what is being typed, and SAY how many there are — a list that
	 * silently appears is a list somebody listening never learns about.
	 */
	private refreshSuggestions(): void {
		const typed = mentionAtCaret(this.deps.input.value, this.deps.input.selectionStart ?? 0);
		if (typed === null) {
			this.closeSuggestions();
			return;
		}

		const matches = matchingCandidates(typed, this.deps.candidates());
		this.deps.suggestions.replaceChildren(...matches.map(handle => {
			const option = document.createElement('button');
			option.type = 'button';
			option.className = 'lobby-chat__suggestion';
			option.textContent = handle;
			option.addEventListener('click', () => this.choose(handle));
			option.addEventListener('keydown', event => {
				if (event.key === 'Enter' || event.key === 'Tab') {
					event.preventDefault();
					this.choose(handle);
				}
			});
			return option;
		}));

		this.deps.suggestions.hidden = matches.length === 0;
		this.open = matches.length > 0;
		if (this.deps.status) {
			this.deps.status.textContent = matches.length > 0
				? this.deps.t('lobby.chat.matches', { count: matches.length })
				: '';
		}
	}

	private choose(handle: string): void {
		const { text, caret } = completeMention(
			this.deps.input.value, this.deps.input.selectionStart ?? 0, handle);
		this.deps.input.value = text;
		this.deps.input.setSelectionRange(caret, caret);
		this.closeSuggestions();
		this.deps.input.focus();
	}

	private closeSuggestions(): void {
		this.deps.suggestions.replaceChildren();
		this.deps.suggestions.hidden = true;
		this.open = false;
	}

	/** Send what is typed, or say why it went nowhere. */
	async submit(): Promise<void> {
		const raw = this.deps.input.value;
		const addressed = addressMessage(raw);
		const recipients = resolveRecipients(addressed, this.lastConversation);

		if (recipients.length === 0) {
			// The whole design in one message: there is no general channel here, and this is how
			// to reach somebody instead.
			this.say(addressed.repliesToLast ? 'lobby.chat.noOneToReplyTo' : 'lobby.chat.noRecipient');
			return;
		}
		if (addressed.text.length === 0) {
			this.say('lobby.chat.nothingToSay');
			return;
		}

		const { delivered, unreachable } = await this.deps.deliver(recipients, addressed.text);

		if (delivered.length > 0) {
			this.deps.input.value = '';
			this.lastConversation = [...delivered];
			this.receive({
				from: this.deps.me() ?? '',
				to: delivered,
				text: addressed.text,
				mine: true,
			});
		}

		if (unreachable.length > 0) {
			// One reason for every failure: naming them apart would say who exists, who is around
			// and who has quietly shut somebody out.
			this.say('lobby.chat.unreachable', { handles: unreachable.join(', ') });
		} else if (delivered.length > 0) {
			this.say('lobby.chat.sent', { to: delivered.join(', ') });
		}
	}

	private say(key: string, vars?: Record<string, unknown>): void {
		if (this.deps.status) this.deps.status.textContent = this.deps.t(key, vars);
	}
}

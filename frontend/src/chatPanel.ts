// chatPanel.ts — floating, fully accessible in-game chat.
//
// Three controls, exactly as specified by the player who uses it with a screen reader:
//   • the compose TEXTAREA (Enter sends, Shift+Enter breaks the line; Tab reaches the send
//     button, Shift+Tab the message list);
//   • the SEND button;
//   • the message HISTORY as a <ul> with a roving tabindex (arrows walk it; Home/End jump;
//     when the roving item IS the last one, new messages keep it glued to the end — but a
//     reader parked mid-history is never yanked away).
//
// Voicing goes through a PERSISTENT role="log" region in <body> (not the list): a live
// region inside a closed <dialog> is not rendered and says nothing, so the log must live
// outside the panel for messages to be spoken while it is closed or collapsed.
//
// The @mention autocomplete moves REAL focus into a floating option list (as requested —
// no aria-activedescendant): ↑/↓ walk it, typing keeps inserting into the textarea and
// re-filters (focus stays on the list), Enter AND Tab complete, ←/→ hand focus back to
// the textarea so the reader can review it character by character, and from the textarea
// ↑/↓ (or typing) return to the list while it is open. Escape closes it.

import { makeDialogDraggable } from './dialogDrag.js';
import { nextRovingIndex } from './accessibleList.js';
import { soundEvents } from './soundEvents.js';
import type { ChatMessageDto, Player } from './models.js';

export interface ChatPanelDeps {
	t: (key: string, vars?: Record<string, unknown>) => string;
	getPlayers: () => Player[];
	getMyPlayerId: () => string | null;
	send: (text: string) => Promise<void>;
	/** Hands focus back to the board (Escape from the compose box). */
	focusBoard: () => void;
}

const DISCLAIMER_KEY = 'corro.chatDisclaimerDismissed';

/** localStorage may be unavailable (private mode); the banner then just reappears. */
function disclaimerDismissed(): boolean {
	try { return localStorage.getItem(DISCLAIMER_KEY) === '1'; } catch { return false; }
}
function persistDisclaimerDismissed(): void {
	try { localStorage.setItem(DISCLAIMER_KEY, '1'); } catch { /* session-only then */ }
}

const LOG_CAP = 50;      // spoken-log children kept around (screen readers only need recent)
const LIST_CAP = 200;    // rendered history (mirrors the server cap)

class ChatPanel {
	private deps: ChatPanelDeps | null = null;
	private dialog: HTMLDialogElement | null = null;
	private list: HTMLUListElement | null = null;
	private input: HTMLTextAreaElement | null = null;
	private sendBtn: HTMLButtonElement | null = null;
	private mentionList: HTMLUListElement | null = null;
	private logRegion: HTMLElement | null = null;
	private rovingIndex = -1;
	private mentionOptions: Player[] = [];
	private mentionActive = 0;
	/** Start offset of the "@token" being completed in the textarea, or -1 when closed. */
	private mentionStart = -1;

	init(deps: ChatPanelDeps): void {
		this.deps = deps;
		if (this.dialog) return;
		const t = deps.t;

		// The spoken channel lives in <body> so it announces with the panel closed too.
		const log = document.createElement('div');
		log.id = 'chat-log';
		log.setAttribute('role', 'log');
		log.setAttribute('aria-label', t('game.chat_title'));
		log.className = 'visually-hidden';
		document.body.appendChild(log);
		this.logRegion = log;

		const dialog = document.createElement('dialog');
		dialog.id = 'chat-panel';
		dialog.className = 'game-dialog chat-panel';
		dialog.dataset.modal = 'false';
		dialog.innerHTML = `
			<div class="chat-application" role="application" aria-labelledby="chat-panel-title">
				<h2 class="dialog-title" id="chat-panel-title"></h2>
				<div class="chat-disclaimer" id="chat-panel-disclaimer" hidden>
					<p id="chat-disclaimer-text" tabindex="0"></p>
					<label class="chat-disclaimer__dontshow">
						<input type="checkbox" id="chat-disclaimer-dontshow">
						<span id="chat-disclaimer-dontshow-label"></span>
					</label>
					<button type="button" id="chat-disclaimer-dismiss" class="btn btn-secondary"></button>
				</div>
				<ul class="chat-messages" id="chat-messages" role="list"></ul>
				<div class="chat-compose">
					<textarea id="chat-input" rows="2"></textarea>
					<button type="button" id="chat-send" class="btn btn-primary"></button>
				</div>
				<ul class="chat-mention-list hidden" id="chat-mention-list" role="listbox"></ul>
			</div>
		`;
		dialog.setAttribute('aria-labelledby', 'chat-panel-title');
		// Deliberately NO aria-describedby: a description is re-announced on EVERY entry,
		// and the unencrypted-messages notice only needs saying once. It lives below as a
		// dismissible banner instead ("don't show again" persisted client-side).
		document.body.appendChild(dialog);
		makeDialogDraggable(dialog);
		this.dialog = dialog;

		dialog.querySelector('#chat-panel-title')!.textContent = t('game.chat_title');
		const banner = dialog.querySelector<HTMLElement>('#chat-panel-disclaimer')!;
		dialog.querySelector('#chat-disclaimer-text')!.textContent = t('game.chat_disclaimer');
		dialog.querySelector('#chat-disclaimer-dontshow-label')!.textContent = t('game.chat_disclaimer_dontshow');
		const dismissBtn = dialog.querySelector<HTMLButtonElement>('#chat-disclaimer-dismiss')!;
		dismissBtn.textContent = t('game.chat_disclaimer_dismiss');
		if (!disclaimerDismissed()) banner.hidden = false;
		dismissBtn.addEventListener('click', () => {
			banner.hidden = true;
			const dontShow = dialog.querySelector<HTMLInputElement>('#chat-disclaimer-dontshow')!;
			if (dontShow.checked) persistDisclaimerDismissed();
			this.input?.focus();
		});

		this.list = dialog.querySelector<HTMLUListElement>('#chat-messages')!;
		this.list.setAttribute('aria-label', t('game.chat_messages_label'));
		this.input = dialog.querySelector<HTMLTextAreaElement>('#chat-input')!;
		this.input.setAttribute('aria-label', t('game.chat_input_label'));
		this.sendBtn = dialog.querySelector<HTMLButtonElement>('#chat-send')!;
		this.sendBtn.textContent = t('game.chat_send');
		this.mentionList = dialog.querySelector<HTMLUListElement>('#chat-mention-list')!;
		this.mentionList.setAttribute('aria-label', t('game.chat_mention_label'));

		this.sendBtn.addEventListener('click', () => void this.sendCurrent());
		this.input.addEventListener('keydown', e => this.onInputKeydown(e));
		this.input.addEventListener('input', () => this.refreshMentions());
		this.list.addEventListener('keydown', e => this.onListKeydown(e));
		this.mentionList.addEventListener('keydown', e => this.onMentionKeydown(e));
	}

	isOpen(): boolean { return !!this.dialog?.open; }

	toggle(): void {
		if (this.isOpen()) this.closePanel(); else this.openPanel();
	}

	openPanel(): void {
		if (!this.dialog) return;
		if (!this.dialog.open) this.dialog.show();
		// First contact: land ON the unencrypted-messages notice so the player actually
		// hears it (it is a focusable stop). Once dismissed, opening goes straight to the
		// compose box, and dismissing itself hands focus there too.
		const banner = this.dialog.querySelector<HTMLElement>('#chat-panel-disclaimer');
		const notice = this.dialog.querySelector<HTMLElement>('#chat-disclaimer-text');
		if (banner && !banner.hidden && notice) {
			notice.focus();
			return;
		}
		this.focusInput();
	}

	closePanel(): void {
		this.closeMentions();
		if (this.dialog?.open) this.dialog.close();
		this.deps?.focusBoard();
	}

	/** Ctrl+Shift+R: jump straight to the compose box, OPENING the panel first if it is
	 *  closed — one keystroke to start typing, no Ctrl+Shift+H needed beforehand. A
	 *  first-ever open still lands on the unencrypted-messages notice (see openPanel). */
	focusInput(): boolean {
		if (!this.isOpen()) {
			this.openPanel();
			return true;
		}
		if (!this.input) return false;
		this.input.focus();
		return true;
	}

	// ── history ───────────────────────────────────────────────────────────────

	setHistory(messages: ChatMessageDto[]): void {
		if (!this.list) return;
		this.list.innerHTML = '';
		this.rovingIndex = -1;
		for (const m of messages.slice(-LIST_CAP)) this.appendItem(m, false);
	}

	addMessage(message: ChatMessageDto): void {
		if (!this.deps) return;
		const mine = message.playerId === this.deps.getMyPlayerId();
		this.appendItem(message, true);
		// Spoken channel + earcons. My own send is voiced too (the reader confirms what
		// went out); distinct cues tell send and receive apart without words.
		this.speak(message);
		soundEvents.playEvent(mine ? 'message.send' : 'message.receive');
	}

	private appendItem(message: ChatMessageDto, live: boolean): void {
		const list = this.list!;
		const items = list.querySelectorAll('li');
		const wasAtEnd = this.rovingIndex === -1 || this.rovingIndex >= items.length - 1;
		const hadFocus = document.activeElement && list.contains(document.activeElement);

		const li = document.createElement('li');
		li.setAttribute('role', 'listitem');
		li.tabIndex = -1;
		li.textContent = `${message.playerName}: ${message.text}`;
		list.appendChild(li);
		while (list.children.length > LIST_CAP) list.removeChild(list.firstChild!);

		// End-glue: the roving item follows the newest message ONLY when it already sat on
		// the last one — a reader parked mid-history keeps their place (and their focus).
		const count = list.children.length;
		if (wasAtEnd) {
			this.setRoving(count - 1, live && !!hadFocus);
		} else {
			this.applyRovingTabstops();
		}
	}

	private setRoving(index: number, moveFocus: boolean): void {
		const items = this.list!.querySelectorAll<HTMLElement>('li');
		if (items.length === 0) { this.rovingIndex = -1; return; }
		this.rovingIndex = Math.max(0, Math.min(index, items.length - 1));
		this.applyRovingTabstops();
		if (moveFocus) items[this.rovingIndex].focus();
	}

	private applyRovingTabstops(): void {
		const items = this.list!.querySelectorAll<HTMLElement>('li');
		items.forEach((el, i) => { el.tabIndex = i === this.rovingIndex ? 0 : -1; });
	}

	private onListKeydown(e: KeyboardEvent): void {
		const count = this.list!.children.length;
		if (count === 0) return;
		const next = nextRovingIndex(this.rovingIndex, e.key, count);
		if (next === null) return;
		e.preventDefault();
		e.stopPropagation();
		this.setRoving(next, true);
	}

	// ── compose ───────────────────────────────────────────────────────────────

	private async sendCurrent(): Promise<void> {
		const text = this.input!.value.trim();
		if (!text || !this.deps) return;
		this.input!.value = '';
		this.closeMentions();
		try {
			await this.deps.send(text);
		} catch {
			// The hub surfaces errors through the global error channel; keep the text lost
			// minimal by restoring it so the player can retry.
			this.input!.value = text;
		}
	}

	private onInputKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) {
			// Enter sends; Shift+Enter falls through to the native line break.
			e.preventDefault();
			e.stopPropagation();
			if (this.mentionStart >= 0) { this.completeMention(); return; }
			void this.sendCurrent();
			return;
		}
		if (e.key === 'Tab' && !e.shiftKey && this.mentionStart >= 0) {
			e.preventDefault();
			e.stopPropagation();
			this.completeMention();
			return;
		}
		if (e.key === 'Tab' && e.shiftKey) {
			// Shift+Tab from the compose box lands on the message list's roving item.
			const items = this.list!.querySelectorAll<HTMLElement>('li');
			if (items.length > 0) {
				e.preventDefault();
				e.stopPropagation();
				this.setRoving(this.rovingIndex === -1 ? items.length - 1 : this.rovingIndex, true);
			}
			return;
		}
		if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.mentionStart >= 0) {
			// Back into the open suggestion list from the textarea.
			e.preventDefault();
			e.stopPropagation();
			this.focusMentionOption(this.mentionActive);
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			if (this.mentionStart >= 0) { this.closeMentions(); return; }
			this.deps?.focusBoard();
		}
	}

	// ── @mention autocomplete ────────────────────────────────────────────────

	/** Reads the "@token" under the caret; opens/filters/closes the floating list. */
	private refreshMentions(): void {
		const input = this.input!;
		const caret = input.selectionStart ?? input.value.length;
		const before = input.value.slice(0, caret);
		const match = /@([\p{L}\p{N}_-]*)$/u.exec(before);
		if (!match) { this.closeMentions(); return; }

		const token = match[1].toLocaleLowerCase();
		const me = this.deps!.getMyPlayerId();
		this.mentionOptions = this.deps!.getPlayers()
			.filter(p => p.id !== me)
			.filter(p => p.name.toLocaleLowerCase().startsWith(token));
		if (this.mentionOptions.length === 0) { this.closeMentions(); return; }

		this.mentionStart = caret - match[0].length;
		this.mentionActive = 0;
		this.renderMentions();
		// Typing (from either place) lands focus on the list, per spec: the reader hears
		// the current best match; ←/→ go back to the text.
		this.focusMentionOption(0);
	}

	private renderMentions(): void {
		const ul = this.mentionList!;
		ul.innerHTML = '';
		this.mentionOptions.forEach((p, i) => {
			const li = document.createElement('li');
			li.setAttribute('role', 'option');
			li.tabIndex = i === this.mentionActive ? 0 : -1;
			li.textContent = p.name;
			li.addEventListener('click', () => { this.mentionActive = i; this.completeMention(); });
			ul.appendChild(li);
		});
		ul.classList.remove('hidden');
	}

	private focusMentionOption(index: number): void {
		const items = this.mentionList!.querySelectorAll<HTMLElement>('li');
		if (items.length === 0) return;
		this.mentionActive = Math.max(0, Math.min(index, items.length - 1));
		items.forEach((el, i) => { el.tabIndex = i === this.mentionActive ? 0 : -1; });
		items[this.mentionActive].focus();
	}

	private onMentionKeydown(e: KeyboardEvent): void {
		const input = this.input!;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopPropagation();
			const delta = e.key === 'ArrowDown' ? 1 : -1;
			this.focusMentionOption(this.mentionActive + delta);
			return;
		}
		if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			e.stopPropagation();
			this.completeMention();
			return;
		}
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			// Hand focus back to the textarea so the reader can walk the text character by
			// character (an option list cannot be read that way). The list stays open;
			// ↑/↓ or typing return to it.
			e.preventDefault();
			e.stopPropagation();
			input.focus();
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			this.closeMentions();
			input.focus();
			return;
		}
		if (e.key === 'Backspace') {
			e.preventDefault();
			e.stopPropagation();
			const caret = input.selectionStart ?? input.value.length;
			if (caret > 0) {
				input.value = input.value.slice(0, caret - 1) + input.value.slice(caret);
				input.setSelectionRange(caret - 1, caret - 1);
			}
			this.refreshMentions();
			return;
		}
		// Printable characters keep typing INTO the textarea while focus stays on the
		// list, filtering live (refreshMentions re-focuses the best match).
		if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			e.stopPropagation();
			const caret = input.selectionStart ?? input.value.length;
			input.value = input.value.slice(0, caret) + e.key + input.value.slice(caret);
			input.setSelectionRange(caret + 1, caret + 1);
			this.refreshMentions();
		}
	}

	private completeMention(): void {
		const input = this.input!;
		const player = this.mentionOptions[this.mentionActive];
		if (!player || this.mentionStart < 0) { this.closeMentions(); return; }
		const caret = input.selectionStart ?? input.value.length;
		const inserted = `@${player.name} `;
		input.value = input.value.slice(0, this.mentionStart) + inserted + input.value.slice(caret);
		const pos = this.mentionStart + inserted.length;
		input.setSelectionRange(pos, pos);
		this.closeMentions();
		input.focus();
	}

	private closeMentions(): void {
		this.mentionStart = -1;
		this.mentionOptions = [];
		this.mentionList?.classList.add('hidden');
		if (this.mentionList) this.mentionList.innerHTML = '';
	}

	// ── voicing ───────────────────────────────────────────────────────────────

	private speak(message: ChatMessageDto): void {
		const log = this.logRegion;
		if (!log) return;
		const entry = document.createElement('div');
		entry.textContent = `${message.playerName}: ${message.text}`;
		log.appendChild(entry);
		while (log.children.length > LOG_CAP) log.removeChild(log.firstChild!);
	}
}

export const chatPanel = new ChatPanel();

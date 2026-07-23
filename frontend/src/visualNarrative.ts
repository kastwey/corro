// visualNarrative.ts — persistent sighted-player narrative shared by every game family.
//
// The server still owns the sentence. It adds package-neutral `visual*` variables to selected
// announcements; this layer renders that already-translated sentence as the last action and
// illustrates the mechanic without parsing prose or branching on package/card ids. Everything is
// aria-hidden, pointer-inert and non-blocking. Reduced-motion players get the persistent result and
// target emphasis without travel/shuffle animation.

import {
	resolveLocalizedVars, resolveTeamVars, resolveTokenVar, translateWithSelfFallback,
} from './announcer.js';
import { genericCardArtHtml, genericCardBackHtml } from './cardArt.js';
import { explodingCardArtHtml, explodingCardBackHtml } from './explodingCardArt.js';
import { journeyCardArtHtml, journeyCardBackHtml } from './journeyCardArt.js';
import { tSync } from './i18nBinder.js';
import { isTokenMotionDisabled } from './motion.js';
import {
	visualNarrativePolicyForAnnouncement, type VisualNarrativeTone,
} from './visualNarrativePolicy.js';
import type { AnnouncementEvent } from './gameClient.js';
import type { GameState } from './models.js';

export interface VisualNarrativeDeps {
	getGameState(): GameState | null;
	getMyPlayerId(): string | null;
}

interface VisualMeta {
	kind: string;
	tone: VisualNarrativeTone | null;
	sourcePlayerId: string | null;
	targetPlayerId: string | null;
	cardId: string | null;
	cardType: string | null;
	count: number;
	cardIds: string[];
	from: number | null;
	to: number | null;
}

interface PendingLine {
	text: string;
	meta: VisualMeta;
}

const ACTIVE_MS = 2200;
const FLIGHT_MS = 1050;
const SHUFFLE_MS = 1800;

function stringVar(vars: Record<string, any>, key: string): string | null {
	return typeof vars[key] === 'string' && vars[key] !== '' ? vars[key] : null;
}

function numberVar(vars: Record<string, any>, key: string, fallback: number): number {
	const value = Number(vars[key]);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function optionalNumberVar(vars: Record<string, any>, key: string): number | null {
	if (vars[key] === undefined || vars[key] === null || vars[key] === '') return null;
	const value = Number(vars[key]);
	return Number.isFinite(value) ? value : null;
}

/** Parse only the reserved flat metadata; exported for a DOM-free contract test. */
export function visualMetaForAnnouncement(event: AnnouncementEvent): VisualMeta | null {
	const vars = event.vars ?? {};
	const policy = visualNarrativePolicyForAnnouncement(event.key);
	const kind = stringVar(vars, 'visualKind') ?? policy?.kind ?? null;
	if (!kind) return null;
	const explicitTone = stringVar(vars, 'visualTone');
	const tone = explicitTone === 'gain' || explicitTone === 'loss' || explicitTone === 'neutral'
		? explicitTone
		: policy?.tone ?? null;
	const cardIds: string[] = [];
	for (let index = 1; ; index++) {
		const id = stringVar(vars, `visualCard${index}Id`);
		if (!id) break;
		cardIds.push(id);
	}
	return {
		kind,
		tone,
		sourcePlayerId: stringVar(vars, 'visualSourcePlayerId'),
		targetPlayerId: stringVar(vars, 'visualTargetPlayerId'),
		cardId: stringVar(vars, 'visualCardId'),
		cardType: stringVar(vars, 'visualCardType'),
		count: numberVar(vars, 'visualCount', 1),
		cardIds,
		from: optionalNumberVar(vars, 'from'),
		to: optionalNumberVar(vars, 'to'),
	};
}

/** Join already-complete translated lines as one flowing visible sentence. */
export function joinVisualNarrative(lines: readonly string[]): string {
	const clean = lines.map(line => line.trim()).filter(Boolean);
	return clean.map(line => /[.!?…]$/u.test(line) ? line : `${line}.`).join(' ');
}

function narrativePriority(kind: string): number {
	if (kind === 'detail') return 0;
	if (kind === 'card-pick') return 10;
	if (kind === 'hands-pass') return 20;
	if (kind === 'card-reveal-table') return 40;
	if (kind === 'capture' || kind === 'milestone') return 50;
	return 30;
}

class VisualNarrative {
	private deps: VisualNarrativeDeps | null = null;
	private stage: HTMLElement | null = null;
	private pending: PendingLine[] = [];
	private flushTimer: number | null = null;
	private activeTimer: number | null = null;
	/** A restarted emphasis must not be cleared by the previous event's timeout. */
	private readonly highlightTimers = new WeakMap<HTMLElement, number>();

	init(deps: VisualNarrativeDeps): void {
		this.deps = deps;
	}

	playForAnnouncement(event: AnnouncementEvent): void {
		if (!this.deps) return;
		const meta = visualMetaForAnnouncement(event);
		if (!meta) return;
		const text = this.translate(event);
		if (text) this.pending.push({ text, meta });
		this.playEffect(meta);
		if (this.flushTimer === null) {
			this.flushTimer = window.setTimeout(() => this.flush(), 0);
		}
	}

	private translate(event: AnnouncementEvent): string {
		const language = (window as { i18next?: { language?: string } }).i18next?.language ?? 'en';
		let vars = resolveLocalizedVars(event.vars, language);
		vars = resolveTeamVars(vars, tSync);
		vars = resolveTokenVar(vars, tSync);
		return translateWithSelfFallback(event.key, vars, tSync);
	}

	private flush(): void {
		this.flushTimer = null;
		if (this.pending.length === 0) return;
		const lines = this.pending;
		this.pending = [];
		const stage = this.ensureStage();
		if (!stage) return;
		const lead = lines.reduce((best, line) =>
			narrativePriority(line.meta.kind) > narrativePriority(best.meta.kind) ? line : best,
		lines[0]).meta;
		const tone = lines.find(line => line.meta.tone)?.meta.tone ?? lead.tone;
		stage.dataset.kind = lead.kind;
		stage.classList.remove('visual-narrative--gain', 'visual-narrative--loss', 'visual-narrative--neutral');
		if (tone) stage.classList.add(`visual-narrative--${tone}`);
		stage.replaceChildren();

		const copy = document.createElement('div');
		copy.className = 'visual-narrative__copy';
		const message = document.createElement('p');
		message.className = 'visual-narrative__message';
		message.textContent = joinVisualNarrative(lines.map(line => line.text));
		copy.appendChild(message);

		const route = this.routeText(lead);
		if (route) {
			const routeEl = document.createElement('p');
			routeEl.className = 'visual-narrative__route';
			routeEl.textContent = route;
			copy.appendChild(routeEl);
		}
		stage.appendChild(copy);

		const peek = [...lines].reverse().find(line => line.meta.kind === 'cards-peek')?.meta;
		if (peek && peek.count > 0) this.renderPeek(stage, peek);
		else {
			const cardLine = [...lines].reverse().find(line => line.meta.cardId || line.meta.kind.startsWith('card-'));
			if (cardLine?.meta.cardIds.length) this.renderPeek(stage, cardLine.meta);
			else if (cardLine) this.renderFeaturedCard(stage, cardLine.meta);
		}

		stage.classList.remove('is-active');
		void stage.offsetWidth;
		stage.classList.add('is-active');
		if (this.activeTimer !== null) window.clearTimeout(this.activeTimer);
		this.activeTimer = window.setTimeout(() => {
			stage.classList.remove('is-active');
			this.activeTimer = null;
		}, ACTIVE_MS);
	}

	private ensureStage(): HTMLElement | null {
		if (this.stage?.isConnected) return this.stage;
		const board = document.getElementById('board');
		if (!board) return null;
		const family = this.deps?.getGameState()?.gameType ?? 'property';
		const stage = document.createElement('div');
		stage.className = `visual-narrative visual-narrative--${family}`;
		stage.setAttribute('aria-hidden', 'true');
		if (family === 'property') {
			const center = board.querySelector<HTMLElement>('.board-center');
			if (!center) return null;
			center.appendChild(stage);
		} else if (['journey', 'assembly', 'draft', 'shedding', 'exploding'].includes(family)) {
			const toolbar = board.querySelector<HTMLElement>('[class$="-toolbar"]');
			if (toolbar) toolbar.insertAdjacentElement('afterend', stage);
			else board.prepend(stage);
		} else {
			const frame = board.closest<HTMLElement>('.board-frame');
			if (!frame) return null;
			frame.insertBefore(stage, board);
		}
		this.stage = stage;
		return stage;
	}

	private routeText(meta: VisualMeta): string | null {
		if (!meta.sourcePlayerId || !meta.targetPlayerId || meta.sourcePlayerId === meta.targetPlayerId) return null;
		const state = this.deps?.getGameState();
		const source = state?.players.find(player => player.id === meta.sourcePlayerId)?.name;
		const target = state?.players.find(player => player.id === meta.targetPlayerId)?.name;
		return source && target ? tSync('game.visual_route', { source, target }) : null;
	}

	private playEffect(meta: VisualMeta): void {
		switch (meta.kind) {
			case 'detail':
			case 'card-existing-effect':
				break;
			case 'movement':
			case 'milestone':
			case 'state-change':
				this.highlightPlayer(meta.targetPlayerId ?? meta.sourcePlayerId);
				break;
			case 'capture':
				this.highlightPlayer(meta.sourcePlayerId);
				this.highlightPlayer(meta.targetPlayerId);
				break;
			case 'track-effect':
				this.highlightPlayer(meta.sourcePlayerId);
				this.highlight(this.trackEffectAnchor(meta.from, meta.to));
				break;
			case 'card-play-rack':
				this.flyPlayedCard(meta, this.rackAnchor(meta.targetPlayerId));
				break;
			case 'card-play-discard':
				this.flyPlayedCard(meta, this.discardAnchor());
				break;
			case 'card-attack':
				this.flyPlayedCard(meta, this.discardAnchor());
				this.flyImpact(meta);
				break;
			case 'card-pick':
				this.flyPlayedCard(meta, this.tableAnchor(meta.targetPlayerId ?? meta.sourcePlayerId));
				break;
			case 'card-reveal-table':
				this.flyBetween(this.playerAnchor(meta.sourcePlayerId),
					this.tableAnchor(meta.targetPlayerId ?? meta.sourcePlayerId), meta.cardId, meta.count);
				break;
			case 'hands-pass':
				this.highlightAll('.draft-table, .player-card');
				break;
			case 'cards-discard':
				this.flyPlayedCard(meta, this.discardAnchor());
				this.discardRivalHands(meta);
				break;
			case 'rack-transfer':
				this.flyPlayedCard(meta, this.discardAnchor());
				this.flyBetween(this.rackAnchor(meta.targetPlayerId), this.rackAnchor(meta.sourcePlayerId), null, 1, 180);
				break;
			case 'rack-swap':
				this.flyPlayedCard(meta, this.discardAnchor());
				this.flyBetween(this.rackAnchor(meta.sourcePlayerId), this.rackAnchor(meta.targetPlayerId), null, 1, 120);
				this.flyBetween(this.rackAnchor(meta.targetPlayerId), this.rackAnchor(meta.sourcePlayerId), null, 1, 280);
				break;
			case 'rack-spread':
				this.flyPlayedCard(meta, this.discardAnchor());
				this.spreadToRivals(meta);
				break;
			case 'card-draw':
				this.flyBetween(this.deckAnchor(), this.handOrPlayerAnchor(meta.targetPlayerId), null, meta.count);
				break;
			case 'card-transfer':
				this.flyBetween(this.handOrPlayerAnchor(meta.sourcePlayerId), this.handOrPlayerAnchor(meta.targetPlayerId), meta.cardId, 1);
				break;
			case 'card-tuck':
				this.flyBetween(document.querySelector<HTMLElement>('.exploding-reveal__bomb')
					?? this.playerAnchor(meta.sourcePlayerId), this.deckAnchor(), meta.cardId, 1);
				break;
			case 'deck-shuffle':
				this.shuffleDeck();
				break;
			case 'attack':
			case 'favor-request':
				this.flyImpact(meta);
				break;
			case 'outcome':
				this.highlightPlayer(meta.targetPlayerId ?? meta.sourcePlayerId);
				break;
			case 'cards-peek':
				this.highlight(this.deckAnchor());
				break;
		}
	}

	private flyPlayedCard(meta: VisualMeta, target: HTMLElement | null): void {
		const source = this.localCard(meta.sourcePlayerId, meta.cardId) ?? this.playerAnchor(meta.sourcePlayerId);
		this.flyBetween(source, target, meta.cardId, meta.count);
	}

	private flyImpact(meta: VisualMeta): void {
		const source = this.playerAnchor(meta.sourcePlayerId);
		const target = this.playerAnchor(meta.targetPlayerId);
		this.flyBetween(source, target, null, Math.max(1, meta.count), 0, 'impact');
	}

	private discardRivalHands(meta: VisualMeta): void {
		const state = this.deps?.getGameState();
		const seats = state?.assembly?.seats ?? [];
		for (const seat of seats.filter(seat => seat.playerId !== meta.sourcePlayerId && !seat.retired)) {
			this.flyBetween(this.handOrPlayerAnchor(seat.playerId), this.discardAnchor(), null,
				Math.max(1, seat.handCount), 160);
		}
	}

	private spreadToRivals(meta: VisualMeta): void {
		const state = this.deps?.getGameState();
		for (const player of state?.players ?? []) {
			if (player.id !== meta.sourcePlayerId) {
				this.flyBetween(this.rackAnchor(meta.sourcePlayerId), this.rackAnchor(player.id), null, 1, 180);
			}
		}
	}

	private flyBetween(
		source: HTMLElement | null,
		target: HTMLElement | null,
		cardId: string | null,
		count = 1,
		delay = 0,
		variant: 'card' | 'impact' = 'card',
	): void {
		if (!source || !target) return;
		this.highlight(target);
		if (isTokenMotionDisabled()) return;
		const from = source.getBoundingClientRect();
		const to = target.getBoundingClientRect();
		if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return;

		const flight = document.createElement('div');
		flight.className = `visual-card-flight visual-card-flight--${variant}`;
		flight.setAttribute('aria-hidden', 'true');
		if (variant === 'impact') {
			flight.innerHTML = '<span class="visual-card-flight__impact">!</span>';
		} else {
			flight.innerHTML = this.cardMarkup(cardId);
			if (count > 1) {
				const badge = document.createElement('span');
				badge.className = 'visual-card-flight__count';
				badge.textContent = `×${count}`;
				flight.appendChild(badge);
			}
		}
		document.body.appendChild(flight);

		const width = variant === 'impact' ? 52 : 76;
		const height = variant === 'impact' ? 52 : 106;
		const startX = from.left + from.width / 2 - width / 2;
		const startY = from.top + from.height / 2 - height / 2;
		const deltaX = to.left + to.width / 2 - width / 2 - startX;
		const deltaY = to.top + to.height / 2 - height / 2 - startY;
		flight.style.left = `${startX}px`;
		flight.style.top = `${startY}px`;
		flight.style.width = `${width}px`;
		flight.style.height = `${height}px`;

		if (typeof flight.animate !== 'function') {
			flight.remove();
			return;
		}
		const animation = flight.animate([
			{ transform: 'translate(0, 0) scale(0.78) rotate(-5deg)' },
			{ transform: `translate(${deltaX * 0.52}px, ${deltaY * 0.52 - 44}px) scale(1.08) rotate(5deg)`, offset: 0.55 },
			{ transform: `translate(${deltaX}px, ${deltaY}px) scale(0.9) rotate(0deg)`, offset: 0.88 },
			{ transform: `translate(${deltaX}px, ${deltaY}px) scale(0.82) rotate(0deg)` },
		], { duration: FLIGHT_MS, delay, easing: 'cubic-bezier(0.22, 0.75, 0.2, 1)', fill: 'both' });
		const remove = () => flight.remove();
		animation.onfinish = remove;
		animation.oncancel = remove;
	}

	private shuffleDeck(): void {
		const deck = this.deckAnchor();
		if (!deck) return;
		this.highlight(deck);
		if (isTokenMotionDisabled()) return;
		const rect = deck.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		for (let index = 0; index < 3; index++) {
			const card = document.createElement('div');
			card.className = 'visual-card-flight visual-card-flight--shuffle';
			card.setAttribute('aria-hidden', 'true');
			card.innerHTML = this.cardBackMarkup();
			card.style.left = `${rect.left + rect.width / 2 - 38}px`;
			card.style.top = `${rect.top + rect.height / 2 - 53}px`;
			card.style.width = '76px';
			card.style.height = '106px';
			document.body.appendChild(card);
			if (typeof card.animate !== 'function') { card.remove(); continue; }
			const direction = index % 2 === 0 ? 1 : -1;
			const animation = card.animate([
				{ transform: `translateX(${direction * -8}px) rotate(${direction * -4}deg)` },
				{ transform: `translateX(${direction * 58}px) rotate(${direction * 13}deg)`, offset: 0.28 },
				{ transform: `translateX(${direction * -48}px) rotate(${direction * -11}deg)`, offset: 0.62 },
				{ transform: 'translateX(0) rotate(0deg)', offset: 1 },
			], { duration: SHUFFLE_MS, delay: index * 90, easing: 'ease-in-out', fill: 'both' });
			const remove = () => card.remove();
			animation.onfinish = remove;
			animation.oncancel = remove;
		}
	}

	private renderPeek(stage: HTMLElement, meta: VisualMeta): void {
		const fan = document.createElement('div');
		fan.className = 'visual-narrative__peek';
		const total = Math.min(4, Math.max(meta.count, meta.cardIds.length));
		for (let index = 0; index < total; index++) {
			const card = document.createElement('span');
			card.className = 'visual-narrative__peek-card';
			card.innerHTML = meta.cardIds[index] ? this.cardMarkup(meta.cardIds[index]) : this.cardBackMarkup();
			fan.appendChild(card);
		}
		stage.appendChild(fan);
	}

	private renderFeaturedCard(stage: HTMLElement, meta: VisualMeta): void {
		const card = document.createElement('span');
		card.className = 'visual-narrative__card';
		card.innerHTML = meta.cardId ? this.cardMarkup(meta.cardId) : this.cardBackMarkup();
		if (meta.count > 1) {
			const badge = document.createElement('span');
			badge.className = 'visual-card-flight__count';
			badge.textContent = `×${meta.count}`;
			card.appendChild(badge);
		}
		stage.appendChild(card);
	}

	private cardMarkup(cardId: string | null): string {
		const state = this.deps?.getGameState();
		if (cardId && state?.gameType === 'exploding') {
			const def = state.explodingDeck?.find(card => card.id === cardId);
			if (def) return explodingCardArtHtml(def, tSync(def.nameKey));
		}
		if (cardId && state?.gameType === 'assembly') {
			const def = state.assemblyDeck?.find(card => card.id === cardId);
			if (def) return genericCardArtHtml(def, tSync(def.nameKey));
		}
		if (cardId && state?.gameType === 'journey') {
			const def = state.journeyDeck?.find(card => card.id === cardId);
			if (def) return journeyCardArtHtml(def, tSync(def.nameKey));
		}
		if (cardId && state?.gameType === 'draft') {
			const def = state.draftDeck?.find(card => card.id === cardId);
			if (def) return genericCardArtHtml(def, tSync(def.nameKey));
		}
		if (cardId && state?.gameType === 'shedding') {
			const def = state.sheddingDeck?.find(card => card.id === cardId);
			if (def) return genericCardArtHtml(def, tSync(def.nameKey));
		}
		return this.cardBackMarkup();
	}

	private cardBackMarkup(): string {
		const family = this.deps?.getGameState()?.gameType;
		if (family === 'exploding') return explodingCardBackHtml();
		if (family === 'journey') return journeyCardBackHtml();
		return genericCardBackHtml();
	}

	private localCard(playerId: string | null, cardId: string | null): HTMLElement | null {
		if (!playerId || !cardId || playerId !== this.deps?.getMyPlayerId()) return null;
		return Array.from(document.querySelectorAll<HTMLElement>('.hand-card[data-card-id]'))
			.find(card => card.dataset.cardId === cardId) ?? null;
	}

	private handOrPlayerAnchor(playerId: string | null): HTMLElement | null {
		if (playerId && playerId === this.deps?.getMyPlayerId()) {
			return document.querySelector<HTMLElement>('.hand-panel__list') ?? this.playerAnchor(playerId);
		}
		return this.playerAnchor(playerId);
	}

	private playerAnchor(playerId: string | null): HTMLElement | null {
		if (!playerId) return null;
		return this.findByPlayerId(
			'.player-token, .journey-car, .track-piece, .trivia-piece, .exploding-seat, .assembly-rack, .shedding-seat, .draft-table',
			playerId)
			?? this.findByPlayerId('.player-card', playerId);
	}

	private rackAnchor(playerId: string | null): HTMLElement | null {
		return playerId ? this.findByPlayerId('.assembly-rack', playerId) ?? this.playerAnchor(playerId) : null;
	}

	private findByPlayerId(selector: string, playerId: string): HTMLElement | null {
		return Array.from(document.querySelectorAll<HTMLElement>(selector))
			.find(element => element.dataset.playerId === playerId) ?? null;
	}

	private deckAnchor(): HTMLElement | null {
		return document.querySelector<HTMLElement>(
			'.exploding-draw, .shedding-draw, .journey-centre__stack, .assembly-piles [data-pile="deck"], .draft-piles [data-pile="deck"]');
	}

	private discardAnchor(): HTMLElement | null {
		return document.querySelector<HTMLElement>(
			'.exploding-discard, .shedding-discard, .journey-centre__discard, .assembly-piles [data-pile="discard"]');
	}

	private tableAnchor(playerId: string | null): HTMLElement | null {
		return playerId ? this.findByPlayerId('.draft-table', playerId) ?? this.playerAnchor(playerId) : null;
	}

	private trackEffectAnchor(from: number | null, to: number | null): HTMLElement | null {
		if (from === null || to === null) return null;
		return document.querySelector<HTMLElement>(`.track-connector[data-from="${from}"][data-to="${to}"]`);
	}

	private highlightAll(selector: string): void {
		for (const target of Array.from(document.querySelectorAll<HTMLElement>(selector))) this.highlight(target);
	}

	private highlightPlayer(playerId: string | null): void {
		if (!playerId) return;
		for (const target of Array.from(document.querySelectorAll<HTMLElement>('[data-player-id]'))) {
			if (target.dataset.playerId === playerId) this.highlight(target);
		}
	}

	private highlight(target: HTMLElement | null): void {
		if (!target) return;
		const previous = this.highlightTimers.get(target);
		if (previous !== undefined) window.clearTimeout(previous);
		target.classList.remove('visual-narrative-target');
		void target.offsetWidth;
		target.classList.add('visual-narrative-target');
		const timer = window.setTimeout(() => {
			if (this.highlightTimers.get(target) !== timer) return;
			target.classList.remove('visual-narrative-target');
			this.highlightTimers.delete(target);
		}, FLIGHT_MS + 650);
		this.highlightTimers.set(target, timer);
	}
}

export const visualNarrative = new VisualNarrative();

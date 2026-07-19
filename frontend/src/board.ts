import type { Player, Square } from './models.js';
import type { GameManager } from './gameManager.js';
import { tokenIconHtml } from './tokenIcons.js';
import { tSync, money } from './i18nBinder.js';
import { escapeHtml } from './escapeHtml.js';

/** The eight classic groups have themed CSS colours (theme-aware, light/dark) keyed by
 *  name in styles.css; any other group paints its own colour inline instead. */
const THEMED_GROUPS = new Set(['brown', 'lightblue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkblue']);

/**
 * Markup for a property's colour band. For the eight classic groups it uses the themed CSS class
 * (`group-brown`…); for any other group — e.g. a package using a hex like `#8a5a2b` — it paints
 * the colour inline so the band still shows. The colour is whitelisted (hex or a plain CSS word)
 * because it can come from an uploaded package, so it can't inject markup/CSS.
 */
export function squareBandHtml(color: string): string {
	const key = color.toLowerCase();
	if (THEMED_GROUPS.has(key)) {
		return `<span class="square__band group-${key}" aria-hidden="true"></span>`;
	}
	const safe = /^#[0-9a-fA-F]{3,8}$/.test(color) || /^[a-z]+$/i.test(color) ? color : '';
	const style = safe ? ` style="background:${safe}"` : '';
	return `<span class="square__band"${style} aria-hidden="true"></span>`;
}

// Type for event callbacks
export type SquareSelectedCallback = (squareIndex: number, square: Square) => void;
/** Fired when a square is *activated* (clicked / tapped) to request its info dialog. */
export type SquareActivatedCallback = (squareIndex: number, square: Square) => void;

/**
 * Resolves which square a context-menu gesture (right-click, the Applications key or
 * Shift+F10) targets: the square under the pointer when the gesture lands on one, or — when
 * it comes from the focused board container (keyboard) — the current exploration cursor.
 * Returns -1 when neither applies (e.g. the board has no cursor yet), so the caller can let
 * the browser's native menu through.
 */
export function contextMenuSquareIndex(target: HTMLElement | null, activeIndex: number): number {
  const square = target?.closest?.('.square[data-index]') as HTMLElement | null;
  if (square) {
	const idx = Number(square.dataset.index);
	return Number.isInteger(idx) ? idx : -1;
  }
  return activeIndex;
}

export class Board {
  element: HTMLElement;
  gridSize: number;
  activeIndex = -1;
  private labelBuilder?: (i: number) => string;
  private getPlayers: () => Player[];
  private getSquaresFromServer: () => Square[];
  private gameManager: GameManager; // Reference to gameManager for server commands
  private squareSelectedCallbacks: SquareSelectedCallback[] = [];
  private squareActivatedCallbacks: SquareActivatedCallback[] = [];
  /** Speaks a square description through the page announcer (injected by app). */
  private announce?: (text: string, instant?: boolean) => void;

  constructor(element: HTMLElement, gridSize = 11, getPlayers: () => Player[], getSquares: () => Square[], gameManager: GameManager) {
	this.element = element;
	this.gridSize = gridSize;
	this.getPlayers = getPlayers;
	this.getSquaresFromServer = getSquares;
	this.gameManager = gameManager;
	this.installFocusGuard();
	this.installContextMenuGuard();
  }

  /** Wires the announcer used to narrate cursor movement (see {@link setActiveIndex}). */
  setAnnouncer(fn: (text: string, instant?: boolean) => void): void {
	this.announce = fn;
  }

  /**
   * Keeps keyboard focus on the board container.
   *
   * The squares themselves are never focusable: the container (`role="application"`)
   * holds the single real DOM focus and we narrate the exploration cursor ourselves
   * through the announcer. If something momentarily drops focus to <body> (e.g. a
   * removed child during a re-render), this restores it to the container so the
   * screen reader never falls back to reading the page/window title.
   */
  private installFocusGuard(): void {
	this.element.addEventListener('focusout', (e: FocusEvent) => {
	  // relatedTarget is set when focus moves to a real element (dialog, button,
	  // notifications). Only react when focus is leaving to nothing.
	  if (e.relatedTarget) return;
	  setTimeout(() => {
		const lost = document.activeElement === document.body || document.activeElement === null;
		if (lost) this.element.focus();
	  }, 0);
	});
  }

  /**
   * Makes the board own the "show a context menu" gesture: the Applications key, Shift+F10
   * and a mouse right-click all fire a native `contextmenu` event, which we intercept to
   * open OUR accessible square menu (the ARIA menu pattern) and suppress the browser's
   * native menu. A right-click directly on a square also moves the exploration cursor there
   * (like a left click) so the menu acts on what the pointer targeted; the keyboard keys
   * keep the current cursor. When there is nothing to act on (no cursor yet) we let the
   * native menu through.
   */
  private installContextMenuGuard(): void {
	this.element.addEventListener('contextmenu', (e: MouseEvent) => {
	  const idx = contextMenuSquareIndex(e.target as HTMLElement | null, this.activeIndex);
	  if (idx < 0) return;
	  e.preventDefault();
	  const onSquare = (e.target as HTMLElement | null)?.closest?.('.square[data-index]');
	  if (onSquare) this.setActiveIndex(idx, true, false);
	  this.activateSquare(idx);
	});
  }

  // Public method to get squares (always from server)
  getSquares(): Square[] {
	const serverSquares = this.getSquaresFromServer();
	if (!serverSquares || serverSquares.length === 0) {
	  console.warn('Board.getSquares: Server has not yet sent the squares');
	}
	return serverSquares || [];
  }

  /**
   * Registers a callback that will be executed when a square is selected
   */
  onSquareSelected(callback: SquareSelectedCallback): () => void {
	this.squareSelectedCallbacks.push(callback);
	// Returns a function to unregister the callback
	return () => {
	  const index = this.squareSelectedCallbacks.indexOf(callback);
	  if (index >= 0) {
		this.squareSelectedCallbacks.splice(index, 1);
	  }
	};
  }

  /**
   * Fires square selection events
   */
  private fireSquareSelected(squareIndex: number): void {
	const square = this.getSquares()[squareIndex];
	if (square) {
	  this.squareSelectedCallbacks.forEach(callback => {
		try {
		  callback(squareIndex, square);
		} catch (error) {
		  console.warn('Error in square selection callback:', error);
		}
	  });
	}
  }

  /**
   * Registers a callback fired when a square is activated (clicked / tapped or via the
   * keyboard info shortcut), used to open the property-info dialog.
   */
  onSquareActivated(callback: SquareActivatedCallback): () => void {
	this.squareActivatedCallbacks.push(callback);
	return () => {
	  const index = this.squareActivatedCallbacks.indexOf(callback);
	  if (index >= 0) this.squareActivatedCallbacks.splice(index, 1);
	};
  }

  /** Fires the square-activated callbacks (open the info dialog for that square). */
  activateSquare(squareIndex: number): void {
	const square = this.getSquares()[squareIndex];
	if (!square) return;
	this.squareActivatedCallbacks.forEach(callback => {
	  try {
		callback(squareIndex, square);
	  } catch (error) {
		console.warn('Error in square activation callback:', error);
	  }
	});
  }

  render(labelBuilder?: (i: number) => string) {
	this.labelBuilder = labelBuilder;
	// clear container and render all squares
	this.element.innerHTML = '';
	this.getSquares().forEach((s, idx) => {
	  const el = document.createElement('button');
	  el.type = 'button';
	  const hasBand = s.type === 'property' && !!s.color;
	  el.className = 'square'
		+ (s.type ? ` square--${s.type}` : '')
		+ (hasBand ? ' has-band' : '');
	  // Keep squares out of the Tab order: the container (role="application") owns the
	  // single keyboard focus and we narrate the cursor ourselves. But unlike before they
	  // are NOT aria-hidden — exposing them as buttons lets a touch screen reader
	  // (VoiceOver / TalkBack) swipe to each square and double-tap it to open its info
	  // dialog, while desktop keyboard navigation keeps using the arrow-key cursor.
	  el.setAttribute('tabindex', '-1');
	  // Each square can open an accessible context menu (ARIA menu pattern) with its
	  // contextual actions, so advertise it to assistive tech.
	  el.setAttribute('aria-haspopup', 'menu');
	  el.setAttribute('aria-expanded', 'false');
	  el.style.gridColumnStart = String(s.x + 1);
	  el.style.gridRowStart = String(s.y + 1);
	  el.dataset.index = String(idx);
	  el.dataset.x = String(s.x);
	  el.dataset.y = String(s.y);
	  const label = labelBuilder ? labelBuilder(idx) : `${s.name}. Square ${idx + 1}.`;
	  el.setAttribute('aria-label', label);
	  // Ownable squares show their purchase price; tax squares show the sum due (its own field).
	  const priceText = s.price ? money(s.price) : (s.amount ? money(s.amount) : '');
	  const bandHtml = hasBand ? squareBandHtml(s.color!) : '';
	  el.innerHTML = `${bandHtml}<span class="label" aria-hidden="true">${escapeHtml(s.name)}</span><span class="price" aria-hidden="true">${escapeHtml(priceText)}</span>`;
	  // Clicking / tapping a square moves the cursor there (with the spatial sound cue but
	  // without narrating it, since the dialog speaks) and opens its property-info dialog.
	  el.addEventListener('click', () => {
		this.setActiveIndex(idx, true, false);
		this.activateSquare(idx);
	  });
	  this.element.appendChild(el);
	});

	// Decorative center with the Free Parking pot. Purely visual
	// (aria-hidden): the amount is also available via the 'f' shortcut and
	// spoken announcements, so it never clutters screen-reader navigation.
	this.renderCenter();
  }

  private renderCenter(): void {
	this.element.querySelector('.board-center')?.remove();
	const center = document.createElement('div');
	center.className = 'board-center';
	center.setAttribute('aria-hidden', 'true');
	// Span the inner area, leaving the perimeter ring of squares free.
	center.style.gridColumn = `2 / ${this.gridSize}`;
	center.style.gridRow = `2 / ${this.gridSize}`;
	// The centre cash pot is the Free Parking jackpot house rule made visible. Show it when the
	// rule is active — or whenever the pot already holds money, since only that rule feeds it.
	// The money fallback also covers games restored from before the rule flag was sent to the
	// client. With the rule off and the pot empty we omit it rather than show a permanent "0 €".
	// (Guarded for callers — e.g. unit tests — that supply a minimal gameManager.)
	const ruleActive = this.gameManager.isFreeParkingJackpot?.() ?? false;
	const showPot = ruleActive || this.gameManager.getFreeParkingPot() > 0;
	const potHtml = showPot
	  ? `
	  <div class="free-parking">
		<div class="free-parking__bills" aria-hidden="true">
		  <span class="bill bill--a"></span>
		  <span class="bill bill--b"></span>
		  <span class="bill bill--c"></span>
		  <span class="bill bill--d"></span>
		  <span class="bill bill--e"></span>
		</div>
		<div class="free-parking__label">${tSync('game.free_parking_label')}</div>
		<div class="free-parking__amount" data-free-parking-amount>—</div>
	  </div>`
	  : '';
	// A package game labels the piles with its own decks (id + localized name); a classic game
	// falls back to the two built-in Fortune / Treasury piles. Each pile carries its deck id
	// (data-deck-id) so the card-draw flight can originate from the right pile. Reuse the two
	// positioned slots for layout; package names are escaped (they come from an upload).
	const decks = this.gameManager.getDecks?.() ?? [];
	const slotClasses = ['deck--community', 'deck--chance'];
	const decksHtml = decks.length > 0
	  ? decks.slice(0, 2).map((d, i) =>
		  `<div class="deck ${slotClasses[i] ?? slotClasses[0]}" data-deck-id="${escapeHtml(d.id)}" aria-hidden="true">
			<span class="deck__label">${escapeHtml(d.label)}</span>
		  </div>`).join('')
	  : `<div class="deck deck--community" data-deck-id="community" aria-hidden="true">
			<span class="deck__label">${tSync('game.card_deck_community')}</span>
		  </div>
		  <div class="deck deck--chance" data-deck-id="chance" aria-hidden="true">
			<span class="deck__label">${tSync('game.card_deck_chance')}</span>
		  </div>`;
	// A package supplies its own centre brand (e.g. "CORRO"); a built-in board uses ours.
	// Escaped — it comes from an uploaded package.
	const brand = this.gameManager.getCenterBrand?.() || tSync('game.center_brand');
	center.innerHTML = `
	  <div class="board-center__brand">${escapeHtml(brand)}</div>
	  ${decksHtml}${potHtml}`;
	this.element.appendChild(center);
	this.updateFreeParkingPot(this.gameManager.getFreeParkingPot());
  }

  /** Updates the amount shown in the center Free Parking pot. */
  updateFreeParkingPot(amount: number): void {
	const center = this.element.querySelector('.board-center');
	if (!center) return;
	const pot = amount || 0;
	// A game can start with an empty pot and accrue money later. If the pot now holds money but
	// its UI is absent (e.g. a game restored without the rule flag), build it now: renderCenter
	// re-evaluates showPot (true here, since pot > 0) and re-enters this method with the element
	// in place, so there is no loop.
	if (pot > 0 && !center.querySelector('.free-parking')) {
	  this.renderCenter();
	  return;
	}
	const amountEl = center.querySelector('[data-free-parking-amount]') as HTMLElement | null;
	if (amountEl) amountEl.textContent = money(pot.toLocaleString('es-ES'));
	center.classList.toggle('board-center--has-pot', pot > 0);
  }

  /**
   * Viewport rect of a center deck pile (the visual source of the card-draw flight). Returns
   * null before the center is rendered, so the caller can fall back to a plain reveal.
   */
  getDeckRect(deckId: string): DOMRect | null {
	const decks = this.element.querySelectorAll('.deck');
	for (const el of Array.from(decks)) {
	  if ((el as HTMLElement).dataset.deckId === deckId) {
		return (el as HTMLElement).getBoundingClientRect();
	  }
	}
	return null;
  }

  /**
   * Viewport rect of a player's token — the destination of the card-draw flight. Matches on
   * the token's `data-player-id` (set in {@link renderPlayers}); returns null when the token
   * is not on the board yet.
   */
  getTokenRect(playerId: string): DOMRect | null {
	const tokens = this.element.querySelectorAll('.player-token');
	for (const tok of Array.from(tokens)) {
	  if ((tok as HTMLElement).dataset.playerId === playerId) {
		return (tok as HTMLElement).getBoundingClientRect();
	  }
	}
	return null;
  }

  /**
   * Moves the exploration cursor to square {@link i}.
   *
   * The cursor is a purely visual marker (a CSS class); the board container keeps
   * the single real DOM focus, so the screen reader never auto-reads on a focus
   * jump. We narrate the destination ourselves through the announcer when
   * {@link announceMove} is true. This keeps full control over the spoken order
   * relative to the server's voice (e.g. the landing square stays silent so the
   * server's "you landed on X" is not interrupted).
   *
   * @param triggerEvents fire the square-selected callbacks (spatial sound cue).
   * @param announceMove speak the destination square (interrupting current speech).
   */
  setActiveIndex(i: number, triggerEvents: boolean = true, announceMove: boolean = true) {
	const squares = this.getSquares();
	if (i < 0 || i >= squares.length) return;
	const el = this.element.querySelector(`.square[data-index="${i}"]`) as HTMLElement | null;
	if (!el) return;
	const prev = this.element.querySelector('.square.focused') as HTMLElement | null;
	if (prev && prev !== el) prev.classList.remove('focused');
	el.classList.add('focused');
	this.activeIndex = i;

	if (announceMove) this.announceSquare(i);

	// Fire square selection event only if requested (spatial sound cue)
	if (triggerEvents) {
	  this.fireSquareSelected(i);
	}
  }

  /** Builds the square's description and speaks it, interrupting current speech. */
  private announceSquare(i: number): void {
	if (!this.announce || !this.labelBuilder) return;
	this.announce(this.labelBuilder(i), true);
  }

  /** Re-announces the square the cursor is currently on (e.g. on board focus). */
  announceCursor(): void {
	if (this.activeIndex < 0) return;
	this.announceSquare(this.activeIndex);
  }

  getActiveIndex() { return this.activeIndex; }

  getSquare(i: number) { return this.getSquares()[i]; }

  /**
   * Updates aria-labels for all squares without recreating the DOM.
   * Useful for reflecting state changes (player positions, properties) without losing focus.
   * Skips the currently focused square to avoid JAWS re-reading it.
   */
  updateLabels(): void {
	if (!this.labelBuilder) return;

	const squares = this.getSquares();
	squares.forEach((_, idx) => {
	  // Skip the focused square to avoid JAWS re-reading it
	  if (idx === this.activeIndex) return;

	  const el = this.element.querySelector(`.square[data-index="${idx}"]`) as HTMLElement | null;
	  if (el) {
		const newLabel = this.labelBuilder!(idx);
		el.setAttribute('aria-label', newLabel);
	  }
	});
  }

  /**
   * Checks if the board has already been rendered (has square elements)
   */
  isRendered(): boolean {
	return this.element.querySelector('.square') !== null;
  }

  // Renders tokens and owner badges (needs translations for labels).
  // `displayPositionFor`, when provided, overrides where a token is DRAWN (used by the
  // token animator to walk a token square by square toward its authoritative position).
  // Owner badges, buildings and mortgage markers always use the authoritative square state.
  renderPlayers(
	players: Player[],
	t: (key: string, vars?: Record<string, any>) => string,
	displayPositionFor?: (playerId: string, authoritative: number) => number,
	isMovingFor?: (playerId: string) => boolean
  ) {
	// remove previous containers
	this.element.querySelectorAll('.tokens').forEach(n => n.remove());
	this.element.querySelectorAll('.owner-badge').forEach(n => n.remove());
	this.element.querySelectorAll('.buildings').forEach(n => n.remove());
	this.element.querySelectorAll('.mortgage-badge').forEach(n => n.remove());
	this.element.querySelectorAll('.square--mortgaged').forEach(n => n.classList.remove('square--mortgaged'));
	this.element.querySelectorAll('.square--me-here').forEach(n => n.classList.remove('square--me-here'));
	this.element.querySelectorAll('.square--other-here').forEach(n => n.classList.remove('square--other-here'));

	const myId = this.gameManager?.getMyPlayerId?.();

	// Draw player tokens
	players.forEach(p => {
	  const idx = displayPositionFor ? displayPositionFor(p.id, p.position) : p.position;
	  const squareEl = this.element.querySelector(`.square[data-index="${idx}"]`) as HTMLElement | null;
	  if (!squareEl) return;
	  // Presence rings (live-play request): find every token's square at a glance —
	  // MY square rings in the accent, squares holding rivals in a softer neutral.
	  // Purely decorative; the tokens' aria-labels already name who stands where.
	  squareEl.classList.add(p.id === myId ? 'square--me-here' : 'square--other-here');
	  let cont = squareEl.querySelector('.tokens') as HTMLElement | null;
	  if (!cont) { cont = document.createElement('div'); cont.className = 'tokens'; squareEl.appendChild(cont); }
	  const tokenEl = document.createElement('span');
	  tokenEl.className = `player-token token-${p.token}`;
	  // A token still walking toward its destination square hops and grows; on the final
	  // landing render the animator has cleared its path, so it returns to natural size.
	  if (isMovingFor?.(p.id)) tokenEl.classList.add('player-token--moving');
	  // A held player (sent to holding — NOT just visiting) is shown behind bars and the
	  // accessible label says so, so the distinction is clear visually and to a screen reader.
	  const tokenLabel = p.isHeld ? t('player_token_held', { name: p.name }) : p.name;
	  if (p.isHeld) tokenEl.classList.add('player-token--held');
	  tokenEl.setAttribute('aria-label', tokenLabel);
	  tokenEl.title = tokenLabel;
	  tokenEl.dataset.playerId = p.id;
	  if (p.color) tokenEl.style.background = p.color;
	  tokenEl.innerHTML = tokenIconHtml(p.token);
	  cont.appendChild(tokenEl);
	});

	// Draw owner badges
	this.getSquares().forEach((s, idx) => {
	  if (!s.ownerId) return;
	  const squareEl = this.element.querySelector(`.square[data-index="${idx}"]`) as HTMLElement | null;
	  if (!squareEl) return;
	  const owner = players.find(p => p.id === s.ownerId);
	  const badge = document.createElement('div');
	  badge.className = 'owner-badge';
	  badge.setAttribute('aria-hidden', 'false');
	  if (owner) {
		badge.setAttribute('aria-label', `${t('owner_label')}: ${owner.name}`);
		badge.title = `${t('owner_label')}: ${owner.name}`;
		if (owner.color) badge.style.background = owner.color;
		badge.textContent = owner.name ? owner.name[0].toUpperCase() : '';
	  } else {
		badge.setAttribute('aria-label', `${t('owner_label')}: ${s.ownerId}`);
		badge.title = `${t('owner_label')}: ${s.ownerId}`;
		badge.textContent = String(s.ownerId)[0]?.toUpperCase() || '?';
	  }
	  squareEl.appendChild(badge);

	  // Buildings: a hotel replaces the four houses, otherwise one chip per house.
	  const houses = s.smallBuildings ?? 0;
	  const hotels = s.bigBuildings ?? 0;
	  if (hotels > 0 || houses > 0) {
		const buildings = document.createElement('div');
		buildings.className = 'buildings';
		buildings.setAttribute('aria-hidden', 'true');
		if (hotels > 0) {
		  const hotel = document.createElement('span');
		  hotel.className = 'building building--big';
		  buildings.appendChild(hotel);
		  buildings.title = t('hotel_label');
		} else {
		  for (let h = 0; h < houses; h++) {
			const house = document.createElement('span');
			house.className = 'building building--small';
			buildings.appendChild(house);
		  }
		  buildings.title = t('houses_count', { count: houses });
		}
		squareEl.appendChild(buildings);
	  }

	  // Mortgage: dim the square and show a corner marker.
	  if (s.mortgaged) {
		squareEl.classList.add('square--mortgaged');
		const mortgage = document.createElement('div');
		mortgage.className = 'mortgage-badge';
		mortgage.setAttribute('aria-hidden', 'true');
		mortgage.title = t('mortgaged_label');
		mortgage.textContent = t('mortgaged_label').charAt(0).toUpperCase();
		squareEl.appendChild(mortgage);
	  }

	  // NOTE: we intentionally do NOT refresh the aria-label of the currently
	  // focused square here. Mutating the aria-label of the focused element makes
	  // screen readers re-announce it (e.g. re-reading the street name right after
	  // pressing Enter to roll). Non-focused labels are kept current via updateLabels().
	});
  }

  // Find next occupied square using provided players
  nextOccupied(fromIndex: number, forward = true, players: Player[]): number {
	const squares = this.getSquares();
	const n = squares.length;
	if (n === 0) return -1;
	for (let step = 1; step <= n; step++) {
	  const idx = forward ? (fromIndex + step) % n : (fromIndex - step + n) % n;
	  if (players.some(p => p.position === idx)) return idx;
	}
	return -1;
  }

  // We no longer need attachArrowNav - arrows are handled via keymap

  // Navigation commands
  moveLeft(): boolean {
	return this.moveInDirection(-1, 0);
  }

  moveRight(): boolean {
	return this.moveInDirection(1, 0);
  }

  moveUp(): boolean {
	return this.moveInDirection(0, -1);
  }

  moveDown(): boolean {
	return this.moveInDirection(0, 1);
  }

  private moveInDirection(dx: number, dy: number): boolean {
	const squares = this.getSquares();
	if (this.activeIndex === -1 || !squares[this.activeIndex]) return false;

	const cur = squares[this.activeIndex];
	const nx = cur.x + dx;
	const ny = cur.y + dy;
	const targetIndex = squares.findIndex(s => s.x === nx && s.y === ny);

	if (targetIndex >= 0) {
	  this.setActiveIndex(targetIndex);
	  return true;
	}
	return false;
  }

  goToStart(): boolean {
	this.setActiveIndex(0);
	return true;
  }

  /** On the property board the player's start square IS the GO corner. */
  goToMyStart(): boolean {
	return this.goToStart();
  }

  goToPlayer(playerId: string): boolean {
	const player = this.getPlayers().find(p => p.id === playerId);
	if (player) {
	  this.setActiveIndex(player.position);
	  return true;
	}
	return false;
  }

  goToMe(): boolean {
	// First try to get the player ID from gameManager
	const myPlayerId = this.gameManager?.getMyPlayerId?.();
	if (myPlayerId) {
	  const me = this.getPlayers().find(p => p.id === myPlayerId);
	  if (me) {
		this.setActiveIndex(me.position);
		return true;
	  }
	}
	// Fallback: buscar por isMe
	const meFallback = this.getPlayers().find(p => p.isMe);
	if (meFallback) {
	  this.setActiveIndex(meFallback.position);
	  return true;
	}
	console.warn('Could not find your player');
	return false;
  }

  /**
   * Gets a player by ID
   */
  getPlayer(playerId: string): Player | undefined {
	return this.getPlayers().find(p => p.id === playerId);
  }
}

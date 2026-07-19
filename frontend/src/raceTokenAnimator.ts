// raceTokenAnimator.ts — Animate race pieces moving between squares.
//
// Similar to tokenAnimator.ts but adapted for race board topology: pieces move
// step-by-step along the circuit, then enter/exit corridors. Uses the same
// onIdle/onStep callbacks to pace announcements with animation.

import type { GameState } from './models.js';
import type { RaceBoard } from './raceBoard.js';

export interface RaceTokenAnimatorOptions {
  raceBoard: () => RaceBoard | null;
  gameState: () => GameState | null;
  render: () => void;
  stepDelayMs?: number;
  firstStepDelayMs?: number;
  motionDisabled?: () => boolean;
  onStep?: () => void;
  onIdle?: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface DisplayPiece {
  location: 'home' | 'circuit' | 'corridor' | 'goal';
  square: number; // circuit square or corridor cell
  seatIndex?: number;
}

export class RaceTokenAnimator {
  private displayPieces = new Map<string, DisplayPiece>(); // key = "${seatIndex}:${pieceIndex}"
  private animatingPieces = new Set<string>();
  private pendingTimers: unknown[] = [];
  /**
   * Per-piece animation generation. A new move for a piece bumps its generation, which
   * silences any still-ticking timer chain from the previous move — otherwise two chains
   * fight over the piece and the older one fires onIdle early, releasing the gated
   * announcements while the piece is still visibly travelling.
   */
  private generation = new Map<string, number>();
  private options: Required<Omit<RaceTokenAnimatorOptions, 'setTimer' | 'clearTimer'>> &
	Pick<RaceTokenAnimatorOptions, 'setTimer' | 'clearTimer'>;

  constructor(opts: RaceTokenAnimatorOptions) {
	this.options = {
	  stepDelayMs: 150,
	  firstStepDelayMs: opts.firstStepDelayMs ?? (opts.stepDelayMs ?? 150) + 500,
	  motionDisabled: () => false,
	  onStep: () => {},
	  onIdle: () => {},
	  setTimer: (fn, ms) => setTimeout(fn, ms),
	  clearTimer: (h) => clearTimeout(h as any),
	  ...opts,
	};

	this.syncFromState();
  }

  get isAnimating(): boolean {
	return this.animatingPieces.size > 0;
  }

  syncFromState(): void {
	const gs = this.options.gameState();
	if (!gs?.race) return;

	// Build the authoritative state from the game state
	const authoritative = new Map<string, DisplayPiece>();
	for (const seat of gs.race.seats) {
	  const seatIndex = gs.raceBoard?.seats.findIndex(s => s.id === seat.seatId) ?? -1;
	  for (let i = 0; i < seat.pieces.length; i++) {
		const piece = seat.pieces[i];
		const key = `${seatIndex}:${i}`;
		authoritative.set(key, {
		  location: piece.location,
		  square: piece.square,
		  seatIndex,
		});
	  }
	}

	// For each piece in authoritative state, start animation if needed
	for (const [key, target] of authoritative.entries()) {
	  const current = this.displayPieces.get(key);
	  if (!current) {
		// New piece: appear at its target
		this.displayPieces.set(key, { ...target });
	  } else if (current.location !== target.location || current.square !== target.square) {
		// Piece moved: animate it
		this.animatePiece(key, current, target);
	  }
	}

	// Remove pieces that are no longer in state
	for (const key of this.displayPieces.keys()) {
	  if (!authoritative.has(key)) {
		this.displayPieces.delete(key);
	  }
	}
  }

  private animatePiece(key: string, from: DisplayPiece, to: DisplayPiece): void {
	// Take over the piece: any previous chain for it becomes stale and stops ticking.
	const gen = (this.generation.get(key) ?? 0) + 1;
	this.generation.set(key, gen);
	const wasAnimating = this.animatingPieces.delete(key);

	const path = this.getPath(from, to);
	if (path.length === 0 || this.options.motionDisabled?.()) {
	  // Snap: reduced motion, or a transition with no walkable path (exiting home, a
	  // captured piece sent home). The display MUST still jump to the target — the board
	  // always prefers the display position over the authoritative one, so a stale entry
	  // here would leave the piece painted on its old square forever.
	  this.displayPieces.set(key, { ...to });
	  this.options.render();
	  // A snap that retargeted the LAST travelling piece ends the animation: settle, so
	  // gated announcements aren't left waiting for a chain that will never finish.
	  if (wasAnimating && this.animatingPieces.size === 0) this.options.onIdle?.();
	  return;
	}

	this.animatingPieces.add(key);
	let stepIndex = 0;

	const animateStep = () => {
	  if (this.generation.get(key) !== gen) return; // a newer move took this piece over
	  // Motion went off mid-walk (typically the window was hidden and its timers are now
	  // clamped to ≥1 s): jump to the destination, silently, instead of limping through
	  // the remaining hops out of rhythm.
	  if (this.options.motionDisabled?.()) {
		this.animatingPieces.delete(key);
		this.displayPieces.set(key, { ...to });
		this.options.render();
		if (this.animatingPieces.size === 0) this.options.onIdle?.();
		return;
	  }
	  if (stepIndex < path.length) {
		const nextPiece = path[stepIndex];
		this.displayPieces.set(key, { ...nextPiece });
		this.options.render();
		this.options.onStep?.();
		stepIndex++;
		const timer = this.options.setTimer!(animateStep, this.options.stepDelayMs);
		this.pendingTimers.push(timer);
	  } else {
		// Done animating this piece
		this.animatingPieces.delete(key);
		this.displayPieces.set(key, { ...to });
		this.options.render();

		// If no more pieces animating, call onIdle
		if (this.animatingPieces.size === 0) {
		  this.options.onIdle?.();
		}
	  }
	};

	// The first hop waits for the dice/announcement earcon to finish; later hops walk at
	// the step cadence.
	const timer = this.options.setTimer!(animateStep, this.options.firstStepDelayMs);
	this.pendingTimers.push(timer);
  }

  private getPath(from: DisplayPiece, to: DisplayPiece): DisplayPiece[] {
	const path: DisplayPiece[] = [];
	const gs = this.options.gameState();
	const board = this.options.raceBoard?.();

	if (!gs?.raceBoard || !board) return [];

	// Same location and square: no movement
	if (from.location === to.location && from.square === to.square) {
	  return [];
	}

	const circuitLength = gs.raceBoard.circuitLength;
	const seatIndex = from.seatIndex ?? 0;

	// If from is circuit and to is also circuit: step along circuit
	if (from.location === 'circuit' && to.location === 'circuit') {
	  const steps = this.stepsAlong(from.square, to.square, circuitLength);
	  for (const square of steps) {
		path.push({ location: 'circuit', square, seatIndex });
	  }
	  return path;
	}

	// From circuit to corridor: step to corridor entry, then into corridor
	if (from.location === 'circuit' && to.location === 'corridor') {
	  const corridorEntry = gs.raceBoard.seats[seatIndex]?.corridorEntry ?? 1;
	  const stepsToEntry = this.stepsAlong(from.square, corridorEntry, circuitLength);
	  for (const square of stepsToEntry) {
		path.push({ location: 'circuit', square, seatIndex });
	  }
	  for (let c = 1; c <= to.square; c++) {
		path.push({ location: 'corridor', square: c, seatIndex });
	  }
	  return path;
	}

	// From corridor to goal: step through corridor then to goal
	if (from.location === 'corridor' && to.location === 'goal') {
	  for (let c = from.square + 1; c <= (gs.raceBoard.corridorLength ?? 4); c++) {
		path.push({ location: 'corridor', square: c, seatIndex });
	  }
	  path.push({ location: 'goal', square: 0, seatIndex });
	  return path;
	}

	// From corridor to corridor: just step within corridor
	if (from.location === 'corridor' && to.location === 'corridor') {
	  for (let c = from.square + 1; c <= to.square; c++) {
		path.push({ location: 'corridor', square: c, seatIndex });
	  }
	  return path;
	}

	// Other cases: snap
	return [];
  }

  private stepsAlong(from: number, to: number, circuitLength: number): number[] {
	if (from === to) return [];

	const forward = (((to - from) % circuitLength) + circuitLength) % circuitLength;
	const useForward = forward <= circuitLength - forward;
	const count = useForward ? forward : circuitLength - forward;
	const dir = useForward ? 1 : -1;

	const path: number[] = [];
	for (let i = 1; i <= count; i++) {
	  // Circuit squares are 1-based (1..circuitLength): shift to 0-based for the wrap
	  // arithmetic and back, or the step crossing the ring's seam lands on a nonexistent
	  // square 0 and the piece vanishes for that hop.
	  path.push(((from - 1 + dir * i) % circuitLength + circuitLength) % circuitLength + 1);
	}
	return path;
  }

  displayPosition(seatIndex: number, pieceIndex: number): DisplayPiece | null {
	const key = `${seatIndex}:${pieceIndex}`;
	return this.displayPieces.get(key) ?? null;
  }

  destroy(): void {
	for (const timer of this.pendingTimers) {
	  this.options.clearTimer?.(timer);
	}
	this.pendingTimers = [];
	this.animatingPieces.clear();
	this.generation.clear();
  }
}

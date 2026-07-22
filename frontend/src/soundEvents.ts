import { soundManager, playSound } from './sound.js';

/**
 * Earcons (short, non-speech audio cues) for game events. They are an accessibility
 * feature: a blind player recognises a panned "dice" or "cash register" cue far faster
 * than waiting for the full text-to-speech sentence, and stereo panning hints at board
 * position. They are a PARALLEL presentation layer to the spoken announcements and the
 * visual board — they never replace the server-authoritative voice.
 *
 * The server is the single source of truth for the voice of every game event, so this
 * module hooks the ONE central place every announcement flows through (the `announce`
 * function the game manager calls) and maps the announcement key to a sound. That keeps
 * the wiring DRY: no command handler needs to know about sound.
 */

/**
 * Maps a server announcement key to a sound-pack event name (the keys declared in the
 * backend `pack.json` manifest). Returns `null` when the announcement has no earcon.
 *
 * The audience variants the server splits per player (`_self` for the actor, `_victim`
 * for an attack's target) normally share the base key's sound, so the suffix is stripped
 * before looking up — UNLESS the variant has its own mapping (e.g. MY turn gets a distinct
 * cue), which a direct lookup catches first.
 *
 * A PACK may ship its own announcement→event map (its themed card lines, or an engine key
 * re-mapped for that game only): `packAnnouncements` is consulted before the built-in table.
 */
export function soundEventForAnnouncement(
	key: string,
	vars?: Record<string, any>,
	packAnnouncements?: Record<string, string>,
): string | null {
	if (!key) return null;

	// Landing earcons depend on the square KIND, not the (generic) landing key: a player
	// landing on a street, a station and a utility all announce "game.landed_on_property",
	// so we pick the cue from the squareType the server includes in the vars.
	const baseKey = baseAnnouncementKey(key);
	if (baseKey === 'game.landed_on_property' || baseKey === 'game.landed_on_property_colored') {
		return LANDING_SOUND_BY_SQUARE_TYPE[String(vars?.squareType ?? '')] ?? null;
	}

	// Journey distances get a PER-VALUE cue (packs may ship one sound per km card:
	// journey.distance.25, .50…); a pack without them simply stays silent for that value.
	if (baseKey === 'game.journey_played_distance') {
		const km = Number(vars?.km);
		return Number.isFinite(km) && km > 0 ? `journey.distance.${km}` : null;
	}

	// Assembly pieces get a PER-PIECE cue keyed by the engine colour (assembly.piece.red…):
	// a pack ships one sound per piece (heart, bone…) and any theme reuses the same slots.
	if (baseKey === 'game.assembly_played_piece') {
		const color = String(vars?.color ?? '');
		return color ? `assembly.piece.${color}` : null;
	}

	// Direct match first, so a variant key can map to its own distinct earcon.
	return packAnnouncements?.[key]
		?? packAnnouncements?.[baseKey]
		?? ANNOUNCEMENT_SOUND_MAP[key]
		?? ANNOUNCEMENT_SOUND_MAP[baseKey]
		?? null;
}

/** Strip the audience suffixes that share one sound contract. */
function baseAnnouncementKey(key: string): string {
	for (const suffix of ['_self', '_victim']) {
		if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
	}
	return key;
}

/**
 * All earcons triggered by one announcement. Most lines have exactly one. A cat-pair play
 * adds its package-themed creature cue to the universal rising warning; a Nope adds its
 * immediate response cue and a fresh warning because it restarts the reaction window.
 */
export function soundEventsForAnnouncement(
	key: string,
	vars?: Record<string, any>,
	packAnnouncements?: Record<string, string>,
): string[] {
	const events = [soundEventForAnnouncement(key, vars, packAnnouncements)];
	const baseKey = baseAnnouncementKey(key);
	if (baseKey === 'game.exploding_played_cat_pair') {
		events.push('exploding.cat');
	}
	if (baseKey === 'game.exploding_noped') {
		events.push(soundEventForAnnouncement('game.exploding_played', undefined, packAnnouncements));
	}
	return [...new Set(events.filter((event): event is string => event !== null))];
}

/**
 * Earcon for landing on a square, keyed by the square's kind. The shipped property boards
 * (and every package board — the validator only allows "transit") type their stations
 * "transit", which is what the server sends as `squareType`; `railroad` stays as a defensive
 * alias for legacy/external boards that still name the kind that way.
 */
const LANDING_SOUND_BY_SQUARE_TYPE: Readonly<Record<string, string>> = {
	transit: 'transit',
	railroad: 'transit',
};

const ANNOUNCEMENT_SOUND_MAP: Readonly<Record<string, string>> = {
	'game.dice_rolled': 'dice.roll',
	'game.dice_rolled_doubles': 'dice.roll',
	// Race family uses its own roll announcement key (with optional _self suffix for actor-specific)
	'game.race_rolled': 'dice.roll',
	'game.race_rolled_self': 'dice.roll',
	// Track family likewise: everyone hears the die that starts the move.
	'game.track_rolled': 'dice.roll',
	'game.track_rolled_self': 'dice.roll',
	// Trivia family: the die reuses the shared roll; the answer/judge/wedge earcons are
	// trivia-specific event ids whose files ship later (missing = silent). _self variants are
	// covered by the base key (the mapper strips the suffix).
	'game.trivia_rolled': 'dice.roll',
	'game.trivia_moved': 'trivia.move',
	'game.trivia_moved_wedge': 'trivia.move',
	'game.trivia_moved_center': 'trivia.move',
	'game.trivia_roll_again': 'trivia.roll_again',
	'game.trivia_again': 'trivia.roll_again',
	'game.trivia_question': 'trivia.question',
	'game.trivia_final': 'trivia.final',
	'game.trivia_answered': 'trivia.answer_submitted',
	'game.trivia_reveal': 'trivia.reveal',
	'game.trivia_judge_prompt': 'trivia.judge_prompt',
	'game.trivia_correct': 'trivia.correct',
	'game.trivia_wrong': 'trivia.wrong',
	'game.trivia_wedge': 'trivia.wedge',
	'game.trivia_wedges_complete': 'trivia.wedges_complete',
	'game.trivia_won': 'trivia.win',
	// Race family: losing a piece stings — the VICTIM's targeted line carries an earcon
	// so the loss registers even before the sentence is spoken.
	'game.race_captured_victim': 'piece.captured',

	// Journey family (card games): the engine's own lines. The ATTACK cues live in the
	// PACKAGE pack (its themed playedKey lines map via the pack's `announcements`).
	'game.journey_drew': 'card.draw',
	'game.journey_discarded': 'card.discard',
	'game.journey_new_hand': 'cards.shuffle',
	'game.journey_now_rolling': 'journey.rolling',
	'game.journey_played_immunity': 'journey.immunity',
	'game.journey_coup': 'journey.coup',

	// Assembly family: attacks/specials normally speak through the PACK's themed playedKey
	// lines (mapped in the pack's `announcements`); these engine keys cover the remedy (no
	// playedKey in the shipped packs), the fallback lines and the draw/discard flow. The
	// refill's self variants carry count suffixes the _self-stripping doesn't see, so they
	// are listed explicitly.
	'game.assembly_attacked': 'assembly.attack',
	'game.assembly_played_remedy': 'assembly.remedy',
	'game.assembly_played_special': 'assembly.special',
	'game.assembly_discarded': 'card.discard',
	'game.assembly_refilled': 'card.draw',
	'game.assembly_refilled_self_2': 'card.draw',
	'game.assembly_refilled_self_3': 'card.draw',
	'game.assembly_refilled_self_many': 'card.draw',

	// Draft family: the pick's private confirmation, the table-wide reveal, the leftward
	// pass and the round scoring each get their own slot (packs ship the files; a pack
	// without them simply stays silent, like everywhere else).
	'game.draft_picked_self': 'draft.pick',
	'game.draft_repicked_self': 'draft.pick',
	'game.draft_all_picked': 'draft.reveal',
	'game.draft_hands_passed': 'draft.pass',
	'game.draft_round_scored': 'draft.score',

	// Shedding family: the play, the wild's colour call, the direction flip, the lost
	// turn, the penalty and the draw flow. The drawer's private lines carry the draw cue
	// too (the public "draws a card" goes ToAllExcept, so it never reaches them).
	'game.shedding_played': 'shedding.play',
	'game.shedding_color_chosen': 'shedding.wild',
	'game.shedding_reversed': 'shedding.reverse',
	'game.shedding_skipped': 'shedding.skip',
	'game.shedding_drew_penalty': 'shedding.penalty',
	'game.shedding_drew': 'card.draw',
	'game.shedding_drew_playable': 'card.draw',
	'game.shedding_drew_unplayable': 'card.draw',
	'game.shedding_round_won': 'shedding.round',

	// Exploding family: EVERY playable action opens the same Nope window, so every public
	// play line carries the rising warning immediately. Action-specific sounds belong to
	// successful RESOLUTION (e.g. the cat-pair steal), never replace the reaction warning.
	// Packs ship the files; an unmapped slot simply stays silent, like everywhere else.
	'game.exploding_played': 'exploding.played',
	'game.exploding_played_cat_pair': 'exploding.played',
	'game.exploding_noped': 'exploding.nope',
	'game.exploding_action_cancelled': 'exploding.fizzle',
	'game.exploding_skipped': 'exploding.skip',
	// Reshuffling the deck is a generic card action, so it reuses the shared cards.shuffle
	// cue (the engine default pack) rather than a family-specific one — like drawing does.
	'game.exploding_shuffled': 'cards.shuffle',
	// The table hears saw_future, while the actor privately hears the revealed identities
	// through count-suffixed future keys. Every audience must get the same effect cue.
	'game.exploding_saw_future': 'exploding.future',
	'game.exploding_future': 'exploding.future',
	'game.exploding_future_2': 'exploding.future',
	'game.exploding_future_3': 'exploding.future',
	'game.exploding_future_empty': 'exploding.future',
	'game.exploding_drew': 'card.draw',
	'game.exploding_drew_self': 'card.draw',
	'game.exploding_drew_bomb_defused': 'exploding.defuse',
	'game.exploding_exploded': 'exploding.boom',
	'game.exploding_stole': 'exploding.steal',

	'game.property_purchased': 'property.buy',
	'game.auction_won': 'property.buy',

	'game.building_built': 'property.build',
	'game.buildings_sold': 'property.sell',

	// Landing on a developed property (houses/hotel) plays a cheeky "oh no, this is going
	// to cost me" duck quack — the flavour cue fires on the landing announcement, just
	// before the rent line's cash-register sound.
	'game.landed_on_building': 'property.built',
	'game.landed_on_buildings': 'property.built',
	'game.landed_on_big_building': 'property.built',

	'game.group_completed': 'group.complete',

	'game.rent_paid': 'money.pay',
	'game.paid_all_players': 'money.pay',
	'game.paid_repairs': 'money.pay',
	'game.paid_holding_release_cost': 'money.pay',
	'game.mortgage_transfer_fee': 'money.pay',
	'game.mortgage_inherited_fee': 'money.pay',

	'game.collected_from_all': 'money.receive',

	// Clearing every pending debt frees the player to roll again — a positive cue.
	'game.debt_cleared': 'money.receive',

	'game.tax_paid': 'tax.pay',

	'game.passed_through_go': 'money.salary',
	'game.landed_on_go': 'money.salary',

	'game.free_parking_collect': 'rest.zone',
	// Landing on Free Parking with an empty pot: a slot-machine spin that comes up dry.
	'game.free_parking_empty': 'rest.zone.empty',

	'game.send_to_holding': 'holding.enter',
	'game.holding_speeding': 'holding.enter',
	'game.sent_to_holding_by_card': 'holding.enter',
	'game.escaped_holding_doubles': 'holding.leave',

	'game.auction_started': 'auction.start',

	// The acting player gets a distinct "it's your turn" cue (plays even when the tab is
	// in the background); everyone else's turn is silent.
	'game.turn_of_self': 'turn.you',

	'game.game_over': 'game.over',
	'game.player_bankrupt': 'bankruptcy',

	// Platform (not game) cues: a player dropping or coming back. The server voices both
	// ("X disconnected / reconnected"); the earcon rides that line. player_reconnected
	// covers its _self variant (my own reconnect) via the suffix strip.
	'game.player_disconnected': 'disconnect',
	'game.player_reconnected': 'connect',
};

// === Persisted preference (mute + volume) ===

export interface SoundPreference {
	muted: boolean;
	/** 0.0 (silent) – 1.0 (full). */
	volume: number;
}

export const DEFAULT_SOUND_PREFERENCE: SoundPreference = { muted: false, volume: 0.6 };

const STORAGE_KEY = 'corro.soundPreference';

interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export function clampVolume(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_SOUND_PREFERENCE.volume;
	return Math.min(1, Math.max(0, value));
}

/**
 * Builds the sound-manifest URL. A package game passes its token as the pack id so the server
 * serves that game's bundled sounds (overlaying the default); built-in games omit it.
 */
export function soundManifestUrl(packId?: string | null): string {
	return packId
		? `/api/sounds/manifest?pack=${encodeURIComponent(packId)}`
		: '/api/sounds/manifest';
}

/** Reads the persisted preference, falling back to the default on missing/corrupt data. */
export function readSoundPreference(storage: StorageLike | null | undefined): SoundPreference {
	try {
		const raw = storage?.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_SOUND_PREFERENCE };
		const parsed = JSON.parse(raw) as Partial<SoundPreference>;
		return {
			muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SOUND_PREFERENCE.muted,
			volume: clampVolume(typeof parsed.volume === 'number' ? parsed.volume : DEFAULT_SOUND_PREFERENCE.volume),
		};
	} catch {
		return { ...DEFAULT_SOUND_PREFERENCE };
	}
}

export function writeSoundPreference(storage: StorageLike | null | undefined, pref: SoundPreference): void {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(pref));
	} catch {
		// Storage may be unavailable (private mode, quota). The preference still applies
		// for the current session; we just can't persist it.
	}
}

function safeLocalStorage(): StorageLike | null {
	try {
		return typeof localStorage !== 'undefined' ? localStorage : null;
	} catch {
		return null;
	}
}

/** Picks a random element, or `undefined` for an empty list. `rng` is injectable for tests. */
export function pickOne<T>(items: readonly T[], rng: () => number = Math.random): T | undefined {
	if (items.length === 0) return undefined;
	if (items.length === 1) return items[0];
	const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
	return items[index];
}

interface SoundManifestResponse {
	packId: string;
	events: Record<string, string[]>;
	/** Optional pack-declared announcement→event map (themed card lines, engine re-maps). */
	announcements?: Record<string, string>;
}

/**
 * Runtime player: loads the manifest, preloads each event's buffer(s) through the shared
 * `soundManager`, and plays earcons for announcements while respecting the persisted
 * mute/volume preference. An event may have several files; one is chosen at random per play.
 *
 * Exported for tests; production code uses the {@link soundEvents} singleton.
 */
export class SoundEventPlayer {
	private pref: SoundPreference = { ...DEFAULT_SOUND_PREFERENCE };
	// event name -> loaded buffer ids (one per declared file that decoded successfully).
	private readonly loaded = new Map<string, string[]>();
	/** The pack's announcement→event map, consulted before the built-in table. */
	private packAnnouncements: Record<string, string> = {};
	private manifestRequested = false;
	/** True once preload finished — successfully OR not — so queueing below always ends. */
	private preloadSettled = false;
	/**
	 * The pack id whose buffers are currently loaded (undefined = the engine platform pack),
	 * and whether we've loaded any pack yet. The first-gesture preload can run in the LOBBY,
	 * before a game token exists, and load only the platform pack; {@link switchPack} then
	 * loads the game's own sounds once its token is known.
	 */
	private loadedPackId: string | null | undefined = undefined;
	private loadedPackKnown = false;
	/**
	 * True while a pack manifest is being fetched/decoded. Cues that fire during this window
	 * (e.g. the deal's first card.draw racing the game pack's download after switchPack) are
	 * held and replayed when the load finishes, instead of being dropped as "no buffer yet".
	 */
	private packLoading = false;
	/**
	 * Earcons that raced the preload (the first roll's announcement can arrive within
	 * milliseconds of the first-gesture preload starting). Replayed when preload settles.
	 * Kept tiny on purpose: replaying a long backlog would be a burst of noise, so beyond
	 * a few queued cues the rest are simply dropped, as they were before the queue existed.
	 */
	private readonly pendingSounds: string[] = [];
	private static readonly MAX_PENDING_SOUNDS = 4;
	/**
	 * Event keys currently looping → the buffer id chosen for the loop, so it can be stopped
	 * later. Used for ambience tied to a lifecycle rather than a one-shot announcement (e.g.
	 * the auction countdown clock, which ticks while the auction runs and stops when it ends).
	 */
	private readonly looping = new Map<string, string>();

	/** Loads the persisted preference. Call once at startup. */
	init(): void {
		this.pref = readSoundPreference(safeLocalStorage());
	}

	isMuted(): boolean {
		return this.pref.muted;
	}

	getVolume(): number {
		return this.pref.volume;
	}

	setMuted(muted: boolean): void {
		this.pref = { ...this.pref, muted };
		writeSoundPreference(safeLocalStorage(), this.pref);
	}

	/** Flips mute and returns the new muted state. */
	toggleMute(): boolean {
		this.setMuted(!this.pref.muted);
		return this.pref.muted;
	}

	setVolume(volume: number): void {
		this.pref = { ...this.pref, volume: clampVolume(volume) };
		writeSoundPreference(safeLocalStorage(), this.pref);
	}

	/**
	 * Fetches the sound manifest and preloads every event buffer. Safe to call multiple
	 * times (only the first request runs). Decoding needs an AudioContext, which browsers
	 * only allow after a user gesture, so call this from a first-interaction hook.
	 */
	async preload(packId?: string): Promise<void> {
		if (this.manifestRequested) return;
		this.manifestRequested = true;

		try {
			if (!soundManager.isSupported()) return;
			await this.loadManifest(packId);
		} finally {
			// ALWAYS settle — success, failure or unsupported audio — so playEvent stops
			// treating a missing buffer as "still loading". loadManifest already replayed any
			// cue that raced the download.
			this.preloadSettled = true;
		}
	}

	/**
	 * Switch to a DIFFERENT pack once the game's token is known. The first-gesture
	 * {@link preload} can run in the lobby, before any token exists, and cache only the
	 * platform pack (no dice, money, card cues…); calling this when the game state arrives
	 * loads the game's own sounds. No-op before the first-gesture preload has settled (that
	 * one already uses the token if it's known by then) or when the pack is unchanged.
	 */
	async switchPack(packId?: string): Promise<void> {
		if (!this.preloadSettled) return;
		if (!soundManager.isSupported()) return;
		if (this.loadedPackKnown && packId === this.loadedPackId) return;
		await this.loadManifest(packId);
	}

	/**
	 * Fetch a pack's manifest and (re)load its buffers, REPLACING any previously loaded set
	 * (a package manifest already includes the platform cues it overlays, so a swap loses
	 * nothing). Decoding needs an unlocked AudioContext, so only call after a user gesture.
	 */
	private async loadManifest(packId?: string): Promise<void> {
		this.packLoading = true;
		try {
			// A package game passes its token as the pack id, so the server serves that
			// game's bundled sounds (overlaying the platform pack); built-in games omit it.
			const response = await fetch(soundManifestUrl(packId));
			if (!response.ok) {
				console.debug('[sound] loadManifest: fetch failed, status', response.status);
				return;
			}
			const manifest = await response.json() as SoundManifestResponse;
			const events = manifest?.events ?? {};
			const fresh = new Map<string, string[]>();
			await Promise.all(Object.entries(events).flatMap(([eventKey, urls]) =>
				(urls ?? []).map(async (url, index) => {
					const bufferId = `${eventKey}#${index}`;
					const ok = await soundManager.loadSound(bufferId, url);
					if (ok) {
						const ids = fresh.get(eventKey) ?? [];
						ids.push(bufferId);
						fresh.set(eventKey, ids);
					}
				})));
			// Swap in the freshly loaded set so a pack switch replaces the previous pack's
			// buffers (the lobby's platform-only pack → the game's full pack).
			this.loaded.clear();
			for (const [eventKey, ids] of fresh) this.loaded.set(eventKey, ids);
			this.packAnnouncements = manifest?.announcements ?? {};
			this.loadedPackId = packId;
			this.loadedPackKnown = true;
			console.debug('[sound] loadManifest: loaded', this.loaded.size, 'events (pack:', packId ?? 'default', ')');
		} catch (e) {
			console.debug('Sound manifest load failed', e);
		} finally {
			// Replay cues that raced this load (the deal's first card.draw can fire while the
			// game pack is still downloading). After a failed load they simply drop on the
			// no-buffer branch, exactly as before.
			this.packLoading = false;
			const pending = this.pendingSounds.splice(0);
			for (const eventKey of pending) this.playEvent(eventKey);
		}
	}

	/** Plays the earcon mapped to an announcement key, if any. */
	playForAnnouncement(key: string, vars?: Record<string, any>): void {
		for (const eventKey of soundEventsForAnnouncement(key, vars, this.packAnnouncements)) {
			this.playEvent(eventKey);
		}
	}

	/** Plays a sound-pack event by name (random file when several), honouring mute/volume. */
	playEvent(eventKey: string): void {
		if (this.pref.muted) {
			console.debug('[sound] playEvent:', eventKey, '— skipped (muted)');
			return;
		}

		// The buffer isn't ready and a pack is still loading (the first-gesture preload, or a
		// switchPack loading the game's pack while the deal's first card.draw fires): hold the
		// cue and replay it when the load finishes, instead of silently dropping it.
		if ((!this.preloadSettled || this.packLoading) && !this.loaded.has(eventKey)) {
			if (this.pendingSounds.length < SoundEventPlayer.MAX_PENDING_SOUNDS) {
				console.debug('[sound] playEvent:', eventKey, '— queued until the pack loads');
				this.pendingSounds.push(eventKey);
			}
			return;
		}

		const bufferId = pickOne(this.loaded.get(eventKey) ?? []);
		if (!bufferId) {
			console.debug('[sound] playEvent:', eventKey, '— no buffer loaded yet');
			return;
		}
		playSound(bufferId, { volume: this.pref.volume }).catch(() => {});
	}

	/**
	 * Starts an event playing on a loop — for ambience tied to a lifecycle, not a one-shot
	 * cue (e.g. the auction countdown clock). Idempotent per event: a second call while the
	 * same event already loops is a no-op, so reopening the auction modal never stacks a
	 * second clock. Honours mute (a muted player hears nothing) and stays silent if the
	 * buffer has not loaded, exactly like {@link playEvent}.
	 */
	startLoop(eventKey: string): void {
		if (this.pref.muted) return;
		if (this.looping.has(eventKey)) return;
		const bufferId = pickOne(this.loaded.get(eventKey) ?? []);
		if (!bufferId) {
			console.debug('[sound] startLoop:', eventKey, '— no buffer loaded yet');
			return;
		}
		this.looping.set(eventKey, bufferId);
		playSound(bufferId, { volume: this.pref.volume, loop: true }).catch(() => {});
	}

	/** Stops a loop started with {@link startLoop}. Returns true if a loop was actually stopped. */
	stopLoop(eventKey: string): boolean {
		const bufferId = this.looping.get(eventKey);
		if (!bufferId) return false;
		this.looping.delete(eventKey);
		soundManager.stopSound(bufferId);
		return true;
	}

	/**
	 * Whether the loaded pack provides an event (at least one decoded buffer). Lets a caller
	 * that has its own built-in fallback (the token-hop animation) decide whether the current
	 * game ships a themed cue for it before playing the fallback.
	 */
	hasEvent(eventKey: string): boolean {
		return (this.loaded.get(eventKey)?.length ?? 0) > 0;
	}

	/**
	 * Plays a one-shot event allowing OVERLAP (rapid consecutive plays don't cut each other
	 * off) at a volume scaled by `scale`. For animation cues like the token hop that fire many
	 * times across a move. Honours mute; no-op if the event has no loaded buffer.
	 */
	playEventOverlap(eventKey: string, scale = 1): void {
		if (this.pref.muted) return;
		const bufferId = pickOne(this.loaded.get(eventKey) ?? []);
		if (!bufferId) return;
		playSound(bufferId, { volume: this.pref.volume * scale, overlap: true }).catch(() => {});
	}
}

export const soundEvents = new SoundEventPlayer();

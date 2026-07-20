import test from 'node:test';
import assert from 'node:assert/strict';
import {
	soundEventForAnnouncement,
	soundEventsForAnnouncement,
	clampVolume,
	soundManifestUrl,
	pickOne,
	readSoundPreference,
	writeSoundPreference,
	DEFAULT_SOUND_PREFERENCE,
	type SoundPreference,
} from '../src/soundEvents.js';

/**
 * Earcons are a parallel, server-driven presentation layer: the game manager hands every
 * announcement key to soundEventForAnnouncement, which decides which sound-pack event (if
 * any) plays. These tests pin that pure mapping plus the persisted mute/volume preference
 * and the random file picker.
 */

test('maps the dice-roll announcement variants to the dice.roll earcon', () => {
	assert.equal(soundEventForAnnouncement('game.dice_rolled'), 'dice.roll');
	// Losing a piece: the earcon rides the VICTIM's targeted line only.
	assert.equal(soundEventForAnnouncement('game.race_captured_victim'), 'piece.captured');
	assert.equal(soundEventForAnnouncement('game.race_captured'), null);
	assert.equal(soundEventForAnnouncement('game.dice_rolled_doubles'), 'dice.roll');
});

test('the first-person _self variant shares the base key earcon', () => {
	assert.equal(soundEventForAnnouncement('game.dice_rolled_self'), 'dice.roll');
	assert.equal(soundEventForAnnouncement('game.property_purchased_self'), 'property.buy');
});

test('my turn (turn_of_self) gets the distinct your-turn cue, others are silent', () => {
	assert.equal(soundEventForAnnouncement('game.turn_of_self'), 'turn.you');
	assert.equal(soundEventForAnnouncement('game.turn_of'), null);
});

test('journey distances cue PER VALUE (packs ship one sound per km card)', () => {
	assert.equal(soundEventForAnnouncement('game.journey_played_distance', { km: 25 }), 'journey.distance.25');
	assert.equal(soundEventForAnnouncement('game.journey_played_distance_self', { km: 200 }), 'journey.distance.200');
	assert.equal(soundEventForAnnouncement('game.journey_played_distance', {}), null); // no km, no cue
});

test('journey engine lines carry their earcons (variants inherit)', () => {
	assert.equal(soundEventForAnnouncement('game.journey_drew'), 'card.draw');
	assert.equal(soundEventForAnnouncement('game.journey_drew_self'), 'card.draw');
	assert.equal(soundEventForAnnouncement('game.journey_discarded'), 'card.discard');
	assert.equal(soundEventForAnnouncement('game.journey_discarded_self'), 'card.discard');
	assert.equal(soundEventForAnnouncement('game.journey_new_hand'), 'cards.shuffle');
	assert.equal(soundEventForAnnouncement('game.journey_now_rolling_self'), 'journey.rolling');
	assert.equal(soundEventForAnnouncement('game.journey_played_immunity'), 'journey.immunity');
	assert.equal(soundEventForAnnouncement('game.journey_coup_self'), 'journey.coup');
});

test('assembly pieces cue PER COLOUR (packs ship one sound per piece: heart, bone…)', () => {
	assert.equal(soundEventForAnnouncement('game.assembly_played_piece', { color: 'red' }), 'assembly.piece.red');
	assert.equal(soundEventForAnnouncement('game.assembly_played_piece_self', { color: 'wild' }), 'assembly.piece.wild');
	assert.equal(soundEventForAnnouncement('game.assembly_played_piece', {}), null); // no colour, no cue
});

test('assembly engine lines carry their earcons (attacks/specials go through pack maps)', () => {
	assert.equal(soundEventForAnnouncement('game.assembly_attacked'), 'assembly.attack');
	assert.equal(soundEventForAnnouncement('game.assembly_played_remedy_self'), 'assembly.remedy');
	assert.equal(soundEventForAnnouncement('game.assembly_played_special'), 'assembly.special');
	assert.equal(soundEventForAnnouncement('game.assembly_discarded'), 'card.discard');
	// The refill: the table's count line, the actor's 1-card line (via _self stripping)
	// and the suffixed 2/3/many self lines, which the stripping can't see.
	assert.equal(soundEventForAnnouncement('game.assembly_refilled'), 'card.draw');
	assert.equal(soundEventForAnnouncement('game.assembly_refilled_self'), 'card.draw');
	assert.equal(soundEventForAnnouncement('game.assembly_refilled_self_2'), 'card.draw');
	assert.equal(soundEventForAnnouncement('game.assembly_refilled_self_3'), 'card.draw');
	assert.equal(soundEventForAnnouncement('game.assembly_refilled_self_many'), 'card.draw');
});

test('every exploding action warns while its Nope window is open', () => {
	assert.equal(soundEventForAnnouncement('game.exploding_shuffled'), 'cards.shuffle');
	assert.equal(soundEventForAnnouncement('game.exploding_shuffled_self'), 'cards.shuffle');
	assert.equal(soundEventForAnnouncement('game.exploding_drew'), 'card.draw');
	assert.equal(soundEventForAnnouncement('game.exploding_drew_self'), 'card.draw');
	// Skip, Attack, Shuffle, See the Future and Favor all use this same play line.
	assert.equal(soundEventForAnnouncement('game.exploding_played'), 'exploding.played');
	assert.equal(soundEventForAnnouncement('game.exploding_played_self'), 'exploding.played');
	// A cat pair has clearer wording but opens exactly the same Nope window.
	assert.equal(soundEventForAnnouncement('game.exploding_played_cat_pair'), 'exploding.played');
	assert.equal(soundEventForAnnouncement('game.exploding_played_cat_pair_self'), 'exploding.played');
	assert.deepEqual(soundEventsForAnnouncement('game.exploding_played_cat_pair'),
		['exploding.played', 'exploding.cat']);
	assert.deepEqual(soundEventsForAnnouncement('game.exploding_played_cat_pair_self'),
		['exploding.played', 'exploding.cat']);
	// Once the window closes, the effect gets its own cue. Attack has no second rising tone;
	// a successful cat pair now sounds the actual steal (a Noped pair never reaches this line).
	assert.equal(soundEventForAnnouncement('game.exploding_attacked'), null);
	assert.equal(soundEventForAnnouncement('game.exploding_stole'), 'exploding.steal');
	assert.equal(soundEventForAnnouncement('game.exploding_stole_self'), 'exploding.steal');
	assert.equal(soundEventForAnnouncement('game.exploding_stole_victim'), 'exploding.steal');
	// Packages may still replace the complete play cue.
	assert.equal(soundEventForAnnouncement(
		'game.exploding_played', undefined, { 'game.exploding_played': 'custom.warning' }),
	'custom.warning');
	// The bomb-specific cues stay family-specific.
	assert.equal(soundEventForAnnouncement('game.exploding_exploded'), 'exploding.boom');
	assert.equal(soundEventForAnnouncement('game.exploding_drew_bomb_defused'), 'exploding.defuse');
});

test('a Nope plays its response cue and restarts the rising reaction warning', () => {
	assert.deepEqual(soundEventsForAnnouncement('game.exploding_noped'),
		['exploding.nope', 'exploding.played']);
	assert.deepEqual(soundEventsForAnnouncement('game.exploding_noped_self'),
		['exploding.nope', 'exploding.played']);
	assert.deepEqual(soundEventsForAnnouncement('game.exploding_noped', undefined, {
		'game.exploding_noped': 'custom.nope',
		'game.exploding_played': 'custom.warning',
	}), ['custom.nope', 'custom.warning']);
});

test('a pack announcement map wins, and _self/_victim variants inherit its base entry', () => {
	const pack = {
		'cards.limite_played': 'journey.limited',
		'game.dice_rolled': 'pack.override', // an engine key re-mapped for this game only
	};
	assert.equal(soundEventForAnnouncement('cards.limite_played', undefined, pack), 'journey.limited');
	assert.equal(soundEventForAnnouncement('cards.limite_played_self', undefined, pack), 'journey.limited');
	assert.equal(soundEventForAnnouncement('cards.limite_played_victim', undefined, pack), 'journey.limited');
	assert.equal(soundEventForAnnouncement('game.dice_rolled', undefined, pack), 'pack.override');
	// Without a pack map, unthemed package keys stay silent.
	assert.equal(soundEventForAnnouncement('cards.limite_played_victim'), null);
});

test('every server validation error has no earcon (no error sound assigned yet)', () => {
	assert.equal(soundEventForAnnouncement('serverErrors.BID_TOO_LOW'), null);
	assert.equal(soundEventForAnnouncement('serverErrors.PLAYER_NOT_FOUND'), null);
});

test('maps representative game events to their earcons', () => {
	assert.equal(soundEventForAnnouncement('game.property_purchased'), 'property.buy');
	assert.equal(soundEventForAnnouncement('game.auction_won'), 'property.buy');
	assert.equal(soundEventForAnnouncement('game.building_built'), 'property.build');
	assert.equal(soundEventForAnnouncement('game.buildings_sold'), 'property.sell');
	// Landing on a developed property quacks (distinct from building one yourself).
	assert.equal(soundEventForAnnouncement('game.landed_on_building'), 'property.built');
	assert.equal(soundEventForAnnouncement('game.landed_on_buildings'), 'property.built');
	assert.equal(soundEventForAnnouncement('game.landed_on_big_building'), 'property.built');
	assert.equal(soundEventForAnnouncement('game.landed_on_big_building_self'), 'property.built');
	assert.equal(soundEventForAnnouncement('game.group_completed'), 'group.complete');
	assert.equal(soundEventForAnnouncement('game.rent_paid'), 'money.pay');
	assert.equal(soundEventForAnnouncement('game.paid_holding_release_cost'), 'money.pay');
	assert.equal(soundEventForAnnouncement('game.collected_from_all'), 'money.receive');
	assert.equal(soundEventForAnnouncement('game.debt_cleared'), 'money.receive');
	assert.equal(soundEventForAnnouncement('game.debt_cleared_self'), 'money.receive');
	assert.equal(soundEventForAnnouncement('game.tax_paid'), 'tax.pay');
	assert.equal(soundEventForAnnouncement('game.passed_through_go'), 'money.salary');
	assert.equal(soundEventForAnnouncement('game.landed_on_go'), 'money.salary');
	assert.equal(soundEventForAnnouncement('game.free_parking_collect'), 'rest.zone');
	// Landing on Free Parking with an empty pot has its own dry-spin cue (and its _self variant).
	assert.equal(soundEventForAnnouncement('game.free_parking_empty'), 'rest.zone.empty');
	assert.equal(soundEventForAnnouncement('game.free_parking_empty_self'), 'rest.zone.empty');
	assert.equal(soundEventForAnnouncement('game.send_to_holding'), 'holding.enter');
	assert.equal(soundEventForAnnouncement('game.escaped_holding_doubles'), 'holding.leave');
	assert.equal(soundEventForAnnouncement('game.auction_started'), 'auction.start');
	assert.equal(soundEventForAnnouncement('game.game_over'), 'game.over');
	assert.equal(soundEventForAnnouncement('game.player_bankrupt'), 'bankruptcy');
	// Platform connect/disconnect cues (my own reconnect rides the _self variant).
	assert.equal(soundEventForAnnouncement('game.player_disconnected'), 'disconnect');
	assert.equal(soundEventForAnnouncement('game.player_reconnected'), 'connect');
	assert.equal(soundEventForAnnouncement('game.player_reconnected_self'), 'connect');
});

test('returns null for announcements with no earcon and for empty input', () => {
	assert.equal(soundEventForAnnouncement('game.waiting_for_start'), null);
	assert.equal(soundEventForAnnouncement('game.trade_proposed'), null);
	assert.equal(soundEventForAnnouncement('game.property_mortgaged'), null);
	assert.equal(soundEventForAnnouncement(''), null);
});

test('landing on a station plays the station earcon (picked from squareType, not the key)', () => {
	// The landing key is generic across square kinds, so the cue comes from squareType. The
	// shipped boards type their stations "transit" — the exact value the server sends here.
	assert.equal(soundEventForAnnouncement('game.landed_on_property', { squareType: 'transit' }), 'transit');
	// The acting player receives the first-person variant; it must resolve the same.
	assert.equal(soundEventForAnnouncement('game.landed_on_property_self', { squareType: 'transit' }), 'transit');
	// "railroad" stays supported as a legacy alias for boards that named the kind that way.
	assert.equal(soundEventForAnnouncement('game.landed_on_property', { squareType: 'railroad' }), 'transit');
});

test('landing on non-railroad squares has no earcon (only stations cue today)', () => {
	assert.equal(soundEventForAnnouncement('game.landed_on_property', { squareType: 'utility' }), null);
	assert.equal(soundEventForAnnouncement('game.landed_on_property', { squareType: 'property' }), null);
	// Colored streets never carry a railroad type, so they stay silent too.
	assert.equal(soundEventForAnnouncement('game.landed_on_property_colored', { squareType: 'property' }), null);
	// Missing vars must not throw and yields no cue.
	assert.equal(soundEventForAnnouncement('game.landed_on_property'), null);
});

test('clampVolume bounds to [0,1] and falls back on non-finite input', () => {
	assert.equal(clampVolume(0.5), 0.5);
	assert.equal(clampVolume(-1), 0);
	assert.equal(clampVolume(2), 1);
	assert.equal(clampVolume(Number.NaN), DEFAULT_SOUND_PREFERENCE.volume);
});

test('soundManifestUrl scopes to a package pack id, and omits it for built-in boards', () => {
	// Built-in board (no token): the default pack.
	assert.equal(soundManifestUrl(), '/api/sounds/manifest');
	assert.equal(soundManifestUrl(undefined), '/api/sounds/manifest');
	assert.equal(soundManifestUrl(null), '/api/sounds/manifest');
	// Package game: the game's token becomes the pack id, url-encoded.
	assert.equal(soundManifestUrl('abc123'), '/api/sounds/manifest?pack=abc123');
	assert.equal(soundManifestUrl('a b/c'), '/api/sounds/manifest?pack=a%20b%2Fc');
});

test('pickOne returns undefined for empty, the sole item for one, and a member otherwise', () => {
	assert.equal(pickOne([]), undefined);
	assert.equal(pickOne(['only']), 'only');
	// Deterministic rng selects by index; the clamp guards rng() === 1.
	assert.equal(pickOne(['a', 'b', 'c'], () => 0), 'a');
	assert.equal(pickOne(['a', 'b', 'c'], () => 0.5), 'b');
	assert.equal(pickOne(['a', 'b', 'c'], () => 0.99), 'c');
	assert.equal(pickOne(['a', 'b', 'c'], () => 1), 'c');
});

/** Minimal in-memory Storage stand-in. */
function fakeStorage(initial?: string): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; data: Map<string, string> } {
	const data = new Map<string, string>();
	if (initial !== undefined) data.set('corro.soundPreference', initial);
	return {
		data,
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => { data.set(k, v); },
	};
}

test('readSoundPreference returns the default when storage is empty or null', () => {
	assert.deepEqual(readSoundPreference(fakeStorage()), DEFAULT_SOUND_PREFERENCE);
	assert.deepEqual(readSoundPreference(null), DEFAULT_SOUND_PREFERENCE);
});

test('readSoundPreference round-trips a written preference and clamps its volume', () => {
	const storage = fakeStorage();
	const pref: SoundPreference = { muted: true, volume: 1.5 };
	writeSoundPreference(storage, pref);
	const read = readSoundPreference(storage);
	assert.equal(read.muted, true);
	assert.equal(read.volume, 1); // clamped
});

test('readSoundPreference falls back to the default on corrupt JSON', () => {
	assert.deepEqual(readSoundPreference(fakeStorage('{not json')), DEFAULT_SOUND_PREFERENCE);
});

test('readSoundPreference fills missing fields from the default', () => {
	const read = readSoundPreference(fakeStorage('{"muted":true}'));
	assert.equal(read.muted, true);
	assert.equal(read.volume, DEFAULT_SOUND_PREFERENCE.volume);
});

// === The preload/earcon race queue ===
//
// The first roll's announcement can arrive within milliseconds of the first-gesture
// preload starting, before its buffer has decoded. The player must HOLD such cues and
// replay them when preload settles — and it must settle even when the preload fails, so
// cues never queue forever.

import { SoundEventPlayer } from '../src/soundEvents.js';
import { soundManager } from '../src/sound.js';

/** Patches the shared soundManager + fetch for one test; returns played ids + a restore. */
function stubAudio(manifest: { ok: boolean; events?: Record<string, string[]> }) {
	const played: string[] = [];
	const original = {
		isSupported: soundManager.isSupported,
		loadSound: soundManager.loadSound,
		playSound: soundManager.playSound,
		fetch: (globalThis as any).fetch,
	};
	soundManager.isSupported = () => true;
	soundManager.loadSound = async () => true;
	soundManager.playSound = async (id: string) => { played.push(id); return true; };
	(globalThis as any).fetch = async () => ({
		ok: manifest.ok,
		status: manifest.ok ? 200 : 500,
		json: async () => ({ packId: 'test', events: manifest.events ?? {} }),
	});
	const restore = () => {
		soundManager.isSupported = original.isSupported;
		soundManager.loadSound = original.loadSound;
		soundManager.playSound = original.playSound;
		(globalThis as any).fetch = original.fetch;
	};
	return { played, restore };
}

test('the event player sounds a Nope and its restarted reaction window together', async () => {
	const { played, restore } = stubAudio({
		ok: true,
		events: {
			'exploding.nope': ['/nope.ogg'],
			'exploding.played': ['/warning.ogg'],
		},
	});
	try {
		const player = new SoundEventPlayer();
		await player.preload();
		player.playForAnnouncement('game.exploding_noped_self');
		assert.deepEqual(played, ['exploding.nope#0', 'exploding.played#0']);
	} finally { restore(); }
});

test('the event player sounds the cat together with the rising warning, then the steal on resolution', async () => {
	const { played, restore } = stubAudio({
		ok: true,
		events: {
			'exploding.played': ['/warning.ogg'],
			'exploding.cat': ['/cat.ogg'],
			'exploding.steal': ['/steal.ogg'],
		},
	});
	try {
		const player = new SoundEventPlayer();
		await player.preload();

		player.playForAnnouncement('game.exploding_played_cat_pair_self');
		assert.deepEqual(played, ['exploding.played#0', 'exploding.cat#0']);

		player.playForAnnouncement('game.exploding_stole_self');
		assert.deepEqual(played, ['exploding.played#0', 'exploding.cat#0', 'exploding.steal#0']);
	} finally { restore(); }
});

test('an earcon that races the preload is queued and replayed once buffers load', async () => {
	const { played, restore } = stubAudio({ ok: true, events: { 'dice.roll': ['/a.ogg'] } });
	try {
		const player = new SoundEventPlayer();
		player.playEvent('dice.roll'); // preload has not even started: must not be dropped
		assert.deepEqual(played, []);
		await player.preload();
		assert.deepEqual(played, ['dice.roll#0'], 'the queued cue replays on settle');

		player.playEvent('dice.roll'); // after settle, cues play straight through
		assert.deepEqual(played, ['dice.roll#0', 'dice.roll#0']);
	} finally { restore(); }
});

test('a failed preload still settles: queued cues are dropped, later ones stop queueing', async () => {
	const { played, restore } = stubAudio({ ok: false });
	try {
		const player = new SoundEventPlayer();
		player.playEvent('dice.roll');
		await player.preload(); // manifest 500 → nothing loads, but the queue must settle
		player.playEvent('dice.roll');
		player.playEvent('turn.you');
		assert.deepEqual(played, [], 'nothing plays without buffers — and nothing throws');
	} finally { restore(); }
});

test('the race queue is capped so a never-interacting tab cannot grow it unbounded', async () => {
	const { played, restore } = stubAudio({ ok: true, events: { 'dice.roll': ['/a.ogg'] } });
	try {
		const player = new SoundEventPlayer();
		for (let i = 0; i < 10; i++) player.playEvent('dice.roll');
		await player.preload();
		assert.equal(played.length, 4, 'only the capped queue replays');
	} finally { restore(); }
});

test('muted cues are never queued', async () => {
	const { played, restore } = stubAudio({ ok: true, events: { 'dice.roll': ['/a.ogg'] } });
	try {
		const player = new SoundEventPlayer();
		player.setMuted(true);
		player.playEvent('dice.roll');
		await player.preload();
		assert.deepEqual(played, []);
	} finally { restore(); }
});

// === Switching packs once the game token is known ===
//
// The first-gesture preload can fire in the LOBBY (before any game token exists) and cache
// only the platform pack. switchPack loads the game's own sounds when its token arrives —
// otherwise game earcons would stay silent (regression when the engine default was slimmed to
// platform-only).

/** Stub whose manifest depends on whether a pack token is requested (lobby vs game). */
function stubPackAudio() {
	const played: string[] = [];
	let fetches = 0;
	const original = {
		isSupported: soundManager.isSupported,
		loadSound: soundManager.loadSound,
		playSound: soundManager.playSound,
		fetch: (globalThis as any).fetch,
	};
	soundManager.isSupported = () => true;
	soundManager.loadSound = async () => true;
	soundManager.playSound = async (id: string) => { played.push(id); return true; };
	(globalThis as any).fetch = async (url: string) => {
		fetches++;
		const events = String(url).includes('pack=')
			? { 'error': ['/e.ogg'], 'dice.roll': ['/d.ogg'] }  // the game's (merged) pack
			: { 'error': ['/e.ogg'] };                          // platform-only default
		return { ok: true, status: 200, json: async () => ({ packId: 'x', events }) };
	};
	const restore = () => {
		soundManager.isSupported = original.isSupported;
		soundManager.loadSound = original.loadSound;
		soundManager.playSound = original.playSound;
		(globalThis as any).fetch = original.fetch;
	};
	return { played, restore, fetches: () => fetches };
}

test('switchPack loads the game pack after a lobby preload cached only the platform pack', async () => {
	const { played, restore } = stubPackAudio();
	try {
		const player = new SoundEventPlayer();
		await player.preload(undefined);       // first gesture in the lobby: no token yet
		player.playEvent('dice.roll');
		assert.deepEqual(played, [], 'the platform-only pack has no dice.roll');
		await player.switchPack('game-token'); // the game state arrives with its token
		player.playEvent('dice.roll');
		assert.deepEqual(played, ['dice.roll#0'], 'the game pack now provides dice.roll');
	} finally { restore(); }
});

test('switchPack no-ops before preload settles and when the pack is unchanged', async () => {
	const { restore, fetches } = stubPackAudio();
	try {
		const player = new SoundEventPlayer();
		await player.switchPack('t');   // before any preload: must not fetch
		assert.equal(fetches(), 0);
		await player.preload('t');      // the first gesture already knows the token
		assert.equal(fetches(), 1);
		await player.switchPack('t');   // same pack: no refetch
		assert.equal(fetches(), 1);
		await player.switchPack('other'); // a different game: refetch
		assert.equal(fetches(), 2);
	} finally { restore(); }
});

test('a cue that races switchPack is queued and replayed once the game pack loads', async () => {
	// The deal's first card.draw can fire while switchPack is still downloading the game pack.
	let releaseLoad: () => void = () => {};
	const loadGate = new Promise<void>(r => { releaseLoad = r; });
	const played: string[] = [];
	const original = {
		isSupported: soundManager.isSupported, loadSound: soundManager.loadSound,
		playSound: soundManager.playSound, fetch: (globalThis as any).fetch,
	};
	soundManager.isSupported = () => true;
	soundManager.loadSound = async () => { await loadGate; return true; }; // block the decode
	soundManager.playSound = async (id: string) => { played.push(id); return true; };
	(globalThis as any).fetch = async (url: string) => ({
		ok: true, status: 200,
		json: async () => ({ packId: 'x', events: String(url).includes('pack=') ? { 'card.draw': ['/d.ogg'] } : {} }),
	});
	try {
		const player = new SoundEventPlayer();
		await player.preload(undefined);          // lobby: platform-only, settled
		const switching = player.switchPack('token'); // starts loading, blocked on the gate
		player.playEvent('card.draw');            // races the load: must queue, not drop
		assert.deepEqual(played, [], 'nothing plays while the pack is still loading');
		releaseLoad();
		await switching;
		assert.deepEqual(played, ['card.draw#0'], 'the queued cue replays once the pack loads');
	} finally {
		soundManager.isSupported = original.isSupported; soundManager.loadSound = original.loadSound;
		soundManager.playSound = original.playSound; (globalThis as any).fetch = original.fetch;
	}
});

// === Looping ambience (the auction countdown clock) ===
//
// startLoop/stopLoop drive a sound tied to a lifecycle rather than a one-shot announcement:
// the auction clock ticks (looped) while the auction runs and stops with a ding when it ends.

/** Like stubAudio but also records play OPTIONS and stopSound ids, for the loop tests. */
function stubLoopAudio(events: Record<string, string[]>) {
	const plays: Array<{ id: string; loop: boolean }> = [];
	const stopped: string[] = [];
	const original = {
		isSupported: soundManager.isSupported,
		loadSound: soundManager.loadSound,
		playSound: soundManager.playSound,
		stopSound: soundManager.stopSound,
		fetch: (globalThis as any).fetch,
	};
	soundManager.isSupported = () => true;
	soundManager.loadSound = async () => true;
	soundManager.playSound = async (id: string, options?: { loop?: boolean }) => {
		plays.push({ id, loop: options?.loop === true });
		return true;
	};
	soundManager.stopSound = (id: string) => { stopped.push(id); return true; };
	(globalThis as any).fetch = async () => ({
		ok: true, status: 200, json: async () => ({ packId: 'test', events }),
	});
	const restore = () => {
		soundManager.isSupported = original.isSupported;
		soundManager.loadSound = original.loadSound;
		soundManager.playSound = original.playSound;
		soundManager.stopSound = original.stopSound;
		(globalThis as any).fetch = original.fetch;
	};
	return { plays, stopped, restore };
}

test('startLoop plays the event looped and stopLoop stops that exact buffer', async () => {
	const { plays, stopped, restore } = stubLoopAudio({ 'auction.tick': ['/t.ogg'] });
	try {
		const player = new SoundEventPlayer();
		await player.preload();
		player.startLoop('auction.tick');
		assert.deepEqual(plays, [{ id: 'auction.tick#0', loop: true }]);
		assert.equal(player.stopLoop('auction.tick'), true);
		assert.deepEqual(stopped, ['auction.tick#0']);
	} finally { restore(); }
});

test('startLoop is idempotent: a second call while looping does not stack a second clock', async () => {
	const { plays, restore } = stubLoopAudio({ 'auction.tick': ['/t.ogg'] });
	try {
		const player = new SoundEventPlayer();
		await player.preload();
		player.startLoop('auction.tick');
		player.startLoop('auction.tick');
		assert.equal(plays.length, 1, 'only one loop ever starts');
	} finally { restore(); }
});

test('a muted player starts no loop; stopLoop then reports nothing was playing', async () => {
	const { plays, restore } = stubLoopAudio({ 'auction.tick': ['/t.ogg'] });
	try {
		const player = new SoundEventPlayer();
		await player.preload();
		player.setMuted(true);
		player.startLoop('auction.tick');
		assert.deepEqual(plays, []);
		assert.equal(player.stopLoop('auction.tick'), false);
	} finally { restore(); }
});

test('stopLoop on an event that never looped is a harmless no-op', async () => {
	const { stopped, restore } = stubLoopAudio({ 'auction.tick': ['/t.ogg'] });
	try {
		const player = new SoundEventPlayer();
		await player.preload();
		assert.equal(player.stopLoop('auction.tick'), false);
		assert.deepEqual(stopped, []);
	} finally { restore(); }
});

test('startLoop stays silent when the buffer has not loaded', async () => {
	const { plays, restore } = stubLoopAudio({}); // manifest declares no events
	try {
		const player = new SoundEventPlayer();
		await player.preload();
		player.startLoop('auction.tick');
		assert.deepEqual(plays, []);
		assert.equal(player.stopLoop('auction.tick'), false);
	} finally { restore(); }
});

// === Package-overridable one-shots with a client fallback (the token hop) ===
//
// A package MAY ship a themed `token.hop`; the client checks hasEvent and, when the pack has
// none, plays its own built-in finger sound instead — so the hop is never silent.

test('hasEvent reflects whether the loaded pack provides an event', async () => {
	const { restore } = stubLoopAudio({ 'token.hop': ['/hop.ogg'] });
	try {
		const player = new SoundEventPlayer();
		await player.preload();
		assert.equal(player.hasEvent('token.hop'), true);
		assert.equal(player.hasEvent('not.declared'), false);
	} finally { restore(); }
});

test('playEventOverlap plays a loaded event and is a no-op when muted or unloaded', async () => {
	const { plays, restore } = stubLoopAudio({ 'token.hop': ['/hop.ogg'] });
	try {
		const player = new SoundEventPlayer();
		await player.preload();
		player.playEventOverlap('token.hop', 0.5);
		assert.deepEqual(plays, [{ id: 'token.hop#0', loop: false }], 'plays overlapped, not looped');
		player.playEventOverlap('absent.event');
		assert.equal(plays.length, 1, 'unloaded event: no play');
		player.setMuted(true);
		player.playEventOverlap('token.hop');
		assert.equal(plays.length, 1, 'muted: no play');
	} finally { restore(); }
});

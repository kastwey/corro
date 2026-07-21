import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setupDom, installFakeI18next } from './helpers/dom.js';

// Guard test: every command bound in keymap.json MUST have a localized help
// description. The bug this prevents: a new shortcut is added to keymap.json but
// describeCommand has no case for it, so the help table silently falls back to
// the raw English command name (e.g. "PayReleaseCost") even when playing in Spanish.
// The other frontend tests never exercised describeCommand, so this slipped past.

let describeCommand: (cmd: string, args: any, family?: string) => string;
let showHelpDialog: typeof import('../src/helpDialog.js').showHelpDialog;
let tSync: typeof import('../src/i18nBinder.js').tSync;
let CARD_FAMILY_HIDDEN_COMMANDS: Set<string>;
let keyMap: Record<string, any>;

// The shedding hand + status keys, as the active board hands them to the help dialog. The
// board's OWN test (sheddingBoard.test.ts) proves these are what its wiring actually emits;
// here they stand in for "what a card family passes as extraShortcuts".
const SHEDDING_SHORTCUTS = [
	{ keys: 'enter', descKey: 'game.help_cmd_play_card' },
	{ keys: 'space', descKey: 'game.help_cmd_shedding_draw' },
	{ keys: 's', descKey: 'game.help_cmd_status_mine' },
	{ keys: 'shift+s', descKey: 'game.help_cmd_status_rivals' },
	{ keys: 'd', descKey: 'game.help_cmd_shedding_piles' },
];

// Every description key a card family can hand to the help dialog. The keys are declared in
// the boards (their hand.init shortcutText) + cardBoardShell (CARD_STATUS_SHORTCUTS); this
// list is the i18n contract they must satisfy in every locale.
const CARD_DESC_KEYS = [
	'game.help_cmd_play_card', 'game.help_cmd_pick_card',
	'game.help_cmd_draw_card', 'game.help_cmd_shedding_draw',
	'game.help_cmd_discard_card', 'game.help_cmd_multi_select',
	'game.help_cmd_card_help',
	'game.help_cmd_journey_deck', 'game.help_cmd_assembly_piles',
	'game.help_cmd_draft_deck', 'game.help_cmd_shedding_piles',
	'game.help_cmd_exploding_top',
	'game.help_cmd_last_card_declare', 'game.help_cmd_last_card_catch', 'game.help_cmd_last_card_watch',
	'game.help_cmd_status_mine', 'game.help_cmd_status_rivals',
];

before(async () => {
	setupDom();
	const here = dirname(fileURLToPath(import.meta.url));
	// The keymap is now owned by the server (single source of truth, served at /api/config/keymap).
	keyMap = JSON.parse(readFileSync(join(here, '..', '..', 'server', 'Config', 'keymap.json'), 'utf-8'));
	({ describeCommand, showHelpDialog } = await import('../src/helpDialog.js'));
	({ tSync } = await import('../src/i18nBinder.js'));
	({ CARD_FAMILY_HIDDEN_COMMANDS } = await import('../src/keys.js'));
});

for (const lang of ['en', 'es'] as const) {
	test(`every keymap command has a localized help description (${lang})`, () => {
		installFakeI18next(lang);
		const missing: string[] = [];
		for (const mapping of Object.values(keyMap)) {
			const cmd = typeof mapping === 'string' ? mapping : mapping?.cmd;
			const args = typeof mapping === 'string' ? undefined : mapping?.args;
			if (!cmd) continue;
			const desc = describeCommand(cmd, args);
			// A handled command resolves to translated text. An unhandled one
			// returns the raw command name; a handled-but-untranslated key leaks
			// its "game.help_cmd_*" key. Both are failures.
			if (desc === cmd || desc.startsWith('game.')) missing.push(cmd);
		}
		assert.deepEqual(missing, [], `Commands without a localized help description: ${missing.join(', ')}`);
	});

	test(`every card shortcut description resolves in ${lang}`, () => {
		installFakeI18next(lang);
		// These descKeys reach i18n as variables (object values), so the static
		// translations.test can't see them — resolve each here to catch a typo or a
		// missing locale entry.
		const missing = CARD_DESC_KEYS.filter(key => {
			const desc = tSync(key);
			return desc === key || desc.startsWith('game.');
		});
		assert.deepEqual(missing, [], `Card shortcut descriptions not localized: ${missing.join(', ')}`);
	});
}

// Live-play confusion: in a single-piece family the multi-piece phrasing ("your NEXT
// piece") read as if M cycled your properties — that cycle lives on H/Shift+H. Only the
// race family fields several pieces, so only it keeps the next/previous wording.
test('GoToMe reads singular off the race family, next/previous on it', () => {
	installFakeI18next('en');
	const single = describeCommand('GoToMe', { forward: true }, 'property');
	assert.equal(single, describeCommand('GoToMe', { forward: false }, 'property'), 'one piece: both directions mean the same');
	assert.ok(!/next|previous/i.test(single), 'no next/previous phrasing with a single piece');
	assert.notEqual(
		describeCommand('GoToMe', { forward: true }, 'race'),
		describeCommand('GoToMe', { forward: false }, 'race'),
		'several pieces: forward and backward are different actions');
});

test('the table collapses two bindings that mean the same action in this family', async () => {
	installFakeI18next('en');
	const { dialogManager } = await import('../src/dialogManager.js');
	dialogManager.init();
	showHelpDialog({
		'm': { cmd: 'GoToMe', args: { forward: true } },
		'shift+m': { cmd: 'GoToMe', args: { forward: false } },
	}, { activeFamily: 'property' });

	const rows = document.querySelectorAll('.help-shortcuts tbody tr');
	// One GoToMe row (deduped) + the static 0–9 number-navigation row.
	assert.equal(rows.length, 2);
	dialogManager.close();
});

// "How am I doing?" is ONE key with a per-family answer — the help must describe THIS
// game's answer, never the old multi-game sentence ("...or your squadron / piece colour...").
test('AnnounceMyStatus (C) reads per family, not as one generic sentence', () => {
	installFakeI18next('en');
	const property = describeCommand('AnnounceMyStatus', undefined, 'property');
	const race = describeCommand('AnnounceMyStatus', undefined, 'race');
	const track = describeCommand('AnnounceMyStatus', undefined, 'track');
	assert.equal(property, 'Announce your money');
	assert.equal(race, 'Announce your squadron');
	assert.equal(track, 'Announce your piece and colour');
	// No row lists two games' meanings at once.
	for (const desc of [property, race, track]) assert.ok(!/\bor\b/i.test(desc), desc);
});

// The bug: in a shedding card game, the help still listed board-movement / dice / economy
// keys and the "0–9 jump to a square" row — none of which exist there — and omitted the
// game's real keys (Enter plays, Space draws, S / Shift+S counts).
test('a card family hides board keys + the number row and shows its own hand/status keys', async () => {
	installFakeI18next('en');
	const { dialogManager } = await import('../src/dialogManager.js');
	dialogManager.init();
	showHelpDialog(keyMap, {
		activeFamily: 'shedding',
		hiddenCommands: CARD_FAMILY_HIDDEN_COMMANDS,
		extraShortcuts: SHEDDING_SHORTCUTS,
		showNumberNav: false,
	});

	const text = document.querySelector('.help-shortcuts')!.textContent ?? '';
	// Gone: things a card game has no board/dice/economy for.
	assert.ok(!text.includes('Roll the dice'), 'no dice roll in a card game');
	assert.ok(!text.includes('Move to the square'), 'no per-square movement');
	assert.ok(!text.includes('Go to your token'), 'no piece jump');
	assert.ok(!text.includes('typing its number'), 'no 0–9 square jump');
	assert.ok(!text.includes('Buy the current property'), 'no economy');
	// Present: the game's own keys, described for THIS game.
	assert.ok(text.includes('Play the focused card'), 'Enter plays');
	assert.ok(text.includes('Draw a card'), 'Space draws');
	assert.ok(text.includes('Announce your status'), 'S — your status');
	assert.ok(text.includes("other players' status"), 'Shift+S — rivals');
	assert.ok(text.includes('Read the deck, top card and colour in force'), 'D — shared piles');
	dialogManager.close();
});

test('the card hand/status keys lead the table (before the leftover generic rows)', async () => {
	installFakeI18next('en');
	const { dialogManager } = await import('../src/dialogManager.js');
	dialogManager.init();
	showHelpDialog(keyMap, {
		activeFamily: 'shedding',
		hiddenCommands: CARD_FAMILY_HIDDEN_COMMANDS,
		extraShortcuts: SHEDDING_SHORTCUTS,
		showNumberNav: false,
	});
	const firstRowDesc = document.querySelector('.help-shortcuts tbody tr td')?.textContent ?? '';
	assert.equal(firstRowDesc, 'Play the focused card');
	dialogManager.close();
});

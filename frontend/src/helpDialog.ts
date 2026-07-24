/**
 * Help dialog: renders an accessible table with every keyboard shortcut from
 * the active keymap. The table is built dynamically so it always matches
 * keymap.json. Purely informational; opened with F1.
 */

import { dialogManager } from './dialogManager.js';
import { tSync } from './i18nBinder.js';
import type { HelpShortcut } from './shortcuts.js';

/** Turns a key spec like "ctrl+p" or "arrowleft" into a readable label. */
function humanizeKeyPart(part: string): string {
	switch (part) {
		case 'ctrl': return tSync('game.key_ctrl');
		case 'shift': return tSync('game.key_shift');
		case 'alt': return tSync('game.key_alt');
		case 'meta': return tSync('game.key_meta');
		case 'enter': return tSync('game.key_enter');
		case 'space': return tSync('game.key_space');
		case 'delete': return tSync('game.key_delete');
		case 'home': return tSync('game.key_home');
		case 'arrowup': return tSync('game.key_arrowup');
		case 'arrowdown': return tSync('game.key_arrowdown');
		case 'arrowleft': return tSync('game.key_arrowleft');
		case 'arrowright': return tSync('game.key_arrowright');
		case 'end': return tSync('game.key_end');
		default:
			if (/^f\d+$/.test(part)) return part.toUpperCase(); // F1, F2...
			return part.length === 1 ? part.toUpperCase() : part;
	}
}

function humanizeKey(spec: string): string {
	return spec.split('+').map(humanizeKeyPart).join(' + ');
}

/** Maps a command (and optional args) to its localized description. `family` picks the
 *  phrasing where the same key means something different per family (e.g. GoToMe). */
export function describeCommand(cmd: string, args: any, family?: string): string {
	switch (cmd) {
		case 'WhoIsOnSquare': return tSync('game.help_cmd_who');
		case 'ShowPropertyInfo': return tSync('game.help_cmd_property_info');
		case 'AnnounceOwner': return tSync('game.help_cmd_owner');
		case 'AnnounceTurn': return tSync('game.help_cmd_turn');
		case 'AnnounceMyStatus':
			// One key ("how am I doing?"), a different answer per family — describe THAT
			// family's answer, never the whole multi-game sentence. (Card families hide C
			// entirely; their S key carries this, so they never reach here.)
			if (family === 'race') return tSync('game.help_cmd_my_status_race');
			if (family === 'track') return tSync('game.help_cmd_my_status_track');
			return tSync('game.help_cmd_my_status_property');
		case 'AnnounceGroup': return tSync('game.help_cmd_group');
		case 'AnnouncePrice': return tSync('game.help_cmd_price');
		case 'AnnounceCurrentPlayerReleasePasses': return tSync('game.help_cmd_release_passes');
		case 'PayReleaseCost': return tSync('game.help_cmd_pay_release_cost');
		case 'UseReleasePass': return tSync('game.help_cmd_use_release_pass');
		case 'BuyProperty': return tSync('game.help_cmd_buy_property');
		case 'ManageProperties': return tSync('game.help_cmd_manage_properties');
		case 'OpenTradeBuilder': return tSync('game.help_cmd_open_trade');
		case 'ReenterAuction': return tSync('game.help_cmd_reenter_auction');
		case 'GoToMe':
			// Single-piece families (property, track): M simply jumps to YOUR token, so the
			// multi-piece "next/previous piece" phrasing must not appear — it read as if M
			// cycled your properties (live-play confusion; that cycle lives on H/Shift+H).
			// Only the race family fields several pieces per player.
			if (family !== 'race') return tSync('game.help_cmd_go_to_me_single');
			return args?.forward === false
				? tSync('game.help_cmd_go_to_me_prev')
				: tSync('game.help_cmd_go_to_me');
		case 'GoToStart': return tSync('game.help_cmd_go_start');
		case 'GoToMyStart':
			return args?.forward === false
				? tSync('game.help_cmd_go_my_start_prev')
				: tSync('game.help_cmd_go_my_start');
		case 'GoToBarrier':
			return args?.forward === false
				? tSync('game.help_cmd_barrier_prev')
				: tSync('game.help_cmd_barrier');
		case 'RollDice': return tSync('game.help_cmd_roll');
		case 'EndTurn': return tSync('game.help_cmd_end_turn');
		case 'NextOccupied':
			return args?.forward === false
				? tSync('game.help_cmd_prev_occupied')
				: tSync('game.help_cmd_next_occupied');
		case 'OwnedNext':
			return args?.forward === false
				? tSync('game.help_cmd_prev_owned')
				: tSync('game.help_cmd_next_owned');
		case 'UnownedNext':
			return args?.forward === false
				? tSync('game.help_cmd_prev_unowned')
				: tSync('game.help_cmd_next_unowned');
		case 'FocusPlayers': return tSync('game.help_cmd_players');
		case 'FocusActions': return tSync('game.help_cmd_focus_actions');
		case 'FocusDialog': return tSync('game.help_cmd_focus_dialog');
		case 'NextPanel': return tSync('game.help_cmd_next_panel');
		case 'PrevPanel': return tSync('game.help_cmd_prev_panel');
		case 'MoveLeft': return tSync('game.help_cmd_move_left');
		case 'MoveRight': return tSync('game.help_cmd_move_right');
		case 'MoveUp': return tSync('game.help_cmd_move_up');
		case 'MoveDown': return tSync('game.help_cmd_move_down');
		case 'GroupNext': {
			// Label by the group's name (package-defined); fall back to the classic colour name key.
			const groupName = args?.nameKey ? tSync(String(args.nameKey)) : tSync('game.color_' + args?.group);
			return args?.forward === false
				? tSync('game.help_cmd_group_prev', { group: groupName })
				: tSync('game.help_cmd_group_next', { group: groupName });
		}
		case 'AnnounceFreeParkingPot': return tSync('game.help_cmd_free_parking');
		case 'AnnounceAuction': return tSync('game.help_cmd_auction');
		case 'AnnounceCurrentBid': return tSync('game.help_cmd_current_bid');
		case 'ToggleChat': return tSync('game.help_cmd_toggle_chat');
		case 'FocusChatInput': return tSync('game.help_cmd_focus_chat');
		case 'ToggleVoicePanel': return tSync('game.help_cmd_toggle_voice');
		case 'ToggleVoiceMute': return tSync('game.help_cmd_voice_mute');
		case 'AnnounceVoiceSpeakers': return tSync('game.help_cmd_voice_speakers');
		case 'ShowHelp': return tSync('game.help_cmd_help');
		case 'ShowBoardHelp': return tSync('game.help_cmd_board_help');
		case 'ShowGameRules': return tSync('game.help_cmd_game_rules');
		case 'ToggleSound': return tSync('game.help_cmd_toggle_sound');
		case 'LeaveGame': return tSync('game.help_cmd_leave_game');
		case 'HistoryPrev': return tSync('game.help_cmd_history_prev');
		case 'HistoryNext': return tSync('game.help_cmd_history_next');
		case 'HistoryFirst': return tSync('game.help_cmd_history_first');
		case 'HistoryLast': return tSync('game.help_cmd_history_last');
		default: return cmd;
	}
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, c =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** One shortcut row: an already-humanized key label and its localized description. */
function shortcutRow(keyLabel: string, desc: string): string {
	return `<tr><th scope="row" class="help-shortcuts__key"><kbd>${escapeHtml(keyLabel)}</kbd></th><td>${escapeHtml(desc)}</td></tr>`;
}

export function showHelpDialog(keyMap: Record<string, any>, opts?: {
	hiddenCommands?: Set<string>;
	activeFamily?: string;
	/** Family-owned shortcuts (card hand/status keys) not present in keymap.json. Rendered
	 *  first, so the game's own actions lead the table. */
	extraShortcuts?: readonly HelpShortcut[];
	/** Whether to append the "0–9 jump to a square" row: only spatial boards have squares
	 *  to jump to, so the card families drop it. Defaults to true. */
	showNumberNav?: boolean;
}): void {
	const activeFamily = opts?.activeFamily ?? 'property';
	// The family's own keys (hand/status) lead the table — they are the primary actions.
	const extraRows = (opts?.extraShortcuts ?? [])
		.map(s => shortcutRow(humanizeKey(s.keys), tSync(s.descKey)))
		.join('');
	// Two bindings of the same command can collapse into one description in a family (e.g.
	// M and Shift+M both mean "go to your token" with a single piece): keep the first row,
	// drop the echo, so the table never lists the same action twice.
	const seen = new Set<string>();
	const rows = Object.entries(keyMap).map(([spec, mapping]) => {
		const cmd = typeof mapping === 'string' ? mapping : mapping?.cmd;
		const args = typeof mapping === 'string' ? undefined : mapping?.args;
		if (!cmd) return '';
		if (opts?.hiddenCommands?.has(cmd)) return ''; // not part of this game family
		// A binding tagged with another family is inert in this game (its letter belongs
		// to other uses there, e.g. package group keys), so it doesn't belong in its help.
		if (typeof mapping !== 'string' && mapping?.family
			&& mapping.family !== activeFamily) return '';
		const keyLabel = humanizeKey(spec);
		const desc = describeCommand(cmd, args, activeFamily);
		const dedupeKey = `${cmd}::${desc}`;
		if (seen.has(dedupeKey)) return '';
		seen.add(dedupeKey);
		return shortcutRow(keyLabel, desc);
	}).filter(Boolean).join('');

	// Only spatial boards have squares to jump to by number; the card families drop the row.
	const numberNavRow = (opts?.showNumberNav ?? true)
		? `<tr><th scope="row" class="help-shortcuts__key"><kbd>0 – 9</kbd></th><td>${escapeHtml(tSync('game.help_cmd_number_nav'))}</td></tr>`
		: '';

	const content = `
		<table class="help-shortcuts">
			<thead>
				<tr>
					<th scope="col">${tSync('game.help_col_key')}</th>
					<th scope="col">${tSync('game.help_col_action')}</th>
				</tr>
			</thead>
			<tbody>${extraRows}${rows}${numberNavRow}</tbody>
		</table>`;

	dialogManager.show({
		title: tSync('game.help_title'),
		content,
		className: 'dialog-help',
		// Reading dialog: the table must be browseable with the screen reader's virtual
		// cursor from the moment it opens (no role="application" anywhere inside).
		documentMode: true,
		buttons: [
			{
				label: tSync('game.help_close'),
				variant: 'primary',
				action: () => dialogManager.close()
			}
		]
	});
}

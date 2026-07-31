import type { GroupInfo } from './models.js';

/** A keymap entry: a bare command name, or a command with arguments. */
export type KeyMapEntry = string | { cmd: string; args?: Record<string, unknown> };

/**
 * Builds the board's group-navigation shortcuts from a package's groups. Each group that declares a
 * single-letter key gets `<key>` → jump forward through that group's squares and `shift+<key>` →
 * backward (via the GroupNext command, matched on the group's colour value). Colours are
 * package-specific, so these replace the old hardcoded colour-letter keys. A group without a
 * key/colour contributes nothing. Keys are lowercased to match the keymap's normalized specs.
 */
export function buildGroupKeyMap(groups: GroupInfo[] | undefined): Record<string, KeyMapEntry> {
	const map: Record<string, KeyMapEntry> = {};
	for (const g of groups ?? []) {
		const key = (g.key ?? '').toLowerCase();
		const group = g.color ?? '';
		if (key.length !== 1 || !group) continue;
		// nameKey lets the help dialog label the shortcut by the group's name (the colour value
		// alone — a hex or an opaque id — is meaningless to the player).
		const nameKey = g.colorName ?? undefined;
		map[key] = { cmd: 'GroupNext', args: { group, nameKey } };
		map['shift+' + key] = { cmd: 'GroupNext', args: { group, nameKey, forward: false } };
	}
	return map;
}

/**
 * Indexes a board's squares by their group's colour, for the group-navigation commands ("jump to
 * the next brown square"). The colour is normalized to bare letters so a board that writes its
 * groups as "Brown", "brown" or "dark-brown" still lands them in one bucket, and squares that
 * belong to no group (corners, taxes, card squares) are simply absent.
 *
 * Order matters: the indices come out ascending, which is what makes "next" and "previous" walk
 * the board the way the player sees it.
 */
export function buildGroupSquareIndex(squares: readonly { color?: string }[]): Map<string, number[]> {
	const index = new Map<string, number[]>();
	squares.forEach((square, position) => {
		if (!square.color) return;
		const group = String(square.color).toLowerCase().replace(/[^a-z]/g, '');
		// A colour of only digits or punctuation ("#123456") normalizes to nothing: it names no
		// group the player could ask for, so it gets no bucket.
		if (!group) return;
		const bucket = index.get(group);
		if (bucket) bucket.push(position);
		else index.set(group, [position]);
	});
	return index;
}

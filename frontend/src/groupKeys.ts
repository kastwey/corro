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

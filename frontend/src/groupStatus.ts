// groupStatus.ts — pure builder for the buy-prompt "group ownership" hint.
//
// When deciding whether to buy, a player wants to know how much of the square's GROUP they (and
// rivals) already hold. The phrasing is board-agnostic and grammatical: each board names its group
// MEMBER noun + grammatical gender (groupMember/Plural/Gender, per group, in the package i18n), and
// the unified group_member_* templates agree gender via i18next context. No privileged square type.
//
// Kept pure (no DOM, no gameManager, no i18next singleton) so it is unit-tested — app.ts feeds it the
// live state and the two translators it needs.
import type { Square } from './models.js';

export interface GroupStatusContext {
	squares: Square[];
	players: { id: string; name: string }[];
	myId: string | null;
	/** App translator (game.*-prefixed): renders the group_member_* templates + generic fallbacks. */
	t: (key: string, vars?: Record<string, any>) => string;
	/** Raw i18next lookup for the package's TOP-LEVEL keys (groupMember.*, the group name key). */
	pkg: (key: string) => string;
}

/**
 * The ownership hint for the square being considered, or '' when there is nothing to say (not an
 * ownable group square, or a group of one). Examples: "You do not own any utility in the Utilities
 * group (2 total)." / "You own 1 of 2 utilities in the Utilities group."
 */
export function groupStatusMessage(targetSquare: Square | undefined, ctx: GroupStatusContext): string {
	if (!targetSquare) return '';
	// Only ownable squares (those with a purchase price) that belong to a group produce a hint.
	const groupId = targetSquare.key;
	if (!groupId || targetSquare.price == null) return '';

	const related = ctx.squares.filter(s => s.key === groupId && s.price != null && s.id !== targetSquare.id);
	if (related.length === 0) return '';

	const myOwned: string[] = [];
	const otherOwners = new Map<string, string[]>(); // ownerName -> property names
	for (const sq of related) {
		if (!sq.ownerId) continue;
		if (sq.ownerId === ctx.myId) {
			myOwned.push(sq.name);
		} else {
			const owner = ctx.players.find(p => p.id === sq.ownerId);
			const ownerName = owner?.name || ctx.t('unknown_player');
			const list = otherOwners.get(ownerName) || [];
			list.push(sq.name);
			otherOwners.set(ownerName, list);
		}
	}

	const total = related.length + 1; // +1 for the current square

	// The group's member noun (+ gender). Package keys live at the TOP level (resolve with pkg);
	// app fallbacks (property_generic) go through the game-prefixed t. Falls back to a generic noun.
	const word = (k: string) => { const v = ctx.pkg(k); return v && v !== k ? v : ''; };
	const member       = word(`groupMember.${groupId}`)       || word('groupMember.default')       || ctx.t('property_generic');
	const memberPlural = word(`groupMemberPlural.${groupId}`) || word('groupMemberPlural.default') || ctx.t('property_generic_plural');
	const gender       = word(`groupMemberGender.${groupId}`) || word('groupMemberGender.default') || ctx.t('property_generic_gender');
	const group        = targetSquare.groupNameKey ? ctx.pkg(targetSquare.groupNameKey) : '';

	const parts: string[] = [];
	parts.push(myOwned.length === 0
		? ctx.t('group_member_none', { context: gender, member, group, total })
		: ctx.t('group_member_some', { count: myOwned.length, total, memberPlural, group }));

	if (otherOwners.size > 0) {
		const msgs: string[] = [];
		for (const [ownerName, props] of otherOwners)
			msgs.push(ctx.t('group_member_other', { player: ownerName, count: props.length, memberPlural }));
		parts.push(msgs.join('. '));
	}
	return parts.join(' ');
}

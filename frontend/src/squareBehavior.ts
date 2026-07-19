// squareBehavior.ts — the ONE answer to "can this square be owned?".
//
// Package boards mark it explicitly (behavior: 'ownable' — decided by DATA, a purchase
// price, with no privileged types: a board may call its ownable groups anything, transits
// and utilities included). The legacy property/railroad/utility type triple remains only
// for squares that predate `behavior` — filtering by it on a package board silently drops
// every ownable whose type isn't one of those three words (the stations-missing-from-trades
// bug).

import type { Square } from './models.js';

export function isOwnableSquare(square: Pick<Square, 'type' | 'behavior'>): boolean {
	if (square.behavior) return square.behavior === 'ownable';
	return square.type === 'property' || square.type === 'railroad' || square.type === 'utility';
}

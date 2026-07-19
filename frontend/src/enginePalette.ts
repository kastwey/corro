// enginePalette.ts — client mirror of the server's EnginePalette colour IDS: a seat/team
// index maps to the colour WORD spoken as its identity («Equipo Rojo») and matches the hex
// the server dressed the players in. A new entry here needs its game.color_* word too.

export const ENGINE_PALETTE_NAMES =
	['red', 'blue', 'yellow', 'green', 'purple', 'orange', 'cyan', 'brown'] as const;

/** The colour-word id for a seat/team index ("red" → game.color_red). */
export function teamColorId(index: number): string {
	return ENGINE_PALETTE_NAMES[index % ENGINE_PALETTE_NAMES.length];
}

/** The localized team name for a seat/team index («Equipo Rojo» / "Red team"). */
export function teamDisplayName(
	index: number,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string {
	return tSync('game.journey_team', { color: tSync(`game.color_${teamColorId(index)}`) });
}

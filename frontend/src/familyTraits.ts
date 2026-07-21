// Pure per-family traits: plain data, no DOM, no i18n — safe to import from pure modules
// (availableActions derives the toolbar shape from them). The DOM half of a family (board +
// animator factory, identity phrasing) lives in gameFamilies.ts, which builds on these.
// PROPERTY carries the historical defaults explicitly (economy toolbar, "go to player" shown,
// trades on); an UNKNOWN family still falls back to those same defaults via the helpers below.

export type GameHomeSurface = 'board' | 'hand';

export interface FamilyTraits {
  readonly gameType: string;
  /** The keyboard player's home surface. Spatial families keep focus on the shared board;
   *  card families forward it into the player's hand. Kept separate from `noToolbar`: one
   *  describes navigation, the other describes where turn actions are rendered. */
  readonly homeSurface: GameHomeSurface;
  /** Roll → resolve turn with no economy: the toolbar offers only the roll. */
  readonly rollOnly: boolean;
  /** The family has NO turn actions on the toolbar at all (journey: the hand owns the
   *  whole turn — draw/play/discard live there, so the action bar stays empty). */
  readonly noToolbar?: boolean;
  /** Whether the players panel offers "go to player" (a race player has several pieces —
   *  no single square to jump to, so the row hides the action there). */
  readonly showGoToPlayer: boolean;
  /** Whether players can trade (the panel's "Propose trade" action). Only the property
   *  family has an economy to trade with; everyone else hides it. */
  readonly hasTrades?: boolean;
  /** SIMULTANEOUS play — no turn order at all (draft: everyone picks at once). The "whose
   *  turn?" key (T) answers "there are no turns here" instead of a nonexistent turn. */
  readonly simultaneous?: boolean;
  /** Whether this family can seat BOTS — mirrors the server's bot-policy registry
   *  (Services/Bots/BotPolicies). The lobby hides the "add bot" chair when false. Race and trivia
   *  ship no bot policy; the rest (property + the six card/track families) do. */
  readonly supportsBots?: boolean;
}

export const FAMILY_TRAITS: readonly FamilyTraits[] = [
  { gameType: 'property', homeSurface: 'board', rollOnly: false, showGoToPlayer: true, hasTrades: true, supportsBots: true },
  { gameType: 'race', homeSurface: 'board', rollOnly: true, showGoToPlayer: false, hasTrades: false },
  { gameType: 'track', homeSurface: 'board', rollOnly: true, showGoToPlayer: true, hasTrades: false, supportsBots: true },
  { gameType: 'trivia', homeSurface: 'board', rollOnly: true, showGoToPlayer: true, hasTrades: false },
  { gameType: 'journey', homeSurface: 'hand', rollOnly: false, noToolbar: true, showGoToPlayer: false, hasTrades: false, supportsBots: true },
  { gameType: 'assembly', homeSurface: 'hand', rollOnly: false, noToolbar: true, showGoToPlayer: false, hasTrades: false, supportsBots: true },
  { gameType: 'draft', homeSurface: 'hand', rollOnly: false, noToolbar: true, showGoToPlayer: false, hasTrades: false, simultaneous: true, supportsBots: true },
  { gameType: 'shedding', homeSurface: 'hand', rollOnly: false, noToolbar: true, showGoToPlayer: false, hasTrades: false, supportsBots: true },
  { gameType: 'exploding', homeSurface: 'hand', rollOnly: false, noToolbar: true, showGoToPlayer: false, hasTrades: false, supportsBots: true },
];

/** The traits of a registered family — null for property/unknown (default behaviour). */
export function familyTraitsFor(gameType: string | null | undefined): FamilyTraits | null {
  return FAMILY_TRAITS.find(f => f.gameType === gameType) ?? null;
}

/** Where focus enters this family. Unknown families follow the property fallback: board. */
export function familyHomeSurface(gameType: string | null | undefined): GameHomeSurface {
  return familyTraitsFor(gameType)?.homeSurface ?? 'board';
}

/** Roll-only families have no economy: the action toolbar offers only the roll. */
export function isRollOnlyFamily(gameType: string | null | undefined): boolean {
  return familyTraitsFor(gameType)?.rollOnly ?? false;
}

/** Toolbar-less families play their whole turn elsewhere (journey: the hand panel). */
export function isToolbarlessFamily(gameType: string | null | undefined): boolean {
  return familyTraitsFor(gameType)?.noToolbar ?? false;
}

/** Simultaneous families have no turn order (draft): "whose turn?" has no answer. */
export function isSimultaneousFamily(gameType: string | null | undefined): boolean {
  return familyTraitsFor(gameType)?.simultaneous ?? false;
}

/** Whether this family trades (property's economy; the default for unknown = property). */
export function familyHasTrades(gameType: string | null | undefined): boolean {
  return familyTraitsFor(gameType)?.hasTrades ?? true;
}

/** Whether this family can seat bots (default false — the no-bot families like trivia and race,
 *  which the server's AddBot guard rejects anyway). */
export function familyHasBots(gameType: string | null | undefined): boolean {
  return familyTraitsFor(gameType)?.supportsBots ?? false;
}

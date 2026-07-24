// models.ts - Centralized types for the entire frontend

// A token id: a built-in token ("disc"…) or a package-defined token id.
export type TokenKey = string;

/** A player token (built-in or package-provided): id + optional SVG path data + i18n name key. */
export interface TokenInfo { id: string; svg?: string; nameKey?: string; }

// === PLAYERS ===
export interface Player {
  id: string;
  name: string;
  token: TokenKey;
  position: number;
  money: number;
  properties: number[];
  releasePasses: number;
  isMe?: boolean;
  color?: string;
  isHeld?: boolean;
  holdingTurnsRemaining?: number;
  /** True once the player has gone bankrupt and is out of the game (skipped, can't act). */
  isBankrupt?: boolean;
  /** Finishing position once out: 2 = runner-up (last eliminated) … N = first eliminated. 0 while in. */
  finishPlace?: number;
  /** False while the player has no live connection to the game (server-flipped on disconnect/rejoin). */
  isConnected?: boolean;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  token: TokenKey;
  /** The race seat (squadron/colour) this player picked; absent on property boards. */
  seatId?: string | null;
  isHost: boolean;
  isReady: boolean;
  /** A machine-driven seat the host added while waiting (server Services/Bots). */
  isBot?: boolean;
  /** Journey team mode: the team (0-based) the host placed this player in; null = pool. */
  teamIndex?: number | null;
  joinedAt: string;
}

/** A race seat as the lobby offers it: identity, swatch colour and localizable name. */
export interface LobbySeatInfo {
  id: string;
  color?: string | null;
  nameKey?: string | null;
}

// === SQUARES ===
export interface Square {
  id: number;
  name: string;
  /** Optional per-locale names (locale code -> text). The client prefers names[lang], falling
   *  back to `name`, so a board can be translated per player and partial translations are fine. */
  names?: Record<string, string>;
  type?: string;
  x: number;
  y: number;
  /** Purchase price of an ownable square; absent for squares that aren't for sale. */
  price?: number;
  /** The sum a non-ownable square charges on landing (tax squares); kept distinct from price. */
  amount?: number;
  rent?: number[];
  color?: string;
  /** i18n key for the square's group name (e.g. "game.color_brown", "groups.g1"); resolved against
   *  the merged app + package translations. Preferred over the raw colour for a11y. */
  groupNameKey?: string;
  /** Generic landing behaviour ("ownable", "drawCard", "start", "justVisiting", "freeParking", "sendToHolding"). */
  behavior?: string;
  /** Deck id a card square draws from (used to label it with the deck's name). */
  deck?: string;
  buildingCost?: number;
  ownerId?: string;
  key?: string;
  smallBuildings?: number;
  bigBuildings?: number;
  mortgaged?: boolean;
}

// === GAME STATE ===
export interface PendingPurchase {
  playerId: string;
  squareIndex: number;
  squareName: string;
  price: number;
  wasDoublesRoll?: boolean;
}

/** One side of a trade as stored in the authoritative state: square indices + cash + cards. */
export interface TradeOfferDto {
  properties: number[];
  money: number;
  releasePasses: number;
}

/** The pending player-to-player trade carried in the game state (mirrors the server). */
export interface TradeStateDto {
  id: string;
  initiatorId: string;
  initiatorName: string;
  targetId: string;
  targetName: string;
  /** What the initiator gives away (i.e. what the target receives). */
  initiator: TradeOfferDto;
  /** What the target gives away (i.e. what the initiator requests). */
  target: TradeOfferDto;
  isActive: boolean;
}

/** A package card deck (id + i18n key for its name) for labelling the center piles. */
export interface DeckInfo {
  id: string;
  nameKey?: string;
  icon?: string | null;
}

/** A board colour group: its colour value, i18n name key, and optional single-letter board shortcut. */
export interface GroupInfo {
  id: string;
  color?: string | null;
  colorName?: string | null;
  key?: string | null;
}

// ── Track family (snakes-and-ladders style) ─────────────────────────────────

/** A square effect: landing on `from` teleports to `to`; `kind` is theme data ("ladder"…). */
export interface TrackEffectDef { from: number; to: number; kind: string; }

export interface TrackBoardDef {
  trackLength: number;
  gridWidth: number;
  effects: TrackEffectDef[];
}

export interface TrackPlayerPosition { playerId: string; square: number; }

export interface TrackState { positions: TrackPlayerPosition[]; }

/** The track rules in effect (public config for the active-rules dialog). */
export interface TrackRulesConfig {
  /** "bounce" (walk to the end and back the excess) | "stay" (an overshoot is lost). */
  exactFinish: string;
  rollAgainOnMax: boolean;
}

// ── Trivia family (Trivial Pursuit style) ───────────────────────────────────

/** One ring slot of the wheel: its category, and whether it's a wedge / roll-again square. */
export interface TriviaRingSlot { category: number; wedge?: boolean; rollAgain?: boolean; }

/** The wheel board: interior squares per spoke + the ordered ring (with six wedge slots). */
export interface TriviaBoardDef { spokeLength: number; ring: TriviaRingSlot[]; }

/** One player's standing: node id on the wheel ("C"/"S{i}.{j}"/"R{k}") + earned wedges. */
export interface TriviaPlayerState { playerId: string; node: string; wedges: number[]; retired?: boolean; }

export interface TriviaPendingJudgeSetup { hostId: string; }

export interface TriviaPendingMove { playerId: string; rolled: number; options: string[]; }

/** A question in flight. The correct answer/choice is stripped for everyone but the judge. */
export interface TriviaPendingQuestion {
  playerId: string;
  judgeId: string;
  questionId: string;
  category: number;
  prompt: string;
  choices: string[];
  submitted?: string | null;
  onWedge?: boolean;
  atCenter?: boolean;
  isFinal?: boolean;
  correctAnswer?: string | null;
  correctChoice?: number;
}

export interface TriviaState {
  players: TriviaPlayerState[];
  fixedJudgeId?: string | null;
  pendingJudgeSetup?: TriviaPendingJudgeSetup | null;
  pendingMove?: TriviaPendingMove | null;
  pendingQuestion?: TriviaPendingQuestion | null;
  categoryCursors: number[];
}

/** The trivia rules in effect (public config for the active-rules dialog). */
export interface TriviaRulesConfig {
  answerMode: string;   // "judge" | "choice" | "typed"
  judgeMode: string;    // "rotating" | "fixed"
  exactFinish: boolean;
  centerWild: boolean;
  answerSeconds: number;
}

// ── Journey family (Mil Millas genre) ───────────────────────────────────────

/** One card DEFINITION of the deck catalog (public wire data — only hand/pile CONTENTS are secret). */
export interface JourneyCardDef {
  id: string;
  /** Sanitized path-data from optional package file assets/cards/<id>.svg. */
  svg?: string | null;
  /** Optional package-owned #RRGGBB accent. */
  artColor?: string | null;
  /** "distance" | "attack" | "remedy" | "immunity". */
  type: string;
  value: number;
  kind?: string | null;
  /** Attacks: "stopper" blocks all distance; "limiter" caps the playable value. */
  hazardClass?: string | null;
  /** Immunities: every hazard kind this shields (falls back to `kind`). */
  shieldsKinds?: string[];
  count: number;
  maxPlaysPerHand?: number | null;
  premium?: boolean;
  nameKey: string;
  /** Optional themed play-announcement key (see the server's JourneyCardDef.PlayedKey). */
  playedKey?: string | null;
}

/** One physical card instance (my own hand only — rival hands arrive as counts). */
export interface JourneyCardInstance { instanceId: string; cardId: string; }

/** One member of a seat: a player and their private hand (individual play: the seat's only
 *  member; team play: each partner — hands are secret even between partners). */
export interface JourneyMemberState {
  playerId: string;
  /** MY hand; empty for every other member (the projection strips it — partner included). */
  hand: JourneyCardInstance[];
  /** What everyone sees of a hand: its size. */
  handCount: number;
}

export interface JourneySeatState {
  /** The seat's stable wire id: its FIRST member (individual play: the player). */
  playerId: string;
  /** Everyone playing this seat, in their interleaved turn order. */
  members: JourneyMemberState[];
  km: number;
  /** Active hazard KINDS (their class comes from the catalog). */
  hazards: string[];
  /** Immunity CARD ids played this hand. */
  immunities: string[];
  /** Per-card plays this hand (maxPlaysPerHand limits). */
  playsByCard?: Record<string, number>;
  premiumPlays: number;
  coupFourres: number;
  /** Match score across hands. */
  score: number;
  /** Every member left the game: the car parks as history, no longer a target. */
  retired?: boolean;
}

/** The paused coup fourré decision (the immunity card id is the victim's secret). */
export interface PendingJourneyCoup {
  victimId: string;
  attackerId: string;
  hazardKind: string;
  immunityInstanceId: string;
}

export interface JourneyHandScore {
  playerId: string;
  km: number;
  immunityPoints: number;
  allImmunitiesBonus: number;
  coupFourrePoints: number;
  tripCompleteBonus: number;
  safeTripBonus: number;
  deckExhaustedBonus: number;
  capotBonus: number;
  total: number;
  matchScore: number;
}

/** The journey rules in effect (public config: playability + progress-strip scale). */
export interface JourneyRulesConfig {
  goalKm: number;
  targetScore: number;
  handSize: number;
  stackHazards: boolean;
  limitCap: number;
  initialHazard: string;
  /** Scoring table (the server always ships it; optional so test fixtures may omit it —
   *  the readers then fall back to the official defaults). Drives the LIVE score shown in
   *  the status line: km, immunities and coups banked mid-hand. */
  pointsPerKm?: number;
  immunityPoints?: number;
  allImmunitiesBonus?: number;
  coupFourreBonus?: number;
}

export interface JourneyState {
  seats: JourneySeatState[];
  /** Always empty on the wire (projected away); the count is what travels. */
  drawPile: JourneyCardInstance[];
  drawCount: number;
  /** Face-up discards, top last (public). */
  discardPile: JourneyCardInstance[];
  hasDrawn: boolean;
  round: number;
  pendingCoup?: PendingJourneyCoup | null;
  lastHandScores: JourneyHandScore[];
}

// ── Assembly family ──────────────────────────────────────────────────────────

/** One card DEFINITION of the assembly deck catalog (public wire data). */
export interface AssemblyCardDef {
  id: string;
  /** Sanitized path-data from optional package file assets/cards/<id>.svg. */
  svg?: string | null;
  /** Optional package-owned #RRGGBB accent. */
  artColor?: string | null;
  /** "piece" | "attack" | "remedy" | "special". */
  type: string;
  /** Colour id; "wild" matches any. Null for specials. */
  color?: string | null;
  /** Specials: "swapPiece" | "stealPiece" | "plague" | "scrapHands" | "fullSwap". */
  specialKind?: string | null;
  count: number;
  nameKey: string;
  playedKey?: string | null;
}

/** One physical card instance (my own hand only — rival hands arrive as counts). */
export interface AssemblyCardInstance { instanceId: string; cardId: string; }

/** One rack slot: a placed piece plus what is stuck to it. Two afflictions never coexist
 *  (the second destroys the slot); two shields = locked forever. */
export interface AssemblySlot {
  /** The slot's effective colour (its piece's; "wild" for the joker). */
  color: string;
  piece: AssemblyCardInstance;
  afflictions: AssemblyCardInstance[];
  shields: AssemblyCardInstance[];
}

export interface AssemblySeatState {
  playerId: string;
  /** MY hand; empty for every rival (the projection strips it). */
  hand: AssemblyCardInstance[];
  /** What everyone sees of a hand: its size. */
  handCount: number;
  /** The rack under assembly (public). */
  slots: AssemblySlot[];
  /** The player left the game: no cards, no rack, no longer a target. */
  retired?: boolean;
}

/** The assembly rules in effect (public config: playability + the rack goal). */
export interface AssemblyRulesConfig {
  handSize: number;
  slotsToWin: number;
  maxDiscard: number;
}

export interface AssemblyState {
  seats: AssemblySeatState[];
  /** Always empty on the wire (projected away); the count is what travels. */
  drawPile: AssemblyCardInstance[];
  drawCount: number;
  /** Face-DOWN discards in this genre: projected away too; the count is what travels. */
  discardPile: AssemblyCardInstance[];
  discardCount: number;
}

// ── Draft family (simultaneous pick-and-pass) ────────────────────────────────

/** One card DEFINITION of the draft deck catalog (public wire data). */
export interface DraftCardDef {
  id: string;
  /** Sanitized path-data from optional package file assets/cards/<id>.svg. */
  svg?: string | null;
  /** Optional package-owned #RRGGBB accent. */
  artColor?: string | null;
  /** "points" | "multiplier" | "set" | "scale" | "majority" | "dessert". */
  type: string;
  count: number;
  nameKey: string;
  /** "points": worth at round end. */
  value?: number;
  /** "multiplier": boost for the points card that lands on it. */
  factor?: number;
  /** "set": copies per scoring group / what each group scores. */
  setSize?: number;
  setPoints?: number;
  /** "scale": the cumulative ladder (k copies score the k-th step, capped). */
  scale?: number[];
  /** "majority": icons this card adds to the round's majority race. */
  icons?: number;
}

/** One physical card instance (my own hand only — rival hands arrive as counts). */
export interface DraftCardInstance { instanceId: string; cardId: string; }

/** One PUBLIC table card; a points card may carry the multiplier it landed on. */
export interface DraftTableSlot {
  card: DraftCardInstance;
  onMultiplier?: DraftCardInstance | null;
}

export interface DraftSeatState {
  playerId: string;
  /** MY hand; empty for every rival (the projection strips it). */
  hand: DraftCardInstance[];
  /** What everyone sees of a hand: its size. */
  handCount: number;
  /** MY pending pick; stripped for rivals (hasPicked is all they see). */
  committedInstanceId?: string | null;
  /** Whether this seat committed a pick this trick (public). */
  hasPicked: boolean;
  /** Cards revealed this round (public; cleared by the round scoring). */
  table: DraftTableSlot[];
  /** Desserts accumulated across rounds (public; scored at game end). */
  desserts: DraftCardInstance[];
  score: number;
  roundScores: number[];
  /** The player left the game: the seat holds no cards and sits out every race. */
  retired?: boolean;
}

/** The draft rules in effect (public config: rounds, hand curve, race prizes). */
export interface DraftRulesConfig {
  rounds: number;
  handSizeBase: number;
  majorityFirst: number;
  majoritySecond: number;
  dessertBonus: number;
  dessertPenalty: number;
}

export interface DraftState {
  round: number;
  trick: number;
  seats: DraftSeatState[];
  /** Always empty on the wire (projected away); the count is what travels. */
  drawPile: DraftCardInstance[];
  drawCount: number;
}

// ── Shedding family ──────────────────────────────────────────────────────────

/** One card DEFINITION of the shedding deck catalog (public wire data). */
export interface SheddingCardDef {
  id: string;
  /** Sanitized path-data from optional package file assets/cards/<id>.svg. */
  svg?: string | null;
  /** Optional package-owned #RRGGBB accent. */
  artColor?: string | null;
  /** "number" | "skip" | "reverse" | "drawTwo" | "wild" | "wildDrawFour". */
  type: string;
  /** Colour id ("red", "blue"…), spoken via the package's colors.<id> key. Null for wilds. */
  color?: string | null;
  /** "number" cards: the printed value. */
  value?: number;
  count: number;
  nameKey: string;
  /** Round-scoring override; absent = the classic table (value / 20 / 50). */
  points?: number | null;
}

/** One physical card instance (my own hand only — rival hands arrive as counts). */
export interface SheddingCardInstance { instanceId: string; cardId: string; }

export interface SheddingSeatState {
  playerId: string;
  /** MY hand; empty for every rival (the projection strips it). */
  hand: SheddingCardInstance[];
  /** What everyone sees of a hand: its size. */
  handCount: number;
  /** Match score across rounds. */
  score: number;
  roundScores: number[];
  /** The player left the game: no cards, skipped by the turn walk. */
  retired?: boolean;
}

/** The drawn-card pause: MINE only (stripped for rivals). */
export interface PendingDrawnPlay { playerId: string; instanceId: string; }

/** The shedding rules in effect (public config). */
export interface SheddingRulesConfig {
  handSize: number;
  targetScore: number;
  drawnCardPlayable: boolean;
  wildDrawRequiresNoMatch: boolean;
  /** House rule: play several identical number cards at once. */
  allowDoubles?: boolean;
  /** House rule: how draw cards may be stacked ("none" | "sameType" | "cross"). */
  stacking?: string;
  /** House rule: declare your last card or be caught. */
  lastCardCall?: boolean;
  /** Cards drawn when caught without declaring the last card. */
  lastCardPenalty?: number;
}

/** A draw penalty piling up (the "stacking" house rule): the current player must stack
 *  another draw card or draw the whole {@link amount}. Public. */
export interface SheddingPenalty {
  amount: number;
  /** The last draw card stacked ("drawTwo" | "wildDrawFour") — what may pile on in sameType mode. */
  lastType: string;
}

export interface SheddingState {
  round: number;
  seats: SheddingSeatState[];
  /** Always empty on the wire (projected away); the count is what travels. */
  drawPile: SheddingCardInstance[];
  drawCount: number;
  /** The wire carries the TOP card only (the buried order reshuffles back, so it stays secret). */
  discardPile: SheddingCardInstance[];
  discardCount: number;
  /** The colour in force (the top card's, or a wild player's choice). */
  currentColor: string;
  /** +1 seat order, -1 reversed. */
  direction: number;
  pendingDrawnPlay?: PendingDrawnPlay | null;
  /** A draw penalty on the current player to answer (stacking house rule). Public. */
  pendingPenalty?: SheddingPenalty | null;
  /** The player who dropped to one card without declaring it — catchable until the next
   *  action. Null when nobody is exposed. Public. */
  pendingLastCardCall?: string | null;
}

// ── Exploding family ─────────────────────────────────────────────────────────

/** One card DEFINITION of the exploding deck catalog (public wire data). */
export interface ExplodingCardDef {
  id: string;
  /** Sanitized path-data from optional package file assets/cards/<id>.svg. */
  svg?: string | null;
  /** Optional package-owned #RRGGBB accent. */
  artColor?: string | null;
  /** "bomb" | "defuse" | "skip" | "attack" | "seeFuture" | "shuffle" | "favor" | "nope" | "cat". */
  type: string;
  count: number;
  nameKey: string;
}

/** One physical card instance (my own hand only — rival hands arrive as counts). */
export interface ExplodingCardInstance { instanceId: string; cardId: string; }

export interface ExplodingSeatState {
  playerId: string;
  /** MY hand; empty for every rival (the projection strips it). */
  hand: ExplodingCardInstance[];
  /** What everyone sees of a hand: its size. */
  handCount: number;
  /** The seat is OUT — exploded, or the player left. */
  retired?: boolean;
}

/** A played action awaiting the Nope window's close. actorId/cardId are public; the pile of
 *  Nopes is a count (even = the action stands, odd = it is cancelled). */
export interface ExplodingPendingAction {
  actorId: string;
  cardId: string;
  nopeCount: number;
}

/** The defuse pause: the current player drew a bomb they hold a defuse for, and must tuck it
 *  back into the draw pile at a depth of their choosing. Public that it's happening. */
export interface ExplodingPendingBomb {
  playerId: string;
  instanceId: string;
  cardId: string;
}

/** A resolved Favor: the target must give the requester a card of their choice. Public. */
export interface ExplodingPendingFavor {
  requesterId: string;
  targetId: string;
}

/** The exploding rules in effect (public config for the active-rules dialog). */
export interface ExplodingRulesConfig {
  handSize: number;
  defusesPerPlayer: number;
  seeFutureCount: number;
  attackDraws: number;
  nopeWindowMillis: number;
}

export interface ExplodingState {
  seats: ExplodingSeatState[];
  /** Always empty on the wire (projected away); the count is the whole secret. */
  drawPile: ExplodingCardInstance[];
  drawCount: number;
  /** The face-up discards (public). */
  discardPile: ExplodingCardInstance[];
  discardCount: number;
  /** Draws the current player still owes (an Attack piles these on). */
  drawsOwed: number;
  /** A played card awaiting the Nope window's close. Null when nothing is pending. Public. */
  pendingAction?: ExplodingPendingAction | null;
  /** The current player drew a bomb and must tuck it back. */
  pendingBomb?: ExplodingPendingBomb | null;
  /** A Favor waiting on the target to give the requester a card. Public. */
  pendingFavor?: ExplodingPendingFavor | null;
}

// ── Race family (parcheesi-style) ────────────────────────────────────────────

export type RacePieceLocation = 'home' | 'circuit' | 'corridor' | 'goal';

export interface RacePiece {
  location: RacePieceLocation;
  /** Circuit square (1..circuitLength) or corridor square (1..corridorLength). */
  square: number;
}

export interface RaceSeatState {
  playerId: string;
  seatId: string;
  pieces: RacePiece[];
}

export interface RaceMoveOption {
  pieceIndex: number;
  toLocation: RacePieceLocation;
  toSquare: number;
  exitsHome?: boolean;
  capturesPlayerId?: string | null;
  breaksOwnBarrier?: boolean;
}

export interface PendingRaceMove {
  playerId: string;
  /** Whose SEAT the options move: the actor, or their partner once the actor's own seat
   *  is complete (teams mode). Absent means the actor's own seat. */
  moverId?: string | null;
  steps: number;
  /** "roll" | "captureBonus" | "goalBonus" — drives the prompt wording. */
  kind: string;
  rolled: number;
  options: RaceMoveOption[];
}

export interface RaceState {
  seats: RaceSeatState[];
  /** Classic pairs mode: opposite seats are partners (see the server's RaceState). */
  teamsMode?: boolean;
  consecutiveSixes: number;
  lastMovedPieceIndex?: number | null;
  pendingMove?: PendingRaceMove | null;
  pendingBonuses: number[];
  pendingBonusKinds: string[];
}

export interface RaceSeatDef {
  id: string;
  color?: string;
  nameKey?: string;
  startSquare: number;
  corridorEntry: number;
}

export interface RaceBoardDef {
  circuitLength: number;
  corridorLength: number;
  piecesPerPlayer: number;
  safeSquares: number[];
  seats: RaceSeatDef[];
}

/** The race rules in effect (public config for the active-rules dialog). */
export interface RaceRulesConfig {
  exitOn: number;
  extraRollOn: number;
  threeSixesPenalty: boolean;
  captureBonus: number;
  goalBonus: number;
  sixWorthSevenWhenNoneHome: boolean;
  barriers: boolean;
}

export interface GameState {
  /** Game family ("property" | "race"); absent means property (the original family). */
  gameType?: string;
  /** Public platform state: players may opt in to the voice room while true. */
  voiceChatEnabled?: boolean;
  /** Race sub-state and board definition; only present in race games. */
  race?: RaceState | null;
  raceBoard?: RaceBoardDef | null;
  /** Race rules in effect (public config for the active-rules dialog); race games only. */
  raceRules?: RaceRulesConfig | null;
  /** Track sub-state and board definition; only present in track games. */
  track?: TrackState | null;
  trackBoard?: TrackBoardDef | null;
  /** Track rules in effect (public config for the active-rules dialog); track games only. */
  trackRules?: TrackRulesConfig | null;
  /** Trivia sub-state (my projected view) and wheel board; only present in trivia games. */
  trivia?: TriviaState | null;
  triviaBoard?: TriviaBoardDef | null;
  /** Trivia rules in effect (public config for the active-rules dialog); trivia games only. */
  triviaRules?: TriviaRulesConfig | null;
  /** Journey sub-state (my projected view), deck catalog and rules; journey games only. */
  journey?: JourneyState | null;
  journeyDeck?: JourneyCardDef[] | null;
  journeyRules?: JourneyRulesConfig | null;
  /** Assembly-family sub-state; null in other families. */
  assembly?: AssemblyState | null;
  assemblyDeck?: AssemblyCardDef[] | null;
  assemblyRules?: AssemblyRulesConfig | null;
  /** Draft-family sub-state (my projected view), deck catalog and rules; draft games only. */
  draft?: DraftState | null;
  draftDeck?: DraftCardDef[] | null;
  draftRules?: DraftRulesConfig | null;
  /** Shedding-family sub-state (my projected view), deck catalog and rules; shedding games only. */
  shedding?: SheddingState | null;
  sheddingDeck?: SheddingCardDef[] | null;
  sheddingRules?: SheddingRulesConfig | null;
  /** Exploding-family sub-state (my projected view), deck catalog and rules; exploding games only. */
  exploding?: ExplodingState | null;
  explodingDeck?: ExplodingCardDef[] | null;
  explodingRules?: ExplodingRulesConfig | null;
  /** The property rules in effect (economy, holding, buildings) for the active-rules dialog;
   *  property games only. */
  settings?: GameSettings | null;
  players: Player[];
  bank: { money: number; freeParkingPot?: number; freeParkingJackpot?: boolean };
  currentTurn: string | null;
  ownership: Array<{ index: number; ownerId: string }>;
  squares: Square[];
  /** The package's card decks; absent/empty for classic games (center falls back to chance/community). */
  decks?: DeckInfo[];
  /** The board's localized name (package games); absent for built-in boards. Drives the page title. */
  boardName?: Record<string, string>;
  /** The package's central brand text shown in the board centre (e.g. "CORRO"); absent for built-in. */
  centerBrand?: string;
  /** The package's player tokens (id + SVG path + name key); absent for built-in (uses the 8 defaults). */
  tokens?: TokenInfo[];
  /** The package's colour groups (colour + name key + board shortcut key); absent for built-in. */
  groups?: GroupInfo[];
  /** The board's currency: symbol + code (not translatable) + an i18n key for the spoken name. */
  currency?: { symbol: string; code: string; nameKey?: string } | null;
  /** The board's corner names as i18n keys ("holding" -> "terminology.holding", …); absent for built-in. */
  terminology?: Record<string, string>;
  /** True when the board wants the token to WALK to holding (animated) instead of teleporting there.
   *  Absent/false = teleport (classic "go directly to holding": the token is placed in holding, no slide). */
  walkToHolding?: boolean;
  /** The board's building tiers: how many small constructions make a big one + i18n keys for the names. */
  building?: {
	levels: number;
	smallKey?: string;
	smallPluralKey?: string;
	bigKey?: string;
  };
  activeAuction?: AuctionState | null;
  /** The pending trade freezing the game, or null. Drives modal restoration on reconnect. */
  activeTrade?: TradeStateDto | null;
  pendingDebts?: DebtState[];
  /** True once the current player has rolled this turn (the turn never auto-advances). */
  hasRolledThisTurn?: boolean;
  /** True when the current player rolled doubles and owes another roll before ending the turn. */
  mustRollAgain?: boolean;
  /** The unowned property the current player landed on and may buy, or null. */
  pendingPurchase?: PendingPurchase | null;
  /** Token of the uploaded .corro package backing this game (also the sound pack id); absent for built-in boards. */
  packageToken?: string | null;
  /** True once a single solvent player remains: drives the end screen and server deletion. */
  isGameOver?: boolean;
  /** The winning player's id / name, populated alongside isGameOver. */
  winnerId?: string | null;
  winnerName?: string | null;
}

export interface GameInfo {
  gameId: string;
  hostId: string;
  inviteCode: string;
  status: 'WaitingForPlayers' | 'Active' | 'Completed' | 'Starting' | 'Abandoned';
  maxPlayers: number;
  players: LobbyPlayer[];
  board?: string;
  /** Host-selected language for package content resolved once per game. */
  language?: string;
  /** Token of the .corro package backing this game; set for a package board. */
  packageToken?: string;
  /** The board's player tokens (id + SVG + name key); absent => the joiner uses the 8 built-ins. */
  tokens?: TokenInfo[];
  /** A race board's seats (squadron colours) so the joiner can pick one; absent otherwise. */
  seats?: LobbySeatInfo[] | null;
  /** Journey team mode: how many equal teams (>= 2); absent/null = individual play. */
  teamCount?: number | null;
  /** Whether the host currently offers the optional voice room. */
  voiceChatEnabled?: boolean;
}

/** One in-game chat message (mirrors the server's ChatMessage). */
export interface ChatMessageDto {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  sentAt: string;
}

// === REQUESTS/RESPONSES ===
export interface GameSettings {
  auctionBidTimeoutSeconds?: number;
  startingMoney?: number;
  goBonus?: number;
  doubleGoSalary?: boolean;
  freeParkingJackpot?: boolean;
  auctionOnDecline?: boolean;
  buildingShortage?: boolean;
  evenBuildRule?: boolean;
  noBuildingFirstLap?: boolean;
  mortgageInterestRate?: number;
  holdingReleaseCost?: number;
  maxHoldingTurns?: number;
  collectRentWhileHeld?: boolean;
}

export interface CreateGameRequest {
  hostName: string;
  hostToken: TokenKey;
  /** Language for package content selected once per game. */
  language?: string;
  maxPlayers?: number;
  board?: string;
  settings?: GameSettings;
  /** Token of an uploaded .corro package (from POST /api/packages); set for a package game. */
  packageToken?: string;
  /** The host's chosen values for the package's declared house rules (ruleId -> value).
   *  A "choice" rule carries the selected option id (string). */
  ruleValues?: Record<string, boolean | number | string>;
  /** The host's chosen race seat (squadron/colour); omitted for property boards. */
  hostSeatId?: string;
  /** Classic pairs mode (4-seat race boards): opposite seats are partners. */
  raceTeams?: boolean;
  /** Journey team mode: how many equal teams (a divisor of the exact player count). */
  teamCount?: number;
  /** Initial host choice for the optional voice room. */
  voiceChatEnabled?: boolean;
}

/** A group heading for the rules panel (id referenced by house rules + an i18n name key). */
export interface RuleGroupDef { id: string; nameKey?: string; }

/** One option of a "choice" house rule: the id applied + its i18n label. */
export interface HouseRuleOption { id: string; nameKey?: string; }

/** A host-customizable rule the package declares: a catalog code + UI metadata. */
export interface HouseRuleDef {
  id: string;
  group?: string;
  type: string; // 'toggle' | 'number' | 'choice'
  default?: boolean | number | string;
  min?: number;
  max?: number;
  step?: number;
  /** A "choice" rule's mutually-exclusive options (rendered as radios). */
  options?: HouseRuleOption[];
  editableByHost: boolean;
  nameKey?: string;
}

/** Returned by POST /api/packages after a .corro upload is staged. */
export interface PackageUploadResponse {
  /** Token to pass as createGame.packageToken (also the sound pack id). */
  token: string;
  /** The package's game family ("property" | "race"); absent means property. */
  gameType?: string;
  /** The board's localized name (locale → text). */
  name: Record<string, string>;
  /** The package's rule defaults, to pre-fill the rules panel before the host tweaks them. */
  settings: GameSettings;
  /** Groups for the rules panel (id + i18n name key). */
  ruleGroups?: RuleGroupDef[];
  /** The host-customizable rule declarations to render dynamically. */
  houseRules?: HouseRuleDef[];
  /** The package's player tokens (id + SVG path + name key); empty = built-in token set. */
  tokens?: TokenInfo[];
  /** Fewest players this board can start with (the lobby's start guard mirrors it). */
  minPlayers: number;
  /** Most players this board supports (caps the player-count selector). */
  maxPlayers: number;
  /** A race board's seats (squadron colours) for the lobby's seat picker; empty for property. */
  seats?: LobbySeatInfo[];
  /**
   * An i18n key (in the PACKAGE's own translations) shown to the host as a notice when they create a
   * game with this board. Absent when the package declares none. The engine carries it verbatim and
   * does not interpret the text — it is resolved and displayed client-side.
   */
  warning?: string;
}

/** A shipped, approved board the lobby offers (GET /api/packages/shipped). */
export interface ShippedBoard {
  id: string;
  /** The board's localized name (locale → text). */
  name: Record<string, string>;
}

export interface CreateGameResponse {
  gameId: string;
  inviteCode: string;
  game: GameInfo;
  hostSecretId: string;
  /** The host's personal RE-ENTRY code (private to the caller). */
  hostRejoinCode?: string;
}

export interface JoinGameRequest {
  gameId: string;
  playerName: string;
  playerToken: TokenKey;
  /** The joiner's chosen race seat (squadron/colour); omitted for property boards. */
  seatId?: string;
}

export interface JoinGameResponse {
  playerId: string;
  playerSecretId: string;
  game: GameInfo;
  /** The joiner's personal RE-ENTRY code (private to the caller). Also present on the
   *  board's per-join ack ({gameId, playerId, rejoinCode}), which reuses this shape. */
  rejoinCode?: string;
  gameId?: string;
}

/** ResolveJoinCode: the lobby's one code box accepts an INVITE code (kind "game") or a
 *  player's RE-ENTRY code (kind "seat" — a read-only preview; claiming is a second step). */
export interface ResolvedJoinCode {
  kind: 'game' | 'seat';
  /** kind "game": the joinable-game info for the join form. */
  game?: GameInfo;
  /** kind "seat" fields: */
  gameId?: string;
  board?: string;
  status?: string;
  playerName?: string;
  token?: string;
  isHost?: boolean;
  /** Somebody is connected on that seat right now (claiming would be refused). */
  connected?: boolean;
  gameOver?: boolean;
}

/** ClaimSeatByRejoinCode: the full fresh session (the secret id is newly rotated). */
export interface SeatClaimedSession {
  gameId: string;
  playerId: string;
  playerSecretId: string;
  playerName: string;
  token: string;
  isHost: boolean;
  board: string;
  status: string;
  rejoinCode: string;
}

export interface StartGameRequest {
  gameId: string;
  hostId: string;
}

export interface StartGameResponse {
  gameId: string;
  game: GameInfo;
  gameState?: GameState;
}

// === SAVED GAMES (lobby "your games" list) ===
// Live info the server returns for a game stored locally on this browser. `status`
// arrives as the GameStatus enum name (e.g. "Active") and `token` as the PascalCase
// TokenKey name (e.g. "Disc") — convert tokens with convertTokenToSnakeCase.
export interface SavedGamePlayerInfo {
  id: string;
  name: string;
  token: string;
  isHost: boolean;
  connected: boolean;
}

export interface SavedGameInfo {
  gameId: string;
  status: string;
  board: string;
  hostId: string;
  maxPlayers: number;
  createdAt: string;
  players: SavedGamePlayerInfo[];
}

// === COMMANDS ===
export interface GameCommand {
  type: string;
  playerId: string;
  data?: any;
}

export interface CommandResponse {
  success: boolean;
  message?: string;
  data?: any;
  type?: string;
  code?: string;
}

// === SPECIFIC RESPONSES ===
export interface DiceRolledResponse {
  type: 'DICE_ROLLED';
  playerId: string;
  playerName: string;
  die1: number;
  die2: number;
  total: number;
  isDoubles: boolean;
  fromPosition: number;
  toPosition: number;
  nextPlayerId?: string;
  nextPlayerName?: string;
  // Destination square info
  squareName?: string;
  squarePrice?: number;
  canBuySquare: boolean;
  // If can buy, does the player have enough money? (calculated by server)
  canAfford: boolean;
  timestamp?: string;
  // Holding-related fields
  releasedFromHolding?: boolean;
  stillHeld?: boolean;
  holdingTurnsRemaining?: number;
  paidReleaseCost?: boolean;
  releaseCostAmount?: number;
}

// === AUCTION ===
export interface AuctionBid {
  playerId: string;
  playerName: string;
  amount: number;
  timestamp?: string;
}

export interface AuctionState {
  squareIndex: number;
  squareName: string;
  startingPrice: number;
  currentBid: number;
  highestBidderId?: string;
  highestBidderName?: string;
  bids: AuctionBid[];
  passedPlayers: string[];
  startedAt: string;
  /** Bid window length serialized as a TimeSpan string (e.g. "00:00:10"). */
  bidTimeout?: string;
  /** When the current bid window started (ISO string), used to estimate the countdown. */
  currentPhaseStartedAt?: string;
  initiatorPlayerId: string;
  isActive: boolean;
}

export interface AuctionStartedResponse {
  type: 'AUCTION_STARTED';
  squareIndex: number;
  squareName: string;
  startingPrice: number;
  initiatorPlayerId: string;
  initiatorPlayerName: string;
  bidTimeoutSeconds: number;
}

export interface BidPlacedResponse {
  type: 'BID_PLACED';
  squareIndex: number;
  squareName: string;
  bidderId: string;
  bidderName: string;
  amount: number;
  bidTimeoutSeconds: number;
}

export interface AuctionPassedResponse {
  type: 'AUCTION_PASSED';
  squareIndex: number;
  playerId: string;
  playerName: string;
  remainingBidders: number;
}

export interface AuctionEndedResponse {
  type: 'AUCTION_ENDED';
  squareIndex: number;
  squareName: string;
  winnerId?: string;
  winnerName?: string;
  winningBid?: number;
  propertySold: boolean;
  nextPlayerId?: string;
  nextPlayerName?: string;
}

export interface AuctionTimerTick {
  squareIndex: number;
  secondsRemaining: number;
  currentBid: number;
  highestBidderId?: string;
  highestBidderName?: string;
}

// === CARDS ===
/**
 * Card draw notification pushed by the server. Carries pre-resolved translation
 * keys (without the "game." prefix is NOT assumed; keys are full) and vars so the
 * client can translate without re-deriving anything. Mirrors the server record.
 */
export interface CardDrawnNotification {
  playerId: string;
  playerName: string;
  cardId: string;
  deckType: string; // 'chance' | 'community' | a package deck id
  /** Sanitized path-data from assets/cards/<id>.svg; absent uses a neutral illustration. */
  svg?: string | null;
  /** Optional package-owned #RRGGBB accent. */
  artColor?: string | null;
  /** Generic effect id used to choose the neutral illustration. */
  artType?: string | null;
  titleKey: string;
  /** i18n key for the card's text (classic app key or a package "cards.*" key); resolved client-side. */
  descriptionKey: string;
  descriptionVars: Record<string, any>;
}

// === DEBT & BANKRUPTCY ===
export type DebtReason = 'rent' | 'tax' | 'card' | 'holding' | 'other';

export interface DebtState {
  id: string;
  debtorId: string;
  debtorName: string;
  creditorId: string; // "Bank" for bank debts
  creditorName: string;
  amount: number;
  reason: DebtReason;
  description?: string;
  createdAt: string;
}

export interface PropertyMortgagedResponse {
  type: 'PROPERTY_MORTGAGED';
  playerId: string;
  playerName: string;
  squareIndex: number;
  squareName: string;
  amountReceived: number;
  playerMoney: number;
  remainingDebt: number;
}

export interface PropertyUnmortgagedResponse {
  type: 'PROPERTY_UNMORTGAGED';
  playerId: string;
  playerName: string;
  squareIndex: number;
  squareName: string;
  amountPaid: number;
  playerMoney: number;
}

export interface BuildingsSoldResponse {
  type: 'HOUSES_SOLD';
  playerId: string;
  playerName: string;
  squareIndex: number;
  squareName: string;
  count: number;
  amountReceived: number;
  remainingBuildings: number;
  playerMoney: number;
  remainingDebt: number;
}

export interface BuildingBuiltResponse {
  type: 'HOUSE_BUILT';
  playerId: string;
  playerName: string;
  squareIndex: number;
  squareName: string;
  count: number;
  amountSpent: number;
  smallBuildings: number;
  bigBuildings: number;
  playerMoney: number;
}

// === TRADING ===
export interface TradePropertyDto {
  index: number;
  name: string;
  color?: string;
  /** i18n key for the square's group name; resolved for the accessible label (not the raw hex colour). */
  groupNameKey?: string;
  price?: number;
}

export interface TradeSideDto {
  properties: TradePropertyDto[];
  money: number;
  releasePasses: number;
}

export interface TradeProposedResponse {
  type: 'TRADE_PROPOSED';
  tradeId: string;
  initiatorId: string;
  initiatorName: string;
  targetId: string;
  targetName: string;
  /** What the initiator gives away. */
  offered: TradeSideDto;
  /** What the target gives away (what the initiator requests). */
  requested: TradeSideDto;
}

export interface TradeResolvedResponse {
  type: 'TRADE_RESOLVED';
  tradeId: string;
  outcome: 'accepted' | 'declined' | 'cancelled';
  initiatorId: string;
  targetId: string;
}


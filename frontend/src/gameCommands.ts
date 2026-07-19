import type { Player, Square, DebtState } from './models.js';
import { isOwnableSquare } from './squareBehavior.js';

export interface AuctionStatus {
	squareName: string;
	currentBid: number;
	highestBidderName: string | null;
	secondsRemaining: number;
	playerMoney: number;
}

/**
 * True when `playerId` owns EVERY property square sharing `color` (a full colour-group
 * classic, which is what unlocks building houses and doubles the bare rent). Returns false
 * for colourless squares (railroads/utilities) and whenever any square in the group is
 * unowned or owned by someone else. Pure so it can be unit-tested without DOM/i18next.
 */
export function ownsWholeColorGroup(
	squares: Square[],
	color: string | undefined | null,
	playerId: string | undefined | null
): boolean {
	if (!color || !playerId) return false;
	const target = color.toLowerCase();
	const group = squares.filter(s => s.color && s.color.toLowerCase() === target);
	if (group.length === 0) return false;
	return group.every(s => s.ownerId === playerId);
}

export interface GameCommandsOptions {
	getPlayers: () => Player[];
	announce: (msg: string) => void;
	t: (key: string, vars?: Record<string, any>) => string;
	getGroupMap: () => Map<string, number[]>;
	/** The square's spoken group/colour label ("Grupo: Marrón" / "Color: brown"), '' when it has none
	 *  (e.g. a hex-only colour with no group key). Built with squareGroupLabel so it matches the board. */
	groupLabel?: (square: Square) => string;
	nextOccupiedFn: (start: number, forward: boolean) => number;
	setActiveIndex: (i: number, announceMove?: boolean) => void;
	getCurrentTurn: () => string | undefined; // ID of the player with the current turn
	getMyPlayerId?: () => string | undefined; // ID of the local player
	getPlayerMoney: (playerId: string) => number; // money of a specific player
	getPlayerReleasePasses: (playerId: string) => number; // release passes
	getPendingDebts?: () => DebtState[]; // pending debts in the game
	getFreeParkingPot: () => number; // accumulated Free Parking pot
	getActiveAuction?: () => AuctionStatus | null; // currently active auction, if any
}

export class GameCommands {
	private opts: GameCommandsOptions;
	
	constructor(opts: GameCommandsOptions) {
		this.opts = opts;
	}

	announcePlayersOnSquare(activeIndex: number): boolean {
		if (activeIndex === -1) { 
			this.opts.announce(this.opts.t('announce_players_none')); 
			return true; 
		}
		const here = this.opts.getPlayers().filter(p => p.position === activeIndex);
		if (here.length > 0) {
			const list = here.map(p => p.name).join(', ');
			this.opts.announce(this.opts.t('announce_players_there', { list }));
		} else {
			this.opts.announce(this.opts.t('announce_players_none'));
		}
		return true;
	}

	announceOwner(activeIndex: number, squares: Square[]): boolean {
		if (activeIndex === -1) { 
			this.opts.announce(this.opts.t('announce_owner_none')); 
			return true; 
		}
		const s = squares[activeIndex];
		if (s && s.ownerId) {
			const owner = this.opts.getPlayers().find(p => p.id === s.ownerId);
			const ownerLabel = owner ? owner.name : String(s.ownerId);
			this.opts.announce(this.opts.t('announce_owner_is', { who: ownerLabel }));
		} else {
			this.opts.announce(this.opts.t('announce_owner_none'));
		}
		return true;
	}

	nextOccupied(start: number, forward: boolean, squares: Square[]): boolean {
		const tgt = this.opts.nextOccupiedFn(start, forward);
		if (tgt < 0) return true;
		const here = this.opts.getPlayers().filter(p => p.position === tgt);
		if (here.length > 0) {
			// This command hops between OCCUPIED squares, so lead with WHO is standing
			// there (and where) instead of burying the players at the tail of the long
			// square description. Suppress the board's verbose auto-label to avoid a
			// redundant second utterance.
			const players = here.map(p => p.name).join(', ');
			const square = squares[tgt]?.name ?? '';
			this.opts.announce(this.opts.t('announce_player_on_square', { players, square }));
			this.opts.setActiveIndex(tgt, false);
		} else {
			this.opts.setActiveIndex(tgt);
		}
		return true;
	}

	groupNext(activeIndex: number, group: string, forward: boolean = true): boolean {
		if (!group || group.trim() === '') return false;
		const clean = String(group).toLowerCase().replace(/[^a-z]/g, '');
		const arr = this.opts.getGroupMap().get(clean) || [];
		if (arr.length === 0) return true;
		const curIdx = arr.indexOf(activeIndex);
		let next: number;
		if (curIdx === -1) {
			next = forward ? arr[0] : arr[arr.length - 1];
		} else {
			next = forward
				? arr[(curIdx + 1) % arr.length]
				: arr[(curIdx - 1 + arr.length) % arr.length];
		}
		this.opts.setActiveIndex(next);
		return true;
	}

	/**
	 * Move the board cursor to the next (or previous) square the local player owns,
	 * cycling through them in board order. When the cursor is not currently on one of
	 * my squares it jumps to the nearest owned square in the chosen direction (wrapping
	 * around). Announces a hint when I own nothing yet.
	 */
	ownedNext(activeIndex: number, forward: boolean, squares: Square[]): boolean {
		const myId = this.opts.getMyPlayerId?.();
		const owned = myId
			? squares.reduce<number[]>((acc, s, i) => { if (s.ownerId === myId) acc.push(i); return acc; }, [])
			: [];
		if (owned.length === 0) {
			this.opts.announce(this.opts.t('announce_owned_none'));
			return true;
		}
		const curIdx = owned.indexOf(activeIndex);
		let next: number;
		if (curIdx >= 0) {
			next = forward
				? owned[(curIdx + 1) % owned.length]
				: owned[(curIdx - 1 + owned.length) % owned.length];
		} else {
			next = forward
				? owned.find(i => i > activeIndex) ?? owned[0]
				: [...owned].reverse().find(i => i < activeIndex) ?? owned[owned.length - 1];
		}
		this.opts.setActiveIndex(next);
		return true;
	}

	/**
	 * Move the board cursor to the next (or previous) ownable square that nobody owns yet,
	 * cycling through them in board order. When the cursor is not currently on one of them
	 * it jumps to the nearest one in the chosen direction (wrapping). Announces a hint when
	 * every square is already owned.
	 */
	unownedNext(activeIndex: number, forward: boolean, squares: Square[]): boolean {
		const isUnowned = (s: Square) => !s.ownerId && isOwnableSquare(s);
		const unowned = squares.reduce<number[]>((acc, s, i) => { if (isUnowned(s)) acc.push(i); return acc; }, []);
		if (unowned.length === 0) {
			this.opts.announce(this.opts.t('announce_unowned_none'));
			return true;
		}
		const curIdx = unowned.indexOf(activeIndex);
		let next: number;
		if (curIdx >= 0) {
			next = forward
				? unowned[(curIdx + 1) % unowned.length]
				: unowned[(curIdx - 1 + unowned.length) % unowned.length];
		} else {
			next = forward
				? unowned.find(i => i > activeIndex) ?? unowned[0]
				: [...unowned].reverse().find(i => i < activeIndex) ?? unowned[unowned.length - 1];
		}
		this.opts.setActiveIndex(next);
		return true;
	}

	/** Simultaneous games (draft) have no turn order: T says so instead of a nonexistent
	 *  turn — the key stays (many players reach for it) but speaks the truth of the genre. */
	announceNoTurns(): boolean {
		this.opts.announce(this.opts.t('announce_no_turns'));
		return true;
	}

	announceTurn(): boolean {
		const currentTurnId = this.opts.getCurrentTurn();
		if (!currentTurnId) {
			this.opts.announce(this.opts.t('announce_no_turn_set'));
			return true;
		}

		const player = this.opts.getPlayers().find(p => p.id === currentTurnId);
		if (!player) {
			this.opts.announce(this.opts.t('announce_no_turn_set'));
			return true;
		}

		const playerLabel = player.name;

		// A current player with no live connection explains why nothing is happening —
		// append it to whatever turn line is spoken. (I can't hear my own turn while
		// disconnected, so the suffix only ever describes ANOTHER player.)
		const offlineSuffix = player.isConnected === false
			? ` ${this.opts.t('turn_player_disconnected', { player: playerLabel })}`
			: '';

		// Check if there are pending debts
		const pendingDebts = this.opts.getPendingDebts?.() || [];
		if (pendingDebts.length > 0) {
			// Find the debtor (player with debts)
			const debtorId = pendingDebts[0].debtorId;
			const debtor = this.opts.getPlayers().find(p => p.id === debtorId);

			if (debtor) {
				const debtorLabel = debtor.name;
				this.opts.announce(this.opts.t('announce_turn_with_debt', {
					player: playerLabel,
					debtor: debtorLabel
				}) + offlineSuffix);
				return true;
			}
		}

		this.opts.announce(
			(currentTurnId === this.opts.getMyPlayerId?.()
				? this.opts.t('turn_of_self')
				: this.opts.t('turn_of', { player: playerLabel })) + offlineSuffix
		);
		return true;
	}

	announceAuctionStatus(): boolean {
		const auction = this.opts.getActiveAuction?.();
		if (!auction) {
			this.opts.announce(this.opts.t('auction_status_none'));
			return true;
		}
		const key = auction.highestBidderName ? 'auction_status_with_bid' : 'auction_status_no_bid';
		this.opts.announce(this.opts.t(key, {
			property: auction.squareName,
			amount: auction.currentBid,
			bidder: auction.highestBidderName ?? '',
			seconds: auction.secondsRemaining,
			money: auction.playerMoney
		}));
		return true;
	}

	announceCurrentBid(): boolean {
		const auction = this.opts.getActiveAuction?.();
		if (!auction) {
			this.opts.announce(this.opts.t('auction_status_none'));
			return true;
		}
		if (auction.highestBidderName) {
			this.opts.announce(this.opts.t('auction_current_bid_only', {
				amount: auction.currentBid,
				bidder: auction.highestBidderName
			}));
		} else {
			this.opts.announce(this.opts.t('auction_current_bid_none'));
		}
		return true;
	}

	announceCurrentPlayerMoney(): boolean {
		// This shortcut announces YOUR OWN money (help text: "Announce your money"),
		// so it must read the local player — not whoever currently has the turn. After
		// you buy a property your turn passes to the next player, and reading the
		// current-turn player here would announce THEIR balance instead of yours.
		const myId = this.opts.getMyPlayerId?.() ?? this.opts.getCurrentTurn();
		if (!myId) {
			this.opts.announce(this.opts.t('announce_no_current_player'));
			return true;
		}

		const player = this.opts.getPlayers().find(p => p.id === myId);
		if (player) {
			const money = this.opts.getPlayerMoney(myId);
			// A player's cash never goes negative; an unpayable charge becomes a pending
			// debt instead. Reading only the cash would hide that the player owes money,
			// so when there is outstanding debt we read both figures together.
			const myDebt = (this.opts.getPendingDebts?.() ?? [])
				.filter(d => d.debtorId === myId)
				.reduce((sum, d) => sum + d.amount, 0);
			if (myDebt > 0) {
				this.opts.announce(this.opts.t('announce_player_money_with_debt', {
					amount: money.toLocaleString('es-ES'),
					debt: myDebt.toLocaleString('es-ES')
				}));
			} else {
				this.opts.announce(this.opts.t('announce_player_money', {
					amount: money.toLocaleString('es-ES') // format with thousands separators
				}));
			}
		} else {
			this.opts.announce(this.opts.t('announce_no_current_player'));
		}
		return true;
	}

	announceCurrentPlayerReleasePasses(): boolean {
		const currentTurnId = this.opts.getCurrentTurn();
		if (!currentTurnId) {
			this.opts.announce(this.opts.t('announce_no_current_player'));
			return true;
		}

		const player = this.opts.getPlayers().find(p => p.id === currentTurnId);
		if (player) {
			const cards = this.opts.getPlayerReleasePasses(currentTurnId);
			if (cards === 0) {
				this.opts.announce(this.opts.t('announce_release_passes_none'));
			} else if (cards === 1) {
				this.opts.announce(this.opts.t('announce_release_passes_one'));
			} else {
				this.opts.announce(this.opts.t('announce_release_passes', { count: cards }));
			}
		} else {
			this.opts.announce(this.opts.t('announce_no_current_player'));
		}
		return true;
	}

	announceGroup(activeIndex: number, squares: Square[]): boolean {
		if (activeIndex === -1 || !squares[activeIndex]) {
			this.opts.announce(this.opts.t('announce_no_square_selected'));
			return true;
		}
		// Use the square's group name key (works for hex-coloured package boards, not just the classic
		// named colours) via the same helper the board status uses. Empty => nothing meaningful to say.
		const label = this.opts.groupLabel?.(squares[activeIndex]) ?? '';
		this.opts.announce(label || this.opts.t('announce_no_group'));
		return true;
	}

	announceFreeParkingPot(): boolean {
		const pot = this.opts.getFreeParkingPot();
		if (pot > 0) {
			this.opts.announce(this.opts.t('announce_free_parking_pot', { amount: pot.toLocaleString('es-ES') }));
		} else {
			this.opts.announce(this.opts.t('announce_free_parking_pot_empty'));
		}
		return true;
	}

	announcePrice(activeIndex: number, squares: Square[]): boolean {
		if (activeIndex === -1 || !squares[activeIndex]) {
			this.opts.announce(this.opts.t('announce_no_square_selected'));
			return true;
		}
		const s = squares[activeIndex];
		if (s.price) {
			this.opts.announce(this.opts.t('announce_square_price', { price: s.price }));
		} else if (s.amount) {
			// A tax square isn't for sale — announce the sum due as a tax, not a price.
			this.opts.announce(this.opts.t('announce_square_tax', { price: s.amount }));
		} else {
			this.opts.announce(this.opts.t('announce_no_price'));
		}
		return true;
	}
}

using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using Microsoft.AspNetCore.SignalR;

namespace CorroServer.Hubs;

/// <summary>
/// Partial class containing lobby methods for GameHub.
/// Handles game creation, joining, and lobby management.
/// </summary>
public partial class GameHub
{
	// ============================================
	// UNIFIED LOBBY METHODS (VIA SIGNALR)
	// ============================================

	/// <summary>
	/// Create a new game/lobby via SignalR
	/// </summary>
	public async Task CreateGameLobby(CreateGameRequest request)
	{
		try
		{
			if (request is null
				|| !LobbyInput.TryNormalizePlayerName(request.HostName, out var hostName)
				|| !LobbyInput.IsIdentifier(request.HostToken)
				|| !LobbyInput.TryNormalizeDisplayName(request.Board, out var boardName)
				|| !LobbyInput.IsIdentifier(request.PackageToken, optional: true)
				|| !LobbyInput.IsIdentifier(request.HostSeatId, optional: true)
				|| !LobbyInput.IsPlayerCount(request.MaxPlayers))
			{
				await Clients.Caller.SendAsync("Error",
					request is not null && !LobbyInput.TryNormalizePlayerName(request.HostName, out _)
						? "INVALID_PLAYER_NAME"
						: "INVALID_LOBBY_REQUEST");
				return;
			}
			request = request with
			{
				HostName = hostName,
				Board = boardName,
				Language = LobbyInput.NormalizeLanguage(request.Language),
			};
			if (request.VoiceChatEnabled && _voiceService?.IsConfigured != true)
			{
				await Clients.Caller.SendAsync("Error", "VOICE_NOT_CONFIGURED");
				return;
			}

			var gameId = IdGenerator.GameId();
			var inviteCode = IdGenerator.InviteCode();
			var hostId = IdGenerator.PlayerId();
			var hostSecretId = IdGenerator.SecureId();
			var hostRejoinCode = IdGenerator.RejoinCode();

			// A package game records how to re-derive its package on restore: a shipped board by id,
			// or an uploaded board by its durable blob key (tracked by the store at stage time).
			var origin = request.PackageToken is { } token ? _packageStore.GetOrigin(token) : null;
			if (request.PackageToken is not null && origin is null)
			{
				// The upload may have expired before the host submitted the lobby. Never persist a
				// package game that has no shipped source or durable blob from which it can restore.
				await Clients.Caller.SendAsync("Error", "INVALID_LOBBY_REQUEST");
				return;
			}

			// Journey team mode: the count must produce at least two EQUAL teams of at least
			// two players out of the (now exact) player count.
			if (request.TeamCount is { } teamCount && teamCount != 0
				&& (teamCount < 2 || request.MaxPlayers % teamCount != 0 || request.MaxPlayers / teamCount < 2))
			{
				await Clients.Caller.SendAsync("Error", "BAD_TEAM_COUNT");
				return;
			}

			var gameDocument = new GameDocument
			{
				Id = $"game-{gameId}",
				GameId = gameId,
				Status = GameStatus.WaitingForPlayers,
				HostId = hostId,
				InviteCode = inviteCode,
				MaxPlayers = request.MaxPlayers,
				Board = request.Board,
				Language = request.Language,
				PackageToken = request.PackageToken,
				ShippedBoardId = origin?.ShippedId,
				PackageBlobKey = origin?.BlobKey,
				RuleValues = request.RuleValues,
				RaceTeams = request.RaceTeams,
				TeamCount = request.TeamCount is 0 ? null : request.TeamCount,
				VoiceChatEnabled = request.VoiceChatEnabled,
				Settings = request.Settings ?? new GameSettings(),
				Players = new List<LobbyPlayer>
				{
					new LobbyPlayer
					{
						Id = hostId,
						Name = request.HostName,
						Token = request.HostToken,
						SeatId = request.HostSeatId,
						IsHost = true,
						IsReady = true,
						PlayerSecretId = hostSecretId,
						RejoinCode = hostRejoinCode
					}
				}
			};

			var savedGame = await _gameRepository.CreateGameAsync(gameDocument);

			await Groups.AddToGroupAsync(Context.ConnectionId, $"lobby_{gameId}");
			_registry.MapLobbyConnection(Context.ConnectionId, gameId);

			var response = new CreateGameResponse
			{
				GameId = gameId,
				InviteCode = inviteCode,
				Game = savedGame.Sanitized(),
				HostSecretId = hostSecretId,
				HostRejoinCode = hostRejoinCode
			};

			await Clients.Caller.SendAsync("GameCreated", response);
			_logger?.LogInformation("Game created via SignalR: {GameId}", gameId);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in CreateGameLobby");
			await Clients.Caller.SendAsync("Error", "GAME_CREATE_ERROR");
		}
	}

	/// <summary>
	/// Join a game/lobby via SignalR
	/// </summary>
	public async Task JoinGameLobby(JoinGameRequest request)
	{
		try
		{
			if (request is null
				|| !LobbyInput.TryNormalizePlayerName(request.PlayerName, out var playerName)
				|| !LobbyInput.IsIdentifier(request.GameId)
				|| !LobbyInput.IsIdentifier(request.PlayerToken)
				|| !LobbyInput.IsIdentifier(request.SeatId, optional: true))
			{
				await Clients.Caller.SendAsync("Error",
					request is not null && !LobbyInput.TryNormalizePlayerName(request.PlayerName, out _)
						? "INVALID_PLAYER_NAME"
						: "INVALID_LOBBY_REQUEST");
				return;
			}
			request = request with { PlayerName = playerName };

			_logger?.LogDebug("JoinGameLobby: gameId={GameId}, playerName={PlayerName}, token={Token}", request.GameId, request.PlayerName, request.PlayerToken);

			var game = await _gameRepository.LoadGameAsync(request.GameId);
			if (game == null)
			{
				_logger?.LogWarning("JoinGameLobby: Game not found: {GameId}", request.GameId);
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}

			_logger?.LogDebug("JoinGameLobby: Game found, status={Status}, players={PlayerCount}/{MaxPlayers}", game.Status, game.Players.Count, game.MaxPlayers);

			if (game.Status != GameStatus.WaitingForPlayers)
			{
				_logger?.LogWarning("JoinGameLobby: Game already started");
				await Clients.Caller.SendAsync("Error", "GAME_ALREADY_STARTED");
				return;
			}

			if (game.Players.Count >= game.MaxPlayers)
			{
				_logger?.LogWarning("JoinGameLobby: Game full");
				await Clients.Caller.SendAsync("Error", "GAME_FULL");
				return;
			}

			if (game.Players.Any(p => p.Token == request.PlayerToken))
			{
				_logger?.LogWarning("JoinGameLobby: Token in use: {Token}", request.PlayerToken);
				await Clients.Caller.SendAsync("Error", "TOKEN_IN_USE");
				return;
			}

			// A chosen race seat is exclusive, like the token: first come, first seated.
			if (!string.IsNullOrEmpty(request.SeatId) && game.Players.Any(p => p.SeatId == request.SeatId))
			{
				_logger?.LogWarning("JoinGameLobby: Seat in use: {SeatId}", request.SeatId);
				await Clients.Caller.SendAsync("Error", "SEAT_IN_USE");
				return;
			}

			_logger?.LogDebug("JoinGameLobby: Creating new player...");
			var playerId = IdGenerator.PlayerId();
			var playerSecretId = IdGenerator.SecureId();
			var playerRejoinCode = IdGenerator.RejoinCode();
			var newPlayer = new LobbyPlayer
			{
				Id = playerId,
				Name = request.PlayerName,
				Token = request.PlayerToken,
				SeatId = request.SeatId,
				IsHost = false,
				IsReady = false,
				PlayerSecretId = playerSecretId,
				RejoinCode = playerRejoinCode
			};

			var updatedPlayers = game.Players.ToList();
			updatedPlayers.Add(newPlayer);

			_logger?.LogDebug("JoinGameLobby: Updating game in DB...");
			var updatedGame = game with { Players = updatedPlayers };
			await _gameRepository.UpdateGameAsync(updatedGame);
			_logger?.LogDebug("JoinGameLobby: Game updated in DB");

			await Groups.AddToGroupAsync(Context.ConnectionId, $"lobby_{game.GameId}");
			_registry.MapLobbyConnection(Context.ConnectionId, game.GameId);

			_logger?.LogDebug("JoinGameLobby: Sending LobbyUpdated to group lobby_{GameId}", game.GameId);
			await Clients.Group($"lobby_{game.GameId}").SendAsync("LobbyUpdated", updatedGame.Sanitized());

			var response = new JoinGameResponse
			{
				PlayerId = playerId,
				PlayerSecretId = playerSecretId,
				Game = updatedGame.Sanitized(),
				RejoinCode = playerRejoinCode
			};

			_logger?.LogDebug("JoinGameLobby: Sending GameJoined to caller");
			await Clients.Caller.SendAsync("GameJoined", response);
			_logger?.LogInformation("Player {PlayerName} joined game {GameId} via SignalR", request.PlayerName, request.GameId);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in JoinGameLobby");
			await Clients.Caller.SendAsync("Error", "GAME_JOIN_ERROR");
		}
	}

	/// <summary>
	/// Get game information by invite code via SignalR
	/// </summary>
	public async Task<object> GetGameByInviteCode(string inviteCode)
	{
		GameDocument? game;
		try
		{
			game = await _gameRepository.GetByInviteCodeAsync(inviteCode);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in GetGameByInviteCode");
			throw new HubException("GAME_LOOKUP_ERROR");
		}

		// A missing game is an expected outcome (expired/invalid code), not a server
		// failure: surface a clean GAME_NOT_FOUND so the client can react accordingly
		// instead of the generic GAME_LOOKUP_ERROR.
		if (game == null)
		{
			throw new HubException("GAME_NOT_FOUND");
		}

		return await BuildJoinableGameInfoAsync(game);
	}

	/// <summary>
	/// The lobby's ONE code box accepts two kinds of codes; this resolves which. An INVITE
	/// code answers the joinable-game info (kind "game"); a player's RE-ENTRY code answers
	/// a read-only seat preview (kind "seat") - name, board, status, whether somebody is
	/// connected on it - so the client can confirm before actually claiming (claiming
	/// rotates the seat's secret, so it must be an explicit second step).
	/// </summary>
	public async Task<object> ResolveJoinCode(string code)
	{
		code = code?.Trim().ToUpperInvariant() ?? "";
		GameDocument? game;
		GameDocument? byRejoin;
		try
		{
			game = await _gameRepository.GetByInviteCodeAsync(code);
			byRejoin = game == null ? await _gameRepository.GetByRejoinCodeAsync(code) : null;
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in ResolveJoinCode");
			throw new HubException("GAME_LOOKUP_ERROR");
		}

		if (game != null)
		{
			return new { kind = "game", game = await BuildJoinableGameInfoAsync(game) };
		}

		if (byRejoin == null)
		{
			throw new HubException("GAME_NOT_FOUND");
		}

		var seat = byRejoin.Players.First(p => p.RejoinCode == code);
		return new
		{
			kind = "seat",
			gameId = byRejoin.GameId,
			board = byRejoin.Board,
			status = byRejoin.Status,
			playerName = seat.Name,
			token = seat.Token,
			isHost = seat.IsHost,
			connected = _registry.ConnectedPlayerIds(byRejoin.GameId).Contains(seat.Id),
			gameOver = byRejoin.Status is GameStatus.Completed or GameStatus.Abandoned,
		};
	}

	/// <summary>
	/// Reclaim a seat with its player's RE-ENTRY code (see <see cref="RejoinService"/>).
	/// Returns the FULL fresh session (secret id newly rotated) for the client to save and
	/// resume with; throws GAME_NOT_FOUND / GAME_OVER / SEAT_CONNECTED otherwise.
	/// </summary>
	public async Task<SeatClaimedResponse> ClaimSeatByRejoinCode(string code)
	{
		RejoinService.ClaimResult result;
		try
		{
			result = await RejoinService.ClaimAsync(
				code?.Trim().ToUpperInvariant() ?? "",
				_gameRepository,
				id => _registry.ConnectedPlayerIds(id));
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in ClaimSeatByRejoinCode");
			throw new HubException("GAME_LOOKUP_ERROR");
		}

		if (result.Session == null)
		{
			throw new HubException(result.Error);
		}

		// Refresh the persistence cache so the very next authenticated call (chat, commands)
		// validates against the ROTATED secret, not a stale cached document.
		_registry.CacheDocument(result.Session.GameId, result.UpdatedGame!);
		_logger?.LogInformation("Seat {PlayerId} in game {GameId} reclaimed via re-entry code",
			result.Session.PlayerId, result.Session.GameId);
		return result.Session;
	}

	/// <summary>The joinable-game projection shared by the code paths: board, tokens, race
	/// seats and the players WITHOUT any credentials.</summary>
	private async Task<object> BuildJoinableGameInfoAsync(GameDocument game)
	{
		// Resolve the package (if any) so a joiner sees the BOARD's own tokens in the lobby selector,
		// not the built-in set. Re-stage from disk/blob if it isn't already staged on this instance;
		// ReStageAsync is a no-op when already staged, so repeated invite-link opens don't re-download.
		var definition = game.PackageToken is { } packageToken
			? _packageStore.GetDefinition(packageToken) ?? await _packageRestorer.ReStageAsync(game)
			: null;

		var gameInfo = new
		{
			gameId = game.GameId,
			hostId = game.HostId,
			inviteCode = game.InviteCode,
			status = game.Status,
			maxPlayers = game.MaxPlayers,
			board = game.Board,
			packageToken = game.PackageToken,
			teamCount = game.TeamCount, // journey team mode; null = individual play
			tokens = definition?.Manifest.Tokens, // the board's player pieces; null => client uses the 8 built-ins
												  // A race board's seats (squadron colours) so the joiner can pick one; null otherwise.
			seats = definition?.RaceBoard?.Seats
				.Select(s => new { id = s.Id, color = s.Color, nameKey = s.NameKey })
				.ToArray(),
			players = game.Players.Select(p => new
			{
				id = p.Id,
				name = p.Name,
				token = p.Token,
				seatId = p.SeatId,
				isHost = p.IsHost,
				isReady = p.IsReady,
				teamIndex = p.TeamIndex
			}).ToArray()
		};

		return gameInfo;
	}

	/// <summary>
	/// The HOST seats a bot in the waiting room. Bots are ordinary lobby players with
	/// IsBot set — no secret, no re-entry code, no connection. Only families with a bot
	/// policy accept them (see Services/Bots/BotPolicies); the driver takes over at start.
	/// </summary>
	public async Task AddBot(AddBotRequest request)
	{
		try
		{
			var game = await _gameRepository.LoadGameAsync(request.GameId);
			if (game == null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}
			if (game.HostId != request.HostId)
			{
				await Clients.Caller.SendAsync("Error", "HOST_ONLY");
				return;
			}
			if (game.Status != GameStatus.WaitingForPlayers)
			{
				await Clients.Caller.SendAsync("Error", "GAME_ALREADY_STARTED");
				return;
			}
			if (game.Players.Count >= game.MaxPlayers)
			{
				await Clients.Caller.SendAsync("Error", "GAME_FULL");
				return;
			}
			// Only families with a bot brain can seat one.
			var definition = game.PackageToken is { } token
				? _packageStore.GetDefinition(token) ?? await _packageRestorer.ReStageAsync(game)
				: null;
			if (!Services.Bots.BotPolicies.Supports(definition?.Manifest.GameType))
			{
				await Clients.Caller.SendAsync("Error", "BOTS_UNSUPPORTED");
				return;
			}

			// Identity: the host's chosen name (unique at the table, length-capped) or a
			// plain numbered fallback — and the first free package token.
			var number = game.Players.Count(p => p.IsBot) + 1;
			var baseName = string.IsNullOrWhiteSpace(request.Name) ? $"Bot {number}" : request.Name.Trim();
			if (baseName.Length > 24)
			{
				baseName = baseName[..24];
			}

			var botName = baseName;
			for (var n = 2; game.Players.Any(p => p.Name.Equals(botName, StringComparison.OrdinalIgnoreCase)); n++)
			{
				botName = $"{baseName} {n}";
			}

			var usedTokens = game.Players.Select(p => p.Token).ToHashSet();
			var freeToken = definition!.Manifest.Tokens.Select(t => t.Id).FirstOrDefault(id => !usedTokens.Contains(id))
				?? definition.Manifest.Tokens.Select(t => t.Id).FirstOrDefault()
				?? "disc";

			var bot = new LobbyPlayer
			{
				Id = IdGenerator.PlayerId(),
				Name = botName,
				Token = freeToken,
				IsBot = true,
				IsReady = true,
				PlayerSecretId = string.Empty, // never authenticates
				RejoinCode = null,             // nothing to reclaim
			};
			var updatedGame = game with { Players = game.Players.Append(bot).ToList() };
			var savedGame = await _gameRepository.UpdateGameAsync(updatedGame);
			await Clients.Group($"lobby_{game.GameId}").SendAsync("LobbyUpdated", savedGame.Sanitized());
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in AddBot");
			await Clients.Caller.SendAsync("Error", "ADD_BOT_FAILED");
		}
	}

	/// <summary>The HOST removes a bot from the waiting room.</summary>
	public async Task RemoveBot(RemoveBotRequest request)
	{
		try
		{
			var game = await _gameRepository.LoadGameAsync(request.GameId);
			if (game == null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}
			if (game.HostId != request.HostId)
			{
				await Clients.Caller.SendAsync("Error", "HOST_ONLY");
				return;
			}
			if (game.Status != GameStatus.WaitingForPlayers)
			{
				await Clients.Caller.SendAsync("Error", "GAME_ALREADY_STARTED");
				return;
			}
			var bot = game.Players.FirstOrDefault(p => p.Id == request.PlayerId && p.IsBot);
			if (bot == null)
			{
				await Clients.Caller.SendAsync("Error", "PLAYER_NOT_FOUND");
				return;
			}
			var updatedGame = game with { Players = game.Players.Where(p => p.Id != bot.Id).ToList() };
			var savedGame = await _gameRepository.UpdateGameAsync(updatedGame);
			await Clients.Group($"lobby_{game.GameId}").SendAsync("LobbyUpdated", savedGame.Sanitized());
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in RemoveBot");
			await Clients.Caller.SendAsync("Error", "REMOVE_BOT_FAILED");
		}
	}

	/// <summary>
	/// Journey team mode: the HOST places a player in a team (or back in the pool with a null
	/// team). The whole room watches: the updated document broadcasts as usual, plus a
	/// TeamAssigned event so clients announce the move ("Berto joins the Red team").
	/// </summary>
	public async Task AssignTeam(AssignTeamRequest request)
	{
		try
		{
			var game = await _gameRepository.LoadGameAsync(request.GameId);
			if (game == null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}
			if (game.HostId != request.HostId)
			{
				await Clients.Caller.SendAsync("Error", "HOST_ONLY");
				return;
			}
			if (game.Status != GameStatus.WaitingForPlayers || game.TeamCount is not { } teamCount || teamCount < 2)
			{
				await Clients.Caller.SendAsync("Error", "NO_TEAMS_HERE");
				return;
			}
			var player = game.Players.FirstOrDefault(p => p.Id == request.PlayerId);
			if (player == null)
			{
				await Clients.Caller.SendAsync("Error", "PLAYER_NOT_FOUND");
				return;
			}
			if (request.TeamIndex is { } team)
			{
				var teamSize = game.MaxPlayers / teamCount;
				if (team < 0 || team >= teamCount)
				{
					await Clients.Caller.SendAsync("Error", "BAD_TEAM_COUNT");
					return;
				}
				if (game.Players.Count(p => p.Id != player.Id && p.TeamIndex == team) >= teamSize)
				{
					await Clients.Caller.SendAsync("Error", "TEAM_FULL");
					return;
				}
			}

			var updatedGame = game with
			{
				Players = game.Players
					.Select(p => p.Id == player.Id ? p with { TeamIndex = request.TeamIndex } : p)
					.ToList(),
			};
			var savedGame = await _gameRepository.UpdateGameAsync(updatedGame);

			var lobbyGroup = $"lobby_{game.GameId}";
			await Clients.Group(lobbyGroup).SendAsync("LobbyUpdated", savedGame.Sanitized());
			// The spoken move: clients build the team word from the index (engine palette).
			await Clients.Group(lobbyGroup).SendAsync("TeamAssigned", new
			{
				gameId = game.GameId,
				playerId = player.Id,
				playerName = player.Name,
				teamIndex = request.TeamIndex,
			});
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in AssignTeam");
			await Clients.Caller.SendAsync("Error", "ASSIGN_TEAM_FAILED");
		}
	}

	/// <summary>
	/// Start a game via SignalR
	/// </summary>
	public async Task StartGameLobby(StartGameRequest request)
	{
		try
		{
			var game = await _gameRepository.LoadGameAsync(request.GameId);
			if (game == null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}

			if (game.HostId != request.HostId)
			{
				await Clients.Caller.SendAsync("Error", "HOST_ONLY");
				return;
			}

			if (game.Status != GameStatus.WaitingForPlayers)
			{
				await Clients.Caller.SendAsync("Error", "GAME_ALREADY_STARTED");
				return;
			}

			var gameService = _gameServiceFactory.Create();
			gameService.ConfigureSettings(game.Settings);
			var players = game.Players.Select(p => new Player
			{
				Id = p.Id,
				Name = p.Name,
				Token = p.Token,
				SeatId = p.SeatId,
				IsBot = p.IsBot,
				Position = 0,
				Money = game.Settings.StartingMoney
			}).ToList();
			// Randomize the turn order so the starting player isn't always whoever joined first
			// (bug #2). Goes through IRandomSource so the E2E environment's scripted source
			// (identity shuffle) keeps the join order and the whole game stays deterministic.
			players = _random.Shuffle(players).ToList();

			// Every game is a package game now: initialize from its .corro definition. The package
			// is normally still staged from create; if a restart dropped the in-memory staging,
			// re-stage it (shipped board by id / uploaded board from blob). No package -> can't start.
			var packageToken = game.PackageToken;
			var definition = packageToken is null
				? null
				: _packageStore.GetDefinition(packageToken) ?? await _packageRestorer.ReStageAsync(game);
			if (definition is null)
			{
				await Clients.Caller.SendAsync("Error", "PACKAGE_NOT_AVAILABLE");
				return;
			}

			// A board may require more than two players (e.g. a team board); the lobby caps the
			// maximum, but the minimum can only be checked when the host actually starts.
			if (game.Players.Count < definition.Manifest.Players.Min)
			{
				await Clients.Caller.SendAsync("Error", "MIN_PLAYERS");
				return;
			}

			// Classic pairs are two teams of two on opposite seats: exactly four players.
			if (game.RaceTeams && game.Players.Count != 4)
			{
				await Clients.Caller.SendAsync("Error", "TEAMS_NEED_4");
				return;
			}

			// Journey team mode: the table must be FULL and everyone placed in a team by the
			// host (equal sizes hold by construction: the count divides the exact player count).
			List<List<string>>? journeyTeams = null;
			if (game.TeamCount is { } teamCount && teamCount >= 2)
			{
				var teamSize = game.MaxPlayers / teamCount;
				journeyTeams = Enumerable.Range(0, teamCount)
					.Select(t => game.Players.Where(p => p.TeamIndex == t).Select(p => p.Id).ToList())
					.ToList();
				if (game.Players.Count != game.MaxPlayers || journeyTeams.Any(t => t.Count != teamSize))
				{
					await Clients.Caller.SendAsync("Error", "TEAMS_INCOMPLETE");
					return;
				}
			}

			// The effective settings: the host's chosen house-rule values (RuleValues) applied over the
			// package defaults, or the settings sent with the request. Computed the SAME way on restore.
			var settings = GameDefinitionAdapter.EffectiveSettings(game, definition);

			await gameService.InitializeFromDefinitionAsync(players, definition, lang: game.Language, settings: settings,
				raceTeams: game.RaceTeams,
				// Families whose rules live outside GameSettings (journey) apply these themselves.
				ruleValues: game.RuleValues,
				teams: journeyTeams);
			if (gameService.GameState is { } packageState)
			{
				packageState.PackageToken = packageToken; // released on game over; the client's sound pack id
				packageState.VoiceChatEnabled = game.VoiceChatEnabled;
			}

			_registry.RegisterService(request.GameId, gameService);
			// Bot seats (if any) come alive: the driver observes from OUTSIDE the engine.
			_botDriver?.Attach(request.GameId, gameService);

			var updatedGame = game with
			{
				Status = GameStatus.Active,
				GameState = gameService.GameState,
				// Persist the EFFECTIVE settings (house-rule values applied) so the stored document is
				// truthful and any later reader (including restore) sees the real in-effect rules.
				Settings = settings
			};

			var savedGame = await _gameRepository.UpdateGameAsync(updatedGame);
			// Seed the persistence cache so per-command writes reuse this document instead
			// of re-reading it from Cosmos every turn.
			_registry.CacheDocument(request.GameId, savedGame);

			await Clients.Group($"lobby_{game.GameId}")
				.SendAsync("GameStarted", new StartGameResponse
				{
					GameId = game.GameId,
					Game = updatedGame.Sanitized()
				});

			await Clients.Caller.SendAsync("GameStarted", new StartGameResponse
			{
				GameId = game.GameId,
				Game = updatedGame.Sanitized()
			});

			// Same hidden-information contract as every state update: the registry broadcasts
			// for open families and projects per player for hiding ones.
			if (gameService.GameState is { } startedState)
			{
				await _registry.SendStateToClientsAsync(request.GameId, startedState);
			}

			_logger?.LogInformation("Game started via SignalR: {GameId} with board {Board} ({SquareCount} squares)", request.GameId, game.Board, gameService.GameState?.Squares?.Count ?? 0);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in StartGameLobby");
			await Clients.Caller.SendAsync("Error", "GAME_START_ERROR");
		}
	}

	// ============================================
	// SAVED GAMES ("your games" list)
	// ============================================

	/// <summary>
	/// Resolve live info for the games the caller has saved locally. Games that no longer
	/// exist are omitted so the client can prune them from its list.
	/// </summary>
	public async Task<List<SavedGameInfo>> GetGamesInfo(List<string> gameIds)
	{
		var result = new List<SavedGameInfo>();
		if (gameIds == null || gameIds.Count == 0)
		{
			return result;
		}

		foreach (var gameId in gameIds.Distinct())
		{
			try
			{
				var game = await _gameRepository.LoadGameAsync(gameId);
				if (game == null)
				{
					continue; // deleted/expired — client prunes it.
				}

				var connected = _registry.ConnectedPlayerIds(gameId);
				result.Add(new SavedGameInfo
				{
					GameId = game.GameId,
					Status = game.Status,
					Board = game.Board,
					HostId = game.HostId,
					MaxPlayers = game.MaxPlayers,
					CreatedAt = game.CreatedAt,
					Players = game.Players.Select(p => new SavedGamePlayerInfo
					{
						Id = p.Id,
						Name = p.Name,
						Token = p.Token,
						IsHost = p.IsHost,
						Connected = connected.Contains(p.Id)
					}).ToList()
				});
			}
			catch (Exception ex)
			{
				_logger?.LogError(ex, "Error loading saved game info for {GameId}", gameId);
			}
		}

		return result;
	}

	/// <summary>
	/// Permanently delete a game. Only the host may do this. Everyone currently connected
	/// to the game (or its lobby) is told via "GameDeleted" and detached from the group,
	/// losing any in-progress state; the game document and its live service are removed.
	/// </summary>
	public async Task DeleteGameLobby(string gameId, string hostId, string hostSecretId)
	{
		try
		{
			var game = await _gameRepository.LoadGameAsync(gameId);
			if (game == null)
			{
				// Already gone: still confirm so the caller prunes it from its list.
				await Clients.Caller.SendAsync("GameDeleted", new { GameId = gameId });
				return;
			}

			// Host-only, authenticated by the host's secret id (never publicly exposed).
			var host = game.Players.FirstOrDefault(p => p.Id == hostId && p.IsHost);
			if (game.HostId != hostId || host == null || host.PlayerSecretId != hostSecretId)
			{
				_logger?.LogWarning("SECURITY: Non-host delete attempt for game {GameId} by {HostId}", gameId, hostId);
				await Clients.Caller.SendAsync("Error", "HOST_ONLY");
				return;
			}

			// Tell everyone in the game and its lobby that it is gone.
			await Clients.Group(gameId).SendAsync("GameDeleted", new { GameId = gameId });
			await Clients.Group($"lobby_{gameId}").SendAsync("GameDeleted", new { GameId = gameId });

			// Use the same complete teardown as game-over and scheduled retention: live state and
			// persisters stop first, Cosmos is deleted next, then an unshared uploaded blob is released.
			await _registry.DeleteGameAsync(gameId, game);

			foreach (var connId in _registry.GameConnectionIds(gameId))
			{
				_registry.ForgetGameConnection(connId);
				await Groups.RemoveFromGroupAsync(connId, gameId);
			}

			foreach (var connId in _registry.LobbyConnectionIds(gameId))
			{
				_registry.ForgetLobbyConnection(connId);
				await Groups.RemoveFromGroupAsync(connId, $"lobby_{gameId}");
			}

			// The host's own connection may not be in the game group (it is deleting from
			// the lobby list), so confirm to the caller directly too.
			await Clients.Caller.SendAsync("GameDeleted", new { GameId = gameId });
			_logger?.LogInformation("Game {GameId} deleted by host {HostId}", gameId, hostId);
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in DeleteGameLobby");
			await Clients.Caller.SendAsync("Error", "GAME_DELETE_ERROR");
		}
	}
}

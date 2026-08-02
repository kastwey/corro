using CorroServer.Models;
using CorroServer.Services;
using CorroServer.Services.Corro;
using CorroServer.Services.Corro.Families;
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
			var requestedLanguage = request?.Language;
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
			var stagedDefinition = request.PackageToken is { } stagedToken
				? _packageStore.GetDefinition(stagedToken)
				: null;
			// A family whose content is language-split (forbidden's words, trivia's questions) makes
			// the host pick ONE deck for the whole table; everyone else keeps their own UI locale.
			var contentLanguages = stagedDefinition is null
				? new List<string>()
				: GameFamilies.For(stagedDefinition.Manifest.GameType).ContentLanguages(stagedDefinition).ToList();
			if (contentLanguages.Count > 0)
			{
				if (!LobbyInput.TrySelectLanguage(contentLanguages, requestedLanguage, out var selectedContentLanguage))
				{
					await Clients.Caller.SendAsync("Error", "CONTENT_LANGUAGE_UNAVAILABLE");
					return;
				}
				request = request with { Language = selectedContentLanguage };
			}
			// A family that plays only in teams (forbidden: clue-giver vs the opposing monitor) says
			// how many; the table must split evenly into exactly that many.
			if (GameFamilies.For(stagedDefinition?.Manifest.GameType).RequiredTeamCount is { } required
				&& (request.TeamCount != required
					|| request.MaxPlayers % required != 0
					|| request.MaxPlayers / required < 2))
			{
				await Clients.Caller.SendAsync("Error", "BAD_TEAM_COUNT");
				return;
			}

			// Team mode: the count must produce at least two EQUAL teams of at least
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
				ContentLanguages = contentLanguages,
				PackageToken = request.PackageToken,
				// What this table is set up to play, recorded now so its own page can offer the
				// family's setup later without re-staging the package to find out.
				GameType = stagedDefinition?.Manifest.GameType,
				ShippedBoardId = origin?.ShippedId,
				PackageBlobKey = origin?.BlobKey,
				RuleValues = request.RuleValues,
				RaceTeams = request.RaceTeams,
				TeamCount = request.TeamCount is 0 ? null : request.TeamCount,
				// Voice is a property of the DEPLOYMENT, not a per-game decision made before anyone
				// knows they will want it: a game created without it could never be given it later,
				// which is exactly when a table discovers it wants to talk. Every game where the
				// relay exists therefore offers the room from the start, and the host opens or
				// closes it from inside the game. Joining stays each player's own choice.
				VoiceChatEnabled = _voiceService?.IsConfigured == true,
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
						RejoinCode = hostRejoinCode,
						// Read from the caller's own session, never from the request: a client that
						// could name its account could name somebody else's.
						UserId = SignedInUserId()
					}
				}
			};

			var savedGame = await _gameRepository.CreateGameAsync(gameDocument);

			await Groups.AddToGroupAsync(Context.ConnectionId, $"lobby_{gameId}");
			_registry.MapConnectionToGame(Context.ConnectionId, gameId);
			_registry.AuthenticateConnection(Context.ConnectionId, hostId);
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

	/// <summary>The host changes the one shared content deck while waiting — the forbidden words
	/// to guess, the trivia questions to answer. The selected package language is persisted and
	/// broadcast; game start then resolves exactly that one deck for every player. A game whose
	/// package has no language-split content offers no choice, so this rejects it.</summary>
	public async Task SetContentLanguage(SetContentLanguageRequest request)
	{
		try
		{
			if (request is null
				|| !LobbyInput.IsIdentifier(request.GameId)
				|| !LobbyInput.IsIdentifier(request.HostId))
			{
				await Clients.Caller.SendAsync("Error", "INVALID_LOBBY_REQUEST");
				return;
			}
			if (!IsConnectionAuthenticated(out var callerId, out var callerGameId)
				|| callerId != request.HostId
				|| callerGameId != request.GameId)
			{
				await Clients.Caller.SendAsync("Error", "HOST_ONLY");
				return;
			}

			var game = await _gameRepository.LoadGameAsync(request.GameId);
			if (game is null)
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
			if (!LobbyInput.TrySelectLanguage(
				game.ContentLanguages,
				request.Language,
				out var selectedLanguage))
			{
				await Clients.Caller.SendAsync("Error", "CONTENT_LANGUAGE_UNAVAILABLE");
				return;
			}
			if (game.Language == selectedLanguage)
			{
				return;
			}

			var savedGame = await _gameRepository.UpdateGameAsync(game with { Language = selectedLanguage });
			var lobbyGroup = $"lobby_{game.GameId}";
			await Clients.Group(lobbyGroup).SendAsync("LobbyUpdated", savedGame.Sanitized());
			await Clients.Group(lobbyGroup).SendAsync("ContentLanguageChanged", new
			{
				gameId = game.GameId,
				language = selectedLanguage,
			});
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in SetContentLanguage");
			await Clients.Caller.SendAsync("Error", "SET_CONTENT_LANGUAGE_FAILED");
		}
	}

	/// <summary>
	/// A player gives up their seat for good.
	///
	/// Distinct from disconnecting (which keeps the seat and is how you come back) and from
	/// forfeiting a match (which retires you from the GAME and leaves you at the table). This is
	/// the one that ends the relationship: the seat goes, the re-entry code stops resolving with
	/// it, and if the table is left with nobody it is deleted rather than lingering for the
	/// retention sweep. Someone who leaves mid-match forfeits first, through the same command path
	/// a player who forfeits by hand takes, so the turn moves on and the family's own retirement
	/// rules apply instead of a seat vanishing from under the rulebook.
	/// </summary>
	public async Task LeaveTable()
	{
		try
		{
			if (!IsConnectionAuthenticated(out var playerId, out var gameId))
			{
				await Clients.Caller.SendAsync("Error", "NOT_AUTHENTICATED");
				return;
			}

			// Still playing? Then this is a forfeit as well as a departure.
			if (_registry.TryGetService(gameId!, out var service)
				&& service.GameState is { IsGameOver: false } state
				&& state.Players.Any(p => p.Id == playerId && !p.IsBankrupt))
			{
				await RunCommandAsync(gameId!, service, new DeclareBankruptcyCommand { PlayerId = playerId! });
			}

			string? leaverName = null;
			string? newHostId = null;
			// Under the per-game lock: two people leaving at the same instant must not each save a
			// table that still seats the other.
			var saved = await _registry.MutateDocumentAsync(gameId!, document =>
			{
				var leaver = document.Players.FirstOrDefault(p => p.Id == playerId);
				if (leaver is null)
				{
					return null; // already gone (a double click, a retried call)
				}
				leaverName = leaver.Name;
				var remaining = document.Players.Where(p => p.Id != playerId).ToList();
				// The sceptre passes to the next HUMAN by arrival order — the roster IS arrival
				// order. A bot cannot host, and a player who is merely disconnected still holds
				// their seat, so being away does not cost them their place in that queue.
				newHostId = document.HostId == playerId
					? remaining.FirstOrDefault(p => !p.IsBot)?.Id
					: document.HostId;
				return document with
				{
					Players = remaining.Select(p => p with { IsHost = p.Id == newHostId }).ToList(),
					HostId = newHostId ?? document.HostId,
				};
			});

			if (saved is null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}

			// Nobody human left: the table goes with them. A table of bots is not a table, and an
			// empty one would only sit there until the retention sweep noticed.
			if (!saved.Players.Any(p => !p.IsBot))
			{
				await Clients.Group(gameId!).SendAsync("GameDeleted", new { GameId = gameId });
				await Clients.Group($"lobby_{gameId}").SendAsync("GameDeleted", new { GameId = gameId });
				await _registry.DeleteGameAsync(gameId!, saved);
				_logger?.LogInformation("Table {GameId} deleted: its last player left", gameId);
				return;
			}

			// The table hears who left, and who is holding the sceptre now.
			var newHostName = saved.Players.FirstOrDefault(p => p.Id == saved.HostId)?.Name;
			await Clients.Group(gameId!).SendAsync("PlayerLeftTable", new
			{
				GameId = gameId,
				PlayerId = playerId,
				PlayerName = leaverName,
				NewHostId = newHostId != null && newHostId != playerId ? saved.HostId : null,
				NewHostName = newHostId != null && newHostId != playerId ? newHostName : null,
			});
			await Clients.Group(gameId!).SendAsync("LobbyUpdated", saved.Sanitized());
			await Clients.Group($"lobby_{gameId}").SendAsync("LobbyUpdated", saved.Sanitized());
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in LeaveTable");
			await Clients.Caller.SendAsync("Error", "LEAVE_TABLE_FAILED");
		}
	}

	/// <summary>
	/// The host hands the sceptre to somebody else without leaving. The same succession a
	/// departure performs, done on purpose: only the host may, only to a human who is actually at
	/// this table, and never to a bot.
	/// </summary>
	public async Task TransferHost(string newHostId)
	{
		try
		{
			if (!IsConnectionAuthenticated(out var playerId, out var gameId))
			{
				await Clients.Caller.SendAsync("Error", "NOT_AUTHENTICATED");
				return;
			}

			string? refusal = null;
			var saved = await _registry.MutateDocumentAsync(gameId!, document =>
			{
				if (document.HostId != playerId)
				{
					refusal = "HOST_ONLY";
					return null;
				}
				var target = document.Players.FirstOrDefault(p => p.Id == newHostId);
				if (target is null || target.IsBot)
				{
					refusal = "PLAYER_NOT_FOUND";
					return null;
				}
				if (target.Id == playerId)
				{
					return null; // already the host: nothing to say
				}
				return document with
				{
					Players = document.Players.Select(p => p with { IsHost = p.Id == newHostId }).ToList(),
					HostId = newHostId,
				};
			});

			if (refusal is not null)
			{
				await Clients.Caller.SendAsync("Error", refusal);
				return;
			}
			if (saved is null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}

			await Clients.Group(gameId!).SendAsync("HostChanged", new
			{
				GameId = gameId,
				HostId = saved.HostId,
				HostName = saved.Players.FirstOrDefault(p => p.Id == saved.HostId)?.Name,
			});
			await Clients.Group(gameId!).SendAsync("LobbyUpdated", saved.Sanitized());
			await Clients.Group($"lobby_{gameId}").SendAsync("LobbyUpdated", saved.Sanitized());
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in TransferHost");
			await Clients.Caller.SendAsync("Error", "TRANSFER_HOST_FAILED");
		}
	}

	/// <summary>
	/// The package this table plays: its pieces, its rule catalogue, its player range. Asked
	/// through the hub rather than by token over REST for one reason — a staged package lives in
	/// the PROCESS, and a table outlives processes. Only the game document knows where its board
	/// came from, so this re-stages it when it is no longer in memory, exactly as starting a match
	/// does. Without that, a table opened after a restart named every player's piece by its raw id
	/// and offered the host no rules.
	///
	/// Re-staging also puts the package's own translations and guide back within reach of the
	/// endpoints that serve them by token, so this is what the table asks FIRST.
	/// </summary>
	public async Task<PackageUploadResponse?> GetTablePackage()
	{
		if (!IsConnectionAuthenticated(out _, out var gameId))
		{
			await Clients.Caller.SendAsync("Error", "NOT_AUTHENTICATED");
			return null;
		}

		var game = await _gameRepository.LoadGameAsync(gameId!);
		var token = game?.GameState?.PackageToken ?? game?.PackageToken;
		if (game is null || string.IsNullOrEmpty(token))
		{
			return null;
		}

		var definition = _packageStore.GetDefinition(token) ?? await _packageRestorer.ReStageAsync(game);
		return definition is null ? null : PackageSummaries.For(token, definition);
	}

	/// <summary>
	/// The host changes the board's house rules for the NEXT match, from the table. A table plays
	/// again and again, and a group that has just finished one game is exactly when it decides that
	/// auctions were a mistake — so the values it starts from must be editable while nothing is
	/// running. They are stored raw: the rule CATALOG belongs to the package, and start already
	/// applies these over its defaults through it (GameDefinitionAdapter.EffectiveSettings), so
	/// validating them twice here would only be a second place to get the rules wrong.
	/// </summary>
	public async Task SetTableRules(SetTableRulesRequest request)
	{
		try
		{
			if (request is null
				|| !LobbyInput.IsIdentifier(request.GameId)
				|| !LobbyInput.IsIdentifier(request.HostId))
			{
				await Clients.Caller.SendAsync("Error", "INVALID_LOBBY_REQUEST");
				return;
			}
			if (!IsConnectionAuthenticated(out var callerId, out var callerGameId)
				|| callerId != request.HostId
				|| callerGameId != request.GameId)
			{
				await Clients.Caller.SendAsync("Error", "HOST_ONLY");
				return;
			}

			var game = await _gameRepository.LoadGameAsync(request.GameId);
			if (game is null)
			{
				await Clients.Caller.SendAsync("Error", "GAME_NOT_FOUND");
				return;
			}
			if (game.HostId != request.HostId)
			{
				await Clients.Caller.SendAsync("Error", "HOST_ONLY");
				return;
			}
			// Mid-match the rules are already in effect; changing them under a live game would mean
			// two different rulebooks in one match.
			if (game.Status != GameStatus.WaitingForPlayers)
			{
				await Clients.Caller.SendAsync("Error", "GAME_ALREADY_STARTED");
				return;
			}

			var savedGame = await _gameRepository.UpdateGameAsync(game with { RuleValues = request.RuleValues });
			_registry.CacheDocument(game.GameId, savedGame);
			await Clients.Group($"lobby_{game.GameId}").SendAsync("LobbyUpdated", savedGame.Sanitized());
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in SetTableRules");
			await Clients.Caller.SendAsync("Error", "SET_TABLE_RULES_FAILED");
		}
	}

	/// <summary>Restore an authenticated waiting-room connection after a reload. A REST read can
	/// repaint the room, but only this authenticated hub join restores live lobby broadcasts.</summary>
	public async Task<GameDocument> ReconnectLobby(
		string gameId,
		string playerId,
		string playerSecretId)
	{
		if (!LobbyInput.IsIdentifier(gameId)
			|| !LobbyInput.IsIdentifier(playerId)
			|| !LobbyInput.IsIdentifier(playerSecretId))
		{
			throw new HubException("INVALID_LOBBY_REQUEST");
		}

		var game = await _gameRepository.LoadGameAsync(gameId)
			?? throw new HubException("GAME_NOT_FOUND");
		if (game.Status != GameStatus.WaitingForPlayers)
		{
			throw new HubException("GAME_ALREADY_STARTED");
		}
		var player = game.Players.FirstOrDefault(candidate => candidate.Id == playerId)
			?? throw new HubException("PLAYER_NOT_FOUND");
		if (player.PlayerSecretId != playerSecretId)
		{
			throw new HubException("INVALID_CREDENTIALS");
		}

		await Groups.AddToGroupAsync(Context.ConnectionId, $"lobby_{gameId}");
		_registry.MapConnectionToGame(Context.ConnectionId, gameId);
		_registry.AuthenticateConnection(Context.ConnectionId, playerId);
		_registry.MapLobbyConnection(Context.ConnectionId, gameId);
		return game.Sanitized();
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
				RejoinCode = playerRejoinCode,
				UserId = SignedInUserId()
			};

			var updatedPlayers = game.Players.ToList();
			updatedPlayers.Add(newPlayer);

			_logger?.LogDebug("JoinGameLobby: Updating game in DB...");
			var updatedGame = game with { Players = updatedPlayers };
			await _gameRepository.UpdateGameAsync(updatedGame);
			_logger?.LogDebug("JoinGameLobby: Game updated in DB");

			await Groups.AddToGroupAsync(Context.ConnectionId, $"lobby_{game.GameId}");
			_registry.MapConnectionToGame(Context.ConnectionId, game.GameId);
			_registry.AuthenticateConnection(Context.ConnectionId, playerId);
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

	/// <summary>
	/// Adopt into this account the seats this BROWSER can prove it holds.
	///
	/// Somebody who played for months before signing in has all of it in one browser's storage.
	/// Signing in should not mean starting again on the next device, so the seats come across —
	/// and from then on the account carries them.
	///
	/// THE PROOF IS THE SEAT'S OWN SECRET, sent back from where it was stored. That is the same
	/// credential every other authenticated call uses; a seat whose secret does not match is
	/// skipped in silence, because a caller guessing game ids learns nothing from the difference.
	///
	/// A seat that ALREADY belongs to an account is never taken. Adoption is for seats nobody has
	/// claimed, and moving one between accounts is the takeover this design refuses everywhere else.
	///
	/// Nothing is deleted from the browser. Its stored seat stays valid and keeps working signed
	/// out — this ADDS a way back, it does not replace one.
	/// </summary>
	public async Task<int> AdoptSeats(List<SeatAdoption> seats)
	{
		var userId = SignedInUserId();
		if (userId == null || seats == null || seats.Count == 0)
		{
			return 0;
		}

		var adopted = 0;
		foreach (var seat in seats.Take(MyTablesLimit))
		{
			try
			{
				// The flag is set INSIDE the mutation, because that is the only place that knows a
				// change was made. Reading the result afterwards cannot tell "I just took this" from
				// "this was already mine" — and since the lobby runs this on every load, that
				// difference is the one being counted: it would otherwise announce the same tables
				// as newly added, every single time.
				var took = false;
				await _registry.MutateDocumentAsync(seat.GameId, game =>
				{
					var player = game.Players.FirstOrDefault(p => p.Id == seat.PlayerId);
					// Unproven, already owned, or a bot's chair: not ours to take.
					if (player is null
						|| player.PlayerSecretId != seat.PlayerSecretId
						|| player.UserId != null)
					{
						return null;
					}

					took = true;
					return game with
					{
						Players = game.Players
							.Select(p => p.Id == seat.PlayerId ? p with { UserId = userId } : p)
							.ToList(),
					};
				});

				if (took)
				{
					adopted++;
				}
			}
			catch (Exception ex)
			{
				// One unreachable table must not cost the player the rest.
				_logger?.LogError(ex, "Could not adopt seat {PlayerId} in {GameId}", seat.PlayerId, seat.GameId);
			}
		}

		if (adopted > 0)
		{
			_logger?.LogInformation("Adopted {Count} browser-held seat(s) into account {UserId}", adopted, userId);
		}
		return adopted;
	}

	/// <summary>
	/// Take back the seat this account holds at a table, from a device that has never seen it.
	/// The account-less path asks for a code the player had to keep; this one asks for nothing,
	/// because the seat already knows whose it is.
	///
	/// The guards are the SAME ones (see RejoinService): the table must still be playable and
	/// nobody may be sitting on that seat right now, and the claim rotates the seat's secret, so
	/// an old browser still holding the previous one loses it. Signing in does not let you evict
	/// yourself from a seat you are actively using somewhere else.
	/// </summary>
	public async Task<SeatClaimedResponse> ClaimSeatAsAccount(string gameId)
	{
		var userId = SignedInUserId();
		if (userId == null)
		{
			// Not a lookup failure and not worth a distinct code: an anonymous caller has no seat
			// to claim, which is exactly what "no seat found" means.
			throw new HubException("GAME_NOT_FOUND");
		}

		RejoinService.ClaimResult result;
		try
		{
			result = await RejoinService.ClaimForUserAsync(
				gameId,
				userId,
				_gameRepository,
				id => _registry.ConnectedPlayerIds(id));
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in ClaimSeatAsAccount");
			throw new HubException("GAME_LOOKUP_ERROR");
		}

		if (result.Session == null)
		{
			throw new HubException(result.Error);
		}

		_registry.CacheDocument(result.Session.GameId, result.UpdatedGame!);
		_logger?.LogInformation("Seat {PlayerId} in game {GameId} reclaimed by its account",
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
			language = game.Language,
			contentLanguages = game.ContentLanguages,
			packageToken = game.PackageToken,
			teamCount = game.TeamCount, // null = individual play
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
	/// Team mode: the HOST places a player in a team (or back in the pool with a null
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
	/// Team mode: the HOST deals every player into the teams at random, in one move. The
	/// arrangement is decided HERE — a client-side shuffle would be a burst of independent
	/// requests that a player arriving mid-burst could leave half applied. The room gets the
	/// usual document broadcast plus a TeamsFilled event so every client speaks the result.
	/// </summary>
	public async Task FillTeamsAtRandom(FillTeamsRequest request)
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

			var placements = LobbyTeams.DealAtRandom(
				game.Players.Select(p => p.Id).ToList(),
				teamCount,
				game.MaxPlayers / teamCount,
				_random);

			var updatedGame = game with
			{
				Players = game.Players
					.Select(p => placements.TryGetValue(p.Id, out var team) ? p with { TeamIndex = team } : p)
					.ToList(),
			};
			var savedGame = await _gameRepository.UpdateGameAsync(updatedGame);

			var lobbyGroup = $"lobby_{game.GameId}";
			await Clients.Group(lobbyGroup).SendAsync("LobbyUpdated", savedGame.Sanitized());
			await Clients.Group(lobbyGroup).SendAsync("TeamsFilled", new { gameId = game.GameId });
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error in FillTeamsAtRandom");
			await Clients.Caller.SendAsync("Error", "FILL_TEAMS_FAILED");
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

			// Team mode: the table must be FULL and everyone placed in a team by the
			// host (equal sizes hold by construction: the count divides the exact player count).
			List<List<string>>? arrangedTeams = null;
			if (game.TeamCount is { } teamCount && teamCount >= 2)
			{
				var teamSize = game.MaxPlayers / teamCount;
				arrangedTeams = Enumerable.Range(0, teamCount)
					.Select(t => game.Players.Where(p => p.TeamIndex == t).Select(p => p.Id).ToList())
					.ToList();
				if (game.Players.Count != game.MaxPlayers || arrangedTeams.Any(t => t.Count != teamSize))
				{
					await Clients.Caller.SendAsync("Error", "TEAMS_INCOMPLETE");
					return;
				}
			}
			// A team-only family must reach the table fully seated into exactly its team count —
			// the lobby refused any other shape at creation, but a game restored from an older
			// document (or one whose teams were never filled) is caught here.
			if (GameFamilies.For(definition.Manifest.GameType).RequiredTeamCount is { } requiredTeams
				&& (game.TeamCount != requiredTeams || arrangedTeams?.Count != requiredTeams))
			{
				await Clients.Caller.SendAsync("Error", "TEAMS_INCOMPLETE");
				return;
			}

			// The effective settings: the host's chosen house-rule values (RuleValues) applied over the
			// package defaults, or the settings sent with the request. Computed the SAME way on restore.
			var settings = GameDefinitionAdapter.EffectiveSettings(game, definition);

			await gameService.InitializeFromDefinitionAsync(players, definition, lang: game.Language, settings: settings,
				raceTeams: game.RaceTeams,
				// Families whose rules live outside GameSettings (journey) apply these themselves.
				ruleValues: game.RuleValues,
				teams: arrangedTeams);
			if (gameService.GameState is { } packageState)
			{
				packageState.PackageToken = packageToken; // released with the table; the client's sound pack id
				packageState.VoiceChatEnabled = game.VoiceChatEnabled;
			}

			_registry.RegisterService(request.GameId, gameService);
			// Bot seats (if any) come alive: the driver observes from OUTSIDE the engine.
			_botDriver?.Attach(request.GameId, gameService);

			var updatedGame = game with
			{
				Status = GameStatus.Active,
				GameState = gameService.GameState,
				// Repairs a table created before the family was recorded, and keeps it truthful if
				// the board ever changes between matches.
				GameType = definition.Manifest.GameType,
				// The previous match's result stops being the news the moment there is a game to look
				// at instead. Kept only while the table is at rest.
				LastMatch = null,
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

				result.Add(ToSavedGameInfo(game));
			}
			catch (Exception ex)
			{
				_logger?.LogError(ex, "Error loading saved game info for {GameId}", gameId);
			}
		}

		return result;
	}

	/// <summary>
	/// Every table this ACCOUNT holds a seat at — the same shape as <see cref="GetGamesInfo"/>,
	/// answering a different question. That one enriches the ids a BROWSER remembers; this one
	/// asks who the player is, so their tables follow them to a device that has never seen them.
	///
	/// Takes no account parameter on purpose: the answer comes from the caller's own session (see
	/// GameHub.SignedInUserId). Anonymous gets an empty list rather than an error — not signing in
	/// is a normal state, not a failure, and the lobby simply has nothing extra to add.
	/// </summary>
	public async Task<List<SavedGameInfo>> GetMyTables()
	{
		var userId = SignedInUserId();
		if (userId == null)
		{
			return new List<SavedGameInfo>();
		}

		try
		{
			var games = await _gameRepository.GetGamesForUserAsync(userId, MyTablesLimit);
			// The seat this account holds is what the table was FOUND by, so say which it is: a
			// browser meeting this table for the first time has no other way to know.
			return games
				.Select(g => ToSavedGameInfo(g, g.Players.FirstOrDefault(p => p.UserId == userId)?.Id))
				.ToList();
		}
		catch (Exception ex)
		{
			_logger?.LogError(ex, "Error listing the tables of a signed-in player");
			// The account-less list still works, so a failure here costs a player nothing they
			// had before signing in.
			return new List<SavedGameInfo>();
		}
	}

	/// <summary>
	/// How a table describes itself to the lobby's list. Shared by the two doors that ask for
	/// one — the ids a browser remembers and the seats an account holds — so both describe a
	/// table the same way and a change lands on both at once.
	/// </summary>
	private SavedGameInfo ToSavedGameInfo(GameDocument game, string? yourPlayerId = null)
	{
		var connected = _registry.ConnectedPlayerIds(game.GameId);
		return new SavedGameInfo
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
			}).ToList(),
			YourPlayerId = yourPlayerId,
		};
	}

	/// <summary>How many of an account's tables the lobby lists. A cap, not a page: somebody with
	/// hundreds of old tables wants the recent ones, and the query is ordered by last activity.</summary>
	private const int MyTablesLimit = 50;

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

			// The same complete teardown scheduled retention uses — and the only path that still runs
			// it, now that a finished match retires instead of deleting: live state and persisters
			// stop first, Cosmos is deleted next, then an unshared uploaded blob is released.
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

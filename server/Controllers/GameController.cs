using CorroServer.Models;
using CorroServer.Services;
using Microsoft.AspNetCore.Mvc;

namespace CorroServer.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GameController : ControllerBase
{
	private readonly IGameRepository _gameRepository;
	private readonly ILogger<GameController> _logger;

	public GameController(IGameRepository gameRepository, ILogger<GameController> logger)
	{
		_gameRepository = gameRepository;
		_logger = logger;
	}

	/// <summary>
	/// Get game information by its ID
	/// </summary>
	[HttpGet("{gameId}")]
	public async Task<ActionResult<GameDocument>> GetGame(string gameId)
	{
		try
		{
			_logger.LogInformation("Getting game: {GameId}", gameId);

			var game = await _gameRepository.LoadGameAsync(gameId);

			if (game == null)
			{
				return NotFound("GAME_NOT_FOUND");
			}

			// NEVER return the raw document: it holds every player's credentials (secret
			// ids, re-entry codes) and this endpoint is unauthenticated.
			return Ok(game.Sanitized());
		}
		catch (Exception ex)
		{
			_logger.LogError(ex, "Error getting game: {GameId}", gameId);
			return StatusCode(500, "INTERNAL_SERVER_ERROR");
		}
	}

}

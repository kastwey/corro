using CorroServer.Models;
using CorroServer.Services.Rules;

namespace CorroServer.Services;

/// <summary>
/// Factory for creating GameService instances with their dependencies.
/// </summary>
public class GameServiceFactory : IGameServiceFactory
{
	private readonly ICorroRulebook _rulebook;
	private readonly IAuctionRulebook _auctionRulebook;
	private readonly IRandomSource _randomSource;
	private readonly ILoggerFactory _loggerFactory;

	public GameServiceFactory(
		ICorroRulebook rulebook,
		IAuctionRulebook auctionRulebook,
		IRandomSource randomSource,
		ILoggerFactory loggerFactory)
	{
		_rulebook = rulebook;
		_auctionRulebook = auctionRulebook;
		// The one registered source: real randomness in production, the E2E scripted
		// (identity-shuffle) source under the test environment.
		_randomSource = randomSource;
		_loggerFactory = loggerFactory;
	}

	public IGameService Create(string? gameId = null)
	{
		return new GameService(
			_rulebook,
			_auctionRulebook,
			gameId,
			_loggerFactory.CreateLogger<GameService>(),
			_randomSource
		);
	}
}

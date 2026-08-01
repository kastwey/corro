using CorroServer.Models;
using CorroServer.Models.Corro;
using CorroServer.Services.Corro.Families;

namespace CorroServer.Services.Corro;

/// <summary>
/// The public summary of a staged package — its token, rule catalogue, pieces, player range and
/// content languages. Shared by the two doors that hand it out: the REST controller (uploading or
/// staging a board for a NEW game) and the hub (a TABLE asking about the package it already
/// plays), so both describe a package the same way.
/// </summary>
public static class PackageSummaries
{
	public static PackageUploadResponse For(string token, GameDefinition definition)
	{
		var family = GameFamilies.For(definition.Manifest.GameType);
		return new()
		{
			Token = token,
			GameType = string.IsNullOrWhiteSpace(definition.Manifest.GameType) ? "property" : definition.Manifest.GameType,
			Name = new Dictionary<string, string>(definition.Manifest.Name),
			Settings = GameDefinitionAdapter.ToSettings(definition),
			RuleGroups = definition.Manifest.RuleGroups,
			HouseRules = definition.Manifest.HouseRules,
			Tokens = definition.Manifest.Tokens,
			MinPlayers = definition.Manifest.Players.Min,
			MaxPlayers = definition.Manifest.Players.Max,
			Seats = definition.RaceBoard?.Seats
				.Select(s => new LobbySeatInfo { Id = s.Id, Color = s.Color, NameKey = s.NameKey })
				.ToList() ?? new(),
			// The family answers both: no content languages unless it splits content by language,
			// and no required team count unless it plays only in teams.
			ContentLanguages = family.ContentLanguages(definition).ToList(),
			RequiredTeamCount = family.RequiredTeamCount,
			// The board's create-time notice key (if any). NOT the unlock code — that never leaves the server.
			Warning = definition.Manifest.Warning,
		};
	}
}

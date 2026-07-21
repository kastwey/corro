using CorroServer.Models;
using CorroServer.Models.Corro;

namespace CorroServer.Services.Rules;

/// <summary>
/// Pure rules of the "trivia" game family (Trivial Pursuit style): a hub-and-spoke wheel
/// walked with one piece per player. Stateless over (board, state) so every rule is
/// unit-testable without transport; the command layer owns dice, questions, judging and
/// announcements.
///
/// The board is a GRAPH built from the wheel parameters. Node ids:
///  * "C"        — the centre hub (start and, with all wedges, the finish);
///  * "S{i}.{j}" — interior square j (1..SpokeLength, from the centre outward) of spoke i (0..5);
///  * "R{k}"     — ring slot k (0..Ring.Count-1).
/// Spoke i joins the centre to the i-th wedge slot in ring order. Only the LANDING square
/// matters (the route is irrelevant), so movement returns the set of legal landing nodes for a
/// roll and the player chooses one. A single move never reverses over the edge it just crossed
/// (no immediate backtracking), but may turn at the centre (6-way) and the wedge junctions
/// (3-way) — so the centre doubles as a shortcut between spokes, exactly as in the tabletop game.
/// </summary>
public static class TriviaRulebook
{
	public const string Center = "C";

	public static string SpokeNode(int spoke, int index) => $"S{spoke}.{index}";
	public static string RingNode(int slot) => $"R{slot}";
	public static bool IsCenter(string node) => node == Center;

	private static (int Spoke, int Index) ParseSpoke(string node)
	{
		var body = node.Substring(1);
		var dot = body.IndexOf('.');
		return (int.Parse(body.Substring(0, dot)), int.Parse(body.Substring(dot + 1)));
	}

	private static int ParseRing(string node) => int.Parse(node.Substring(1));

	/// <summary>The ring slot indices that are wedges (category headquarters), in ring order.
	/// A valid board has exactly six, one per category.</summary>
	public static int[] WedgeRingIndices(TriviaBoardDef board)
	{
		var result = new List<int>();
		for (var k = 0; k < board.Ring.Count; k++)
		{
			if (board.Ring[k].Wedge)
			{
				result.Add(k);
			}
		}

		return result.ToArray();
	}

	/// <summary>The wheel as an adjacency graph, built fresh from the parameters.</summary>
	public static Dictionary<string, List<string>> BuildAdjacency(TriviaBoardDef board)
	{
		var adj = new Dictionary<string, List<string>>();

		void Link(string a, string b)
		{
			if (!adj.TryGetValue(a, out var list))
			{
				adj[a] = list = new List<string>();
			}

			if (!list.Contains(b))
			{
				list.Add(b);
			}
		}
		void Edge(string a, string b) { Link(a, b); Link(b, a); }

		var cats = TriviaCategories.Count;
		var len = board.SpokeLength;
		var n = board.Ring.Count;
		var wedgeIdx = WedgeRingIndices(board);

		for (var k = 0; k < n; k++)
		{
			Edge(RingNode(k), RingNode((k + 1) % n));
		}

		for (var i = 0; i < cats; i++)
		{
			Edge(Center, SpokeNode(i, 1));
			for (var j = 1; j < len; j++)
			{
				Edge(SpokeNode(i, j), SpokeNode(i, j + 1));
			}

			Edge(SpokeNode(i, len), RingNode(wedgeIdx[i]));
		}

		return adj;
	}

	/// <summary>Every node exactly <paramref name="rolled"/> steps from <paramref name="from"/>
	/// via a non-reversing walk. The starting node is excluded (a move must go somewhere).</summary>
	public static List<string> LegalLandings(TriviaBoardDef board, string from, int rolled)
	{
		var adj = BuildAdjacency(board);
		var results = new HashSet<string>();

		void Walk(string node, string? prev, int steps)
		{
			if (steps == 0) { results.Add(node); return; }
			if (!adj.TryGetValue(node, out var neighbours))
			{
				return;
			}

			foreach (var next in neighbours)
			{
				if (next == prev)
				{
					continue; // no immediate backtracking within one move
				}

				Walk(next, node, steps - 1);
			}
		}

		Walk(from, null, rolled);
		results.Remove(from);
		return results.OrderBy(x => x, StringComparer.Ordinal).ToList();
	}

	/// <summary>The category a landing on <paramref name="node"/> asks about. The centre is a
	/// wild square (returns -1). A spoke is MULTICOLOURED like the real board — each square asks
	/// its own category, cycling as (spoke + index) % 6; the destination wedge only lends the
	/// spoke its NAME ("the spoke toward Geography"), not its squares' colours.</summary>
	public static int CategoryOfNode(TriviaBoardDef board, string node)
	{
		if (IsCenter(node))
		{
			return -1;
		}

		if (node[0] == 'S') { var (i, j) = ParseSpoke(node); return (i + j) % TriviaCategories.Count; }
		if (node[0] == 'R')
		{
			return board.Ring[ParseRing(node)].Category;
		}

		throw new InvalidOperationException($"unknown trivia node '{node}'.");
	}

	/// <summary>True when the node is a category headquarters (a correct answer earns its wedge).</summary>
	public static bool IsWedge(TriviaBoardDef board, string node)
		=> node.Length > 0 && node[0] == 'R' && board.Ring[ParseRing(node)].Wedge;

	/// <summary>True when the node grants another roll regardless of the answer.</summary>
	public static bool IsRollAgain(TriviaBoardDef board, string node)
		=> node.Length > 0 && node[0] == 'R' && board.Ring[ParseRing(node)].RollAgain;

	/// <summary>The category earned by a correct answer on a wedge node.</summary>
	public static int WedgeCategory(TriviaBoardDef board, string node)
		=> board.Ring[ParseRing(node)].Category;

	/// <summary>Whether the player holds all six wedges (ready for the final at the centre).</summary>
	public static bool HasAllWedges(TriviaPlayerState player)
	{
		for (var c = 0; c < TriviaCategories.Count; c++)
		{
			if (!player.Wedges.Contains(c))
			{
				return false;
			}
		}

		return true;
	}

	/// <summary>The first category the player still lacks a wedge for, or -1 when none.</summary>
	public static int FirstMissingWedge(TriviaPlayerState player)
	{
		for (var c = 0; c < TriviaCategories.Count; c++)
		{
			if (!player.Wedges.Contains(c))
			{
				return c;
			}
		}

		return -1;
	}

	/// <summary>
	/// Who judges a question by <paramref name="activeId"/>, per the judge mode. Fixed: the chosen
	/// judge, unless they are the one answering (then it rotates). Rotating: the next non-retired
	/// player after the active one in seating order. Returns null when nobody else can judge
	/// (everyone else retired) — the caller then falls back to an auto adjudication.
	/// </summary>
	public static string? JudgeFor(
		IReadOnlyList<string> turnOrder, TriviaState state, string activeId, string? fixedJudgeId)
	{
		if (fixedJudgeId is { } fixedId
			&& fixedId != activeId
			&& state.Players.FirstOrDefault(p => p.PlayerId == fixedId)?.Retired != true)
		{
			return fixedId;
		}

		var start = 0;
		for (var idx = 0; idx < turnOrder.Count; idx++)
		{
			if (turnOrder[idx] == activeId) { start = idx; break; }
		}

		for (var step = 1; step <= turnOrder.Count; step++)
		{
			var candidate = turnOrder[(start + step) % turnOrder.Count];
			if (candidate == activeId)
			{
				continue;
			}

			if (state.Players.FirstOrDefault(p => p.PlayerId == candidate)?.Retired == true)
			{
				continue;
			}

			return candidate;
		}
		return null;
	}

	/// <summary>The next question of <paramref name="category"/> from the deck, advancing that
	/// category's cursor (wrapping when exhausted). Null only if the deck has no such question.</summary>
	public static TriviaQuestionDef? PickQuestion(
		IReadOnlyList<TriviaQuestionDef> deck, IList<int> cursors, int category)
	{
		var ofCategory = new List<TriviaQuestionDef>();
		foreach (var q in deck)
		{
			if (q.Category == category)
			{
				ofCategory.Add(q);
			}
		}

		if (ofCategory.Count == 0)
		{
			return null;
		}

		var cursor = cursors[category];
		var chosen = ofCategory[cursor % ofCategory.Count];
		cursors[category] = cursor + 1;
		return chosen;
	}

	/// <summary>Whether a normalised guess matches the question's accepted answers (typed mode).
	/// Normalisation: trimmed, lower-cased, accents stripped, punctuation and leading articles
	/// removed, inner whitespace collapsed.</summary>
	public static bool AnswerMatches(TriviaQuestionDef question, string guess)
	{
		var norm = Normalize(guess);
		if (norm.Length == 0)
		{
			return false;
		}

		if (Normalize(question.Answer) == norm)
		{
			return true;
		}

		foreach (var accepted in question.Accept)
		{
			if (Normalize(accepted) == norm)
			{
				return true;
			}
		}

		return false;
	}

	private static readonly string[] LeadingArticles = { "el ", "la ", "los ", "las ", "the ", "a ", "an " };

	private static string Normalize(string value)
	{
		var lowered = value.Trim().ToLowerInvariant();
		var decomposed = lowered.Normalize(System.Text.NormalizationForm.FormD);
		var sb = new System.Text.StringBuilder(decomposed.Length);
		foreach (var ch in decomposed)
		{
			var cat = System.Globalization.CharUnicodeInfo.GetUnicodeCategory(ch);
			if (cat == System.Globalization.UnicodeCategory.NonSpacingMark)
			{
				continue; // drop accents
			}

			if (char.IsLetterOrDigit(ch))
			{
				sb.Append(ch);
			}
			else if (char.IsWhiteSpace(ch))
			{
				sb.Append(' ');
			}
			// other punctuation dropped
		}
		var collapsed = string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
		foreach (var article in LeadingArticles)
		{
			if (collapsed.StartsWith(article, StringComparison.Ordinal))
			{
				return collapsed.Substring(article.Length);
			}
		}

		return collapsed;
	}

	/// <summary>Fresh per-player state for a new game (everyone at the centre, no wedges).</summary>
	public static TriviaState CreateInitialState(IEnumerable<string> playerIds)
		=> new()
		{
			Players = playerIds.Select(id => new TriviaPlayerState { PlayerId = id }).ToList(),
			CategoryCursors = Enumerable.Repeat(0, TriviaCategories.Count).ToList(),
		};
}

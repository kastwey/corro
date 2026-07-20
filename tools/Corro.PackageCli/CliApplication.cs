using System.Reflection;
using System.Text.Json;
using Corro.PackageSdk;

namespace Corro.PackageCli;

/// <summary>Dependency-free command-line front end for the Corro Package SDK.</summary>
public static class CliApplication
{
	public const int Success = 0;
	public const int InvalidPackage = 1;
	public const int InvalidArguments = 2;
	public const int InputOutputError = 3;

	private static readonly JsonSerializerOptions JsonOptions = new()
	{
		PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
		WriteIndented = true,
	};

	public static async Task<int> RunAsync(
		IReadOnlyList<string> arguments,
		TextWriter output,
		TextWriter error,
		CancellationToken cancellationToken = default)
	{
		ArgumentNullException.ThrowIfNull(arguments);
		ArgumentNullException.ThrowIfNull(output);
		ArgumentNullException.ThrowIfNull(error);

		if (arguments.Count == 0 || arguments[0] is "help" or "--help" or "-h")
		{
			await output.WriteAsync(HelpText);
			return Success;
		}

		if (arguments[0] is "--version" or "-v")
		{
			await output.WriteLineAsync(Version());
			return Success;
		}

		ParsedCommand command;
		try
		{
			command = Parse(arguments);
		}
		catch (ArgumentException exception)
		{
			await error.WriteLineAsync("Error: " + exception.Message);
			await error.WriteAsync(HelpText);
			return InvalidArguments;
		}

		var sdk = new PackageAuthoringService();
		try
		{
			return command.Name switch
			{
				"new" => await NewAsync(command, output, cancellationToken),
				"validate" => await ValidateAsync(sdk, command, output, cancellationToken),
				"inspect" => await InspectAsync(sdk, command, output, cancellationToken),
				"pack" => await PackAsync(sdk, command, output, cancellationToken),
				_ => InvalidArguments,
			};
		}
		catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
		{
			throw;
		}
		catch (Exception exception) when (exception is FileNotFoundException
			or DirectoryNotFoundException
			or UnauthorizedAccessException
			or IOException)
		{
			await WriteFailureAsync(command, exception.Message, InputOutputError, output, error);
			return InputOutputError;
		}
		catch (ArgumentException exception)
		{
			await WriteFailureAsync(command, exception.Message, InvalidArguments, output, error);
			return InvalidArguments;
		}
		catch (Exception exception)
		{
			await WriteFailureAsync(command, exception.Message, InvalidPackage, output, error);
			return InvalidPackage;
		}
	}

	private static async Task<int> NewAsync(
		ParsedCommand command,
		TextWriter output,
		CancellationToken cancellationToken)
	{
		var result = await new PackageTemplateService().CreateAsync(
			command.Family!,
			command.Path,
			command.TemplateOptions,
			cancellationToken);
		int? cardArtCount = result.Validation.Package?.Content.TryGetValue("cardIllustrations", out var illustrations) == true
			? illustrations
			: null;
		if (command.Json)
		{
			await WriteJsonAsync(output, new
			{
				command = command.Name,
				success = true,
				path = result.Path,
				family = result.Family,
				id = result.Id,
				names = result.Names,
				valid = result.Validation.IsValid,
				cardArt = cardArtCount is null ? null : new
				{
					convention = "cards/<card-id>.svg",
					examples = cardArtCount.Value,
				},
			});
		}
		else
		{
			await output.WriteLineAsync("CREATED: " + result.Path);
			await output.WriteLineAsync("Family: " + result.Family);
			await output.WriteLineAsync("Id: " + result.Id);
			await output.WriteLineAsync("Names: " + string.Join(
				"; ", result.Names.Select(pair => $"{pair.Key}={pair.Value}")));
			await output.WriteLineAsync("Validation: passed");
			if (cardArtCount is not null)
			{
				await output.WriteLineAsync(
					$"Card art: {cardArtCount} example at cards/<card-id>.svg; missing files use the neutral fallback.");
			}
			await output.WriteLineAsync($"Next: corro-package validate \"{result.Path}\"");
		}
		return Success;
	}

	private static async Task<int> ValidateAsync(
		PackageAuthoringService sdk,
		ParsedCommand command,
		TextWriter output,
		CancellationToken cancellationToken)
	{
		var result = await sdk.ValidateAsync(command.Path, cancellationToken);
		if (command.Json)
		{
			await WriteJsonAsync(output, new
			{
				command = command.Name,
				valid = result.IsValid,
				path = result.InputPath,
				package = result.Package,
				problems = result.Problems,
			});
		}
		else
		{
			await WriteValidationTextAsync(output, result, includeDetails: false);
		}
		return result.IsValid ? Success : InvalidPackage;
	}

	private static async Task<int> InspectAsync(
		PackageAuthoringService sdk,
		ParsedCommand command,
		TextWriter output,
		CancellationToken cancellationToken)
	{
		var result = await sdk.ValidateAsync(command.Path, cancellationToken);
		if (command.Json)
		{
			await WriteJsonAsync(output, new
			{
				command = command.Name,
				valid = result.IsValid,
				path = result.InputPath,
				package = result.Package,
				problems = result.Problems,
			});
		}
		else
		{
			await WriteValidationTextAsync(output, result, includeDetails: true);
		}
		return result.IsValid ? Success : InvalidPackage;
	}

	private static async Task<int> PackAsync(
		PackageAuthoringService sdk,
		ParsedCommand command,
		TextWriter output,
		CancellationToken cancellationToken)
	{
		var result = await sdk.PackAsync(command.Path, command.OutputPath, cancellationToken);
		if (command.Json)
		{
			await WriteJsonAsync(output, new
			{
				command = command.Name,
				success = result.Succeeded,
				outputPath = result.OutputPath,
				bytes = result.Bytes,
				sha256 = result.Sha256,
				package = result.Validation.Package,
				problems = result.Validation.Problems,
			});
		}
		else if (result.Succeeded)
		{
			await output.WriteLineAsync($"PACKED: {result.OutputPath}");
			await output.WriteLineAsync($"Bytes: {result.Bytes}");
			await output.WriteLineAsync($"SHA-256: {result.Sha256}");
		}
		else
		{
			await WriteValidationTextAsync(output, result.Validation, includeDetails: false);
			await output.WriteLineAsync("The archive was not created.");
		}
		return result.Succeeded ? Success : InvalidPackage;
	}

	private static async Task WriteValidationTextAsync(
		TextWriter output,
		PackageValidationResult result,
		bool includeDetails)
	{
		await output.WriteLineAsync(result.IsValid ? "VALID" : "INVALID");
		await output.WriteLineAsync("Path: " + result.InputPath);

		if (result.Package is { } package)
		{
			await output.WriteLineAsync($"Package: {package.Id}");
			await output.WriteLineAsync($"Family: {package.GameType}");
			if (includeDetails)
			{
				await output.WriteLineAsync("Names: " + string.Join(
					"; ", package.Names.Select(pair => $"{pair.Key}={pair.Value}")));
				await output.WriteLineAsync($"Version: {package.Version ?? "(not set)"}");
				await output.WriteLineAsync($"Engine: {package.EngineVersion ?? "(not set)"}");
				await output.WriteLineAsync($"Author: {package.Author ?? "(not set)"}");
				await output.WriteLineAsync($"Locales: {string.Join(", ", package.Locales)}");
				await output.WriteLineAsync($"Players: {package.MinPlayers}–{package.MaxPlayers}");
				await output.WriteLineAsync($"Tokens: {package.TokenCount}");
				await output.WriteLineAsync($"House rules: {package.HouseRuleCount}");
				await output.WriteLineAsync($"Hidden: {(package.Hidden ? "yes" : "no")}");
				await output.WriteLineAsync("Content:");
				foreach (var (name, count) in package.Content)
				{
					await output.WriteLineAsync($"  {name}: {count}");
				}
			}
		}

		if (result.Problems.Count > 0)
		{
			await output.WriteLineAsync("Problems:");
			foreach (var problem in result.Problems)
			{
				await output.WriteLineAsync("  - " + problem);
			}
		}
	}

	private static async Task WriteFailureAsync(
		ParsedCommand command,
		string message,
		int exitCode,
		TextWriter output,
		TextWriter error)
	{
		if (command.Json)
		{
			await WriteJsonAsync(output, new
			{
				command = command.Name,
				success = false,
				error = message,
				exitCode,
			});
		}
		else
		{
			await error.WriteLineAsync("Error: " + message);
		}
	}

	private static Task WriteJsonAsync(TextWriter output, object value)
		=> output.WriteLineAsync(JsonSerializer.Serialize(value, JsonOptions));

	private static ParsedCommand Parse(IReadOnlyList<string> arguments)
	{
		var name = arguments[0].ToLowerInvariant();
		if (name is not ("new" or "validate" or "inspect" or "pack"))
		{
			throw new ArgumentException($"Unknown command '{arguments[0]}'.");
		}

		var paths = new List<string>();
		var json = false;
		string? outputPath = null;
		string? id = null;
		string? nameEn = null;
		string? nameEs = null;
		string? author = null;
		for (var index = 1; index < arguments.Count; index++)
		{
			var argument = arguments[index];
			switch (argument)
			{
				case "--json":
					json = true;
					break;
				case "-o" or "--output":
					if (name != "pack")
					{
						throw new ArgumentException($"{argument} is only valid with the pack command.");
					}
					if (++index >= arguments.Count)
					{
						throw new ArgumentException($"{argument} requires a file path.");
					}
					outputPath = arguments[index];
					break;
				case "--id":
					id = ReadOptionValue(arguments, ref index, argument, name, "new");
					break;
				case "--name-en":
					nameEn = ReadOptionValue(arguments, ref index, argument, name, "new");
					break;
				case "--name-es":
					nameEs = ReadOptionValue(arguments, ref index, argument, name, "new");
					break;
				case "--author":
					author = ReadOptionValue(arguments, ref index, argument, name, "new");
					break;
				default:
					if (argument.StartsWith("-", StringComparison.Ordinal))
					{
						throw new ArgumentException($"Unknown option '{argument}'.");
					}
					paths.Add(argument);
					break;
			}
		}

		if (name == "new")
		{
			if (paths.Count != 2)
			{
				throw new ArgumentException("The new command requires a family and a destination folder.");
			}
			if (!PackageTemplateCatalog.IsSupported(paths[0]))
			{
				throw new ArgumentException(
					$"Unknown game family '{paths[0]}'. Supported families: {string.Join(", ", PackageTemplateCatalog.SupportedFamilies)}.");
			}
			return new ParsedCommand(
				name,
				paths[1],
				json,
				null,
				paths[0].ToLowerInvariant(),
				new PackageTemplateOptions { Id = id, NameEn = nameEn, NameEs = nameEs, Author = author });
		}

		if (paths.Count != 1)
		{
			throw new ArgumentException($"The {name} command requires exactly one package path.");
		}
		return new ParsedCommand(name, paths[0], json, outputPath, null, null);
	}

	private static string ReadOptionValue(
		IReadOnlyList<string> arguments,
		ref int index,
		string option,
		string command,
		string allowedCommand)
	{
		if (command != allowedCommand)
		{
			throw new ArgumentException($"{option} is only valid with the {allowedCommand} command.");
		}
		if (++index >= arguments.Count)
		{
			throw new ArgumentException($"{option} requires a value.");
		}
		return arguments[index];
	}

	private static string Version()
		=> typeof(CliApplication).Assembly
			.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
			?? typeof(CliApplication).Assembly.GetName().Version?.ToString()
			?? "unknown";

	private sealed record ParsedCommand(
		string Name,
		string Path,
		bool Json,
		string? OutputPath,
		string? Family,
		PackageTemplateOptions? TemplateOptions);

	private const string HelpText = """
Corro Package SDK

Usage:
	corro-package new      <family> <folder> [--id <id>] [--name-en <name>]
												 [--name-es <name>] [--author <name>] [--json]
  corro-package validate <folder-or-file.corro> [--json]
  corro-package inspect  <folder-or-file.corro> [--json]
  corro-package pack     <folder> [-o|--output <file.corro>] [--json]
  corro-package --version
  corro-package --help

Commands:
	new       Create and validate a neutral starter package for one game family.
  validate  Run the server's structural, family and content validation.
  inspect   Validate and print safe package metadata (unlock codes are never shown).
  pack      Validate, create a deterministic archive, reload it through the secure
            upload path, then atomically write the output file.

Exit codes:
  0  Success / valid package
  1  Invalid package
  2  Invalid arguments
  3  File system error

Card-bearing starters include one optional cards/<card-id>.svg example. The id matches
cards.json; omit the file to use Corro's neutral fallback.
""";
}

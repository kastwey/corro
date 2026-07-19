using System.IO.Compression;
using System.Security.Cryptography;
using CorroServer.Services.Corro;

namespace Corro.PackageSdk;

/// <summary>Creates reproducible, upload-compatible <c>.corro</c> archives.</summary>
internal static class PackageArchive
{
	private static readonly DateTimeOffset StableTimestamp =
		new(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);

	internal static async Task<(long Bytes, string Sha256)> CreateAsync(
		string sourceDirectory,
		string destination,
		CancellationToken cancellationToken)
	{
		var sourceRoot = Path.GetFullPath(sourceDirectory);
		var files = EnumerateFiles(sourceRoot)
			.Select(path => new ArchiveSource(path, ArchiveName(sourceRoot, path), new FileInfo(path).Length))
			.OrderBy(file => file.EntryName, StringComparer.Ordinal)
			.ToArray();

		ValidateLimits(files);

		var destinationDirectory = Path.GetDirectoryName(destination)
			?? throw new IOException($"Cannot determine output folder for '{destination}'.");
		Directory.CreateDirectory(destinationDirectory);
		var temporary = Path.Combine(destinationDirectory, $".{Path.GetFileName(destination)}.{Guid.NewGuid():N}.tmp");

		try
		{
			await using (var output = new FileStream(
				temporary,
				FileMode.CreateNew,
				FileAccess.Write,
				FileShare.None,
				bufferSize: 64 * 1024,
				useAsync: true))
			using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: false))
			{
				foreach (var file in files)
				{
					cancellationToken.ThrowIfCancellationRequested();
					var entry = archive.CreateEntry(file.EntryName, CompressionLevel.Optimal);
					entry.LastWriteTime = StableTimestamp;
					entry.ExternalAttributes = 0;
					await using var source = new FileStream(
						file.Path,
						FileMode.Open,
						FileAccess.Read,
						FileShare.Read,
						bufferSize: 64 * 1024,
						useAsync: true);
					await using var target = entry.Open();
					await source.CopyToAsync(target, cancellationToken);
				}
			}

			var bytes = new FileInfo(temporary).Length;
			if (bytes > CorroPackageLoader.MaxUploadBytes)
			{
				throw new InvalidOperationException(
					$"Packed archive is {bytes} bytes; the upload limit is {CorroPackageLoader.MaxUploadBytes} bytes.");
			}

			var hash = await Sha256Async(temporary, cancellationToken);
			File.Move(temporary, destination, overwrite: true);
			return (bytes, hash);
		}
		finally
		{
			if (File.Exists(temporary))
			{
				File.Delete(temporary);
			}
		}
	}

	private static IEnumerable<string> EnumerateFiles(string sourceRoot)
	{
		var pending = new Stack<string>();
		pending.Push(sourceRoot);
		var options = new EnumerationOptions
		{
			RecurseSubdirectories = false,
			IgnoreInaccessible = false,
			ReturnSpecialDirectories = false,
			AttributesToSkip = 0,
		};

		while (pending.TryPop(out var directory))
		{
			foreach (var path in Directory.EnumerateFileSystemEntries(directory, "*", options))
			{
				var attributes = File.GetAttributes(path);
				if ((attributes & FileAttributes.ReparsePoint) != 0)
				{
					throw new InvalidOperationException(
						$"Package contains a symbolic link or reparse point, which cannot be packed safely: '{path}'.");
				}

				if ((attributes & FileAttributes.Directory) != 0)
				{
					pending.Push(path);
				}
				else
				{
					yield return path;
				}
			}
		}
	}

	private static string ArchiveName(string sourceRoot, string path)
	{
		var relative = Path.GetRelativePath(sourceRoot, path);
		if (Path.IsPathRooted(relative)
			|| relative == ".."
			|| relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
		{
			throw new InvalidOperationException($"Package file escapes its source folder: '{path}'.");
		}

		return relative.Replace(Path.DirectorySeparatorChar, '/');
	}

	private static void ValidateLimits(IReadOnlyCollection<ArchiveSource> files)
	{
		if (files.Count > CorroPackageLoader.MaxZipEntries)
		{
			throw new InvalidOperationException(
				$"Package contains too many files ({files.Count}; maximum {CorroPackageLoader.MaxZipEntries}).");
		}

		long total = 0;
		foreach (var file in files)
		{
			if (file.Length > CorroPackageLoader.MaxEntryUncompressedBytes)
			{
				throw new InvalidOperationException(
					$"Package file '{file.EntryName}' is too large (maximum {CorroPackageLoader.MaxEntryUncompressedBytes} bytes).");
			}

			checked
			{
				total += file.Length;
			}
			if (total > CorroPackageLoader.MaxTotalUncompressedBytes)
			{
				throw new InvalidOperationException(
					$"Package expands beyond the {CorroPackageLoader.MaxTotalUncompressedBytes}-byte limit.");
			}
		}
	}

	private static async Task<string> Sha256Async(string path, CancellationToken cancellationToken)
	{
		await using var stream = new FileStream(
			path,
			FileMode.Open,
			FileAccess.Read,
			FileShare.Read,
			bufferSize: 64 * 1024,
			useAsync: true);
		var digest = await SHA256.HashDataAsync(stream, cancellationToken);
		return Convert.ToHexStringLower(digest);
	}

	private sealed record ArchiveSource(string Path, string EntryName, long Length);
}

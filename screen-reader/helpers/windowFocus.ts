// helpers/windowFocus.ts — put the browser window in the foreground before NVDA is asked about it.
//
// Guidepup's `navigateToWebContent` finds the browser by asking NVDA for the title of the active
// window and, when it is not the browser, pressing Alt+Escape to try the next window — ten times.
// On a developer's desktop that is not enough: a machine with Outlook, Edge, a dozen terminals,
// editors and the Claude app open has more than ten windows, and the suite failed on every test
// before pressing a single key in the page ("Unable to focus the application window ... after 10
// attempts"). A CI runner has nothing else open and never hits this, which is why it only showed
// up locally.
//
// So the window is brought to the front HERE, by title, before Guidepup looks: the same
// user32 calls Guidepup's own `windowsActivate` makes, without the part that would launch a second
// browser. `page.bringToFront()` is not enough on its own: it raises the tab inside Playwright's
// browser, not the browser window above the other applications.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The PowerShell that finds the first process whose main window title contains the fragment,
 * restores it if minimised and makes it the foreground window. The fragment travels in an
 * environment variable rather than in the script text, so no title can break out of the quoting.
 */
const FOREGROUND_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace CorroScreenReader -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
'@
$fragment = $env:CORRO_WINDOW_TITLE
$process = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$fragment*" } | Select-Object -First 1
if (-not $process) { Write-Output 'not-found'; exit 0 }
$shell = New-Object -ComObject WScript.Shell
[void]$shell.AppActivate($process.Id)
[void][CorroScreenReader.Native]::ShowWindow($process.MainWindowHandle, 9)
[void][CorroScreenReader.Native]::SetForegroundWindow($process.MainWindowHandle)
Write-Output 'activated'
`;

/**
 * Bring the window whose title contains `titleFragment` to the foreground. Resolves to whether a
 * window was found; a miss is reported, not thrown, so Guidepup's own search still gets its turn.
 * Does nothing anywhere but Windows, where NVDA is the only screen reader this suite drives.
 */
export async function bringWindowToFront(titleFragment: string): Promise<boolean> {
	if (process.platform !== 'win32') return false;
	const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', FOREGROUND_SCRIPT], {
		env: { ...process.env, CORRO_WINDOW_TITLE: titleFragment },
		windowsHide: true,
	});
	return stdout.trim() === 'activated';
}

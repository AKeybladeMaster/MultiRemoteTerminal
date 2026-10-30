param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('cancel-consent', 'cancel-save', 'save', 'close-app', 'cancel-credential-export', 'export-credential', 'cancel-credential-import', 'import-credential', 'cancel-logo', 'select-logo', 'cancel-local-text', 'select-local-text')]
    [string] $Action,
    [string] $FilePath = '',
    [int] $TargetProcessId = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class MrtNativeDialog {
    public delegate bool WindowCallback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern bool SetWindowText(IntPtr window, string text);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attach, uint attachTo, bool shouldAttach);
    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr window);
    public static bool ActivateWindow(IntPtr window) {
        if (GetForegroundWindow() == window) return true;
        uint currentThread = GetCurrentThreadId();
        uint targetProcess;
        uint targetThread = GetWindowThreadProcessId(window, out targetProcess);
        uint foregroundProcess;
        uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundProcess);
        bool attachedForeground = foregroundThread != 0 && foregroundThread != currentThread &&
            AttachThreadInput(currentThread, foregroundThread, true);
        bool attachedTarget = targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread &&
            AttachThreadInput(currentThread, targetThread, true);
        try {
            BringWindowToTop(window);
            SetForegroundWindow(window);
            SetActiveWindow(window);
            SetFocus(window);
            return GetForegroundWindow() == window;
        } finally {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }
    public static IntPtr FindTopLevelWindow(string expectedTitle, int expectedProcessId) {
        IntPtr result = IntPtr.Zero;
        WindowCallback callback = (window, parameter) => {
            if (!IsWindowVisible(window)) return true;
            var title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if ((expectedProcessId == 0 || processId == expectedProcessId) &&
                String.Equals(title.ToString(), expectedTitle, StringComparison.Ordinal)) {
                result = window;
                return false;
            }
            return true;
        };
        EnumWindows(callback, IntPtr.Zero);
        return result;
    }
}
"@

function Wait-Dialog([string] $title, [int] $timeoutSeconds = 20, [int] $processId = 0) {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    do {
        $window = [MrtNativeDialog]::FindTopLevelWindow($title, $processId)
        if ($window -ne [IntPtr]::Zero) { return $window }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting for native dialog '$title'."
}

function Wait-DialogClosed([string] $title, [int] $timeoutSeconds = 10, [int] $processId = 0) {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    do {
        if ([MrtNativeDialog]::FindTopLevelWindow($title, $processId) -eq [IntPtr]::Zero) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Native dialog '$title' did not close."
}

function Focus-Dialog([IntPtr] $dialog) {
    $deadline = [DateTime]::UtcNow.AddSeconds(2)
    do {
        if ([MrtNativeDialog]::ActivateWindow($dialog)) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Could not focus the native SSH log dialog.'
}

function Send-DialogKeys([IntPtr] $dialog, [string] $keys) {
    Focus-Dialog $dialog
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait($keys)
}

function Set-DialogFilename([IntPtr] $dialog, [string] $filePath) {
    Focus-Dialog $dialog
    [System.Windows.Forms.SendKeys]::SendWait('%n')
    Start-Sleep -Milliseconds 100
    $field = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $field -or $field.Current.ClassName -notin @('Edit', 'ComboBox')) {
        throw 'Could not focus the native dialog filename field.'
    }
    try { $valuePattern = [System.Windows.Automation.ValuePattern]$field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) }
    catch { throw 'The native dialog filename field does not support safe value selection.' }
    $valuePattern.SetValue($filePath)
    if ($valuePattern.Current.Value -cne $filePath) { throw 'The native dialog filename field did not retain the selected path.' }
}

if ($Action -like '*credential-*' -or $Action -eq 'export-credential' -or $Action -eq 'import-credential') {
    $isExport = $Action -in @('cancel-credential-export', 'export-credential')
    $title = if ($isExport) { 'Export encrypted SSH credentials' } else { 'Import encrypted SSH credentials' }
    $credentialDialog = Wait-Dialog $title
    if ($Action.StartsWith('cancel-')) {
        Send-DialogKeys $credentialDialog '{ESC}'
        Wait-DialogClosed $title
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($FilePath) -or [IO.Path]::GetExtension($FilePath) -ne '.mrtcred') {
        throw 'A full .mrtcred path is required for native credential bundle selection.'
    }
    Set-DialogFilename $credentialDialog $FilePath
    Send-DialogKeys $credentialDialog '{ENTER}'
    Wait-DialogClosed $title
    if ($isExport) {
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        do {
            if (Test-Path -LiteralPath $FilePath -PathType Leaf) { exit 0 }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $deadline)
        throw 'The native Save dialog closed without creating the selected credential bundle.'
    }
    exit 0
}

if ($Action -in @('cancel-local-text', 'select-local-text')) {
    $title = 'Choose a local text file'
    $localTextDialog = Wait-Dialog $title
    if ($Action -eq 'cancel-local-text') {
        Send-DialogKeys $localTextDialog '{ESC}'
        Wait-DialogClosed $title
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($FilePath) -or [IO.Path]::GetExtension($FilePath) -ne '.txt') {
        throw 'A full .txt path is required for native local text file selection.'
    }
    Set-DialogFilename $localTextDialog $FilePath
    Send-DialogKeys $localTextDialog '{ENTER}'
    Wait-DialogClosed $title
    exit 0
}

if ($Action -in @('cancel-logo', 'select-logo')) {
    $title = 'Choose a PNG logo'
    $logoDialog = Wait-Dialog $title
    if ($Action -eq 'cancel-logo') {
        Send-DialogKeys $logoDialog '{ESC}'
        Wait-DialogClosed $title
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($FilePath) -or [IO.Path]::GetExtension($FilePath) -ne '.png') {
        throw 'A full .png path is required for native logo selection.'
    }
    Set-DialogFilename $logoDialog $FilePath
    Send-DialogKeys $logoDialog '{ENTER}'
    Wait-DialogClosed $title
    exit 0
}

if ($Action -eq 'close-app') {
    if ($TargetProcessId -lt 1) { throw 'A target app process ID is required.' }
    $appWindow = Wait-Dialog 'MultiRemoteTerminal' 20 $TargetProcessId
    if (-not [MrtNativeDialog]::PostMessage($appWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
        throw 'Could not close the packaged app window.'
    }
    Wait-DialogClosed 'MultiRemoteTerminal' 10 $TargetProcessId
    exit 0
}

$consent = Wait-Dialog 'Sensitive SSH session log'
if ($Action -eq 'cancel-consent') {
    Send-DialogKeys $consent '{ENTER}'
    Wait-DialogClosed 'Sensitive SSH session log'
    exit 0
}

Send-DialogKeys $consent '{LEFT}{ENTER}'
Wait-DialogClosed 'Sensitive SSH session log'
$saveDialog = Wait-Dialog 'Save sensitive SSH session log'
if ($Action -eq 'cancel-save') {
    Send-DialogKeys $saveDialog '{ESC}'
    Wait-DialogClosed 'Save sensitive SSH session log'
    exit 0
}

if ([string]::IsNullOrWhiteSpace($FilePath) -or [IO.Path]::GetExtension($FilePath) -ne '.log') {
    throw 'A full .log path is required for native Save dialog selection.'
}
Set-DialogFilename $saveDialog $FilePath
Send-DialogKeys $saveDialog '{ENTER}'
Wait-DialogClosed 'Save sensitive SSH session log'

$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
    if (Test-Path -LiteralPath $FilePath -PathType Leaf) { exit 0 }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
throw 'The native Save dialog closed without creating the selected log file.'

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('cancel-consent', 'cancel-save', 'save', 'close-app', 'submit-ssh-credential', 'cancel-credential-export', 'export-credential', 'cancel-credential-import', 'import-credential', 'cancel-logo', 'select-logo', 'cancel-local-text', 'select-local-text', 'cancel-transfer-folder', 'select-transfer-folder', 'cancel-remote-forward', 'accept-remote-forward', 'cancel-public-tunnel', 'accept-public-tunnel', 'write-clipboard')]
    [string] $Action,
    [string] $FilePath = '',
    [int] $TargetProcessId = 0,
    [ValidateSet('ssh-password', 'socks-account')]
    [string] $CredentialPurpose = 'ssh-password'
)

$ErrorActionPreference = 'Stop'
$credentialPromptMessage = if ($CredentialPurpose -eq 'socks-account') {
    'Choose a separate local SOCKS proxy username and password for this tunnel start.'
} else { 'Enter the SSH account credential.' }
Add-Type -AssemblyName System.Windows.Forms
if ($Action -eq 'write-clipboard') {
    $reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
    $clipboardText = $reader.ReadToEnd()
    if ($clipboardText.Length -lt 1 -or $clipboardText.Length -gt 16384 -or $clipboardText.Contains([char]0)) {
        $clipboardText = $null
        throw 'The Windows clipboard fixture is empty, oversized, or invalid.'
    }
    $clipboardFailure = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            [System.Windows.Forms.Clipboard]::SetText($clipboardText, [System.Windows.Forms.TextDataFormat]::UnicodeText)
            $clipboardFailure = $null
            break
        } catch [System.Runtime.InteropServices.ExternalException] {
            $clipboardFailure = $_
            Start-Sleep -Milliseconds 50
        }
    }
    $clipboardText = $null
    if ($clipboardFailure) { throw $clipboardFailure }
    exit 0
}
if ($TargetProcessId -lt 1) { throw 'Native dialog automation requires the target app process ID.' }
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
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maxCount);
    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, WindowCallback callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")]
    private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")]
    private static extern IntPtr GetDlgItem(IntPtr window, int controlId);
    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr window);
    private const int BM_CLICK = 0x00F5;
    public static IntPtr GetDialogControl(IntPtr dialog, int controlId) {
        return GetDlgItem(dialog, controlId);
    }
    public static bool IsEnabledDialogButton(IntPtr dialog, int controlId) {
        IntPtr button = GetDlgItem(dialog, controlId);
        if (button == IntPtr.Zero || GetParent(button) != dialog || !IsWindowVisible(button) || !IsWindowEnabled(button)) return false;
        var className = new StringBuilder(128);
        GetClassName(button, className, className.Capacity);
        return String.Equals(className.ToString(), "Button", StringComparison.Ordinal);
    }
    public static string DescribeChildControls(IntPtr dialog) {
        var summary = new StringBuilder();
        WindowCallback callback = (child, parameter) => {
            var className = new StringBuilder(128);
            GetClassName(child, className, className.Capacity);
            var text = new StringBuilder(256);
            string classValue = className.ToString();
            if (String.Equals(classValue, "Button", StringComparison.Ordinal) ||
                String.Equals(classValue, "Static", StringComparison.Ordinal) ||
                String.Equals(classValue, "Edit", StringComparison.Ordinal)) {
                GetWindowText(child, text, text.Capacity);
            }
            IntPtr parent = GetParent(child);
            var parentClass = new StringBuilder(128);
            if (parent != IntPtr.Zero) GetClassName(parent, parentClass, parentClass.Capacity);
            summary.Append(GetDlgCtrlID(child)).Append(":").Append(classValue)
                .Append("='").Append(text.ToString()).Append("' visible=").Append(IsWindowVisible(child))
                .Append(" enabled=").Append(IsWindowEnabled(child)).Append(" parent=")
                .Append(parentClass.ToString()).Append(":").Append(GetDlgCtrlID(parent)).Append("; ");
            return true;
        };
        EnumChildWindows(dialog, callback, IntPtr.Zero);
        return summary.ToString();
    }
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr GetActiveWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr GetFocus();
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
    public static bool FocusDialogControl(IntPtr dialog, IntPtr control) {
        if (control == IntPtr.Zero || !IsChild(dialog, control)) return false;
        uint currentThread = GetCurrentThreadId();
        uint targetProcess;
        uint targetThread = GetWindowThreadProcessId(dialog, out targetProcess);
        bool attached = targetThread != 0 && targetThread != currentThread && AttachThreadInput(currentThread, targetThread, true);
        try {
            BringWindowToTop(dialog);
            SetForegroundWindow(dialog);
            SetActiveWindow(dialog);
            SetFocus(control);
            return GetFocus() == control;
        } finally {
            if (attached) AttachThreadInput(currentThread, targetThread, false);
        }
    }
    public static bool PostEnabledDialogButtonClick(IntPtr dialog, int controlId) {
        if (!IsEnabledDialogButton(dialog, controlId)) return false;
        IntPtr button = GetDlgItem(dialog, controlId);
        return PostMessage(button, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
    }
    public static bool ClickEnabledDialogButtonByName(IntPtr dialog, string[] expectedNames) {
        IntPtr button = IntPtr.Zero;
        bool ambiguous = false;
        WindowCallback callback = (child, parameter) => {
            if (!IsWindowVisible(child) || !IsWindowEnabled(child)) return true;
            var className = new StringBuilder(128);
            GetClassName(child, className, className.Capacity);
            if (!String.Equals(className.ToString(), "Button", StringComparison.Ordinal)) return true;
            var text = new StringBuilder(256);
            GetWindowText(child, text, text.Capacity);
            if (Array.IndexOf(expectedNames, text.ToString().Replace("&", "")) < 0) return true;
            if (button != IntPtr.Zero) { ambiguous = true; return false; }
            button = child;
            return true;
        };
        EnumChildWindows(dialog, callback, IntPtr.Zero);
        if (ambiguous || button == IntPtr.Zero) return false;
        return PostMessage(button, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
    }
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
        bool active;
        try {
            BringWindowToTop(window);
            SetForegroundWindow(window);
            SetActiveWindow(window);
            SetFocus(window);
            active = GetActiveWindow() == window;
            return active || GetForegroundWindow() == window;
        } finally {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }
    public static IntPtr FindTopLevelWindow(string expectedTitle, int[] expectedProcessIds) {
        IntPtr result = IntPtr.Zero;
        WindowCallback callback = (window, parameter) => {
            if (!IsWindowVisible(window)) return true;
            var title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if ((expectedProcessIds == null || expectedProcessIds.Length == 0 || Array.IndexOf(expectedProcessIds, (int)processId) >= 0) &&
                String.Equals(title.ToString(), expectedTitle, StringComparison.Ordinal)) {
                result = window;
                return false;
            }
            return true;
        };
        EnumWindows(callback, IntPtr.Zero);
        return result;
    }
    public static IntPtr FindTopLevelWindowByButton(string[] expectedNames, int[] expectedProcessIds) {
        IntPtr result = IntPtr.Zero;
        WindowCallback callback = (window, parameter) => {
            if (!IsWindowVisible(window)) return true;
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (expectedProcessIds == null || Array.IndexOf(expectedProcessIds, (int)processId) < 0) return true;
            bool found = false;
            WindowCallback childCallback = (child, childParameter) => {
                if (!IsWindowVisible(child) || !IsWindowEnabled(child)) return true;
                var className = new StringBuilder(128);
                GetClassName(child, className, className.Capacity);
                if (!String.Equals(className.ToString(), "Button", StringComparison.Ordinal)) return true;
                var text = new StringBuilder(256);
                GetWindowText(child, text, text.Capacity);
                if (Array.IndexOf(expectedNames, text.ToString().Replace("&", "")) < 0) return true;
                found = true;
                return false;
            };
            EnumChildWindows(window, childCallback, IntPtr.Zero);
            if (!found) return true;
            result = window;
            return false;
        };
        EnumWindows(callback, IntPtr.Zero);
        return result;
    }
}
"@

function Wait-Dialog([string] $title, [int] $timeoutSeconds = 20, [int] $processId = 0, [string[]] $buttonNames = @()) {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    $targetProcessIds = if ($processId -gt 0) { Get-TargetProcessIds $processId } else { $null }
    do {
        $window = [MrtNativeDialog]::FindTopLevelWindow($title, $targetProcessIds)
        if ($window -eq [IntPtr]::Zero -and $buttonNames.Count -gt 0) {
            $window = [MrtNativeDialog]::FindTopLevelWindowByButton($buttonNames, $targetProcessIds)
        }
        if ($window -ne [IntPtr]::Zero) { return $window }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting for native dialog '$title'."
}

function Wait-DialogClosed([string] $title, [int] $timeoutSeconds = 10, [int] $processId = 0) {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    $targetProcessIds = if ($processId -gt 0) { Get-TargetProcessIds $processId } else { $null }
    do {
        $window = [MrtNativeDialog]::FindTopLevelWindow($title, $targetProcessIds)
        if ($window -eq [IntPtr]::Zero) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Native dialog '$title' did not close. Controls: $(Get-DialogAutomationSummary $window)"
}

function Focus-Dialog([IntPtr] $dialog) {
    $deadline = [DateTime]::UtcNow.AddSeconds(2)
    do {
        if ([MrtNativeDialog]::ActivateWindow($dialog)) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Could not activate the native dialog.'
}

function Focus-DialogElement([IntPtr] $dialog, [System.Windows.Automation.AutomationElement] $element) {
    $deadline = [DateTime]::UtcNow.AddSeconds(2)
    do {
        $element.SetFocus()
        if ($element.Current.HasKeyboardFocus) { return }
        Focus-Dialog $dialog
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Could not focus the requested native dialog field.'
}

function Get-DialogAutomationSummary([IntPtr] $dialog) {
    try {
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($dialog)
        $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition)
        $summary = foreach ($element in $elements) {
            try {
                $control = $element.Current
                if ($control.ControlType.ProgrammaticName -in @('ControlType.Edit', 'ControlType.ComboBox', 'ControlType.Button',
                    'ControlType.Text') -and $control.ClassName -ne 'UIProperty') {
                    '{0} id="{1}" name="{2}" class="{3}" hwnd={4} enabled={5}' -f $control.ControlType.ProgrammaticName,
                        $control.AutomationId, $control.Name, $control.ClassName, $control.NativeWindowHandle, $control.IsEnabled
                }
            } catch { }
        }
        $shown = @($summary | Select-Object -First 80)
        $uiAutomation = if ($shown.Count -eq 0) { '<no editable controls, buttons, or text exposed>' } else { $shown -join '; ' }
        return "UIA: $uiAutomation; Win32: $([MrtNativeDialog]::DescribeChildControls($dialog))"
    } catch {
        return "UI Automation unavailable: $($_.Exception.Message)"
    }
}

function Invoke-DialogButton([IntPtr] $dialog, [string[]] $acceptedNames, [int] $controlId = 0) {
    if ($controlId -gt 0) {
        $nativeHandle = [MrtNativeDialog]::GetDialogControl($dialog, $controlId)
        if ($nativeHandle -ne [IntPtr]::Zero) {
            if ([MrtNativeDialog]::PostEnabledDialogButtonClick($dialog, $controlId)) { return }
        }
    }
    if ([MrtNativeDialog]::ClickEnabledDialogButtonByName($dialog, $acceptedNames)) { return }
    throw "The native dialog action was not invoked. Control ID $controlId and button names '$($acceptedNames -join ', ')' were not available. Win32: $([MrtNativeDialog]::DescribeChildControls($dialog))"
}

function Get-TargetProcessIds([int] $rootProcessId) {
    $processes = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId)
    $processIds = @{}
    $processIds[[string]$rootProcessId] = $true
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $processes) {
            $childProcessId = [int]$process.ProcessId
            if ($processIds.ContainsKey([string]$process.ParentProcessId) -and -not $processIds.ContainsKey([string]$childProcessId)) {
                $processIds[[string]$childProcessId] = $true
                $changed = $true
            }
        }
    }
    return ,@($processIds.Keys | ForEach-Object { [int]$_ })
}

function Find-SshCredentialWindow([int[]] $targetProcessIds) {
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($window in $windows) {
        try {
            if ($targetProcessIds -notcontains [int]$window.Current.ProcessId) { continue }
            $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition)
        } catch { continue }
        foreach ($element in $elements) {
            try {
                $name = $element.Current.Name
                if (-not [string]::IsNullOrEmpty($name) -and $name.Contains($credentialPromptMessage)) { return $window }
            } catch { }
        }
    }
    return $null
}

function Wait-SshCredentialWindow([int] $rootProcessId, [int] $timeoutSeconds = 20) {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    do {
        $targetProcessIds = Get-TargetProcessIds $rootProcessId
        $window = Find-SshCredentialWindow $targetProcessIds
        if ($null -ne $window) { return $window }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Timed out waiting for the native SSH credential prompt.'
}

function Wait-SshCredentialWindowClosed([int[]] $targetProcessIds, [int] $timeoutSeconds = 10) {
    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    do {
        if ($null -eq (Find-SshCredentialWindow $targetProcessIds)) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The native SSH credential prompt did not close.'
}

if ($Action -eq 'submit-ssh-credential') {
    try { $fixturePayload = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd()) }
    catch { throw 'Could not read the native SSH credential fixture input.' }
    $username = [string]$fixturePayload.username
    $password = [string]$fixturePayload.password
    $fixturePayload = $null
    if ($TargetProcessId -lt 1 -or $username -notmatch '^[A-Za-z0-9]+$' -or $username.Length -gt 256 -or
        $password -notmatch '^[A-Za-z0-9]+$' -or $password.Length -gt 256) {
        throw 'The native SSH credential fixture input is invalid.'
    }

    try {
        $credentialWindow = Wait-SshCredentialWindow $TargetProcessId
        $targetProcessIds = Get-TargetProcessIds $TargetProcessId
        $editCondition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
        $fields = $credentialWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
        $usernameField = $null
        $passwordField = $null
        foreach ($field in $fields) {
            if ($field.Current.IsPassword) { $passwordField = $field }
            elseif ($null -eq $usernameField) { $usernameField = $field }
        }
        if ($null -eq $usernameField -or $null -eq $passwordField) {
            throw 'The native SSH credential prompt did not expose username and password fields.'
        }

        Focus-Dialog ([IntPtr]$credentialWindow.Current.NativeWindowHandle)
        try {
            $usernameValue = $usernameField.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $usernameValue.SetValue($username)
            if ($usernameValue.Current.Value -cne $username) { throw 'The native SSH credential prompt did not accept the fixture username.' }
        } catch {
            Focus-DialogElement ([IntPtr]$credentialWindow.Current.NativeWindowHandle) $usernameField
            [System.Windows.Forms.SendKeys]::SendWait('^a')
            [System.Windows.Forms.SendKeys]::SendWait($username)
        }
        Focus-DialogElement ([IntPtr]$credentialWindow.Current.NativeWindowHandle) $passwordField
        [System.Windows.Forms.SendKeys]::SendWait($password)
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
        Wait-SshCredentialWindowClosed $targetProcessIds
    } finally {
        $username = $null
        $password = $null
        $credentialWindow = $null
        $targetProcessIds = $null
        $fields = $null
        $usernameField = $null
        $passwordField = $null
    }
    exit 0
}

if ($Action -like '*credential-*' -or $Action -eq 'export-credential' -or $Action -eq 'import-credential') {
    $isExport = $Action -in @('cancel-credential-export', 'export-credential')
    $title = if ($isExport) { 'Export encrypted SSH credentials' } else { 'Import encrypted SSH credentials' }
    $credentialDialog = Wait-Dialog $title 20 $TargetProcessId
    if ($Action.StartsWith('cancel-')) {
        Invoke-DialogButton $credentialDialog @('Cancel', 'Annulla') 2
        Wait-DialogClosed $title 10 $TargetProcessId
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($FilePath) -or [IO.Path]::GetExtension($FilePath) -ne '.mrtcred') {
        throw 'A full .mrtcred path is required for native credential bundle selection.'
    }
    Invoke-DialogButton $credentialDialog $(if ($isExport) { @('Save', 'Export') } else { @('Open', 'Import') }) 1
    Wait-DialogClosed $title 10 $TargetProcessId
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
    $localTextDialog = Wait-Dialog $title 20 $TargetProcessId
    if ($Action -eq 'cancel-local-text') {
        Invoke-DialogButton $localTextDialog @('Cancel', 'Annulla') 2
        Wait-DialogClosed $title 10 $TargetProcessId
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($FilePath) -or [IO.Path]::GetExtension($FilePath) -ne '.txt') {
        throw 'A full .txt path is required for native local text file selection.'
    }
    Invoke-DialogButton $localTextDialog @('Open', 'Edit') 1
    Wait-DialogClosed $title 10 $TargetProcessId
    exit 0
}

if ($Action -in @('cancel-transfer-folder', 'select-transfer-folder')) {
    $title = 'Choose the folder containing the interrupted download'
    $folderDialog = Wait-Dialog $title 20 $TargetProcessId
    if ($Action -eq 'cancel-transfer-folder') {
        Invoke-DialogButton $folderDialog @('Cancel', 'Annulla') 2
        Wait-DialogClosed $title 10 $TargetProcessId
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($FilePath) -or -not (Test-Path -LiteralPath $FilePath -PathType Container)) {
        throw 'An existing interrupted-download folder is required.'
    }
    Invoke-DialogButton $folderDialog @('Select Folder', 'Select folder', 'Open') 1
    Wait-DialogClosed $title 10 $TargetProcessId
    exit 0
}

if ($Action -in @('cancel-logo', 'select-logo')) {
    $title = 'Choose a PNG logo'
    $logoDialog = Wait-Dialog $title 20 $TargetProcessId
    if ($Action -eq 'cancel-logo') {
        Invoke-DialogButton $logoDialog @('Cancel', 'Annulla') 2
        Wait-DialogClosed $title 10 $TargetProcessId
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($FilePath) -or [IO.Path]::GetExtension($FilePath) -ne '.png') {
        throw 'A full .png path is required for native logo selection.'
    }
    Invoke-DialogButton $logoDialog @('Open') 1
    Wait-DialogClosed $title 10 $TargetProcessId
    exit 0
}

if ($Action -in @('cancel-remote-forward', 'accept-remote-forward')) {
    $title = 'Confirm remote SSH forward exposure'
    $dialogButtonNames = @('Start remote forward', 'Expose remote forward')
    $dialog = Wait-Dialog $title 20 $TargetProcessId $dialogButtonNames
    $buttonNames = if ($Action -eq 'cancel-remote-forward') { @('Cancel') } else { $dialogButtonNames }
    Invoke-DialogButton $dialog $buttonNames
    Wait-DialogClosed $title 10 $TargetProcessId
    exit 0
}

if ($Action -in @('cancel-public-tunnel', 'accept-public-tunnel')) {
    $title = 'Confirm public SSH tunnel exposure'
    $dialogButtonNames = @('Expose local forward')
    $dialog = Wait-Dialog $title 20 $TargetProcessId $dialogButtonNames
    $buttonNames = if ($Action -eq 'cancel-public-tunnel') { @('Cancel') } else { $dialogButtonNames }
    Invoke-DialogButton $dialog $buttonNames
    Wait-DialogClosed $title 10 $TargetProcessId
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

$consent = Wait-Dialog 'Sensitive SSH session log' 20 $TargetProcessId
if ($Action -eq 'cancel-consent') {
    Invoke-DialogButton $consent @('Cancel') 2
    Wait-DialogClosed 'Sensitive SSH session log' 10 $TargetProcessId
    exit 0
}

Invoke-DialogButton $consent @('Continue to file selection') 1
Wait-DialogClosed 'Sensitive SSH session log' 10 $TargetProcessId
$saveDialog = Wait-Dialog 'Save sensitive SSH session log' 20 $TargetProcessId
if ($Action -eq 'cancel-save') {
    Invoke-DialogButton $saveDialog @('Cancel', 'Annulla') 2
    Wait-DialogClosed 'Save sensitive SSH session log' 10 $TargetProcessId
    exit 0
}

if ([string]::IsNullOrWhiteSpace($FilePath) -or [IO.Path]::GetExtension($FilePath) -ne '.log') {
    throw 'A full .log path is required for native Save dialog selection.'
}
Invoke-DialogButton $saveDialog @('Save', 'Save log') 1
Wait-DialogClosed 'Save sensitive SSH session log' 10 $TargetProcessId

$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
    if (Test-Path -LiteralPath $FilePath -PathType Leaf) { exit 0 }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
throw 'The native Save dialog closed without creating the selected log file.'

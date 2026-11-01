param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('cancel-consent', 'cancel-save', 'save', 'close-app', 'submit-ssh-credential', 'cancel-credential-export', 'export-credential', 'cancel-credential-import', 'import-credential', 'cancel-logo', 'select-logo', 'cancel-local-text', 'select-local-text', 'cancel-transfer-folder', 'select-transfer-folder', 'cancel-remote-forward', 'accept-remote-forward', 'cancel-public-tunnel', 'accept-public-tunnel')]
    [string] $Action,
    [string] $FilePath = '',
    [int] $TargetProcessId = 0
)

$ErrorActionPreference = 'Stop'
if ($TargetProcessId -lt 1) { throw 'Native dialog automation requires the target app process ID.' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class MrtNativeDialog {
    private const int FileNameEditControlId = 0x0480;
    private const int SaveDialogFileNameEditControlId = 1001;
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
    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool SetWindowText(IntPtr window, string text);
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
    public static IntPtr GetDialogEditControl(IntPtr dialog, int controlId) {
        IntPtr result = IntPtr.Zero;
        bool ambiguous = false;
        WindowCallback callback = (child, parameter) => {
            if (!IsWindowVisible(child) || !IsWindowEnabled(child)) return true;
            var className = new StringBuilder(128);
            GetClassName(child, className, className.Capacity);
            if (!String.Equals(className.ToString(), "Edit", StringComparison.Ordinal)) return true;
            int editId = GetDlgCtrlID(child);
            IntPtr parent = GetParent(child);
            bool directFileNameEdit = parent == dialog && (editId == FileNameEditControlId || editId == controlId);
            IntPtr comboEx = parent == IntPtr.Zero || parent == dialog ? IntPtr.Zero : GetParent(parent);
            bool belongsToFileNameCombo = GetDlgCtrlID(parent) == controlId ||
                comboEx != IntPtr.Zero && comboEx != dialog && GetDlgCtrlID(comboEx) == controlId;
            if (!directFileNameEdit && !belongsToFileNameCombo && !IsSaveDialogFileNameEdit(dialog, child)) return true;
            if (result != IntPtr.Zero) { ambiguous = true; return false; }
            result = child;
            return false;
        };
        EnumChildWindows(dialog, callback, IntPtr.Zero);
        return ambiguous ? IntPtr.Zero : result;
    }
    private static bool IsSaveDialogFileNameEdit(IntPtr dialog, IntPtr edit) {
        IntPtr combo = GetParent(edit);
        IntPtr notificationParent = GetParent(combo);
        var comboClass = new StringBuilder(128);
        var parentClass = new StringBuilder(128);
        if (combo != IntPtr.Zero) GetClassName(combo, comboClass, comboClass.Capacity);
        if (notificationParent != IntPtr.Zero) GetClassName(notificationParent, parentClass, parentClass.Capacity);
        return GetDlgCtrlID(edit) == SaveDialogFileNameEditControlId && IsChild(dialog, edit) &&
            String.Equals(comboClass.ToString(), "ComboBox", StringComparison.Ordinal) &&
            String.Equals(parentClass.ToString(), "FloatNotifySink", StringComparison.Ordinal);
    }
    public static string GetDialogEditText(IntPtr edit) {
        var value = new StringBuilder(32768);
        GetWindowText(edit, value, value.Capacity);
        return value.ToString();
    }
    public static bool SetDialogPath(IntPtr dialog, string path, int controlId) {
        IntPtr edit = GetDialogEditControl(dialog, controlId);
        if (edit == IntPtr.Zero) return false;
        int editId = GetDlgCtrlID(edit);
        if (editId != FileNameEditControlId && editId != controlId && !IsSaveDialogFileNameEdit(dialog, edit)) return false;
        return SetWindowText(edit, path) && String.Equals(GetDialogEditText(edit), path, StringComparison.OrdinalIgnoreCase);
    }
    public static string DescribeChildControls(IntPtr dialog) {
        var summary = new StringBuilder();
        WindowCallback callback = (child, parameter) => {
            var className = new StringBuilder(128);
            GetClassName(child, className, className.Capacity);
            var text = new StringBuilder(256);
            string classValue = className.ToString();
            if (String.Equals(classValue, "Button", StringComparison.Ordinal) ||
                String.Equals(classValue, "Static", StringComparison.Ordinal)) {
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
    public static bool ClickEnabledDialogButton(IntPtr dialog, int controlId) {
        if (!IsEnabledDialogButton(dialog, controlId)) return false;
        IntPtr button = GetDlgItem(dialog, controlId);
        if (!FocusDialogControl(dialog, button)) return false;
        SendMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero);
        return true;
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
        if (ambiguous || button == IntPtr.Zero || !FocusDialogControl(dialog, button)) return false;
        SendMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero);
        return true;
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

function Set-DialogPath([IntPtr] $dialog, [string] $path) {
    if (-not [MrtNativeDialog]::SetDialogPath($dialog, $path, 1148)) {
        throw "The native filename control did not retain the fixture path. Controls: $(Get-DialogAutomationSummary $dialog)"
    }
}

function Set-DialogFilename([IntPtr] $dialog, [string] $filePath) {
    Set-DialogPath $dialog $filePath
}

function Invoke-DialogButton([IntPtr] $dialog, [string[]] $acceptedNames, [int] $controlId = 0) {
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($dialog)
    $buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    $matches = @($buttons | Where-Object {
        try { $_.Current.IsEnabled -and $_.Current.Name -in $acceptedNames } catch { $false }
    })
    if ($matches.Count -gt 1) { throw 'The native dialog exposed multiple matching action buttons.' }
    if ($matches.Count -eq 1) {
        try {
            $invoke = [System.Windows.Automation.InvokePattern]$matches[0].GetCurrentPattern(
                [System.Windows.Automation.InvokePattern]::Pattern)
            $invoke.Invoke()
            if ([MrtNativeDialog]::GetDialogEditControl($dialog, 1148) -eq [IntPtr]::Zero) { return }
            $deadline = [DateTime]::UtcNow.AddMilliseconds(750)
            do {
                if (-not [MrtNativeDialog]::IsWindowVisible($dialog)) { return }
                Start-Sleep -Milliseconds 50
            } while ([DateTime]::UtcNow -lt $deadline)
        } catch { }
    }
    $nativeFailure = "The native dialog control ID $controlId was not found."
    if ($controlId -gt 0) {
        $nativeHandle = [MrtNativeDialog]::GetDialogControl($dialog, $controlId)
        if ($nativeHandle -ne [IntPtr]::Zero) {
            try {
                if (-not [MrtNativeDialog]::IsEnabledDialogButton($dialog, $controlId)) {
                    throw "Control ID $controlId is not a visible enabled button owned by this dialog."
                }
                if (-not [MrtNativeDialog]::ClickEnabledDialogButton($dialog, $controlId)) {
                    throw "Could not focus or activate the enabled action control ID $controlId."
                }
                return
            } catch {
                $nativeFailure = $_.Exception.Message
            }
        }
    }
    if ([MrtNativeDialog]::ClickEnabledDialogButtonByName($dialog, $acceptedNames)) { return }
    $labels = @($buttons | ForEach-Object { try { $_.Current.Name } catch { '<unavailable>' } }) -join ', '
    throw "The native dialog action was not invoked. $nativeFailure UIA: $labels. Win32: $([MrtNativeDialog]::DescribeChildControls($dialog))"
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
                if (-not [string]::IsNullOrEmpty($name) -and $name.Contains('Enter the SSH account credential.')) { return $window }
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
            $usernameField.SetFocus()
            [System.Windows.Forms.SendKeys]::SendWait('^a')
            [System.Windows.Forms.SendKeys]::SendWait($username)
        }
        $passwordField.SetFocus()
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
    Set-DialogFilename $credentialDialog $FilePath
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
    Set-DialogFilename $localTextDialog $FilePath
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
    Set-DialogPath $folderDialog $FilePath
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
    Set-DialogFilename $logoDialog $FilePath
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
Set-DialogFilename $saveDialog $FilePath
Invoke-DialogButton $saveDialog @('Save', 'Save log') 1
Wait-DialogClosed 'Save sensitive SSH session log' 10 $TargetProcessId

$deadline = [DateTime]::UtcNow.AddSeconds(10)
do {
    if (Test-Path -LiteralPath $FilePath -PathType Leaf) { exit 0 }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
throw 'The native Save dialog closed without creating the selected log file.'

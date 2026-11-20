<#
  dsh-turn-notify: one Windows toast per invocation.

  The Host starts this script for every notification, passing the toast text as
  arguments (never interpolated into a command line it builds). The body is
  plain text whose first line is the session label.

  Delivery degrades in three steps: WinRT toast, tray balloon, non-zero exit so
  the Host logs the failure. The toast is shown under the plugin's own
  AppUserModelID; Windows does not require a registered shortcut for that id to
  display, but see README.md for the cases where Windows drops it silently.
#>
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Body,
  [switch]$Sound
)

$ErrorActionPreference = 'Stop'

function Esc([string]$Text) { [System.Security.SecurityElement]::Escape($Text) }

function Send-Toast {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $audio = if ($Sound) { "<audio src='ms-winsoundevent:Notification.Default'/>" } else { "<audio silent='true'/>" }
  $xml = "<toast duration='long'><visual><binding template='ToastText02'>" +
    "<text id='1'>$(Esc $Title)</text><text id='2'>$(Esc $Body)</text>" +
    "</binding></visual>$audio</toast>"
  $document = New-Object Windows.Data.Xml.Dom.XmlDocument
  $document.LoadXml($xml)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $document
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('dsh-turn-notify').Show($toast)
}

function Send-Balloon {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $icon = New-Object System.Windows.Forms.NotifyIcon
  $icon.Icon = [System.Drawing.SystemIcons]::Information
  $icon.Visible = $true
  $icon.ShowBalloonTip(8000, $Title, $Body, [System.Windows.Forms.ToolTipIcon]::Info)
  Start-Sleep -Seconds 8
  $icon.Dispose()
}

try {
  Send-Toast
  exit 0
} catch {
  $toastError = $_
  try {
    Send-Balloon
    exit 0
  } catch {
    Write-Error "toast failed: $toastError; balloon failed: $_"
    exit 1
  }
}

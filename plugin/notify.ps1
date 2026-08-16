param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Body,
  [switch]$Sound
)

$ErrorActionPreference = 'Stop'

function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }

function Send-Toast {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $xml = "<toast duration='long'><visual><binding template='ToastText02'>"
  $xml += "<text id='1' hint-style='title'>$(& Esc $Title)</text>"
  $xml += "<text id='2'>$(& Esc $Body)</text>"
  $xml += "</binding></visual>"
  if ($Sound) { $xml += "<audio silent='true'/>" } else { $xml += "<audio silent='true'/>" }
  $xml += '</toast>'
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $doc.LoadXml($xml)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('dsh-turn-notify').Show($toast)
  if ($Sound) {
    Add-Type -AssemblyName System.Media -ErrorAction SilentlyContinue
    foreach ($wav in @('C:\Windows\Media\Windows Background.wav', 'C:\Windows\Media\chimes.wav', 'C:\Windows\Media\Windows Ding.wav', 'C:\Windows\Media\Windows Notify.wav')) {
      if (Test-Path $wav) {
        $player = New-Object System.Media.SoundPlayer $wav
        $player.PlaySync()
        $player.Dispose()
        break
      }
    }
  }
}

function Send-Balloon {
  Add-Type -AssemblyName System.Windows.Forms
  $icon = New-Object System.Windows.Forms.NotifyIcon
  $icon.Icon = [System.Drawing.SystemIcons]::Information
  $icon.Visible = $true
  $icon.ShowBalloonTip(6000, $Title, $Body, [System.Windows.Forms.ToolTipIcon]::Info)
  Start-Sleep -Seconds 6
  $icon.Dispose()
}

try {
  Send-Toast
  exit 0
} catch {
  try {
    Send-Balloon
    exit 0
  } catch {
    Write-Error "toast and balloon both failed: $_"
    exit 1
  }
}

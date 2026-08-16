param([switch]$Balloon)

$ErrorActionPreference = 'Stop'
& "$PSScriptRoot\notify.ps1" -Title 'DSH 冒烟测试' -Body '这是 dsh-turn-notify 的通知测试。' -Sound
if ($Balloon) {
  & "$PSScriptRoot\notify.ps1" -Title 'DSH 气泡测试' -Body '这是托盘气泡回退路径。'
}

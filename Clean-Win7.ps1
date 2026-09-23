#requires -Version 2.0
<#
.SYNOPSIS
  Win7 零依赖版：一键清除外接设备插拔记录、联网记录、所有浏览器缓存/历史/Cookies/密码。
  纯 Win7 自带 PowerShell 2.0 运行，无需预装 WMF 或任何东西。
  全自动、不备份。设备记录清理以 SYSTEM 身份(经 schtasks 计划任务)执行，最可靠。
  保留在线设备(正在使用的鼠标/键盘/U盘)，只删历史(已拔下)设备的记录。
  可加 -DryRun 预演。
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$ViaTask,
    [switch]$SystemDeviceClean
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# =========================================================================
# 路径、日志、统计
# =========================================================================
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile  = Join-Path $ScriptDir 'Clean-Win7.log'

$script:Stats = @{ Cleaned = 0; Skipped = 0; Failed = 0 }

function Write-CleanLog {
    param(
        [string]$Message,
        [string]$Level = 'INFO'
    )
    $line = '[{0}][{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    $written = $false
    for ($i = 0; $i -lt 5 -and -not $written; $i++) {
        try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 -ErrorAction Stop; $written = $true }
        catch { Start-Sleep -Milliseconds 200 }
    }
    switch ($Level) {
        'ERR'  { Write-Host $line -ForegroundColor Red }
        'WARN' { Write-Host $line -ForegroundColor Yellow }
        'DRY'  { Write-Host $line -ForegroundColor Cyan }
        default { Write-Host $line -ForegroundColor Gray }
    }
}

function Invoke-Action {
    param([string]$Label, [scriptblock]$Action)
    if ($DryRun) {
        Write-CleanLog "DRYRUN: 将执行 [$Label]" 'DRY'
        $script:Stats.Skipped++
        return
    }
    try {
        & $Action
        Write-CleanLog "已清理 [$Label]"
        $script:Stats.Cleaned++
    } catch {
        Write-CleanLog "失败 [$Label]: $($_.Exception.Message)" 'ERR'
        $script:Stats.Failed++
    }
}

function Remove-CleanItem {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    if ($DryRun) {
        Write-CleanLog "DRYRUN: 删除 $Path" 'DRY'
        $script:Stats.Skipped++
        return $true
    }
    try {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        $script:Stats.Cleaned++
        return $true
    } catch {
        Write-CleanLog "删除失败 $Path : $($_.Exception.Message)" 'ERR'
        $script:Stats.Failed++
        return $false
    }
}

function Remove-CleanItemRetry {
    param([string]$Path, [string[]]$ProcNames)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    if ($DryRun) { Write-CleanLog "DRYRUN: 删除 $Path" 'DRY'; $script:Stats.Skipped++; return $true }
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            $script:Stats.Cleaned++
            return $true
        } catch {
            if ($attempt -lt 2 -and $ProcNames) {
                foreach ($n in $ProcNames) { try { Stop-Process -Name $n -Force -ErrorAction SilentlyContinue } catch {} }
                Start-Sleep -Seconds 1
            } else {
                Write-CleanLog "删除失败(重试3次) $Path : $($_.Exception.Message)" 'ERR'
                $script:Stats.Failed++
                return $false
            }
        }
    }
    return $false
}

function Clear-CleanFolder {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    if ($DryRun) { Write-CleanLog "DRYRUN: 清空目录 $Path" 'DRY'; $script:Stats.Skipped++; return $true }
    try {
        Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        $script:Stats.Cleaned++
        return $true
    } catch {
        Write-CleanLog "清空失败 $Path : $($_.Exception.Message)" 'ERR'
        $script:Stats.Failed++
        return $false
    }
}

# =========================================================================
# 自提权 + 免 UAC 计划任务（Win7 用 schtasks）
# =========================================================================
$script:SelfPath = $MyInvocation.MyCommand.Path

function New-UserElevTask {
    # 创建"当前用户 + 最高权限 + 交互"的计划任务，触发后由任务计划程序以提权令牌启动，不弹 UAC。
    param([string]$TaskName, [string]$ExtraArgs)
    $argStr = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -ViaTask' -f $script:SelfPath
    if ($ExtraArgs) { $argStr += ' ' + $ExtraArgs }
    $today = Get-Date -Format 'MM/dd/yyyy'
    $cmd = 'powershell.exe ' + $argStr
    & schtasks.exe /create /tn $TaskName /tr $cmd /sc once /st 00:00 /sd $today /ru $env:USERNAME /rl HIGHEST /it /f 2>&1 | Out-Null
}

function Run-TaskAndWait {
    # 触发任务并轮询直到完成（或超时）。返回 $true 表示已触发。
    param([string]$TaskName, [int]$TimeoutSec = 180)
    & schtasks.exe /run /tn $TaskName 2>&1 | Out-Null
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        $q = & schtasks.exe /query /tn $TaskName /fo LIST /v 2>$null
        $status = ''
        foreach ($ln in $q) {
            if ($ln -match '^\s*Status:\s*(.+)$') { $status = $Matches[1].Trim(); break }
        }
        if ($status -and ($status -notlike 'Running*' -and $status -notlike 'Queued*')) { break }
    }
    return $true
}

function Invoke-NoUacElevation {
    $taskName = 'CleanWin7_UserElev'
    try {
        $extra = ''
        if ($DryRun) { $extra = '-DryRun' }
        New-UserElevTask -TaskName $taskName -ExtraArgs $extra
        Run-TaskAndWait -TaskName $taskName -TimeoutSec 180
        Write-Host '已通过计划任务以管理员权限启动清理（不弹 UAC）。' -ForegroundColor Green
        Write-Host '清理将在新窗口/后台进行，详见 Clean-Win7.log。' -ForegroundColor Cyan
        return $true
    } catch {
        Write-Host "免UAC计划任务启动失败: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

function Invoke-UacElevation {
    Write-Host '回退到 UAC 提权（将弹出确认）...' -ForegroundColor Yellow
    $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $script:SelfPath + '"'))
    if ($DryRun) { $args2 += '-DryRun' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $args2 -Verb RunAs
}

# 判断是否管理员
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$wp = New-Object Security.Principal.WindowsPrincipal($currentUser)
$isAdmin = $wp.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    if (-not $ViaTask) {
        if (Invoke-NoUacElevation) { exit }
        Invoke-UacElevation
        exit
    } else {
        Invoke-UacElevation
        exit
    }
}

# 初始化日志
$header = if ($DryRun) { '==== 预演开始 {0} ====' } else { '==== 清理开始 {0} ====' }
Set-Content -Path $LogFile -Value ($header -f (Get-Date)) -Encoding UTF8
Write-CleanLog ("脚本: " + $script:SelfPath + " | DryRun: " + $DryRun)

# =========================================================================
# 启用权限令牌（夺权所需）—— .NET 2.0 + Add-Type，PS 2.0 兼容
# =========================================================================
try {
    $privCode = @'
using System;
using System.Runtime.InteropServices;
public static class Priv {
    [StructLayout(LayoutKind.Sequential)]
    public struct LUID { public uint LowPart; public int HighPart; }
    [StructLayout(LayoutKind.Sequential, Pack=1)]
    public struct TOKEN_PRIV { public uint Count; public LUID Luid; public uint Attr; }
    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern bool OpenProcessToken(IntPtr P, uint A, out IntPtr T);
    [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Auto)]
    public static extern bool LookupPrivilegeValue(string s, string n, ref LUID l);
    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern bool AdjustTokenPrivileges(IntPtr T, bool d, ref TOKEN_PRIV n, uint z, IntPtr p1, IntPtr p2);
    [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
    public static void Enable(string name) {
        IntPtr tok;
        OpenProcessToken(GetCurrentProcess(), 0x28, out tok);
        LUID l = new LUID();
        LookupPrivilegeValue(null, name, ref l);
        TOKEN_PRIV tp; tp.Count = 1; tp.Luid = l; tp.Attr = 2;
        AdjustTokenPrivileges(tok, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
        CloseHandle(tok);
    }
}
'@
    Add-Type -TypeDefinition $privCode -ErrorAction Stop
    foreach ($p in 'SeTakeOwnershipPrivilege','SeRestorePrivilege','SeBackupPrivilege','SeSecurityPrivilege') {
        [Priv]::Enable($p)
    }
    Write-CleanLog '权限令牌已启用'
} catch {
    Write-CleanLog ("启用权限令牌失败(继续): " + $_.Exception.Message) 'WARN'
}

# =========================================================================
# 注册表夺权与子项清理（PS 2.0 兼容：.NET 2.0 ACL，leaf-first 删除）
# =========================================================================
function Get-RegHiveAndSub {
    param([string]$Path)
    if ($Path -match '^HKLM:\\(.*)$') { return ,@([Microsoft.Win32.Registry]::LocalMachine, $Matches[1]) }
    if ($Path -match '^HKCU:\\(.*)$') { return ,@([Microsoft.Win32.Registry]::CurrentUser, $Matches[1]) }
    if ($Path -match '^HKU:\\(.*)$')  { return ,@([Microsoft.Win32.Registry]::Users, $Matches[1]) }
    return $null
}

function Reset-RegOwnershipRecursive {
    param([string]$RegPath, [switch]$NoRecurse)
    $res = Get-RegHiveAndSub $RegPath
    if (-not $res) { return }
    $hive = $res[0]; $sub = $res[1]
    $admins      = New-Object System.Security.Principal.NTAccount('Administrators')
    $fullControl = [System.Security.AccessControl.RegistryRights]::FullControl
    $changePerm  = [System.Security.AccessControl.RegistryRights]::ChangePermissions -bor [System.Security.AccessControl.RegistryRights]::ReadPermissions
    $rwSubTree   = [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree
    $inheritAll  = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit
    $secAO       = [System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner
    $stack = New-Object System.Collections.Generic.Stack[string]
    $stack.Push($sub)
    while ($stack.Count -gt 0) {
        $cur = $stack.Pop()
        $owned = $false
        try {
            $key = $hive.OpenSubKey($cur, $rwSubTree, [System.Security.AccessControl.RegistryRights]::TakeOwnership)
            if ($null -ne $key) {
                $acl = $key.GetAccessControl($secAO)
                $acl.SetOwner($admins)
                $key.SetAccessControl($acl)
                $key.Close()
                $key = $hive.OpenSubKey($cur, $rwSubTree, $changePerm)
                if ($null -ne $key) {
                    $acl = $key.GetAccessControl($secAO)
                    $rule = New-Object System.Security.AccessControl.RegistryAccessRule($admins, $fullControl, $inheritAll, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
                    $acl.SetAccessRule($rule)
                    $key.SetAccessControl($acl)
                    $key.Close()
                    $owned = $true
                }
            }
        } catch {
            Write-CleanLog ("夺权失败(设置): " + $cur + " : " + $_.Exception.Message) 'WARN'
        }
        if (-not $owned) { continue }
        if ($NoRecurse) { continue }
        try {
            $key = $hive.OpenSubKey($cur, $rwSubTree, $fullControl)
            if ($null -ne $key) {
                foreach ($child in $key.GetSubKeyNames()) { $stack.Push("$cur\$child") }
                $key.Close()
            }
        } catch {
            Write-CleanLog ("枚举子项失败: " + $cur + " : " + $_.Exception.Message) 'WARN'
        }
    }
}

function Clear-RegistrySubkeys {
    param([string]$RegPath)
    if (-not (Test-Path $RegPath)) {
        Write-CleanLog ("跳过(不存在): " + $RegPath)
        $script:Stats.Skipped++
        return
    }
    if ($DryRun) {
        Write-CleanLog ("DRYRUN: 清空注册表子项 " + $RegPath) 'DRY'
        $script:Stats.Skipped++
        return
    }
    $failed = @()
    $children = Get-ChildItem -LiteralPath $RegPath -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        try {
            Remove-Item -LiteralPath $child.PSPath -Recurse -Force -ErrorAction Stop
            $script:Stats.Cleaned++
        } catch {
            $failed += $child.PSChildName
        }
    }
    if ($failed.Count -gt 0) {
        Write-CleanLog ($failed.Count.ToString() + " 个子项受保护，递归夺权后重试...") 'WARN'
        Reset-RegOwnershipRecursive $RegPath
        foreach ($name in $failed) {
            $childPath = Join-Path $RegPath $name
            try {
                Remove-Item -LiteralPath $childPath -Recurse -Force -ErrorAction Stop
                $script:Stats.Cleaned++
            } catch {
                Write-CleanLog ("删除失败 " + $childPath + " : " + $_.Exception.Message) 'ERR'
                $script:Stats.Failed++
            }
        }
    }
    Write-CleanLog ("完成清空子项: " + $RegPath)
}

function Clear-MountedDevices {
    $reg = 'HKLM:\SYSTEM\MountedDevices'
    if (-not (Test-Path $reg)) { return }
    if ($DryRun) { Write-CleanLog 'DRYRUN: 清空 MountedDevices(保留 C:)' 'DRY'; $script:Stats.Skipped++; return }
    $h = [Microsoft.Win32.Registry]::LocalMachine
    $done = $false
    try {
        $key = $h.OpenSubKey('SYSTEM\MountedDevices', $true)
        if ($null -ne $key) {
            foreach ($vn in $key.GetValueNames()) {
                if ($vn -eq '\DosDevices\C:') { continue }
                try { $key.DeleteValue($vn, $false) } catch {}
            }
            $key.Close()
            $done = $true
        }
    } catch {
        Write-CleanLog ("直接清空 MountedDevices 失败，夺权后重试: " + $_.Exception.Message) 'WARN'
    }
    if (-not $done) {
        Reset-RegOwnershipRecursive $reg
        $key = $h.OpenSubKey('SYSTEM\MountedDevices', $true)
        if ($null -ne $key) {
            foreach ($vn in $key.GetValueNames()) {
                if ($vn -eq '\DosDevices\C:') { continue }
                try { $key.DeleteValue($vn, $false) } catch {}
            }
            $key.Close()
            $done = $true
        }
    }
    if ($done) { Write-CleanLog '已清空 MountedDevices(保留 C:)'; $script:Stats.Cleaned++ }
    else { Write-CleanLog '清空 MountedDevices 失败' 'ERR'; $script:Stats.Failed++ }
}

# =========================================================================
# 设备记录清理：在线判定（Win7 双重判据）+ SYSTEM 子任务
# =========================================================================
function Get-AllControlSets {
    $sets = @()
    Get-ChildItem -LiteralPath 'HKLM:\SYSTEM' -ErrorAction SilentlyContinue |
        Where-Object { $_.PSChildName -match '^ControlSet\d+$' } |
        ForEach-Object { $sets += ("HKLM:\SYSTEM\" + $_.PSChildName) }
    if (Test-Path 'HKLM:\SYSTEM\CurrentControlSet') { $sets += 'HKLM:\SYSTEM\CurrentControlSet' }
    return $sets
}

function Get-PresentDeviceIds {
    # Win7: Present 属性不可用。用 WMI ConfigManagerErrorCode==0 + pnputil -e 双重取并集。
    $set = @{}
    # 1) WMI：工作正常的设备视为在场
    try {
        Get-WmiObject -Class Win32_PnPEntity -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.DeviceID -and $_.ConfigManagerErrorCode -eq 0) {
                $set[$_.DeviceID.ToUpper()] = $true
            }
        }
    } catch {}
    # 2) pnputil -e：枚举当前在场的第三方设备，解析实例 ID
    try {
        $out = & pnputil.exe -e 2>$null
        foreach ($ln in $out) {
            # pnputil 输出含 "Instance ID:" 行，后跟 USB\VID_xxx\serial 等
            if ($ln -match ':\s*(USB\\.+|USBSTOR\\.+|HID\\.+|SWD\\.+)') {
                $id = $Matches[1].Trim()
                $set[$id.ToUpper()] = $true
            }
        }
    } catch {}
    return $set
}

function Invoke-DeviceCleanAsSystem {
    # 以 SYSTEM 身份(经 schtasks)删设备注册表——SYSTEM 对 Enum\* 天然 FullControl，无需夺权。
    $taskName = 'CleanWin7_SYS'
    try {
        $argStr = '-NoProfile -ExecutionPolicy Bypass -File "' + $script:SelfPath + '" -SystemDeviceClean'
        $today = Get-Date -Format 'MM/dd/yyyy'
        $cmd = 'powershell.exe ' + $argStr
        & schtasks.exe /create /tn $taskName /tr $cmd /sc once /st 00:00 /sd $today /ru 'NT AUTHORITY\SYSTEM' /rl HIGHEST /f 2>&1 | Out-Null
        & schtasks.exe /run /tn $taskName 2>&1 | Out-Null
        Write-CleanLog '已触发 SYSTEM 计划任务执行设备注册表清理，等待完成...'
        $deadline = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 2
            $q = & schtasks.exe /query /tn $taskName /fo LIST /v 2>$null
            $status = ''
            foreach ($ln in $q) {
                if ($ln -match '^\s*Status:\s*(.+)$') { $status = $Matches[1].Trim(); break }
            }
            if ($status -and $status -notlike 'Running*' -and $status -notlike 'Queued*') { break }
        }
        $resultFile = Join-Path $ScriptDir 'Clean-Win7.sysclean.log'
        if (Test-Path $resultFile) {
            Get-Content $resultFile | ForEach-Object { Write-CleanLog ("[SYS] " + $_) }
        }
        return $true
    } catch {
        Write-CleanLog ("SYSTEM 计划任务方式失败: " + $_.Exception.Message) 'WARN'
        return $false
    }
}

# ---- SYSTEM 子任务执行体：删 Enum\* 非在线实例（双重判在线）----
if ($SystemDeviceClean) {
    $sysLog = Join-Path $ScriptDir 'Clean-Win7.sysclean.log'
    ("SYS-START " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) | Set-Content $sysLog -Encoding UTF8
    $presentIds = Get-PresentDeviceIds
    ("在线设备数: " + $presentIds.Count) | Add-Content $sysLog -Encoding UTF8
    $controlSets = Get-AllControlSets
    if ($controlSets.Count -eq 0) { $controlSets = @('HKLM:\SYSTEM\CurrentControlSet') }
    $cleaned = 0; $failed = 0; $skipped = 0
    $usbEnumRel = @('Enum\USB','Enum\USBSTOR','Enum\HID','Enum\SWD')
    foreach ($cs in $controlSets) {
        foreach ($rel in $usbEnumRel) {
            $path = Join-Path $cs $rel
            $enumName = Split-Path $path -Leaf
            if (-not (Test-Path $path)) { continue }
            $hwids = Get-ChildItem -LiteralPath $path -ErrorAction SilentlyContinue
            foreach ($hw in $hwids) {
                $hwName = $hw.PSChildName
                $hwReg  = Join-Path $path $hwName
                $insts = Get-ChildItem -LiteralPath $hwReg -ErrorAction SilentlyContinue
                foreach ($inst in $insts) {
                    $instName = $inst.PSChildName
                    $fullId = $enumName + '\' + $hwName + '\' + $instName
                    if ($presentIds.Count -gt 0 -and $presentIds.ContainsKey($fullId.ToUpper())) { $skipped++; continue }
                    if ($presentIds.Count -eq 0) { $skipped++; continue }
                    $instReg = Join-Path $hwReg $instName
                    try {
                        Remove-Item -LiteralPath $instReg -Recurse -Force -ErrorAction Stop
                        $cleaned++
                    } catch {
                        Reset-RegOwnershipRecursive $hwReg -NoRecurse
                        Reset-RegOwnershipRecursive $instReg
                        try {
                            Remove-Item -LiteralPath $instReg -Recurse -Force -ErrorAction Stop
                            $cleaned++
                        } catch {
                            $cli = 'HKLM\' + ($instReg -replace '^HKLM:\\','')
                            & reg.exe delete $cli /f 2>$null | Out-Null
                            if (-not (Test-Path $instReg)) { $cleaned++ } else { $failed++ }
                        }
                    }
                }
                if (-not (Get-ChildItem -LiteralPath $hwReg -ErrorAction SilentlyContinue)) {
                    try { Remove-Item -LiteralPath $hwReg -Force -ErrorAction Stop } catch {}
                }
            }
        }
    }
    $wpd = 'HKLM:\SOFTWARE\Microsoft\Windows Portable Devices'
    if (Test-Path $wpd) {
        Get-ChildItem -LiteralPath $wpd -ErrorAction SilentlyContinue | ForEach-Object {
            try { Remove-Item -LiteralPath $_.PSPath -Recurse -Force -ErrorAction Stop; $cleaned++ } catch { $failed++ }
        }
    }
    ("SYS-DONE cleaned=" + $cleaned + " failed=" + $failed + " skipped=" + $skipped + " " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) | Add-Content $sysLog -Encoding UTF8
    exit
}

# =========================================================================
# 2. USB / 外接设备枚举注册表
# =========================================================================
Write-CleanLog '===== USB / 外接设备枚举注册表 ====='
$sysDone = Invoke-DeviceCleanAsSystem
if (-not $sysDone) {
    Write-CleanLog '回退用户态夺权清理设备历史' 'WARN'
    $controlSets = Get-AllControlSets
    if ($controlSets.Count -eq 0) { $controlSets = @('HKLM:\SYSTEM\CurrentControlSet') }
    $presentIds = Get-PresentDeviceIds
    foreach ($cs in $controlSets) {
        Write-CleanLog ("控制集: " + $cs)
        foreach ($rel in @('Enum\USB','Enum\USBSTOR','Enum\HID','Enum\SWD')) {
            $path = Join-Path $cs $rel
            $enumName = Split-Path $path -Leaf
            if (-not (Test-Path $path)) { continue }
            $hwids = Get-ChildItem -LiteralPath $path -ErrorAction SilentlyContinue
            foreach ($hw in $hwids) {
                $hwName = $hw.PSChildName
                $hwReg  = Join-Path $path $hwName
                $insts = Get-ChildItem -LiteralPath $hwReg -ErrorAction SilentlyContinue
                foreach ($inst in $insts) {
                    $instName = $inst.PSChildName
                    $fullId = $enumName + '\' + $hwName + '\' + $instName
                    if ($presentIds.Count -gt 0 -and $presentIds.ContainsKey($fullId.ToUpper())) { continue }
                    if ($presentIds.Count -eq 0) { continue }
                    $instReg = Join-Path $hwReg $instName
                    try { Remove-Item -LiteralPath $instReg -Recurse -Force -ErrorAction Stop; $script:Stats.Cleaned++ }
                    catch {
                        Reset-RegOwnershipRecursive $hwReg -NoRecurse
                        Reset-RegOwnershipRecursive $instReg
                        try { Remove-Item -LiteralPath $instReg -Recurse -Force -ErrorAction Stop; $script:Stats.Cleaned++ }
                        catch { Write-CleanLog ("删除失败 " + $fullId + " : " + $_.Exception.Message) 'ERR'; $script:Stats.Failed++ }
                    }
                }
                if (-not (Get-ChildItem -LiteralPath $hwReg -ErrorAction SilentlyContinue)) {
                    try { Remove-Item -LiteralPath $hwReg -Force -ErrorAction Stop } catch {}
                }
            }
        }
    }
    Clear-RegistrySubkeys 'HKLM:\SOFTWARE\Microsoft\Windows Portable Devices'
}
Clear-RegistrySubkeys 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\MountPoints2'
Clear-MountedDevices

# =========================================================================
# 3. SetupAPI 设备安装日志
# =========================================================================
Write-CleanLog '===== SetupAPI 设备安装日志 ====='
foreach ($f in 'C:\Windows\INF\setupapi.dev.log','C:\Windows\INF\setupapi.app.log','C:\Windows\INF\setupapi.upgrade.log') {
    Remove-CleanItem -Path $f | Out-Null
}
Get-ChildItem 'C:\Windows\INF' -Filter 'setupapi.dev.*.log' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-CleanItem -Path $_.FullName | Out-Null }

# =========================================================================
# 4. 系统事件日志（设备 + 网络）
# =========================================================================
Write-CleanLog '===== 系统事件日志 ====='
$namedLogs = @(
    'System',
    'Microsoft-Windows-DriverFrameworks-UserMode/Operational',
    'Microsoft-Windows-Kernel-PnP/Configuration',
    'Microsoft-Windows-NetworkProfile/Operational',
    'Microsoft-Windows-WLAN-AutoConfig/Operational'
)
foreach ($lg in $namedLogs) {
    $logName = $lg
    Invoke-Action -Label ("事件日志 " + $lg) -Action {
        & wevtutil cl $logName 2>$null | Out-Null
    }
}
Invoke-Action -Label '匹配关键词的事件日志兜底清空' -Action {
    $all = wevtutil el | Where-Object { $_ -match 'USB|DriverFrame|PNP|Network|WLAN|TCPIP|Dhcp' }
    foreach ($l in $all) {
        try { & wevtutil cl $l 2>$null | Out-Null } catch {}
    }
}

# =========================================================================
# 5. 浏览器数据清理
# =========================================================================
Write-CleanLog '===== 浏览器数据清理 ====='

$BrowserProcessNames = @(
    'chrome','msedge','MicrosoftEdge','firefox','brave','opera','vivaldi',
    '360chrome','360se','QQBrowser','SogouExplorer','iexplore','UCBrowser','Maxthon',
    'msedgewebview2','MicrosoftEdgeUpdate','GoogleUpdate','Crashpad'
)
if (-not $DryRun) {
    foreach ($n in $BrowserProcessNames) { try { Stop-Process -Name $n -Force -ErrorAction SilentlyContinue } catch {} }
    Start-Sleep -Seconds 1
    foreach ($n in $BrowserProcessNames) { try { Stop-Process -Name $n -Force -ErrorAction SilentlyContinue } catch {} }
    Write-CleanLog '已强制结束浏览器及相关占用进程，等待句柄释放...'
    Start-Sleep -Seconds 2
} else {
    Write-CleanLog ("DRYRUN: 将结束进程 " + ($BrowserProcessNames -join ', ')) 'DRY'
    $script:Stats.Skipped++
}

$BrowserDefs = @(
    @{ Name='Chrome';       Engine='chromium'; DataPath='{U}\AppData\Local\Google\Chrome\User Data' }
    @{ Name='Edge';         Engine='chromium'; DataPath='{U}\AppData\Local\Microsoft\Edge\User Data' }
    @{ Name='Brave';        Engine='chromium'; DataPath='{U}\AppData\Local\BraveSoftware\Brave-Browser\User Data' }
    @{ Name='Vivaldi';      Engine='chromium'; DataPath='{U}\AppData\Local\Vivaldi\User Data' }
    @{ Name='Opera';        Engine='chromium'; DataPath='{U}\AppData\Local\Opera Software\Opera Stable' }
    @{ Name='360Chrome';     Engine='chromium'; DataPath='{U}\AppData\Local\360Chrome\Chrome\User Data' }
    @{ Name='360ChromeX';    Engine='chromium'; DataPath='{U}\AppData\Local\360ChromeX\Chrome\User Data' }
    @{ Name='QQBrowser';     Engine='chromium'; DataPath='{U}\AppData\Local\Tencent\QQBrowser\User Data' }
    @{ Name='Firefox-Roaming'; Engine='firefox-roam';  DataPath='{U}\AppData\Roaming\Mozilla\Firefox\Profiles' }
    @{ Name='Firefox-Local';    Engine='firefox-local'; DataPath='{U}\AppData\Local\Mozilla\Firefox\Profiles' }
    @{ Name='IE/EdgeLegacy';    Engine='ie';            DataPath='{U}\AppData\Local\Microsoft\Windows' }
)

$ChromiumTargets = @(
    'History','History-journal','History-wal','History-shm',
    'Top Sites','Top Sites-journal',
    'Favicons','Favicons-journal',
    'Current Session','Current Tabs','Last Session','Last Tabs',
    'Cookies','Cookies-journal',
    'TransportSecurity',
    'DownloadMetadata',
    'Web Data','Web Data-journal',
    'Login Data','Login Data-journal','Login Data For Account',
    'Bookmarks','Bookmarks.bak',
    'Cache','Code Cache','GPUCache','ShaderCache','GrShaderCache',
    'Service Worker\CacheStorage','Service Worker\ScriptCache',
    'Local Storage','Session Storage','IndexedDB','Sessions',
    'Network\Cookies','Network\Trust Tokens'
)
$FirefoxRoamTargets = @(
    'places.sqlite','places.sqlite-wal','places.sqlite-shm',
    'formhistory.sqlite','formhistory.sqlite-wal','formhistory.sqlite-shm',
    'cookies.sqlite','cookies.sqlite-wal','cookies.sqlite-shm',
    'logins.json','key4.db','key3.db','signons.sqlite',
    'sessionstore.jsonlz4','sessionstore-backups',
    'content-prefs.sqlite','permissions.sqlite','webappsstore.sqlite',
    'bookmarkbackups'
)
$FirefoxLocalTargets = @('cache2','startupCache','thumbnails','shader-cache','storage','safebrowsing')
$IETargets          = @('INetCache','INetCookies','History','WebCache')

$excludeUsers = @('Public','Default','Default User','All Users','classic .NET')
$UserHomes = @()
Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin $excludeUsers } | ForEach-Object { $UserHomes += $_.FullName }

foreach ($userHome in $UserHomes) {
    foreach ($bdef in $BrowserDefs) {
        $dataPath = $bdef.DataPath.Replace('{U}', $userHome)
        if (-not (Test-Path -LiteralPath $dataPath)) { continue }
        Write-CleanLog ("处理浏览器 " + $bdef.Name + " @ " + $dataPath)
        switch ($bdef.Engine) {
            'chromium' {
                $profiles = Get-ChildItem -LiteralPath $dataPath -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' -or $_.Name -eq 'Guest Profile' }
                foreach ($p in $profiles) {
                    foreach ($t in $ChromiumTargets) {
                        Remove-CleanItemRetry -Path (Join-Path $p.FullName $t) -ProcNames $BrowserProcessNames | Out-Null
                    }
                }
            }
            'firefox-roam' {
                $profiles = Get-ChildItem -LiteralPath $dataPath -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like '*.default*' }
                foreach ($p in $profiles) {
                    foreach ($t in $FirefoxRoamTargets) {
                        Remove-CleanItemRetry -Path (Join-Path $p.FullName $t) -ProcNames $BrowserProcessNames | Out-Null
                    }
                }
            }
            'firefox-local' {
                $profiles = Get-ChildItem -LiteralPath $dataPath -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like '*.default*' }
                foreach ($p in $profiles) {
                    foreach ($t in $FirefoxLocalTargets) {
                        Remove-CleanItemRetry -Path (Join-Path $p.FullName $t) -ProcNames $BrowserProcessNames | Out-Null
                    }
                }
            }
            'ie' {
                foreach ($t in $IETargets) {
                    Clear-CleanFolder -Path (Join-Path $dataPath $t) | Out-Null
                }
            }
        }
    }
}

Invoke-Action -Label 'IE TypedURLs/TypedPaths' -Action {
    Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Internet Explorer\TypedURLs' -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Internet Explorer\TypedPaths' -Recurse -ErrorAction SilentlyContinue
}

# =========================================================================
# 6. 网络 / WiFi 连接记录
# =========================================================================
Write-CleanLog '===== 网络 / WiFi 连接记录 ====='
Clear-RegistrySubkeys 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles'
Clear-RegistrySubkeys 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Signatures'
Clear-RegistrySubkeys 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\NlCache'
Clear-RegistrySubkeys 'HKCU:\Network'
Invoke-Action -Label '删除全部 WiFi 配置(枚举并逐个删除)' -Action {
    $names = @()
    $out = & netsh wlan show profiles 2>$null
    foreach ($line in $out) {
        $idx = $line.IndexOf(':')
        if ($idx -ge 0) {
            $pname = $line.Substring($idx + 1).Trim()
            if ($pname) { $names += $pname }
        }
    }
    foreach ($pn in $names) {
        try { & netsh wlan delete profile name="$pn" 2>$null | Out-Null } catch {}
    }
}
if (Test-Path 'C:\Windows\System32\LogFiles\Firewall') {
    Get-ChildItem 'C:\Windows\System32\LogFiles\Firewall' -Filter '*.log' -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-CleanItem -Path $_.FullName | Out-Null }
}

# =========================================================================
# 7. 网络缓存（PS 2.0 兼容：无 Clear-DnsClientCache，用 ipconfig + 重启 Dnscache）
# =========================================================================
Write-CleanLog '===== 网络缓存 ====='
Invoke-Action -Label 'DNS 缓存' -Action {
    & ipconfig /flushdns 2>$null | Out-Null
    $svc = Get-Service -Name Dnscache -ErrorAction SilentlyContinue
    if ($svc) {
        try {
            Stop-Service -Name Dnscache -Force -ErrorAction SilentlyContinue
            Start-Service -Name Dnscache -ErrorAction SilentlyContinue
        } catch {}
    }
}
Invoke-Action -Label 'ARP 缓存(arp -d *)' -Action { & arp -d * 2>$null | Out-Null }
Invoke-Action -Label 'NetBIOS 缓存(nbtstat -R)' -Action { & nbtstat -R 2>$null | Out-Null }
Invoke-Action -Label 'NetBIOS 名称释放(nbtstat -RR)' -Action { & nbtstat -RR 2>$null | Out-Null }

# =========================================================================
# 8. 汇总
# =========================================================================
Write-CleanLog '===== 清理完成 ====='
$summary = ('统计: 已清理 ' + $script:Stats.Cleaned + '  跳过 ' + $script:Stats.Skipped + '  失败 ' + $script:Stats.Failed)
Write-CleanLog $summary

Write-Host ''
Write-Host '===== 清理完成 =====' -ForegroundColor Green
Write-Host $summary
Write-Host ('日志文件: ' + $LogFile) -ForegroundColor Cyan
if (-not $DryRun) {
    Write-Host '提示: 建议重启电脑，让设备重新枚举、使清理彻底生效。' -ForegroundColor Cyan
}

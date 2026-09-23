#requires -Version 5.1
<#
.SYNOPSIS
  一键清理外接设备插拔记录、联网记录，以及所有已安装浏览器的
  缓存 / 浏览记录 / Cookies / 下载表单 / 密码。
  全自动、不备份、不交互。需管理员权限（脚本会自提权）。

.PARAMETER DryRun
  预演模式：只打印将清理的内容并写入日志，不实际删除。

.NOTES
  风险（按"不备份 + 全自动"设计，用户已知悉）：
   - 当前已连接 USB 设备的枚举项会被删除，下次插拔/重启后重新识别，一般不影响功能。
   - MountedDevices 保留 \DosDevices\C: 与 EFI 映射以避免启动异常。
   - netsh wlan delete profile name=* 删除全部 WiFi 配置含密码，当前 WiFi 会断开。
   - 清空 System 等事件日志会丢失全部历史系统事件。
   - 浏览器：会清空所有已保存密码、Cookies、下载/表单历史、缓存与会话、书签。
     已登录网站需重新登录；书签不可恢复（彻底清空）。
   - 全程无备份、不可回滚。
#>
[CmdletBinding()]
param([switch]$DryRun, [switch]$ViaTask, [switch]$SystemDeviceClean)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# =========================================================================
# 路径、日志、统计
# =========================================================================
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile  = Join-Path $ScriptDir 'Clean-DeviceNetworkHistory.log'

$script:Stats = [pscustomobject]@{ Cleaned = 0; Skipped = 0; Failed = 0 }

function Write-CleanLog {
    param(
        [string]$Message,
        [ValidateSet('INFO','WARN','ERR','DRY')][string]$Level = 'INFO'
    )
    $line = '[{0}][{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    # 日志写入加重试，规避与 SYSTEM 子任务并发写时的瞬间占用
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
    # 删除文件或目录（递归）。返回 $true=已处理，$false=不存在。
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

function Clear-CleanFolder {
    # 清空目录内容但保留空目录。返回 $true=已处理。
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    if ($DryRun) {
        Write-CleanLog "DRYRUN: 清空目录 $Path" 'DRY'
        $script:Stats.Skipped++
        return $true
    }
    try {
        Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        $script:Stats.Cleaned++
        return $true
    } catch {
        Write-CleanLog "清空失败 $Path : $($_.Exception.Message)" 'ERR'
        $script:Stats.Failed++
        return $false
    }
}

# =========================================================================
# 以管理员权限运行，但尽量不弹 UAC
# 思路：创建一个“当前用户 + 最高权限 + 交互式”的计划任务并触发它，
#       由任务计划程序(LocalSystem)直接用提权令牌启动，不弹 UAC。
#       仅当该方式不可用时（如非管理员账户）才回退到 UAC 提权。
# =========================================================================
$script:SelfPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }

function Invoke-NoUacElevation {
    # 返回 $true 表示已通过计划任务启动清理（调用方应 exit）。
    $taskName = 'CleanDeviceNetworkHistory_Task'
    try {
        $argStr = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -ViaTask' -f $script:SelfPath
        if ($DryRun) { $argStr += ' -DryRun' }
        # 任务已存在且参数一致（路径/DryRun 未变）则只触发，不重复注册
        $needRegister = $true
        $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($existing -and $existing.Actions.Count -gt 0 -and $existing.Actions[0].Arguments -eq $argStr) {
            $needRegister = $false
        }
        if ($needRegister) {
            $action     = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argStr
            $principalT = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -RunLevel Highest -LogonType Interactive
            $settings   = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
            Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principalT -Settings $settings -Force -ErrorAction Stop | Out-Null
        }
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
        Write-Host '已通过计划任务以管理员权限启动清理（不弹 UAC）。' -ForegroundColor Green
        Write-Host '清理将在新弹出的 PowerShell 窗口中进行，详见 Clean-DeviceNetworkHistory.log。' -ForegroundColor Cyan
        return $true
    } catch {
        Write-Host "免UAC计划任务启动失败: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

function Invoke-UacElevation {
    Write-Host '回退到 UAC 提权（将弹出确认）...' -ForegroundColor Yellow
    $relaunchArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$($script:SelfPath)`"")
    if ($DryRun) { $relaunchArgs += '-DryRun' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $relaunchArgs -Verb RunAs
}

$current = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($current)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    if (-not $ViaTask) {
        if (Invoke-NoUacElevation) { exit }
        Invoke-UacElevation
        exit
    } else {
        # 由计划任务启动但仍未提权（异常情况），回退 UAC，避免循环
        Invoke-UacElevation
        exit
    }
}

# 初始化日志
$header = if ($DryRun) { '==== 预演开始 {0} ====' } else { '==== 清理开始 {0} ====' }
Set-Content -Path $LogFile -Value ($header -f (Get-Date)) -Encoding UTF8
Write-CleanLog "脚本: $($MyInvocation.MyCommand.Path) | DryRun: $DryRun"

# =========================================================================
# 启用权限令牌（夺权所需）
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
        OpenProcessToken(GetCurrentProcess(), 0x28, out tok);   // TOKEN_QUERY | TOKEN_ADJUST_PRIVILEGES
        LUID l = new LUID();
        LookupPrivilegeValue(null, name, ref l);
        TOKEN_PRIV tp; tp.Count = 1; tp.Luid = l; tp.Attr = 2;  // SE_PRIVILEGE_ENABLED
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
    Write-CleanLog "启用权限令牌失败(继续): $($_.Exception.Message)" 'WARN'
}

# =========================================================================
# 注册表夺权与子项清理
# =========================================================================
function Get-RegHiveAndSub {
    param([string]$Path)
    if ($Path -match '^HKLM:\\(.*)$') { return ,@([Microsoft.Win32.Registry]::LocalMachine, $Matches[1]) }
    if ($Path -match '^HKCU:\\(.*)$') { return ,@([Microsoft.Win32.Registry]::CurrentUser, $Matches[1]) }
    if ($Path -match '^HKU:\\(.*)$')  { return ,@([Microsoft.Win32.Registry]::Users, $Matches[1]) }
    return $null
}

function Reset-RegOwnershipRecursive {
    # 递归夺取所有权并授予 Administrators FullControl，使后续可删子项。
    # 每个节点必须分三步打开：
    #   1) TakeOwnership → SetOwner(Administrators)
    #   2) ChangePermissions|ReadPermissions → 设置 FullControl 规则（所有者隐式拥有 WRITE_DAC）
    #   3) FullControl → 枚举子项（前两步权限掩码不含 EnumerateSubKeys，无法 GetSubKeyNames）
    # -NoRecurse: 只夺本键，不下钻（用于父键）。
    param([string]$RegPath, [switch]$NoRecurse)
    $res = Get-RegHiveAndSub $RegPath
    if (-not $res) { return }
    $hive, $sub = $res[0], $res[1]
    $admins       = New-Object System.Security.Principal.NTAccount('Administrators')
    $fullControl  = [System.Security.AccessControl.RegistryRights]::FullControl
    $changePerm   = [System.Security.AccessControl.RegistryRights]::ChangePermissions -bor [System.Security.AccessControl.RegistryRights]::ReadPermissions
    $rwSubTree    = [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree
    $inheritAll   = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit
    # 只读 Access(DACL)+Owner，不读 Audit(SACL)——避免对 SeSecurityPrivilege 的依赖
    $secAO        = [System.Security.AccessControl.AccessControlSections]::Access -bor [System.Security.AccessControl.AccessControlSections]::Owner
    $stack = New-Object System.Collections.Generic.Stack[string]
    $stack.Push($sub)
    while ($stack.Count -gt 0) {
        $cur = $stack.Pop()
        $owned = $false
        try {
            # 1) 取得所有权
            $key = $hive.OpenSubKey($cur, $rwSubTree, [System.Security.AccessControl.RegistryRights]::TakeOwnership)
            if ($null -ne $key) {
                $acl = $key.GetAccessControl($secAO)
                $acl.SetOwner($admins)
                $key.SetAccessControl($acl)
                $key.Close()
                # 2) 授予 FullControl（所有者隐式拥有 WRITE_DAC，可改 DACL）
                $key = $hive.OpenSubKey($cur, $rwSubTree, $changePerm)
                if ($null -ne $key) {
                    $acl = $key.GetAccessControl($secAO)
                    $rule = New-Object System.Security.AccessControl.RegistryAccessRule(
                        $admins, $fullControl, $inheritAll,
                        [System.Security.AccessControl.PropagationFlags]::None,
                        [System.Security.AccessControl.AccessControlType]::Allow)
                    $acl.SetAccessRule($rule)
                    $key.SetAccessControl($acl)
                    $key.Close()
                    $owned = $true
                }
            }
        } catch {
            Write-CleanLog "夺权失败(设置): $cur : $($_.Exception.Message)" 'WARN'
        }
        if (-not $owned) { continue }
        if ($NoRecurse) { continue }
        try {
            # 3) 以 FullControl 重开以枚举子项（之前权限掩码不含 EnumerateSubKeys）
            $key = $hive.OpenSubKey($cur, $rwSubTree, $fullControl)
            if ($null -ne $key) {
                foreach ($child in $key.GetSubKeyNames()) { $stack.Push("$cur\$child") }
                $key.Close()
            }
        } catch {
            Write-CleanLog "枚举子项失败: $cur : $($_.Exception.Message)" 'WARN'
        }
    }
}

function Clear-RegistrySubkeys {
    # 删除 $RegPath 下所有子项（保留 $RegPath 自身）。受保护时先递归夺权再删。
    param([string]$RegPath)
    if (-not (Test-Path $RegPath)) {
        Write-CleanLog "跳过(不存在): $RegPath"
        $script:Stats.Skipped++
        return
    }
    if ($DryRun) {
        Write-CleanLog "DRYRUN: 清空注册表子项 $RegPath" 'DRY'
        $script:Stats.Skipped++
        return
    }
    $failed = @()
    $children = Get-ChildItem -LiteralPath $RegPath -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        try {
            Remove-Item -Path $child.PSPath -Recurse -Force -ErrorAction Stop
            $script:Stats.Cleaned++
        } catch {
            $failed += $child.PSChildName
        }
    }
    if ($failed.Count -gt 0) {
        Write-CleanLog "$($failed.Count) 个子项受保护，递归夺权后重试..." 'WARN'
        Reset-RegOwnershipRecursive $RegPath
        foreach ($name in $failed) {
            $childPath = Join-Path $RegPath $name
            try {
                Remove-Item -LiteralPath $childPath -Recurse -Force -ErrorAction Stop
                $script:Stats.Cleaned++
            } catch {
                Write-CleanLog "删除失败 $childPath : $($_.Exception.Message)" 'ERR'
                $script:Stats.Failed++
            }
        }
    }
    Write-CleanLog "完成清空子项: $RegPath"
}

function Clear-MountedDevices {
    # 清空 MountedDevices 的全部值，保留 \DosDevices\C: 以防无法启动。
    $reg = 'HKLM:\SYSTEM\MountedDevices'
    if (-not (Test-Path $reg)) { return }
    if ($DryRun) {
        Write-CleanLog 'DRYRUN: 清空 MountedDevices(保留 C:)' 'DRY'
        $script:Stats.Skipped++
        return
    }
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
        Write-CleanLog "直接清空 MountedDevices 失败，夺权后重试: $($_.Exception.Message)" 'WARN'
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

function Get-AllControlSets {
    # 返回所有控制集路径：ControlSet001/002/003... 以及 CurrentControlSet(链接)。
    # 备份控制集里同样保留着设备插拔历史，必须一并清理才算干净。
    $sets = @()
    Get-ChildItem -LiteralPath 'HKLM:\SYSTEM' -ErrorAction SilentlyContinue |
        Where-Object { $_.PSChildName -match '^ControlSet\d+$' } |
        ForEach-Object { $sets += "HKLM:\SYSTEM\$($_.PSChildName)" }
    if (Test-Path 'HKLM:\SYSTEM\CurrentControlSet') { $sets += 'HKLM:\SYSTEM\CurrentControlSet' }
    return $sets
}

function Get-PresentDeviceIds {
    # 返回当前在线设备实例 ID 的哈希集合(大写)。在线设备绝不能删，否则拔插失灵直到重启。
    $set = @{}
    try {
        if (Get-Command Get-PnpDevice -ErrorAction SilentlyContinue) {
            Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.InstanceId) { $set[$_.InstanceId.ToUpper()] = $true }
            }
        }
    } catch {}
    if ($set.Count -eq 0) {
        try {
            Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.DeviceID) { $set[$_.DeviceID.ToUpper()] = $true }
            }
        } catch {}
    }
    return $set
}

function Clear-DeviceEnumHistory {
    # 删除 Enum\<Enumerator> 下“非当前在线”的设备实例，保留在线设备以免拔插失灵。
    # 在线判定：把 <Enumerator>\<HWID>\<Instance> 与 Get-PresentDeviceIds 的结果比对。
    param(
        [string]$RegPath,
        [hashtable]$PresentSet
    )
    if (-not (Test-Path $RegPath)) {
        Write-CleanLog "跳过(不存在): $RegPath"
        $script:Stats.Skipped++
        return
    }
    if ($null -eq $PresentSet -or $PresentSet.Count -eq 0) {
        Write-CleanLog "跳过(未获取到在线设备列表，防止误删): $RegPath" 'WARN'
        $script:Stats.Skipped++
        return
    }
    if ($DryRun) {
        Write-CleanLog "DRYRUN: 清理设备历史(保留在线) $RegPath" 'DRY'
        $script:Stats.Skipped++
        return
    }
    $enumerator = Split-Path $RegPath -Leaf
    Write-CleanLog "清理 $RegPath 历史实例(在线设备数: $($PresentSet.Count))"
    $hwids = Get-ChildItem -LiteralPath $RegPath -ErrorAction SilentlyContinue
    foreach ($hw in $hwids) {
        $hwName = $hw.PSChildName
        $hwReg  = "$RegPath\$hwName"
        $instances = @()
        try { $instances = @(Get-ChildItem -LiteralPath $hwReg -ErrorAction SilentlyContinue) } catch {}
        foreach ($inst in $instances) {
            $instName = $inst.PSChildName
            $fullId   = "$enumerator\$hwName\$instName"
            if ($PresentSet.ContainsKey($fullId.ToUpper())) { continue }  # 在线，保留
            $instReg = "$RegPath\$hwName\$instName"
            try {
                Remove-Item -LiteralPath $instReg -Recurse -Force -ErrorAction Stop
                $script:Stats.Cleaned++
            } catch {
                # 受保护：夺权 父 HWID(单键) + 本实例及 Properties 子树，再删
                Reset-RegOwnershipRecursive $hwReg  -NoRecurse
                Reset-RegOwnershipRecursive $instReg
                try {
                    Remove-Item -LiteralPath $instReg -Recurse -Force -ErrorAction Stop
                    $script:Stats.Cleaned++
                } catch {
                    # 最后回退：reg delete（绕过 PowerShell 注册表 provider 的偶发误报）
                    $regCliPath = 'HKLM\' + ($instReg -replace '^HKLM:\\','')
                    & reg.exe delete $regCliPath /f 2>$null | Out-Null
                    if (-not (Test-Path -LiteralPath $instReg)) {
                        $script:Stats.Cleaned++
                    } else {
                        Write-CleanLog "删除失败 $fullId : $($_.Exception.Message)" 'ERR'
                        $script:Stats.Failed++
                    }
                }
            }
        }
        # 该 HWID 已无实例(纯历史)则删除空 HWID 子键
        $remaining = 0
        try { $remaining = @(Get-ChildItem -LiteralPath $hwReg -ErrorAction SilentlyContinue).Count } catch {}
        if ($remaining -eq 0) {
            try {
                Remove-Item -LiteralPath $hwReg -Force -ErrorAction Stop
            } catch {
                Reset-RegOwnershipRecursive $hwReg -NoRecurse
                try {
                    Remove-Item -LiteralPath $hwReg -Force -ErrorAction Stop
                } catch {
                    $regCli = 'HKLM\' + ($hwReg -replace '^HKLM:\\','')
                    & reg.exe delete $regCli /f 2>$null | Out-Null
                }
            }
        }
    }
    Write-CleanLog "完成 $RegPath"
}

function Invoke-DeviceCleanAsSystem {
    # 以 SYSTEM 身份(经计划任务)执行设备注册表清理——SYSTEM 对 Enum\USB 等有 FullControl，
    # 无需夺权，直接删；规避用户态下 ACL/SACL/权限令牌的各种坑。返回 $true=已执行。
    $taskName = 'CleanDeviceNetworkHistory_SYS'
    try {
        $argStr = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -SystemDeviceClean' -f $script:SelfPath
        $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argStr
        $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType Service -RunLevel Highest
        $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
        Write-CleanLog '已触发 SYSTEM 计划任务执行设备注册表清理，等待完成...'
        $deadline = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 2
            $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
            if ($null -eq $t) { break }
            if ($t.State -ne 'Running' -and $t.State -ne 'Queued' -and $t.State -ne 'Unknown') { break }
        }
        $resultFile = Join-Path $ScriptDir 'Clean-DeviceNetworkHistory.sysclean.log'
        if (Test-Path $resultFile) {
            Get-Content $resultFile | ForEach-Object { Write-CleanLog "[SYS] $_" }
        }
        return $true
    } catch {
        Write-CleanLog "SYSTEM 计划任务方式失败: $($_.Exception.Message)" 'WARN'
        return $false
    }
}

# ---- SYSTEM 子任务执行体：以 SYSTEM 身份清理 HKLM 设备注册表（直接删，无需夺权）----
if ($SystemDeviceClean) {
    $sysLog = Join-Path $ScriptDir 'Clean-DeviceNetworkHistory.sysclean.log'
    "SYS-START $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Set-Content $sysLog -Encoding UTF8
    $presentIds = Get-PresentDeviceIds
    "在线设备数: $($presentIds.Count)" | Add-Content $sysLog -Encoding UTF8
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
                    $fullId = "$enumName\$hwName\$instName"
                    if ($presentIds.ContainsKey($fullId.ToUpper())) { $skipped++; continue }
                    $instReg = Join-Path $hwReg $instName
                    try {
                        Remove-Item -LiteralPath $instReg -Recurse -Force -ErrorAction Stop
                        $cleaned++
                    } catch {
                        # 个别项可能被 PnP 占用，尝试先夺权(SYSTEM 也有 SeTakeOwnership)再删
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
    # MTP / 便携设备
    $wpd = 'HKLM:\SOFTWARE\Microsoft\Windows Portable Devices'
    if (Test-Path $wpd) {
        Get-ChildItem -LiteralPath $wpd -ErrorAction SilentlyContinue | ForEach-Object {
            try { Remove-Item -LiteralPath $_.PSPath -Recurse -Force -ErrorAction Stop; $cleaned++ } catch { $failed++ }
        }
    }
    "SYS-DONE cleaned=$cleaned failed=$failed skipped=$skipped $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Add-Content $sysLog -Encoding UTF8
    exit
}

# =========================================================================
# 2. USB / 外接设备枚举注册表
# =========================================================================
Write-CleanLog '===== USB / 外接设备枚举注册表 ====='

# 优先以 SYSTEM 身份清理(最可靠)：删除所有控制集下 Enum\USB/USBSTOR/HID/SWD 的非在线实例 + 便携设备。
# 失败则回退到用户态夺权方式。
$sysDone = Invoke-DeviceCleanAsSystem
if (-not $sysDone) {
    Write-CleanLog '回退用户态夺权清理设备历史' 'WARN'
    $usbEnumRel = @('Enum\USB','Enum\USBSTOR','Enum\HID','Enum\SWD')
    $controlSets = Get-AllControlSets
    if ($controlSets.Count -eq 0) { $controlSets = @('HKLM:\SYSTEM\CurrentControlSet') }
    $presentIds = Get-PresentDeviceIds
    foreach ($cs in $controlSets) {
        Write-CleanLog "控制集: $cs"
        foreach ($rel in $usbEnumRel) { Clear-DeviceEnumHistory -RegPath (Join-Path $cs $rel) -PresentSet $presentIds }
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
    Invoke-Action -Label "事件日志 $lg" -Action {
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
    # 浏览器主进程
    'chrome','msedge','MicrosoftEdge','firefox','brave','opera','opera GX','vivaldi',
    '360chrome','360Chrome','360se','360Browser','QQBrowser','SogouExplorer','iexplore',
    'UCBrowser','Maxthon','Maxthon3','baidu','Baidu','Spark','Amigo',
    'dragon','Iron','CentBrowser','CocCoc','Yandex','liebao',
    # 浏览器后台/更新器/WebView（会重新拉起浏览器，导致文件被占用）
    'msedgewebview2','MicrosoftEdgeUpdate','MicrosoftEdgeWebView2','setuptemp','edgehtml',
    'GoogleUpdate','googlecrashhandler','GoogleCrashHandler64',
    'Crashpad','Crashpad_handler','notification_helper',
    # 可能占用设备注册表读取的工具
    'usbdeview','USBDeview','DeviceCensus','dmcmd'
)
function Stop-LockingProcesses {
    # 强制结束可能占用浏览器/设备注册表数据的进程。
    param([string[]]$Names)
    foreach ($n in $Names) {
        try { Stop-Process -Name $n -Force -ErrorAction SilentlyContinue } catch {}
    }
}
if (-not $DryRun) {
    Stop-LockingProcesses $BrowserProcessNames
    Start-Sleep -Seconds 1
    Stop-LockingProcesses $BrowserProcessNames
    Write-CleanLog '已强制结束浏览器及相关占用进程，等待句柄释放...'
    Start-Sleep -Seconds 2
} else {
    Write-CleanLog "DRYRUN: 将结束进程 $($BrowserProcessNames -join ', ')" 'DRY'
    $script:Stats.Skipped++
}

$BrowserDefs = @(
    # Chromium 系
    @{ Name='Chrome';         Engine='chromium'; DataPath='{U}\AppData\Local\Google\Chrome\User Data' }
    @{ Name='ChromeCanary';   Engine='chromium'; DataPath='{U}\AppData\Local\Google\Chrome SxS\User Data' }
    @{ Name='Edge';           Engine='chromium'; DataPath='{U}\AppData\Local\Microsoft\Edge\User Data' }
    @{ Name='EdgeBeta';       Engine='chromium'; DataPath='{U}\AppData\Local\Microsoft\Edge Beta\User Data' }
    @{ Name='EdgeDev';        Engine='chromium'; DataPath='{U}\AppData\Local\Microsoft\Edge Dev\User Data' }
    @{ Name='EdgeCanary';     Engine='chromium'; DataPath='{U}\AppData\Local\Microsoft\Edge SxS\User Data' }
    @{ Name='Brave';          Engine='chromium'; DataPath='{U}\AppData\Local\BraveSoftware\Brave-Browser\User Data' }
    @{ Name='Vivaldi';        Engine='chromium'; DataPath='{U}\AppData\Local\Vivaldi\User Data' }
    @{ Name='Opera';          Engine='chromium'; DataPath='{U}\AppData\Local\Opera Software\Opera Stable' }
    @{ Name='OperaGX';        Engine='chromium'; DataPath='{U}\AppData\Local\Opera Software\Opera GX Stable' }
    @{ Name='Chromium';       Engine='chromium'; DataPath='{U}\AppData\Local\Chromium\User Data' }
    @{ Name='360Chrome';      Engine='chromium'; DataPath='{U}\AppData\Local\360Chrome\Chrome\User Data' }
    @{ Name='360ChromeX';     Engine='chromium'; DataPath='{U}\AppData\Local\360ChromeX\Chrome\User Data' }
    @{ Name='360Browser';     Engine='chromium'; DataPath='{U}\AppData\Local\360Browser\Chrome\User Data' }
    @{ Name='QQBrowser';      Engine='chromium'; DataPath='{U}\AppData\Local\Tencent\QQBrowser\User Data' }
    @{ Name='CentBrowser';    Engine='chromium'; DataPath='{U}\AppData\Local\CentBrowser\User Data' }
    @{ Name='CocCoc';         Engine='chromium'; DataPath='{U}\AppData\Local\CocCoc\Browser\User Data' }
    @{ Name='ComodoDragon';   Engine='chromium'; DataPath='{U}\AppData\Local\Comodo\Dragon\User Data' }
    @{ Name='Amigo';          Engine='chromium'; DataPath='{U}\AppData\Local\Amigo\User Data' }
    @{ Name='Yandex';         Engine='chromium'; DataPath='{U}\AppData\Local\Yandex\YandexBrowser\User Data' }
    @{ Name='Spark';          Engine='chromium'; DataPath='{U}\AppData\Local\Spark\User Data' }
    # Firefox
    @{ Name='Firefox-Roaming'; Engine='firefox-roam';  DataPath='{U}\AppData\Roaming\Mozilla\Firefox\Profiles' }
    @{ Name='Firefox-Local';    Engine='firefox-local'; DataPath='{U}\AppData\Local\Mozilla\Firefox\Profiles' }
    # IE / 旧版 Edge
    @{ Name='IE/EdgeLegacy';    Engine='ie';            DataPath='{U}\AppData\Local\Microsoft\Windows' }
    # 其它（百度/搜狗/猎豹等非 Chromium 标准目录，整目录清理）
    @{ Name='Baidu';            Engine='dirclean'; DataPath='{U}\AppData\Roaming\Baidu' }
    @{ Name='BaiduLocal';       Engine='dirclean'; DataPath='{U}\AppData\Local\Baidu' }
    @{ Name='SogouExplorer';    Engine='dirclean'; DataPath='{U}\AppData\Roaming\SogouExplorer' }
    @{ Name='SogouLocal';       Engine='dirclean'; DataPath='{U}\AppData\Local\SogouExplorer' }
    @{ Name='liebao';           Engine='dirclean'; DataPath='{U}\AppData\Local\liebao' }
    @{ Name='Maxthon';          Engine='dirclean'; DataPath='{U}\AppData\Roaming\Maxthon3' }
    @{ Name='MaxthonLocal';     Engine='dirclean'; DataPath='{U}\AppData\Local\Maxthon3' }
    @{ Name='UCBrowser';        Engine='dirclean'; DataPath='{U}\AppData\Local\UCBrowser' }
)

# Chromium 系：每个 profile 下要删的文件 / 目录
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
Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notin $excludeUsers } |
    ForEach-Object { $UserHomes += $_.FullName }

function Remove-CleanItemRetry {
    # 删除文件/目录；若被占用，先杀占用进程再重试，最多 3 轮。
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    if ($DryRun) { Write-CleanLog "DRYRUN: 删除 $Path" 'DRY'; $script:Stats.Skipped++; return $true }
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            $script:Stats.Cleaned++
            return $true
        } catch {
            # 被占用：杀浏览器进程后重试
            if ($attempt -lt 2) {
                Stop-LockingProcesses $BrowserProcessNames
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

foreach ($userHome in $UserHomes) {
    foreach ($bdef in $BrowserDefs) {
        $dataPath = $bdef.DataPath.Replace('{U}', $userHome)
        if (-not (Test-Path -LiteralPath $dataPath)) { continue }
        Write-CleanLog "处理浏览器 $($bdef.Name) @ $dataPath"
        switch ($bdef.Engine) {
            'chromium' {
                $profiles = Get-ChildItem -LiteralPath $dataPath -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' -or $_.Name -eq 'Guest Profile' }
                foreach ($p in $profiles) {
                    foreach ($t in $ChromiumTargets) {
                        Remove-CleanItemRetry -Path (Join-Path $p.FullName $t) | Out-Null
                    }
                }
            }
            'firefox-roam' {
                $profiles = Get-ChildItem -LiteralPath $dataPath -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like '*.default*' }
                foreach ($p in $profiles) {
                    foreach ($t in $FirefoxRoamTargets) {
                        Remove-CleanItemRetry -Path (Join-Path $p.FullName $t) | Out-Null
                    }
                }
            }
            'firefox-local' {
                $profiles = Get-ChildItem -LiteralPath $dataPath -Directory -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like '*.default*' }
                foreach ($p in $profiles) {
                    foreach ($t in $FirefoxLocalTargets) {
                        Remove-CleanItemRetry -Path (Join-Path $p.FullName $t) | Out-Null
                    }
                }
            }
            'ie' {
                foreach ($t in $IETargets) {
                    Clear-CleanFolder -Path (Join-Path $dataPath $t) | Out-Null
                }
            }
            'dirclean' {
                # 非标准 Chromium 目录的浏览器（百度/搜狗/猎豹/Maxthon/UC）：清空目录内容
                Clear-CleanFolder -Path $dataPath | Out-Null
            }
        }
    }
}

# IE TypedURLs / TypedPaths（当前用户）
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
# 7. 网络缓存
# =========================================================================
Write-CleanLog '===== 网络缓存 ====='
Invoke-Action -Label 'DNS 缓存(Clear-DnsClientCache)' -Action {
    if (Get-Command Clear-DnsClientCache -ErrorAction SilentlyContinue) {
        Clear-DnsClientCache -ErrorAction SilentlyContinue
    }
    & ipconfig /flushdns 2>$null | Out-Null
    # 重启 DNS Client 服务，强制清空服务级持久化缓存
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
$summary = '统计: 已清理 {0}  跳过 {1}  失败 {2}' -f $script:Stats.Cleaned, $script:Stats.Skipped, $script:Stats.Failed
Write-CleanLog $summary

Write-Host ''
Write-Host '===== 清理完成 =====' -ForegroundColor Green
Write-Host $summary
Write-Host "日志文件: $LogFile" -ForegroundColor Cyan
if (-not $DryRun) {
    Write-Host '提示: 部分清理(如设备重新枚举、WiFi 配置)可能需要重新插拔或重启后完全生效。' -ForegroundColor Cyan
}

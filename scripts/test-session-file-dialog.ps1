# Owned native smoke-test dialog only. No clipboard or keyboard automation.
param([Parameter(Mandatory)][int]$AppProcessId,[string]$FilePath,[switch]$Cancel)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$deadline=[DateTime]::UtcNow.AddSeconds(25)
$window=$null
while([DateTime]::UtcNow -lt $deadline){
    $windows=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$AppProcessId))
    foreach($item in $windows){if($item.Current.Name -in @('Export CoCo sessions','Import CoCo sessions')){$window=$item;break}}
    if($window){break}
    Start-Sleep -Milliseconds 150
}
if(!$window){throw 'Owned test file dialog did not appear.'}

Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;using System.Text;
public static class OwnedSessionDialog {
public delegate bool Callback(IntPtr h,IntPtr l);
[DllImport("user32.dll")]public static extern bool EnumChildWindows(IntPtr h,Callback cb,IntPtr l);
[DllImport("user32.dll")]public static extern int GetDlgCtrlID(IntPtr h);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,StringBuilder b,int n);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,string l);
[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
}
"@
$controls=[Collections.Generic.Dictionary[int,IntPtr]]::new()
$callback=[OwnedSessionDialog+Callback]{param($handle,$extra)
    $class=[Text.StringBuilder]::new(256)
    [void][OwnedSessionDialog]::GetClassName($handle,$class,256)
    $id=[OwnedSessionDialog]::GetDlgCtrlID($handle)
    if(($id -in @(1001,1148) -and $class.ToString() -eq 'Edit') -or ($id -in @(1,2) -and $class.ToString() -eq 'Button')){$controls[$id]=$handle}
    return $true
}
do {
    $controls.Clear()
    [void][OwnedSessionDialog]::EnumChildWindows([IntPtr]$window.Current.NativeWindowHandle,$callback,[IntPtr]::Zero)
    if($controls.ContainsKey(1) -and $controls.ContainsKey(2) -and ($Cancel -or $controls.ContainsKey(1001) -or $controls.ContainsKey(1148))){break}
    Start-Sleep -Milliseconds 150
}while([DateTime]::UtcNow -lt $deadline)
if($Cancel){$actionId=2}else{
    if(![IO.Path]::IsPathFullyQualified($FilePath)){throw 'Absolute fixture file required.'}
    $fieldId=if($controls.ContainsKey(1001)){1001}else{1148}
    if(!$controls.ContainsKey($fieldId)){throw 'Owned filename input not found.'}
    [void][OwnedSessionDialog]::SendMessage($controls[$fieldId],0x000C,[IntPtr]::Zero,$FilePath)
    $actionId=1
}
if(!$controls.ContainsKey($actionId)){throw 'Owned dialog action not found.'}
if(![OwnedSessionDialog]::PostMessage($controls[$actionId],0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Could not complete owned dialog.'}
Write-Output 'Owned file dialog completed.'

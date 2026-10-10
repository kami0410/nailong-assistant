param([string]$Handles, [string]$OutDir, [int]$ProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
namespace BrandProbe {
  public class Window { public string kind; public long hwnd; }
  [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid fmt; public uint id; }
  [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value {
    [FieldOffset(0)] public ushort type;
    [FieldOffset(8)] public IntPtr pointer;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface Store {
    uint GetCount(); void GetAt(uint i, out Key key);
    void GetValue(ref Key key, out Value value);
    void SetValue(ref Key key, ref Value value); void Commit();
  }
  public static class Native {
    delegate bool EnumProc(IntPtr hwnd, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder buffer, int length);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder buffer, int length);
    public static Window[] Windows(int process) {
      var result = new List<Window>();
      EnumWindows((hwnd,state) => {
        uint owner; GetWindowThreadProcessId(hwnd,out owner);
        if (owner != process) return true;
        var cls=new StringBuilder(128); GetClassName(hwnd,cls,128);
        var title=new StringBuilder(256); GetWindowText(hwnd,title,256);
        if(cls.ToString()=="Chrome_WidgetWin_1" && title.Length>0) result.Add(new Window {kind="window"+result.Count,hwnd=hwnd.ToInt64()});
        return true;
      }, IntPtr.Zero);
      return result.ToArray();
    }
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out Store store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    public static string Property(long hwnd, uint id) {
      Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); Store store;
      Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(new IntPtr(hwnd), ref iid, out store));
      try {
        Key key = new Key {fmt=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id=id}; Value value;
        store.GetValue(ref key, out value);
        try { return value.type == 31 ? Marshal.PtrToStringUni(value.pointer) : null; }
        finally { PropVariantClear(ref value); }
      } finally { Marshal.ReleaseComObject(store); }
    }
  }
}
'@
$probeRows = @()
$probeEntries = if ($Handles) { $Handles | ConvertFrom-Json } else { [BrandProbe.Native]::Windows($ProcessId) }
if (-not $probeEntries) { throw 'No owned application windows found' }
foreach ($probeEntry in $probeEntries) {
  $probeHwnd = [IntPtr][long]$probeEntry.hwnd
  $probeRow = [ordered]@{ kind=$probeEntry.kind; appId=[BrandProbe.Native]::Property($probeEntry.hwnd,5); iconResource=[BrandProbe.Native]::Property($probeEntry.hwnd,3); relaunchCommand=[BrandProbe.Native]::Property($probeEntry.hwnd,2); displayName=[BrandProbe.Native]::Property($probeEntry.hwnd,4); icons=@() }
  foreach ($probeSize in @(0,1)) {
    $probeResult = [IntPtr]::Zero
    [void][BrandProbe.Native]::SendMessageTimeout($probeHwnd,0x7F,[IntPtr]$probeSize,[IntPtr]::Zero,2,2000,[ref]$probeResult)
    if ($probeResult -eq [IntPtr]::Zero) { throw "WM_GETICON returned no icon for $($probeEntry.kind)/$probeSize" }
    $probeIcon = [System.Drawing.Icon]::FromHandle($probeResult)
    $probeBitmap = $probeIcon.ToBitmap()
    try {
      $probeFile = "$($probeEntry.kind)-$probeSize.png"
      $probeBitmap.Save((Join-Path $OutDir $probeFile), [System.Drawing.Imaging.ImageFormat]::Png)
      $probeRow.icons += @{ file=$probeFile; width=$probeBitmap.Width; height=$probeBitmap.Height }
    } finally { $probeBitmap.Dispose(); $probeIcon.Dispose() }
  }
  $probeRows += $probeRow
}
$probeJson = ConvertTo-Json -InputObject @($probeRows) -Depth 5 -Compress
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probeJson))

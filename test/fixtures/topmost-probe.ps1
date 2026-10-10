param([long]$Pet, [long]$Cover, [switch]$FocusCover)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TopmostProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint process);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  public static void Focus(long window) {
    uint ignored;
    uint current=GetCurrentThreadId(), foreground=GetWindowThreadProcessId(GetForegroundWindow(),out ignored);
    uint target=GetWindowThreadProcessId(new IntPtr(window),out ignored);
    bool first=current!=foreground && AttachThreadInput(current,foreground,true);
    bool second=current!=target && AttachThreadInput(current,target,true);
    try { SetForegroundWindow(new IntPtr(window)); }
    finally { if(second) AttachThreadInput(current,target,false); if(first) AttachThreadInput(current,foreground,false); }
  }
  public static bool Above(long upper, long lower) {
    IntPtr h = new IntPtr(lower);
    for (int i=0; i<10000; i++) {
      h = GetWindow(h, 3);
      if (h == IntPtr.Zero) return false;
      if (h.ToInt64() == upper) return true;
    }
    return false;
  }
}
'@
if ($FocusCover) { [TopmostProbe]::Focus($Cover) }
[ordered]@{
  petTopmost = (([TopmostProbe]::GetWindowLongPtr([IntPtr]$Pet,-20).ToInt64() -band 8) -ne 0)
  petAboveCover = [TopmostProbe]::Above($Pet,$Cover)
  foreground = [TopmostProbe]::GetForegroundWindow().ToInt64()
} | ConvertTo-Json -Compress

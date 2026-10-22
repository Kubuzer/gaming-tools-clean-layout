# IShellLinkW/IPersistFile keep Unicode paths intact; WScript.Shell transliterates them.
if (-not ('CleanLayoutShortcut' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
class ShellLinkObject {}
[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellLinkW {
 void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, IntPtr data, uint flags);
 void GetIDList(out IntPtr list); void SetIDList(IntPtr list);
 void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int count);
 void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
 void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count);
 void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
 void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int count);
 void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
 void GetHotkey(out short key); void SetHotkey(short key);
 void GetShowCmd(out int command); void SetShowCmd(int command);
 void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int count, out int index);
 void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
 void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
 void Resolve(IntPtr window, uint flags);
 void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
}
public static class CleanLayoutShortcut {
 public static string[] Read(string file) {
  var link = (IShellLinkW)new ShellLinkObject();
  try {
   ((IPersistFile)link).Load(file, 0);
   var target = new StringBuilder(32768); var args = new StringBuilder(32768);
   link.GetPath(target, target.Capacity, IntPtr.Zero, 0); link.GetArguments(args, args.Capacity);
   return new [] {target.ToString(), args.ToString()};
  } finally { Marshal.FinalReleaseComObject(link); }
 }
 public static void Write(string file, string target, string args, string directory, string icon) {
  var link = (IShellLinkW)new ShellLinkObject();
  try {
   link.SetPath(target); link.SetArguments(args); link.SetWorkingDirectory(directory);
   link.SetIconLocation(icon, 0); link.SetDescription("Local CSS layout for gaming.tools Companion");
   link.SetShowCmd(1); ((IPersistFile)link).Save(file, true);
  } finally { Marshal.FinalReleaseComObject(link); }
 }
}
'@
}

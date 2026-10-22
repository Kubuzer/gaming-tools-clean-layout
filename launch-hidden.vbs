Option Explicit
Dim shell, files, folder, config, nodePath, stream, line
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
config = files.BuildPath(folder, "node-path.txt")
If Not files.FileExists(config) Then
  MsgBox "Run install.ps1 before using Clean Layout.", vbExclamation, "gaming.tools Clean Layout"
  WScript.Quit 1
End If
Set stream = files.OpenTextFile(config, 1, False, -1)
nodePath = stream.ReadAll
stream.Close
nodePath = Trim(nodePath)
If Not files.FileExists(nodePath) Then
  MsgBox "Node.js has moved or is missing. Run install.ps1 again.", vbExclamation, "gaming.tools Clean Layout"
  WScript.Quit 1
End If
shell.Run """" & nodePath & """ """ & files.BuildPath(folder, "launch.mjs") & """", 0, False

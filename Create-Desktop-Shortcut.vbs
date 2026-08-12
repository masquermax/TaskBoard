Option Explicit

Dim shell, fso, base, desktop, shortcut, q, target
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

q = Chr(34)
base = fso.GetParentFolderName(WScript.ScriptFullName)
target = base & "\TaskBoard.vbs"

If Not fso.FileExists(target) Then
  MsgBox "TaskBoard.vbs was not found:" & vbCrLf & target, 16, "TaskBoard"
  WScript.Quit 2
End If

desktop = shell.SpecialFolders("Desktop")
Set shortcut = shell.CreateShortcut(desktop & "\TaskBoard.lnk")
shortcut.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
shortcut.Arguments = q & target & q
shortcut.WorkingDirectory = base
shortcut.IconLocation = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\shell32.dll,220")
shortcut.Description = "TaskBoard Local AI Workspace"
shortcut.Save

MsgBox "TaskBoard desktop shortcut created.", 64, "TaskBoard"

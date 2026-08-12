Option Explicit

Dim shell, fso, base, stopper, rc
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
stopper = base & "\scripts\windows-stop.mjs"

If Not fso.FileExists(stopper) Then
  MsgBox "TaskBoard stop script was not found:" & vbCrLf & stopper, 16, "TaskBoard"
  WScript.Quit 2
End If

shell.CurrentDirectory = base
rc = shell.Run("node scripts\windows-stop.mjs", 0, True)
If rc <> 0 Then
  MsgBox "TaskBoard is not running or could not be stopped.", 48, "TaskBoard"
  WScript.Quit rc
End If

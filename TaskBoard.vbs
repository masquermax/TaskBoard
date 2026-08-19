Option Explicit

Dim shell, fso, base, launcher, rc, url
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = base & "\scripts\windows-launcher.mjs"
url = "http://127.0.0.1:4317"

If Not fso.FileExists(launcher) Then
  MsgBox "TaskBoard launcher was not found:" & vbCrLf & launcher, 16, "TaskBoard"
  WScript.Quit 2
End If

shell.CurrentDirectory = base
shell.Environment("PROCESS")("TASKBOARD_LOG_LEVEL") = "info"
rc = shell.Run("cmd.exe /d /c node --version >nul 2>&1", 0, True)
If rc <> 0 Then
  MsgBox "Node.js was not found in PATH. Please install Node.js or add node.exe to PATH.", 16, "TaskBoard"
  WScript.Quit 3
End If

rc = shell.Run("node scripts\windows-launcher.mjs", 0, True)
If rc <> 0 Then
  MsgBox "TaskBoard failed to start." & vbCrLf & "See: " & base & "\data\runtime\taskboard.log", 16, "TaskBoard"
  WScript.Quit rc
End If

shell.Run url, 1, False

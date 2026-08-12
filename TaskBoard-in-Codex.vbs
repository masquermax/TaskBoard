Option Explicit

Dim shell, fso, base, rc, choice, msg, errFile, ts, detail
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = base
shell.Environment("PROCESS")("TASKBOARD_SURFACES") = "on"
errFile = fso.BuildPath(base, "data\runtime\codex-surface-error.txt")

rc = shell.Run("node scripts\windows-launcher.mjs", 0, True)
If rc <> 0 Then
  MsgBox "TaskBoard failed to start. See data\runtime\taskboard.log", 16, "TaskBoard"
  WScript.Quit rc
End If

rc = shell.Run("node scripts\windows-surface-launcher.mjs --surface codex", 0, True)
If rc = 4 Or rc = 9 Then
  If rc = 9 Then
    msg = "Codex is running, but its current renderer could not host the TaskBoard surface." & vbCrLf
  Else
    msg = "Codex is already running without the TaskBoard surface enabled." & vbCrLf
  End If
  msg = msg & "Restarting Codex is required before TaskBoard can be embedded." & vbCrLf & vbCrLf
  msg = msg & "Restart Codex now? Running Codex work may be interrupted."
  choice = MsgBox(msg, 49, "TaskBoard")
  If choice = 1 Then
    rc = shell.Run("node scripts\windows-surface-launcher.mjs --surface codex --restart-existing", 0, True)
  Else
    shell.Run "http://127.0.0.1:4317", 1, False
    WScript.Quit 0
  End If
End If

If rc <> 0 Then
  detail = ""
  If fso.FileExists(errFile) Then
    Set ts = fso.OpenTextFile(errFile, 1, False)
    detail = Trim(ts.ReadAll)
    ts.Close
  End If
  msg = "TaskBoard is running, but it could not be embedded in Codex."
  If detail <> "" Then msg = msg & vbCrLf & vbCrLf & detail
  msg = msg & vbCrLf & vbCrLf & "Diagnostics: data\runtime\codex-surface.log"
  MsgBox msg, 48, "TaskBoard"
  shell.Run "http://127.0.0.1:4317", 1, False
End If

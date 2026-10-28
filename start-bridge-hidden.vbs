Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\PC\Documents\Miruro Discord RPC"
WshShell.Run "cmd.exe /c node bridge.js", 0, False

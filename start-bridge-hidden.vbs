Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\PC\Documents\Miruro Discord RPC"
WshShell.Run "node start-detached.js", 0, False

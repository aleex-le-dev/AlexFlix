' AlexFlix - agent de synchronisation (lance sans fenetre a l'ouverture de session Windows).
' Surveille le bouton « Synchroniser maintenant » de la page Parametres du site.
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = root
shell.Run "cmd /c npm.cmd run sync-agent --prefix server >> """ & root & "\data\sync-agent.log"" 2>&1", 0, False

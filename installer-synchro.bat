@echo off
rem AlexFlix - active le bouton « Synchroniser maintenant » de la page Parametres du site.
rem Place un lanceur dans le dossier Demarrage de Windows (aucun droit administrateur) :
rem l'agent de synchronisation demarre sans fenetre a chaque ouverture de session.
rem Pour le retirer : supprimer « AlexFlix Sync.vbs » dans shell:startup
cd /d "%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\AlexFlix Sync.vbs" echo ' AlexFlix - lance l'agent de synchronisation au demarrage de Windows (sans fenetre).
>> "%STARTUP%\AlexFlix Sync.vbs" echo CreateObject("WScript.Shell").Run "wscript.exe ""%~dp0sync-agent.vbs""", 0, False
start "" wscript.exe "%STARTUP%\AlexFlix Sync.vbs"
echo OK : l'agent tourne et redemarrera tout seul a chaque ouverture de session.
pause

@echo off
setlocal
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
if exist "%ROOT%\node_modules\electron\dist\electron.exe" (
  start "" "%ROOT%\node_modules\electron\dist\electron.exe" "%ROOT%"
) else (
  start "" "%ROOT%\node_modules\.bin\electron.cmd" "%ROOT%"
)
exit /b

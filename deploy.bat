@echo off
chcp 65001 >nul
title Variedades Angie - Subir cambios
echo ============================================
echo   Variedades Angie - Subir cambios a GitHub
echo ============================================
echo.

cd /d "%~dp0"

git add -A
if errorlevel 1 goto :error

git status --short

echo.
set /p msg=Descripcion del cambio (ej: "Desbloqueo de cuentas para admins"): 

if "%msg%"=="" set msg=Actualizacion del sistema

git commit -m "%msg%"
if errorlevel 1 goto :error

git pull --no-edit
if errorlevel 1 goto :error

git push
if errorlevel 1 goto :error

echo.
echo ============================================
echo   OK! Cambios subidos a GitHub.
echo   Ahora en PythonAnywhere (Consoles > Bash):
echo     cd /home/Angie112890/Variedades-angie
echo     git pull
echo     (Web > Reload)
echo ============================================
pause
exit /b 0

:error
echo.
echo Hubo un error. Revisa el mensaje de arriba.
pause
exit /b 1

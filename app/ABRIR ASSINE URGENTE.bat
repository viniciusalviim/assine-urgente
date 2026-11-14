@echo off
chcp 65001 >nul
title Assine, Urgente!
cd /d "%~dp0"

rem Procura o Rscript.exe: registro do Windows, pastas padrao e PATH
set "RHOME="
set "RSCRIPT="
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\R-core\R" /v InstallPath 2^>nul ^| find "InstallPath"') do set "RHOME=%%B"
if not defined RHOME for /f "tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\R-core\R" /v InstallPath 2^>nul ^| find "InstallPath"') do set "RHOME=%%B"
if defined RHOME if exist "%RHOME%\bin\Rscript.exe" set "RSCRIPT=%RHOME%\bin\Rscript.exe"

if not defined RSCRIPT for /d %%D in ("%ProgramFiles%\R\R-*") do if exist "%%D\bin\Rscript.exe" set "RSCRIPT=%%D\bin\Rscript.exe"
if not defined RSCRIPT for /d %%D in ("%LOCALAPPDATA%\Programs\R\R-*") do if exist "%%D\bin\Rscript.exe" set "RSCRIPT=%%D\bin\Rscript.exe"
if not defined RSCRIPT (
  where Rscript >nul 2>nul && set "RSCRIPT=Rscript"
)

if not defined RSCRIPT (
  echo.
  echo  Nao encontrei o R neste computador.
  echo  Instale o R pelo site https://cran.r-project.org e tente de novo.
  echo.
  pause
  exit /b 1
)

"%RSCRIPT%" iniciar.R
if errorlevel 1 pause

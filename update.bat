@echo off
setlocal
cd /d "%~dp0"

rem fetches the newest tabs, beats and time - start.bat builds them by itself on its next start.

for %%r in (Tabs Beats Time) do (
  echo   %%r ...
  git -C "%~dp0..\%%r" pull --ff-only || goto :fail
)
echo.
echo   updated - close the start.bat window and open it again.
pause
exit /b 0

:fail
echo.
echo   update failed - see above. the running jam is untouched.
pause
exit /b 1

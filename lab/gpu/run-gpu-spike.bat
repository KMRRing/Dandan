@echo off
rem The GPU spike (lab/GPU-SPIKE.md) on this PC's graphics card: double-click, wait a minute or two, and the result opens
rem in Notepad and is on the clipboard to paste back to Claude. It fetches the two spike files from the Dandan site, finds a
rem Python with a CUDA-enabled PyTorch (the one Forge already installed, else Python 3.12 if it has one, else it installs
rem PyTorch into a folder of its own, about 2.5 GB), and runs the benchmark. Nothing outside %USERPROFILE%\DandanGPU is changed.
setlocal
set "DIR=%USERPROFILE%\DandanGPU"
set "OUT=%DIR%\result.txt"
set "SITE=https://kmrring.github.io/Dandan/lab/gpu"
if not exist "%DIR%" mkdir "%DIR%"
cd /d "%DIR%"

echo Fetching the spike...
curl -fsSL -o mini.py "%SITE%/mini.py" || goto :nofetch
curl -fsSL -o mini.mjs "%SITE%/mini.mjs"

set "PY="
set "FORGE=%USERPROFILE%\Downloads\forge (1)\Forge\.venv\Scripts\python.exe"
if exist "%FORGE%" "%FORGE%" -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)" && set "PY=%FORGE%"
if defined PY goto :run
py -3.12 -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)" 2>nul && for /f "delims=" %%p in ('py -3.12 -c "import sys; print(sys.executable)"') do set "PY=%%p"
if defined PY goto :run
if exist "%DIR%\venv\Scripts\python.exe" goto :ownvenv
echo No Python with a CUDA PyTorch found: installing one in %DIR%\venv (about 2.5 GB, this takes a while)...
py -3.12 -m venv "%DIR%\venv" || goto :nopython
"%DIR%\venv\Scripts\python.exe" -m pip install --quiet torch --index-url https://download.pytorch.org/whl/cu124 || goto :noinstall
:ownvenv
set "PY=%DIR%\venv\Scripts\python.exe"

:run
echo Running on the graphics card (a minute or two)...
echo Dandan GPU spike, %DATE% %TIME% > "%OUT%"
"%PY%" mini.py bench >> "%OUT%" 2>&1
where node >nul 2>nul && (echo One CPU core, the JavaScript engine: >> "%OUT%" & node mini.mjs 200000 >> "%OUT%" 2>&1)
type "%OUT%"
type "%OUT%" | clip
start notepad "%OUT%"
echo.
echo Done: the result is open in Notepad and on the clipboard.
pause
exit /b 0

:nofetch
echo Could not download the spike from %SITE%. Is the internet on?
pause
exit /b 1
:nopython
echo Python 3.12 was not found (the py launcher). Tell Claude.
pause
exit /b 1
:noinstall
echo Installing PyTorch failed. Tell Claude what the window says above.
pause
exit /b 1

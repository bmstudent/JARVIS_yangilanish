@echo off
chcp 65001 > nul
title JARVIS MARK XXXIX — DESKTOP LAUNCHER
color 0B
cls

echo ======================================================================
echo          MARK XXXIX — JARVIS STANDALONE DESKTOP APPLICATION
echo ======================================================================
echo.
echo   [1] Python Native Desktop Oynasi (PyQt6 brauzersiz mustaqil dastur)
echo   [2] 3D Holografik Kinetic OS (Standalone App Oynasi, brauzersiz rejim)
echo   [3] Telegram Masofaviy Boshqaruv Boti (Telefoningizdan kompyuterni boshqarish)
echo   [4] JARVIS + Telegram Botni birga ishga tushirish
echo   [5] Kutubxonalarni avtomatik o'rnatish (pip install ^& npm install)
echo   [6] Chiqish
echo.
echo ======================================================================
set /p tanlov="Tanlovingizni kiriting [1, 2, 3, 4, 5 yoki 6]: "

if "%tanlov%"=="1" goto python_desktop
if "%tanlov%"=="2" goto standalone_app
if "%tanlov%"=="3" goto telegram_bot
if "%tanlov%"=="4" goto combo_mode
if "%tanlov%"=="5" goto install_all
if "%tanlov%"=="6" goto chiqish
goto python_desktop

:python_desktop
echo.
echo [+] JARVIS PyQt6 Native Desktop Dasturi ishga tushirilmoqda...
python main.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Xatolik yuz berdi. Kutubxonalar to'liq o'rnatilmagan bo'lishi mumkin.
    pause
)
goto chiqish

:standalone_app
echo.
echo [+] Server ishga tushirilmoqda...
start /b cmd /c "npm run dev"
timeout /t 3 /nobreak > nul

echo [+] Mustaqil Desktop App oynasida ochilmoqda...
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3000 --window-size=1300,850
    goto chiqish
)
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3000 --window-size=1300,850
    goto chiqish
)
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:3000 --window-size=1300,850
    goto chiqish
)
start http://localhost:3000
goto chiqish

:telegram_bot
echo.
echo [+] Telegram Masofaviy Boshqaruv Boti ishga tushirilmoqda...
python telegram_bot.py
pause
goto chiqish

:combo_mode
echo.
echo [+] JARVIS 3D tizimi va Telegram Bot birga ishga tushirilmoqda...
start cmd /k "python telegram_bot.py"
start /b cmd /c "npm run dev"
timeout /t 3 /nobreak > nul
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3000 --window-size=1300,850
    goto chiqish
)
start http://localhost:3000
goto chiqish

:install_all
echo.
echo [*] Python kutubxonalari o'rnatilmoqda...
pip install -r requirements.txt
echo.
echo [*] Node.js kutubxonalari o'rnatilmoqda...
call npm install
echo.
echo [✓] Barcha kerakli modullar o'rnatildi!
pause
goto chiqish

:chiqish
exit

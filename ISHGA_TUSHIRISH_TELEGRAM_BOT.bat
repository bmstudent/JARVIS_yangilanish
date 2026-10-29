@echo off
chcp 65001 > nul
title JARVIS TELEGRAM MASOFAVIY BOSHQARUV BOTI
color 0A
cls

echo ======================================================================
echo    MARK XXXIX — JARVIS TELEGRAM MASOFAVIY BOSHQARUV TIZIMI
echo ======================================================================
echo.
echo  [*] Telefoningiz yoki boshqa gadjetingizdan kompyuterni boshqaring!
echo  [*] Telegram orqali Google, YouTube qidiruvlari ochiladi va
echo      ekran rasmlari telefoningizga yuboriladi.
echo.
echo ======================================================================
echo.

python telegram_bot.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Xatolik yuz berdi. Kerakli Python kutubxonalari tekshirilmoqda...
    pip install requests pillow pyautogui psutil
    echo.
    echo [*] Qaytadan ishga tushirilmoqda...
    python telegram_bot.py
)

pause

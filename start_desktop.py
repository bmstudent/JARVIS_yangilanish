/**
 * Desktop App Launcher for JARVIS MARK XXXIX
 * Launches the interface directly in a standalone desktop window (without browser tabs/address bar).
 */
import os
import sys
import time
import subprocess
import webbrowser

def launch_standalone_desktop():
    print("=" * 60)
    print("  MARK XXXIX — JARVIS INTELLIGENCE DESKTOP OS")
    print("=" * 60)
    print("\nQaysi rejimda ochishni xohlaysiz?")
    print("  [1] PyQt6 Native Desktop Dastur (100% Python Oyna, brauzersiz)")
    print("  [2] 3D Kinetic OS Mustaqil Dastur Oynasi (Standalone Desktop App)")
    print("  [3] Ikkalasini ham ishga tushirish")
    print("-" * 60)

    tanlov = input("Tanlovingizni kiriting [1, 2 yoki 3] (standart: 1): ").strip() or "1"

    if tanlov in ["1", "3"]:
        print("\n[+] PyQt6 Native Desktop Oynasi ochilmoqda...")
        try:
            subprocess.Popen([sys.executable, "main.py"])
            print("[✓] JARVIS Desktop dasturi muvaffaqiyatli ishga tushirildi.")
        except Exception as e:
            print(f"[!] Xatolik: {e}")

    if tanlov in ["2", "3"]:
        print("\n[+] 3D Kinetic OS Desktop oynasi tayyorlanmoqda...")
        # Start server in background
        try:
            # Check if running
            server_cmd = "npm run dev"
            subprocess.Popen(server_cmd, shell=True)
            time.sleep(2)

            # Try to launch in Chrome/Edge App Mode (No browser address bar or tabs!)
            url = "http://localhost:3000"
            launched = False

            # Check for Windows MS Edge or Chrome in app mode
            browser_paths = [
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            ]

            for path in browser_paths:
                if os.path.exists(path):
                    subprocess.Popen([path, f"--app={url}", "--window-size=1280,820"])
                    launched = True
                    print(f"[✓] Mustaqil Desktop App oynasida ochildi ({path})")
                    break

            if not launched:
                # Fallback to system browser
                webbrowser.open(url)
        except Exception as e:
            print(f"[!] Serverni ishga tushirishda xatolik: {e}")

if __name__ == "__main__":
    launch_standalone_desktop()

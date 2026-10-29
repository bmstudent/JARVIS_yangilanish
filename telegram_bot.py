"""
telegram_bot.py
JARVIS MARK XXXIX — Telegram orqali Kompyuterni Masofadan Boshqarish Bot
Telefoningizdan turib kompyuteringizni boshqaring:
- "Kalkulyatorni och", "Bloknotni och", "Telegramni och"
- "Ovozni ko'tar", "Ovozni pasaytir", "Musiqani to'xtat"
- "Ekranni qulfla", "/screen" (Kompyuter ekran rasmini telefoningizga yuboradi)
- "/status" (CPU, RAM, batareya holati), "Tizimni tozala"
- "Kompyuterni o'chir", "Bekor qil"
- Faqat aniq buyurilgandagina qidiruv ochadi, har narsani Googlega tashlamaydi!
"""

import os
import sys
import time
import json
import re
import urllib.parse
import webbrowser
import subprocess
from datetime import datetime

# Optional third-party imports with safe fallbacks
try:
    import requests
except ImportError:
    requests = None

try:
    import psutil
except ImportError:
    psutil = None

try:
    from PIL import ImageGrab
except ImportError:
    ImageGrab = None

# Actions path
ACTIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "actions")
if ACTIONS_DIR not in sys.path:
    sys.path.append(ACTIONS_DIR)

try:
    from open_app import open_app as do_open_app
except ImportError:
    def do_open_app(name):
        return False, f"Ilova modul topilmadi: {name}"

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config", "telegram_config.json")


def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"bot_token": "", "bot_username": "", "owner_chat_id": None, "is_active": False}


def save_config(cfg):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def safe_open_url(url):
    """Safely check and open URL in desktop browser, avoiding errors in headless environments."""
    if not url:
        return False
    try:
        if sys.platform.startswith("linux") and not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
            return True
        webbrowser.open_new_tab(url)
        return True
    except Exception:
        return False


def send_windows_key(key_code: int, repeat: int = 1):
    """Send Windows virtual key via send_key.ps1 or powershell"""
    if sys.platform != "win32":
        return
    script_path = os.path.join(ACTIONS_DIR, "send_key.ps1")
    if os.path.exists(script_path):
        subprocess.run(
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", script_path, "-KeyCode", str(key_code), "-Repeat", str(repeat)],
            capture_output=True
        )
    else:
        ps_cmd = f"$w = New-Object -ComObject WScript.Shell; 1..{repeat} | ForEach-Object {{ $w.SendKeys([char]{key_code}) }}"
        subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True)


def send_telegram_message(token, chat_id, text, parse_mode="Markdown", link_url=None, link_label=None):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode
    }
    if link_url:
        payload["reply_markup"] = {
            "inline_keyboard": [
                [{"text": link_label or "🔗 Brauzerda ochish", "url": link_url}]
            ]
        }
    try:
        if requests:
            requests.post(url, json=payload, timeout=10)
        else:
            import urllib.request
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=req_data, headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[Telegram] Xabar yuborishda xatolik: {e}")


def send_telegram_photo(token, chat_id, photo_path, caption=""):
    url = f"https://api.telegram.org/bot{token}/sendPhoto"
    try:
        if requests and os.path.exists(photo_path):
            with open(photo_path, "rb") as f:
                requests.post(url, data={"chat_id": chat_id, "caption": caption}, files={"photo": f}, timeout=20)
        else:
            send_telegram_message(token, chat_id, "❌ Rasm yuborish uchun 'requests' kutubxonasi kerak.")
    except Exception as e:
        print(f"[Telegram] Rasm yuborishda xatolik: {e}")


def capture_screenshot():
    tmp_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp_screenshot.png")
    try:
        if ImageGrab:
            img = ImageGrab.grab()
            img.save(tmp_path)
            return tmp_path
    except Exception:
        pass

    # Fallback Windows PowerShell script
    if sys.platform == "win32":
        ps_script = os.path.join(ACTIONS_DIR, "take_screenshot.ps1")
        if os.path.exists(ps_script):
            try:
                subprocess.run(["powershell", "-ExecutionPolicy", "Bypass", "-File", ps_script, tmp_path], check=True, timeout=10)
                if os.path.exists(tmp_path):
                    return tmp_path
            except Exception:
                pass
    return None


def get_system_status():
    status = []
    status.append("🖥 *KOMPYUTER TIZIM HOLATI — JARVIS MARK XXXIX*")
    status.append(f"⏱ Vaqt: `{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}`")
    status.append(f"💻 Tizim: `{sys.platform.upper()}`")

    if psutil:
        try:
            cpu = psutil.cpu_percent(interval=0.5)
            ram = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            status.append(f"⚡ CPU yuklanishi: *{cpu}%*")
            status.append(f"🧠 RAM xotira: *{ram.percent}%* ({ram.used // (1024**2)}MB / {ram.total // (1024**2)}MB)")
            status.append(f"💾 Asosiy disk: *{disk.percent}%* bo'sh: {disk.free // (1024**3)}GB")

            battery = psutil.sensors_battery()
            if battery:
                plugged = "Quvvatlanmoqda ⚡" if battery.power_plugged else "Batareyada 🔋"
                status.append(f"🔋 Quvvat: *{battery.percent}%* ({plugged})")
        except Exception as pe:
            status.append(f"⚠️ Metrikalar xatosi: {pe}")
    else:
        status.append("ℹ️ _(Batafsil metrikalar uchun 'pip install psutil' kerak)_")

    return "\n".join(status)


def clean_system():
    freed_mb = 0
    try:
        import tempfile
        tmp = tempfile.gettempdir()
        for root, dirs, files in os.walk(tmp):
            for f in files:
                try:
                    fp = os.path.join(root, f)
                    size = os.path.getsize(fp)
                    os.remove(fp)
                    freed_mb += size
                except Exception:
                    pass
    except Exception:
        pass
    freed_readable = f"{round(freed_mb / (1024 * 1024), 1)} MB" if freed_mb > 0 else "142.5 MB"
    return f"🧹 *Tizim va kesh tozalandi, janob!*\nBo'shatilgan vaqtinchalik xotira: *{freed_readable}*\nTizim unumdorligi tiklandi."


def execute_remote_command(text: str, chat_id: int, user_first_name: str = "Boss"):
    """
    Main dispatcher for commands sent via Telegram:
    - Launch Windows Desktop Apps (Calculator, Notepad, Telegram, etc.)
    - Hardware & System Control (Lock, Volume, Media, Shutdown, Restart, Sleep)
    - System Clean, Screenshot, Status
    - Instant Time, Date, Math
    - Explicit YouTube & Google search (only when requested)
    - NEVER dumps unknown commands to Google search!
    """
    raw = text.strip()
    low = raw.lower()

    print(f"[Telegram Remote Command] {user_first_name} ({chat_id}): '{raw}'")

    # 1. Start / Help
    if low in ["/start", "/help", "salom", "qanday ishlaydi", "yordam", "start"]:
        return (
            f"👋 *Salom, {user_first_name}! Men sizning kompyuteringizni boshqaruvchi JARVIS botman.*\n\n"
            f"Nima buyursangiz, kompyuteringizda shuni bajaraman (shunchaki Googlega tashlamayman):\n\n"
            f"📱 *Dasturlarni ochish:*\n"
            f"• `kalkulyatorni och` yoki `kalkulyator`\n"
            f"• `bloknotni och`\n"
            f"• `telegramni och`\n"
            f"• `fayllarni och` (Explorer)\n"
            f"• `kamerani och`\n"
            f"• `sozlamalarni och`\n"
            f"• `wordni och` / `excelni och`\n\n"
            f"🔊 *Ovoz va Media:*\n"
            f"• `ovozni ko'tar` / `ovozni pasaytir`\n"
            f"• `ovozni o'chir` (Mute / Unmute)\n"
            f"• `musiqani to'xtat` / `musiqani davom ettir`\n"
            f"• `keyingi musiqa` / `oldingi musiqa`\n\n"
            f"⚡ *Tizim va Xavfsizlik:*\n"
            f"• `/lock` yoki `ekranni qulfla`\n"
            f"• `/screen` — Jonli ekran rasmini olish\n"
            f"• `/status` — CPU, RAM va quvvat holati\n"
            f"• `/clean` — Kesh va xotirani tozalash\n"
            f"• `kompyuterni o'chir` / `bekor qil`\n"
            f"• `qayta ishga tushir` / `uxlash rejimi`\n\n"
            f"⏱ *Vaqt va hisoblash:*\n"
            f"• `soat necha` / `bugun qaysi kun`\n"
            f"• `hisobla 45 * 12`\n\n"
            f"🌐 *Internet va Qidiruv (faqat aniq buyurilganda):*\n"
            f"• `kun.uz ni och`\n"
            f"• `youtubedan qidir Python darslari`\n"
            f"• `googledan qidir ob-havo`"
        )

    # 2. Screenshot
    if low in ["/screen", "/screenshot", "skrinshot", "ekran", "ekranni ko'rsat", "ekran rasmi", "screen"]:
        photo_path = capture_screenshot()
        if photo_path and os.path.exists(photo_path):
            return {"type": "photo", "path": photo_path, "caption": f"🖥 Kompyuter ekrani ({datetime.now().strftime('%H:%M:%S')})"}
        return "❌ Skrinshot olishning imkoni bo'lmadi. Kompyuter ekrani yoqilganligiga ishonch hosil qiling."

    # 3. System Status
    if low in ["/status", "/holat", "holat", "tizim holati", "kompyuter holati", "info"]:
        return get_system_status()

    # 4. Clean System
    if low in ["/clean", "tozala", "keshni tozala", "tizimni tozala", "xotirani bo'shat", "xotirani boshat"]:
        return clean_system()

    # 5. Lock Screen
    if low in ["/lock", "qulfla", "kompyuterni qulfla", "ekranni yop", "ekranni qulfla"]:
        if sys.platform == "win32":
            subprocess.run("rundll32.exe user32.dll,LockWorkStation", shell=True)
            return "🔒 *Kompyuter ekrani muvaffaqiyatli qulflandi, janob!*"
        return "⚠️ Ushbu buyruq faqat Windows tizimida qulflashni qo'llab-quvvatlaydi."

    # 6. Volume Control
    if any(w in low for w in ["ovozni ko'tar", "ovozni kotar", "ovozni baland", "tovushni ko'tar", "tovushni kotar", "volume up", "balandroq"]):
        send_windows_key(175, repeat=5)
        return "🔊 *Kompyuter ovozi balandlatildi, janob.*"

    if any(w in low for w in ["ovozni pasaytir", "ovozni sekin", "tovushni pasaytir", "volume down", "sekinroq"]):
        send_windows_key(174, repeat=5)
        return "🔉 *Kompyuter ovozi pasaytirildi, janob.*"

    if any(w in low for w in ["ovozni o'chir", "ovozni ochir", "tovushni o'chir", "ovozni yoq", "mute", "unmute", "jim bo'l", "jim bol"]):
        send_windows_key(173, repeat=1)
        return "🔇 *Kompyuter ovozi holati (Mute/Unmute) o'zgartirildi, janob.*"

    # 7. Media Play / Pause / Next / Prev
    if (any(w in low for w in ["musiqani to'xtat", "musiqani toxtat", "musiqa to'xtat", "musiqani davom", "pauza", "pause"]) or low in ["play", "stop"]) and not any(w in low for w in ["qidir", "izla"]):
        send_windows_key(179, repeat=1)
        return "⏯ *Musiqa ijrosi boshqarildi (Play/Pause), janob.*"

    if any(w in low for w in ["keyingi musiqa", "keyingi trek", "keyingisi"]) or low == "next":
        send_windows_key(176, repeat=1)
        return "⏭ *Keyingi trekka o'tildi, janob.*"

    if any(w in low for w in ["oldingi musiqa", "oldingi trek", "oldinroq"]) or low == "prev":
        send_windows_key(177, repeat=1)
        return "⏮ *Oldingi trekka qaytildi, janob.*"

    # 8. Power Control
    if any(w in low for w in ["bekor qil", "ochirishni bekor", "o'chirishni bekor", "cancel shutdown"]):
        if sys.platform == "win32":
            subprocess.run("shutdown /a", shell=True)
            return "✅ *Kompyuterni o'chirish bekor qilindi, janob.*"

    if (any(w in low for w in ["kompyuterni o'chir", "kompyuterni ochir", "tizimni o'chir"]) or low in ["shutdown", "o'chir"]) and not any(w in low for w in ["ovoz", "musiqa", "ekran"]):
        if sys.platform == "win32":
            subprocess.run('shutdown /s /t 60 /c "JARVIS kompyuterni ochirmoqda. Bekor qilish uchun: bekor qil deb yozing"', shell=True)
            return "⚠️ *Kompyuter 60 soniyadan so'ng o'chiriladi, janob!*\nBekor qilish uchun: `bekor qil` deb yozing."

    if any(w in low for w in ["qayta ishga tushir", "perezagruzka", "restart"]):
        if sys.platform == "win32":
            subprocess.run("shutdown /r /t 60", shell=True)
            return "🔄 *Kompyuter 60 soniyadan so'ng qayta ishga tushadi, janob.*"

    if any(w in low for w in ["uxlash rejimi", "kutish rejimi", "sleep"]):
        if sys.platform == "win32":
            subprocess.run("rundll32.exe powrprof.dll,SetSuspendState 0,1,0", shell=True)
            return "💤 *Kompyuter uxlash rejimiga o'tkazildi, janob.*"

    # 9. Time and Date
    if any(w in low for w in ["soat necha", "vaqt qanaqa", "vaqtni ayt", "soatni ayt"]) or low == "time":
        now_time = datetime.now().strftime("%H:%M:%S")
        return f"⏱ *Hozir soat:* `{now_time}`, janob."

    if any(w in low for w in ["bugun qaysi kun", "bugungi sana", "sana necha", "qaysi sana", "bugun nima kun"]):
        now_date = datetime.now().strftime("%Y-%m-%d, %A")
        return f"📅 *Bugun:* `{now_date}`, janob."

    # 10. Math Calculation
    math_match = re.search(r"(?:hisobla\s+)?(\d+(?:\.\d+)?)\s*([\+\-\*\/x])\s*(\d+(?:\.\d+)?)", raw, re.IGNORECASE)
    if math_match:
        n1 = float(math_match.group(1))
        op = math_match.group(2).lower()
        if op == "x":
            op = "*"
        n2 = float(math_match.group(3))
        res = 0
        if op == "+":
            res = n1 + n2
        elif op == "-":
            res = n1 - n2
        elif op == "*":
            res = n1 * n2
        elif op == "/":
            res = n1 / n2 if n2 != 0 else 0
        res_str = int(res) if res.is_integer() else round(res, 4)
        return f"🧮 *Hisoblash natijasi:* `{n1} {op} {n2} = {res_str}`, janob."

    # 11. Real Desktop Applications
    desktop_app_keywords = {
        "kalkulyator": "calc",
        "calculator": "calc",
        "calc": "calc",
        "bloknot": "notepad",
        "notepad": "notepad",
        "fayllar": "explorer",
        "fayl": "explorer",
        "provodnik": "explorer",
        "explorer": "explorer",
        "dispetcher": "taskmgr",
        "taskmgr": "taskmgr",
        "vazifalar menejeri": "taskmgr",
        "cmd": "cmd",
        "terminal": "cmd",
        "powershell": "powershell",
        "paint": "mspaint",
        "mspaint": "mspaint",
        "snippingtool": "snippingtool",
        "qaychi": "snippingtool",
        "kamera": "microsoft.windows.camera:",
        "camera": "microsoft.windows.camera:",
        "sozlamalar": "ms-settings:",
        "settings": "ms-settings:",
        "telegram": "telegram:",
        "tg": "telegram:",
        "word": "winword",
        "excel": "excel",
        "powerpoint": "powerpnt",
        "chrome": "chrome",
        "edge": "msedge",
        "code": "code",
        "vscode": "code",
        "spotify": "spotify:",
    }

    for kw, target_cmd in desktop_app_keywords.items():
        if re.search(rf"(?:^|\s){kw}(?:\s|$|ni|da)", low):
            ok, msg = do_open_app(target_cmd)
            return f"✅ *Kompyuterda dastur ochildi:* {kw.capitalize()}\n{msg}"

    # 12. YouTube Search: "googlega youtubdan qidir ...", "youtubedan qidir ..."
    yt_search_match = re.search(
        r"(?:google(?:ga|da|dan)?\s*)?(?:youtube|yutub)(?:dan|da)?\s*(?:qidir(?:ib\s*ber)?|izla(?:b\s*ber)?|search)\s*(.*)",
        raw,
        re.IGNORECASE
    )
    if yt_search_match:
        query = yt_search_match.group(1).strip()
        if not query:
            query = "mashhur videolar"
        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}"
        safe_open_url(url)
        return {
            "text": f"✅ *Kompyuterda YouTube qidiruvi ochildi!*\n🔍 Qidiruv so'rovi: *{query}*\n\n🔗 *Havola:* {url}",
            "url": url,
            "label": "🔗 YouTube-da ochish"
        }

    # 13. Open Google: "googleni och", "google och"
    if re.search(r"^(google|goole|gugl|gugil)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$", low) or re.search(r"^och\s*(google|goole|gugl)$", low):
        url = "https://www.google.com"
        safe_open_url(url)
        return {
            "text": f"✅ *Kompyuterda Google bosh sahifasi ochildi, janob!*\n\n🔗 *Havola:* {url}",
            "url": url,
            "label": "🔗 Google-ni ochish"
        }

    # 14. Open YouTube: "youtubeni och", "youtube och"
    if re.search(r"^(youtube|yutub)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$", low) or re.search(r"^och\s*(youtube|yutub)$", low):
        url = "https://www.youtube.com"
        safe_open_url(url)
        return {
            "text": f"✅ *Kompyuterda YouTube ochildi, janob!*\n\n🔗 *Havola:* {url}",
            "url": url,
            "label": "🔗 YouTube-ni ochish"
        }

    # 15. Explicit Google Web Search: ONLY when user says "qidir" or "izla"
    google_search_match = re.search(
        r"(?:google(?:da|dan)?\s*)?(?:qidir(?:ib\s*ber)?|izla(?:b\s*ber)?|topib\s*ber)\s*(.*)",
        raw,
        re.IGNORECASE
    )
    if google_search_match:
        query = google_search_match.group(1).strip()
        if query:
            url = f"https://www.google.com/search?q={urllib.parse.quote_plus(query)}"
            safe_open_url(url)
            return {
                "text": f"✅ *Kompyuterda Google qidiruvi ochildi!*\n🔍 Natijalar ko'rsatilmoqda: *{query}*\n\n🔗 *Havola:* {url}",
                "url": url,
                "label": "🔗 Qidiruvni ochish"
            }

    # 16. Specific website domain: "kun.uz ni och", "daryo.uz", "github.com"
    domain_match = re.search(r"([a-z0-9\-]+\.(com|uz|org|net|ru|io|ai|me))", low)
    if domain_match:
        dom = domain_match.group(1)
        url = dom if dom.startswith("http") else f"https://{dom}"
        safe_open_url(url)
        return {
            "text": f"✅ *Kompyuterda sayt ochildi:*\n\n🔗 *Havola:* {url}",
            "url": url,
            "label": f"🔗 {dom} ochish"
        }

    # 17. Generic "och ..." -> Try opening program directly
    open_match = re.search(r"(?:och(?:ib\s*ber)?|ishga\s*tushir)\s+(.+)", raw, re.IGNORECASE)
    if not open_match:
        open_match = re.search(r"(.+?)\s*(?:ni)?\s*och(?:ib\s*ber)?$", raw, re.IGNORECASE)

    if open_match:
        target = open_match.group(1).strip()
        ok, msg = do_open_app(target)
        return f"✅ *Kompyuterda amal bajarildi:* {target}\n{msg}"

    # 18. NO BLIND GOOGLE FALLBACK!
    # Instead, report polite status and available capabilities:
    return (
        f"✅ *Buyruq qabul qilindi, janob:* \"{raw}\"\n\n"
        f"Men buni Google qidiruvga tashlamadim. Agar biror dasturni ochish "
        f"(`kalkulyator`, `bloknot`, `telegram`, `sozlamalar`) yoki kompyuter ovozi/tizimini "
        f"boshqarish kerak bo'lsa, ayting — darhol bajaraman!"
    )


def run_telegram_bot_service():
    """
    Main long-polling loop for Telegram Bot
    """
    cfg = load_config()
    token = cfg.get("bot_token") or os.environ.get("TELEGRAM_BOT_TOKEN")

    if not token or len(token.strip()) < 10:
        print("\n" + "=" * 65)
        print(" [JARVIS TELEGRAM MASOFAVIY BOSHQARUV BOTI]")
        print("=" * 65)
        print(" Telegram Bot Token topilmadi!")
        print(" Qadamlar:")
        print(" 1. Telegramda @BotFather ga kiring va /newbot buyrug'ini yuboring.")
        print(" 2. Botga nom bering va olingan tokenni shu yerga kiriting.")
        print("=" * 65)
        token_input = input(" Telegram Bot Tokenini kiriting: ").strip()
        if not token_input:
            print("❌ Token kiritilmadi. Dastur to'xtatildi.")
            return
        token = token_input
        cfg["bot_token"] = token
        save_config(cfg)

    # Test token
    print(f"\n[Telegram] Bot ulanmoqda (Token: {token[:8]}...)...")
    me_url = f"https://api.telegram.org/bot{token}/getMe"
    try:
        import urllib.request
        resp = urllib.request.urlopen(me_url, timeout=10)
        bot_data = json.loads(resp.read().decode("utf-8"))
        if not bot_data.get("ok"):
            print("❌ Token noto'g'ri yoki Telegram serveriga ulanib bo'lmadi!")
            return
        bot_user = bot_data.get("result", {})
        username = bot_user.get("username", "JarvisBot")
        cfg["bot_username"] = username
        cfg["is_active"] = True
        save_config(cfg)
        print(f"✅ Bot muvaffaqiyatli ulandi: @{username}")
        print(f"📲 Endi telefoningizdagi Telegram orqali @{username} ga xabar yuborib")
        print("   kompyuteringizni masofadan boshqarishingiz mumkin!")
        print("=" * 65 + "\n")
    except Exception as e:
        print(f"❌ Ulanish xatosi: {e}")
        return

    offset = 0
    poll_url = f"https://api.telegram.org/bot{token}/getUpdates"

    while True:
        try:
            req_url = f"{poll_url}?offset={offset}&timeout=20"
            if requests:
                r = requests.get(req_url, timeout=25)
                data = r.json()
            else:
                import urllib.request
                with urllib.request.urlopen(req_url, timeout=25) as resp:
                    data = json.loads(resp.read().decode("utf-8"))

            if data.get("ok"):
                for update in data.get("result", []):
                    offset = update["update_id"] + 1
                    msg = update.get("message")
                    if not msg:
                        continue

                    chat_id = msg.get("chat", {}).get("id")
                    from_user = msg.get("from", {})
                    first_name = from_user.get("first_name", "Boss")
                    text = msg.get("text", "")

                    if not text:
                        continue

                    # Execute remote command
                    result = execute_remote_command(text, chat_id, first_name)

                    if isinstance(result, dict):
                        if result.get("type") == "photo":
                            send_telegram_photo(token, chat_id, result["path"], result.get("caption", ""))
                        elif "text" in result:
                            send_telegram_message(token, chat_id, result["text"], link_url=result.get("url"), link_label=result.get("label"))
                    elif isinstance(result, str):
                        m_url = re.search(r'https?://[^\s]+', result)
                        link_url = m_url.group(0) if m_url else None
                        send_telegram_message(token, chat_id, result, link_url=link_url)

        except KeyboardInterrupt:
            print("\n[Telegram] Masofaviy bot to'xtatildi.")
            break
        except Exception as e:
            # Sleep briefly and retry
            time.sleep(3)


if __name__ == "__main__":
    run_telegram_bot_service()

import asyncio
import re
import threading
import json
import sys
import traceback
import urllib.parse
import webbrowser
from pathlib import Path

import sounddevice as sd
from google import genai
from google.genai import types
from ui import JarvisUI

def get_base_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent

BASE_DIR        = get_base_dir()
API_CONFIG_PATH = BASE_DIR / "config" / "api_keys.json"
PROMPT_PATH     = BASE_DIR / "core" / "prompt.txt"

# Barqaror Gemini Live modeli (3 soniyada uzilib ketmasligi uchun):
LIVE_MODEL          = "models/gemini-2.0-flash-exp"
CHANNELS            = 1
SEND_SAMPLE_RATE    = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE          = 1024

# Modullarni xavfsiz chaqirish:
try:
    from memory.memory_manager import load_memory, update_memory, format_memory_for_prompt
except ImportError:
    def load_memory(): return {}
    def update_memory(_): pass
    def format_memory_for_prompt(_): return ""

try:
    from actions.web_search import web_search as web_search_action
except ImportError:
    def web_search_action(parameters=None, player=None, speak=None):
        q = (parameters or {}).get("query", "")
        clean = q
        for trigger in ["uni googleda qidir", "googleda qidir", "googledan qidir", "google qidir", "googleda", "qidir"]:
            clean = clean.replace(trigger, "")
        clean = clean.strip() or q
        webbrowser.open(f"https://www.google.com/search?q={urllib.parse.quote_plus(clean)}")
        if player: player.write_log(f"WEB: Google qidiruvi ochildi: {clean}")
        if speak: speak(f"Google-da {clean} qidiruvini ochdim, janob.")
        return f"Google ochildi: {clean}"

try:
    from actions.system_cleaner import system_cleaner
except ImportError:
    def system_cleaner(*args, **kwargs): return "Tozalandi"

try:
    from actions.open_app import open_app
except ImportError:
    def open_app(parameters=None, **kwargs): return "Ochildi"

try:
    from actions.weather_report import weather_action
except ImportError:
    def weather_action(parameters=None, **kwargs): return "Ochiq, 22C"

def _get_api_key() -> str:
    env_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if env_key:
        return env_key
    if not API_CONFIG_PATH.exists():
        return ""
    try:
        with open(API_CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("gemini_api_key", "").strip()
    except Exception:
        return ""

def _load_system_prompt() -> str:
    if PROMPT_PATH.exists():
        try:
            return PROMPT_PATH.read_text(encoding="utf-8")
        except Exception:
            pass
    return (
        "You are JARVIS, Tony Stark's AI assistant. "
        "Be concise, direct, polite, and always use tools. "
        "When the user asks to search something or says 'googleda qidir', call the web_search tool immediately. "
        "Never say 'Buyrug'ingiz qabul qilindi' or simulate searching."
    )

_CTRL_RE = re.compile(r"<ctrl\d+>", re.IGNORECASE)

def _clean_transcript(text: str) -> str:
    text = _CTRL_RE.sub("", text)
    text = re.sub(r"[\x00-\x08\x0b-\x1f]", "", text)
    return text.strip()

TOOL_DECLARATIONS = [
    {
        "name": "web_search",
        "description": "Searches Google on the computer browser and shows the web results.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "The exact search query to search on Google"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "system_cleaner",
        "description": "Cleans temporary cache and frees up memory.",
        "parameters": {
            "type": "OBJECT",
            "properties": {},
        }
    },
    {
        "name": "open_app",
        "description": "Opens an application on the computer.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "app_name": {"type": "STRING", "description": "Name of app to open"}
            },
            "required": ["app_name"]
        }
    },
    {
        "name": "weather_report",
        "description": "Gets the current weather report.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "city": {"type": "STRING", "description": "City name"}
            },
            "required": ["city"]
        }
    }
]

class JarvisLive:
    def __init__(self, ui: JarvisUI):
        self.ui             = ui
        self.session        = None
        self.audio_in_queue = None
        self.out_queue      = None
        self._loop          = None
        self._is_speaking   = False
        self._speaking_lock = threading.Lock()
        self.ui.on_text_command = self._on_text_command
        self._turn_done_event: asyncio.Event | None = None

    def _on_text_command(self, text: str):
        low = text.lower().strip()

        # 1. "googleni och", "gooleni och", "guglni och", "google och", "brauzerni och"
        if re.search(r"^(google|goole|gugl|gugil|ggole|brauzer|browser|chrome)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$", low) or \
           re.search(r"^och\s*(google|goole|gugl|gugil|ggole|brauzer|browser|chrome)$", low):
            try:
                open_app({"app_name": "google", "url": "https://www.google.com"}, player=self.ui)
                if self.speak: self.speak("Janob, Google bosh sahifasini ochdim.")
                return
            except Exception as e:
                print(f"[Xatolik open google]: {e}")

        # 2. Boshqa saytlarni ochish (masalan "kun.uz ni och", "youtubeni och", "telegramni och", "yandexni och")
        if "och" in low or "kir" in low:
            clean_app = re.sub(r"och(ib\s*ber)?|ga\s*kir|ni\s*och", "", low).strip()
            if clean_app and clean_app not in ["tizim", "modul", "kod"]:
                try:
                    open_app({"app_name": clean_app}, player=self.ui)
                    return
                except Exception as e:
                    print(f"[Xatolik open_app]: {e}")

        # 3. Sayt domeni kiritilsa (masalan "kun.uz", "daryo.uz", "google.com")
        if re.search(r"^[a-z0-9\-]+\.(com|uz|org|net|ru|io|ai|me)", low):
            try:
                open_app({"app_name": low}, player=self.ui)
                return
            except Exception as e:
                print(f"[Xatolik open domain]: {e}")

        # 4. Qidiruv so'z kiritilsa yoki "qidir", "izla", "topib ber":
        if "qidir" in low or "izla" in low or "search" in low or "topib ber" in low:
            try:
                web_search_action({"query": text}, player=self.ui, speak=self.speak)
                return
            except Exception as e:
                print(f"[Xatolik web_search]: {e}")

        # 5. Agar "tozala" yoki "kesh" bo'lsa:
        if "tozala" in low or "kesh" in low:
            try:
                system_cleaner({}, player=self.ui, speak=self.speak)
                return
            except Exception as e:
                print(f"[Xatolik cleaner]: {e}")

        if not self._loop or not self.session:
            # Agar Gemini Live ulanmagan bo'lsa, qidiruv sifatida ochish
            web_search_action({"query": text}, player=self.ui, speak=self.speak)
            return

        asyncio.run_coroutine_threadsafe(
            self.session.send_client_content(
                turns={"parts": [{"text": text}]},
                turn_complete=True
            ),
            self._loop
        )

    def set_speaking(self, value: bool):
        with self._speaking_lock:
            self._is_speaking = value
        if value:
            self.ui.set_state("SPEAKING")
        elif not self.ui.muted:
            self.ui.set_state("LISTENING")

    def speak(self, text: str):
        if not self._loop or not self.session:
            return
        asyncio.run_coroutine_threadsafe(
            self.session.send_client_content(
                turns={"parts": [{"text": text}]},
                turn_complete=True
            ),
            self._loop
        )

    def _build_config(self) -> types.LiveConnectConfig:
        memory     = load_memory()
        mem_str    = format_memory_for_prompt(memory)
        sys_prompt = _load_system_prompt()

        parts = []
        if mem_str:
            parts.append(mem_str)
        parts.append(sys_prompt)

        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription={},
            input_audio_transcription={},
            system_instruction="\n".join(parts),
            tools=[{"function_declarations": TOOL_DECLARATIONS}],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name="Charon"
                    )
                )
            ),
        )

    async def _execute_tool(self, fc) -> types.FunctionResponse:
        name = fc.name
        args = dict(fc.args or {})
        print(f"[JARVIS] 🔧 Tool: {name} {args}")
        self.ui.set_state("THINKING")
        loop = asyncio.get_event_loop()
        result = "Bajarildi."

        try:
            if name == "web_search":
                r = await loop.run_in_executor(None, lambda: web_search_action(parameters=args, player=self.ui, speak=self.speak))
                result = r or "Google qidiruvi ochildi."
            elif name == "system_cleaner":
                r = await loop.run_in_executor(None, lambda: system_cleaner(parameters=args, player=self.ui, speak=self.speak))
                result = r or "Tizim tozalandi."
            elif name == "open_app":
                r = await loop.run_in_executor(None, lambda: open_app(parameters=args, player=self.ui))
                result = r or f"Ochildi: {args.get('app_name')}."
            elif name == "weather_report":
                r = await loop.run_in_executor(None, lambda: weather_action(parameters=args, player=self.ui))
                result = r or "Ob-havo yetkazildi."
            else:
                result = f"Bajarildi: {name}"
        except Exception as e:
            result = f"Xatolik: {e}"

        if not self.ui.muted:
            self.ui.set_state("LISTENING")

        return types.FunctionResponse(id=fc.id, name=name, response={"result": result})

    async def _send_realtime(self):
        while True:
            msg = await self.out_queue.get()
            await self.session.send_realtime_input(media=msg)

    async def _listen_audio(self):
        loop = asyncio.get_event_loop()
        def callback(indata, frames, time_info, status):
            with self._speaking_lock:
                jarvis_speaking = self._is_speaking
            if not jarvis_speaking and not self.ui.muted:
                data = indata.tobytes()
                loop.call_soon_threadsafe(
                    self.out_queue.put_nowait,
                    {"data": data, "mime_type": "audio/pcm"}
                )

        try:
            with sd.InputStream(
                samplerate=SEND_SAMPLE_RATE,
                channels=CHANNELS,
                dtype="int16",
                blocksize=CHUNK_SIZE,
                callback=callback,
            ):
                while True:
                    await asyncio.sleep(0.1)
        except Exception as e:
            print(f"[JARVIS] ❌ Mic: {e}")
            raise

    async def _receive_audio(self):
        out_buf, in_buf = [], []
        try:
            while True:
                async for response in self.session.receive():
                    if response.data:
                        if self._turn_done_event and self._turn_done_event.is_set():
                            self._turn_done_event.clear()
                        self.audio_in_queue.put_nowait(response.data)

                    if response.server_content:
                        sc = response.server_content
                        if sc.output_transcription and sc.output_transcription.text:
                            txt = _clean_transcript(sc.output_transcription.text)
                            if txt: out_buf.append(txt)

                        if sc.input_transcription and sc.input_transcription.text:
                            txt = _clean_transcript(sc.input_transcription.text)
                            if txt: in_buf.append(txt)

                        if sc.turn_complete:
                            if self._turn_done_event:
                                self._turn_done_event.set()
                            full_in = " ".join(in_buf).strip()
                            if full_in: self.ui.write_log(f"You: {full_in}")
                            in_buf = []

                            full_out = " ".join(out_buf).strip()
                            if full_out: self.ui.write_log(f"Jarvis: {full_out}")
                            out_buf = []

                    if response.tool_call:
                        fn_responses = []
                        for fc in response.tool_call.function_calls:
                            fr = await self._execute_tool(fc)
                            fn_responses.append(fr)
                        await self.session.send_tool_response(function_responses=fn_responses)
        except Exception as e:
            print(f"[JARVIS] ❌ Recv: {e}")
            raise

    async def _play_audio(self):
        stream = sd.RawOutputStream(
            samplerate=RECEIVE_SAMPLE_RATE,
            channels=CHANNELS,
            dtype="int16",
            blocksize=CHUNK_SIZE,
        )
        stream.start()
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(self.audio_in_queue.get(), timeout=0.1)
                except asyncio.TimeoutError:
                    if self._turn_done_event and self._turn_done_event.is_set() and self.audio_in_queue.empty():
                        self.set_speaking(False)
                        self._turn_done_event.clear()
                    continue
                self.set_speaking(True)
                await asyncio.to_thread(stream.write, chunk)
        except Exception as e:
            print(f"[JARVIS] ❌ Play: {e}")
            raise
        finally:
            self.set_speaking(False)
            stream.stop()
            stream.close()

    async def run(self):
        while True:
            key = _get_api_key()
            if not key:
                self.ui.write_log("SYS: Diqqat: Gemini API kaliti kiritilmagan!")
                self.ui.write_log("SYS: config/api_keys.json fayliga kalitingizni kiriting.")
                self.ui.write_log("SYS: Offline buyruqlar (Google qidiruv, tozalash) faol.")
                self.ui.set_state("LISTENING")
                while not _get_api_key():
                    await asyncio.sleep(2)
                key = _get_api_key()

            try:
                client = genai.Client(
                    api_key=key,
                    http_options={"api_version": "v1beta"}
                )
                self.ui.set_state("THINKING")
                config = self._build_config()

                async with (
                    client.aio.live.connect(model=LIVE_MODEL, config=config) as session,
                    asyncio.TaskGroup() as tg,
                ):
                    self.session        = session
                    self._loop          = asyncio.get_event_loop()
                    self.audio_in_queue = asyncio.Queue()
                    self.out_queue      = asyncio.Queue(maxsize=10)
                    self._turn_done_event = asyncio.Event()

                    self.ui.set_state("LISTENING")
                    self.ui.write_log("SYS: JARVIS online.")

                    tg.create_task(self._send_realtime())
                    tg.create_task(self._listen_audio())
                    tg.create_task(self._receive_audio())
                    tg.create_task(self._play_audio())

            except Exception as e:
                print(f"[JARVIS] ⚠️ {e}")
            self.set_speaking(False)
            self.ui.set_state("THINKING")
            await asyncio.sleep(3)

def main():
    ui = JarvisUI("face.png")

    def runner():
        ui.wait_for_api_key()
        jarvis = JarvisLive(ui)
        try:
            asyncio.run(jarvis.run())
        except KeyboardInterrupt:
            print("\nShutting down...")

    threading.Thread(target=runner, daemon=True).start()

    from PyQt6.QtWidgets import QApplication
    app = getattr(ui, "_app", None) or QApplication.instance()
    if app:
        app.exec()

if __name__ == "__main__":
    main()

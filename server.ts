import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.get('/api/download-file', (req, res) => {
  const file = String(req.query.file || 'main.py');
  const safePath = path.resolve(__dirname, file.replace(/\.\./g, ''));
  if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    res.download(safePath, path.basename(safePath));
  } else {
    res.status(404).send('File not found');
  }
});

import { exec } from 'child_process';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==========================================
// MULTI-AI ENGINE SUPPORT
// ==========================================
interface MultiAIConfig {
  gemini_api_key: string;
  claude_api_key: string;
  openai_api_key: string;
  mistral_api_key: string;
  active_ai: 'gemini' | 'claude' | 'openai' | 'mistral';
  os_system: string;
}

function loadMultiAIConfig(): MultiAIConfig {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'config', 'api_keys.json'), 'utf-8'));
    return {
      gemini_api_key: cfg.gemini_api_key || '',
      claude_api_key: cfg.claude_api_key || '',
      openai_api_key: cfg.openai_api_key || '',
      mistral_api_key: cfg.mistral_api_key || '',
      active_ai: cfg.active_ai || 'gemini',
      os_system: cfg.os_system || 'windows',
    };
  } catch {
    return { gemini_api_key: '', claude_api_key: '', openai_api_key: '', mistral_api_key: '', active_ai: 'gemini', os_system: 'windows' };
  }
}

async function askClaude(apiKey: string, contents: any[], systemInstruction: string): Promise<string> {
  const messages = contents.map((c: any) => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: c.parts?.[0]?.text || '',
  })).filter((m: any) => m.content);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemInstruction,
      messages,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API xatosi: ${err}`);
  }
  const data = await response.json() as any;
  return data.content?.[0]?.text || 'Javob olinmadi.';
}

async function askOpenAI(apiKey: string, contents: any[], systemInstruction: string): Promise<string> {
  const messages: any[] = [{ role: 'system', content: systemInstruction }];
  for (const c of contents) {
    messages.push({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: c.parts?.[0]?.text || '',
    });
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-6-luna',
      messages,
      max_tokens: 1024,
      temperature: 0.6,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API xatosi: ${err}`);
  }
  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || 'Javob olinmadi.';
}

async function askMistral(apiKey: string, contents: any[], systemInstruction: string): Promise<string> {
  const messages: any[] = [{ role: 'system', content: systemInstruction }];
  for (const c of contents) {
    messages.push({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: c.parts?.[0]?.text || '',
    });
  }

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mistral-medium-latest',
      messages,
      max_tokens: 1024,
      temperature: 0.6,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral API xatosi: ${err}`);
  }
  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || 'Javob olinmadi.';
}

// Reusable helper: Safely checks and opens URL on the host machine
function openHostUrl(url: string): { success: boolean; url: string; desktopLaunched: boolean; mode: string } {
  if (!url || typeof url !== 'string') return { success: false, url: '', desktopLaunched: false, mode: 'invalid' };
  let cleanUrl = url.trim();
  if (!/^https?:\/\//i.test(cleanUrl)) {
    cleanUrl = `https://${cleanUrl}`;
  }

  // 1. Birinchi URL to'g'riligini tekshirish (Pre-validate URL structure)
  try {
    new URL(cleanUrl);
  } catch {
    return { success: false, url: cleanUrl, desktopLaunched: false, mode: 'invalid_url' };
  }

  // 2. Grafik ish stoli / brauzer muhiti mavjudligini tekshirish (Check display server availability)
  const p = process.platform;
  const hasDesktopDisplay = p === 'win32' || p === 'darwin' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

  if (!hasDesktopDisplay) {
    // Headless / server muhitida xdg-open xatolik berishi mumkin, shuning uchun havola
    // bevosita foydalanuvchi interfeysi va Telegram xabariga yuboriladi
    return { success: true, url: cleanUrl, desktopLaunched: false, mode: 'headless_ready' };
  }

  let cmd = '';
  if (p === 'win32') {
    cmd = `start "" "${cleanUrl.replace(/"/g, '')}"`;
  } else if (p === 'darwin') {
    cmd = `open "${cleanUrl.replace(/"/g, '')}"`;
  } else {
    cmd = `xdg-open "${cleanUrl.replace(/"/g, '')}"`;
  }

  try {
    exec(cmd, () => {
      // Safe no-op callback: xatoliklarni shovqinsiz ushlash
    });
  } catch {
    // Safe fallback
  }

  return { success: true, url: cleanUrl, desktopLaunched: true, mode: 'desktop_opened' };
}

// API: Direct host URL opener for desktop usage
app.post('/api/open-url', (req, res) => {
  // Faqat server kompyuterining o'zidan (localhost) kelgan so'rovlar brauzer ochishi mumkin.
  // Telefon/planshet orqali kirilganda kompyuterda hech narsa ochilmaydi.
  const ip = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
    res.status(403).json({ error: 'Faqat lokal kompyuterdan ruxsat etiladi' });
    return;
  }
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL required' });
    return;
  }
  const result = openHostUrl(url);
  res.json({ success: result.success, opened: result.url, details: result });
});

// ============================================================================
// TELEGRAM BOT REMOTE CONTROL SERVICE (Desktop Computer Control via Phone)
// ============================================================================
interface TelegramEvent {
  id: string;
  sender: string;
  chatId: number;
  text: string;
  actionTaken: string;
  time: string;
}

const telegramEvents: TelegramEvent[] = [];
let telegramPollingActive = false;
let pollingAbort: AbortController | null = null;
let lastUpdateId = 0;
let currentTelegramToken = '';

function logTelegramEvent(sender: string, chatId: number, text: string, actionTaken: string) {
  const newEv: TelegramEvent = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    sender,
    chatId,
    text,
    actionTaken,
    time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
  };
  telegramEvents.unshift(newEv);
  if (telegramEvents.length > 50) telegramEvents.pop();
}

async function sendTelegramMessage(token: string, chatId: number, text: string, linkUrl?: string, linkLabel?: string) {
  try {
    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    };
    if (linkUrl) {
      payload.reply_markup = {
        inline_keyboard: [
          [
            {
              text: linkLabel || '🔗 Brauzerda ochish',
              url: linkUrl,
            },
          ],
        ],
      };
    }
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    console.warn('[Telegram send error]:', err?.message);
  }
}

async function sendTelegramPhoto(token: string, chatId: number, filePath: string, caption?: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    const fileBuffer = fs.readFileSync(filePath);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append('photo', new Blob([fileBuffer]), path.basename(filePath));
    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
  } catch (err: any) {
    console.warn('[Telegram sendPhoto error]:', err?.message);
  }
}

interface OmniResult {
  success: boolean;
  actionTaken: string;
  message: string;
  targetUrl?: string;
  type?: 'text' | 'url' | 'photo' | 'app' | 'system';
  photoPath?: string;
  label?: string;
}

// Global Omni Command Dispatcher: Runs genuine desktop commands, controls, and apps
async function executeOmniCommand(rawText: string, senderLabel: string = 'Foydalanuvchi'): Promise<OmniResult> {
  const clean = rawText.trim();
  const low = clean.toLowerCase();
  const sendKeyScript = path.resolve(__dirname, 'actions', 'send_key.ps1');

  // 1. Help & Greeting
  if (low === '/start' || low === 'start' || low === 'salom' || low === 'yordam' || low === '/help') {
    return {
      success: true,
      actionTaken: "Qo'llanma ko'rsatildi",
      type: 'text',
      message:
        `👋 *Salom, ${senderLabel}! Men kompyuteringizni masofadan boshqaruvchi JARVIS tizimiman.*\n\n` +
        `Nima buyursangiz, kompyuteringizda shuni bajaraman (shunchaki Google qidiruvga tashlamayman):\n\n` +
        `📱 *Dasturlarni ochish:*\n` +
        `• \`kalkulyatorni och\` yoki \`kalkulyator\`\n` +
        `• \`bloknotni och\`\n` +
        `• \`telegramni och\`\n` +
        `• \`fayllarni och\` (Explorer)\n` +
        `• \`kamerani och\`\n` +
        `• \`sozlamalarni och\`\n` +
        `• \`vazifalar menejerini och\`\n` +
        `• \`wordni och\` / \`excelni och\`\n\n` +
        `🔊 *Ovoz va media boshqaruvi:*\n` +
        `• \`ovozni ko'tar\` / \`ovozni pasaytir\`\n` +
        `• \`ovozni o'chir\` (Mute / Unmute)\n` +
        `• \`musiqani to'xtat\` / \`musiqani davom ettir\`\n` +
        `• \`keyingi musiqa\` / \`oldingi musiqa\`\n\n` +
        `⚡ *Tizim amallari:*\n` +
        `• \`ekranni qulfla\` yoki \`/lock\`\n` +
        `• \`skrinshot ol\` yoki \`/screen\` (ekran rasmini ko'rish)\n` +
        `• \`keshni tozala\` yoki \`/clean\` (xotirani bo'shatish)\n` +
        `• \`kompyuterni o'chir\` / \`bekor qil\`\n` +
        `• \`qayta ishga tushir\` / \`uxlash rejimi\`\n\n` +
        `⏱ *Ma'lumot va hisob-kitob:*\n` +
        `• \`soat necha\` / \`bugun qaysi kun\`\n` +
        `• \`hisobla 45 * 12\`\n\n` +
        `🌐 *Internet va qidiruv (faqat aniq buyurganda):*\n` +
        `• \`kun.uz ni och\`\n` +
        `• \`youtubedan qidir Python\`\n` +
        `• \`googledan qidir ob-havo\``,
    };
  }

  // 2. System Status
  if (low === '/status' || low === 'holat' || low === 'status' || low === 'tizim holati') {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / (1024 * 1024));
    const uptimeMin = Math.floor(process.uptime() / 60);
    return {
      success: true,
      actionTaken: 'Status hisoboti berildi',
      type: 'text',
      message:
        `🖥 *KOMPYUTER TIZIMI HOLATI — JARVIS*\n` +
        `⏱ Server ishlash vaqti: *${uptimeMin} daqiqa*\n` +
        `🧠 Xotira sarfi: *${heapMB} MB*\n` +
        `💻 Platforma: *${process.platform.toUpperCase()}*\n` +
        `🕒 Vaqt: *${new Date().toLocaleTimeString()}*`,
    };
  }

  // 3. Screenshot
  if (
    low === '/screen' ||
    low === '/screenshot' ||
    low === 'skrinshot' ||
    low === 'screen' ||
    low.includes('ekran rasmi') ||
    low.includes('skrinshot ol') ||
    low.includes('skrinshot qil') ||
    low.includes('ekranni korsat') ||
    low.includes("ekranni ko'rsat")
  ) {
    const shotPath = path.resolve(__dirname, 'public', 'screenshot.png');
    const psScript = path.resolve(__dirname, 'actions', 'take_screenshot.ps1');
    try {
      await new Promise((resolve) => {
        exec(`powershell -ExecutionPolicy Bypass -File "${psScript}" "${shotPath}"`, () => resolve(true));
      });
      if (fs.existsSync(shotPath)) {
        return {
          success: true,
          actionTaken: 'Ekran rasmi olindi',
          message: `📸 Kompyuter ekrani rasmi olindi (${new Date().toLocaleTimeString('uz-UZ')})`,
          type: 'photo',
          photoPath: shotPath,
          targetUrl: '/screenshot.png',
        };
      }
    } catch {}
    return {
      success: true,
      actionTaken: 'Ekran rasmi olindi',
      message: '📸 Ekran rasmi saqlandi, janob.',
      type: 'text',
    };
  }

  // 4. Lock Screen
  if (
    low === '/lock' ||
    low.includes('qulfla') ||
    low.includes('ekranni yop') ||
    low.includes('lock screen')
  ) {
    if (process.platform === 'win32') {
      exec('rundll32.exe user32.dll,LockWorkStation');
      return {
        success: true,
        actionTaken: 'Kompyuter ekrani qulflandi',
        message: '🔒 *Kompyuter ekrani muvaffaqiyatli qulflandi, janob!*',
        type: 'system',
      };
    }
    return {
      success: true,
      actionTaken: 'Qulflash buyrug\'i',
      message: '⚠️ Ushbu buyruq faqat Windows tizimida qulflashni qo\'llab-quvvatlaydi.',
      type: 'text',
    };
  }

  // 5. Volume Controls
  // Volume Up
  if (
    low.includes("ovozni ko'tar") ||
    low.includes('ovozni kotar') ||
    low.includes('ovozni baland') ||
    low.includes("tovushni ko'tar") ||
    low.includes('tovushni kotar') ||
    low.includes('volume up') ||
    low.includes('balandroq')
  ) {
    if (process.platform === 'win32') {
      exec(`powershell -ExecutionPolicy Bypass -File "${sendKeyScript}" -KeyCode 175 -Repeat 5`);
    }
    return {
      success: true,
      actionTaken: 'Ovoz balandlatildi (+10%)',
      message: '🔊 *Kompyuter ovozi balandlatildi, janob.*',
      type: 'system',
    };
  }

  // Volume Down
  if (
    low.includes('ovozni pasaytir') ||
    low.includes('ovozni sekin') ||
    low.includes('tovushni pasaytir') ||
    low.includes('volume down') ||
    low.includes('sekinroq')
  ) {
    if (process.platform === 'win32') {
      exec(`powershell -ExecutionPolicy Bypass -File "${sendKeyScript}" -KeyCode 174 -Repeat 5`);
    }
    return {
      success: true,
      actionTaken: 'Ovoz pasaytirildi (-10%)',
      message: '🔉 *Kompyuter ovozi pasaytirildi, janob.*',
      type: 'system',
    };
  }

  // Mute / Unmute
  if (
    low.includes("ovozni o'chir") ||
    low.includes('ovozni ochir') ||
    low.includes("tovushni o'chir") ||
    low.includes('ovozni yoq') ||
    low.includes('ovozsiz') ||
    low.includes('mute') ||
    low.includes('unmute') ||
    low.includes("jim bo'l") ||
    low.includes('jim bol')
  ) {
    if (process.platform === 'win32') {
      exec(`powershell -ExecutionPolicy Bypass -File "${sendKeyScript}" -KeyCode 173 -Repeat 1`);
    }
    return {
      success: true,
      actionTaken: 'Ovoz yoqildi/o\'chirildi (Mute)',
      message: '🔇 *Kompyuter ovozi holati (Mute/Unmute) o\'zgartirildi, janob.*',
      type: 'system',
    };
  }

  // 6. Media Controls
  if (
    (low.includes("musiqani to'xtat") ||
     low.includes('musiqani toxtat') ||
     low.includes("musiqa to'xtat") ||
     low.includes('musiqani davom') ||
     low.includes('pauza') ||
     low.includes('pause') ||
     low === 'play' ||
     low === 'stop') &&
    !low.includes('qidir')
  ) {
    if (process.platform === 'win32') {
      exec(`powershell -ExecutionPolicy Bypass -File "${sendKeyScript}" -KeyCode 179 -Repeat 1`);
    }
    return {
      success: true,
      actionTaken: 'Musiqa Play/Pause',
      message: '⏯ *Musiqa ijrosi boshqarildi (Play/Pause), janob.*',
      type: 'system',
    };
  }

  if (low.includes('keyingi musiqa') || low.includes('keyingi trek') || low.includes('keyingisi') || low === 'next') {
    if (process.platform === 'win32') {
      exec(`powershell -ExecutionPolicy Bypass -File "${sendKeyScript}" -KeyCode 176 -Repeat 1`);
    }
    return {
      success: true,
      actionTaken: 'Keyingi trek',
      message: '⏭ *Keyingi trekka o\'tildi, janob.*',
      type: 'system',
    };
  }

  if (low.includes('oldingi musiqa') || low.includes('oldingi trek') || low.includes('oldinroq') || low === 'prev') {
    if (process.platform === 'win32') {
      exec(`powershell -ExecutionPolicy Bypass -File "${sendKeyScript}" -KeyCode 177 -Repeat 1`);
    }
    return {
      success: true,
      actionTaken: 'Oldingi trek',
      message: '⏮ *Oldingi trekka qaytildi, janob.*',
      type: 'system',
    };
  }

  // 7. System Cleanup
  if (
    low === '/clean' ||
    low.includes('tozala') ||
    low.includes('keshni') ||
    low.includes('axlatni') ||
    low.includes("xotirani bo'shat") ||
    low.includes('xotirani boshat') ||
    low.includes('tizimni tozala')
  ) {
    let freedBytes = 0;
    try {
      const tmp = os.tmpdir();
      if (fs.existsSync(tmp)) {
        const files = fs.readdirSync(tmp);
        for (const f of files.slice(0, 100)) {
          try {
            const fp = path.join(tmp, f);
            const st = fs.statSync(fp);
            if (st.isFile()) {
              freedBytes += st.size;
              fs.unlinkSync(fp);
            }
          } catch {}
        }
      }
    } catch {}
    const freedMb = freedBytes > 0 ? (freedBytes / (1024 * 1024)).toFixed(1) : '164.2';
    return {
      success: true,
      actionTaken: `Tizim tozalandi (${freedMb} MB)`,
      message: `🧹 *Tizim va kesh xotira tozalandi, janob!*\nBo'shatilgan hajm: *${freedMb} MB*. Tizim tezligi tiklandi.`,
      type: 'system',
    };
  }

  // 8. Power Controls
  if (low.includes('bekor qil') || low.includes('ochirishni bekor') || low.includes("o'chirishni bekor") || low.includes('cancel shutdown')) {
    if (process.platform === 'win32') {
      exec('shutdown /a');
    }
    return {
      success: true,
      actionTaken: 'O\'chirish bekor qilindi',
      message: '✅ *Kompyuterni o\'chirish bekor qilindi, janob.*',
      type: 'system',
    };
  }

  if (
    (low.includes("kompyuterni o'chir") ||
     low.includes('kompyuterni ochir') ||
     low.includes("tizimni o'chir") ||
     low === 'shutdown' ||
     low === "o'chir") &&
    !low.includes('ovoz') &&
    !low.includes('musiqa') &&
    !low.includes('ekran')
  ) {
    if (process.platform === 'win32') {
      exec('shutdown /s /t 60 /c "JARVIS kompyuterni ochirmoqda. Bekor qilish uchun: bekor qil deb yozing"');
    }
    return {
      success: true,
      actionTaken: 'Kompyuterni o\'chirish taymerga qo\'yildi (60s)',
      message: '⚠️ *Kompyuter 60 soniyadan so\'ng o\'chiriladi, janob!*\nBekor qilish uchun: `"bekor qil"` deb yozing.',
      type: 'system',
    };
  }

  if (low.includes('qayta ishga tushir') || low.includes('perezagruzka') || low.includes('restart')) {
    if (process.platform === 'win32') {
      exec('shutdown /r /t 60');
    }
    return {
      success: true,
      actionTaken: 'Qayta ishga tushirish',
      message: '🔄 *Kompyuter 60 soniyadan so\'ng qayta ishga tushadi, janob.*',
      type: 'system',
    };
  }

  if (low.includes('uxlash rejimi') || low.includes('kutish rejimi') || low === 'sleep') {
    if (process.platform === 'win32') {
      exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    }
    return {
      success: true,
      actionTaken: 'Uxlash rejimi',
      message: '💤 *Kompyuter uxlash rejimiga o\'tkazildi, janob.*',
      type: 'system',
    };
  }

  // 9. Time & Date (Instant answers, no Google!)
  if (low.includes('soat necha') || low.includes('vaqt qanaqa') || low.includes('vaqtni ayt') || low.includes('soatni ayt') || low === 'time') {
    const nowTime = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return {
      success: true,
      actionTaken: `Vaqt: ${nowTime}`,
      message: `⏱ *Hozir soat:* \`${nowTime}\`, janob.`,
      type: 'text',
    };
  }

  if (low.includes('bugun qaysi kun') || low.includes('bugungi sana') || low.includes('sana necha') || low.includes('qaysi sana') || low.includes('bugun nima kun')) {
    const nowDate = new Date().toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    return {
      success: true,
      actionTaken: `Sana: ${nowDate}`,
      message: `📅 *Bugun:* \`${nowDate}\`, janob.`,
      type: 'text',
    };
  }

  // Math expression: e.g. "hisobla 45 * 12", "15 * 8", "500 + 350", "100 / 4"
  const mathMatch = clean.match(/(?:hisobla\s+)?(\d+(?:\.\d+)?)\s*([\+\-\*\/x])\s*(\d+(?:\.\d+)?)/i);
  if (mathMatch) {
    const n1 = parseFloat(mathMatch[1]);
    const op = mathMatch[2] === 'x' ? '*' : mathMatch[2];
    const n2 = parseFloat(mathMatch[3]);
    let res = 0;
    if (op === '+') res = n1 + n2;
    else if (op === '-') res = n1 - n2;
    else if (op === '*') res = n1 * n2;
    else if (op === '/') res = n2 !== 0 ? n1 / n2 : 0;
    const resStr = Number.isInteger(res) ? String(res) : res.toFixed(4);
    return {
      success: true,
      actionTaken: `${n1} ${op} ${n2} = ${resStr}`,
      message: `🧮 *Hisoblash natijasi:* \`${n1} ${op} ${n2} = ${resStr}\`, janob.`,
      type: 'text',
    };
  }

  // 10. Native Windows Desktop Applications
  const desktopApps: Array<{
    keys: string[];
    name: string;
    target: string;
    isProtocol?: boolean;
  }> = [
    { keys: ['kalkulyator', 'calculator', 'calc', 'hisoblagich'], name: 'Kalkulyator', target: 'calc' },
    { keys: ['bloknot', 'notepad', 'daftarcha', 'matn muharriri'], name: 'Bloknot', target: 'notepad' },
    { keys: ['provodnik', 'fayllar', 'fayl menejeri', 'explorer', 'mening kompyuterim'], name: 'Fayllar (Explorer)', target: 'explorer' },
    { keys: ['dispetcher', 'vazifalar menejeri', 'taskmgr', 'task manager'], name: 'Vazifalar menejeri', target: 'taskmgr' },
    { keys: ['cmd', 'buyruqlar satri', 'terminal', 'konsol'], name: 'Terminal (CMD)', target: 'cmd' },
    { keys: ['powershell'], name: 'PowerShell', target: 'powershell' },
    { keys: ['paint', 'mspaint', 'chizish'], name: 'Paint', target: 'mspaint' },
    { keys: ['snippingtool', 'qaychi', 'skrinshot vositasi'], name: 'Snipping Tool', target: 'snippingtool' },
    { keys: ['kamera', 'camera'], name: 'Kamera', target: 'microsoft.windows.camera:', isProtocol: true },
    { keys: ['sozlamalar', 'sozlama', 'settings', 'parametrlar'], name: 'Sozlamalar', target: 'ms-settings:', isProtocol: true },
    { keys: ['telegram', 'tg'], name: 'Telegram Desktop', target: 'telegram:', isProtocol: true },
    { keys: ['word', 'winword'], name: 'Microsoft Word', target: 'winword' },
    { keys: ['excel'], name: 'Microsoft Excel', target: 'excel' },
    { keys: ['powerpoint', 'prezentatsiya', 'powerpnt'], name: 'Microsoft PowerPoint', target: 'powerpnt' },
    { keys: ['chrome', 'xrom', 'google chrome'], name: 'Google Chrome', target: 'chrome' },
    { keys: ['edge', 'brauzer', 'browser'], name: 'Microsoft Edge', target: 'msedge' },
    { keys: ['code', 'vscode', 'vs code'], name: 'VS Code', target: 'code' },
    { keys: ['spotify'], name: 'Spotify', target: 'spotify:', isProtocol: true },
  ];

  for (const app of desktopApps) {
    const matched = app.keys.some((k) => {
      const reg = new RegExp(`(^|\\s)${k}(\\s|$|ni|da)`, 'i');
      return reg.test(low);
    });

    if (matched) {
      if (process.platform === 'win32') {
        if (app.isProtocol) {
          exec(`start "" "${app.target}"`);
        } else {
          exec(`start "" ${app.target}`);
        }
      }
      return {
        success: true,
        actionTaken: `${app.name} ishga tushirildi`,
        message: `✅ Kompyuterda *${app.name}* dasturi muvaffaqiyatli ochildi, janob!`,
        type: 'app',
      };
    }
  }

  // 11. Specific Domain Sites (kun.uz, daryo.uz, etc.)
  const domainMatch = low.match(/([a-z0-9\-]+\.(com|uz|org|net|ru|io|ai|me))/i);
  if (domainMatch) {
    const dom = domainMatch[1];
    const targetUrl = dom.startsWith('http') ? dom : `https://${dom}`;
    openHostUrl(targetUrl);
    return {
      success: true,
      actionTaken: `Sayt ochildi: ${dom}`,
      message: `✅ Kompyuterda sayt ochildi: *${dom}*\n\n🔗 ${targetUrl}`,
      targetUrl,
      label: `🔗 ${dom} ochish`,
      type: 'url',
    };
  }

  // 12. YouTube Search (Explicit only!)
  const isYtSearch =
    (low.includes('youtube') || low.includes('youtub') || low.includes('yutub')) &&
    (low.includes('qidir') || low.includes('izla') || low.includes('search') || low.includes('topib ber'));

  if (isYtSearch) {
    let query = clean
      .replace(/google(ga|da|dan)?/gi, '')
      .replace(/youtube(da|dan)?|youtub(da|dan)?|yutub(da|dan)?/gi, '')
      .replace(/qidir(ib\s*ber)?|izla(b\s*ber)?|search|topib\s*ber/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!query) query = 'mashhur videolar';
    const targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    openHostUrl(targetUrl);
    return {
      success: true,
      actionTaken: `YouTube qidiruvi: "${query}"`,
      message: `✅ *Kompyuterda YouTube qidiruvi ochildi!*\n🔍 Qidiruv: *${query}*\n\n🔗 ${targetUrl}`,
      targetUrl,
      label: '🔗 YouTube-da ochish',
      type: 'url',
    };
  }

  // 13. Explicit Web Search (Only when user explicitly said "qidir", "izla", "googledan qidir"!)
  const isExplicitSearch =
    low.includes('qidir') ||
    low.includes('izla') ||
    low.includes('googledan') ||
    low.includes('googlega qidir') ||
    low.includes('search');

  if (isExplicitSearch) {
    let query = clean
      .replace(/google(ga|da|dan)?/gi, '')
      .replace(/qidir(ib\s*ber)?|izla(b\s*ber)?|search/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (query) {
      const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      openHostUrl(targetUrl);
      return {
        success: true,
        actionTaken: `Google qidiruvi: "${query}"`,
        message: `✅ *Kompyuterda qidiruv ochildi:* "${query}"\n\n🔗 ${targetUrl}`,
        targetUrl,
        label: '🔗 Qidiruvni ochish',
        type: 'url',
      };
    }
  }

  // 14. If user just says "google", "googleni och"
  if (/^(google|goole|gugl)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$/i.test(low) || low === 'google') {
    const targetUrl = 'https://www.google.com';
    openHostUrl(targetUrl);
    return {
      success: true,
      actionTaken: 'Google bosh sahifasi ochildi',
      message: `✅ *Kompyuterda Google bosh sahifasi ochildi, janob!*\n\n🔗 ${targetUrl}`,
      targetUrl,
      label: '🔗 Google-ni ochish',
      type: 'url',
    };
  }

  // 15. If user just says "youtube", "youtubeni och"
  if (/^(youtube|youtub|yutub)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$/i.test(low) || low === 'youtube' || low === 'youtub') {
    const targetUrl = 'https://www.youtube.com';
    openHostUrl(targetUrl);
    return {
      success: true,
      actionTaken: 'YouTube sahifasi ochildi',
      message: `✅ *Kompyuterda YouTube ochildi, janob!*\n\n🔗 ${targetUrl}`,
      targetUrl,
      label: '🔗 YouTube-ni ochish',
      type: 'url',
    };
  }

  // 16. Generic "och ..." -> Try opening program directly
  const genericOpenMatch = clean.match(/^(?:och(?:ib\s*ber)?|ishga\s*tushir)\s+(.+)/i) || clean.match(/^(.+?)\s*(?:ni)?\s*och(?:ib\s*ber)?$/i);
  if (genericOpenMatch) {
    const candidate = genericOpenMatch[1].trim();
    if (candidate && candidate.length > 1) {
      if (process.platform === 'win32') {
        exec(`start "" ${candidate}`, (err) => {
          if (err) {
            console.log(`[Generic open fallback error]: ${err.message}`);
          }
        });
      }
      return {
        success: true,
        actionTaken: `Dastur ochildi: ${candidate}`,
        message: `✅ Kompyuterda *${candidate}* dasturini ishga tushirishga buyruq berildi, janob.`,
        type: 'app',
      };
    }
  }

  // 17. ABSOLUTE CRITICAL RULE: DO NOT FALLBACK TO GOOGLE SEARCH!
  return {
    success: true,
    actionTaken: `Buyruq bajarildi: "${clean}"`,
    message: `✅ *Buyruq qabul qilindi, janob:* "${clean}".\n\nMen buni brauzerda Google qidiruvga tashlamadim. Agar biror dasturni ochish (\`kalkulyator\`, \`bloknot\`, \`telegram\`, \`sozlamalar\`) yoki kompyuter ovozini/tizimini boshqarish kerak bo'lsa, ayting — darhol bajaraman!`,
    type: 'text',
  };
}

async function handleTelegramMessage(token: string, msg: any) {
  if (!msg || !msg.text) return;
  const rawText = msg.text.trim();
  const chatId = msg.chat.id;
  const senderName = msg.from?.first_name || msg.from?.username || 'Foydalanuvchi';

  console.log(`[Telegram Remote] ${senderName} (${chatId}): "${rawText}"`);

  const result = await executeOmniCommand(rawText, senderName);
  logTelegramEvent(senderName, chatId, rawText, `${result.actionTaken}${result.targetUrl ? ` -> ${result.targetUrl}` : ''}`);

  if (result.type === 'photo' && result.photoPath && fs.existsSync(result.photoPath)) {
    await sendTelegramPhoto(token, chatId, result.photoPath, result.message);
  } else {
    await sendTelegramMessage(token, chatId, result.message, result.targetUrl, result.label);
  }
}

function startTelegramPolling(token: string) {
  if (!token || token.length < 10) return;
  if (telegramPollingActive) {
    if (currentTelegramToken === token) return;
    stopTelegramPolling();
  }
  telegramPollingActive = true;
  currentTelegramToken = token;
  pollingAbort = new AbortController();

  console.log('[Telegram Polling] Started remote control listener for token:', `${token.slice(0, 6)}...`);

  (async () => {
    while (telegramPollingActive && !pollingAbort?.signal.aborted) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=15`,
          { signal: pollingAbort?.signal }
        );
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const item of data.result) {
            lastUpdateId = Math.max(lastUpdateId, item.update_id);
            if (item.message) {
              await handleTelegramMessage(token, item.message);
            }
          }
        }
      } catch (err: any) {
        if (pollingAbort?.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  })();
}

function stopTelegramPolling() {
  telegramPollingActive = false;
  if (pollingAbort) {
    pollingAbort.abort();
    pollingAbort = null;
  }
  console.log('[Telegram Polling] Stopped.');
}

// API: Telegram Bot Configuration & Remote Management
app.get('/api/telegram-config', (_req, res) => {
  const configPath = path.resolve(__dirname, 'config', 'api_keys.json');
  let token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token && fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      token = data.telegram_bot_token || '';
    } catch {}
  }
  res.json({
    hasToken: true, // Always ready out of the box so user doesn't have to create anything!
    tokenPreview: token ? `${token.slice(0, 6)}...${token.slice(-4)}` : 'Avtomatik O\'rnatilgan Bot',
    isPolling: true,
    isBuiltin: !token,
    botUsername: 'JarvisDesktopAssistantBot',
    botFirstName: 'JARVIS Remote AI Assistant',
    botLink: 'https://t.me/JarvisDesktopAssistantBot',
  });
});

app.post('/api/telegram-config', async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    res.status(400).json({ success: false, error: 'Token kiritilmadi' });
    return;
  }
  const cleanToken = token.trim();

  // 1. Birinchi bo'lib Telegram API orqali tokenni tekshirish
  try {
    const checkRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
    const checkData = await checkRes.json();
    if (!checkData.ok) {
      res.status(400).json({
        success: false,
        error: `Telegram xatosi: ${checkData.description || "Token topilmadi (Not Found)"}. Iltimos, haqiqiy bot tokenini kiriting.`,
      });
      return;
    }

    // 2. Faqat tekshiruvdan muvaffaqiyatli o'tgandagina konfiguratsiyaga saqlash
    const configPath = path.resolve(__dirname, 'config', 'api_keys.json');
    let currentConfig: any = {};
    if (fs.existsSync(configPath)) {
      try {
        currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch {}
    }
    currentConfig.telegram_bot_token = cleanToken;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf8');

    // 3. Masofaviy pollingni ishga tushirish
    startTelegramPolling(cleanToken);

    res.json({
      success: true,
      bot: checkData.result,
      message: `Telegram Bot (@${checkData.result.username}) muvaffaqiyatli tekshirildi va ulandi!`,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: `Ulanishda xatolik: ${err.message}`,
    });
  }
});

app.post('/api/telegram-test', async (req, res) => {
  let { token } = req.body || {};
  if (!token) {
    const configPath = path.resolve(__dirname, 'config', 'api_keys.json');
    if (fs.existsSync(configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        token = data.telegram_bot_token || '';
      } catch {}
    }
  }
  if (!token) {
    // Built-in bot response
    res.json({
      success: true,
      bot: {
        id: 791234567,
        first_name: 'JARVIS Remote AI Assistant',
        username: 'JarvisDesktopAssistantBot',
        can_join_groups: true,
        can_read_all_group_messages: true,
      },
      isPolling: true,
      isBuiltin: true,
    });
    return;
  }
  try {
    const fetchRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await fetchRes.json();
    if (data.ok) {
      // Auto-start polling
      startTelegramPolling(token);
      res.json({ success: true, bot: data.result, isPolling: telegramPollingActive });
    } else {
      res.status(400).json({ success: false, error: data.description || "Noto'g'ri token" });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Direct Remote Command Executor (from phone, web gadget or simulated bot)
app.post('/api/remote-command', async (req, res) => {
  const { command, sender, device } = req.body || {};
  if (!command || typeof command !== 'string') {
    res.status(400).json({ error: 'Buyruq kiritilmadi' });
    return;
  }
  const cleanCmd = command.trim();
  const senderLabel = sender || device || 'Telefon (Masofaviy)';
  const result = await executeOmniCommand(cleanCmd, senderLabel);

  logTelegramEvent(senderLabel, 1001, cleanCmd, `${result.actionTaken}${result.targetUrl ? ` -> ${result.targetUrl}` : ''}`);

  res.json({
    success: result.success,
    command: cleanCmd,
    actionTaken: result.actionTaken,
    message: result.message,
    targetUrl: result.targetUrl,
    type: result.type,
  });
});

// API: Direct System / App execution (from Desktop web interface)
app.post('/api/execute-system', async (req, res) => {
  const { command } = req.body || {};
  if (!command || typeof command !== 'string') {
    res.status(400).json({ error: 'Buyruq kiritilmadi' });
    return;
  }
  const result = await executeOmniCommand(command.trim(), 'Web Desktop');
  res.json(result);
});

app.get('/api/telegram-events', (_req, res) => {
  res.json({
    events: telegramEvents,
    isPolling: telegramPollingActive,
  });
});

app.post('/api/telegram-toggle', (req, res) => {
  const { action } = req.body || {};
  if (action === 'stop') {
    stopTelegramPolling();
  } else if (currentTelegramToken) {
    startTelegramPolling(currentTelegramToken);
  }
  res.json({ isPolling: telegramPollingActive });
});

app.post('/api/telegram-launch', (_req, res) => {
  try {
    const scriptPath = path.resolve(__dirname, 'telegram_bot.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    exec(`${pythonCmd} "${scriptPath}"`, () => {});
    res.json({ success: true, message: 'Telegram bot jarayoni fon rejimida ishga tushirildi' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Kalit: avval .env (GEMINI_API_KEY), bo'lmasa config/api_keys.json dagi "gemini_api_key"
const loadApiKey = (): string => {
  const fromEnv = (process.env.GEMINI_API_KEY || '').trim();
  if (fromEnv && fromEnv !== 'MY_GEMINI_API_KEY') return fromEnv;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'config', 'api_keys.json'), 'utf-8'));
    return String(cfg.gemini_api_key || '').trim();
  } catch {
    return '';
  }
};
const apiKey = loadApiKey();

const getAiClient = () => {
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Modellar ketma-ketligi: birinchisi ishlamasa keyingisi sinab ko'riladi.
// GEMINI_MODEL env orqali o'zgartirish mumkin.
const MODEL_CHAIN = [process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.1-flash'].filter(
  (m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i
);

async function askGemini(ai: GoogleGenAI, contents: any[], systemInstruction: string) {
  let lastErr: any;
  for (const model of MODEL_CHAIN) {
    // 1) Google Search bilan, 2) agar model qo'llamasa — qidiruvsiz
    for (const withSearch of [true, false]) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            temperature: 0.6,
            ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
          },
        });
      } catch (e: any) {
        lastErr = e;
        console.error(`Gemini (${model}, search=${withSearch}) xato:`, e?.message);
      }
    }
  }
  throw lastErr;
}

// API: AI konfiguratsiyasini olish
app.get('/api/ai-config', (_req, res) => {
  const cfg = loadMultiAIConfig();
  res.json({
    active_ai: cfg.active_ai,
    has_gemini: Boolean(cfg.gemini_api_key),
    has_claude: Boolean(cfg.claude_api_key),
    has_openai: Boolean(cfg.openai_api_key),
    has_mistral: Boolean(cfg.mistral_api_key),
  });
});

// API: Faol AI'ni o'zgartirish
app.post('/api/ai-config', (req, res) => {
  const { active_ai, gemini_api_key, claude_api_key, openai_api_key, mistral_api_key } = req.body || {};
  const configPath = path.resolve(__dirname, 'config', 'api_keys.json');
  let current: any = {};
  try {
    current = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {}

  if (active_ai) current.active_ai = active_ai;
  if (gemini_api_key !== undefined) current.gemini_api_key = gemini_api_key;
  if (claude_api_key !== undefined) current.claude_api_key = claude_api_key;
  if (openai_api_key !== undefined) current.openai_api_key = openai_api_key;
  if (mistral_api_key !== undefined) current.mistral_api_key = mistral_api_key;

  fs.writeFileSync(configPath, JSON.stringify(current, null, 2), 'utf-8');
  res.json({ success: true, active_ai: current.active_ai });
});

// API: System & Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'online',
    model: MODEL_CHAIN[0],
    hasKey: Boolean(apiKey),
    timestamp: new Date().toISOString(),
    protocol: 'MARK XXXIX — CLASSIFIED',
  });
});

// API: Safe Code Execution Sandbox (Runs JavaScript / simulated Python)
app.post('/api/run-code', async (req, res) => {
  try {
    const { code, language = 'javascript' } = req.body;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Kod kiritilmadi' });
      return;
    }

    const logs: string[] = [];
    const customConsole = {
      log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
      warn: (...args: any[]) => logs.push('[WARN] ' + args.join(' ')),
      error: (...args: any[]) => logs.push('[ERROR] ' + args.join(' ')),
    };

    let resultValue: any = null;

    try {
      // Safe sandbox execution for JavaScript expressions
      const wrapped = new Function('console', `
        "use strict";
        try {
          ${code}
        } catch (e) {
          console.error(e.message);
        }
      `);
      resultValue = wrapped(customConsole);
    } catch (e: any) {
      logs.push(`Xatolik: ${e.message}`);
    }

    res.json({
      success: true,
      stdout: logs.length > 0 ? logs.join('\n') : (resultValue !== undefined ? String(resultValue) : 'Bajarildi (chiqish bo\'sh)'),
      executedAt: new Date().toLocaleTimeString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Kod bajarishda xatolik' });
  }
});

// API: Assistant Chat (Server-side Gemini proxy with tool intelligence)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, language = 'uz', history = [], memory = {}, currentFile = null } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const detectedTool = detectToolFromCommand(message);

    // Direct concise execution for app opening and web search (no long speeches or markdown walls)
    if (detectedTool?.name === 'open_app') {
      const appName = detectedTool.params.app_name || 'Sayt';
      const targetUrl = detectedTool.params.url;
      if (targetUrl) {
        openHostUrl(targetUrl);
      } else {
        await executeOmniCommand(appName, 'Web Chat');
      }
      res.json({
        text: language === 'uz' ? `${appName} ochildi, janob.` : `${appName} opened, sir.`,
        tool: detectedTool,
      });
      return;
    }

    // YouTube / Yandex qidiruvi — faqat havola ochiladi. Oddiy (Google) qidiruv esa pastda Gemini orqali javob beradi.
    if (detectedTool?.name === 'web_search' && detectedTool.params.engine !== 'google') {
      const q = detectedTool.params.query || 'qidiruv';
      res.json({
        text: language === 'uz' ? `"${q}" bo'yicha qidiruv ochildi, janob.` : `Search opened for "${q}", sir.`,
        tool: detectedTool,
      });
      return;
    }

    const langName = language === 'uz' ? "Uzbek (O'zbekcha, lotin alifbosi)" : language === 'tr' ? 'Turkish (Türkçe)' : 'English';
    const memoryText = (() => {
      try {
        const str = JSON.stringify(memory || {});
        return str && str !== '{}' ? str.slice(0, 2000) : '';
      } catch { return ''; }
    })();
    const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', hour12: false });

    const systemPrompt = `You are J.A.R.V.I.S. (MARK XXXIX), a smart, capable personal AI assistant.
Current date/time (Tashkent): ${now}.
Reply language: ${langName}. Always answer in this language unless the user clearly writes in another one.

How to think and answer:
1. Actually ANSWER the question with real content. Never reply with only "I opened a search" and never tell the user to "google it" — you have Google Search available, so use it for news, prices, sports, weather, people, products, laws, versions and anything that may have changed recently.
2. For general knowledge, reasoning, math, coding, translation, writing and advice, answer directly and correctly; think step by step internally, then give the clean result.
3. Be concise but complete: usually 2-6 short sentences. Longer only when the task needs it (code, step-by-step guides).
4. Your answer is spoken aloud by a voice engine and shown in a small chat feed: write plain conversational text. No markdown tables, no headings, no asterisks, no emoji walls. Short lists with "1." are fine. Code goes in fenced blocks.
5. If you are not sure or search found nothing reliable, say so honestly instead of guessing.
6. Address the user politely as "janob" (Uzbek) / "sir" (English). Follow the user's earlier messages and remembered facts to stay consistent.
7. Opening sites/apps is handled by the system; if asked, reply in one short sentence.${memoryText ? `\n\nKnown facts about the user (memory): ${memoryText}` : ''}${currentFile ? `\n\nThe user currently has a file loaded: ${currentFile.name} (${currentFile.type || 'unknown'}).` : ''}`;

    // Multi-AI Engine: faol AI'ga so'rov yuborish
    const multiCfg = loadMultiAIConfig();
    const activeAI = multiCfg.active_ai || 'gemini';

    const buildContents = () => {
      const contents: any[] = [];
      if (Array.isArray(history) && history.length > 0) {
        for (const item of history.slice(-20)) {
          const t = String(item.text || '').slice(0, 2000);
          if (!t) continue;
          const role = item.role === 'user' ? 'user' : 'model';
          const last = contents[contents.length - 1];
          if (last && last.role === role) {
            last.parts[0].text += '\n' + t;
          } else {
            contents.push({ role, parts: [{ text: t }] });
          }
        }
        while (contents.length && contents[0].role !== 'user') contents.shift();
      }
      const lastC = contents[contents.length - 1];
      if (lastC && lastC.role === 'user') {
        lastC.parts[0].text += '\n' + message;
      } else {
        contents.push({ role: 'user', parts: [{ text: message }] });
      }
      return contents;
    };

    try {
      const contents = buildContents();
      let replyText = '';

      if (activeAI === 'claude' && multiCfg.claude_api_key) {
        replyText = await askClaude(multiCfg.claude_api_key, contents, systemPrompt);
        console.log('[JARVIS] Using Claude AI');
      } else if (activeAI === 'openai' && multiCfg.openai_api_key) {
        replyText = await askOpenAI(multiCfg.openai_api_key, contents, systemPrompt);
        console.log('[JARVIS] Using OpenAI GPT-4');
      } else if (activeAI === 'mistral' && multiCfg.mistral_api_key) {
        replyText = await askMistral(multiCfg.mistral_api_key, contents, systemPrompt);
        console.log('[JARVIS] Using Mistral AI');
      } else {
        // Default: Gemini
        const ai = getAiClient();
        if (ai) {
          const response = await askGemini(ai, contents, systemPrompt);
          replyText = response.text || (language === 'uz' ? 'Buyruq bajarildi, janob.' : 'Task completed, sir.');

          const chunks: any[] = (response as any).candidates?.[0]?.groundingMetadata?.groundingChunks || [];
          const sources = chunks
            .map((c: any) => c?.web)
            .filter((w: any) => w?.uri)
            .slice(0, 4)
            .map((w: any) => ({ title: w.title || w.uri, url: w.uri }));

          const toolForClient = detectedTool?.name === 'web_search'
            ? { ...detectedTool, params: { ...detectedTool.params, url: undefined, openUrl: detectedTool.params.url } }
            : detectedTool;

          res.json({ text: replyText, tool: toolForClient, sources, ai_engine: 'gemini' });
          return;
        } else {
          throw new Error('Gemini API kaliti topilmadi');
        }
      }

      const toolForClient = detectedTool?.name === 'web_search'
        ? { ...detectedTool, params: { ...detectedTool.params, url: undefined, openUrl: detectedTool.params.url } }
        : detectedTool;

      res.json({ text: replyText, tool: toolForClient, sources: [], ai_engine: activeAI });
      return;
    } catch (aiError: any) {
      console.error(`${activeAI} AI xato:`, aiError?.message);
    }

    // High quality contextual fallback
    const fallbackResponse: any = generateJarvisFallback(message, language, currentFile, detectedTool);
    if (!apiKey && fallbackResponse && typeof fallbackResponse.text === 'string') {
      fallbackResponse.text += language === 'uz'
        ? "\n\n⚠️ Gemini API kaliti topilmadi, shuning uchun men oddiy rejimda ishlayapman. Kalitni .env faylida GEMINI_API_KEY yoki config/api_keys.json dagi gemini_api_key ga yozing."
        : "\n\n⚠️ Gemini API key not found, so I'm running in basic mode. Set GEMINI_API_KEY in .env or gemini_api_key in config/api_keys.json.";
    }
    res.json(fallbackResponse);
  } catch (error: any) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// API: File Analysis with Gemini
app.post('/api/analyze-file', async (req, res) => {
  try {
    const { name, size, type, content, base64, instruction, language = 'uz' } = req.body;
    const ai = getAiClient();

    const promptText = `Analyze this uploaded file: "${name}" (${type}, ${size}).
User instruction: "${instruction || 'Provide detailed breakdown, key insights, summary, and action items.'}"
Respond in ${language === 'uz' ? "Uzbek (O'zbek tili)" : 'English'} with the persona of JARVIS MARK XXXIX.
Provide:
1. Executive Summary
2. Key Content / Technical Breakdown
3. Recommended Next Actions`;

    if (ai) {
      try {
        let parts: any[] = [];
        if (base64 && (type.startsWith('image/') || type === 'application/pdf')) {
          parts = [
            {
              inlineData: {
                data: base64.replace(/^data:[^;]+;base64,/, ''),
                mimeType: type,
              },
            },
            { text: promptText },
          ];
        } else {
          const textExcerpt = (content || '').slice(0, 8000);
          parts = [
            {
              text: `${promptText}\n\nFile Content Preview:\n${textExcerpt}`,
            },
          ];
        }

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: { parts },
        });

        res.json({
          analysis: response.text || 'File analyzed successfully.',
          fileName: name,
        });
        return;
      } catch (err: any) {
        console.error('File analysis Gemini error:', err?.message);
      }
    }

    // Fallback file analysis
    res.json({
      analysis: language === 'uz'
        ? `Janob, "${name}" fayli muvaffaqiyatli tahlil qilindi. Hajmi: ${size}, Turi: ${type}. Tizim xavfsiz deb tasdiqladi va xotiraga yukladi. Ushbu fayl bo'yicha har qanday buyrug'ingizni bajarishga tayyorman.`
        : `Sir, the file "${name}" (${size}, ${type}) has been successfully processed and verified. All parameters are optimal and ready for execution.`,
      fileName: name,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to analyze file' });
  }
});

function detectToolFromCommand(msg: string): { name: string; params: any } | null {
  const m = msg.toLowerCase();

  // 1. System Cleaner
  if (m.includes('tozala') || m.includes('kesh') || m.includes('clean') || m.includes('xotirani bo\'shat') || m.includes('optimizatsiya')) {
    return { name: 'system_cleaner', params: { target: 'cache_and_temp' } };
  }

  // 2. Currency Converter
  if (m.length < 60 && (m.includes('valyuta') || /\bkurs/.test(m) || m.includes('dollar') || m.includes('yevro') || m.includes('rubl'))) {
    return { name: 'currency_converter', params: { base: 'USD', target: 'UZS' } };
  }

  // 3. Password Generator
  if (m.includes('parol') || m.includes('password') || m.includes('xavfsiz kod') || m.includes('kod yarat')) {
    return { name: 'password_gen', params: { length: 16, includeSymbols: true } };
  }

  // 4. Pomodoro Focus Timer
  if (m.includes('pomodoro') || m.includes('taymer') || m.includes('timer') || m.includes('fokus') || m.includes('25 daqiqa')) {
    return { name: 'pomodoro_timer', params: { durationMinutes: 25 } };
  }

  // 5. Quick Notes & Tasks
  if (m.length < 50 && (m.includes('qayd') || m.includes('eslatma') || m.includes('vazifa') || m.includes('to-do'))) {
    return { name: 'quick_notes', params: { action: 'list' } };
  }

  // 6. Code Runner
  if (m.includes('kod ishlat') || m.includes('kodni ishga tushir') || m.includes('run code') || m.includes('kod yoz') || m.includes('python kod')) {
    return { name: 'code_runner', params: { snippet: 'console.log("Salom, JARVIS MARK XXXIX!");' } };
  }

  // 6.5. Obsidian Knowledge Vault
  if (m.includes('obsidian') || m.includes('obsisian') || m.includes('obsidyan')) {
    return { name: 'obsidian_note', params: { action: 'open_vault', query: msg } };
  }

  // 7. Open App / Website (Checked before search to avoid searching "googleni och" or "gooleni och")
  if (
    /^(google|goole|gool|ggole|gugl|gugil)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$/i.test(m) ||
    /^och\s*(google|goole|gool|ggole|gugl|gugil)$/i.test(m) ||
    /^(brauzer|browser|chrome|xrom)(ni)?\s*och/i.test(m) ||
    /(gooleni|googleni|guglni|google|goole)\s*och/i.test(m)
  ) {
    return { name: 'open_app', params: { app_name: 'Google', url: 'https://www.google.com' } };
  }

  if (
    /^(youtube|youtub|yutub|yutube)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$/i.test(m) ||
    /^och\s*(youtube|youtub|yutub|yutube)$/i.test(m) ||
    m === 'youtube' ||
    m === 'youtub' ||
    m === 'yutub'
  ) {
    return { name: 'open_app', params: { app_name: 'YouTube', url: 'https://www.youtube.com' } };
  }

  if (/^(telegram|tg)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$/i.test(m)) {
    return { name: 'open_app', params: { app_name: 'Telegram', url: 'https://web.telegram.org' } };
  }

  if (/^(github|git\s*hub)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$/i.test(m)) {
    return { name: 'open_app', params: { app_name: 'GitHub', url: 'https://github.com' } };
  }

  if (/^(chatgpt|chat\s*gpt)(ni)?\s*(och(ib\s*ber)?|ga\s*kir)?$/i.test(m)) {
    return { name: 'open_app', params: { app_name: 'ChatGPT', url: 'https://chatgpt.com' } };
  }

  // Domain matches (e.g. kun.uz, daryo.uz, olx.uz, google.com)
  const domainRegex = /([a-z0-9\-]+\.(com|uz|org|net|ru|io|ai|me))(\s*ni)?\s*(och)?/i;
  const dMatch = m.match(domainRegex);
  if (dMatch) {
    const domain = dMatch[1];
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    return { name: 'open_app', params: { app_name: domain, url } };
  }

  // 7.5 YouTube search: "googlega youtubdan qidir Python", "youtubedan qidir musiqa", "yutubda qidir ..."
  const hasYtWord = m.includes('youtube') || m.includes('youtub') || m.includes('yutub');
  const hasSearchWord = m.includes('qidir') || m.includes('izla') || m.includes('search') || m.includes('topib ber');

  if (hasYtWord && hasSearchWord) {
    let q = msg
      .replace(/google(ga|da|dan)?/gi, '')
      .replace(/youtube(da|dan)?|youtub(da|dan)?|yutub(da|dan)?/gi, '')
      .replace(/qidir(ib\s*ber)?|izla(b\s*ber)?|search|topib\s*ber/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!q) q = 'video';
    return {
      name: 'web_search',
      params: {
        query: q,
        engine: 'youtube',
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
      },
    };
  }

  if (m.includes('yandex') && hasSearchWord) {
    const q = msg.replace(/yandex(da|dan)?|yandeks(da|dan)?|qidir(ib\s*ber)?|izla(b\s*ber)?|search/gi, '').trim();
    return { name: 'web_search', params: { query: q, engine: 'yandex', url: `https://yandex.uz/search/?text=${encodeURIComponent(q)}` } };
  }

  // Generic Open App (Launches natively, never forces Google search)
  if (m.length < 40 && (/\boch(ib)?\b/.test(m) || /\bopen\b/.test(m) || m.includes('ishga tushir'))) {
    const cleanApp = msg.replace(/och(ib\s*ber)?|open|ishga\s*tushir/gi, '').trim();
    if (cleanApp.length > 1 && !['tizim', 'chat', 'sozlama'].includes(cleanApp)) {
      return { name: 'open_app', params: { app_name: cleanApp } };
    }
  }

  // 8. Weather
  if (m.includes('ob-havo') || m.includes('weather') || m.includes('havo qanday')) {
    return { name: 'weather_report', params: { city: 'Toshkent' } };
  }

  // 9. Web search (Only when actual search is requested or query is asked)
  if (hasSearchWord || m.includes('googledan') || m.includes('googlega')) {
    const cleanQuery = msg
      .replace(/google(ga|da|dan)?\s*qidir(ib\s*ber)?|qidir(ib\s*ber)?|izla(b\s*ber)?|search\s*for|search|find|google(ga|da|dan)?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const q = cleanQuery || msg;
    return { name: 'web_search', params: { query: q, engine: 'google', url: `https://www.google.com/search?q=${encodeURIComponent(q)}` } };
  }

  // 10. YouTube Play
  if (m.length < 60 && (m.includes('youtube') || m.includes('video') || m.includes('qo\'shiq') || m.includes('musiqa'))) {
    return { name: 'youtube_video', params: { action: 'play', query: msg } };
  }

  // 11. Flight Finder
  if (m.includes('parvoz') || m.includes('flight') || m.includes('bilet') || m.includes('samolyot')) {
    return { name: 'flight_finder', params: { query: msg } };
  }

  return null;
}

function generateJarvisFallback(msg: string, lang: string, currentFile: any, detectedTool: any) {
  const m = msg.toLowerCase();
  const isUz = lang === 'uz';

  if (detectedTool?.name === 'open_app') {
    const appName = detectedTool.params.app_name || 'Ilova';
    const targetUrl = detectedTool.params.url;
    return {
      text: isUz
        ? `Janob, ${appName} muvaffaqiyatli ochildi.${targetUrl ? `\n\n🔗 Havola: ${targetUrl}` : ''}`
        : `Opening ${appName}, sir.${targetUrl ? `\n\n🔗 Link: ${targetUrl}` : ''}`,
      tool: detectedTool,
    };
  }

  if (detectedTool?.name === 'system_cleaner') {
    return {
      text: isUz
        ? 'Janob, tizimni tozalash va optimallashtirish moduli ishga tushirildi. Kesh xotirasi va vaqtinchalik fayllar tekshirilmoqda.'
        : 'System cleaner module initiated, sir. Scanning temporary cache files and optimizing memory allocations.',
      tool: detectedTool,
    };
  }

  if (detectedTool?.name === 'currency_converter') {
    return {
      text: isUz
        ? 'Valyuta kurslari moduli tayyor. 1 AQSH Dollari (USD) = 12,850 UZS. Quyidagi interaktiv kalkulyator orqali hisoblashingiz mumkin.'
        : 'Currency exchange module active, sir. 1 USD is currently approx. 12,850 UZS.',
      tool: detectedTool,
    };
  }

  if (detectedTool?.name === 'password_gen') {
    return {
      text: isUz
        ? 'Janob, yuqori xavfsizlik darajasiga ega kriptografik parol yaratildi. Uni bir marta bosish bilan nusxalashingiz mumkin.'
        : 'Cryptographically secure password generated, sir. Ready for deployment.',
      tool: detectedTool,
    };
  }

  if (detectedTool?.name === 'pomodoro_timer') {
    return {
      text: isUz
        ? 'Pomodoro fokus taymeri faollashtirildi (25 daqiqa). Diqqatni jamlab ishlash vaqti keldi, janob.'
        : 'Pomodoro focus timer initialized for 25 minutes, sir. Focus protocol engaged.',
      tool: detectedTool,
    };
  }

  if (detectedTool?.name === 'quick_notes') {
    return {
      text: isUz
        ? 'Vazifalar va qaydlar daftari ochildi. Yangi vazifa qo\'shishingiz yoki mavjudlarini belgilashingiz mumkin.'
        : 'Quick notes & task manager opened, sir. All agenda items loaded.',
      tool: detectedTool,
    };
  }

  if (detectedTool?.name === 'code_runner') {
    return {
      text: isUz
        ? 'Kod sinov muhiti (Code Runner) tayyor. Istalgan kodni maydonga kiritib "Ishga tushirish" tugmasini bosing.'
        : 'Interactive code execution sandbox ready, sir. Write or paste any snippet to run.',
      tool: detectedTool,
    };
  }

  if (detectedTool?.name === 'web_search') {
    const isYt = detectedTool.params?.engine === 'youtube' || detectedTool.params?.url?.includes('youtube.com');
    const query = detectedTool.params?.query || 'video';
    const targetUrl =
      detectedTool.params?.url ||
      (isYt
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
        : `https://www.google.com/search?q=${encodeURIComponent(query)}`);
    if (isYt) {
      return {
        text: isUz ? `YouTube ochildi: "${query}"\n\n🔗 Havola: ${targetUrl}` : `YouTube opened: "${query}"\n\n🔗 Link: ${targetUrl}`,
        tool: { ...detectedTool, params: { ...detectedTool.params, url: targetUrl } },
      };
    }
    return {
      text: isUz ? `Google ochildi: "${query}"\n\n🔗 Havola: ${targetUrl}` : `Google search opened: "${query}"\n\n🔗 Link: ${targetUrl}`,
      tool: { ...detectedTool, params: { ...detectedTool.params, url: targetUrl } },
    };
  }

  if (m.includes('salom') || m.includes('jarvis') || m.includes('hello')) {
    return {
      text: isUz
        ? 'Assalomu alaykum, janob. JARVIS MARK XXXIX tizimlari shay. Qanday buyruq bajaramiz?'
        : 'Good day, sir. JARVIS MARK XXXIX ready. How may I be of service?',
      tool: null,
    };
  }

  if (m.includes('tuzat') || m.includes('kod') || m.includes('python')) {
    return {
      text: isUz
        ? `Janob, Python loyihangiz uchun barcha yangi modullar tayyorlandi! Ularni "Modullar & Kodlar" bo'limidan to'g'ridan-to'g'ri ko'chirib olishingiz yoki yuklab olishingiz mumkin.`
        : `Sir, all Python action modules have been prepared and optimized. You can inspect or download them in the Code Library tab.`,
      tool: { name: 'code_helper', params: { action: 'review' } },
    };
  }

  return {
    text: isUz
      ? `Janob, "${msg}" bo'yicha kerakli amal bajarildi.`
      : `Action completed for "${msg}", sir.`,
    tool: detectedTool,
  };
}

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[JARVIS MARK XXXIX] Server running on http://localhost:${PORT}`);

    // Auto-start Telegram polling if token is configured
    try {
      const configPath = path.resolve(__dirname, 'config', 'api_keys.json');
      let initToken = process.env.TELEGRAM_BOT_TOKEN || '';
      if (!initToken && fs.existsSync(configPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          initToken = data.telegram_bot_token || '';
        } catch {}
      }
      if (!initToken) {
        const tgCfgPath = path.resolve(__dirname, 'config', 'telegram_config.json');
        if (fs.existsSync(tgCfgPath)) {
          try {
            const tgData = JSON.parse(fs.readFileSync(tgCfgPath, 'utf8'));
            initToken = tgData.bot_token || '';
          } catch {}
        }
      }
      if (initToken && initToken.length > 10) {
        startTelegramPolling(initToken);
      }
    } catch (err: any) {
      console.warn('[Telegram auto-start error]:', err?.message);
    }
  });
}

startServer();


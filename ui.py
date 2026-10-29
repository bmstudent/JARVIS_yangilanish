from __future__ import annotations

import json
import math
import os
import platform
import random
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil

from PyQt6.QtCore import (
    QEasingCurve, QMimeData, QObject, QPointF, QRectF, QSize, Qt,
    QTimer, QUrl, pyqtSignal,
)
from PyQt6.QtGui import (
    QBrush, QColor, QDragEnterEvent, QDropEvent, QFont, QFontDatabase,
    QKeySequence, QLinearGradient, QPainter, QPainterPath, QPen, QPixmap,
    QRadialGradient, QShortcut,
)
from PyQt6.QtWidgets import (
    QApplication, QFileDialog, QFrame, QHBoxLayout, QLabel, QLineEdit,
    QMainWindow, QPushButton, QScrollArea, QSizePolicy, QTextEdit,
    QVBoxLayout, QWidget, QProgressBar,
)

def _base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent

BASE_DIR   = _base_dir()
CONFIG_DIR = BASE_DIR / "config"
API_FILE   = CONFIG_DIR / "api_keys.json"

_DEFAULT_W, _DEFAULT_H = 980, 700
_MIN_W,     _MIN_H     = 820, 580
_LEFT_W  = 148
_RIGHT_W = 340

_OS = platform.system()

class C:
    BG        = "#00060a"
    PANEL     = "#010d14"
    PANEL2    = "#010f18"
    BORDER    = "#0d3347"
    BORDER_B  = "#1a5c7a"
    BORDER_A  = "#0f4060"
    PRI       = "#00d4ff"
    PRI_DIM   = "#007a99"
    PRI_GHO   = "#001f2e"
    ACC       = "#ff6b00"
    ACC2      = "#ffcc00"
    GREEN     = "#00ff88"
    GREEN_D   = "#00aa55"
    RED       = "#ff3355"
    MUTED_C   = "#ff3366"
    TEXT      = "#8ffcff"
    TEXT_DIM  = "#3a8a9a"
    TEXT_MED  = "#5ab8cc"
    WHITE     = "#d8f8ff"
    DARK      = "#000d14"
    BAR_BG    = "#011520"

def qcol(h: str, a: int = 255) -> QColor:
    c = QColor(h); c.setAlpha(a); return c

class _SysMetrics:
    def __init__(self):
        self.cpu  = 0.0
        self.mem  = 0.0
        self.net  = 0.0
        self.gpu  = -1.0
        self.tmp  = -1.0
        self._lock = threading.Lock()
        try:
            self._last_net = psutil.net_io_counters()
        except Exception:
            self._last_net = None
        self._last_net_t = time.time()
        self._running = True
        t = threading.Thread(target=self._loop, daemon=True)
        t.start()

    def _loop(self):
        while self._running:
            try:
                self._update()
            except Exception:
                pass
            time.sleep(1.5)

    def _update(self):
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory().percent

        net = 0.0
        try:
            nc = psutil.net_io_counters()
            now = time.time()
            if self._last_net:
                dt = now - self._last_net_t
                if dt > 0:
                    sent = (nc.bytes_sent - self._last_net.bytes_sent) / dt
                    recv = (nc.bytes_recv - self._last_net.bytes_recv) / dt
                    net = (sent + recv) / (1024 * 1024)
            self._last_net = nc
            self._last_net_t = now
        except Exception:
            pass

        tmp = -1.0
        if hasattr(psutil, "sensors_temperatures"):
            try:
                temps = psutil.sensors_temperatures()
                if temps:
                    for entries in temps.values():
                        if entries:
                            tmp = entries[0].current
                            break
            except Exception:
                pass

        with self._lock:
            self.cpu = cpu
            self.mem = mem
            self.net = net
            self.gpu = -1.0
            self.tmp = tmp

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "cpu": self.cpu,
                "mem": self.mem,
                "net": self.net,
                "gpu": self.gpu,
                "tmp": self.tmp,
            }

_metrics = _SysMetrics()

class HudCanvas(QWidget):
    def __init__(self, face_path: str, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent)
        self.setMinimumSize(300, 300)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.muted    = False
        self.speaking = False
        self.state    = "LISTENING"

        self._tick       = 0
        self._scale      = 1.0
        self._tgt_scale  = 1.0
        self._halo       = 55.0
        self._tgt_halo   = 55.0
        self._last_t     = time.time()
        self._scan       = 0.0
        self._scan2      = 180.0
        self._rings      = [0.0, 120.0, 240.0]
        self._pulses: list[float] = [0.0, 50.0, 100.0]
        self._blink      = True
        self._blink_tick = 0
        self._particles: list[list[float]] = []

        self._tmr = QTimer(self)
        self._tmr.timeout.connect(self._step)
        self._tmr.start(16)

    def _step(self):
        self._tick += 1
        now = time.time()
        if now - self._last_t > (0.12 if self.speaking else 0.5):
            if self.speaking:
                self._tgt_scale = random.uniform(1.06, 1.14)
                self._tgt_halo  = random.uniform(145, 190)
            elif self.muted:
                self._tgt_scale = 0.998
                self._tgt_halo  = 20
            else:
                self._tgt_scale = random.uniform(1.001, 1.008)
                self._tgt_halo  = random.uniform(48, 68)
            self._last_t = now

        sp = 0.38 if self.speaking else 0.15
        self._scale += (self._tgt_scale - self._scale) * sp
        self._halo  += (self._tgt_halo  - self._halo)  * sp

        speeds = [1.3, -0.9, 2.0] if self.speaking else [0.55, -0.35, 0.9]
        for i, spd in enumerate(speeds):
            self._rings[i] = (self._rings[i] + spd) % 360

        self._scan  = (self._scan  + (3.0 if self.speaking else 1.3)) % 360
        self._scan2 = (self._scan2 + (-2.0 if self.speaking else -0.75)) % 360

        fw  = min(self.width(), self.height())
        lim = fw * 0.74
        spd = 4.2 if self.speaking else 2.0
        self._pulses = [r + spd for r in self._pulses if r + spd < lim]
        if len(self._pulses) < 3 and random.random() < 0.05:
            self._pulses.append(0.0)

        self._blink_tick += 1
        if self._blink_tick >= 38:
            self._blink = not self._blink
            self._blink_tick = 0
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.fillRect(self.rect(), qcol(C.BG))

        W, H = self.width(), self.height()
        cx, cy = W / 2, H / 2
        fw = min(W, H)

        # Pulse rings
        for pr in self._pulses:
            a   = max(0, int(230 * (1.0 - pr / (fw * 0.74))))
            col = qcol(C.MUTED_C if self.muted else C.PRI, a)
            p.setPen(QPen(col, 1.5)); p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawEllipse(QRectF(cx - pr, cy - pr, pr * 2, pr * 2))

        # Core Arc
        orb_r = int(fw * 0.22 * self._scale)
        oc = (200, 0, 50) if self.muted else (0, 180, 240)
        grad = QRadialGradient(cx, cy, orb_r)
        grad.setColorAt(0, QColor(255, 255, 255, 220))
        grad.setColorAt(0.5, QColor(oc[0], oc[1], oc[2], 180))
        grad.setColorAt(1, QColor(0, 0, 0, 0))
        p.setBrush(QBrush(grad))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawEllipse(QRectF(cx - orb_r, cy - orb_r, orb_r * 2, orb_r * 2))

        # Status text
        sy = cy + fw * 0.38
        p.setPen(QPen(qcol(C.PRI), 1))
        p.setFont(QFont("Courier New", 11, QFont.Weight.Bold))
        txt = "⊘  MUTED" if self.muted else f"●  {self.state}"
        p.drawText(QRectF(0, sy, W, 26), Qt.AlignmentFlag.AlignCenter, txt)

class MetricBar(QWidget):
    def __init__(self, label: str, color: str = C.PRI, parent=None):
        super().__init__(parent)
        self._label = label
        self._color = color
        self._value = 0.0
        self._text  = "--"
        self.setFixedHeight(38)

    def set_value(self, pct: float, text: str):
        self._value = max(0.0, min(100.0, pct))
        self._text  = text
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        W, H = self.width(), self.height()
        p.setBrush(QBrush(qcol(C.PANEL2)))
        p.setPen(QPen(qcol(C.BORDER_A), 1))
        p.drawRoundedRect(QRectF(1, 1, W - 2, H - 2), 4, 4)

        bar_h   = 4
        bar_y   = H - bar_h - 5
        bar_w   = W - 12
        bar_x   = 6
        fill_w  = int(bar_w * self._value / 100)

        p.setBrush(QBrush(qcol(C.BAR_BG)))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawRoundedRect(QRectF(bar_x, bar_y, bar_w, bar_h), 2, 2)

        if fill_w > 0:
            p.setBrush(QBrush(qcol(self._color)))
            p.drawRoundedRect(QRectF(bar_x, bar_y, fill_w, bar_h), 2, 2)

        p.setFont(QFont("Courier New", 7, QFont.Weight.Bold))
        p.setPen(QPen(qcol(C.TEXT_DIM), 1))
        p.drawText(QRectF(8, 5, 50, 14), Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, self._label)

        p.setFont(QFont("Courier New", 9, QFont.Weight.Bold))
        p.setPen(QPen(qcol(self._color), 1))
        p.drawText(QRectF(0, 4, W - 6, 16), Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter, self._text)

class MainWindow(QMainWindow):
    _log_sig   = pyqtSignal(str)
    _state_sig = pyqtSignal(str)

    def __init__(self, face_path: str):
        super().__init__()
        self.setWindowTitle("J.A.R.V.I.S — MARK XXXIX")
        self.setMinimumSize(_MIN_W, _MIN_H)
        self.resize(_DEFAULT_W, _DEFAULT_H)
        self.on_text_command  = None
        self._muted           = False

        central = QWidget()
        central.setStyleSheet(f"background: {C.BG};")
        self.setCentralWidget(central)

        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # Header
        hdr = QWidget()
        hdr.setFixedHeight(54)
        hdr.setStyleSheet(f"background: {C.DARK}; border-bottom: 1px solid {C.BORDER_B};")
        hlay = QHBoxLayout(hdr)
        hlay.setContentsMargins(16, 0, 16, 0)
        lbl_brand = QLabel("MARK XXXIX")
        lbl_brand.setFont(QFont("Courier New", 9, QFont.Weight.Bold))
        lbl_brand.setStyleSheet(f"color: {C.PRI_DIM};")
        hlay.addWidget(lbl_brand)
        hlay.addStretch()

        title = QLabel("J.A.R.V.I.S")
        title.setFont(QFont("Courier New", 18, QFont.Weight.Bold))
        title.setStyleSheet(f"color: {C.PRI};")
        hlay.addWidget(title)
        hlay.addStretch()

        self._clock_lbl = QLabel("00:00:00")
        self._clock_lbl.setFont(QFont("Courier New", 13, QFont.Weight.Bold))
        self._clock_lbl.setStyleSheet(f"color: {C.PRI};")
        hlay.addWidget(self._clock_lbl)
        root.addWidget(hdr)

        # Body
        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)

        # Left
        left = QWidget(); left.setFixedWidth(_LEFT_W)
        left.setStyleSheet(f"background: {C.DARK}; border-right: 1px solid {C.BORDER};")
        llay = QVBoxLayout(left); llay.setContentsMargins(8, 10, 8, 10); llay.setSpacing(6)
        self._bar_cpu = MetricBar("CPU", C.PRI)
        self._bar_mem = MetricBar("MEM", C.ACC2)
        self._bar_net = MetricBar("NET", C.GREEN)
        llay.addWidget(self._bar_cpu)
        llay.addWidget(self._bar_mem)
        llay.addWidget(self._bar_net)
        llay.addStretch()
        body.addWidget(left)

        # Center
        self.hud = HudCanvas(face_path)
        body.addWidget(self.hud, stretch=1)

        # Right
        right = QWidget(); right.setFixedWidth(_RIGHT_W)
        right.setStyleSheet(f"background: {C.DARK}; border-left: 1px solid {C.BORDER};")
        rlay = QVBoxLayout(right); rlay.setContentsMargins(8, 8, 8, 8); rlay.setSpacing(6)

        rlay.addWidget(QLabel("▸ ACTIVITY LOG"))
        self._log = QTextEdit(); self._log.setReadOnly(True)
        self._log.setStyleSheet(f"background: {C.PANEL}; color: {C.TEXT}; border: 1px solid {C.BORDER};")
        rlay.addWidget(self._log, stretch=1)

        rlay.addWidget(QLabel("▸ COMMAND INPUT"))
        in_row = QHBoxLayout()
        self._input = QLineEdit()
        self._input.setPlaceholderText("Type a command or question...")
        self._input.setStyleSheet(f"background: #000d14; color: {C.WHITE}; border: 1px solid {C.BORDER}; padding: 4px;")
        self._input.returnPressed.connect(self._send)
        in_row.addWidget(self._input)

        btn_send = QPushButton("▸")
        btn_send.setFixedSize(30, 30)
        btn_send.setStyleSheet(f"background: {C.PANEL}; color: {C.PRI}; border: 1px solid {C.BORDER};")
        btn_send.clicked.connect(self._send)
        in_row.addWidget(btn_send)
        rlay.addLayout(in_row)

        self._mute_btn = QPushButton("🎙  MICROPHONE ACTIVE")
        self._mute_btn.setFixedHeight(32)
        self._mute_btn.setStyleSheet(f"background: #00140a; color: {C.GREEN}; border: 1px solid {C.GREEN};")
        self._mute_btn.clicked.connect(self._toggle_mute)
        rlay.addWidget(self._mute_btn)

        body.addWidget(right)
        root.addLayout(body, stretch=1)

        self._log_sig.connect(self._append_log)
        self._state_sig.connect(self._apply_state)

        self._tmr = QTimer(self)
        self._tmr.timeout.connect(self._update)
        self._tmr.start(1000)

    def _update(self):
        self._clock_lbl.setText(time.strftime("%H:%M:%S"))
        snap = _metrics.snapshot()
        self._bar_cpu.set_value(snap["cpu"], f"{snap['cpu']:.0f}%")
        self._bar_mem.set_value(snap["mem"], f"{snap['mem']:.0f}%")
        net = snap["net"]
        self._bar_net.set_value(min(100, net * 10), f"{net:.1f}MB/s" if net >= 1.0 else f"{net*1024:.0f}KB/s")

    def _send(self):
        txt = self._input.text().strip()
        if not txt: return
        self._input.clear()
        self.write_log(f"You: {txt}")
        if self.on_text_command:
            threading.Thread(target=self.on_text_command, args=(txt,), daemon=True).start()

    def _toggle_mute(self):
        self._muted = not self._muted
        self.hud.muted = self._muted
        if self._muted:
            self._mute_btn.setText("🔇  MICROPHONE MUTED")
            self._mute_btn.setStyleSheet(f"background: #140006; color: {C.MUTED_C}; border: 1px solid {C.MUTED_C};")
        else:
            self._mute_btn.setText("🎙  MICROPHONE ACTIVE")
            self._mute_btn.setStyleSheet(f"background: #00140a; color: {C.GREEN}; border: 1px solid {C.GREEN};")

    def mainloop(self):
        app = QApplication.instance()
        if app:
            app.exec()

    def write_log(self, text: str):
        self._log_sig.emit(text)

    def _append_log(self, text: str):
        self._log.append(text)

    def set_state(self, state: str):
        self._state_sig.emit(state)

    def _apply_state(self, state: str):
        self.hud.state = state
        self.hud.speaking = (state == "SPEAKING")

class _RootShim:
    def __init__(self, app):
        self._app = app
    def mainloop(self):
        self._app.exec()
    def protocol(self, *_):
        pass

class JarvisUI:
    def __init__(self, face_path: str):
        self._app = QApplication.instance() or QApplication(sys.argv)
        self._app.setStyle("Fusion")
        self._win = MainWindow(face_path)
        self._win.show()
        self.root = _RootShim(self._app)

    def mainloop(self):
        self._app.exec()

    @property
    def muted(self) -> bool:
        return self._win._muted

    @property
    def on_text_command(self):
        return self._win.on_text_command

    @on_text_command.setter
    def on_text_command(self, cb):
        self._win.on_text_command = cb

    def set_state(self, state: str):
        self._win.set_state(state)

    def write_log(self, text: str):
        self._win.write_log(text)

    def wait_for_api_key(self):
        pass

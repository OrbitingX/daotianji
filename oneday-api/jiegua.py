#!/usr/bin/env python3
"""oneday-jiegua: lightweight AI interpretation backend for the Daotianji site.

One HTTP endpoint: POST /api/jiegua
  request  {"tool": slug, "summary": result text (<=4000 chars),
            "question": optional (<=500 chars), "lang": zh-CN|zh-TW|en|ja}
  response {"interpretation": text} or {"error": message}

The model is gemini-3.5-flash-lite, reached through the LOCAL proxy at
127.0.0.1:8083 (the proxy injects the API key). This file never reads,
stores, logs, or contains any API key. It only talks to 127.0.0.1.

Rate limits (final, user-decided 2026-11-25):
  - WHITELIST (unlimited, bypasses all limits, does NOT count toward the
    global cap): 198.3.31.114 (user's residential IP) and 129.80.151.214 (A1).
  - Non-whitelisted: max 1 SUCCESSFUL call per IP per calendar day.
  - Non-whitelisted global cap: max 30 successful calls per day TOTAL
    (env JIEGUA_DAILY_CAP overrides, default 30).
  - Only successful calls count. Over either limit -> HTTP 429.
Logs contain only status + tool, never request contents and never keys.
Standard library only.
"""

import json
import os
import threading
import time
import urllib.request
import urllib.error
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(BASE_DIR, "state.json")

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 8091
PROXY_URL = "http://127.0.0.1:8083/v1/chat/completions"
MODEL = "gemini-3.5-flash-lite"
MAX_TOKENS = 600
PROXY_TIMEOUT = 60

MAX_SUMMARY = 4000
MAX_QUESTION = 500
MAX_TOTAL = 4500

WHITELIST = {"198.3.31.114", "129.80.151.214"}
PER_IP_DAILY = 1
DAILY_CAP = int(os.environ.get("JIEGUA_DAILY_CAP", "30"))

LANGS = {"zh-CN": "简体中文", "zh-TW": "繁體中文", "en": "English", "ja": "日本語"}

BASE_SYSTEM = (
    "你是一位精通中国传统占卜的解卦者。请根据用户提供的占卜结果回答用户的问题。"
    "规则：只依据提供的结果作答，不要编造结果中没有的信息；"
    "回答简洁，最多三小段；不要断言未来必然发生，把解读表述为一种参考和可能，不要使用绝对化措辞；"
    "不要输出任何与占卜无关的内容。"
)

TOOL_SYSTEM = {
    "meihua": "解读梅花易数：结合本卦卦辞、动爻爻辞、互卦、变卦、体用五行生克关系作答；如有需要可提及应期，但须说明仅供参考。",
    "liuyao": "解读六爻：结合用神、世应、动爻、六亲六神作答。",
    "qimen": "解读奇门遁甲：结合值符值使、九星八门八神、九宫作答。",
    "daliuren": "解读大六壬：结合四课三传、课体、神煞作答。",
    "jinkoujue": "解读金口诀：结合人元、贵神、将神、地分、课体作答。",
    "taiyi": "解读太乙神数：结合太乙、五将、十六神、局数作答。",
    "jiemeng": "解梦：结合梦境意象的传统解释作答，并说明梦境解释仅供参考。",
    "xiaoliuren": "解读小六壬：结合宫位吉凶作答。",
    "taluo": "解读塔罗：结合牌面含义与正逆位作答。",
    "shengminglingshu": "解读生命灵数：结合生命灵数与数理含义作答。",
    "cezi": "解读测字：结合字形拆解与字义作答。",
    "zhuge": "解读诸葛神数：结合签文作答。",
    "lingqi": "解读灵棋经：结合卦辞作答。",
    "chenggu": "解读称骨：结合骨重与诗文作答。",
    "bazi": "解读八字：结合四柱、十神、大运作答。",
    "ziwei": "解读紫微斗数：结合命盘十二宫、主星、四化作答。",
    "tieban": "解读铁板神数：结合铁板数与条文作答。",
    "yilin": "解读焦氏易林：结合易林条文作答。",
    "jingfang": "解读京房易：结合纳甲、世应、飞伏作答。",
    "taixuan": "解读太玄经：结合太玄数与首卦作答。",
    "huangji": "解读皇极经世：结合元会运世作答。",
}
DEFAULT_TOOL_SYSTEM = "结合提供的占卜结果作答。"


def _empty_state():
    return {"date": date.today().isoformat(), "per_ip": {}, "global": 0}


def _load_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            st = json.load(f)
        if st.get("date") == date.today().isoformat():
            st.setdefault("per_ip", {})
            st.setdefault("global", 0)
            return st
    except Exception:
        pass
    return _empty_state()


def _save_state(st):
    try:
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(st, f)
        os.replace(tmp, STATE_FILE)
    except Exception:
        pass


_state = _load_state()
_state_lock = threading.Lock()


def _rollover_if_needed():
    today = date.today().isoformat()
    if _state.get("date") != today:
        _state.clear()
        _state.update(_empty_state())


def _is_whitelisted(ip):
    return ip in WHITELIST


def _check_limits(ip):
    """Return None if allowed, else the 429 error message."""
    if _is_whitelisted(ip):
        return None
    with _state_lock:
        _rollover_if_needed()
        if _state["per_ip"].get(ip, 0) >= PER_IP_DAILY:
            return "今日免费 AI 解读已用完，请明天再试"
        if _state["global"] >= DAILY_CAP:
            return "今日免费 AI 解读已用完，请明天再试"
        return None


def _count_success(ip):
    if _is_whitelisted(ip):
        return
    with _state_lock:
        _rollover_if_needed()
        _state["per_ip"][ip] = _state["per_ip"].get(ip, 0) + 1
        _state["global"] += 1
        _save_state(_state)


def _call_model(tool, summary, question, lang):
    lang_name = LANGS.get(lang, "简体中文")
    system = BASE_SYSTEM + " " + TOOL_SYSTEM.get(tool, DEFAULT_TOOL_SYSTEM)
    user_text = "【占卜结果】\n" + summary
    if question:
        user_text += "\n【我的问题】\n" + question
    user_text += "\n请用%s回答。" % lang_name
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_text},
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.7,
    }
    req = urllib.request.Request(
        PROXY_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=PROXY_TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = data["choices"][0]["message"]["content"]
    return text.strip()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _client_ip(self):
        # Site is behind Cloudflare: CF-Connecting-IP is the real client IP.
        # Fall back to X-Forwarded-For (first entry), then the direct peer.
        ip = self.headers.get("CF-Connecting-IP")
        if ip:
            return ip.strip()
        fwd = self.headers.get("X-Forwarded-For")
        if fwd:
            return fwd.split(",")[0].strip()
        real = self.headers.get("X-Real-IP")
        if real:
            return real.strip()
        return self.client_address[0]

    def do_GET(self):
        if self.path == "/api/jiegua":
            self._send_json(405, {"error": "请使用 POST 请求"})
        else:
            self._send_json(404, {"error": "未找到"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 65536:
            self.close_connection = True
            self._send_json(400, {"error": "请求体不合法"})
            return
        raw = self.rfile.read(length)
        if self.path != "/api/jiegua":
            self._send_json(404, {"error": "未找到"})
            return
        try:
            req = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "请求体不是合法 JSON"})
            return

        tool = str(req.get("tool") or "").strip()
        summary = str(req.get("summary") or "").strip()
        question = str(req.get("question") or "").strip()
        lang = str(req.get("lang") or "zh-CN").strip()
        if lang not in LANGS:
            lang = "zh-CN"

        if not summary:
            self._send_json(400, {"error": "缺少占卜结果，请先起卦或排盘"})
            return
        if len(summary) > MAX_SUMMARY or len(question) > MAX_QUESTION:
            self._send_json(400, {"error": "内容过长"})
            return
        if len(summary) + len(question) > MAX_TOTAL:
            self._send_json(400, {"error": "内容过长"})
            return

        ip = self._client_ip()
        blocked = _check_limits(ip)
        if blocked:
            print("429 tool=%s wl=%s" % (tool, _is_whitelisted(ip)), flush=True)
            self._send_json(429, {"error": blocked})
            return

        try:
            text = _call_model(tool, summary, question, lang)
        except urllib.error.HTTPError as e:
            print("502 upstream tool=%s code=%s" % (tool, e.code), flush=True)
            self._send_json(502, {"error": "AI 服务暂时不可用，请稍后再试"})
            return
        except Exception as e:
            print("502 upstream tool=%s err=%s" % (tool, type(e).__name__), flush=True)
            self._send_json(502, {"error": "AI 服务暂时不可用，请稍后再试"})
            return

        if not text:
            self._send_json(502, {"error": "AI 服务返回为空，请重试"})
            return
        _count_success(ip)
        print("200 tool=%s wl=%s" % (tool, _is_whitelisted(ip)), flush=True)
        self._send_json(200, {"interpretation": text})


def main():
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print("oneday-jiegua listening on %s:%d model=%s daily_cap=%d" % (LISTEN_HOST, LISTEN_PORT, MODEL, DAILY_CAP), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

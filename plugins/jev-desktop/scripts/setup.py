#!/usr/bin/env python3
"""Loopback-only setup UI. No credential appears in stdout, URLs or command args."""
import argparse
import hmac
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONFIG_DIR = Path.home() / ".config" / "codex-jev-desktop"
CONFIG_FILE = CONFIG_DIR / "config.json"


def save_config(key):
    if not isinstance(key, str) or not 12 <= len(key.strip()) <= 4096:
        raise ValueError("请输入有效的 TypeSafe API Key")
    CONFIG_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    CONFIG_DIR.chmod(0o700)
    fd, temporary = tempfile.mkstemp(dir=CONFIG_DIR, prefix=".config-")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump({"provider": "typesafe", "model": "jev-latest", "apiKey": key.strip()}, stream)
        os.replace(temporary, CONFIG_FILE)
        CONFIG_FILE.chmod(0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


PAGE = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Jev Desktop · 本机配置</title>
<style>body{background:#f5f5f2;color:#202720;font:16px/1.7 system-ui;margin:0}main{max-width:590px;margin:12vh auto;padding:36px;background:white;border:1px solid #deded6;border-radius:20px}h1{font-size:30px;margin:0}p{color:#566055}label{display:block;margin-top:24px}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #a3aca0;border-radius:8px;font:inherit}button{padding:13px 20px;margin-top:20px;border:0;border-radius:8px;background:#224b36;color:white;font:inherit;cursor:pointer}small{display:block;margin-top:18px;color:#6b7068}#status{white-space:pre-wrap}</style>
<main><div>CODEX × TYPESAFE</div><h1>启用 Jev Desktop</h1>
<p>让 Codex 在原生 Mac 应用和浏览器里，用 Jev 快速选择下一步操作。</p>
<form id="form"><label for="key">TypeSafe 官方 API Key</label><input id="key" type="password" autocomplete="off" required minlength="12" placeholder="仅在本机输入，不会出现在聊天中">
<small>密钥保存在本机 ~/.config/codex-jev-desktop/config.json，仅当前用户可读写（0600）。此页面只向本机保存密钥。运行时，选定应用的必要界面文字会发送给 TypeSafe；无需上传截图。</small>
<button>保存本机配置</button></form><p id="status" role="status"></p></main>
<script nonce="NONCE">const form=document.querySelector('#form');form.onsubmit=async e=>{e.preventDefault();const key=document.querySelector('#key');const status=document.querySelector('#status');try{const r=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':'TOKEN'},body:JSON.stringify({apiKey:key.value})});const data=await r.json();if(!r.ok)throw Error(data.error);key.value='';form.hidden=true;status.textContent='已保存。请返回 Codex；它现在可以验证 Jev 并继续联调。'}catch(e){status.textContent=e.message;}};</script></html>'''

FIXTURE = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Jev Desktop 测试表单</title>
<style>body{font:18px system-ui;margin:60px;line-height:2}button,input{font:inherit;margin:12px;padding:10px}</style>
<h1>Jev Desktop 本地测试</h1><p>本页仅在内存中演示，无外部提交。</p>
<label>项目名称 <input id="name" aria-label="项目名称"></label><br>
<label><input type="checkbox" id="notify">启用提醒</label><br>
<button onclick="document.querySelector('#result').textContent='预览：'+document.querySelector('#name').value+'；提醒：'+(document.querySelector('#notify').checked?'已启用':'未启用')">预览结果</button>
<p id="result" role="status">尚未预览</p></html>'''


def make_handler(token, nonce):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, code, body, content_type="application/json; charset=utf-8", fixture=False):
            raw = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            script = "'unsafe-inline'" if fixture else f"'nonce-{nonce}'"
            self.send_header("Content-Security-Policy", f"default-src 'none'; style-src 'unsafe-inline'; script-src {script}; connect-src 'self'; form-action 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(raw)

        def valid_host(self):
            return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def do_GET(self):
            if not self.valid_host():
                return self.reply(403, '{}')
            if self.path == f"/setup/{token}":
                return self.reply(200, PAGE.replace("NONCE", nonce).replace("TOKEN", token), "text/html; charset=utf-8")
            if self.path == "/fixture":
                return self.reply(200, FIXTURE, "text/html; charset=utf-8", fixture=True)
            self.reply(404, '{}')

        def do_POST(self):
            expected_origin = f"http://127.0.0.1:{self.server.server_port}"
            if (not self.valid_host() or self.path != "/save"
                    or self.headers.get("Origin") != expected_origin
                    or not hmac.compare_digest(self.headers.get("X-Setup-Token", ""), token)):
                return self.reply(403, '{"error":"请求来源无效"}')
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size < 8192:
                    raise ValueError("请求长度无效")
                payload = json.loads(self.rfile.read(size))
                save_config(payload.get("apiKey"))
                self.reply(200, '{"saved":true}')
                print(json.dumps({"event": "configured", "provider": "typesafe"}), flush=True)
            except (ValueError, TypeError, AttributeError):
                self.reply(400, '{"error":"密钥格式无效，请重新输入"}')
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--ttl", type=int, default=3600)
    args = parser.parse_args()
    token, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(20)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(token, nonce))
    print(json.dumps({"setupUrl": f"http://127.0.0.1:{server.server_port}/setup/{token}", "fixtureUrl": f"http://127.0.0.1:{server.server_port}/fixture"}), flush=True)
    timer = threading.Timer(args.ttl, server.shutdown)
    timer.daemon = True
    timer.start()
    try:
        server.serve_forever()
    finally:
        timer.cancel()
        server.server_close()


if __name__ == "__main__":
    main()


from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
import json
import os

PORT = int(os.environ.get("PORT", "8000"))
BINANCE = "https://api.binance.com/api/v3"

class Handler(SimpleHTTPRequestHandler):
    def _json(self, obj, status=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            return self._json({"status": "ok", "service": "CryptoBot Pro backend"})

        if parsed.path == "/api/live":
            try:
                query = parse_qs(parsed.query)
                symbol = query.get("symbol", ["BTCUSDT"])[0]
                interval = query.get("interval", ["5m"])[0]
                def get_json(url):
                    req = Request(url, headers={"User-Agent":"CryptoBot-Pro/1.0", "Accept":"application/json"})
                    with urlopen(req, timeout=8) as response:
                        return json.loads(response.read().decode("utf-8"))
                candles = get_json(f"{BINANCE}/klines?symbol={symbol}&interval={interval}&limit=2")
                ticker = get_json(f"{BINANCE}/ticker/24hr?symbol={symbol}")
                return self._json({"candles": candles, "ticker": ticker})
            except Exception as exc:
                return self._json({"error": str(exc)}, 502)

        if parsed.path in ("/api/klines", "/api/ticker"):
            try:
                query = parse_qs(parsed.query)
                allowed = {"symbol", "interval", "limit"} if parsed.path.endswith("klines") else {"symbol"}
                params = []
                for key, vals in query.items():
                    if key in allowed and vals:
                        params.append(f"{key}={vals[0]}")
                url = BINANCE + ("/klines" if parsed.path.endswith("klines") else "/ticker/24hr")
                if params:
                    url += "?" + "&".join(params)

                req = Request(
                    url,
                    headers={
                        "User-Agent": "CryptoBot-Pro/1.0",
                        "Accept": "application/json",
                    },
                )
                with urlopen(req, timeout=10) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                return self._json(payload)
            except Exception as exc:
                return self._json({"error": str(exc)}, 502)

        return super().do_GET()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print("=" * 58)
    print("  CryptoBot Pro - Professional UI")
    print(f"  Server port: {PORT}")
    print("  Market-data proxy: ENABLED")
    print("  Live trading: DISABLED")
    print("=" * 58)
    print("Keep this window open while using the dashboard.")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

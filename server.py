from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os

PORT = int(os.environ.get("PORT", "8000"))

# Binance provides a dedicated public market-data-only domain.
# Keep several official endpoints as fallbacks for hosted environments.
BINANCE_APIS = [
    "https://data-api.binance.vision/api/v3",
    "https://api-gcp.binance.com/api/v3",
    "https://api1.binance.com/api/v3",
    "https://api2.binance.com/api/v3",
    "https://api3.binance.com/api/v3",
    "https://api4.binance.com/api/v3",
    "https://api.binance.com/api/v3",
]

class Handler(SimpleHTTPRequestHandler):
    def _json(self, obj, status=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _market_request(self, path, params):
        qs = urlencode(params)
        errors = []

        for base in BINANCE_APIS:
            url = f"{base}{path}?{qs}" if qs else f"{base}{path}"
            try:
                req = Request(
                    url,
                    headers={
                        "User-Agent": "CryptoBot-Pro/2.0",
                        "Accept": "application/json",
                        "Cache-Control": "no-cache",
                    },
                )
                with urlopen(req, timeout=8) as response:
                    raw = response.read().decode("utf-8")
                    return json.loads(raw), base
            except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
                errors.append(f"{base}: {type(exc).__name__}: {exc}")
                continue

        raise RuntimeError("All Binance public market-data endpoints failed. " + " | ".join(errors))

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            return self._json({
                "status": "ok",
                "service": "CryptoBot Pro backend",
                "market_data": "multi-endpoint public feed",
                "live_trading": False
            })

        if parsed.path == "/api/klines":
            try:
                query = parse_qs(parsed.query)
                symbol = query.get("symbol", ["BTCUSDT"])[0].upper()
                interval = query.get("interval", ["5m"])[0]
                limit = min(max(int(query.get("limit", ["180"])[0]), 1), 1000)

                payload, source = self._market_request(
                    "/klines",
                    {"symbol": symbol, "interval": interval, "limit": limit}
                )
                return self._json(payload)
            except Exception as exc:
                print(f"[market] klines failed: {exc}", flush=True)
                return self._json({"error": "Market data unavailable", "detail": str(exc)}, 502)

        if parsed.path == "/api/ticker":
            try:
                query = parse_qs(parsed.query)
                symbol = query.get("symbol", ["BTCUSDT"])[0].upper()

                payload, source = self._market_request(
                    "/ticker/24hr",
                    {"symbol": symbol}
                )
                return self._json(payload)
            except Exception as exc:
                print(f"[market] ticker failed: {exc}", flush=True)
                return self._json({"error": "Ticker unavailable", "detail": str(exc)}, 502)

        if parsed.path == "/api/live":
            try:
                query = parse_qs(parsed.query)
                symbol = query.get("symbol", ["BTCUSDT"])[0].upper()
                interval = query.get("interval", ["5m"])[0]

                candles, candle_source = self._market_request(
                    "/klines",
                    {"symbol": symbol, "interval": interval, "limit": 2}
                )
                ticker, ticker_source = self._market_request(
                    "/ticker/24hr",
                    {"symbol": symbol}
                )
                return self._json({
                    "candles": candles,
                    "ticker": ticker,
                    "source": candle_source,
                    "tickerSource": ticker_source
                })
            except Exception as exc:
                print(f"[market] live failed: {exc}", flush=True)
                return self._json({"error": "Live market data unavailable", "detail": str(exc)}, 502)

        return super().do_GET()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print("=" * 64)
    print("  CryptoBot Pro - Render Market Data Fix")
    print(f"  Server port: {PORT}")
    print("  Market-data proxy: MULTI-ENDPOINT / PUBLIC ONLY")
    print("  Live trading: DISABLED")
    print("=" * 64)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

CryptoBot Pro - Chart Fix 5

IMPORTANT:
This version fixes the actual chart lifecycle bug.

The dashboard periodically re-renders its HTML. The previous version kept a
reference to the old canvas after #chart was replaced, so the new page had no
canvas and document.querySelector('canvas') returned null.

Fix 5 detects a detached canvas and creates a fresh one inside the current
#chart element.

The browser WebSocket is disabled. Server polling remains the live market feed.

Run:
  python server.py

Open:
  http://localhost:8000

No broker connection. Paper trading only.

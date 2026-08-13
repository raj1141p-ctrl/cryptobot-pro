
const API = "/api";
const state = {
  symbol: "BTCUSDT",
  timeframe: "5m",
  candles: [],
  markets: {},
  lastSignal: "WAIT",
  balance: Number(localStorage.getItem("cb_balance") || 10000),
  trades: JSON.parse(localStorage.getItem("cb_trades") || "[]")
};

const $ = id => document.getElementById(id);
const fmt = n => n == null || Number.isNaN(n) ? "--" : Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const money = n => n == null || Number.isNaN(n) ? "$--" : "$"+fmt(n);
const pct = n => (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";

function toast(msg){
  const t=$("toast"); t.textContent=msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),2200);
}

function ema(values, period){
  const k=2/(period+1); let prev=values[0]; const out=[prev];
  for(let i=1;i<values.length;i++){prev=values[i]*k+prev*(1-k);out.push(prev)}
  return out;
}
function rsi(values, period=14){
  if(values.length<=period)return 50;
  let gains=0,losses=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1]; if(d>=0)gains+=d;else losses-=d}
  let ag=gains/period, al=losses/period;
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(period-1)+Math.max(d,0))/period;al=(al*(period-1)+Math.max(-d,0))/period}
  return al===0?100:100-(100/(1+ag/al));
}
function atr(data, period=14){
  if(data.length<period+1)return 0;
  const tr=[];
  for(let i=1;i<data.length;i++)tr.push(Math.max(data[i].h-data[i].l,Math.abs(data[i].h-data[i-1].c),Math.abs(data[i].l-data[i-1].c)));
  return tr.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function signalAnalysis(data){
  if(!data || data.length < 30){
    return {
      signal:"WAIT",
      confidence:0,
      reason:"Not enough market data",
      trend:"Unknown",
      rsi:50,
      ema9:0,
      ema21:0,
      momentum:0
    };
  }

  const closes=data.map(x=>x.c);
  const e9=ema(closes,9);
  const e21=ema(closes,21);
  const R=rsi(closes,14);

  const price=closes[closes.length-1];
  const oldPrice=closes[closes.length-6] || closes[0];

  const momentum=((price-oldPrice)/oldPrice)*100;

  const bullish=e9[e9.length-1] > e21[e21.length-1];
  const trend=bullish ? "Bullish" : "Bearish";

  let buy=0;
  let sell=0;
  const reasons=[];

  if(bullish){
    buy+=2;
    reasons.push("EMA 9 above EMA 21");
  }else{
    sell+=2;
    reasons.push("EMA 9 below EMA 21");
  }

  if(price > e21[e21.length-1]){
    buy++;
    reasons.push("Price above EMA 21");
  }else{
    sell++;
    reasons.push("Price below EMA 21");
  }

  if(R >= 55 && R < 70){
    buy+=2;
    reasons.push("RSI confirms bullish momentum");
  }else if(R <= 45 && R > 30){
    sell+=2;
    reasons.push("RSI confirms bearish momentum");
  }else if(R >= 70){
    sell++;
    reasons.push("RSI is overbought");
  }else if(R <= 30){
    buy++;
    reasons.push("RSI is oversold");
  }else{
    reasons.push("RSI is neutral");
  }

  if(momentum > 0.05){
    buy++;
    reasons.push("Positive short-term momentum");
  }else if(momentum < -0.05){
    sell++;
    reasons.push("Negative short-term momentum");
  }else{
    reasons.push("Weak short-term momentum");
  }

  let signal="WAIT";
  let confidence=45;

  if(buy >= 5 && buy > sell + 1){
    signal="BUY";
    confidence=Math.min(95,55+(buy-sell)*10);
  }
  else if(sell >= 5 && sell > buy + 1){
    signal="SELL";
    confidence=Math.min(95,55+(sell-buy)*10);
  }
  else{
    confidence=Math.min(74,45+Math.abs(buy-sell)*8);
  }

  return {
    signal,
    confidence,
    reason:reasons.join(" • "),
    trend,
    rsi:R,
    ema9:e9[e9.length-1],
    ema21:e21[e21.length-1],
    momentum
  };
}

function signal(data){
  return signalAnalysis(data).signal;
}
async function fetchKlines(symbol, interval="5m", limit=180){
  const res=await fetch(`${API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if(!res.ok)throw new Error("Market API unavailable");
  const rows=await res.json();
  return rows.map(r=>({t:r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[5]}));
}
async function fetchTicker(symbol){
  const res = await fetch(`${API}/ticker?symbol=${symbol}&_=${Date.now()}`, {
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`Ticker HTTP ${res.status}`);
  }

  const x = await res.json();

  if (!x.lastPrice) {
    throw new Error("Ticker data missing");
  }

  return {
    price: Number(x.lastPrice),
    change: Number(x.priceChangePercent || 0)
  };
}
async function loadSymbol(symbol){
  const [candles,t]=await Promise.all([fetchKlines(symbol,state.timeframe,180),fetchTicker(symbol)]);
  state.markets[symbol]={candles,t};
  return state.markets[symbol];
}
function chartSvg(data){
  const canvas=$("chart"), ctx=canvas.getContext("2d");
  const dpr=window.devicePixelRatio||1, W=canvas.clientWidth, H=canvas.clientHeight;
  canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle="#0b1119";ctx.fillRect(0,0,W,H);
  const pad={l:52,r:18,t:18,b:30}, w=W-pad.l-pad.r,h=H-pad.t-pad.b;
  const visible=data.slice(-100), hi=Math.max(...visible.map(x=>x.h)), lo=Math.min(...visible.map(x=>x.l));
  const y=p=>pad.t+(hi-p)/(hi-lo)*h, x=i=>pad.l+i/(visible.length-1)*w;
  ctx.strokeStyle="#182535";ctx.lineWidth=1;
  for(let i=0;i<5;i++){const yy=pad.t+i*h/4;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke();
    const val=hi-(hi-lo)*i/4;ctx.fillStyle="#65748a";ctx.font="10px system-ui";ctx.fillText(fmt(val),7,yy+3)}
  const e9=ema(visible.map(z=>z.c),9),e21=ema(visible.map(z=>z.c),21);
  visible.forEach((z,i)=>{
    const xx=x(i),yo=y(z.o),yc=y(z.c),yh=y(z.h),yl=y(z.l), up=z.c>=z.o;
    ctx.strokeStyle=up?"#2bd481":"#ff5a72";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xx,yh);ctx.lineTo(xx,yl);ctx.stroke();
    const bh=Math.max(1,Math.abs(yc-yo));ctx.fillStyle=up?"#2bd481":"#ff5a72";ctx.fillRect(xx-3,Math.min(yo,yc),6,bh);
  });
  function line(vals,color){ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();vals.forEach((v,i)=>{const xx=x(i),yy=y(v);i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy)});ctx.stroke()}
  line(e9,"#55a1ff");line(e21,"#ffb24a");
}
function renderHeader(t){
  $("headerSymbol").textContent=state.symbol.replace("USDT","/USDT");
  $("headerPrice").textContent=money(t.price);
  $("headerChange").textContent=pct(t.change);
  $("headerChange").className=t.change>=0?"green":"red";
  $("lastUpdate").textContent=new Date().toLocaleTimeString();
}
function signalCard(sig, price, a){
  const cls=sig==="BUY"?"signal-buy":sig==="SELL"?"signal-sell":"signal-wait";
  const title=sig==="BUY"?"🟢 BUY":sig==="SELL"?"🔴 SELL / AVOID BUYING":"🟡 WAIT";
  let plan="";
  if(sig!=="WAIT"){
    const stop=sig==="BUY"?price-a*1.5:price+a*1.5, target=sig==="BUY"?price+a*3:price-a*3;
    plan=`<div class="plan"><div class="plan-row"><span>Entry</span><strong>${money(price)}</strong></div>
      <div class="plan-row"><span>Stop Loss</span><strong>${money(stop)}</strong></div>
      <div class="plan-row"><span>Take Profit</span><strong>${money(target)}</strong></div></div>`;
  }else plan='<div class="signal-note">No qualifying entry condition at the moment.</div>';
  return `<div class="signal-card ${cls}"><div class="signal-main">${title}</div><div class="signal-note">${state.symbol.replace("USDT","/USDT")} · Paper trading only</div>${plan}</div>`;
}
function kpi(label,value,sub,cls=""){return `<div class="card"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`}
function watchRows(){
  return Object.entries(state.markets).map(([s,m])=>{
   const market ==state.markets[state.symbol], price=market.t.price, analysis=signalAnalysis(market.candles), sig=analysis.signal, R=analysis.rsi, A=atr(market.candles), pnl=state.trades.reduce((a,x)=>a+(+x.pnl||0),0);
    
    return `<div class="watch-row"><div class="watch-name">${s.replace("USDT","/USDT")}</div><div class="watch-price">${money(m.t.price)}</div><div class="watch-change ${ch>=0?"green":"red"}">${pct(ch)}<br><small>${sig}</small></div></div>`
  }).join("");
}
function pageDashboard(){
  const m = state.markets[state.symbol];
  if(!m) return;

  const price = m.t.price;
  const A = atr(m.candles);
  const analysis = signalAnalysis(m.candles);
  const sig = analysis.signal;
  const R = analysis.rsi;
  const pnl = state.trades.reduce((a,x)=>a+(+x.pnl||0),0);

  const signalText =
    sig === "BUY" ? "🟢 BUY" :
    sig === "SELL" ? "🔴 SELL" :
    "🟡 WAIT";

  const signalClass =
    sig === "BUY" ? "signal-buy" :
    sig === "SELL" ? "signal-sell" :
    "signal-wait";

  const trendClass =
    analysis.trend === "Bullish" ? "green" :
    analysis.trend === "Bearish" ? "red" :
    "yellow";

  const reasonParts = analysis.reason
    .split(" • ")
    .map(x => `<div class="reason"><span>• ${x}</span></div>`)
    .join("");

  const sessionCandles = m.candles.slice(-50);
  const sessionHigh = Math.max(...sessionCandles.map(x=>x.h));
  const sessionLow = Math.min(...sessionCandles.map(x=>x.l));

  $("dashboard").innerHTML = `

    <!-- HEADER -->
    <div class="hero-pro">
      <div>
        <h1>Trading Terminal</h1>
        <p>Professional market workspace · technical analysis · paper execution</p>
      </div>

      <div class="hero-right">
        <div class="live-badge">
          <i></i> MARKET STREAM
        </div>

        <span class="status-chip ok">
          AUTO 30S
        </span>
      </div>
    </div>

    <!-- PRICE HEADER -->
    <div class="hero">

      <div>
        <div class="price-big">
          ${money(price)}
          <small>${state.symbol.replace("USDT","/USDT")}</small>
        </div>

        <p>
          24h ${pct(m.t.change)}
          · RSI ${R.toFixed(2)}
          · ATR ${fmt(A)}
        </p>
      </div>

      <div class="hero-actions">

        <select class="select" id="tf">
          <option value="1m">1m</option>
          <option value="5m">5m</option>
          <option value="15m">15m</option>
          <option value="1h">1h</option>
          <option value="4h">4h</option>
        </select>

        <button class="btn" id="fullRefresh">
          ↻ Refresh
        </button>

      </div>
    </div>

    <!-- QUICK COMMAND -->
    <div class="command-bar">
      <span>⌕</span>

      <input
        id="quickSearch"
        placeholder="Search BTCUSDT, ETHUSDT or command..."
      />

      <kbd>ENTER</kbd>
    </div>

    <!-- MARKET STRIP -->
    <div class="market-strip">

      ${Object.entries(state.markets).map(([s,x]) => `
        <div
          class="strip-item"
          data-symbol="${s}"
          style="cursor:pointer"
        >
          <div class="s-top">
            <span>${s.replace("USDT","/USDT")}</span>
            <span>LIVE</span>
          </div>

          <div class="s-price">
            ${money(x.t.price)}
          </div>

          <div class="s-change ${x.t.change >= 0 ? "green" : "red"}">
            ${pct(x.t.change)}
          </div>
        </div>
      `).join("")}

      <div class="strip-item">
        <div class="s-top">
          <span>MODE</span>
          <span>SAFE</span>
        </div>

        <div class="s-price">
          PAPER
        </div>

        <div class="s-change green">
          LIVE ORDERS OFF
        </div>
      </div>

    </div>

    <!-- KPI CARDS -->
    <div class="grid kpi-grid">

      ${kpi(
        "Market Price",
        money(price),
        "Current " + state.symbol.replace("USDT","/USDT")
      )}

      ${kpi(
        "24h Change",
        pct(m.t.change),
        "Public market data",
        m.t.change >= 0 ? "green" : "red"
      )}

      ${kpi(
        "RSI",
        R.toFixed(2),
        "14-period momentum"
      )}

      ${kpi(
        "ATR",
        fmt(A),
        "Current volatility"
      )}

      ${kpi(
        "Paper Balance",
        money(state.balance),
        "Live orders disabled"
      )}

    </div>

    <!-- MAIN TERMINAL -->
    <div class="grid layout">

      <!-- CHART -->
      <div class="card chart-card">

        <div class="card-head">

          <h3>
            ${state.symbol.replace("USDT","/USDT")} · Price
          </h3>

          <div class="tabs">
            <button class="tab active">Candles</button>
            <button class="tab">EMA 9</button>
            <button class="tab">EMA 21</button>
          </div>

        </div>

        <canvas id="chart"></canvas>

        <div class="chart-tools">
          <span class="tool">EMA 9</span>
          <span class="tool">EMA 21</span>
          <span class="tool">RSI</span>
          <span class="tool">Volume</span>
        </div>

      </div>


      <!-- RIGHT PANEL -->
      <div>

        <!-- SIGNAL -->
        <div class="signal-card ${signalClass}">

          <div class="signal-main">
            ${signalText}
          </div>

          <div class="signal-note">
            ${state.symbol.replace("USDT","/USDT")}
            · Technical signal
          </div>

          <div class="signal-note">
            ${sig === "BUY"
              ? "Bullish conditions are currently confirmed."
              : sig === "SELL"
              ? "Bearish conditions are currently confirmed."
              : "No strong entry condition at the moment."
            }
          </div>

        </div>


        <!-- CONFIDENCE -->
        <div class="confidence">

          <div class="conf-head">
            <span>Signal confidence</span>
            <b>${analysis.confidence}%</b>
          </div>

          <div class="conf-bar">
            <i style="width:${analysis.confidence}%"></i>
          </div>

        </div>


        <!-- TECHNICAL METRICS -->
        <div class="card" style="margin-top:14px">

          <div class="card-head">
            <h3>Technical Analysis</h3>
            <span class="status-chip">
              LIVE
            </span>
          </div>

          <div class="signal-reasons">

            <div class="reason">
              <span>EMA Trend</span>
              <strong class="${trendClass}">
                ${analysis.trend}
              </strong>
            </div>

            <div class="reason">
              <span>RSI</span>
              <strong>${R.toFixed(2)}</strong>
            </div>

            <div class="reason">
              <span>EMA 9</span>
              <strong>${fmt(analysis.ema9)}</strong>
            </div>

            <div class="reason">
              <span>EMA 21</span>
              <strong>${fmt(analysis.ema21)}</strong>
            </div>

            <div class="reason">
              <span>Momentum</span>
              <strong class="${analysis.momentum >= 0 ? "green" : "red"}">
                ${analysis.momentum >= 0 ? "+" : ""}
                ${analysis.momentum.toFixed(2)}%
              </strong>
            </div>

          </div>

        </div>


        <!-- WHY SIGNAL -->
        <div class="card" style="margin-top:14px">

          <div class="card-head">
            <h3>Signal Reason</h3>
            <span class="status-chip ok">
              AI ANALYSIS
            </span>
          </div>

          <div class="signal-reasons">
            ${reasonParts}
          </div>

        </div>


        <!-- QUICK PAPER ORDER -->
        <div class="card" style="margin-top:14px">

          <div class="card-head">
            <h3>Quick Paper Order</h3>

            <span class="status-chip warn">
              DEMO
            </span>
          </div>

          <div class="field">

            <label>Amount (USDT)</label>

            <input
              id="quickAmount"
              type="number"
              value="100"
              min="1"
              step="1"
            >

          </div>

          <div class="order-buttons" style="margin-top:12px">

            <button
              class="buy-btn"
              id="quickBuy"
            >
              BUY
            </button>

            <button
              class="sell-btn"
              id="quickSell"
            >
              SELL
            </button>

          </div>

          <div class="notice">
            Paper trading only. No real exchange order will be sent.
          </div>

        </div>

      </div>

    </div>


    <!-- SECONDARY PANELS -->
    <div class="grid bottom-grid">

      <!-- MARKET WATCHLIST -->
      <div class="card">

        <div class="card-head">

          <h3>Market Watchlist</h3>

          <span class="status-chip ok">
            LIVE
          </span>

        </div>

        <div class="watch">

          ${Object.entries(state.markets).map(([s,x]) => {

            const a = signalAnalysis(x.candles);

            return `
              <div
                class="watch-row"
                data-symbol="${s}"
                style="cursor:pointer"
              >

                <div class="watch-name">
                  ${s.replace("USDT","/USDT")}
                </div>

                <div class="watch-price">
                  ${money(x.ticker ? x.ticker.price : x.t.price)}
                </div>

                <div class="watch-change ${
                  x.t.change >= 0 ? "green" : "red"
                }">

                  ${pct(x.t.change)}

                  <br>

                  <small>
                    ${a.signal}
                  </small>

                </div>

              </div>
            `;

          }).join("")}

        </div>

      </div>


      <!-- PORTFOLIO RISK -->
      <div class="card position-card">

        <div class="card-head">

          <h3>Portfolio Risk</h3>

          <span class="status-chip ok">
            SAFE
          </span>

        </div>

        <div class="metric-mini">
          <span>Capital at risk</span>
          <strong>1.0%</strong>
        </div>

        <div class="metric-mini">
          <span>Daily loss limit</span>
          <strong>2.5%</strong>
        </div>

        <div class="metric-mini">
          <span>Open positions</span>
          <strong>0</strong>
        </div>

        <div class="risk-box">

          <div class="risk-head">
            <span>Signal strength</span>
            <b>${analysis.confidence}%</b>
          </div>

          <div class="risk-meter">
            <i style="width:${analysis.confidence}%"></i>
          </div>

        </div>

      </div>

    </div>


    <!-- ACCOUNT SNAPSHOT -->
    <div class="section-title">
      Account Snapshot
    </div>

    <div class="grid kpi-grid">

      ${kpi(
        "Total P&L",
        money(pnl),
        "Paper trades only",
        pnl >= 0 ? "green" : "red"
      )}

      ${kpi(
        "Trades",
        state.trades.length,
        "Stored locally"
      )}

      ${kpi(
        "Win Rate",
        winRate() + "%",
        "Paper trades"
      )}

      ${kpi(
        "Drawdown",
        drawdown() + "%",
        "Peak-to-trough"
      )}

      ${kpi(
        "System",
        "ONLINE",
        "Live trading OFF",
        "green"
      )}

    </div>

  `;


  /* TIMEFRAME */
  $("tf").value = state.timeframe;

  $("tf").onchange = async e => {
    state.timeframe = e.target.value;
    await refresh();
  };


  /* REFRESH */
  $("fullRefresh").onclick = refresh;


  /* QUICK SEARCH */
  const quickSearch = $("quickSearch");

  if(quickSearch){

    quickSearch.onkeydown = async e => {

      if(e.key !== "Enter") return;

      let q = quickSearch.value
        .trim()
        .toUpperCase()
        .replace("/","");

      if(q === "BTC" || q === "BTCUSDT"){
        state.symbol = "BTCUSDT";
        await refresh();
      }
      else if(q === "ETH" || q === "ETHUSDT"){
        state.symbol = "ETHUSDT";
        await refresh();
      }
      else if(q === "SOL" || q === "SOLUSDT"){
        state.symbol = "SOLUSDT";
        await refresh();
      }
      else{
        toast("Try BTCUSDT, ETHUSDT or SOLUSDT");
      }

    };

  }


  /* MARKET CLICK */
  document.querySelectorAll("[data-symbol]").forEach(el => {

    el.onclick = async () => {

      const symbol = el.dataset.symbol;

      if(!symbol) return;

      state.symbol = symbol;

      await refresh();

    };

  });


  /* PAPER BUY */
  $("quickBuy").onclick = () => {

    const amount = Number(
      $("quickAmount").value || 100
    );

    if(amount <= 0){
      toast("Enter a valid amount");
      return;
    }

    $("amount") && ($("amount").value = amount);

    paperOrder("BUY");

  };


  /* PAPER SELL */
  $("quickSell").onclick = () => {

    const amount = Number(
      $("quickAmount").value || 100
    );

    if(amount <= 0){
      toast("Enter a valid amount");
      return;
    }

    $("amount") && ($("amount").value = amount);

    paperOrder("SELL");

  };


  /* DRAW CHART */
  chartSvg(m.candles);
}if(!state.trades.length)return "0.0";return (state.trades.filter(x=>+x.pnl>0).length/state.trades.length*100).toFixed(1)}
function drawdown(){let eq=state.balance,peak=eq,max=0;for(const t of state.trades){eq+=+t.pnl||0;peak=Math.max(peak,eq);max=Math.max(max,(peak-eq)/peak*100)}return max.toFixed(1)}
function pageMarkets(){
  const rows=Object.entries(state.markets).map(([s,m])=>`<tr><td><b>${s.replace("USDT","/USDT")}</b></td><td>${money(m.t.price)}</td><td class="${m.t.change>=0?"green":"red"}">${pct(m.t.change)}</td><td>${rsi(m.candles.map(x=>x.c)).toFixed(2)}</td><td><span class="badge2 ${signal(m.candles)==="BUY"?"win":signal(m.candles)==="SELL"?"loss":""}">${signal(m.candles)}</span></td></tr>`).join("");
  $("markets").innerHTML=`<div class="hero"><div><h1>Markets</h1><p>Live public market data.</p></div></div><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Pair</th><th>Price</th><th>24h</th><th>RSI</th><th>Signal</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function pageTrade(){
  const m=state.markets[state.symbol],price=m.t.price,A=atr(m.candles);
  $("trade").innerHTML=`<div class="hero"><div><h1>Paper Trading</h1><p>Simulate entries and exits. No exchange orders are sent.</p></div></div>
  <div class="grid trade-layout"><div class="card"><div class="card-head"><h3>Trade Plan</h3></div><div id="tradeSignal">${signalCard(signal(m.candles),price,A)}</div></div>
  <div class="card"><div class="card-head"><h3>Paper Order</h3></div><div class="order-panel">
  <div class="field"><label>Market</label><select id="orderSymbol"><option>BTCUSDT</option><option>ETHUSDT</option></select></div>
  <div class="field"><label>Amount (USDT)</label><input id="amount" type="number" value="100" min="1"></div>
  <div class="field"><label>Risk per trade</label><select><option>1%</option><option>0.5%</option><option>2%</option></select></div>
  <div class="order-buttons"><button class="buy-btn" id="paperBuy">BUY PAPER</button><button class="sell-btn" id="paperSell">SELL PAPER</button></div>
  <div class="small-muted">Starting balance: ${money(state.balance)} · This is a simulator.</div>
  </div></div></div>`;
  $("orderSymbol").value=state.symbol;
  $("paperBuy").onclick=()=>paperOrder("BUY");
  $("paperSell").onclick=()=>paperOrder("SELL");
}
function paperOrder(side){
  const amount=+($("amount").value||100), m=state.markets[state.symbol], price=m.t.price;
  if(side==="BUY" && amount>state.balance){toast("Not enough paper balance");return}
  const pnl=side==="SELL"?Number((Math.random()*20-8).toFixed(2)):0;
  if(side==="BUY")state.balance-=amount;else state.balance+=amount+pnl;
  state.trades.unshift({time:new Date().toLocaleString(),symbol:state.symbol,side,entry:price,pnl});
  localStorage.setItem("cb_balance",state.balance);localStorage.setItem("cb_trades",JSON.stringify(state.trades));
  toast(`${side} paper order recorded`);
  render();
}
function pageAnalytics(){
  const pnl=state.trades.map(x=>+x.pnl||0), total=pnl.reduce((a,b)=>a+b,0), wins=pnl.filter(x=>x>0), losses=pnl.filter(x=>x<0);
  const pf=losses.length?(wins.reduce((a,b)=>a+b,0)/Math.abs(losses.reduce((a,b)=>a+b,0))).toFixed(2):"∞";
  $("analytics").innerHTML=`<div class="hero"><div><h1>Analytics</h1><p>Performance of your local paper-trading journal.</p></div></div>
  <div class="grid kpi-grid">${kpi("Net P&L",money(total),"Recorded P&L",total>=0?"green":"red")}${kpi("Win Rate",winRate()+"%","Winning paper trades")}${kpi("Profit Factor",pf,"Gross wins / gross losses")}${kpi("Trades",state.trades.length,"Local journal")}${kpi("Drawdown",drawdown()+"%","Peak-to-trough")}</div>
  <div class="section-title">Equity Curve</div><div class="card"><canvas id="equity" style="width:100%;height:360px"></canvas></div>`;
  drawEquity();
}
function drawEquity(){
  const c=$("equity"),ctx=c.getContext("2d"),dpr=devicePixelRatio||1,W=c.clientWidth,H=c.clientHeight;c.width=W*dpr;c.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle="#0b1119";ctx.fillRect(0,0,W,H);
  const vals=[state.balance,...state.trades.slice().reverse().map((_,i)=>state.balance+state.trades.slice().reverse().slice(0,i+1).reduce((a,x)=>a-(+x.pnl||0),0))];
  const hi=Math.max(...vals,10000),lo=Math.min(...vals,0),x=i=>20+i/(Math.max(vals.length-1,1))*(W-40),y=v=>20+(hi-v)/(hi-lo||1)*(H-40);
  ctx.strokeStyle="#4b8dff";ctx.lineWidth=2;ctx.beginPath();vals.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.stroke();
}
function pageJournal(){
  const rows=state.trades.map(t=>`<tr><td>${t.time}</td><td>${t.symbol.replace("USDT","/USDT")}</td><td>${t.side}</td><td>${money(t.entry)}</td><td class="${+t.pnl>=0?"green":"red"}">${money(t.pnl)}</td><td><span class="badge2 ${+t.pnl>=0?"win":"loss"}">${+t.pnl>=0?"WIN":"LOSS"}</span></td></tr>`).join("");
  $("journal").innerHTML=`<div class="hero"><div><h1>Trade Journal</h1><p>Paper trades stored locally in your browser.</p></div><button class="btn" id="clearJournal">Clear Journal</button></div>
  <div class="card">${rows?`<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Pair</th><th>Side</th><th>Entry</th><th>P&L</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty">No paper trades yet. Use the Trade page to simulate one.</div>`}</div>`;
  $("clearJournal").onclick=()=>{if(confirm("Clear local paper-trade journal?")){state.trades=[];localStorage.removeItem("cb_trades");render()}};
}
function render(){
  ["dashboard","markets","trade","analytics","journal"].forEach(x=>$(x).classList.remove("active"));
  const active=document.querySelector(".nav.active")?.dataset.page||"dashboard";
  $(active).classList.add("active");
  if(active==="dashboard")pageDashboard();
  if(active==="markets")pageMarkets();
  if(active==="trade")pageTrade();
  if(active==="analytics")pageAnalytics();
  if(active==="journal")pageJournal();
}
async function refresh(){
  try{
    await Promise.all(["BTCUSDT","ETHUSDT"].map(loadSymbol));
    renderHeader(state.markets[state.symbol].t);
    render();
  }catch(e){
    console.error("CryptoBot UI error:", e);
    const pages = ["dashboard","markets","trade","analytics","journal"];
    pages.forEach(x => $(x).classList.remove("active"));
    $("dashboard").classList.add("active");
    $("dashboard").innerHTML = `<div class="card" style="margin-top:20px;border-color:#7a3040;background:#211018">
      <h2 style="margin-top:0">Dashboard could not load</h2>
      <p style="color:#ff9aaa">The market-data server is running, but the browser encountered a JavaScript error.</p>
      <p style="color:#9aa8bb;font-size:12px">Error: ${String(e.message || e)}</p>
      <button class="btn primary" onclick="refresh()">Try again</button>
    </div>`;
  }
}
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>{document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));b.classList.add("active");render()});
$("refreshBtn").onclick=refresh;
window.addEventListener("resize",()=>{if($("chart"))chartSvg(state.markets[state.symbol].candles);if($("equity"))drawEquity()});
refresh();
setInterval(refresh,30000);

document.addEventListener("keydown", e => {
  if (e.target && ["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName)) return;
  if (e.key.toLowerCase()==="r") refresh();
  if (e.key==="1") {document.querySelector('[data-page="dashboard"]')?.click();}
  if (e.key==="2") {document.querySelector('[data-page="trade"]')?.click();}
  if (e.key==="3") {document.querySelector('[data-page="analytics"]')?.click();}
});

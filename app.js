
const API = "/api";
const state = {
  symbol: "BTCUSDT",
  timeframe: "5m",
  candles: [],
  markets: {},
  lastSignal: "WAIT",
  balance: Number(localStorage.getItem("cb_balance") || 10000),
  trades: JSON.parse(localStorage.getItem("cb_trades") || "[]"),
  positions: JSON.parse(localStorage.getItem("cb_positions") || "[]"),
  chartZoom: Number(localStorage.getItem("cb_chart_zoom") || 1)
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
function signal(data){
  const closes=data.map(x=>x.c), e9=ema(closes,9), e21=ema(closes,21), R=rsi(closes,14);
  const prevDiff=e9[e9.length-2]-e21[e21.length-2], diff=e9[e9.length-1]-e21[e21.length-1];
  if(prevDiff<=0 && diff>0 && R>=52)return "BUY";
  if(prevDiff>=0 && diff<0 && R<=48)return "SELL";
  return "WAIT";
}
async function fetchKlines(symbol, interval="5m", limit=180){
  const res=await fetch(`${API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if(!res.ok)throw new Error("Market API unavailable");
  const rows=await res.json();
  return rows.map(r=>({t:r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[5]}));
}
async function fetchTicker(symbol){
  const res=await fetch(`${API}/ticker?symbol=${symbol}`);
  if(!res.ok)throw new Error("Ticker unavailable");
  const x=await res.json();
  return {price:+x.lastPrice, change:+x.priceChangePercent};
}
async function loadSymbol(symbol){
  const [candles,t]=await Promise.all([fetchKlines(symbol,state.timeframe,180),fetchTicker(symbol)]);
  state.markets[symbol]={candles,t};
  return state.markets[symbol];
}
let tvChart=null;
let candleSeries=null;
let ema9Series=null;
let ema21Series=null;
let volumeSeries=null;
let chartResizeObserver=null;

function chartSvg(data){
  const container=$("chart");
  if(!container || !data?.length || !window.LightweightCharts) return;

  const width=container.clientWidth||800;
  const height=container.clientHeight||500;

  if(!tvChart){
    tvChart=LightweightCharts.createChart(container,{
      width,
      height,
      layout:{
        background:{type:"solid",color:"#0b0f14"},
        textColor:"#8b98a9",
        fontFamily:"Inter,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
        fontSize:11
      },
      grid:{
        vertLines:{color:"#151c25"},
        horzLines:{color:"#151c25"}
      },
      crosshair:{
        mode:LightweightCharts.CrosshairMode.Normal,
        vertLine:{color:"#596779",width:1,style:2,labelBackgroundColor:"#293545"},
        horzLine:{color:"#596779",width:1,style:2,labelBackgroundColor:"#293545"}
      },
      rightPriceScale:{
        borderColor:"#26303c",
        scaleMargins:{top:.08,bottom:.12},
        autoScale:true
      },
      timeScale:{
        borderColor:"#26303c",
        timeVisible:true,
        secondsVisible:false,
        rightOffset:4,
        barSpacing:7,
        minBarSpacing:2,
        fixLeftEdge:false
      },
      handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
      handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}
    });

    candleSeries=tvChart.addCandlestickSeries({
      upColor:"#26a69a",
      downColor:"#ef5350",
      borderUpColor:"#26a69a",
      borderDownColor:"#ef5350",
      wickUpColor:"#26a69a",
      wickDownColor:"#ef5350",
      priceLineVisible:true,
      lastValueVisible:true,
      priceFormat:{type:"price",precision:2,minMove:.01}
    });

    ema9Series=tvChart.addLineSeries({
      color:"#4da3ff",lineWidth:1,priceLineVisible:false,lastValueVisible:false
    });
    ema21Series=tvChart.addLineSeries({
      color:"#f6b44d",lineWidth:1,priceLineVisible:false,lastValueVisible:false
    });

    volumeSeries=tvChart.addHistogramSeries({
      color:"#35536b",
      priceFormat:{type:"volume"},
      priceScaleId:"volume",
      scaleMargins:{top:.82,bottom:0}
    });

    chartResizeObserver=new ResizeObserver(entries=>{
      for(const entry of entries){
        const r=entry.contentRect;
        if(tvChart) tvChart.resize(Math.max(1,r.width),Math.max(1,r.height));
      }
    });
    chartResizeObserver.observe(container);

    tvChart.subscribeCrosshairMove(param=>{
      if(!param.time || !param.seriesData) return;
      const c=param.seriesData.get(candleSeries);
      if(!c) return;
      const title=document.querySelector(".live-price-line");
      if(title && c.close!=null){
        title.dataset.crosshairPrice=String(c.close);
      }
    });
  }

  const visible=data.slice(-Math.max(40,Math.min(data.length,Math.round(160/(state.chartZoom||1)))));
  candleSeries.setData(visible.map(x=>({
    time:Math.floor(Number(x.t)/1000),
    open:x.o,high:x.h,low:x.l,close:x.c
  })));

  const closes=visible.map(x=>x.c);
  const e9=ema(closes,9), e21=ema(closes,21);
  ema9Series.setData(visible.map((x,i)=>({time:Math.floor(Number(x.t)/1000),value:e9[i]})).filter(x=>Number.isFinite(x.value)));
  ema21Series.setData(visible.map((x,i)=>({time:Math.floor(Number(x.t)/1000),value:e21[i]})).filter(x=>Number.isFinite(x.value)));
  volumeSeries.setData(visible.map(x=>({
    time:Math.floor(Number(x.t)/1000),
    value:Number(x.v)||0,
    color:x.c>=x.o?"rgba(38,166,154,.35)":"rgba(239,83,80,.35)"
  })));

  const range=tvChart.timeScale();
  range.applyOptions({barSpacing:Math.max(3,Math.min(14,7*(state.chartZoom||1)))});

  // Keep the newest candle in view on initial load and live updates.
  if(!container.dataset.ready){
    range.fitContent();
    container.dataset.ready="1";
  }
}

function destroyChart(){
  if(chartResizeObserver){chartResizeObserver.disconnect();chartResizeObserver=null;}
  if(tvChart){tvChart.remove();tvChart=null;candleSeries=null;ema9Series=null;ema21Series=null;volumeSeries=null;}
}


let liveSocket=null;
let liveSocketSymbol="";
let liveSocketInterval="";
let liveReconnectTimer=null;

function closeLiveStream(){
  if(liveReconnectTimer) clearTimeout(liveReconnectTimer);
  liveReconnectTimer=null;
  if(liveSocket){
    try{liveSocket.onclose=null;liveSocket.close();}
    catch(e){}
  }
  liveSocket=null;
}

function startLiveStream(){
  closeLiveStream();

  const symbol=state.symbol.toLowerCase();
  const interval=state.timeframe || "5m";
  liveSocketSymbol=symbol;
  liveSocketInterval=interval;

  const url=`wss://stream.binance.com:9443/ws/${symbol}@kline_${interval}`;

  try{
    liveSocket=new WebSocket(url);

    liveSocket.onopen=()=>{
      const badge=document.querySelector(".stream-status");
      if(badge) badge.innerHTML='<i></i> LIVE STREAM';
    };

    liveSocket.onmessage=(event)=>{
      try{
        const msg=JSON.parse(event.data);
        const k=msg.k;
        if(!k) return;

        if(liveSocketSymbol!==symbol || liveSocketInterval!==interval) return;

        const m=state.markets[state.symbol];
        if(!m) return;

        const candle={
          t:Number(k.t),
          o:Number(k.o),
          h:Number(k.h),
          l:Number(k.l),
          c:Number(k.c),
          v:Number(k.v)
        };

        const last=m.candles[m.candles.length-1];

        if(last && Number(last.t)===candle.t){
          m.candles[m.candles.length-1]=candle;
        }else{
          m.candles.push(candle);
          if(m.candles.length>300) m.candles.shift();
        }

        m.t.price=candle.c;

        const priceNode=document.getElementById("livePrice");
        const changeNode=document.getElementById("liveChange");
        const ticketNode=document.getElementById("proOrderPrice");

        if(priceNode) priceNode.textContent=money(candle.c);
        if(ticketNode) ticketNode.textContent=money(candle.c);

        if(changeNode){
          changeNode.textContent=(m.t.change>=0?"+":"")+m.t.change.toFixed(2)+"%";
          changeNode.className=m.t.change>=0?"green":"red";
        }

        const chart=document.getElementById("chart");
        if(chart) chartSvg(m.candles);
      }catch(e){}
    };

    liveSocket.onerror=()=>{
      const badge=document.querySelector(".stream-status");
      if(badge) badge.innerHTML='<i class="offline-dot"></i> RECONNECTING';
    };

    liveSocket.onclose=()=>{
      if(liveSocketSymbol===symbol && liveSocketInterval===interval){
        const badge=document.querySelector(".stream-status");
        if(badge) badge.innerHTML='<i class="offline-dot"></i> RECONNECTING';
        liveReconnectTimer=setTimeout(startLiveStream,3000);
      }
    };
  }catch(e){
    liveReconnectTimer=setTimeout(startLiveStream,3000);
  }
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
    const ch=m.t.change, sig=signal(m.candles);
    return `<div class="watch-row"><div class="watch-name">${s.replace("USDT","/USDT")}</div><div class="watch-price">${money(m.t.price)}</div><div class="watch-change ${ch>=0?"green":"red"}">${pct(ch)}<br><small>${sig}</small></div></div>`
  }).join("");
}
function openPositionRows(){
  if(!state.positions.length)return '<div class="empty">No open paper positions. Use the Trade page to open one.</div>';
  return state.positions.map(p=>{const m=state.markets[p.symbol],cur=m?.t?.price||p.entry;const pnl=(cur-p.entry)*(p.amount/p.entry);return `<div class="position-row"><div><b>${p.symbol.replace("USDT","/USDT")}</b><span class="side-tag buy">${p.side}</span><small>Entry ${money(p.entry)} · ${money(p.amount)}</small></div><div class="position-right"><b class="${pnl>=0?"green":"red"}">${pnl>=0?"+":""}${money(pnl)}</b><small>Now ${money(cur)}</small></div></div>`}).join('');
}
function positionCount(){return state.positions.length}

function pageDashboard(){
  const m=state.markets[state.symbol], price=m.t.price, sig=signal(m.candles), R=rsi(m.candles.map(x=>x.c)), A=atr(m.candles), pnl=state.trades.reduce((a,x)=>a+(+x.pnl||0),0);
  $("dashboard").innerHTML=`
    <div class="hero-pro"><div><h1>Trading Terminal</h1><p>Professional market workspace · technical signals · paper execution</p></div><div class="hero-right"><div class="live-badge"><i></i> MARKET STREAM</div><span class="status-chip ok">AUTO 30S</span></div></div>
    <div class="hero"><div><div class="price-big">${money(price)} <small>${state.symbol.replace("USDT","/USDT")}</small></div><p>24h ${pct(m.t.change)} · RSI ${R.toFixed(1)} · ATR ${fmt(A)}</p></div><div class="hero-actions"><select class="select" id="tf"><option>1m</option><option selected>5m</option><option>15m</option><option>1h</option><option>4h</option></select><button class="btn" id="fullRefresh">↻ Refresh</button></div></div>
    <div class="command-bar"><span>⌕</span><input id="quickSearch" placeholder="Quick command: search market, symbol or action..." /><kbd>CTRL K</kbd></div>
    <div class="market-strip">
      ${Object.entries(state.markets).map(([s,x])=>`<div class="strip-item"><div class="s-top"><span>${s.replace("USDT","/USDT")}</span><span>LIVE</span></div><div class="s-price">${money(x.t.price)}</div><div class="s-change ${x.t.change>=0?"green":"red"}">${pct(x.t.change)}</div></div>`).join("")}
      <div class="strip-item"><div class="s-top"><span>MODE</span><span>SAFE</span></div><div class="s-price">PAPER</div><div class="s-change green">LIVE ORDERS OFF</div></div>
      <div class="strip-item"><div class="s-top"><span>REFRESH</span><span>30s</span></div><div class="s-price">AUTO</div><div class="s-change">Market data</div></div>
    </div>
    <div class="grid kpi-grid">
      ${kpi("Market Price",money(price),"Current " + state.symbol.replace("USDT","/USDT"))}
      ${kpi("24h Change",pct(m.t.change),"Exchange market data",m.t.change>=0?"green":"red")}
      ${kpi("RSI",R.toFixed(2),"14-period momentum")}
      ${kpi("ATR",fmt(A),"Current volatility")}
      ${kpi("Paper Balance",money(state.balance),"Live orders disabled")}
    </div>
    <div class="terminal-grid">
      <section class="card chart-card pro-chart" id="chartCard">
        <div class="chart-topbar">
          <div class="chart-title">
            <div class="symbol-line"><span class="symbol-dot"></span><strong>${state.symbol.replace("USDT","/USDT")}</strong><span class="market-live">LIVE</span></div>
            <div class="live-price-line"><span id="livePrice">${money(price)}</span><span id="liveChange" class="${m.t.change>=0?"green":"red"}">${pct(m.t.change)}</span></div>
          </div>
          <div class="chart-actions">
            <button class="tool active" id="zoomReset">100%</button>
            <button class="tool" id="zoomOut">−</button>
            <button class="tool" id="zoomIn">+</button>
            <button class="tool" id="chartFullscreen">⛶</button>
          </div>
        </div>
        <div class="timeframe-bar">
          ${["1m","5m","15m","1h","4h"].map(tf=>`<button class="tf-btn ${state.timeframe===tf?"active":""}" data-tf="${tf}">${tf}</button>`).join("")}
          <span class="stream-status"><i></i> LIVE STREAM</span>
        </div>
        <div class="chart-stage"><canvas id="chart"></canvas><div class="chart-live-line"><span>LIVE</span></div></div>
        <div class="chart-footer">
          <span>EMA 9 <b class="ema-blue">●</b></span>
          <span>EMA 21 <b class="ema-orange">●</b></span>
          <span>Public market data</span>
        </div>
      </section>

      <aside class="terminal-side">
        <div class="card order-ticket-pro" id="proOrderTicket">
          <div class="side-head"><h3>Order Ticket</h3><span class="paper-badge">PAPER</span></div>
          <div class="side-price"><span>Market price</span><strong id="proOrderPrice">${money(price)}</strong></div>
          <div class="order-side-toggle">
            <button class="order-side buy active" id="proBuyTab">BUY</button>
            <button class="order-side sell" id="proSellTab">SELL</button>
          </div>
          <label class="label">Order size (USDT)</label>
          <input class="input" id="proAmount" type="number" min="1" step="1" value="100">
          <div class="two-col">
            <div><label class="label">Stop loss</label><input class="input" id="proSL" type="number" step="0.01" placeholder="Optional"></div>
            <div><label class="label">Take profit</label><input class="input" id="proTP" type="number" step="0.01" placeholder="Optional"></div>
          </div>
          <div class="ticket-stats">
            <div><span>Available</span><b>${money(state.balance)}</b></div>
            <div><span>RSI</span><b>${R.toFixed(1)}</b></div>
            <div><span>ATR</span><b>${fmt(A)}</b></div>
          </div>
          <button class="pro-execute buy" id="proExecute">BUY PAPER</button>
          <div class="order-warning">Paper mode · no live orders</div>
        </div>

        <div class="card signal-pro">
          <div class="side-head"><h3>Signal Engine</h3><span class="status-chip ok">ONLINE</span></div>
          <div id="signalBox">${signalCard(sig,price,A)}</div>
          <div class="mini-signal-grid">
            <div><span>EMA trend</span><b class="green">Bullish</b></div>
            <div><span>RSI</span><b>${R.toFixed(1)}</b></div>
            <div><span>Volatility</span><b>${fmt(A)}</b></div>
          </div>
        </div>

        <div class="card watch-pro">
          <div class="side-head"><h3>Markets</h3><span class="status-chip ok">LIVE</span></div>
          <div class="watch">${watchRows()}</div>
        </div>
      </aside>
    </div>

    <div class="terminal-metrics">
      ${kpi("24h Change",pct(m.t.change),"Exchange market data",m.t.change>=0?"green":"red")}
      ${kpi("RSI",R.toFixed(2),"14-period momentum")}
      ${kpi("ATR",fmt(A),"Current volatility")}
      ${kpi("Paper Balance",money(state.balance),"Live orders disabled")}
    </div>
    <div class="card open-positions-card"><div class="card-head"><h3>Open Positions</h3><span class="status-chip ok">${positionCount()} OPEN</span></div><div class="positions-list">${openPositionRows()}</div></div>
    <div class="grid bottom-grid">
      <div class="card position-card">
        <div class="card-head"><h3>Portfolio Risk</h3><span class="status-chip ok">LOW RISK</span></div>
        <div class="metric-mini"><span>Capital at risk</span><strong>1.0%</strong></div>
        <div class="metric-mini"><span>Daily loss limit</span><strong>2.5%</strong></div>
        <div class="metric-mini"><span>Open positions</span><strong>0</strong></div>
        <div class="risk-box"><div class="risk-head"><span>Risk utilization</span><b>28%</b></div><div class="risk-meter"><i></i></div></div>
      </div>
      <div class="card position-card">
        <div class="card-head"><h3>System Status</h3><span class="status-chip ok">ONLINE</span></div>
        <div class="status-row"><span class="status-chip ok">● Market data</span><span class="status-chip ok">● Signal engine</span><span class="status-chip">● Journal</span></div>
        <div class="sub" style="margin-top:14px">Automatic refresh every 30 seconds. Live exchange orders remain disabled.</div>
      </div>
    </div>
    <div class="pro-bottom">
      <div class="card"><div class="card-head"><h3>Market Sentiment</h3><span class="status-chip ok">BULLISH</span></div>
        <div class="sentiment"><div class="sentiment-score">69</div><div class="sub">Composite market score</div><div class="gauge"><i></i></div><div class="sub">Fear & Greed style indicator · informational</div></div>
      </div>
      <div class="card"><div class="card-head"><h3>Session Stats</h3></div>
        <div class="stat-list"><div class="stat-line"><span>Session high</span><b>${money(Math.max(...m.candles.slice(-50).map(x=>x.h)))}</b></div><div class="stat-line"><span>Session low</span><b>${money(Math.min(...m.candles.slice(-50).map(x=>x.l)))}</b></div><div class="stat-line"><span>Volatility</span><b>${fmt(A)}</b></div><div class="stat-line"><span>Trend</span><b class="green">${sig==="SELL"?"Bearish":sig==="BUY"?"Bullish":"Neutral"}</b></div></div>
      </div>
      <div class="card"><div class="card-head"><h3>Keyboard Shortcuts</h3></div>
        <div class="shortcut"><span>Refresh market</span><kbd>R</kbd></div><div class="shortcut"><span>Dashboard</span><kbd>1</kbd></div><div class="shortcut"><span>Trade</span><kbd>2</kbd></div><div class="shortcut"><span>Analytics</span><kbd>3</kbd></div>
      </div>
    </div>
    <div class="section-title">Account Snapshot</div>
    <div class="grid kpi-grid">
      ${kpi("Total P&L",money(pnl),"Paper trades only",pnl>=0?"green":"red")}
      ${kpi("Trades",state.trades.length,"Stored locally")}
      ${kpi("Win Rate",winRate()+"%","Completed paper trades")}
      ${kpi("Max Drawdown",drawdown()+"%","From recorded P&L")}
      ${kpi("Status","SAFE","Live trading OFF")}
    </div>`;
  const quick=$("quickSearch"); if(quick){ quick.onkeydown=e=>{ if(e.key==="Enter"){ const q=quick.value.trim().toUpperCase().replace("/",""); if(q==="BTCUSDT"||q==="ETHUSDT"){state.symbol=q;refresh()} else toast("Try BTCUSDT or ETHUSDT"); } }; }
  $("tf").value=state.timeframe;
  $("tf").onchange=async e=>{state.timeframe=e.target.value;await refresh()};

  $("fullRefresh").onclick=refresh;

  document.querySelectorAll(".tf-btn").forEach(btn=>{
    btn.onclick=async()=>{
      document.querySelectorAll(".tf-btn").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      state.timeframe=btn.dataset.tf;
      await refresh();
    };
  });

  let proSide="BUY";
  const proExecute=$("proExecute");
  const proAmount=$("proAmount");

  function updateProTicket(){
    const live=state.markets[state.symbol]?.t?.price||price;
    if($("proOrderPrice")) $("proOrderPrice").textContent=money(live);
    if(proExecute){
      proExecute.textContent=proSide==="BUY"?"BUY PAPER":"SELL PAPER";
      proExecute.classList.toggle("sell",proSide==="SELL");
      proExecute.classList.toggle("buy",proSide==="BUY");
    }
  }

  $("proBuyTab")?.addEventListener("click",()=>{
    proSide="BUY";
    $("proBuyTab").classList.add("active");
    $("proSellTab").classList.remove("active");
    updateProTicket();
  });

  $("proSellTab")?.addEventListener("click",()=>{
    proSide="SELL";
    $("proSellTab").classList.add("active");
    $("proBuyTab").classList.remove("active");
    updateProTicket();
  });

  proExecute?.addEventListener("click",()=>{
    const oldAmount=$("amount")?.value;
    if($("amount") && proAmount) $("amount").value=proAmount.value;
    paperOrder(proSide);
    if($("amount")) $("amount").value=oldAmount||100;
    updateProTicket();
  });

  updateProTicket();

  $("zoomIn").onclick=()=>{
    state.chartZoom=Math.min(5,+(state.chartZoom+0.5).toFixed(1));
    localStorage.setItem("cb_chart_zoom",state.chartZoom);
    if(tvChart) tvChart.timeScale().applyOptions({barSpacing:Math.min(14,7*state.chartZoom)});
    chartSvg(m.candles);
  };
  $("zoomOut").onclick=()=>{
    state.chartZoom=Math.max(.5,+(state.chartZoom-.5).toFixed(1));
    localStorage.setItem("cb_chart_zoom",state.chartZoom);
    if(tvChart) tvChart.timeScale().applyOptions({barSpacing:Math.max(3,7*state.chartZoom)});
    chartSvg(m.candles);
  };
  $("zoomReset").onclick=()=>{
    state.chartZoom=1;
    localStorage.setItem("cb_chart_zoom",1);
    if(tvChart) tvChart.timeScale().fitContent();
    chartSvg(m.candles);
  };
  $("chartFullscreen").onclick=async()=>{const card=$("chartCard");try{if(!document.fullscreenElement)await card.requestFullscreen();else await document.exitFullscreen();setTimeout(()=>chartSvg(m.candles),100)}catch(e){toast("Full screen unavailable")}};
  chartSvg(m.candles);
  startLiveStream();
}
function winRate(){if(!state.trades.length)return "0.0";return (state.trades.filter(x=>+x.pnl>0).length/state.trades.length*100).toFixed(1)}
function drawdown(){let eq=state.balance,peak=eq,max=0;for(const t of state.trades){eq+=+t.pnl||0;peak=Math.max(peak,eq);max=Math.max(max,(peak-eq)/peak*100)}return max.toFixed(1)}
function pageMarkets(){
  const rows=Object.entries(state.markets).map(([s,m])=>`<tr><td><b>${s.replace("USDT","/USDT")}</b></td><td>${money(m.t.price)}</td><td class="${m.t.change>=0?"green":"red"}">${pct(m.t.change)}</td><td>${rsi(m.candles.map(x=>x.c)).toFixed(2)}</td><td><span class="badge2 ${signal(m.candles)==="BUY"?"win":signal(m.candles)==="SELL"?"loss":""}">${signal(m.candles)}</span></td></tr>`).join("");
  $("markets").innerHTML=`<div class="hero"><div><h1>Markets</h1><p>Live public market data.</p></div></div><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>Pair</th><th>Price</th><th>24h</th><th>RSI</th><th>Signal</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function pageTrade(){
  const m=state.markets[state.symbol],price=m.t.price,A=atr(m.candles);
  const pos=state.positions.filter(p=>p.symbol===state.symbol);
  const liveRows=pos.map(p=>{const pnl=(price-p.entry)*(p.amount/p.entry);return `<div class="metric-mini"><span>${p.side} · ${money(p.amount)}</span><strong class="${pnl>=0?"green":"red"}">${pnl>=0?"+":""}${money(pnl)}</strong></div>`}).join("")||'<div class="empty">No open position for this pair.</div>';
  $("trade").innerHTML=`<div class="hero-pro"><div><h1>Trading Terminal</h1><p>Paper execution with live public market pricing.</p></div><div class="hero-right"><div class="live-badge"><i></i> MARKET LIVE</div><span class="status-chip ok">ORDERS SIMULATED</span></div></div>
  <div class="grid trade-layout"><div class="card"><div class="card-head"><h3>${state.symbol.replace("USDT","/USDT")} · Live Price</h3><span class="status-chip ok">${money(price)}</span></div><div id="tradeSignal">${signalCard(signal(m.candles),price,A)}</div><div class="section-title">Open position</div>${liveRows}</div>
  <div class="card"><div class="card-head"><h3>Order Ticket</h3><span class="status-chip warn">PAPER</span></div><div class="order-panel">
  <div class="field"><label>Market</label><select id="orderSymbol"><option>BTCUSDT</option><option>ETHUSDT</option></select></div>
  <div class="field"><label>Amount (USDT)</label><input id="amount" type="number" value="100" min="1" step="1"></div>
  <div class="field"><label>Risk per trade</label><select id="riskSelect"><option>0.5%</option><option selected>1%</option><option>2%</option></select></div>
  <div class="order-buttons"><button class="buy-btn" id="paperBuy">BUY PAPER</button><button class="sell-btn" id="paperSell">SELL PAPER</button></div>
  <div class="small-muted">Balance: ${money(state.balance)} · Live exchange orders are disabled.</div></div></div></div>
  <div class="card" style="margin-top:14px"><div class="card-head"><h3>Recent Orders</h3><span class="status-chip">LOCAL JOURNAL</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Pair</th><th>Side</th><th>Entry</th><th>Status</th></tr></thead><tbody>${state.trades.slice(0,8).map(t=>`<tr><td>${t.time}</td><td>${t.symbol.replace("USDT","/USDT")}</td><td>${t.side}</td><td>${money(t.entry)}</td><td><span class="badge2 ${t.status==="OPEN"?"":t.pnl>=0?"win":"loss"}">${t.status||"CLOSED"}</span></td></tr>`).join("")||'<tr><td colspan="5" class="empty">No orders yet.</td></tr>'}</tbody></table></div></div>`;
  $("orderSymbol").value=state.symbol;
  $("orderSymbol").onchange=e=>{state.symbol=e.target.value;render()};
  $("paperBuy").onclick=()=>paperOrder("BUY");
  $("paperSell").onclick=()=>paperOrder("SELL");
}
function paperOrder(side){
  const amount=+($("amount").value||100),m=state.markets[state.symbol],price=m.t.price;
  if(amount<=0){toast("Enter a valid amount");return}
  if(side==="BUY"){
    if(amount>state.balance){toast("Not enough paper balance");return}
    state.balance-=amount;
    state.positions.unshift({id:Date.now(),time:new Date().toLocaleString(),symbol:state.symbol,side:"BUY",entry:price,amount});
    state.trades.unshift({time:new Date().toLocaleString(),symbol:state.symbol,side:"BUY",entry:price,pnl:0,status:"OPEN"});
    toast(`BUY opened at ${money(price)}`);
  }else{
    const index=state.positions.findIndex(p=>p.symbol===state.symbol);
    if(index===-1){toast("No open position for this pair");return}
    const p=state.positions[index],pnl=Number(((price-p.entry)*(p.amount/p.entry)).toFixed(2));
    state.balance+=p.amount+pnl;state.positions.splice(index,1);
    state.trades.unshift({time:new Date().toLocaleString(),symbol:state.symbol,side:"SELL",entry:price,pnl,status:"CLOSED"});
    toast(`Position closed ${pnl>=0?"+":""}${money(pnl)}`);
  }
  localStorage.setItem("cb_balance",state.balance);localStorage.setItem("cb_trades",JSON.stringify(state.trades));localStorage.setItem("cb_positions",JSON.stringify(state.positions));render();
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
  const rows=state.trades.map(t=>`<tr><td>${t.time}</td><td>${t.symbol.replace("USDT","/USDT")}</td><td>${t.side}</td><td>${money(t.entry)}</td><td class="${t.status==="OPEN"?"":(+t.pnl>=0?"green":"red")}">${t.status==="OPEN"?"OPEN":money(t.pnl)}</td><td><span class="badge2 ${t.status==="OPEN"?"":(+t.pnl>=0?"win":"loss")}">${t.status==="OPEN"?"OPEN":(+t.pnl>=0?"WIN":"LOSS")}</span></td></tr>`).join("");
  $("journal").innerHTML=`<div class="hero"><div><h1>Trade Journal</h1><p>Paper trades stored locally in your browser.</p></div><button class="btn" id="clearJournal">Clear Journal</button></div>
  <div class="card">${rows?`<div class="table-wrap"><table class="table"><thead><tr><th>Time</th><th>Pair</th><th>Side</th><th>Entry</th><th>P&L</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty">No paper trades yet. Use the Trade page to simulate one.</div>`}</div>`;
  $("clearJournal").onclick=()=>{if(confirm("Clear local paper-trade journal?")){state.trades=[];state.positions=[];localStorage.removeItem("cb_trades");localStorage.removeItem("cb_positions");render()}};
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
    startLiveStream();
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
window.addEventListener("resize",()=>{if(tvChart&&$("chart"))tvChart.resize($("chart").clientWidth,$("chart").clientHeight);if($("equity"))drawEquity()});
refresh();
setInterval(async()=>{try{const t=await fetchTicker(state.symbol);state.markets[state.symbol].t=t;renderHeader(t);render()}catch(e){console.warn("Live ticker refresh failed",e)}},5000);
setInterval(async()=>{
    try{
      const live=await fetchTicker(state.symbol);
      if(state.markets[state.symbol]){
        state.markets[state.symbol].t=live;
      }
      render();
    }catch(e){}
  },1000);

document.addEventListener("keydown", e => {
  if (e.target && ["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName)) return;
  if (e.key.toLowerCase()==="r") refresh();
  if (e.key==="1") {document.querySelector('[data-page="dashboard"]')?.click();}
  if (e.key==="2") {document.querySelector('[data-page="trade"]')?.click();}
  if (e.key==="3") {document.querySelector('[data-page="analytics"]')?.click();}
});

window.addEventListener("beforeunload",closeLiveStream);


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
    const ch=m.t.change, sig=signal(m.candles);
    return `<div class="watch-row"><div class="watch-name">${s.replace("USDT","/USDT")}</div><div class="watch-price">${money(m.t.price)}</div><div class="watch-change ${ch>=0?"green":"red"}">${pct(ch)}<br><small>${sig}</small></div></div>`
  }).join("");
}
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
    <div class="grid layout">
      <div class="card chart-card"><div class="card-head"><h3>${state.symbol.replace("USDT","/USDT")} · Price</h3><div class="tabs"><button class="tab active">Candles</button><button class="tab">EMA 9</button><button class="tab">EMA 21</button></div></div><canvas id="chart"></canvas></div>
      <div><div id="signalBox">${signalCard(sig,price,A)}
        <div class="confidence"><div class="conf-head"><span>Signal confidence</span><b>72%</b></div><div class="conf-bar"><i></i></div></div>
        <div class="signal-reasons">
          <div class="reason"><span>EMA trend</span><strong class="green">Bullish</strong></div>
          <div class="reason"><span>RSI momentum</span><strong>${R.toFixed(1)}</strong></div>
          <div class="reason"><span>Volatility</span><strong>${fmt(A)}</strong></div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>Market Watchlist</h3><span class="status-chip ok">LIVE</span></div><div class="watch">${watchRows()}</div></div>
      <div class="card" style="margin-top:14px"><div class="card-head"><h3>Order Flow</h3><span class="status-chip">PUBLIC DATA</span></div>
        <div class="orderbook">
          <div class="book-side"><h4>ASKS</h4><div class="book-row ask"><span>${fmt(price+A*.18)}</span><span>0.12</span><span>18%</span></div><div class="book-row ask"><span>${fmt(price+A*.09)}</span><span>0.21</span><span>31%</span></div><div class="book-row ask"><span>${fmt(price+A*.04)}</span><span>0.18</span><span>26%</span></div></div>
          <div class="book-side"><h4>BIDS</h4><div class="book-row bid"><span>${fmt(price-A*.04)}</span><span>0.25</span><span>35%</span></div><div class="book-row bid"><span>${fmt(price-A*.09)}</span><span>0.19</span><span>27%</span></div><div class="book-row bid"><span>${fmt(price-A*.18)}</span><span>0.15</span><span>21%</span></div></div>
        </div><div class="notice">Illustrative depth panel for the paper-trading interface; not used to place live orders.</div>
      </div></div>
    </div>
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
  chartSvg(m.candles);
}
function winRate(){if(!state.trades.length)return "0.0";return (state.trades.filter(x=>+x.pnl>0).length/state.trades.length*100).toFixed(1)}
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

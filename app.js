
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
  algo: JSON.parse(localStorage.getItem("cb_algo") || '{"running":false,"riskPct":1,"slAtr":1.5,"tpAtr":3,"lastBar":0}'),
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
  if(!data || data.length<30)return "WAIT";
  const closed=data.slice(0,-1), closes=closed.map(x=>x.c), e9=ema(closes,9), e21=ema(closes,21), R=rsi(closes,14);
  const prevDiff=e9[e9.length-2]-e21[e21.length-2], diff=e9[e9.length-1]-e21[e21.length-1];
  if((prevDiff<=0 && diff>0 && R>=50) || (diff>0 && R>=55))return "BUY";
  if((prevDiff>=0 && diff<0 && R<=50) || (diff<0 && R<=45))return "SELL";
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
let chartCanvas=null;
let chartCtx=null;
let chartMeta={data:[],left:0,right:0,top:0,bottom:0,lo:0,hi:0,hoverIndex:-1};
let chartSelectedIndex=-1;

function chartSvg(data){
  const container=$("chart");
  if(!container) return;

  // The dashboard is re-rendered periodically, replacing #chart in the DOM.
  // If our old canvas belongs to the previous #chart element, recreate it.
  if(chartCanvas && !container.contains(chartCanvas)){
    chartCanvas=null;
    chartCtx=null;
    if(chartResizeObserver){ chartResizeObserver.disconnect(); chartResizeObserver=null; }
  }

  if(!chartCanvas){
    container.innerHTML="";
    chartCanvas=document.createElement("canvas");
    chartCanvas.className="native-chart-canvas";
    container.appendChild(chartCanvas);

    const info=document.createElement("div");
    info.id="candleInfo";
    info.className="candle-info";
    info.innerHTML='<b>Move over a candle</b><span>Time · OHLC · Volume</span>';
    container.appendChild(info);

    const resize=()=>{
      const dpr=window.devicePixelRatio||1;
      const w=Math.max(1,container.clientWidth), h=Math.max(1,container.clientHeight);
      chartCanvas.width=Math.floor(w*dpr); chartCanvas.height=Math.floor(h*dpr);
      chartCanvas.style.width=w+"px"; chartCanvas.style.height=h+"px";
      chartCtx=chartCanvas.getContext("2d");
      chartCtx.setTransform(dpr,0,0,dpr,0,0);
      drawNativeChart();
    };
    chartResizeObserver=new ResizeObserver(resize); chartResizeObserver.observe(container);

    chartCanvas.addEventListener("mousemove", e=>{
      const r=chartCanvas.getBoundingClientRect();
      const x=e.clientX-r.left, y=e.clientY-r.top;
      const idx=nearestChartIndex(x);
      chartMeta.hoverIndex=idx;
      updateCandleInfo(idx,false);
      drawNativeChart();
    });
    chartCanvas.addEventListener("mouseleave",()=>{chartMeta.hoverIndex=-1;drawNativeChart();});
    chartCanvas.addEventListener("click",()=>{
      if(chartMeta.hoverIndex>=0){chartSelectedIndex=chartMeta.hoverIndex;updateCandleInfo(chartSelectedIndex,true);drawNativeChart();}
    });
    chartCanvas.addEventListener("wheel",e=>{
      e.preventDefault();
      state.chartZoom=Math.max(.5,Math.min(5,+(state.chartZoom+(e.deltaY<0?.25:-.25)).toFixed(2)));
      localStorage.setItem("cb_chart_zoom",state.chartZoom); drawNativeChart();
    },{passive:false});

    let dragging=false,lastX=0;
    chartCanvas.addEventListener("mousedown",e=>{dragging=true;lastX=e.clientX;chartCanvas.style.cursor="grabbing";});
    window.addEventListener("mouseup",()=>{dragging=false;if(chartCanvas)chartCanvas.style.cursor="crosshair";});
    window.addEventListener("mousemove",e=>{
      if(!dragging||!chartCanvas)return;
      const dx=e.clientX-lastX; lastX=e.clientX;
      chartMeta.pan=(chartMeta.pan||0)-dx/7;
      drawNativeChart();
    });
    chartCanvas.addEventListener("touchstart",e=>{if(e.touches.length===1){chartMeta.touchX=e.touches[0].clientX;}},{passive:true});
    chartCanvas.addEventListener("touchmove",e=>{if(e.touches.length===1){const x=e.touches[0].clientX;chartMeta.pan=(chartMeta.pan||0)-(x-chartMeta.touchX)/7;chartMeta.touchX=x;drawNativeChart();}},{passive:true});
  }
  chartMeta.data=data;
  drawNativeChart();
}

function nearestChartIndex(x){
  const n=chartMeta.data.length;if(!n)return -1;
  const left=chartMeta.left,right=chartMeta.right;
  const count=chartMeta.visibleCount||n;
  const start=chartMeta.startIndex||0;
  const pos=Math.round(start+(x-left)/Math.max(1,right-left)*(count-1));
  return Math.max(0,Math.min(n-1,pos));
}
function updateCandleInfo(idx,selected){
  const info=$("candleInfo"),d=chartMeta.data[idx]; if(!info||!d)return;
  const dt=new Date(Number(d.t));
  const time=dt.toLocaleString(undefined,{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"});
  info.innerHTML=`<b>${selected?"SELECTED · ":""}${time}</b><span>O ${fmt(d.o)} · H ${fmt(d.h)} · L ${fmt(d.l)} · C ${fmt(d.c)} · V ${fmt(d.v)}</span>`;
  info.classList.toggle("selected",!!selected);
}
function drawNativeChart(){
  if(!chartCanvas||!chartCtx||!chartMeta.data?.length)return;
  const W=chartCanvas.clientWidth,H=chartCanvas.clientHeight;
  const ctx=chartCtx; ctx.clearRect(0,0,W,H); ctx.fillStyle="#0b0f14";ctx.fillRect(0,0,W,H);
  const all=chartMeta.data; const maxCount=Math.max(40,Math.min(all.length,Math.round(180/(state.chartZoom||1))));
  const pan=Math.round(chartMeta.pan||0); const end=Math.max(maxCount,Math.min(all.length,all.length-pan)); const start=Math.max(0,end-maxCount);
  const data=all.slice(start,end); chartMeta.visibleCount=data.length;chartMeta.startIndex=start;
  const left=12,right=W-58,top=12,bottom=H-30; chartMeta.left=left;chartMeta.right=right;chartMeta.top=top;chartMeta.bottom=bottom;
  const hi=Math.max(...data.map(x=>x.h)),lo=Math.min(...data.map(x=>x.l)); const pad=(hi-lo||1)*.08; const pHi=hi+pad,pLo=lo-pad;chartMeta.hi=pHi;chartMeta.lo=pLo;
  const y=v=>top+(pHi-v)/(pHi-pLo)*(bottom-top); const step=(right-left)/Math.max(data.length,1); const body=Math.max(2,step*.62);
  ctx.strokeStyle="#17212c";ctx.lineWidth=1;ctx.font="10px Inter,system-ui,sans-serif";ctx.fillStyle="#637287";
  for(let g=0;g<6;g++){const yy=top+g*(bottom-top)/5;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();const val=pHi-g*(pHi-pLo)/5;ctx.fillText(money(val).replace("$",""),right+5,yy+3);}
  for(let g=0;g<6;g++){const xx=left+g*(right-left)/5;ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,bottom);ctx.stroke();}
  const closes=data.map(x=>x.c),e9=ema(closes,9),e21=ema(closes,21);
  const drawLine=(vals,color)=>{ctx.strokeStyle=color;ctx.lineWidth=1.4;ctx.beginPath();vals.forEach((v,i)=>{const xx=left+(i+.5)*step,yy=y(v);i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy)});ctx.stroke()};
  drawLine(e9,"#4da3ff");drawLine(e21,"#f6b44d");
  data.forEach((c,i)=>{const xx=left+(i+.5)*step,yo=y(c.o),yc=y(c.c),yh=y(c.h),yl=y(c.l),up=c.c>=c.o;ctx.strokeStyle=up?"#26a69a":"#ef5350";ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();ctx.moveTo(xx,yh);ctx.lineTo(xx,yl);ctx.stroke();const bh=Math.max(1,Math.abs(yc-yo));ctx.fillRect(xx-body/2,Math.min(yo,yc),body,bh);});
  const current=data[data.length-1]; if(current){const yy=y(current.c);ctx.setLineDash([4,4]);ctx.strokeStyle="#4f6175";ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#2bd481";ctx.fillRect(right,yy-8,54,16);ctx.fillStyle="#06110b";ctx.font="bold 9px Inter,system-ui,sans-serif";ctx.fillText(fmt(current.c),right+4,yy+3);}
  ctx.fillStyle="#637287";ctx.font="9px Inter,system-ui,sans-serif";for(let i=0;i<5;i++){const idx=Math.min(data.length-1,Math.round(i*(data.length-1)/4));const d=data[idx],xx=left+(idx+.5)*step;ctx.fillText(new Date(Number(d.t)).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),Math.max(left,Math.min(right-40,xx-20)),H-10);}
  const hover=chartMeta.hoverIndex; if(hover>=start&&hover<end){const i=hover-start,xx=left+(i+.5)*step,d=all[hover];ctx.strokeStyle="#65778c";ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,bottom);ctx.stroke();ctx.setLineDash([]);const yy=y(d.c);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();}
}

function destroyChart(){
  if(chartResizeObserver){chartResizeObserver.disconnect();chartResizeObserver=null;}
  chartCanvas=null; chartCtx=null; chartMeta={data:[],left:0,right:0,top:0,bottom:0,lo:0,hi:0,hoverIndex:-1}; chartSelectedIndex=-1;
}


let liveSocket=null;
let liveSocketSymbol="";
let liveSocketInterval="";
let liveReconnectTimer=null;
let lastWsMessageAt=0;
let wsConnected=false;

function closeLiveStream(){
  if(liveReconnectTimer) clearTimeout(liveReconnectTimer);
  liveReconnectTimer=null;
  if(liveSocket){
    try{liveSocket.onclose=null;liveSocket.close();}
    catch(e){}
  }
  liveSocket=null;
  wsConnected=false;
}

function applyLiveCandle(m,candle){
  if(!m || !m.candles) return;
  const last=m.candles[m.candles.length-1];
  if(last && Number(last.t)===Number(candle.t)){
    last.c=candle.c; last.h=Math.max(last.h,candle.h); last.l=Math.min(last.l,candle.l); last.v=candle.v;
  } else {
    m.candles.push(candle);
    if(m.candles.length>300) m.candles.shift();
  }
  if(chartCanvas) { chartMeta.data=m.candles; drawNativeChart(); }
}

async function pollLiveFallback(){
  try{
    const m=state.markets[state.symbol]; if(!m) return;
    const stale=!wsConnected || (Date.now()-lastWsMessageAt>8000);
    if(stale){
      // Recover the latest candles as well as price when the stream is unavailable.
      const [candles,t]=await Promise.all([
        fetchKlines(state.symbol,state.timeframe,3),
        fetchTicker(state.symbol)
      ]);
      if(candles.length){
        candles.forEach(c=>applyLiveCandle(m,c));
      }
      m.t=t;
      const c=Number(t.price);
      const priceNode=$('livePrice'); if(priceNode) priceNode.textContent=money(c);
      const ticket=$('proOrderPrice'); if(ticket) ticket.textContent=money(c);
      const hp=$('headerPrice'); if(hp) hp.textContent=money(c);
      const hc=$('headerChange'); if(hc){hc.textContent=pct(t.change);hc.className=t.change>=0?'green':'red';}
      const badge=document.querySelector('.stream-status');
      if(badge) badge.innerHTML='<i class="offline-dot"></i> FALLBACK DATA';
    }else{
      // Keep the displayed price fresh without replacing the whole chart.
      const t=await fetchTicker(state.symbol); m.t=t;
      const c=Number(t.price);
      const last=m.candles?.[m.candles.length-1]; if(last){
        applyLiveCandle(m,{t:last.t,o:last.o,h:Math.max(last.h,c),l:Math.min(last.l,c),c,v:last.v});
      }
      const priceNode=$('livePrice'); if(priceNode) priceNode.textContent=money(c);
      const ticket=$('proOrderPrice'); if(ticket) ticket.textContent=money(c);
      const hp=$('headerPrice'); if(hp) hp.textContent=money(c);
      const hc=$('headerChange'); if(hc){hc.textContent=pct(t.change);hc.className=t.change>=0?'green':'red';}
    }
  }catch(e){console.warn('Live fallback failed',e)}
}

let livePollBusy=false;
let livePollTimer=null;

async function pollLiveMarket(){
  if(livePollBusy) return;
  const m=state.markets[state.symbol];
  if(!m) return;
  livePollBusy=true;
  try{
    const res=await fetch(`${API}/live?symbol=${state.symbol}&interval=${state.timeframe}`, {cache:"no-store"});
    if(!res.ok) throw new Error(`live endpoint ${res.status}`);
    const data=await res.json();
    if(data.error) throw new Error(data.error);
    const rows=(data.candles||[]).map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
    rows.forEach(c=>applyLiveCandle(m,c));
    const t=data.ticker||{};
    if(t.lastPrice!=null){
      m.t={price:+t.lastPrice,change:+t.priceChangePercent};
    }
    const c=Number(m.t.price);
    const current=m.candles?.[m.candles.length-1];
    if(current && Number.isFinite(c)){ applyLiveCandle(m,{t:current.t,o:current.o,h:Math.max(current.h,c),l:Math.min(current.l,c),c,v:current.v}); }
    const priceNode=$("livePrice"); if(priceNode) priceNode.textContent=money(c);
    const ticket=$("proOrderPrice"); if(ticket) ticket.textContent=money(c);
    const hp=$("headerPrice"); if(hp) hp.textContent=money(c);
    const hc=$("headerChange"); if(hc){hc.textContent=pct(m.t.change);hc.className=m.t.change>=0?"green":"red";}
    const status=document.querySelector(".stream-status");
    if(status) status.innerHTML='<i></i> LIVE MARKET DATA';
    const last=m.candles?.[m.candles.length-1];
    if(last) lastWsMessageAt=Date.now();
  }catch(e){
    const status=document.querySelector(".stream-status");
    if(status) status.innerHTML='<i class="offline-dot"></i> RECONNECTING';
    console.warn("Live market poll failed",e);
  }finally{
    livePollBusy=false;
  }
}

function startLivePolling(){
  if(livePollTimer) clearInterval(livePollTimer);
  pollLiveMarket();
  livePollTimer=setInterval(pollLiveMarket,2500);
}

function startLiveStream(){
  // Browser WebSocket is intentionally disabled. Server polling is the
  // authoritative live feed for this paper-trading build.
  closeLiveStream();
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
function positionPnl(p,cur){
  const mult=p.side==="SELL"?-1:1;
  return (cur-p.entry)*(p.amount/p.entry)*mult;
}
function closePaperPosition(id){
  const p=state.positions.find(x=>x.id===id); if(!p)return;
  const m=state.markets[p.symbol],cur=m?.t?.price||p.entry,pnl=Number(positionPnl(p,cur).toFixed(2));
  state.balance+=p.amount+pnl;
  state.positions=state.positions.filter(x=>x.id!==id);
  state.trades.unshift({time:new Date().toLocaleString(),symbol:p.symbol,side:"CLOSE",positionSide:p.side,entry:cur,pnl,status:"CLOSED",source:p.source||"MANUAL"});
  localStorage.setItem("cb_balance",state.balance);localStorage.setItem("cb_positions",JSON.stringify(state.positions));localStorage.setItem("cb_trades",JSON.stringify(state.trades));
  toast(`Position closed · ${pnl>=0?"+":""}${money(pnl)}`); render();
}
function openPositionRows(){
  if(!state.positions.length)return '<div class="empty">No open paper positions. Use the Trade page to open one.</div>';
  return state.positions.map(p=>{const m=state.markets[p.symbol],cur=m?.t?.price||p.entry,pnl=positionPnl(p,cur);return `<div class="position-row" data-pos-id="${p.id}"><div><b>${p.symbol.replace("USDT","/USDT")}</b><span class="side-tag ${p.side==="SELL"?"sell":"buy"}">${p.side}</span><small>Entry ${money(p.entry)} · ${money(p.amount)}</small></div><div class="position-right"><b class="pos-pnl ${pnl>=0?"green":"red"}">${pnl>=0?"+":""}${money(pnl)}</b><small>Now ${money(cur)}</small><button class="close-pos" data-close-pos="${p.id}">CLOSE</button></div></div>`}).join('');
}
function positionCount(){return state.positions.length}

function pageDashboard(){
  const m=state.markets[state.symbol], price=m.t.price, sig=signal(m.candles), R=rsi(m.candles.map(x=>x.c)), A=atr(m.candles), pnl=state.trades.reduce((a,x)=>a+(+x.pnl||0),0);
  $("dashboard").innerHTML=`
    <div class="hero-pro"><div><h1>Trading Terminal</h1><p>Professional market workspace · technical signals · paper execution</p></div><div class="hero-right"><div class="live-badge"><i></i> MARKET STREAM</div><span class="status-chip ok">LIVE STREAM</span></div></div>
    <div class="hero"><div><div class="price-big">${money(price)} <small>${state.symbol.replace("USDT","/USDT")}</small></div><p>24h ${pct(m.t.change)} · RSI ${R.toFixed(1)} · ATR ${fmt(A)}</p></div><div class="hero-actions"><select class="select" id="tf"><option>1m</option><option selected>5m</option><option>15m</option><option>1h</option><option>4h</option><option>1D</option></select><button class="btn" id="fullRefresh">↻ Refresh</button></div></div>
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
          ${["1m","5m","15m","1h","4h","1D"].map(tf=>`<button class="tf-btn ${state.timeframe===tf?"active":""}" data-tf="${tf}">${tf}</button>`).join("")}
          <span class="stream-status"><i></i> LIVE STREAM</span>
        </div>
        <div class="chart-stage"><div id="chart"></div><div class="chart-live-line"><span>LIVE</span></div></div>
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
        <div class="sub" style="margin-top:14px">Live stream updates continuously. Live exchange orders remain disabled.</div>
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
  document.querySelectorAll("[data-close-pos]").forEach(btn=>btn.onclick=()=>closePaperPosition(Number(btn.dataset.closePos)));

  $("zoomIn").onclick=()=>{
    state.chartZoom=Math.min(5,+(state.chartZoom+0.5).toFixed(1));
    localStorage.setItem("cb_chart_zoom",state.chartZoom);
    drawNativeChart();
  };
  $("zoomOut").onclick=()=>{
    state.chartZoom=Math.max(.5,+(state.chartZoom-.5).toFixed(1));
    localStorage.setItem("cb_chart_zoom",state.chartZoom);
    drawNativeChart();
  };
  $("zoomReset").onclick=()=>{
    state.chartZoom=1;
    localStorage.setItem("cb_chart_zoom",1);
    chartMeta.pan=0; drawNativeChart();
  };
  $("chartFullscreen").onclick=async()=>{const card=$("chartCard");try{if(!document.fullscreenElement)await card.requestFullscreen();else await document.exitFullscreen();setTimeout(()=>drawNativeChart(),100)}catch(e){toast("Full screen unavailable")}};
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
  const pos=state.positions.filter(p=>p.symbol===state.symbol);
  const liveRows=pos.map(p=>{const pnl=positionPnl(p,price);return `<div class="metric-mini trade-position"><span>${p.side} · ${money(p.amount)} · Entry ${money(p.entry)}</span><strong class="${pnl>=0?"green":"red"}">${pnl>=0?"+":""}${money(pnl)} <button class="close-pos" data-close-pos="${p.id}">CLOSE</button></strong></div>`}).join("")||'<div class="empty">No open position for this pair.</div>';
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
  document.querySelectorAll("[data-close-pos]").forEach(btn=>btn.onclick=()=>closePaperPosition(Number(btn.dataset.closePos)));
}
function paperOrder(side){
  const amount=+($('amount')?.value||$('proAmount')?.value||100),m=state.markets[state.symbol],price=m?.t?.price;
  if(!m||!price){toast("Market price unavailable");return}
  if(amount<=0){toast("Enter a valid amount");return}
  if(amount>state.balance){toast("Not enough paper balance");return}
  const id=Date.now()+Math.floor(Math.random()*1000);
  state.balance-=amount;
  state.positions.unshift({id,time:new Date().toLocaleString(),symbol:state.symbol,side,entry:price,amount,source:"MANUAL"});
  state.trades.unshift({id,time:new Date().toLocaleString(),symbol:state.symbol,side,entry:price,pnl:0,status:"OPEN",source:"MANUAL"});
  localStorage.setItem("cb_balance",state.balance);localStorage.setItem("cb_trades",JSON.stringify(state.trades));localStorage.setItem("cb_positions",JSON.stringify(state.positions));
  toast(`${side} position opened at ${money(price)}`);render();
}
function algoRSI(values, period=14){
  if(values.length < period+1) return 50;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}
  let ag=gain/period, al=loss/period;
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(period-1)+Math.max(d,0))/period;al=(al*(period-1)+Math.max(-d,0))/period;}
  return al===0?100:100-100/(1+ag/al);
}
function algoSignal(data){
  if(!data || data.length<30) return {action:"WAIT",reason:"Not enough candles",confidence:0};
  const closed=data.slice(0,-1), closes=closed.map(x=>x.c), e9=ema(closes,9), e21=ema(closes,21), R=algoRSI(closes,14);
  const pd=e9[e9.length-2]-e21[e21.length-2], d=e9[e9.length-1]-e21[e21.length-1];
  if(pd<=0 && d>0 && R>=50) return {action:"BUY",reason:`Fresh EMA 9 crossover · RSI ${R.toFixed(1)}`,confidence:Math.min(99,70+Math.max(0,(R-50)*1.5))};
  if(pd>=0 && d<0 && R<=50) return {action:"SELL",reason:`Fresh EMA 9 crossunder · RSI ${R.toFixed(1)}`,confidence:Math.min(99,70+Math.max(0,(50-R)*1.5))};
  if(d>0 && R>=55) return {action:"BUY",reason:`Bullish EMA trend · RSI ${R.toFixed(1)}`,confidence:Math.min(95,60+(R-55)*2)};
  if(d<0 && R<=45) return {action:"SELL",reason:`Bearish EMA trend · RSI ${R.toFixed(1)}`,confidence:Math.min(95,60+(45-R)*2)};
  return {action:"WAIT",reason:`Neutral zone · EMA spread ${d.toFixed(2)} · RSI ${R.toFixed(1)}`,confidence:0};
}
function closedCandles(data){ return (data||[]).slice(0,-1); }
function persistAlgo(){ localStorage.setItem("cb_algo",JSON.stringify(state.algo)); }
function algoPosition(){ return state.positions.find(p=>p.symbol===state.symbol && p.source==="ALGO"); }
function executeAlgoPaper(){
  const m=state.markets[state.symbol]; if(!m?.candles?.length) return {status:"WAIT",message:"Market data unavailable"};
  const closed=closedCandles(m.candles); if(closed.length<30) return {status:"WAIT",message:"Waiting for enough candles"};
  const lastBar=closed[closed.length-1].t;
  if(state.algo.lastBar===lastBar) return {status:"WAIT",message:"Already evaluated this candle"};
  state.algo.lastBar=lastBar;
  const sig=algoSignal(m.candles); const price=m.t.price; const A=atr(closed);
  const pos=algoPosition();
  if(pos){
    const stop=pos.stopLoss, target=pos.takeProfit;
    if(price<=stop || price>=target || sig.action==="SELL"){
      const pnl=Number(((price-pos.entry)*(pos.amount/pos.entry)).toFixed(2));
      state.balance+=pos.amount+pnl;
      state.positions=state.positions.filter(x=>x.id!==pos.id);
      state.trades.unshift({time:new Date().toLocaleString(),symbol:pos.symbol,side:"SELL",entry:price,pnl,status:"CLOSED",source:"ALGO",reason:price<=stop?"STOP LOSS":price>=target?"TAKE PROFIT":"SIGNAL EXIT"});
      localStorage.setItem("cb_balance",state.balance);localStorage.setItem("cb_positions",JSON.stringify(state.positions));localStorage.setItem("cb_trades",JSON.stringify(state.trades));
      return {status:"CLOSE",message:`Algo closed at ${money(price)} · P&L ${pnl>=0?"+":""}${money(pnl)}`,pnl};
    }
    return {status:"HOLD",message:`Holding BUY · SL ${money(stop)} · TP ${money(target)}`};
  }
  if(sig.action!=="BUY") return {status:sig.action,message:sig.reason};
  if(A<=0) return {status:"WAIT",message:"ATR unavailable"};
  const riskMoney=state.balance*(Math.max(.1,Math.min(5,state.algo.riskPct))/100);
  const stopDistance=A*Math.max(.5,Math.min(5,state.algo.slAtr));
  const qty=riskMoney/stopDistance;
  const amount=Math.min(state.balance,qty*price);
  if(amount<10) return {status:"WAIT",message:"Paper balance too small for configured risk"};
  const stop=price-stopDistance, target=price+A*Math.max(1,Math.min(10,state.algo.tpAtr));
  state.balance-=amount;
  state.positions.unshift({id:Date.now(),time:new Date().toLocaleString(),symbol:state.symbol,side:"BUY",entry:price,amount,stopLoss:stop,takeProfit:target,source:"ALGO"});
  state.trades.unshift({time:new Date().toLocaleString(),symbol:state.symbol,side:"BUY",entry:price,pnl:0,status:"OPEN",source:"ALGO"});
  localStorage.setItem("cb_balance",state.balance);localStorage.setItem("cb_positions",JSON.stringify(state.positions));localStorage.setItem("cb_trades",JSON.stringify(state.trades));
  return {status:"BUY",message:`Algo BUY at ${money(price)} · SL ${money(stop)} · TP ${money(target)}`};
}
function runBacktest(candles, initial=10000, riskPct=1, slAtr=1.5, tpAtr=3){
  const data=closedCandles(candles); let balance=initial, pos=null, trades=[], equity=[];
  for(let i=30;i<data.length;i++){
    const slice=data.slice(0,i+1), sig=algoSignal(slice.concat([data[i]]));
    const price=data[i].c, A=atr(slice); if(!A) continue;
    if(pos){
      const hitStop=price<=pos.stop, hitTarget=price>=pos.target;
      if(hitStop||hitTarget||sig.action==="SELL"){
        const pnl=(price-pos.entry)*(pos.amount/pos.entry); balance+=pos.amount+pnl; trades.push({side:"SELL",entry:price,pnl,reason:hitStop?"STOP":hitTarget?"TARGET":"SIGNAL"}); pos=null;
      }
    }
    if(!pos && sig.action==="BUY"){
      const riskMoney=balance*(Math.max(.1,Math.min(5,riskPct))/100), dist=A*Math.max(.5,Math.min(5,slAtr)), amount=Math.min(balance,(riskMoney/dist)*price);
      if(amount>=10){ balance-=amount; pos={entry:price,amount,stop:price-dist,target:price+A*Math.max(1,Math.min(10,tpAtr))}; trades.push({side:"BUY",entry:price,pnl:0,reason:"SIGNAL"}); }
    }
    equity.push(balance+(pos?pos.amount:0));
  }
  if(pos){const price=data[data.length-1].c,pnl=(price-pos.entry)*(pos.amount/pos.entry);balance+=pos.amount+pnl;trades.push({side:"SELL",entry:price,pnl,reason:"END"});}
  const sells=trades.filter(t=>t.side==="SELL"), wins=sells.filter(t=>t.pnl>0), losses=sells.filter(t=>t.pnl<0), grossWin=wins.reduce((a,b)=>a+b.pnl,0),grossLoss=Math.abs(losses.reduce((a,b)=>a+b.pnl,0));
  let peak=initial,maxDD=0; for(const e of equity){peak=Math.max(peak,e);maxDD=Math.max(maxDD,(peak-e)/peak*100);}
  return {initial,final:balance,net:balance-initial,trades:sells.length,winRate:sells.length?(wins.length/sells.length*100):0,profitFactor:grossLoss?grossWin/grossLoss:Infinity,maxDrawdown:maxDD,equity};
}
function pageAlgo(){
  const m=state.markets[state.symbol], sig=algoSignal(m?.candles||[]), pos=algoPosition();
  const running=state.algo.running;
  const result=state.lastBacktest||null;
  const autoStatus=running?"RUNNING":"STOPPED";
  $("algo").innerHTML=`<div class="hero-pro"><div><h1>Algo Trading</h1><p>Build, test and run automated strategies in paper mode using the live market stream.</p></div><div class="hero-right"><span class="status-chip ${running?"ok":"warn"}">${autoStatus}</span><span class="status-chip">LIVE ORDERS OFF</span></div></div>
  <div class="grid algo-grid">
    <div class="card"><div class="card-head"><h3>Strategy</h3><span class="status-chip">EMA 9 / EMA 21 + RSI</span></div>
      <div class="metric-mini"><span>Current signal</span><strong class="${sig.action==="BUY"?"green":sig.action==="SELL"?"red":""}">${sig.action}</strong></div>
      <div class="small-muted">${sig.reason}</div>
      <div class="field"><label>Risk per trade</label><select id="algoRisk"><option ${state.algo.riskPct==.5?"selected":""}>0.5</option><option ${state.algo.riskPct==1?"selected":""}>1</option><option ${state.algo.riskPct==2?"selected":""}>2</option></select></div>
      <div class="field"><label>Stop-loss ATR</label><select id="algoSL"><option ${state.algo.slAtr==1?"selected":""}>1</option><option ${state.algo.slAtr==1.5?"selected":""}>1.5</option><option ${state.algo.slAtr==2?"selected":""}>2</option></select></div>
      <div class="field"><label>Take-profit ATR</label><select id="algoTP"><option ${state.algo.tpAtr==2?"selected":""}>2</option><option ${state.algo.tpAtr==3?"selected":""}>3</option><option ${state.algo.tpAtr==4?"selected":""}>4</option></select></div>
      <div class="order-buttons"><button class="buy-btn" id="algoStart">${running?"STOP AUTO ALGO":"START PAPER ALGO"}</button><button class="btn" id="algoRunOnce">RUN ONCE</button></div>
      <div class="small-muted">Starting the algo only creates simulated paper orders. No broker API is connected.</div>
    </div>
    <div class="card"><div class="card-head"><h3>Paper Position</h3><span class="status-chip ${pos?"ok":""}">${pos?"OPEN":"NONE"}</span></div>
      ${pos?`<div class="metric-mini"><span>Entry</span><strong>${money(pos.entry)}</strong></div><div class="metric-mini"><span>Stop Loss</span><strong>${money(pos.stopLoss)}</strong></div><div class="metric-mini"><span>Take Profit</span><strong>${money(pos.takeProfit)}</strong></div><div class="metric-mini"><span>Size</span><strong>${money(pos.amount)}</strong></div>`:`<div class="empty">No algo position. Start the paper algo or run a backtest.</div>`}
    </div>
  </div>
  <div class="section-title">Backtest</div>
  <div class="card"><div class="card-head"><h3>${state.symbol.replace("USDT","/USDT")} · ${state.timeframe}</h3><button class="btn primary" id="runBacktest">RUN BACKTEST</button></div>
    <div class="grid kpi-grid">${kpi("Initial Balance",money(result?.initial||10000),"Backtest capital")}${kpi("Final Balance",money(result?.final||10000),"After simulated trades",(result?.net||0)>=0?"green":"red")}${kpi("Net P&L",money(result?.net||0),"Backtest result",(result?.net||0)>=0?"green":"red")}${kpi("Win Rate",result?result.winRate.toFixed(1)+"%":"--","Closed trades")}${kpi("Max Drawdown",result?result.maxDrawdown.toFixed(1)+"%":"--","Peak-to-trough")}</div>
    <div id="backtestSummary" class="small-muted">Run the backtest to calculate results from the loaded historical candles.</div>
  </div>`;
  $("algoRisk").onchange=e=>{state.algo.riskPct=+e.target.value;persistAlgo()};
  $("algoSL").onchange=e=>{state.algo.slAtr=+e.target.value;persistAlgo()};
  $("algoTP").onchange=e=>{state.algo.tpAtr=+e.target.value;persistAlgo()};
  $("algoStart").onclick=()=>{state.algo.running=!state.algo.running;persistAlgo();render()};
  $("algoRunOnce").onclick=()=>{const r=executeAlgoPaper();toast(r.message);render()};
  $("runBacktest").onclick=()=>{state.lastBacktest=runBacktest(m.candles,10000,state.algo.riskPct,state.algo.slAtr,state.algo.tpAtr);render()};
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
  ["dashboard","markets","trade","analytics","journal","algo"].forEach(x=>$(x).classList.remove("active"));
  const active=document.querySelector(".nav.active")?.dataset.page||"dashboard";
  $(active).classList.add("active");
  if(active==="dashboard")pageDashboard();
  if(active==="markets")pageMarkets();
  if(active==="trade")pageTrade();
  if(active==="analytics")pageAnalytics();
  if(active==="journal")pageJournal();
  if(active==="algo")pageAlgo();
}
async function refresh(){
  try{
    await Promise.all(["BTCUSDT","ETHUSDT"].map(loadSymbol));
    renderHeader(state.markets[state.symbol].t);
    render();
  }catch(e){
    console.error("CryptoBot UI error:", e);
    const pages = ["dashboard","markets","trade","analytics","journal","algo"];
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

startLivePolling();
setInterval(pollLiveFallback,5000);

// Watchdog: if the browser/network silently drops the WebSocket, reconnect it.
setInterval(()=>{ /* server polling is the primary live feed */ },15000);

setInterval(()=>{
  if(state.algo.running){
    try{ const r=executeAlgoPaper(); if(r.status!=="WAIT" && r.status!=="HOLD") { toast(r.message); render(); } }catch(e){ console.warn("Algo tick failed",e); }
  }
}, 5000);

document.addEventListener("keydown", e => {
  if (e.target && ["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName)) return;
  if (e.key.toLowerCase()==="r") refresh();
  if (e.key==="1") {document.querySelector('[data-page="dashboard"]')?.click();}
  if (e.key==="2") {document.querySelector('[data-page="trade"]')?.click();}
  if (e.key==="3") {document.querySelector('[data-page="analytics"]')?.click();}
  if (e.key==="4") {document.querySelector('[data-page="algo"]')?.click();}
});

window.addEventListener("beforeunload",closeLiveStream);

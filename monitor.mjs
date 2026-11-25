// MACD closed-candle alert with persistent cursor and delayed-run backfill.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const SYMBOL=(process.env.SYMBOL||'BTCUSDT').toUpperCase();
const MARKET=process.env.MARKET||'spot';
const RR=Number(process.env.RR||5);
const TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID=process.env.TELEGRAM_CHAT_ID;
const DRY_RUN=process.env.DRY_RUN==='1';
const TEST_TELEGRAM=process.env.TEST_TELEGRAM==='1';
const ZERO_CROSS=process.env.ALERT_MODE==='dif-zero';
const SWING_ZONE=process.env.ALERT_MODE==='swing-zone';
const THREE_MINUTE=ZERO_CROSS||SWING_ZONE;
const INTERVAL=THREE_MINUTE?'3m':'5m';
const INTERVAL_MS=THREE_MINUTE?180000:300000;
const ZERO_TOLERANCE=0.00005;
const BASE=MARKET==='futures'?'https://fapi.binance.com/fapi/v1/klines':'https://data-api.binance.vision/api/v3/klines';
const WINDOW=1000;
const ASSET=SYMBOL.endsWith('USDT')?SYMBOL.slice(0,-4):SYMBOL;
const STATE_KEY=SWING_ZONE?`${SYMBOL}:${MARKET}:3m:swing-zone`:ZERO_CROSS?`${SYMBOL}:${MARKET}:3m:dif-zero`:`${SYMBOL}:${MARKET}`;
const STATE_FILE=SWING_ZONE?`state/${SYMBOL}-${MARKET}-3m-swing-zone.json`
  :ZERO_CROSS?`state/${SYMBOL}-${MARKET}-3m-dif-zero.json`
  :SYMBOL==='BTCUSDT'&&MARKET==='spot'
  ?'state/monitor-state.json'
  :`state/${SYMBOL}-${MARKET}.json`;
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:4});
const tw=ms=>new Date(ms).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
function ema(values,n){let prev=values[0],a=2/(n+1);return values.map((v,i)=>prev=i?a*v+(1-a)*prev:v);}
export function enrich(candles){const a=ema(candles.map(x=>x.close),12),b=ema(candles.map(x=>x.close),26);const dif=a.map((x,i)=>x-b[i]),dea=ema(dif,9);return candles.map((c,i)=>({...c,dif:dif[i],dea:dea[i],hist:2*(dif[i]-dea[i])}));}
export function detectSignalAt(c,i){
  if(i<50)return null;
  const v=c[i],prev=c[i-1],before=c[i-2];
  const long=v.dif>0&&v.dea>0&&prev.hist<before.hist&&v.hist>prev.hist;
  const short=v.dif<0&&v.dea<0&&prev.hist>before.hist&&v.hist<prev.hist;
  if(!long&&!short)return null;
  let pivot=null;
  for(let p=i-2;p>=2;p--){const x=c[p];
    if(long&&x.low<c[p-1].low&&x.low<c[p-2].low&&x.low<c[p+1].low&&x.low<c[p+2].low){pivot=x;break;}
    if(short&&x.high>c[p-1].high&&x.high>c[p-2].high&&x.high>c[p+1].high&&x.high>c[p+2].high){pivot=x;break;}
  }
  const reference=v.close;
  const signal={side:long?'LONG':'SHORT',time:v.time,closeTime:v.closeTime,reference,dif:v.dif,dea:v.dea,hist:v.hist,prevHist:prev.hist,rr:RR};
  if(!pivot)return signal;
  const stop=long?pivot.low:pivot.high;
  const direction=long?1:-1;
  const risk=direction*(reference-stop);
  if(!(risk>0))return signal;
  return {...signal,stop,pivotTime:pivot.time,target:reference+direction*RR*risk};
}
function zeroSide(dif) {
  if (Math.abs(dif)<ZERO_TOLERANCE) return 0;
  return Math.sign(dif);
}

export function detectZeroEvent(c,i) {
  if (i<50) return null;
  const side=zeroSide(c[i].dif);
  const previous=zeroSide(c[i-1].dif);
  if (side===0) return previous===0?null:'TOUCH';
  let j=i-1;
  while (j>=0 && zeroSide(c[j].dif)===0) j--;
  if (j<0 || zeroSide(c[j].dif)===side) return null;
  return side>0?'UP':'DOWN';
}

function formatZeroMessage(c,i,event,now) {
  const labels={UP:'上穿 0 軸',DOWN:'下穿 0 軸',TOUCH:'觸碰 0 軸'};
  const candle=c[i];
  return [
    `${ASSET} 3m MACD 快線 ${labels[event]} | ${SYMBOL} ${MARKET==='spot'?'現貨':'永續'}`,
    ...(now-(candle.closeTime+1)>INTERVAL_MS?['⏳ 補發歷史訊號']:[]),
    `K 線收盤（台灣）：${tw(candle.closeTime+1)}`,
    `DIF：${fmt(c[i-1].dif)} → ${fmt(candle.dif)}`,
    `收盤價：${fmt(candle.close)} USDT`
  ].join('\n');
}

function latestSwing(candles,lastIndex,field,direction) {
  for(let i=lastIndex;i>=2;i--){
    const price=direction*candles[i][field];
    if([-2,-1,1,2].every(offset=>price>direction*candles[i+offset][field]))return i;
  }
  return -1;
}

export function detectSwingZone(candles,i) {
  if(i<5)return [];
  const previous=candles[i-1].close;
  const close=candles[i].close;
  const events=[];
  for(const [direction,endField,startField] of [[1,'high','low'],[-1,'low','high']]){
    // Freeze the reference wave before the current candle closes.
    const endIndex=latestSwing(candles,i-3,endField,direction);
    if(endIndex<0)continue;
    const startIndex=latestSwing(candles,endIndex-1,startField,-direction);
    if(startIndex<0)continue;
    const start=candles[startIndex][startField];
    const end=candles[endIndex][endField];
    const size=direction*(end-start);
    if(size<=0)continue;
    const distance=direction*(end-close);
    const threshold=Number((end-direction*0.2*size).toFixed(10));
    if(distance<0||direction*(close-threshold)<=0||direction*(previous-threshold)>0)continue;
    events.push({side:direction===1?'NEAR_HIGH':'NEAR_LOW',start,end,threshold,close,
      percent:100*distance/size,closeTime:candles[i].closeTime});
  }
  return events;
}

export function confirmSwingZones(candles,i,pending) {
  const candidates=new Map(pending.map(zone=>[zone.side,zone]));
  for(const zone of detectSwingZone(candles,i)){
    if(!candidates.has(zone.side))candidates.set(zone.side,zone);
  }

  const waiting=[];
  const alerts=[];
  const candle=candles[i];
  const beforeHist=candles[i-2].hist;
  const previousHist=candles[i-1].hist;
  for(const zone of candidates.values()){
    const direction=zone.side==='NEAR_HIGH'?1:-1;
    const distance=direction*(zone.end-candle.close);
    if(distance<0||direction*(candle.close-zone.threshold)<=0)continue;

    const leadingSlope=direction*(previousHist-beforeHist);
    const latestSlope=direction*(candle.hist-previousHist);
    if(leadingSlope>0 && latestSlope<0){
      const size=direction*(zone.end-zone.start);
      alerts.push({...zone,enteredAt:zone.closeTime,closeTime:candle.closeTime,
        close:candle.close,percent:100*distance/size,beforeHist,previousHist,hist:candle.hist});
    }else{
      waiting.push(zone);
    }
  }
  return {waiting,alerts};
}

function formatSwingMessage(event,now){
  const isHigh=event.side==='NEAR_HIGH';
  return [
    `ETH 3m ${isHigh?'接近前波高點':'接近前波低點'} | ${SYMBOL} 現貨`,
    ...(now-(event.closeTime+1)>INTERVAL_MS?['⏳ 補發歷史訊號']:[]),
    `K 線收盤（台灣）：${tw(event.closeTime+1)}`,
    `進入區間（台灣）：${tw(event.enteredAt+1)}`,
    `MACD 柱體${isHigh?'由升轉降':'由降轉升'}：${fmt(event.beforeHist)} → ${fmt(event.previousHist)} → ${fmt(event.hist)}`,
    `前一波：${fmt(event.start)} → ${fmt(event.end)} USDT`,
    `20% 區間界線：${fmt(event.threshold)} USDT`,
    `收盤價：${fmt(event.close)} USDT`,
    `距前波${isHigh?'高':'低'}點：上段${isHigh?'漲':'跌'}幅的 ${fmt(event.percent)}%`
  ].join('\n');
}

export function detectSignal(candles){const c=enrich(candles);return detectSignalAt(c,c.length-1);}
export function pendingIndices(candles,lastCheckedTime){
  return candles.flatMap((c,i)=>i>=50&&c.time>lastCheckedTime?[i]:[]);
}
async function getCandles(now){
  const url=new URL(BASE);url.search=new URLSearchParams({symbol:SYMBOL,interval:INTERVAL,limit:String(WINDOW)}).toString();
  const res=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if(!res.ok)throw Error(`Binance HTTP ${res.status}: ${(await res.text()).slice(0,150)}`);
  const data=await res.json();if(!Array.isArray(data))throw Error('Invalid Binance data');
  const candles=data.map(x=>({time:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],closeTime:+x[6]})).filter(x=>x.closeTime<now);
  if(candles.length<60)throw Error('Insufficient closed candles');
  for(let i=1;i<candles.length;i++)if(candles[i].time-candles[i-1].time!==INTERVAL_MS)throw Error('Kline gap detected');
  return candles;
}
async function sendTelegram(message){
  if(DRY_RUN){console.log('[DRY_RUN]',message);return;}
  if(!TOKEN||!CHAT_ID)throw Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID as GitHub Actions secrets');
  const res=await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:CHAT_ID,text:message,disable_web_page_preview:true}),signal:AbortSignal.timeout(12000)});
  const payload=await res.json();if(!res.ok||!payload.ok)throw Error('Telegram sendMessage failed: '+JSON.stringify(payload).slice(0,220));
}
export function formatMessage(s,now=Date.now()){return [
  `${s.side==='LONG'?`🟢 ${ASSET} 做多訊號`:`🔴 ${ASSET} 做空訊號`} | ${SYMBOL} 5m`,
  ...(now-(s.closeTime+1)>INTERVAL_MS?['⏳ 補發歷史訊號，非即時進場提示']:[]),
  `K 線收盤（台灣）：${tw(s.closeTime+1)}`,
  `參考收盤價：${fmt(s.reference)} USDT`,
  ...(Number.isFinite(s.stop)?[
    `波段止損：${fmt(s.stop)} USDT`,
    `參考 ${s.rr}R 目標：${fmt(s.target)} USDT`,
    `波段轉折時間：${tw(s.pivotTime)}`
  ]:['波段止損／5R 目標：無有效參考點位']),
  `DIF ${fmt(s.dif)} | DEA ${fmt(s.dea)}`,
  `MACD 柱體：${fmt(s.prevHist)} → ${fmt(s.hist)}`,
  '',
  '⚠️ 收盤確認訊號，非成交通知。回測規則是下一根 K 棒開盤進場；實際進場後須依成交價重新計算風險與止盈。'
].join('\n');}
function readState(){try{const x=JSON.parse(readFileSync(STATE_FILE,'utf8'));if(x.key===STATE_KEY&&Number.isFinite(x.lastCheckedTime))return x;}catch(e){if(e.code!=='ENOENT')throw e;}return null;}
function saveState(time,pendingSwingZones){if(DRY_RUN)return;mkdirSync('state',{recursive:true});writeFileSync(STATE_FILE,JSON.stringify({version:1,key:STATE_KEY,lastCheckedTime:time,...(SWING_ZONE?{pendingSwingZones}:{}),updatedAt:new Date().toISOString()},null,2)+'\n');}
export async function main(){
  if(!['spot','futures'].includes(MARKET))throw Error('MARKET must be spot or futures');
  if(!/^[A-Z0-9]{5,24}$/.test(SYMBOL))throw Error('Invalid SYMBOL');
  if(!(RR>0&&RR<=100))throw Error('Invalid RR');
  if(!DRY_RUN&&(!TOKEN||!CHAT_ID))throw Error('Missing Telegram credentials');
  if(TEST_TELEGRAM){await sendTelegram(`✅ ${ASSET} MACD Telegram 測試成功！\n機器人已能正常傳送通知。`);console.log('Telegram test sent');return;}
  const now=Date.now(),candles=await getCandles(now),c=enrich(candles),last=c.at(-1);
  const state=readState();
  // Start the new 3m alert at the latest close. Keep the 5m initial backfill.
  const firstTime=state?state.lastCheckedTime:last.time-(THREE_MINUTE?1:24)*INTERVAL_MS;
  if(firstTime<c[50].time-INTERVAL_MS)throw Error('State cursor is older than the available candle window; manual recovery required. No cursor advanced.');
  const indices=pendingIndices(c,firstTime);
  if(!indices.length){console.log(`Up to date: ${tw(last.closeTime+1)}`);return;}
  console.log(`Checking ${indices.length} closed candles, from ${tw(c[indices[0]].closeTime+1)} to ${tw(last.closeTime+1)}`);
  let count=0;
  let pendingSwingZones=state?.pendingSwingZones??[];
  for(const i of indices){
    const event=SWING_ZONE?null:ZERO_CROSS?detectZeroEvent(c,i):detectSignalAt(c,i);
    if(SWING_ZONE){
      const {waiting,alerts}=confirmSwingZones(c,i,pendingSwingZones);
      for(const swingEvent of alerts){
        await sendTelegram(formatSwingMessage(swingEvent,now));
        count++;
        console.log(`Sent ${swingEvent.side} for ${tw(c[i].closeTime+1)}`);
      }
      pendingSwingZones=waiting;
    }else if(event){
      await sendTelegram(ZERO_CROSS?formatZeroMessage(c,i,event,now):formatMessage(event,now));
      count++;
      console.log(`Sent ${ZERO_CROSS?event:event.side} for ${tw(c[i].closeTime+1)}`);
    }
    // Save after each successfully handled candle, including no-signal candles.
    // The workflow commits even when a later Telegram send fails.
    saveState(c[i].time,pendingSwingZones);
  }
  console.log(`Processed ${indices.length} candles; sent ${count} signal(s); cursor=${last.time}`);
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){main().catch(e=>{console.error(e.message);process.exitCode=1;});}

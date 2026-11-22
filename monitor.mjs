// BTC MACD closed-candle alert with persistent cursor and delayed-run backfill.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const SYMBOL=(process.env.SYMBOL||'BTCUSDT').toUpperCase();
const MARKET=process.env.MARKET||'spot';
const RR=Number(process.env.RR||5);
const TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID=process.env.TELEGRAM_CHAT_ID;
const DRY_RUN=process.env.DRY_RUN==='1';
const TEST_TELEGRAM=process.env.TEST_TELEGRAM==='1';
const INTERVAL_MS=300000;
const BASE=MARKET==='futures'?'https://fapi.binance.com/fapi/v1/klines':'https://data-api.binance.vision/api/v3/klines';
const WINDOW=1000;
const STATE_FILE='state/monitor-state.json';
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
  if(!pivot)return null;
  const reference=v.close,stop=long?pivot.low:pivot.high;
  const risk=long?reference-stop:stop-reference;
  if(!(risk>0))return null;
  return {side:long?'LONG':'SHORT',time:v.time,closeTime:v.closeTime,reference,stop,pivotTime:pivot.time,target:reference+(long?1:-1)*RR*risk,dif:v.dif,dea:v.dea,hist:v.hist,prevHist:prev.hist,rr:RR};
}
export function detectSignal(candles){const c=enrich(candles);return detectSignalAt(c,c.length-1);}
export function pendingIndices(candles,lastCheckedTime){
  return candles.flatMap((c,i)=>i>=50&&c.time>lastCheckedTime?[i]:[]);
}
async function getCandles(now){
  const url=new URL(BASE);url.search=new URLSearchParams({symbol:SYMBOL,interval:'5m',limit:String(WINDOW)}).toString();
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
  `${s.side==='LONG'?'🟢 BTC 做多訊號':'🔴 BTC 做空訊號'} | ${SYMBOL} 5m`,
  ...(now-(s.closeTime+1)>INTERVAL_MS?['⏳ 補發歷史訊號，非即時進場提示']:[]),
  `K 線收盤（台灣）：${tw(s.closeTime+1)}`,
  `參考收盤價：${fmt(s.reference)} USDT`,
  `波段止損：${fmt(s.stop)} USDT`,
  `參考 ${s.rr}R 目標：${fmt(s.target)} USDT`,
  `波段轉折時間：${tw(s.pivotTime)}`,
  `DIF ${fmt(s.dif)} | DEA ${fmt(s.dea)}`,
  `MACD 柱體：${fmt(s.prevHist)} → ${fmt(s.hist)}`,
  '',
  '⚠️ 收盤確認訊號，非成交通知。回測規則是下一根 K 棒開盤進場；實際進場後須依成交價重新計算風險與止盈。'
].join('\n');}
function readState(){try{const x=JSON.parse(readFileSync(STATE_FILE,'utf8'));if(x.key===`${SYMBOL}:${MARKET}`&&Number.isFinite(x.lastCheckedTime))return x;}catch(e){if(e.code!=='ENOENT')throw e;}return null;}
function saveState(time){if(DRY_RUN)return;mkdirSync('state',{recursive:true});writeFileSync(STATE_FILE,JSON.stringify({version:1,key:`${SYMBOL}:${MARKET}`,lastCheckedTime:time,updatedAt:new Date().toISOString()},null,2)+'\n');}
export async function main(){
  if(!['spot','futures'].includes(MARKET))throw Error('MARKET must be spot or futures');
  if(!/^[A-Z0-9]{5,24}$/.test(SYMBOL))throw Error('Invalid SYMBOL');
  if(!(RR>0&&RR<=100))throw Error('Invalid RR');
  if(!DRY_RUN&&(!TOKEN||!CHAT_ID))throw Error('Missing Telegram credentials');
  if(TEST_TELEGRAM){await sendTelegram('✅ BTC MACD Telegram 測試成功！\n機器人已能正常傳送通知。');console.log('Telegram test sent');return;}
  const now=Date.now(),candles=await getCandles(now),c=enrich(candles),last=c.at(-1);
  const state=readState();
  // First deployment: check the latest 2 hours, not months of old signals.
  const firstTime=state?state.lastCheckedTime:last.time-24*INTERVAL_MS;
  if(firstTime<c[50].time-INTERVAL_MS)throw Error('State cursor is older than the available candle window; manual recovery required. No cursor advanced.');
  const indices=pendingIndices(c,firstTime);
  if(!indices.length){console.log(`Up to date: ${tw(last.closeTime+1)}`);return;}
  console.log(`Checking ${indices.length} closed candles, from ${tw(c[indices[0]].closeTime+1)} to ${tw(last.closeTime+1)}`);
  let count=0;
  for(const i of indices){
    const s=detectSignalAt(c,i);
    if(s){await sendTelegram(formatMessage(s,now));count++;console.log(`Sent ${s.side} for ${tw(s.closeTime+1)}`);}
    // Save after each successfully handled candle, including no-signal candles.
    // The workflow commits even when a later Telegram send fails.
    saveState(c[i].time);
  }
  console.log(`Processed ${indices.length} candles; sent ${count} signal(s); cursor=${last.time}`);
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){main().catch(e=>{console.error(e.message);process.exitCode=1;});}

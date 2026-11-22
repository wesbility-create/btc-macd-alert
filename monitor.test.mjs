import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSignal,enrich,pendingIndices,formatMessage} from './monitor.mjs';
const candles=Array.from({length:100},(_,i)=>({time:i*300000,close:100+i,high:101+i,low:99+i,open:100+i,closeTime:i*300000+299999}));
test('EMA and histogram are finite',()=>{const e=enrich(candles);assert.equal(e.length,100);assert.ok(Number.isFinite(e.at(-1).hist));});
test('flat prices yield no signal',()=>{const c=candles.map(x=>({...x,close:100,high:101,low:99}));assert.equal(detectSignal(c),null);});
test('catch-up selects all unprocessed closed candles',()=>{assert.deepEqual(pendingIndices(candles,candles[96].time),[97,98,99]);});
test('cursor prevents reprocessing',()=>{assert.deepEqual(pendingIndices(candles,candles[99].time),[]);});
test('historical alerts are explicitly marked',()=>{const s={side:'LONG',closeTime:0,reference:100,stop:90,target:150,pivotTime:0,dif:1,dea:1,hist:2,prevHist:1,rr:5};assert.match(formatMessage(s,900000),/補發歷史訊號/);});

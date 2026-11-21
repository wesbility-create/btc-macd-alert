import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSignal,enrich} from './monitor.mjs';
test('EMA and histogram are finite for normal input',()=>{
  const candles=Array.from({length:100},(_,i)=>({time:i*300000,close:100+i,high:101+i,low:99+i,open:100+i,closeTime:i*300000+299999}));
  const e=enrich(candles);assert.equal(e.length,100);assert.ok(Number.isFinite(e.at(-1).hist));
});
test('flat prices yield no signal',()=>{
  const candles=Array.from({length:100},(_,i)=>({time:i*300000,close:100,high:101,low:99,open:100,closeTime:i*300000+299999}));
  assert.equal(detectSignal(candles),null);
});

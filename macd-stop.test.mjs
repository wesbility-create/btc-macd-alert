import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSignalAt,formatMessage} from './monitor.mjs';

for (const [direction, side] of [[1,'LONG'],[-1,'SHORT']]) {
  test(`${side} alerts depend on MACD even without a valid swing stop`, () => {
    const candles=Array.from({length:52},(_,i)=>({
      time:i*300000,closeTime:(i+1)*300000-1,close:100,low:99,high:101,
      dif:direction,dea:direction,hist:i===50?-direction:0
    }));
    const detect=()=>detectSignalAt(candles,51);
    assert.equal(detect().side,side);
    assert.match(formatMessage(detect()),/無有效參考點位/);
    const pivot=candles[48];
    const field=side==='LONG'?'low':'high';
    const adverse=100-direction*2;
    pivot[field]=adverse;
    assert.equal(detect().stop,adverse);
    assert.match(formatMessage(detect()),/參考 5R 目標/);
    candles[51].close=100-direction*3;
    assert.equal(detect().side,side);
    assert.equal(detect().stop,undefined);
    candles[51].hist=-direction;
    assert.equal(detect(),null);
  });
}

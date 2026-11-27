import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSignalAt,formatMessage,supertrendDirections} from './monitor.mjs';

for (const [direction, side] of [[1,'LONG'],[-1,'SHORT']]) {
  test(`${side} alerts depend on MACD even without a valid swing stop`, () => {
    const candles=Array.from({length:52},(_,i)=>({
      time:i*300000,closeTime:(i+1)*300000-1,close:100,low:99,high:101,
      trend:direction===1?'UP':'DOWN',dif:-direction,dea:-direction,
      hist:direction*(i===50?-4:-3)
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
    candles[49].hist=direction*2;
    candles[50].hist=direction;
    candles[51].hist=direction*2;
    assert.equal(detect().side,side);
    candles[51].trend=direction===1?'DOWN':'UP';
    assert.equal(detect(),null);
    candles[51].trend=candles[50].trend;
    candles[51].hist=candles[50].hist;
    assert.equal(detect(),null);
  });
}

test('Supertrend 18/10 waits for ATR then flips at strict band breaks',()=>{
  const bars=Array.from({length:18},()=>({low:99,high:101,close:100}));
  for (const price of [120,121,120,70]) bars.push({low:price,high:price,close:price});
  const directions=supertrendDirections(bars);
  assert.equal(directions[16],null);
  assert.deepEqual(directions.slice(17),['DOWN','DOWN','UP','UP','DOWN']);
});

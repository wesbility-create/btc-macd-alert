import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSwingZone} from './monitor.mjs';

test('price touches the top or bottom fifth of a confirmed swing from the inside', () => {
  const rising=[
    [1620,1680,1650],[1620,1680,1650],[1600,1680,1640],
    [1620,1680,1650],[1620,1680,1660],[1620,1700,1680],
    [1620,1680,1670],[1620,1680,1680],[1620,1690,1685],[1620,1690,1686]
  ].map(([low,high,close])=>({low,high,close}));
  const falling=rising.map(({low,high,close})=>({low:3300-high,high:3300-low,close:3300-close}));
  for(const [candles,side,end] of [[rising,'NEAR_HIGH',1700],[falling,'NEAR_LOW',1600]]){
    const detect=i=>detectSwingZone(candles,i).find(event=>event.side===side);
    assert.equal(detect(7),undefined);
    assert.equal(detect(8).end,end);
    assert.equal(detect(8).percent,15);
    assert.equal(detect(9),undefined);
    candles[8].close=end;
    assert.equal(detect(8).percent,0);
    candles[8].close=end+(side==='NEAR_HIGH'?1:-1);
    assert.equal(detect(8),undefined);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSwingZone,confirmSwingZones} from './monitor.mjs';

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

test('waits for matching histogram contraction, cancels outside the zone, and sends once', () => {
  const bars=[
    [1620,1680,1650],[1620,1680,1650],[1600,1680,1640],
    [1620,1680,1650],[1620,1680,1660],[1620,1700,1680],
    [1620,1680,1670],[1620,1680,1680],[1620,1690,1685],[1620,1690,1686],
    [1620,1690,1687]
  ];
  for(const direction of [1,-1]){
    const candles=bars.map(([lo,hi,price],i)=>({
      low:direction===1?lo:3300-hi,high:direction===1?hi:3300-lo,
      close:direction===1?price:3300-price,hist:direction*([1,2,1,0][i-7]??1),
      closeTime:i*180000
    }));
    const side=direction===1?'NEAR_HIGH':'NEAR_LOW';
    let result=confirmSwingZones(candles,8,[]);
    assert.equal(result.alerts.length,0);
    assert.equal(result.waiting[0].side,side);
    const pending=JSON.parse(JSON.stringify(result.waiting));
    result=confirmSwingZones(candles,9,pending);
    assert.equal(result.alerts[0].side,side);
    assert.equal(result.alerts[0].enteredAt,candles[8].closeTime);
    assert.equal(result.waiting.length,0);
    assert.equal(confirmSwingZones(candles,10,result.waiting).alerts.length,0);
    candles[9].hist=-direction;
    assert.equal(confirmSwingZones(candles,9,pending).alerts.length,0);
    candles[8].hist=0.5*direction;
    assert.equal(confirmSwingZones(candles,8,[]).alerts[0].side,side);
    candles[9].close=direction===1?1680:1620;
    result=confirmSwingZones(candles,9,pending);
    assert.equal(result.alerts.length,0);
    assert.equal(result.waiting.length,0);
  }
});

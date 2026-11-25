import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSwingZone,confirmSwingZones} from './monitor.mjs';

const bars=[
  [1620,1670,1650],[1620,1670,1650],[1600,1670,1640],
  [1620,1670,1650],[1620,1670,1660],[1620,1700,1680],
  [1620,1670,1660],[1620,1680,1660],[1620,1685,1660],
  [1620,1670,1660],[1620,1670,1660]
];

for(const direction of [1,-1]){
  const side=direction===1?'NEAR_HIGH':'NEAR_LOW';
  const field=direction===1?'high':'low';
  const mirror=price=>direction===1?price:3300-price;
  const makeCandles=()=>bars.map(([low,high,close],i)=>({
    low:direction===1?low:mirror(high),
    high:direction===1?high:mirror(low),
    close:mirror(close),
    hist:direction*([1,2,1,2,1][i-6]??0),
    closeTime:(i+1)*180000-1
  }));

  test(`${side} tracks the wick in the zone and waits for a later turn outside it`,()=>{
    const candles=makeCandles();
    const detect=i=>detectSwingZone(candles,i).find(zone=>zone.side===side);
    const confirm=(i,pending)=>confirmSwingZones(candles,i,pending.filter(zone=>zone.side===side));
    assert.equal(detect(7),undefined);
    assert.equal(detect(8).end,mirror(1700));
    const touched=confirm(8,[]);
    assert.equal(touched.alerts.length,0);
    assert.equal(touched.waiting[0].side,side);
    const waiting=confirm(9,JSON.parse(JSON.stringify(touched.waiting)));
    assert.equal(waiting.alerts.length,0);
    assert.equal(waiting.waiting[0].closeTime,candles[8].closeTime);
    const confirmed=confirm(10,waiting.waiting);
    assert.equal(confirmed.alerts[0].price,mirror(1670));
    assert.equal(confirmed.alerts[0].percent,30);
    assert.equal(confirmed.waiting.length,0);
  });

  test(`${side} uses a strict boundary on the next reversal`,()=>{
    const candles=makeCandles();
    const waiting=confirmSwingZones(candles,8,[]).waiting;
    for(const invalidPrice of [1700,1701]){
      candles[10][field]=mirror(invalidPrice);
      const result=confirmSwingZones(candles,10,waiting);
      assert.equal(result.alerts.some(zone=>zone.side===side),false);
      assert.equal(result.waiting.some(zone=>zone.side===side),false);
    }
    candles[8][field]=mirror(1680);
    assert.equal(detectSwingZone(candles,8).some(zone=>zone.side===side),false);
    candles[8][field]=mirror(1700);
    assert.equal(detectSwingZone(candles,8).some(zone=>zone.side===side),true);
  });
}

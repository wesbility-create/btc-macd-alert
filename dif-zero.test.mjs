import test from 'node:test';
import assert from 'node:assert/strict';
import {detectZeroEvent} from './monitor.mjs';

test('ETH DIF crosses, touches and leaves the zero band', () => {
  const events = values => {
    const candles = [...Array(50).fill(1), ...values].map(dif => ({dif}));
    return values.map((_, i) => detectZeroEvent(candles, i + 50));
  };
  assert.deepEqual(events([-1, 1]), ['DOWN', 'UP']);
  assert.deepEqual(events([0.00001, -0.00001, 0, -1]), ['TOUCH', null, null, 'DOWN']);
  assert.deepEqual(events([0, 1]), ['TOUCH', null]);
  assert.deepEqual(events([0.01, 0.005]), [null, null]);
});

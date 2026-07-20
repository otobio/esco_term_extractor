import { Embedder } from '../src/embedder.ts';

const e = new Embedder({ dtype: 'fp16' });
const v = await e.embed(['shelf filler', 'commercial worker', 'bartender']);
const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
console.log(
  'MODEL OK dim',
  v[0].length,
  '| cos(shelf filler,commercial worker)=',
  dot(v[0], v[1]).toFixed(3),
  '| cos(bartender,commercial worker)=',
  dot(v[2], v[1]).toFixed(3),
);

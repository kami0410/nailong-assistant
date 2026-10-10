'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/main/agent/model-catalog');
test('model discovery retains declared capabilities and per-model limits without guessing names', () => {
  const result = catalog.discover([{ id: 'opaque-id', name: 'My Model', context_window: 1048576, max_output_tokens: 393216, input_modalities: ['text'], effort: { supported_levels: ['low', 'high', 'max'] } }], 'https://api.deepseek.com/v1');
  assert.equal(result[0].reasoning, true);
  assert.equal(result[0].vision, false);
  assert.equal(result[0].maxTokens, 393216);
  assert.deepEqual(result[0].thinkingLevels, ['off', 'low', 'high', 'max']);
  assert.equal(result[0].thinkingFormat, 'deepseek');
  const unknown = catalog.discover([{ id: 'reasoning-vision-super-model' }], 'https://fixture.invalid');
  assert.equal(unknown[0].reasoning, false); assert.equal(unknown[0].vision, false);
});
test('model catalog rejects invalid limits and duplicate ids', () => {
  assert.throws(() => catalog.normalize([{ id: 'a', maxTokens: Infinity }]), /输出/);
  assert.throws(() => catalog.normalize([{ id: 'a' }, { id: 'a' }]), /重复/);
  assert.throws(() => catalog.normalize([{ id: 'a', contextWindow: 1024, maxTokens: 2048 }]), /上下文/);
});

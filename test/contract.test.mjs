// 用宿主真实的 defineTool 校验工具定义（需要 DSH_TOOLS_PATH 指向 @deepseek-ai/dsh-tools 的 lib/index.js；没有就跳过）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { toolSpecs } from '../src/index.js';

const hostPath = process.env.DSH_TOOLS_PATH;
const host = hostPath && existsSync(hostPath) ? await import(pathToFileURL(hostPath).href) : null;

test('宿主 defineTool 接受全部 12 个工具', { skip: !host && '没有设置 DSH_TOOLS_PATH' }, () => {
  const specs = Object.values(toolSpecs());
  assert.equal(specs.length, 12);
  for (const spec of specs) {
    const tool = host.defineTool({ ...spec, execute: async () => ({ text: '', images: [] }) });
    assert.equal(tool.name, spec.name);
    assert.equal(tool.parameters.type, 'object');
    const blocks = tool.output.render({}, { text: 'hi', images: [{ id: 'a' }] });
    assert.deepEqual(blocks.map((b) => b.type), ['image', 'text']);
  }
});

test('模型不能传路径、cookies、收件人', () => {
  for (const spec of Object.values(toolSpecs())) {
    assert.equal(Object.keys(spec.parameters).some((k) => /cookie|path|file|receiver|to_?uid|mid/i.test(k)), false, spec.name);
  }
  assert.deepEqual(Object.keys(toolSpecs().dm.parameters), ['text'], '私信只能发给设置里的主人');
});

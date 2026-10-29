// 用宿主真实的 defineTool 校验工具定义（需要 DSH_TOOLS_PATH 指向 @deepseek-ai/dsh-tools 的 lib/index.js；没有就跳过）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { toolSpecs } from '../src/index.js';

const hostPath = process.env.DSH_TOOLS_PATH;
const host = hostPath && existsSync(hostPath) ? await import(pathToFileURL(hostPath).href) : null;

test('宿主 defineTool 接受 bili_look / bili_look_zoom', { skip: !host && '没有设置 DSH_TOOLS_PATH' }, () => {
  const specs = toolSpecs();
  for (const spec of [specs.look, specs.zoom]) {
    const tool = host.defineTool({ ...spec, execute: async () => ({ text: '', images: [] }) });
    assert.equal(tool.name, spec.name);
    assert.equal(tool.parameters.type, 'object');
    const blocks = tool.output.render({}, { text: 'hi', images: [{ id: 'a' }] });
    assert.deepEqual(blocks.map((b) => b.type), ['image', 'text']);
  }
  assert.ok(toolSpecs().look.parameters.url.required);
  assert.equal(Object.keys(toolSpecs().look.parameters).some((k) => /cookie|path|file/i.test(k)), false, '模型不能传路径或 cookies');
});

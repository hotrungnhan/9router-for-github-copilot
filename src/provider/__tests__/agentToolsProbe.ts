import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as vscode from 'vscode';
import { GatewayClient } from '../../api/client';
import type { GatewayConfig } from '../../config/gatewayConfig';
import type { ModelCatalog } from '../modelCatalog';
import { ChatRequestHandler } from '../chatRequestHandler';

/** Shared by Bun regression tests and an isolated VS Code extension-host run. */
export async function run(): Promise<void> {
  const selectors = {
    type: 'object',
    properties: {
      agent_id: { type: 'string' },
      agent_ids: { type: 'array', minItems: 1, items: { type: 'string' } },
      scope: { type: 'string', enum: ['siblings', 'children'] },
      message: { type: 'string' },
    },
    required: ['message'],
    oneOf: ['agent_id', 'agent_ids', 'scope'].map((key) => ({ required: [key] })),
  };
  const replies = [
    { name: 'task', arguments: { agent_type: 'explore', prompt: 'Inspect fixture', description: 'Inspect', name: 'probe' } },
    { name: 'write_agent', arguments: { agent_id: 'probe-id', agent_ids: [], scope: null, message: 'Continue' } },
    { name: 'write_agent', arguments: { agent_ids: [], agent_id: '', scope: 'children', message: 'Continue' } },
    { name: 'write_agent', arguments: { agent_id: 'probe-id', scope: 'siblings', message: 'Ambiguous' } },
  ];
  let requests = 0;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/chat/completions');
      let body = '';
      for await (const chunk of req) { body += chunk; }
      const wire = JSON.parse(body);
      assert.deepEqual(wire.tools.map((tool: { function: { name: string } }) => tool.function.name), ['task', 'write_agent', 'read_agent']);
      for (const tool of wire.tools) {
        assert.equal(tool.function.strict, false);
        assert.ok(tool.function.description.includes('task'));
      }
      assert.deepEqual(wire.tools[1].function.parameters, selectors);
      const reply = replies[requests++];
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${requests}`, type: 'function', function: { name: reply.name, arguments: JSON.stringify(reply.arguments) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const config = {
      serverUrl: `http://127.0.0.1:${address.port}`, requestTimeout: 5000,
      defaultMaxTokens: 128000, defaultMaxOutputTokens: 4096,
      enableImageInput: false, enableToolCalling: true, parallelToolCalling: true,
      agentTemperature: 0, verboseLogging: false, customHeaders: {}, extraModelOptions: {},
      perModelOptions: {}, modelContextWindows: {},
    } as GatewayConfig;
    const logs: string[] = [];
    const handler = new ChatRequestHandler({
      client: new GatewayClient(config),
      catalog: {
        resolveModelMaxContext: () => 128000,
        getDiscoveredParams: () => undefined,
        learnContextSizeFromError: () => false,
      } as unknown as ModelCatalog,
      getConfig: () => config, log: (message) => logs.push(message),
      onCompleted: () => {}, showOutput: () => {},
    });
    const parts: vscode.LanguageModelToolCallPart[] = [];
    for (const reply of replies) {
      const before = parts.length;
      await handler.handle(
        { id: 'fixture-model', name: 'Fixture', maxInputTokens: 128000, maxOutputTokens: 4096 } as vscode.LanguageModelChatInformation,
        [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Synthetic agent probe')], name: undefined }],
        { tools: [
          { name: 'task', description: 'Launch helper', inputSchema: { type: 'object' } },
          { name: 'write_agent', description: 'Follow up', inputSchema: selectors },
          { name: 'read_agent', description: 'Read helper', inputSchema: { type: 'object' } },
        ], toolMode: vscode.LanguageModelChatToolMode.Auto },
        { report: (part) => { if (part instanceof vscode.LanguageModelToolCallPart) { parts.push(part); } } },
        { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }
      );
      assert.equal(parts.length, before + 1, logs.join('\n'));
      assert.equal(parts[before].name, reply.name);
    }
    assert.deepEqual(parts[0].input, replies[0].arguments);
    assert.deepEqual(parts[1].input, { agent_id: 'probe-id', message: 'Continue' });
    assert.deepEqual(parts[2].input, { scope: 'children', message: 'Continue' });
    assert.deepEqual(parts[3].input, replies[3].arguments);
    assert.equal(requests, replies.length);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

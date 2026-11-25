import { mock, test } from 'bun:test';

class TextPart { constructor(public value: string) {} }
class ToolCallPart { constructor(public callId: string, public name: string, public input: unknown) {} }
class DataPart { constructor(public data: Uint8Array, public mimeType: string) {} }
mock.module('vscode', () => ({
  LanguageModelTextPart: TextPart,
  LanguageModelToolCallPart: ToolCallPart,
  LanguageModelToolResultPart: class {},
  LanguageModelDataPart: DataPart,
  LanguageModelThinkingPart: TextPart,
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  window: { showErrorMessage: () => Promise.resolve(undefined) },
}));
const { run } = require('./agentToolsProbe') as typeof import('./agentToolsProbe');

test('provider agent tools survive HTTP/SSE round trip', run);

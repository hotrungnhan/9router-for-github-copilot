import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pickReasoningEffort } from '../reasoningEffort';

describe('pickReasoningEffort', () => {
    test('returns undefined when no source provides a value', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: undefined,
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            undefined
        );
    });

    test('reads the camelCase value from optionsModelOptions (the variant field)', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: 'high' },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            'high'
        );
    });

    test('reads the snake_case value from optionsModelOptions', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoning_effort: 'xhigh' },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            'xhigh'
        );
    });

    test('precedence: options > perModel > extraModel', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: 'low' },
                perModelOptions: { reasoningEffort: 'medium' },
                extraModelOptions: { reasoningEffort: 'high' },
            }),
            'low'
        );
    });

    test('falls back to perModelOptions when options has no effort', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { temperature: 0.5 },
                perModelOptions: { reasoningEffort: 'medium' },
                extraModelOptions: { reasoningEffort: 'high' },
            }),
            'medium'
        );
    });

    test('falls back to extraModelOptions when neither caller nor perModel set one', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: undefined,
                perModelOptions: {},
                extraModelOptions: { reasoningEffort: 'xhigh' },
            }),
            'xhigh'
        );
    });

    test('lowercases the value so the wire format is canonical', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: 'HIGH' },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            'high'
        );
    });

    test('strips the literal "none" value (GitHub Copilot 400s on it)', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: 'none' },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            undefined
        );
    });

    test('strips the literal "off" value', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: 'OFF' },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            undefined
        );
    });

    test('ignores non-string values (numbers, booleans, objects)', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: 2 as unknown as string },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            undefined
        );
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: true as unknown as string },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            undefined
        );
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: { level: 'high' } as unknown as string },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            undefined
        );
    });

    test('ignores empty strings', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: '' },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            undefined
        );
    });

    test('caller optionsModelOptions snake_case wins over perModel camelCase', () => {
        // Variant writes `reasoningEffort` (camelCase) into modelOptions; a user
        // who also sets `reasoning_effort` in perModelOptions is asking for the
        // picker's choice to win.
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: 'low' },
                perModelOptions: { reasoning_effort: 'high' },
                extraModelOptions: undefined,
            }),
            'low'
        );
    });

    test('reads from modelConfiguration (microsoft/vscode#315181 picker channel)', () => {
        // Some VS Code builds promote the "Thinking Effort" picker to
        // `options.modelConfiguration` instead of `options.modelOptions`. The
        // helper reads both with `optionsModelOptions` winning.
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: undefined,
                modelConfiguration: { reasoningEffort: 'xhigh' },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            'xhigh'
        );
    });

    test('optionsModelOptions wins over modelConfiguration when both are set', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: 'low' },
                modelConfiguration: { reasoningEffort: 'high' },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            'low'
        );
    });

    // The Copilot SDK's `ReasoningEffort` union (github/copilot-sdk#302) is
    // exactly {low, medium, high, xhigh}. Any other string the user typed
    // (e.g. `max`, `minimal`, an empty array, or arbitrary words) must NOT be
    // forwarded — upstream would either 400 or silently default, and the
    // current chat handler is meant to be a strict pass-through.
    test('strips the legacy "max" value (not in the Copilot SDK union)', () => {
        assert.equal(
            pickReasoningEffort({
                optionsModelOptions: { reasoningEffort: 'max' },
                perModelOptions: undefined,
                extraModelOptions: undefined,
            }),
            undefined
        );
    });

    test('strips arbitrary strings outside the union', () => {
        for (const value of ['minimal', 'auto', 'thinking', 'turbo', '1', '99']) {
            assert.equal(
                pickReasoningEffort({
                    optionsModelOptions: { reasoningEffort: value },
                    perModelOptions: undefined,
                    extraModelOptions: undefined,
                }),
                undefined,
                `expected '${value}' to be stripped`
            );
        }
    });

    test('accepts every value in the Copilot SDK union', () => {
        for (const value of ['low', 'medium', 'high', 'xhigh']) {
            assert.equal(
                pickReasoningEffort({
                    optionsModelOptions: { reasoningEffort: value },
                    perModelOptions: undefined,
                    extraModelOptions: undefined,
                }),
                value
            );
        }
    });
});

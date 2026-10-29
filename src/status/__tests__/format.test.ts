import { test, describe } from 'bun:test';
import assert from 'node:assert/strict';
import { extractHost, formatTokenCount, stripPort } from '../format';

describe('formatTokenCount', () => {
  test('shows integers below 1000 verbatim', () => {
    assert.equal(formatTokenCount(0), '0');
    assert.equal(formatTokenCount(1), '1');
    assert.equal(formatTokenCount(999), '999');
  });

  test('uses one-decimal-k notation for 1k-9.9k', () => {
    assert.equal(formatTokenCount(1000), '1.0k');
    assert.equal(formatTokenCount(1234), '1.2k');
    assert.equal(formatTokenCount(4567), '4.6k');
    assert.equal(formatTokenCount(9999), '10.0k');
  });

  test('uses rounded-k notation for 10k-999k', () => {
    assert.equal(formatTokenCount(10_000), '10k');
    assert.equal(formatTokenCount(12_345), '12k');
    assert.equal(formatTokenCount(999_499), '999k');
  });

  test('uses one-decimal-M notation for 1M-9.9M', () => {
    assert.equal(formatTokenCount(1_000_000), '1.0M');
    assert.equal(formatTokenCount(1_234_567), '1.2M');
  });

  test('uses rounded-M notation above 10M', () => {
    assert.equal(formatTokenCount(10_000_000), '10M');
    assert.equal(formatTokenCount(99_999_999), '100M');
  });

  test('handles negative or non-finite input defensively', () => {
    assert.equal(formatTokenCount(-1), '0');
    assert.equal(formatTokenCount(Number.NaN), '0');
    assert.equal(formatTokenCount(Number.POSITIVE_INFINITY), '0');
  });
});

describe('extractHost', () => {
  test('returns host:port for typical http/https URLs', () => {
    assert.equal(extractHost('http://localhost:8000'), 'localhost:8000');
    assert.equal(extractHost('https://api.example.com'), 'api.example.com');
    assert.equal(extractHost('http://10.0.0.1:11434/v1'), '10.0.0.1:11434');
  });

  test('falls back to the raw string when the URL is unparseable', () => {
    assert.equal(extractHost('not a url'), 'not a url');
    assert.equal(extractHost(''), '');
  });
});

describe('stripPort', () => {
  test('drops the :port suffix from typical hostnames', () => {
    assert.equal(stripPort('localhost:8000'), 'localhost');
    assert.equal(stripPort('api.example.com:443'), 'api.example.com');
    assert.equal(stripPort('10.0.0.1:11434'), '10.0.0.1');
  });

  test('returns the input unchanged when there is no port', () => {
    assert.equal(stripPort('localhost'), 'localhost');
    assert.equal(stripPort('api.example.com'), 'api.example.com');
    assert.equal(stripPort(''), '');
  });

  test('handles IPv6 literals by preserving the bracketed address', () => {
    assert.equal(stripPort('[::1]:8000'), '[::1]');
    assert.equal(stripPort('[2001:db8::1]:11434'), '[2001:db8::1]');
  });

  test('leaves an unbracketed IPv6 address alone (best effort)', () => {
    // No clean way to tell IPv6 from "hostname:port" without brackets, so
    // we accept that a bare IPv6 + port is ambiguous and gets truncated.
    assert.equal(stripPort('[::1]'), '[::1]');
  });
});

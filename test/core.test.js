import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLines, detectEncoding } from '../src/index.js';

async function withTempFile(content, fn) {
  const path = join(tmpdir(), `test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(path, content);
  try {
    await fn(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

test('reads lines from a simple UTF-8 file', async () => {
  await withTempFile('hello\nworld\n', async (path) => {
    const lines = [];
    for await (const line of readLines(path)) {
      lines.push(line);
    }
    assert.deepEqual(lines, ['hello', 'world']);
  });
});

test('handles CRLF and CR line endings', async () => {
  await withTempFile('a\r\nb\rc\n', async (path) => {
    const lines = [];
    for await (const line of readLines(path)) {
      lines.push(line);
    }
    assert.deepEqual(lines, ['a', 'b', 'c']);
  });
});

test('yields last line without trailing newline', async () => {
  await withTempFile('one\ntwo', async (path) => {
    const lines = [];
    for await (const line of readLines(path)) {
      lines.push(line);
    }
    assert.deepEqual(lines, ['one', 'two']);
  });
});

test('respects bufferSize option', async () => {
  await withTempFile('a\nb\nc\nd\n', async (path) => {
    const lines = [];
    for await (const line of readLines(path, { bufferSize: 2 })) {
      lines.push(line);
    }
    assert.deepEqual(lines, ['a', 'b', 'c', 'd']);
  });
});

test('detects UTF-8 BOM and strips it', async () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const content = Buffer.concat([bom, Buffer.from('hello\n')]);
  await withTempFile(content, async (path) => {
    const lines = [];
    for await (const line of readLines(path, { encoding: 'auto' })) {
      lines.push(line);
    }
    assert.deepEqual(lines, ['hello']);
  });
});

test('detects UTF-16LE with BOM', async () => {
  const bom = Buffer.from([0xff, 0xfe]);
  const text = 'hello\nworld\n';
  const content = Buffer.concat([bom, Buffer.from(text, 'utf16le')]);
  await withTempFile(content, async (path) => {
    const lines = [];
    for await (const line of readLines(path, { encoding: 'auto' })) {
      lines.push(line);
    }
    assert.deepEqual(lines, ['hello', 'world']);
  });
});

test('detects UTF-16BE with BOM', async () => {
  const bom = Buffer.from([0xfe, 0xff]);
  const text = 'hello\nworld\n';
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  const content = Buffer.concat([bom, be]);
  await withTempFile(content, async (path) => {
    const lines = [];
    for await (const line of readLines(path, { encoding: 'auto' })) {
      lines.push(line);
    }
    assert.deepEqual(lines, ['hello', 'world']);
  });
});

test('detectEncoding returns utf8 for plain ASCII', async () => {
  await withTempFile('hello', async (path) => {
    const enc = await detectEncoding(path);
    assert.equal(enc, 'utf8');
  });
});

test('throws on unsupported encoding', async () => {
  await withTempFile('hello', async (path) => {
    await assert.rejects(async () => {
      for await (const _ of readLines(path, { encoding: 'latin1' })) {}
    }, /Unsupported encoding/);
  });
});

test('handles empty file', async () => {
  await withTempFile('', async (path) => {
    const lines = [];
    for await (const line of readLines(path)) {
      lines.push(line);
    }
    assert.deepEqual(lines, []);
  });
});

test('handles file with only newline', async () => {
  await withTempFile('\n', async (path) => {
    const lines = [];
    for await (const line of readLines(path)) {
      lines.push(line);
    }
    assert.deepEqual(lines, ['']);
  });
});

test('handles multi-byte UTF-8 characters split across chunks', async () => {
  // Use a small buffer to force splitting inside a multi-byte character.
  const text = 'a\u00e9\u20ac\nb\n'; // e-acute and euro sign
  await withTempFile(Buffer.from(text, 'utf8'), async (path) => {
    const lines = [];
    for await (const line of readLines(path, { bufferSize: 1 })) {
      lines.push(line);
    }
    assert.deepEqual(lines, ['a\u00e9\u20ac', 'b']);
  });
});

# text-file-line

Reads files line by line as an async iterator with configurable buffering and encoding detection.

```js
import { readLines } from 'text-file-line';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const path = join(tmpdir(), 'text-file-line-example.txt');
await writeFile(path, 'hello\nworld\n');

for await (const line of readLines(path, { bufferSize: 8192, encoding: 'auto' })) {
  console.log(line);
}

await unlink(path);
```

The library exports `readLines(filePath, options)` and `detectEncoding(filePath)`.

`readLines` returns an async generator that yields each line without the trailing newline. It handles `\n`, `\r\n`, and `\r` line endings. The `bufferSize` option controls the size of each read from disk (default 16384 bytes). The `encoding` option accepts `'utf8'`, `'utf16le'`, `'utf16be'`, or `'auto'` (default `'utf8'`). When `'auto'` is used, the file is checked for a BOM; if none is found, UTF-8 is assumed.

`detectEncoding` is an async function that returns `'utf8'`, `'utf16le'`, or `'utf16be'` based on the BOM. If no BOM is present, it returns `'utf8'`.

## Why this exists

Node's `readline` module works with streams, but it does not handle encoding detection or byte-level buffering for UTF-16. This library provides a minimal async iterator that reads files directly with a configurable buffer size and automatic BOM detection. The trade-off is that it only supports UTF-8 and UTF-16 (LE and BE) encodings; other encodings would require a dependency or a full encoding library, which we avoid to keep the package dependency-free.

## Edge cases

- A file with a trailing newline does not produce an extra empty line at the end.
- A file that is completely empty yields no lines.
- A file containing only a newline yields a single empty string.
- Multi-byte UTF-8 characters split across buffer boundaries are handled correctly.
- UTF-16BE is supported by manually swapping bytes to little-endian before decoding, since Node's `StringDecoder` does not support big-endian UTF-16.
- An odd number of bytes at the end of a UTF-16BE file is silently dropped, as it cannot form a complete code unit.

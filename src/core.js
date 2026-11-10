import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

/**
 * Reads a file line by line as an async iterator.
 *
 * @param {string} filePath - Path to the file to read.
 * @param {object} [options] - Configuration options.
 * @param {number} [options.bufferSize=16384] - Size of the read buffer in bytes.
 * @param {string} [options.encoding='utf8'] - Encoding to use. If 'auto', attempts to detect
 *   UTF-8 BOM or falls back to UTF-8. Only UTF-8 and UTF-16LE with BOM are detected.
 * @yields {string} Each line, without the trailing newline (\n, \r\n, or \r).
 * @returns {AsyncGenerator<string>}
 */
export async function* readLines(filePath, options = {}) {
  const bufferSize = options.bufferSize ?? 16384;
  let encoding = options.encoding ?? 'utf8';

  if (encoding === 'auto') {
    encoding = await detectEncoding(filePath);
  }

  // Normalize encoding names for StringDecoder.
  const normalized = encoding.toLowerCase().replace(/[-_]/g, '');
  if (normalized !== 'utf8' && normalized !== 'utf16le' && normalized !== 'utf16be') {
    throw new Error(`Unsupported encoding: ${encoding}`);
  }

  // For UTF-16BE, Node's StringDecoder does not support it directly. We read raw bytes
  // and swap byte order to little-endian before decoding. This is a deliberate trade-off:
  // supporting UTF-16BE without a dependency requires manual byte swapping.
  const isUtf16be = normalized === 'utf16be';
  const bomLength = isUtf16be ? 2 : (normalized === 'utf16le' ? 2 : 3);
  const hasBom = normalized === 'utf16be' || normalized === 'utf16le' || normalized === 'utf8';

  const stream = createReadStream(filePath, { highWaterMark: bufferSize });
  const decoder = isUtf16be ? null : new StringDecoder(normalized === 'utf16le' ? 'utf16le' : 'utf8');

  let buffer = '';
  let leftoverBytes = Buffer.alloc(0);
  let isFirstChunk = true;

  for await (const chunk of stream) {
    let bytes = chunk;
    if (isFirstChunk) {
      isFirstChunk = false;
      if (normalized === 'utf8' && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        bytes = bytes.subarray(3);
      } else if (normalized === 'utf16le' && bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        bytes = bytes.subarray(2);
      } else if (normalized === 'utf16be' && bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        bytes = bytes.subarray(2);
      }
    }

    let text;
    if (isUtf16be) {
      // Ensure we have an even number of bytes for UTF-16 code units.
      const combined = Buffer.concat([leftoverBytes, bytes]);
      const evenLength = combined.length - (combined.length % 2);
      leftoverBytes = combined.subarray(evenLength);
      const evenBytes = combined.subarray(0, evenLength);
      // Swap bytes to convert BE to LE.
      for (let i = 0; i < evenBytes.length; i += 2) {
        const tmp = evenBytes[i];
        evenBytes[i] = evenBytes[i + 1];
        evenBytes[i + 1] = tmp;
      }
      text = evenBytes.toString('utf16le');
    } else {
      text = decoder.write(bytes);
    }

    buffer += text;

    let lineStart = 0;
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch === '\n' || ch === '\r') {
        let line = buffer.slice(lineStart, i);
        // Handle \r\n as a single line break.
        if (ch === '\r' && buffer[i + 1] === '\n') {
          i++;
        }
        lineStart = i + 1;
        yield line;
      }
    }
    buffer = buffer.slice(lineStart);
  }

  // Flush any remaining bytes from the decoder.
  if (isUtf16be) {
    if (leftoverBytes.length > 0) {
      // Odd number of bytes at end: treat as an error or ignore? We ignore and drop.
      // This is a deliberate choice: incomplete UTF-16 code unit is not valid text.
    }
  } else {
    buffer += decoder.end();
  }

  // Yield the last line if there is any content left (no trailing newline).
  if (buffer.length > 0) {
    yield buffer;
  }
}

/**
 * Detects the encoding of a file by checking for a BOM.
 * Only UTF-8 and UTF-16LE BOMs are recognized. If no BOM is found, defaults to 'utf8'.
 *
 * @param {string} filePath - Path to the file.
 * @returns {Promise<string>} 'utf8' or 'utf16le'.
 */
export async function detectEncoding(filePath) {
  const stream = createReadStream(filePath, { highWaterMark: 4 });
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length >= 4) break;
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf8';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf16le';
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf16be';
  }
  return 'utf8';
}

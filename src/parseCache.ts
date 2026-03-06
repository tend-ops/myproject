/**
 * 解析结果缓存：基于文件内容哈希，仅在增量变化时重新解析，降低重复计算开销。
 */

import * as crypto from 'crypto';
import { CodeIntermediateRepresentation } from './types';

export interface CachedParseEntry {
  hash: string;
  ir: CodeIntermediateRepresentation;
  timestamp: number;
}

const cache = new Map<string, CachedParseEntry>();
const MAX_ENTRIES = 200;

function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function getCachedParse(uri: string, content: string): CodeIntermediateRepresentation | null {
  const hash = contentHash(content);
  const entry = cache.get(uri);
  if (entry && entry.hash === hash) {
    return entry.ir;
  }
  return null;
}

export function setCachedParse(uri: string, content: string, ir: CodeIntermediateRepresentation): void {
  const hash = contentHash(content);
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(uri, { hash, ir, timestamp: Date.now() });
}

export function invalidateUri(uri: string): void {
  cache.delete(uri);
}

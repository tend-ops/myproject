"use strict";
/**
 * 解析结果缓存：基于文件内容哈希，仅在增量变化时重新解析，降低重复计算开销。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedParse = getCachedParse;
exports.setCachedParse = setCachedParse;
exports.invalidateUri = invalidateUri;
const crypto = __importStar(require("crypto"));
const cache = new Map();
const MAX_ENTRIES = 200;
function contentHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}
function getCachedParse(uri, content) {
    const hash = contentHash(content);
    const entry = cache.get(uri);
    if (entry && entry.hash === hash) {
        return entry.ir;
    }
    return null;
}
function setCachedParse(uri, content, ir) {
    const hash = contentHash(content);
    if (cache.size >= MAX_ENTRIES) {
        const firstKey = cache.keys().next().value;
        if (firstKey)
            cache.delete(firstKey);
    }
    cache.set(uri, { hash, ir, timestamp: Date.now() });
}
function invalidateUri(uri) {
    cache.delete(uri);
}
//# sourceMappingURL=parseCache.js.map
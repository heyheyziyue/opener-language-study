// test-translate.mjs — 直接测 /api/translate 的 LLM 翻译功能
// 用法：
//   MINIMAX_API_KEY=你的key node test-translate.mjs
//
// 这个脚本 import api/translate.js 的 onRequestPost，直接传 mock request 对象。
// 跑通就说明后端翻译接口 OK，可以部署 EdgeOne 联调前端。

import { onRequestPost, onRequestOptions } from './api/translate.js';

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) {
  console.error('❌ 没设环境变量 MINIMAX_API_KEY');
  console.error('   用法: MINIMAX_API_KEY=你的key node test-translate.mjs');
  process.exit(1);
}

// 模拟 EdgeOne Pages 的 request + env 对象
function makeMockRequest(body) {
  return {
    json: async () => body,
  };
}

const env = { MINIMAX_API_KEY: apiKey };

// ===== 测试 1：批量翻译（8 行真实说唱歌词） =====
console.log('━'.repeat(50));
console.log('⏳ Test 1: 批量翻译 8 行说唱歌词');
console.log('━'.repeat(50));

const sampleLyrics = [
  '[Intro]',
  '[Verse]',
  'Walk into the cafe door',
  'See the menu, want some more',
  'So many choices, what to say?',
  'Need to learn this today',
  '[Pre-Chorus]',
  'Got my coffee, feeling right',
];

const t0 = Date.now();
try {
  const res = await onRequestPost({
    request: makeMockRequest({ lines: sampleLyrics }),
    env,
  });
  const status = res.status;
  const data = await res.json();
  console.log(`   HTTP 状态: ${status}`);
  console.log(`   耗时: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  console.log('');

  if (status !== 200) {
    console.error('❌ 失败:', data);
    process.exit(1);
  }

  if (!Array.isArray(data.translations) || data.translations.length !== sampleLyrics.length) {
    console.error('❌ 响应 translations 数量不对');
    console.error('   期望:', sampleLyrics.length);
    console.error('   实际:', data.translations?.length);
    process.exit(1);
  }

  console.log('   原文 → 翻译：');
  sampleLyrics.forEach((line, i) => {
    console.log(`   ${(i + 1).toString().padStart(2)}. ${line}`);
    console.log(`      → ${data.translations[i]}`);
  });
  console.log('');
  console.log('✅ Test 1 通过');
} catch (e) {
  console.error('❌ Test 1 异常:', e.message);
  process.exit(1);
}

// ===== 测试 2：空数组（应该返回 400） =====
console.log('━'.repeat(50));
console.log('⏳ Test 2: 空数组（应返回 400）');
console.log('━'.repeat(50));
try {
  const res = await onRequestPost({
    request: makeMockRequest({ lines: [] }),
    env,
  });
  const data = await res.json();
  if (res.status === 400 && data.error) {
    console.log(`   ✅ 正确返回 400: ${data.error}`);
  } else {
    console.error(`   ❌ 期望 400，实际 ${res.status}:`, data);
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Test 2 异常:', e.message);
  process.exit(1);
}

// ===== Test 3: OPTIONS 预检 =====
console.log('━'.repeat(50));
console.log('⏳ Test 3: OPTIONS 预检（应返回 204 + CORS 头）');
console.log('━'.repeat(50));
try {
  const res = await onRequestOptions();
  if (res.status === 204 && res.headers.get('Access-Control-Allow-Origin')) {
    console.log('   ✅ CORS 头正确');
    console.log('   Allow-Origin:', res.headers.get('Access-Control-Allow-Origin'));
  } else {
    console.error('   ❌ OPTIONS 响应不对');
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Test 3 异常:', e.message);
  process.exit(1);
}

console.log('');
console.log('🎉 全部通过！可以部署到 EdgeOne 联调前端。');

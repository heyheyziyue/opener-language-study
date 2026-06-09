// test-api.mjs — 直接测 MiniMax API（不通过 EdgeOne）
// 用法：
//   MINIMAX_API_KEY=你的key node test-api.mjs
//   MINIMAX_API_KEY=你的key node test-api.mjs "我想学咖啡店点单"
//
// 这个脚本直接调用 edge-functions/lib/MiniMax.js 里写的封装，
// 跑通就说明 backend 集成没问题。EdgeOne 部署是另一坨，跟代码逻辑无关。

import { generateLyrics, generateMusic } from './lib/MiniMax.js';

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) {
  console.error('❌ 没设环境变量 MINIMAX_API_KEY');
  console.error('   用法: MINIMAX_API_KEY=你的key node test-api.mjs "主题"');
  process.exit(1);
}

const userInput = process.argv[2] || '我想学咖啡店点单';
console.log('📝 测试输入:', JSON.stringify(userInput));
console.log('');

// ===== Step 1: 歌词端点 =====
console.log('⏳ Step 1/2  调 /v1/lyrics_generation ...');
const t1 = Date.now();
let lyrics;
try {
  lyrics = await generateLyrics({
    prompt: `An English song about: ${userInput}`,
    apiKey,
    timeoutMs: 30_000,
  });
  console.log(`✅ 歌词成功 (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  console.log('   song_title :', lyrics.songTitle);
  console.log('   style_tags :', lyrics.styleTags);
  console.log('   lyrics 长度:', lyrics.lyrics.length, '字符');
  console.log('   lyrics 预览（前 200 字符）:');
  console.log('   ┌' + '─'.repeat(40));
  console.log('   │ ' + lyrics.lyrics.slice(0, 200).replace(/\n/g, '\n   │ '));
  console.log('   └' + '─'.repeat(40));
} catch (e) {
  console.error('❌ 歌词失败:', e.message);
  console.error('   HTTP 状态码:', e.statusCode);
  console.error('   MiniMax code:', e.apiCode);
  process.exit(1);
}
console.log('');

// ===== Step 2: music-2.6 =====
console.log('⏳ Step 2/2  调 /v1/music_generation ...');
console.log('   （这步可能 30-90 秒，请耐心等）');
const t2 = Date.now();
let music;
try {
  music = await generateMusic({
    lyrics: lyrics.lyrics,
    style: lyrics.styleTags || 'Pop, Feel-good',
    apiKey,
    timeoutMs: 120_000,
  });
  console.log(`✅ 音乐成功 (${((Date.now() - t2) / 1000).toFixed(1)}s)`);
  console.log('   audioUrl  :', music.audioUrl);
  console.log('   时长      :', music.durationMs, 'ms =',
              (music.durationMs / 1000).toFixed(1), '秒');
  console.log('   采样率    :', music.sampleRate, 'Hz');
  console.log('   比特率    :', music.bitrate, 'bps');
  console.log('   文件大小  :', (music.sizeBytes / 1024).toFixed(1), 'KB');
  console.log('   声道      :', music.channels);
} catch (e) {
  console.error('❌ 音乐失败:', e.message);
  console.error('   HTTP 状态码:', e.statusCode);
  console.error('   MiniMax code:', e.apiCode);
  process.exit(1);
}

console.log('');
console.log('🎉 全部通过！后端集成 OK，可以去部署 EdgeOne 了。');

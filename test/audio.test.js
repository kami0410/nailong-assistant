'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function setup(playResult) {
  const players = [];
  class Audio {
    constructor(url) { this.src = url; this.paused = true; players.push(this); }
    play() { this.paused = false; return playResult ? playResult() : Promise.resolve(); }
    pause() { this.paused = true; }
    addEventListener(name, fn) { this[name] = fn; }
  }
  const sandbox = { Audio, console };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'renderer/audio.js'), 'utf8'), sandbox);
  return { A: sandbox.WidgetAudio, players };
}
test('reminders and interaction events retain the original laugh WAV', () => {
  const { A, players } = setup();
  for (const name of ['remind', 'pre', 'happy', 'coin', 'timerEnd', 'alarm', 'focusDone', 'breakDone', 'click', 'error']) {
    A.play(name);
    assert.equal(players.at(-1).src, '../assets/sounds/laugh.wav', name);
    players.at(-1).ended();
  }
  assert.equal(players.length, 10);
});
test('repeated alarm or reminder events do not overlap laughs', () => {
  const { A, players } = setup();
  A.play('happy'); A.play('alarm'); A.play('remind');
  assert.equal(players.length, 1);
  players[0].ended(); A.play('coin');
  assert.equal(players.length, 2);
});
test('catch success restarts the laugh even when the opening laugh is still playing, and respects mute', () => {
  const { A, players } = setup();
  A.play('happy');
  assert.equal(A.play('catchWin'), true);
  assert.equal(players.length, 2);
  assert.equal(players[0].paused, true);
  assert.equal(players[1].src, '../assets/sounds/laugh.wav');
  A.setEnabled(false);
  assert.equal(players[1].paused, true);
  assert.equal(A.play('catchWin'), false);
  assert.equal(players.length, 2);
});
test('turning sound off immediately stops playback and suppresses further events', () => {
  const { A, players } = setup();
  A.play('happy'); A.setEnabled(false);
  assert.equal(players[0].paused, true);
  assert.equal(players[0].currentTime, 0);
  assert.equal(A.play('alarm'), false);
  assert.equal(players.length, 1);
});
test('a rejected or missing sound file produces no synthesized or system sound', async () => {
  const { A } = setup(() => Promise.reject(new Error('fixture audio unavailable')));
  let fallback = 0;
  if (A.setNativeFallback) A.setNativeFallback(() => fallback++);
  A.play('happy');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fallback, 0);
  assert.ok(A.errors.length > 0);
});
test('the reminder asset is valid uncompressed PCM WAV', () => {
  const b = fs.readFileSync(path.join(root, 'assets/sounds/laugh.wav'));
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  const fmt = b.indexOf('fmt ');
  assert.ok(fmt > 0 && b.indexOf('data') > 0);
  assert.equal(b.readUInt16LE(fmt + 8), 1);
  assert.ok(b.readUInt16LE(fmt + 10) >= 1 && b.readUInt16LE(fmt + 10) <= 2);
});
test('native notifications are silent and the legacy audio endpoint uses only laugh.wav', () => {
  const host = fs.readFileSync(path.join(root, 'src/main/host.js'), 'utf8');
  const native = fs.readFileSync(path.join(root, 'native/win.ps1'), 'utf8');
  assert.match(host, /silent: true/);
  assert.match(host, /laugh\.wav/);
  assert.doesNotMatch(native, /SystemSounds|Console\]::Beep/);
});

test('startup and assistant use the supplied MP3; disabling audio stops it and reminders keep priority', () => {
  const { A, players } = setup();
  assert.equal(A.play('startup'), true);
  assert.equal(players[0].src, '../assets/sounds/andy.mp3');
  assert.equal(A.play('assistantOpen'), false);
  A.play('remind');
  assert.equal(players[0].paused, true);
  assert.equal(players[1].src, '../assets/sounds/laugh.wav');
  A.setEnabled(false);
  assert.equal(players[1].paused, true);
  assert.equal(A.play('assistantOpen'), false);
});

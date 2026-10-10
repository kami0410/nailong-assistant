/* 提醒使用大笑；启动和打开助手使用用户提供的安迪。失败时保持安静。 */
(function (root) {
  'use strict';
  var enabled = true;
  var player = null;
  var errors = [];
  var played = [];
  var file = '../assets/sounds/laugh.wav';
  var activeName = '';
  var welcomedAt = -Infinity;
  var names = ['remind', 'pre', 'happy', 'catchWin', 'coin', 'timerEnd', 'alarm', 'focusDone', 'breakDone', 'click', 'error'];
  var sequences = {};
  names.forEach(function (name) { sequences[name] = { file: file }; });
  sequences.startup = sequences.assistantOpen = { file: '../assets/sounds/andy.mp3' };
  function record(e) {
    errors.push('音频播放失败：' + String(e && e.message || e));
    if (errors.length > 20) errors.shift();
  }
  function stop() {
    var a = player;
    player = null; activeName = '';
    if (a) { try { a.pause(); a.currentTime = 0; } catch (e) { record(e); } }
  }
  function play(name, scale) {
    if (!enabled || !sequences[name]) return false;
    var welcome = name === 'startup' || name === 'assistantOpen';
    if (welcome && Date.now() - welcomedAt < 2500) return false;
    if (player) {
      if (name === 'catchWin' || (!welcome && (activeName === 'startup' || activeName === 'assistantOpen'))) stop();
      else return false;
    }
    try {
      var a = new root.Audio(sequences[name].file);
      player = a; activeName = name;
      if (welcome) welcomedAt = Date.now();
      a.volume = Math.max(0, Math.min(1, 0.9 * (scale === undefined ? 1 : Number(scale) || 0)));
      var clear = function () { if (player === a) player = null; };
      a.addEventListener('playing', function () { played.push(name); if (played.length > 20) played.shift(); });
      a.addEventListener('ended', clear);
      a.addEventListener('error', function () { record('素材无法加载，请检查输出设备或文件'); clear(); });
      var p = a.play();
      if (p && p.catch) p.catch(function (e) { record(e); clear(); });
      return true;
    } catch (e) { player = null; record(e); return false; }
  }
  root.WidgetAudio = {
    SEQUENCES: sequences,
    play: play,
    // 旧调用兼容；提醒仍映射为大笑。
    playSynth: play,
    stop: stop,
    unlock: function () { return typeof root.Audio === 'function'; },
    setEnabled: function (v) { enabled = !!v; if (!enabled) stop(); return enabled; },
    isEnabled: function () { return enabled; },
    probe: function () { return { htmlAudio: typeof root.Audio === 'function', playing: !!player, enabled: enabled, scene: activeName, played: played.slice(), errors: errors.slice() }; },
    get errors() { return errors.slice(); }
  };
})(typeof window !== 'undefined' ? window : this);

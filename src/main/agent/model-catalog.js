'use strict';
// 接口的模型目录。能力来自用户声明，未知模型不按名称猜测。
function normalize(list) {
  if (!Array.isArray(list) || list.length > 500) throw new Error('模型目录最多允许 500 个模型');
  const seen = new Set();
  return list.map(item => {
    const m = typeof item === 'string' ? { id: item } : item || {};
    const id = String(m.id || '').trim();
    if (!id || id.length > 200 || /[\r\n\x00]/.test(id) || seen.has(id)) throw new Error('模型名称为空、重复或格式无效');
    seen.add(id);
    const contextWindow = Number(m.contextWindow || 128000);
    const maxTokens = Number(m.maxTokens || 4096);
    if (!Number.isInteger(contextWindow) || contextWindow < 1024 || contextWindow > 2000000) throw new Error('上下文窗口必须为 1024–2000000');
    if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 1048576 || maxTokens > contextWindow) throw new Error('输出上限必须为 256–1048576，且不超过上下文窗口');
    const allowed = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    const thinkingLevels = Array.isArray(m.thinkingLevels) ? allowed.filter(level => m.thinkingLevels.includes(level)) : ['off', 'minimal', 'low', 'medium', 'high'];
    const thinkingFormat = m.thinkingFormat === 'deepseek' ? 'deepseek' : 'standard';
    return { thinkingLevels, thinkingFormat, id, name: String(m.name || id).slice(0, 200), reasoning: m.reasoning === true, vision: m.vision !== false, contextWindow, maxTokens };
  });
}
function fromConfig(cfg) {
  const list = normalize(cfg.modelCatalog || []);
  if (cfg.model && !list.some(m => m.id === cfg.model)) list.unshift({ id: cfg.model, name: cfg.model, reasoning: false, vision: true, contextWindow: cfg.contextWindow || 128000, maxTokens: cfg.maxTokens || 4096 });
  return list;
}
function discover(list, baseUrl) {
  let deepseek = false;
  try { deepseek = new URL(baseUrl).hostname === 'api.deepseek.com'; } catch (_) { /* gateway unknown */ }
  return normalize(list.map(m => {
    const levels = m.effort && m.effort.supported_levels;
    return { id: m.id, name: m.name, reasoning: m.reasoning === true || Array.isArray(levels) && levels.length > 0,
      vision: Array.isArray(m.input_modalities) ? m.input_modalities.includes('image') : Array.isArray(m.input) && m.input.includes('image'),
      contextWindow: m.context_window || m.contextWindow || 128000,
      maxTokens: m.max_output_tokens || m.maxTokens || 4096,
      thinkingLevels: Array.isArray(levels) ? ['off', ...levels] : undefined,
      thinkingFormat: deepseek ? 'deepseek' : 'standard' };
  }));
}
module.exports = { normalize, fromConfig, discover };

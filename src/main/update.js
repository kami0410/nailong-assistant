'use strict';
/* 版本比较与更新资产挑选（纯函数，方便单测） */

/** a<b 返回 -1，相等 0，a>b 返回 1；只比前三段数字 */
function compareVersion(a, b) {
  const pa = String(a || '0').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/**
 * 从 GitHub release 里挑一个能直接下载的安装包：
 * 优先免安装版（portable），其次任意 exe，再其次 zip。
 * @returns {{url:string,name:string}}
 */
function pickUpdateAsset(release) {
  const assets = (release && Array.isArray(release.assets)) ? release.assets : [];
  const usable = assets.filter((x) => x && x.browser_download_url && x.name);
  const find = (re) => usable.find((x) => re.test(String(x.name)));
  const hit = find(/portable\.exe$/i) || find(/\.exe$/i) || find(/\.zip$/i);
  if (!hit) return { url: '', name: '' };
  return { url: String(hit.browser_download_url), name: String(hit.name) };
}

/** release → 给界面看的一份摘要 */
function summarizeRelease(release, current) {
  const latest = String((release && (release.tag_name || release.name)) || '').replace(/^v/, '');
  const asset = pickUpdateAsset(release);
  return {
    current: current,
    latest: latest,
    hasUpdate: latest ? compareVersion(latest, current) > 0 : false,
    url: (release && release.html_url) || '',
    assetUrl: asset.url,
    assetName: asset.name,
    notes: String((release && release.body) || '').slice(0, 800)
  };
}

module.exports = { compareVersion, pickUpdateAsset, summarizeRelease };

/* ai-jiegua.js — shared "AI 解读" button for Daotianji tool pages.
 *
 * Each tool page adds:
 *   <button id="ai-interpret-btn" class="ai-interpret-btn"
 *           data-tool="<slug>" data-i18n="ai_interpret">AI 解读</button>
 *   <div id="ai-interpret-output"></div>
 *   <script src="/js/ai-jiegua.js"></script>
 * and defines window.getJieguaSummary() -> plain-text result summary (or null
 * if no result yet) and optionally window.getJieguaQuestion() -> question text.
 * Then it calls: if (window.AIInterpret) window.AIInterpret.attach();
 *
 * The button posts {tool, summary, question, lang} to /api/jiegua and renders
 * the returned interpretation in a styled card. Language comes from
 * localStorage 'daotianji-lang' (default zh-CN). No API key here, no external
 * requests except the same-origin /api/jiegua call.
 *
 * Daily-use hint: localStorage 'daotianji-ai-used' stores a JSON count for
 * today, e.g. {"d":"2026-11-26","n":2}. DAILY_LIMIT (5) matches the backend
 * per-IP daily limit. The button shows how many uses remain today, and
 * "今日已用" only when the count reaches the limit. This is only a soft UX
 * hint — the backend enforces the real per-IP daily limit. Old format (a
 * plain date string) is read as count 1 for that date.
 */
(function () {
  'use strict';

  var LANGS = ['zh-CN', 'zh-TW', 'en', 'ja'];
  var USED_KEY = 'daotianji-ai-used';
  var DAILY_LIMIT = 5;

  var MSG = {
    loading: {
      'zh-CN': 'AI 解读中，请稍候…',
      'zh-TW': 'AI 解讀中，請稍候…',
      'en': 'AI is reading…',
      'ja': 'AI が解釈中です…'
    },
    noResult: {
      'zh-CN': '请先起卦或排盘，再点 AI 解读。',
      'zh-TW': '請先起卦或排盤，再點 AI 解讀。',
      'en': 'Please cast or calculate first, then tap AI Reading.',
      'ja': '先に占いを実行してから、AI 解釈を押してください。'
    },
    netError: {
      'zh-CN': '网络或服务异常，请稍后再试。',
      'zh-TW': '網絡或服務異常，請稍後再試。',
      'en': 'Network or service error. Please try again later.',
      'ja': 'ネットワークまたはサービスのエラーです。後でもう一度お試しください。'
    },
    dailyCap: {
      'zh-CN': '今日免费 AI 解读已用完，请明天再试。',
      'zh-TW': '今日免費 AI 解讀已用完，請明天再試。',
      'en': "Today's free AI reading is used up. Please try again tomorrow.",
      'ja': '本日の無料 AI 解釈は終了しました。明日もう一度お試しください。'
    },
    rateLimit: {
      'zh-CN': '请求太频繁，请稍后再试。',
      'zh-TW': '請求太頻繁，請稍後再試。',
      'en': 'Too many requests. Please try again shortly.',
      'ja': 'リクエストが多すぎます。しばらくしてからお試しください。'
    },
    usedToday: {
      'zh-CN': '今日已用',
      'zh-TW': '今日已用',
      'en': 'Used today',
      'ja': '本日使用済み'
    },
    remaining: {
      'zh-CN': 'AI 解读（今日还剩 {n} 次）',
      'zh-TW': 'AI 解讀（今日還剩 {n} 次）',
      'en': 'AI Reading ({n} left today)',
      'ja': 'AI 解釈（本日あと {n} 回）'
    },
    cardTitle: {
      'zh-CN': 'AI 解读',
      'zh-TW': 'AI 解讀',
      'en': 'AI Reading',
      'ja': 'AI 解釈'
    },
    disclaimer: {
      'zh-CN': 'AI 解读仅供参考。',
      'zh-TW': 'AI 解讀僅供參考。',
      'en': 'AI readings are for reference only.',
      'ja': 'AI 解釈は参考までです。'
    }
  };

  function lang() {
    try {
      var l = localStorage.getItem('daotianji-lang');
      if (LANGS.indexOf(l) !== -1) return l;
    } catch (e) {}
    return 'zh-CN';
  }

  function t(key) {
    var l = lang();
    return (MSG[key] && MSG[key][l]) || MSG[key]['zh-CN'];
  }

  function todayStr() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function getUsage() {
    try {
      var raw = localStorage.getItem(USED_KEY);
      if (!raw) return { date: todayStr(), count: 0 };
      var obj = null;
      try { obj = JSON.parse(raw); } catch (e) { obj = null; }
      if (obj && typeof obj === 'object' && typeof obj.n === 'number') {
        if (obj.d === todayStr()) return { date: obj.d, count: obj.n };
        return { date: todayStr(), count: 0 };
      }
      // Old format: plain date string means used once on that date.
      if (raw === todayStr()) return { date: raw, count: 1 };
      return { date: todayStr(), count: 0 };
    } catch (e) {
      return { date: todayStr(), count: 0 };
    }
  }

  function usedCount() {
    return getUsage().count;
  }

  function remainingCount() {
    var r = DAILY_LIMIT - usedCount();
    return r < 0 ? 0 : r;
  }

  function markUsed() {
    try {
      var u = getUsage();
      localStorage.setItem(USED_KEY, JSON.stringify({ d: u.date, n: u.count + 1 }));
    } catch (e) {}
  }

  function usedToday() {
    return usedCount() >= DAILY_LIMIT;
  }

  function applyUsedLabel(btn) {
    var n = remainingCount();
    if (n <= 0) {
      if (btn.textContent !== t('usedToday')) btn.textContent = t('usedToday');
    } else if (usedCount() > 0) {
      var label = t('remaining').replace('{n}', String(n));
      if (btn.textContent !== label) btn.textContent = label;
    }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderInterpretation(text) {
    var paras = String(text).split(/\n\s*\n/).filter(function (p) { return p.trim(); });
    if (!paras.length) paras = [String(text)];
    var html = paras.map(function (p) {
      return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
    return html;
  }

  function injectStyle() {
    if (document.getElementById('ai-jiegua-style')) return;
    var st = document.createElement('style');
    st.id = 'ai-jiegua-style';
    st.textContent =
      '.ai-interpret-btn{display:inline-block;background:transparent;color:#c9a962;' +
      'border:1px solid #c9a962;border-radius:999px;padding:10px 26px;font-size:15px;' +
      'letter-spacing:2px;cursor:pointer;font-family:inherit;margin:18px 0 0 0;}' +
      '.ai-interpret-btn:hover{background:rgba(201,169,98,.12);}' +
      '.ai-interpret-btn:disabled{opacity:.55;cursor:wait;}' +
      '.ai-interpret-card{margin-top:20px;border:1px solid rgba(201,169,98,.55);' +
      'border-radius:12px;padding:20px 22px;background:rgba(201,169,98,.06);' +
      'color:#e8e2d0;line-height:1.9;}' +
      '.ai-interpret-card h3{margin:0 0 10px 0;color:#c9a962;font-size:16px;' +
      'letter-spacing:3px;font-weight:600;}' +
      '.ai-interpret-card p{margin:0 0 10px 0;}' +
      '.ai-interpret-card .ai-disclaimer{margin:12px 0 0 0;font-size:12px;color:#9a958a;}';
    document.head.appendChild(st);
  }

  function showMessage(output, text) {
    output.innerHTML =
      '<div class="ai-interpret-card"><h3>' + esc(t('cardTitle')) + '</h3>' +
      '<p>' + esc(text) + '</p></div>';
  }

  function showInterpretation(output, text) {
    output.innerHTML =
      '<div class="ai-interpret-card"><h3>' + esc(t('cardTitle')) + '</h3>' +
      renderInterpretation(text) +
      '<p class="ai-disclaimer">' + esc(t('disclaimer')) + '</p></div>';
  }

  function mapServerError(errText) {
    if (!errText) return t('netError');
    if (errText.indexOf('已用完') !== -1) return t('dailyCap');
    if (errText.indexOf('太频繁') !== -1) return t('rateLimit');
    if (errText.indexOf('缺少占卜结果') !== -1) return t('noResult');
    return errText;
  }

  function attach(buttonId, outputId) {
    var btn = document.getElementById(buttonId || 'ai-interpret-btn');
    var output = document.getElementById(outputId || 'ai-interpret-output');
    if (!btn || !output || btn.dataset.aiAttached) return;
    btn.dataset.aiAttached = '1';
    injectStyle();

    // Soft daily-use hint: show remaining uses today, or "今日已用" at the limit.
    // Re-applied if the page's language switcher re-renders the label.
    applyUsedLabel(btn);
    if (typeof MutationObserver !== 'undefined') {
      var obs = new MutationObserver(function () {
        if (!btn.disabled) applyUsedLabel(btn);
      });
      obs.observe(btn, { childList: true, characterData: true, subtree: true });
    }

    btn.addEventListener('click', function () {
      if (usedToday()) {
        showMessage(output, t('dailyCap'));
        return;
      }
      var summary = null;
      try {
        if (typeof window.getJieguaSummary === 'function') {
          summary = window.getJieguaSummary();
        }
      } catch (e) { summary = null; }
      if (!summary || !String(summary).trim()) {
        showMessage(output, t('noResult'));
        return;
      }
      var question = '';
      try {
        if (typeof window.getJieguaQuestion === 'function') {
          question = window.getJieguaQuestion() || '';
        }
      } catch (e) { question = ''; }

      var tool = btn.getAttribute('data-tool') || '';
      var payload = {
        tool: tool,
        summary: String(summary).slice(0, 4000),
        question: String(question).slice(0, 500),
        lang: lang()
      };

      btn.disabled = true;
      var oldText = btn.textContent;
      btn.textContent = t('loading');
      showMessage(output, t('loading'));

      fetch('/api/jiegua', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (resp) {
        return resp.json().then(function (data) {
          return { status: resp.status, data: data };
        });
      }).then(function (res) {
        if (res.status === 200 && res.data && res.data.interpretation) {
          showInterpretation(output, res.data.interpretation);
          markUsed();
          applyUsedLabel(btn);
        } else {
          var msg = (res.data && res.data.error) ? mapServerError(res.data.error) : t('netError');
          showMessage(output, msg);
        }
      }).catch(function () {
        showMessage(output, t('netError'));
      }).finally(function () {
        btn.disabled = false;
        applyUsedLabel(btn);
        if (!usedToday() && usedCount() === 0) btn.textContent = oldText;
      });
    });
  }

  window.AIInterpret = { attach: attach };
})();

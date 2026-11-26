/* daotianji-location.js — 盗天机共用地点 / 时区模块（梅花易数、焦氏易林共用）
 *
 * 用途：时间起卦时，让用户选一个地点（或直接选时区），
 * 所填的起卦时间按该时区的当地挂钟时间解读，农历与时辰都按这个
 * 当地时间算。换时区不会重写已填好的时间。
 *
 * 隐私：本模块是本站唯一的例外联网点，且只在用户于地点栏输入时触发。
 * 发出的请求只带用户输入的地名（防抖约 300ms 后发一次），发往
 * Open-Meteo 免费地理编码服务（https://geocoding-api.open-meteo.com，
 * 无需密钥、无账号、无追踪）。不输入地名就不发任何请求；
 * 时区下拉、“此刻”按钮、农历换算全部离线完成。
 * 地点只是查时区的帮手：真正起作用的是时区下拉框的值，用户可随时手动改。
 *
 * 依赖：页面须提供 data-i18n 键 labelLocation / phLocation / locHint /
 * labelTimezone / locNoMatch / locError，并以 init({ getLang, t }) 传入
 * 当前语言与取词函数。元素 id 固定为 location-input / location-suggest /
 * location-status / timezone-select，时间输入框 id 默认为 datetime。
 */
(function () {
  'use strict';

  var API_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  var DEBOUNCE_MS = 300;

  // 仅在 Intl.supportedValuesOf 不可用（旧浏览器）时使用。
  var FALLBACK_ZONES = [
    'UTC', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Tokyo',
    'Asia/Seoul', 'Asia/Singapore', 'Asia/Bangkok', 'Asia/Kolkata',
    'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'Europe/Moscow', 'America/New_York', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'America/Toronto', 'America/Mexico_City',
    'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland'
  ];

  var cfg = null; // { getLang: fn, t: fn, datetimeInputId }
  var els = {};   // locationInput, suggest, status, tzSelect, datetimeInput
  var state = { timezone: '', placeName: '' };
  var debounceTimer = null;
  var lastQuery = '';

  function $(id) { return document.getElementById(id); }

  function browserTimeZone() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) return tz;
    } catch (e) {}
    return 'UTC';
  }

  function supportedZones() {
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        var list = Intl.supportedValuesOf('timeZone');
        if (list && list.length) return list;
      }
    } catch (e) {}
    return FALLBACK_ZONES.slice();
  }

  // Open-Meteo 支持的 language 值：页面语言只取 zh / en / ja，其余回落 en。
  function apiLang() {
    var lang = 'en';
    try { lang = (cfg && cfg.getLang ? cfg.getLang() : 'en') || 'en'; } catch (e) {}
    lang = String(lang).toLowerCase();
    if (lang.indexOf('zh') === 0) return 'zh';
    if (lang.indexOf('ja') === 0) return 'ja';
    return 'en';
  }

  function t(key) {
    try {
      if (cfg && cfg.t) { var s = cfg.t(key); if (s !== key) return s; }
    } catch (e) {}
    return key;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // "2026-11-25T14:30" -> { year, month, day, hour, minute }（挂钟时间分量，不转 UTC）
  function parseDatetimeLocal(v) {
    if (!v) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v));
    if (!m) return null;
    var p = {
      year: parseInt(m[1], 10), month: parseInt(m[2], 10),
      day: parseInt(m[3], 10), hour: parseInt(m[4], 10),
      minute: parseInt(m[5], 10)
    };
    if (p.month < 1 || p.month > 12 || p.day < 1 || p.day > 31 ||
        p.hour < 0 || p.hour > 23 || p.minute < 0 || p.minute > 59) return null;
    return p;
  }

  function partsToInputValue(p) {
    return p.year + '-' + pad(p.month) + '-' + pad(p.day) + 'T' + pad(p.hour) + ':' + pad(p.minute);
  }

  // 此刻在指定时区的挂钟时间（"YYYY-MM-DDTHH:mm"），纯 Intl 计算，离线。
  function nowWallTime(tz) {
    var zone = tz || getTimeZone();
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
      });
    } catch (e) {
      fmt = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
      });
    }
    var parts = {};
    var list = fmt.formatToParts(new Date());
    for (var i = 0; i < list.length; i++) parts[list[i].type] = list[i].value;
    var hour = parseInt(parts.hour, 10);
    if (hour === 24) hour = 0; // 个别环境的午夜会返回 24，归零处理
    return parts.year + '-' + parts.month + '-' + parts.day + 'T' + pad(hour) + ':' + parts.minute;
  }

  function getTimeZone() {
    return state.timezone || browserTimeZone();
  }

  function setStatus(msg) {
    if (els.status) els.status.textContent = msg || '';
  }

  function hideSuggest() {
    if (!els.suggest) return;
    els.suggest.innerHTML = '';
    els.suggest.classList.add('hidden');
  }

  function showSuggest(results) {
    if (!els.suggest) return;
    els.suggest.innerHTML = '';
    for (var i = 0; i < results.length; i++) {
      (function (r) {
        var btn = document.createElement('button');
        btn.type = 'button';
        var main = document.createElement('span');
        main.textContent = r.name || '';
        btn.appendChild(main);
        var sub = [];
        if (r.admin1) sub.push(r.admin1);
        if (r.country) sub.push(r.country);
        if (sub.length) {
          var small = document.createElement('small');
          small.textContent = sub.join(' · ');
          btn.appendChild(small);
        }
        btn.addEventListener('click', function () { pickPlace(r); });
        els.suggest.appendChild(btn);
      })(results[i]);
    }
    els.suggest.classList.remove('hidden');
  }

  function placeDisplayName(r) {
    var bits = [r.name];
    if (r.admin1) bits.push(r.admin1);
    if (r.country) bits.push(r.country);
    return bits.join('，');
  }

  function pickPlace(r) {
    if (!r || !r.timezone) return;
    state.timezone = r.timezone;
    state.placeName = placeDisplayName(r);
    if (els.locationInput) els.locationInput.value = state.placeName;
    if (els.tzSelect) {
      var found = false;
      for (var i = 0; i < els.tzSelect.options.length; i++) {
        if (els.tzSelect.options[i].value === r.timezone) { found = true; break; }
      }
      if (!found) {
        var opt = document.createElement('option');
        opt.value = r.timezone;
        opt.textContent = r.timezone;
        els.tzSelect.appendChild(opt);
      }
      els.tzSelect.value = r.timezone;
    }
    setStatus('');
    hideSuggest();
  }

  function searchPlaces(query) {
    if (!query) { hideSuggest(); setStatus(''); return; }
    var url = API_URL + '?name=' + encodeURIComponent(query) +
      '&count=5&format=json&language=' + apiLang();
    fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error('geocoding HTTP ' + resp.status);
      return resp.json();
    }).then(function (data) {
      if (query !== lastQuery) return; // 用户已改输入，丢弃过期结果
      var results = (data && data.results) || [];
      if (!results.length) {
        hideSuggest();
        setStatus(t('locNoMatch'));
        return;
      }
      setStatus('');
      showSuggest(results);
    }).catch(function () {
      if (query !== lastQuery) return;
      hideSuggest();
      setStatus(t('locError'));
    });
  }

  function onLocationInput() {
    var q = els.locationInput ? els.locationInput.value.trim() : '';
    lastQuery = q;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!q) { hideSuggest(); setStatus(''); return; }
    debounceTimer = setTimeout(function () { searchPlaces(q); }, DEBOUNCE_MS);
  }

  function populateTimezones() {
    if (!els.tzSelect) return;
    var zones = supportedZones();
    var current = state.timezone || browserTimeZone();
    els.tzSelect.innerHTML = '';
    for (var i = 0; i < zones.length; i++) {
      var opt = document.createElement('option');
      opt.value = zones[i];
      opt.textContent = zones[i];
      els.tzSelect.appendChild(opt);
    }
    if (zones.indexOf(current) === -1) {
      var extra = document.createElement('option');
      extra.value = current;
      extra.textContent = current;
      els.tzSelect.appendChild(extra);
    }
    els.tzSelect.value = current;
    state.timezone = current;
  }

  function fillNow() {
    if (!els.datetimeInput) return false;
    els.datetimeInput.value = nowWallTime(getTimeZone());
    return true;
  }

  // 语言切换后调用：重设地点输入框的占位提示与说明文字（其余 data-i18n 由页面自己刷）。
  function refresh() {
    if (els.locationInput) {
      var ph = t('phLocation');
      if (ph !== 'phLocation') els.locationInput.setAttribute('placeholder', ph);
    }
  }

  function init(opts) {
    cfg = opts || {};
    els.locationInput = $('location-input');
    els.suggest = $('location-suggest');
    els.status = $('location-status');
    els.tzSelect = $('timezone-select');
    els.datetimeInput = $(cfg.datetimeInputId || 'datetime');
    state.timezone = browserTimeZone();
    populateTimezones();
    if (els.locationInput) {
      els.locationInput.addEventListener('input', onLocationInput);
      els.locationInput.addEventListener('blur', function () {
        // 延迟隐藏，让候选按钮的 click 先触发
        setTimeout(hideSuggest, 200);
      });
      els.locationInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') hideSuggest();
      });
    }
    if (els.tzSelect) {
      els.tzSelect.addEventListener('change', function () {
        // 手动改时区是最终决定：只改时区，不重写已填的时间。
        state.timezone = els.tzSelect.value;
      });
    }
    refresh();
  }

  window.DaotianjiLocation = {
    init: init,
    refresh: refresh,
    getTimeZone: getTimeZone,
    getPlaceName: function () { return state.placeName; },
    parseDatetimeLocal: parseDatetimeLocal,
    partsToInputValue: partsToInputValue,
    nowWallTime: nowWallTime,
    fillNow: fillNow
  };
})();

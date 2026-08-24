/* CENTERFRIOS TV — engine imperativo (ES5 puro).
   Sem React, sem TanStack Router, sem re-render: todo o estado vive em
   variáveis de módulo e o DOM é atualizado apenas quando algo realmente muda.
   Compatível com Fire OS/Silk e WebKit legado de Smart TVs. */
(function () {
  "use strict";

  var SUPA_URL = "https://ovrgtfpcjowptktrtzir.supabase.co";
  var SUPA_KEY = "sb_publishable_crlEYmYyg709iLRqJate8w_2qemA7Xk";

  var K_ID = "cf_tv_id";
  var K_CODE = "cf_tv_code";
  var K_PL = "cf_playlist_cache";
  var K_UUID = "centerfrios_device_uuid";
  var K_NONCE = "cf_last_nonce";

  var TV_COLS = "id,name,is_paired,playlist_id,is_live_active,orientation,layout_mode,muted," +
    "ticker_text,qr_url,command,event_mode,volume,ticker_position,qr_position,media_fit," +
    "sponsors_enabled,countdown_label,countdown_ends_at,welcome_message,welcome_until," +
    "show_presence_qr,presence_qr_position,presence_logo_size";

  var POLL_MS = 5000;        // estado da TV
  var HEARTBEAT_MS = 45000;  // fire-and-forget, NUNCA lido de volta
  var LIVE_MS = 1000;
  var ALERT_MS = 6000;
  var SPOT_MS = 6000;
  var SPONSOR_MS = 60000;
  var CANPLAY_TIMEOUT = 6000;
  var STALL_MS = 6000;
  var FADE_MS = 400;

  /* ---------------- DOM ---------------- */
  function $(id) { return document.getElementById(id); }
  var rot = $("rot");
  var zone = $("zone");
  var vidA = $("media-a"), vidB = $("media-b");
  var imgA = $("img-a"), imgB = $("img-b");
  var liveImg = $("live-img"), liveTag = $("livetag");
  var tickerEl = $("ticker"), tickerText = $("ticker-text");
  var cornerEl = $("corner"), cornerQr = $("corner-qr");
  var sponsorsEl = $("sponsors"), sponsorsList = $("sponsors-list");
  var presenceEl = $("presence"), presenceQr = $("presence-qr");
  var cdEl = $("countdown"), cdLabel = $("cd-label"), cdValue = $("cd-value");
  var spotEl = $("spotlight"), spotImg = $("spot-img");
  var alertEl = $("alert"), alertMsg = $("alert-msg");
  var welcomeEl = $("welcome"), welcomeMsg = $("welcome-msg");
  var pairEl = $("pair"), pairCode = $("pair-code"), pairLbl = $("pair-lbl");
  var emptyEl = $("empty"), emptyMsg = $("empty-msg"), emptyCode = $("empty-code");
  var bootEl = $("boot"), bootMsg = $("boot-msg");
  var diagEl = $("diag");

  /* ---------------- estado (nunca reativo) ---------------- */
  var tvId = null;
  var pairingCode = "";
  var tv = null;              // última linha conhecida da TV
  var items = [];             // playlist resolvida
  var idx = 0;
  var token = 0;              // invalida callbacks de mídias antigas
  var playing = false;
  var isLive = false;
  var overlayBlocking = false; // alerta / boas-vindas / destaque cobrindo a mídia
  var activeVideo = vidA, idleVideo = vidB;
  var activeImg = imgA, idleImg = imgB;
  var preloadedVideoSrc = "";
  var timers = { item: null, stall: null, hard: null, canplay: null };
  var lastSignature = "";
  var lastTvSig = "";
  var lastAlertId = "";
  var alertHideAt = 0;
  var spotlight = null;
  var liveTimer = null;

  /* ---------------- utils ---------------- */
  function ls(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function showEl(el, on) { el.style.display = on ? "block" : "none"; }
  function clearTimer(name) { if (timers[name]) { clearTimeout(timers[name]); timers[name] = null; } }
  function clearAllTimers() { clearTimer("item"); clearTimer("stall"); clearTimer("hard"); clearTimer("canplay"); }
  function diag(msg) { diagEl.innerHTML = msg || ""; }

  function cookieGet(name) {
    try {
      var parts = String(document.cookie || "").split(";");
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].replace(/^\s+/, "");
        if (p.indexOf(name + "=") === 0) return decodeURIComponent(p.slice(name.length + 1));
      }
    } catch (e) {}
    return null;
  }
  function cookieSet(name, value) {
    try {
      document.cookie = name + "=" + encodeURIComponent(value) + ";path=/;max-age=315360000;SameSite=Lax";
    } catch (e) {}
  }
  function deviceUuid() {
    var u = ls(K_UUID) || cookieGet(K_UUID);
    if (!u || u.length < 8) {
      var s = "";
      for (var i = 0; i < 32; i++) s += "0123456789abcdef".charAt(Math.floor(Math.random() * 16));
      u = "dev-" + s + "-" + String(new Date().getTime());
    }
    lsSet(K_UUID, u); cookieSet(K_UUID, u);
    return u;
  }

  /* REST direto (sem SDK): fetch com fallback XHR. */
  function req(method, path, body, cb) {
    var url = SUPA_URL + path, done = false;
    function finish(err, data) { if (!done) { done = true; if (cb) cb(err, data); } }
    var headers = { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json" };
    if (typeof window.fetch === "function") {
      var opts = { method: method, headers: headers };
      if (body) opts.body = JSON.stringify(body);
      window.fetch(url, opts).then(function (r) {
        return r.text().then(function (t) { return { ok: r.ok, t: t }; });
      }).then(function (o) {
        var d = null;
        try { d = o.t ? JSON.parse(o.t) : null; } catch (e) { d = null; }
        finish(o.ok ? null : new Error("HTTP"), d);
      })["catch"](function (e) { finish(e, null); });
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    for (var h in headers) if (headers.hasOwnProperty(h)) xhr.setRequestHeader(h, headers[h]);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var d = null;
      try { d = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) { d = null; }
      finish(xhr.status >= 200 && xhr.status < 300 ? null : new Error("HTTP " + xhr.status), d);
    };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  function qrSrc(data, size) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=" + size + "x" + size +
      "&data=" + encodeURIComponent(data);
  }

  /* ---------------- telas de estado ---------------- */
  function screenMode(mode) {
    showEl(bootEl, mode === "boot");
    showEl(pairEl, mode === "pair");
    showEl(emptyEl, mode === "empty");
  }

  /* ---------------- boot / pareamento ---------------- */
  function boot() {
    screenMode("boot");
    var cachedId = ls(K_ID), cachedCode = ls(K_CODE);
    if (cachedId) tvId = cachedId;
    if (cachedCode) { pairingCode = cachedCode; pairCode.innerHTML = cachedCode; emptyCode.innerHTML = cachedCode; }

    var cache = ls(K_PL);
    if (cache) {
      try { var arr = JSON.parse(cache); if (arr && arr.length) items = arr; } catch (e) {}
    }

    // watchdog de boot: nunca ficar preso em "Sincronizando player…"
    setTimeout(function () {
      if (!playing && !isLive) screenMode(tvId ? "empty" : "pair");
    }, 5000);

    register(deviceUuid(), 0);
  }

  function register(uuid, attempt) {
    req("POST", "/rest/v1/rpc/register_tv_device", { p_device_uuid: uuid }, function (err, data) {
      if (!err && data && data.id && data.pairing_code) {
        tvId = data.id;
        pairingCode = data.pairing_code;
        lsSet(K_ID, data.id); lsSet(K_CODE, data.pairing_code);
        pairCode.innerHTML = data.pairing_code;
        emptyCode.innerHTML = data.pairing_code;
        pairLbl.innerHTML = "C&oacute;digo de pareamento desta TV";
        start();
        return;
      }
      if (tvId) { start(); return; } // já pareado antes: segue com cache
      var delays = [3000, 5000, 10000];
      var wait = delays[attempt < delays.length ? attempt : delays.length - 1];
      pairLbl.innerHTML = "Aguardando resposta da nuvem&hellip; revalidando em " + (wait / 1000) + "s";
      screenMode("pair");
      setTimeout(function () { register(uuid, attempt + 1); }, wait);
    });
  }

  var started = false;
  function start() {
    if (started) return;
    started = true;
    pollTv();
    heartbeat();
    setInterval(pollTv, POLL_MS);
    setInterval(heartbeat, HEARTBEAT_MS);
    setInterval(pollAlerts, ALERT_MS);
    setInterval(pollSpotlight, SPOT_MS);
    setInterval(loadSponsors, SPONSOR_MS);
    setInterval(tickClock, 1000);
    setInterval(dailyReload, 60000);
  }

  /* ---------------- heartbeat: fire-and-forget, jamais relido ---------------- */
  function heartbeat() {
    if (!tvId) return;
    var mem;
    try {
      var perf = window.performance;
      if (perf && perf.memory) mem = Math.round(perf.memory.usedJSHeapSize / 1048576) + " MB";
    } catch (e) {}
    req("POST", "/rest/v1/rpc/tv_heartbeat", {
      _id: tvId,
      _resolution: window.screen.width + "x" + window.screen.height,
      _memory: mem
    }, null);
  }

  function dailyReload() {
    var d = new Date();
    if (d.getHours() === 3 && d.getMinutes() === 0) window.location.reload();
  }

  /* ---------------- polling do estado da TV ---------------- */
  function pollTv() {
    if (!tvId) return;
    req("GET", "/rest/v1/tvs?id=eq." + tvId + "&select=" + TV_COLS, null, function (err, rows) {
      if (err || !rows || !rows.length) { diag("sem conexao"); return; }
      diag("");
      var row = rows[0];
      var prev = tv;
      tv = row;

      runCommand(row.command);

      // assinatura das opções visuais: aplica no DOM só quando muda de verdade
      var sig = [row.orientation, row.layout_mode, row.media_fit, row.ticker_position, row.ticker_text,
        row.qr_position, row.qr_url, row.muted, row.volume, row.sponsors_enabled,
        row.show_presence_qr, row.presence_qr_position, row.welcome_message, row.welcome_until,
        row.countdown_label, row.countdown_ends_at, row.presence_logo_size].join("|");
      if (sig !== lastTvSig) { lastTvSig = sig; applyLayout(row); }

      setLive(!!row.is_live_active);
      if (isLive) return;

      var structural = !prev || prev.playlist_id !== row.playlist_id ||
        prev.event_mode !== row.event_mode || prev.is_paired !== row.is_paired;

      if (!row.is_paired && !row.playlist_id && !row.event_mode) {
        stopPlayback();
        screenMode("pair");
        return;
      }
      if (structural) loadPlaylist(row.playlist_id, row.event_mode);
      else if (!playing && items.length) startLoop();
    });
  }

  function runCommand(cmd) {
    if (!cmd || !cmd.nonce) return;
    if (ls(K_NONCE) === cmd.nonce) return;
    lsSet(K_NONCE, cmd.nonce);
    if (cmd.action === "reload" || cmd.action === "purge") { window.location.reload(); return; }
    if (cmd.action === "sync") { lastSignature = ""; if (tv) loadPlaylist(tv.playlist_id, tv.event_mode); return; }
    if (cmd.action === "mute" || cmd.action === "unmute") {
      var m = cmd.action === "mute";
      vidA.muted = m; vidB.muted = m;
    }
  }

  /* ---------------- layout / overlays estáticos ---------------- */
  function applyLayout(row) {
    var portrait = row.orientation === "portrait";
    rot.className = portrait ? "portrait" : "";

    var fit = row.media_fit === "cover" ? "cover" : "contain";
    var mediaEls = [vidA, vidB, imgA, imgB, liveImg];
    for (var i = 0; i < mediaEls.length; i++) mediaEls[i].style.objectFit = fit;

    var multizone = row.layout_mode === "multizone";
    var tickerPos = row.ticker_position || "bottom";
    var tickerOn = multizone && tickerPos !== "hidden";

    showEl(tickerEl, tickerOn);
    if (tickerOn) {
      tickerEl.style.top = tickerPos === "top" ? "0px" : "auto";
      tickerEl.style.bottom = tickerPos === "top" ? "auto" : "0px";
      tickerText.innerHTML = String(row.ticker_text || "CENTERFRIOS — Crescendo com você")
        .replace(/</g, "&lt;");
    }
    zone.style.top = tickerOn && tickerPos === "top" ? "90px" : "0px";
    zone.style.bottom = tickerOn && tickerPos !== "top" ? "90px" : "0px";

    showEl(cornerEl, multizone);
    corner(cornerEl, row.qr_position || "top-right");
    
    var logoSize = row.presence_logo_size || 96;
    var logoImg = cornerEl.querySelector("img.logo");
    if (logoImg) logoImg.style.height = Math.round(logoSize / 2) + "px";
    if (cornerQr) {
      cornerQr.style.height = logoSize + "px";
      cornerQr.style.width = logoSize + "px";
    }
    
    updateCornerQr();

    var volume = typeof row.volume === "number" ? row.volume : 100;
    var muted = row.muted !== false;
    vidA.muted = muted; vidB.muted = muted;
    vidA.volume = Math.min(1, Math.max(0, volume / 100));
    vidB.volume = vidA.volume;

    showEl(presenceEl, !!row.show_presence_qr);
    if (row.show_presence_qr) {
      if (!presenceQr.src) presenceQr.src = qrSrc(window.location.origin + "/presenca", 200);
      corner(presenceEl, row.presence_qr_position || "bottom-right");
    }

    if (row.sponsors_enabled) loadSponsors(); else { showEl(sponsorsEl, false); }
    sponsorsEl.style.top = tickerOn && tickerPos === "top" ? "auto" : "0px";
    sponsorsEl.style.bottom = tickerOn && tickerPos === "top" ? "0px" : "auto";

    tickClock();
  }

  function corner(el, position) {
    el.style.top = "auto"; el.style.bottom = "auto"; el.style.left = "auto"; el.style.right = "auto";
    if (position === "top-left") { el.style.top = "24px"; el.style.left = "24px"; }
    else if (position === "bottom-left") { el.style.bottom = "110px"; el.style.left = "24px"; }
    else if (position === "bottom-right") { el.style.bottom = "110px"; el.style.right = "24px"; }
    else { el.style.top = "24px"; el.style.right = "24px"; }
  }

  function updateCornerQr() {
    var item = items.length ? items[idx % items.length] : null;
    var url = (item && item.qr_url) || (tv && tv.qr_url) || null;
    if (!url) { showEl(cornerQr, false); cornerQr.removeAttribute("src"); return; }
    var next = qrSrc(url, 200);
    if (cornerQr.getAttribute("src") !== next) cornerQr.src = next;
    cornerQr.style.display = "inline-block";
    if (tv && tv.layout_mode !== "multizone") { showEl(cornerEl, true); }
  }

  function tickClock() {
    if (!tv) return;
    var now = new Date().getTime();

    // boas-vindas
    var welcomeOn = !!(tv.welcome_message && tv.welcome_until &&
      new Date(tv.welcome_until).getTime() > now);
    if (welcomeOn) welcomeMsg.innerHTML = String(tv.welcome_message).replace(/</g, "&lt;");
    showEl(welcomeEl, welcomeOn);

    // cronômetro
    var ms = tv.countdown_ends_at ? new Date(tv.countdown_ends_at).getTime() - now : -1;
    if (ms > 0) {
      var total = Math.floor(ms / 1000);
      var mm = String(Math.floor(total / 60)); while (mm.length < 2) mm = "0" + mm;
      var ss = String(total % 60); while (ss.length < 2) ss = "0" + ss;
      cdLabel.innerHTML = String(tv.countdown_label || "Começa em").replace(/</g, "&lt;");
      cdValue.innerHTML = mm + ":" + ss;
      showEl(cdEl, true);
    } else showEl(cdEl, false);

    // expira aviso
    if (alertHideAt && now > alertHideAt) { alertHideAt = 0; showEl(alertEl, false); }

    overlayBlocking = welcomeOn || alertHideAt > 0 || spotEl.style.display === "block";
  }

  /* ---------------- avisos / destaque / patrocinadores ---------------- */
  function pollAlerts() {
    req("GET", "/rest/v1/tv_alerts?select=id,message,expires_at&order=created_at.desc&limit=1", null,
      function (err, rows) {
        if (err || !rows || !rows.length) return;
        var a = rows[0];
        if (!a.message || a.id === lastAlertId) return;
        var until = a.expires_at ? new Date(a.expires_at).getTime() : 0;
        if (until && until < new Date().getTime()) return;
        lastAlertId = a.id;
        alertMsg.innerHTML = String(a.message).replace(/</g, "&lt;");
        alertHideAt = until || (new Date().getTime() + 20000);
        showEl(alertEl, true);
      });
  }

  function pollSpotlight() {
    if (!tv || !tv.event_mode) { if (spotlight) { spotlight = null; showEl(spotEl, false); } return; }
    req("GET", "/rest/v1/event_photos?select=id,image_url,featured_until&status=eq.approved" +
      "&featured=is.true&order=created_at.desc&limit=1", null, function (err, rows) {
      var row = (!err && rows && rows.length) ? rows[0] : null;
      var now = new Date().getTime();
      var on = !!(row && row.image_url && (!row.featured_until || new Date(row.featured_until).getTime() > now));
      if (!on) { spotlight = null; showEl(spotEl, false); return; }
      if (!spotlight || spotlight.id !== row.id) { spotlight = row; spotImg.src = row.image_url; }
      showEl(spotEl, true);
    });
  }

  function loadSponsors() {
    if (!tv || !tv.sponsors_enabled) { showEl(sponsorsEl, false); return; }
    req("GET", "/rest/v1/event_sponsors?select=id,name,image_url&active=is.true&order=sort_order.asc",
      null, function (err, rows) {
        if (err || !rows || !rows.length) { showEl(sponsorsEl, false); return; }
        var html = "";
        var count = 0;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i] && rows[i].image_url) { html += '<img src="' + rows[i].image_url + '" alt="">'; count++; }
        }
        
        // Se houver poucos patrocinadores e não preencherem a tela, duplica mais vezes
        // Mas a instrução diz "duplique o conteúdo". Vamos garantir que a velocidade seja constante.
        sponsorsList.innerHTML = html + html;
        var duration = Math.max(10, count * 5) + "s";
        sponsorsList.style.animationDuration = duration;
        sponsorsList.style.webkitAnimationDuration = duration;
        
        showEl(sponsorsEl, !!html);
      });
  }

  /* ---------------- modo ao vivo ---------------- */
  function setLive(on) {
    if (on === isLive) return;
    isLive = on;
    if (on) {
      stopPlayback();
      screenMode("");
      showEl(liveTag, true);
      fetchFrame();
      liveTimer = setInterval(fetchFrame, LIVE_MS);
    } else {
      if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
      showEl(liveTag, false);
      showEl(liveImg, false);
      if (items.length) startLoop();
    }
  }

  function fetchFrame() {
    req("GET", "/rest/v1/live_frames?select=frame_data&order=created_at.desc&limit=1", null,
      function (err, rows) {
        if (err || !rows || !rows.length || !rows[0].frame_data) return;
        liveImg.src = rows[0].frame_data;
        showEl(liveImg, true);
      });
  }

  /* ---------------- playlist (RPC + fallback direto) ---------------- */
  function loadPlaylist(playlistId, eventMode) {
    var resolved = [];

    function finish() {
      if (eventMode) { appendEventPhotos(resolved, apply); return; }
      apply();
    }

    function apply() {
      if (!resolved.length) {
        if (items.length) { startLoop(); return; }
        stopPlayback();
        emptyMsg.innerHTML = (tv && tv.playlist_id)
          ? "Playlist vinculada n&atilde;o possui m&iacute;dias cadastradas"
          : "Nenhum conte&uacute;do vinculado a esta TV";
        emptyCode.innerHTML = (tv && tv.playlist_id) ? "" : (pairingCode || "······");
        screenMode("empty");
        return;
      }
      var sig = "";
      for (var i = 0; i < resolved.length; i++) {
        sig += resolved[i].media_id + "|" + resolved[i].url + "|" + resolved[i].duration + ",";
      }
      // conteúdo idêntico -> NÃO reinicia a reprodução (evita flashes)
      if (sig === lastSignature) { if (!playing) startLoop(); return; }
      lastSignature = sig;
      items = resolved;
      idx = 0;
      lsSet(K_PL, JSON.stringify(resolved));
      startLoop();
    }

    if (!playlistId) { finish(); return; }

    req("POST", "/rest/v1/rpc/get_tv_playlist_items", { p_playlist_id: playlistId }, function (err, rows) {
      if (!err && rows && rows.length) {
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (!r || !r.url) continue;
          resolved.push({
            media_id: r.media_id, url: r.url, type: r.type,
            title: r.title, qr_url: r.qr_url, duration: r.duration || 10
          });
        }
      }
      if (resolved.length) { finish(); return; }
      // fallback: playlists.items (JSONB) + media
      req("GET", "/rest/v1/playlists?id=eq." + playlistId + "&select=items", null, function (e2, pls) {
        var parsed = [];
        if (!e2 && pls && pls.length && pls[0].items && pls[0].items.length) {
          parsed = pls[0].items.slice(0);
          parsed.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
        }
        if (!parsed.length) { finish(); return; }
        var ids = [];
        for (var k = 0; k < parsed.length; k++) if (parsed[k].media_id) ids.push(parsed[k].media_id);
        req("GET", "/rest/v1/media?select=id,title,url,type,duration,qr_url&id=in.(" + ids.join(",") + ")",
          null, function (e3, medias) {
            var byId = {};
            if (!e3 && medias) for (var m = 0; m < medias.length; m++) byId[medias[m].id] = medias[m];
            for (var p = 0; p < parsed.length; p++) {
              var med = byId[parsed[p].media_id];
              if (!med || !med.url) continue;
              resolved.push({
                media_id: med.id, url: med.url, type: med.type, title: med.title, qr_url: med.qr_url,
                duration: parsed[p].custom_duration || med.duration || 10
              });
            }
            finish();
          });
      });
    });
  }

  function appendEventPhotos(resolved, done) {
    req("GET", "/rest/v1/event_photos?select=id,image_url&status=eq.approved" +
      "&order=created_at.desc&limit=40", null, function (err, rows) {
      if (!err && rows) {
        for (var i = 0; i < rows.length; i++) {
          if (!rows[i] || !rows[i].image_url) continue;
          resolved.push({
            media_id: "event-" + rows[i].id, url: rows[i].image_url, type: "image",
            title: "Mural do evento", duration: 8, qr_url: null
          });
        }
      }
      done();
    });
  }

  /* ---------------- reprodução com double buffer ---------------- */
  function stopPlayback() {
    playing = false;
    token++;
    clearAllTimers();
    releaseVideo(vidA); releaseVideo(vidB);
    imgA.className = "media"; imgB.className = "media";
  }

  function releaseVideo(el) {
    try {
      el.pause();
      el.removeAttribute("src");
      el.load();
    } catch (e) {}
    el.className = "media";
  }

  function startLoop() {
    if (isLive || !items.length) return;
    screenMode("");
    if (playing) return;
    playing = true;
    render();
  }

  function advance() {
    if (!playing || isLive) return;
    idx = (idx + 1) % items.length;
    render();
  }

  function render() {
    if (isLive || !items.length) return;
    clearAllTimers();
    token++;
    var my = token;
    var item = items[idx % items.length];
    if (!item || !item.url) { scheduleFail(); return; }

    updateCornerQr();

    if (item.type === "video") renderVideo(item, my);
    else renderImage(item, my);
  }

  function scheduleFail() {
    timers.item = setTimeout(advance, 2000);
  }

  function crossfade(nextEl, prevEls) {
    nextEl.className = "media on";
    for (var i = 0; i < prevEls.length; i++) {
      (function (el) {
        if (el === nextEl) return;
        el.className = "media";
        setTimeout(function () {
          if (el === nextEl) return;
          if (el.tagName === "VIDEO") releaseVideo(el);        // libera o decoder (RAM no Silk)
          else el.removeAttribute("src");
        }, FADE_MS + 100);
      })(prevEls[i]);
    }
  }

  function renderVideo(item, my) {
    var el = idleVideo;
    var other = activeVideo;

    function go() {
      if (my !== token) return;
      try { el.currentTime = 0; } catch (e) {}
      var pr;
      try { pr = el.play(); } catch (e) { pr = null; }
      if (pr && typeof pr["catch"] === "function") {
        pr["catch"](function () { el.muted = true; try { el.play(); } catch (e2) {} });
      }
      crossfade(el, [other, activeImg, idleImg]);
      activeVideo = el; idleVideo = other;
      preloadNext();
    }

    el.onended = function () { if (my === token) advance(); };
    el.onerror = function () {
      if (my !== token) return;
      var code = el.error && el.error.code ? el.error.code : "?";
      diag("erro de midia " + code);
      advance();
    };
    el.onwaiting = function () {
      if (my !== token) return;
      clearTimer("stall");
      timers.stall = setTimeout(function () { if (my === token) advance(); }, STALL_MS);
    };
    el.onplaying = function () {
      if (my !== token) return;
      clearTimer("stall");
      clearTimer("hard");
      var d = el.duration;
      var secs = (d && isFinite(d) && d > 0) ? d + 5 : 35;      // watchdog dinâmico
      timers.hard = setTimeout(function () { if (my === token) advance(); }, secs * 1000);
    };

    // se já foi pré-carregado, entra sem esperar rede
    if (preloadedVideoSrc === item.url && el.readyState >= 3) {
      preloadedVideoSrc = "";
      go();
      return;
    }

    preloadedVideoSrc = "";
    el.oncanplaythrough = function () { clearTimer("canplay"); el.oncanplaythrough = null; go(); };
    try { el.src = item.url; el.load(); } catch (e) {}
    timers.canplay = setTimeout(function () {                    // segurança de 6s
      if (my !== token) return;
      el.oncanplaythrough = null;
      go();
    }, CANPLAY_TIMEOUT);
  }

  function renderImage(item, my) {
    var el = idleImg;
    var other = activeImg;
    var secs = Math.max(3, item.duration || 10);
    var pre = new Image();

    function go() {
      if (my !== token) return;
      el.src = item.url;
      crossfade(el, [other, activeVideo, idleVideo]);
      activeImg = el; idleImg = other;
      timers.item = setTimeout(function () { if (my === token) advance(); }, secs * 1000);
      preloadNext();
    }

    pre.onload = go;
    pre.onerror = function () { if (my === token) advance(); };
    pre.src = item.url;
    timers.canplay = setTimeout(function () { if (my === token && !el.src) go(); }, CANPLAY_TIMEOUT);
  }

  /* pré-carrega a próxima mídia enquanto a atual toca (sem play no oculto) */
  function preloadNext() {
    if (items.length < 2) return;
    var next = items[(idx + 1) % items.length];
    if (!next || !next.url) return;
    if (next.type === "video") {
      try {
        if (idleVideo.getAttribute("src") !== next.url) {
          idleVideo.pause();
          idleVideo.src = next.url;
          idleVideo.load();
        }
        preloadedVideoSrc = next.url;
      } catch (e) {}
    } else {
      var p = new Image();
      p.src = next.url;
    }
  }

  /* ---------------- go ---------------- */
  boot();
})();

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
    "show_presence_qr,presence_qr_position,presence_logo_size," +
    "show_weather,show_currency";
  /* Colunas da migration 20260918150000 (rodapé de notícias/logo). Se o banco ainda não as
     tem, a consulta falha: cai para TV_COLS e re-tenta a completa a cada 10 min. */
  var TV_COLS_NEWS = ",show_logo,logo_size,show_news_ticker,news_queries,news_exclude,news_interval_min";
  var useNewsCols = true, newsColsRetryAt = 0;
  /* Colunas do Endomarketing (migration 20261008150000): mesma estratégia de reserva. */
  var TV_COLS_ENDO = ",is_endomarketing_active,endomarketing_state";
  var useEndoCols = true, endoColsRetryAt = 0;
  var NEWS_PROMO_EVERY = 4;

  /* A estação do aeroporto (METAR) mede de hora em hora e a PTAX de fechamento sai 1x/dia:
     consultar a cada 5 min já pega qualquer atualização sem abusar das fontes. */
  var WEATHER_MS = 5 * 60 * 1000;
  var CURRENCY_MS = 5 * 60 * 1000;

  /* Intervalos conservadores para economizar a nuvem (Supabase): ~80% menos consultas.
     Comandos/playlist chegam em até 20 s; avisos em até 25 s; destaque de foto em até 30 s. */
  var POLL_MS = 20000;       // estado da TV + comando remoto
  var HEARTBEAT_MS = 60000;  // fire-and-forget, NUNCA lido de volta (painel: online se < 150 s)
  var LIVE_MS = 1000;        // só roda durante transmissão ao vivo
  var ALERT_MS = 25000;
  var SPOT_MS = 30000;       // só consulta com modo evento ligado
  var SPONSOR_MS = 60000;    // só consulta com patrocinadores ligados
  /* Janela de entrega: o painel deixa aviso/destaque disponível por +35 s além do tempo de tela,
     para a TV que consulta a cada 25-30 s sempre recebê-lo. A TV exibe pelo tempo de tela
     contado a partir de quando o recebeu (nunca os 35 s extras). Igual no painel e no player React. */
  var DELIVERY_GRACE_MS = 35000;
  var SPOT_SHOW_MS = 10000;
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
  var tickerEl = $("ticker"), tickerText = $("ticker-text"), tickerNews = $("ticker-news"),
    tickerTop = $("ticker-top"), tickerTrack = $("ticker-track"), tickerClock = $("ticker-clock");
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
  var infobarEl = $("infobar"), weatherEl = $("infobar-weather"), currencyEl = $("infobar-currency");
  var weatherIcon = $("infobar-weather-icon"), weatherTemp = $("infobar-weather-temp");

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
  /* ---- YouTube (pipeline isolado do decoder nativo) ---- */
  var ytApiReady = false, ytApiLoading = false, ytQueue = [];
  var ytA = { el: $("yt-a"), holder: "yt-a-inner", player: null, videoId: "", ready: false, h: null };
  var ytB = { el: $("yt-b"), holder: "yt-b-inner", player: null, videoId: "", ready: false, h: null };
  var activeYt = ytA, idleYt = ytB;
  var timers = { item: null, stall: null, hard: null, canplay: null, ytpoll: null };
  var lastSignature = "";
  var lastTvSig = "";
  var lastAlertId = "";
  var alertHideAt = 0;
  var spotlight = null;
  var liveTimer = null;
  /* áudio desejado: aplicado no idleVideo só quando promovido a activeVideo (evita stall no Silk) */
  var _pendingAudio = null; // { muted: bool, vol: float, volumeOnly: bool }
  var _audioUnlocked = false; // true após o 1º unmute bem-sucedido: nunca mais escrever .muted
  /* estado do último layout aplicado — guards individuais evitam reflow desnecessário no Silk */
  var lastLayout = {
    orientation: null, fit: null,
    tickerOn: null, tickerPos: null, tickerText: null,
    zoneTop: null, zoneBottom: null,
    cornerVisible: null, qrPos: null, logoSize: null,
    sponsorsEnabled: null, sponsorsTickerTop: null, sponsorsTickerBottom: null,
    showPresence: null, presencePos: null,
    showWeather: null, showCurrency: null, showLogo: null, logoH: null
  };
  var weatherTimer = null, currencyTimer = null;
  var newsRetry = null, newsTimer = null, newsHeadlines = [], newsKey = "", newsLoadedSig = null, tickerMode = "", tickerNewsKey = "";

  /* ---------------- utils ---------------- */
  function ls(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function showEl(el, on) { el.style.display = on ? "block" : "none"; }
  function clearTimer(name) { if (timers[name]) { clearTimeout(timers[name]); timers[name] = null; } }
  function clearAllTimers() { clearTimer("item"); clearTimer("stall"); clearTimer("hard"); clearTimer("canplay"); clearTimer("ytpoll"); }
  function diag(msg) { diagEl.innerHTML = msg || ""; }

  /* ---------------- hora certa (independe do relógio/fuso do aparelho) ----------------
     O Fire TV pode estar em UTC ou com a hora errada. clockOffset = hora do servidor - hora local,
     medido em /api/public/infobar (serverTime). nowMs() = agora em UTC "de verdade".
     cfNow() = Date cujos campos UTC são a hora de Maceió (UTC-3, sem horário de verão):
     SEMPRE ler com getUTCHours/getUTCMinutes/getUTCDay/getUTCDate/getUTCMonth/getUTCFullYear. */
  var clockOffset = 0, clockSynced = false;
  var CF_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;
  function nowMs() { return new Date().getTime() + clockOffset; }
  function cfNow() { return new Date(nowMs() + CF_UTC_OFFSET_MS); }
  function cfYmd(d) { return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
  function syncClock(serverTime, t0, t1) {
    if (typeof serverTime !== "number" || !(serverTime > 0) || t1 - t0 > 10000) return; /* resposta lenta: ignora */
    clockOffset = serverTime + (t1 - t0) / 2 - t1;   /* meio do caminho da requisição */
    clockSynced = true;
  }

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

  /* GET simples para APIs públicas externas (sem header de auth do Supabase) */
  function httpGetJson(url, cb) {
    var done = false;
    function finish(err, data) { if (!done) { done = true; cb(err, data); } }
    if (typeof window.fetch === "function") {
      window.fetch(url).then(function (r) {
        return r.text().then(function (t) { return { ok: r.ok, t: t }; });
      }).then(function (o) {
        var d = null;
        try { d = o.t ? JSON.parse(o.t) : null; } catch (e) { d = null; }
        finish(o.ok ? null : new Error("HTTP"), d);
      })["catch"](function (e) { finish(e, null); });
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var d = null;
      try { d = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) { d = null; }
      finish(xhr.status >= 200 && xhr.status < 300 ? null : new Error("HTTP " + xhr.status), d);
    };
    xhr.send(null);
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
    /* try/catch: uma falha síncrona aqui não pode impedir o registro dos intervalos (o player pararia de sincronizar) */
    try { pollTv(); } catch (e) {}
    try { heartbeat(); } catch (e) {}
    setInterval(pollTv, POLL_MS);
    setInterval(heartbeat, HEARTBEAT_MS);
    setInterval(pollAlerts, ALERT_MS);
    setInterval(pollSpotlight, SPOT_MS);
    setInterval(loadSponsors, SPONSOR_MS);
    setInterval(tickClock, 1000);
    setInterval(dailyReload, 60000);
    setInterval(flushPlays, PLAY_FLUSH_MS);
    setInterval(checkVersion, VERSION_MS);
    /* hora certa: acerta já no início e a cada 30 min, mesmo com clima/cotação desligados
       (a rota tem cache no servidor; a resposta do clima/cotação é reaproveitada) */
    try { fetchInfobar(function () { updateNewsClock(); }); } catch (e) {}
    setInterval(function () { fetchInfobar(function () {}); }, 30 * 60 * 1000);
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

  /* ---------------- atualização automática ----------------
     A cada 5 min lê /player.html (sem cache) e compara o ?v= do engine com o que está rodando.
     Publicou versão nova -> recarrega ao terminar a mídia atual (no máximo 10 min depois).
     Assim nenhuma TV fica presa em código antigo até o reload das 3h. */
  var VERSION_MS = 5 * 60 * 1000, pendingReload = false;
  function myVersion() {
    var s = document.getElementsByTagName("script");
    for (var i = 0; i < s.length; i++) {
      var m = String(s[i].src || "").match(/player-engine\.js\?v=(\d+)/);
      if (m) return m[1];
    }
    return "";
  }
  var runningVersion = "";
  function checkVersion() {
    if (pendingReload) return;
    if (!runningVersion) runningVersion = myVersion();
    if (!runningVersion) return;
    var url = "/player.html?t=" + new Date().getTime(), done = false;
    function got(txt) {
      if (done) return; done = true;
      var m = String(txt || "").match(/player-engine\.js\?v=(\d+)/);
      if (!m || m[1] === runningVersion) return;
      pendingReload = true;
      /* reserva: recarrega em 10 min, mas nunca no meio de uma atividade de Endomarketing */
      var tryReload = function () { if (endoActive) { setTimeout(tryReload, 60000); return; } window.location.reload(); };
      setTimeout(tryReload, 10 * 60 * 1000);
    }
    try {
      if (typeof window.fetch === "function") {
        window.fetch(url, { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; })
          .then(got)["catch"](function () {});
        return;
      }
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.onreadystatechange = function () { if (xhr.readyState === 4 && xhr.status === 200) got(xhr.responseText); };
      xhr.send(null);
    } catch (e) {}
  }

  function dailyReload() {
    if (!clockSynced) return;                   /* sem hora confiável, não arrisca reload fora de hora */
    var d = cfNow();
    if (d.getUTCHours() === 3 && d.getUTCMinutes() === 0) window.location.reload();
  }

  /* ---------------- polling do estado da TV ---------------- */
  /* resposta de erro do PostgREST = coluna inexistente / sem permissão (migration não aplicada) */
  function colsMissing(body) { return !!(body && (body.code === "42703" || body.code === "42501")); }

  function pollTv() {
    if (!tvId) return;
    var t = new Date().getTime();
    if (!useNewsCols && newsColsRetryAt && t > newsColsRetryAt) { useNewsCols = true; newsColsRetryAt = 0; }
    if (!useEndoCols && endoColsRetryAt && t > endoColsRetryAt) { useEndoCols = true; endoColsRetryAt = 0; }
    var wantNews = useNewsCols, wantEndo = useNewsCols && useEndoCols;
    req("GET", "/rest/v1/tvs?id=eq." + tvId + "&select=" + TV_COLS + (wantNews ? TV_COLS_NEWS : "") +
      (wantEndo ? TV_COLS_ENDO : ""), null, function (err, rows) {
      if (err && wantEndo && colsMissing(rows)) {
        /* colunas do Endomarketing ainda não existem: segue sem elas e re-tenta em 10 min */
        useEndoCols = false; endoColsRetryAt = new Date().getTime() + 10 * 60 * 1000;
        pollTv();
        return;
      }
      if (err && wantNews) {
        req("GET", "/rest/v1/tvs?id=eq." + tvId + "&select=" + TV_COLS, null, function (err2, rows2) {
          if (err2 || !rows2 || !rows2.length) { diag("sem conexao"); return; }
          useNewsCols = false; newsColsRetryAt = new Date().getTime() + 10 * 60 * 1000;
          handleTvRows(rows2);
        });
        return;
      }
      if (err || !rows || !rows.length) { diag("sem conexao"); return; }
      handleTvRows(rows);
    });
  }

  function handleTvRows(rows) {
    {
      diag("");
      var row = rows[0];
      var prev = tv;
      tv = row;

      runCommand(row.command);

      // assinatura das opções visuais: aplica no DOM só quando muda de verdade
      var sig = [row.orientation, row.layout_mode, row.media_fit, row.ticker_position, row.ticker_text,
        row.qr_position, row.qr_url, row.muted, row.volume, row.sponsors_enabled,
        row.show_presence_qr, row.presence_qr_position, row.welcome_message, row.welcome_until,
        row.countdown_label, row.countdown_ends_at, row.presence_logo_size,
        row.show_weather, row.show_currency, row.show_logo, row.logo_size, row.show_news_ticker,
        row.news_queries, row.news_exclude, row.news_interval_min].join("|");
      if (sig !== lastTvSig) { lastTvSig = sig; applyLayout(row); ytApplyAudio(activeYt); }

      setLive(!!row.is_live_active);
      if (isLive) { if (endoActive) endoExit(); return; }

      /* Endomarketing tem prioridade sobre a playlist (o ao vivo tem prioridade sobre ele) */
      endoApplyRow(row);

      var structural = !prev || prev.playlist_id !== row.playlist_id ||
        prev.event_mode !== row.event_mode || prev.is_paired !== row.is_paired;

      if (!row.is_paired && !row.playlist_id && !row.event_mode) {
        stopPlayback();
        screenMode("pair");
        return;
      }
      if (structural) loadPlaylist(row.playlist_id, row.event_mode);
      else if (!playing && items.length) startLoop();
    }
  }

  function runCommand(cmd) {
    if (!cmd || !cmd.nonce) return;
    if (ls(K_NONCE) === cmd.nonce) return;
    lsSet(K_NONCE, cmd.nonce);
    if (cmd.action === "reload" || cmd.action === "purge") { window.location.reload(); return; }
    if (cmd.action === "sync") { lastSignature = ""; if (tv) loadPlaylist(tv.playlist_id, tv.event_mode); return; }
    if (cmd.action === "mute" || cmd.action === "unmute") {
      /* Fire OS/Silk: 1ª ativação usa muted; depois disso só .volume. */
      var m = cmd.action === "mute";
      var vol = tv ? Math.min(1, Math.max(0, (typeof tv.volume === "number" ? tv.volume : 100) / 100)) : 1;
      if (_audioUnlocked) {
        var v = m ? 0 : vol;
        vidA.volume = v; vidB.volume = v;
      } else {
        vidA.muted = m; vidB.muted = m;
        if (!m) { vidA.volume = vol; vidB.volume = vol; _audioUnlocked = true; }
      }
      /* YouTube: API própria, sem guarda de readyState (pipeline isolado) */
      ytSetAudio(activeYt, m, Math.round(vol * 100));
    }
  }

  /* ---------------- layout / overlays estáticos ---------------- */
  /* Cada sub-função só escreve no DOM se o valor REALMENTE mudou.
     Isso evita reflows desnecessários no pipeline do Silk/Fire OS que
     causavam freeze de vídeo ao alternar qualquer campo de layout. */

  function applyOrientation(portrait) {
    var cls = portrait ? "portrait" : "";
    if (lastLayout.orientation === cls) return;
    lastLayout.orientation = cls;
    rot.className = cls;
  }

  function applyMediaFit(fit) {
    if (lastLayout.fit === fit) return;
    lastLayout.fit = fit;
    var mediaEls = [vidA, vidB, imgA, imgB, liveImg];
    for (var i = 0; i < mediaEls.length; i++) mediaEls[i].style.objectFit = fit;
  }

  /* Altura do rodapé: 90px (texto simples) ou 136px (modo CENTERNEWS, 2 faixas: selo/relógio + manchetes).
     Decidida pela configuração (show_news_ticker), não pela chegada das manchetes: o layout não pula. */
  var TICKER_H = 90, TICKER_NEWS_H = 127;
  function tickerHeight() { return newsOn() ? TICKER_NEWS_H : TICKER_H; }
  /* Em qual borda o rodapé está ("top" | "bottom" | "none"): os cartões do canto (logo/QR/presença)
     nunca podem ficar por baixo da barra. */
  function tickerEdge() {
    if (!tv || tv.layout_mode !== "multizone") return "none";
    var pos = tv.ticker_position || "bottom";
    return pos === "hidden" ? "none" : pos;
  }

  function applyTicker(multizone, tickerPos, tickerTxt) {
    var tickerOn = multizone && tickerPos !== "hidden";
    var th = tickerHeight() + "px";
    var zoneTop = tickerOn && tickerPos === "top" ? th : "0px";
    var zoneBottom = tickerOn && tickerPos !== "top" ? th : "0px";

    if (lastLayout.tickerOn !== tickerOn) {
      lastLayout.tickerOn = tickerOn;
      showEl(tickerEl, tickerOn);
    }
    if (tickerOn) {
      if (lastLayout.tickerPos !== tickerPos) {
        lastLayout.tickerPos = tickerPos;
        tickerEl.style.top = tickerPos === "top" ? "0px" : "auto";
        tickerEl.style.bottom = tickerPos === "top" ? "auto" : "0px";
      }
      if (lastLayout.tickerText !== tickerTxt) {
        lastLayout.tickerText = tickerTxt;
        tickerText.innerHTML = esc(tickerTxt || "CENTERFRIOS \u2014 Crescendo com voc\u00ea");
      }
      renderTicker();
    }
    if (lastLayout.zoneTop !== zoneTop) { lastLayout.zoneTop = zoneTop; zone.style.top = zoneTop; }
    if (lastLayout.zoneBottom !== zoneBottom) { lastLayout.zoneBottom = zoneBottom; zone.style.bottom = zoneBottom; }
  }

  function applyCorner(row, multizone) {
    var qrPos = row.qr_position || "top-right";
    var logoSize = row.presence_logo_size || 96;

    if (lastLayout.cornerVisible !== multizone) {
      lastLayout.cornerVisible = multizone;
      showEl(cornerEl, multizone);
    }
    if (multizone) {
      var qrKey = qrPos + "|" + tickerHeight() + "|" + tickerEdge();
      if (lastLayout.qrPos !== qrKey) {
        lastLayout.qrPos = qrKey;
        corner(cornerEl, qrPos);
      }
      if (lastLayout.logoSize !== logoSize) {
        lastLayout.logoSize = logoSize;
        var logoImg = cornerEl.querySelector("img.logo");
        if (cornerQr) { cornerQr.style.height = logoSize + "px"; cornerQr.style.width = logoSize + "px"; }
      }
    }
    var logoImg2 = cornerEl.querySelector("img.logo");
    var showLogo = row.show_logo !== false;
    var logoH = row.logo_size || 48;
    if (logoImg2) {
      if (lastLayout.showLogo !== showLogo) { lastLayout.showLogo = showLogo; logoImg2.style.display = showLogo ? "inline-block" : "none"; }
      if (lastLayout.logoH !== logoH) { lastLayout.logoH = logoH; logoImg2.style.height = logoH + "px"; }
    }
    updateCornerQr();
    syncCornerBox();
  }

  function applyAudio(row) {
    var volume = typeof row.volume === "number" ? row.volume : 100;
    var muted = row.muted !== false;
    var vol = Math.min(1, Math.max(0, volume / 100));

    /* Depois do primeiro desbloqueio de áudio NUNCA mais escrevemos .muted:
       só o .volume controla ligar/desligar o som (0 = silenciado). */
    if (_audioUnlocked) {
      var v = muted ? 0 : vol;
      _pendingAudio = { muted: false, vol: v, volumeOnly: true };
      if (Math.abs(activeVideo.volume - v) > 0.001) activeVideo.volume = v;
      if (Math.abs(idleVideo.volume - v) > 0.001) idleVideo.volume = v;
      return;
    }

    /* Guarda o valor desejado — aplicado no idleVideo quando ele for promovido em go() */
    _pendingAudio = { muted: muted, vol: vol, volumeOnly: false };

    /* Aplica imediatamente só no activeVideo (já tem readyState >= 3, decoder estável) */
    if (activeVideo.muted !== muted) activeVideo.muted = muted;
    if (Math.abs(activeVideo.volume - vol) > 0.001) activeVideo.volume = vol;

    /* idleVideo: só toca se NÃO estiver no meio de um preload (Silk: networkState LOADING + readyState < HAVE_FUTURE_DATA).
       Atribuir muted=false sobre um decode pipeline não inicializado bloqueia o compositor
       compartilhado por 1–3 s, causando o 'waiting' absorvido pelo watchdog de stall. */
    var idleLoading = (idleVideo.networkState === 2 && idleVideo.readyState < 3);
    if (!idleLoading) {
      if (idleVideo.muted !== muted) idleVideo.muted = muted;
      if (Math.abs(idleVideo.volume - vol) > 0.001) idleVideo.volume = vol;
    }

    if (!muted) _audioUnlocked = true;   // a partir daqui, só volume
  }


  function applyPresence(row) {
    var show = !!row.show_presence_qr;
    var pos = row.presence_qr_position || "bottom-right";
    if (lastLayout.showPresence !== show) {
      lastLayout.showPresence = show;
      showEl(presenceEl, show);
    }
    if (show) {
      if (!presenceQr.src) presenceQr.src = qrSrc(window.location.origin + "/presenca", 200);
      var presKey = pos + "|" + tickerHeight() + "|" + tickerEdge();
      if (lastLayout.presencePos !== presKey) { lastLayout.presencePos = presKey; corner(presenceEl, pos); }
    }
  }

  function applySponsors(row, tickerOn, tickerPos) {
    var enabled = !!row.sponsors_enabled;
    var sTop = tickerOn && tickerPos === "top" ? "auto" : "0px";
    var sBottom = tickerOn && tickerPos === "top" ? "0px" : "auto";
    if (lastLayout.sponsorsEnabled !== enabled) {
      lastLayout.sponsorsEnabled = enabled;
      if (enabled) loadSponsors(); else showEl(sponsorsEl, false);
    }
    if (lastLayout.sponsorsTickerTop !== sTop) { lastLayout.sponsorsTickerTop = sTop; sponsorsEl.style.top = sTop; }
    if (lastLayout.sponsorsTickerBottom !== sBottom) { lastLayout.sponsorsTickerBottom = sBottom; sponsorsEl.style.bottom = sBottom; }
  }

  /* Previsão do tempo (Maceió/AL) + cotação USD/EUR. Fontes públicas, sem chave de API. */
  function weatherEmojiFor(code) {
    if (code === null || code === undefined) return "🌡️";
    if (code === 0) return "☀️";
    if (code <= 3) return "⛅";
    if (code <= 48) return "🌫️";
    if (code <= 67) return "🌧️";
    if (code <= 77) return "🌨️";
    if (code <= 82) return "🌦️";
    return "⛈️";
  }

  /* Fonte principal: /api/public/infobar (servidor do próprio site, sem CORS, com cache):
     - tempo: temperatura MEDIDA na estação oficial do aeroporto de Maceió (METAR SBMO);
     - cotações: PTAX de FECHAMENTO do dia útil anterior (Banco Central do Brasil).
     Se o servidor falhar, cai para as APIs públicas direto do navegador (Open-Meteo / BCE). */
  var infobarData = null, infobarAt = 0, infobarWaiting = [], infobarReq = 0;
  function fetchInfobar(cb) {
    var now = new Date().getTime();
    if (infobarData && now - infobarAt < 30000) { cb(infobarData); return; }
    infobarWaiting.push(cb);
    if (infobarWaiting.length > 1 && now - infobarReq < 20000) return;   /* busca em andamento */
    var my = infobarReq = now, done = false;
    function finish(data) {
      if (done || my !== infobarReq) return;
      done = true;
      var w = infobarWaiting; infobarWaiting = [];
      for (var i = 0; i < w.length; i++) { try { w[i](data); } catch (e) {} }
    }
    setTimeout(function () { finish(null); }, 20000);  /* servidor não respondeu: usa a reserva */
    httpGetJson("/api/public/infobar?t=" + now, function (err, data) {
      var t1 = new Date().getTime();
      if (!err && data) syncClock(data.serverTime, now, t1);     /* acerta o relógio da TV */
      if (!err && data && (data.weather || data.rates)) { infobarData = data; infobarAt = t1; }
      else data = null;
      finish(data);
    });
  }
  function money(v) { return v.toFixed(2).replace(".", ","); }
  function ymdOffset(days) {
    return cfYmd(new Date(cfNow().getTime() + days * 86400000));
  }

  function showWeather(temp, code, isDay) {
    if (typeof temp !== "number" || !isFinite(temp)) return;
    weatherTemp.innerHTML = Math.round(temp) + "&deg;C"; lastTempC = temp;
    weatherIcon.innerHTML = (isDay === false && (code === 0 || code === 1)) ? "🌙" : weatherEmojiFor(code);
    weatherEl.style.display = "flex";
  }

  function loadWeather() {
    if (!tv || !tv.show_weather) return;
    fetchInfobar(function (data) {
      var w = data && data.weather;
      if (w) { showWeather(w.temp, w.code, w.isDay); return; }
      httpGetJson(
        "https://api.open-meteo.com/v1/forecast?latitude=-9.6498&longitude=-35.7089" +
          "&current=temperature_2m,weather_code,is_day&timezone=America%2FMaceio",
        function (err, d) {
          if (err || !d || !d.current) return; // mantém o último valor exibido
          showWeather(d.current.temperature_2m, d.current.weather_code, d.current.is_day !== 0);
        }
      );
    });
  }

  function showRates(usd, eur) {
    var html = "";
    if (usd && isFinite(usd)) html += "<span>US$ " + money(usd) + "</span>";
    if (eur && isFinite(eur)) html += "<span>&euro; " + money(eur) + "</span>";
    if (!html) return;
    currencyEl.innerHTML = html;
    currencyEl.style.display = "flex";
  }

  function loadCurrency() {
    if (!tv || !tv.show_currency) return;
    fetchInfobar(function (data) {
      var r = data && data.rates;
      if (r) { showRates(r.usd, r.eur); return; }
      /* Reserva: BCE (Frankfurter) do dia anterior (a API devolve o último dia útil <= data).
         .dev direto (o .app faz redirect 301 que o Silk não segue bem em fetch). */
      httpGetJson("https://api.frankfurter.dev/v1/" + ymdOffset(-1) + "?from=BRL&to=USD,EUR", function (err, d) {
        if (err || !d || !d.rates) return; // mantém o último valor exibido
        showRates(d.rates.USD ? 1 / d.rates.USD : 0, d.rates.EUR ? 1 / d.rates.EUR : 0);
      });
    });
  }

  function applyWeather(row) {
    var show = !!row.show_weather;
    if (lastLayout.showWeather === show) return;
    lastLayout.showWeather = show;
    if (show) {
      loadWeather();
      if (!weatherTimer) weatherTimer = setInterval(loadWeather, WEATHER_MS);
    } else {
      showEl(weatherEl, false);
      if (weatherTimer) { clearInterval(weatherTimer); weatherTimer = null; }
    }
    updateInfobarVisibility();
  }

  function applyCurrency(row) {
    var show = !!row.show_currency;
    if (lastLayout.showCurrency === show) return;
    lastLayout.showCurrency = show;
    if (show) {
      loadCurrency();
      if (!currencyTimer) currencyTimer = setInterval(loadCurrency, CURRENCY_MS);
    } else {
      showEl(currencyEl, false);
      if (currencyTimer) { clearInterval(currencyTimer); currencyTimer = null; }
    }
    updateInfobarVisibility();
  }

  function updateInfobarVisibility() {
    var on = !!(tv && (tv.show_weather || tv.show_currency));
    infobarEl.style.display = on ? "flex" : "none";
    infobarEl.style.top = (tickerEdge() === "top" ? tickerHeight() + 24 : 24) + "px";
  }


  /* ---------------- rodapé de notícias (Google News via /api/public/news) ---------------- */
  var K_NEWS = "cf_news_cache";
  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function newsOn() { return !!(tv && tv.layout_mode === "multizone" && tv.show_news_ticker); }

  /* Mensagens automáticas do rodapé (editáveis aqui): dica do dia + aviso de calor forte (>= 30 °C).
     A dica muda a cada dia; o aviso de calor só entra se o clima estiver ligado e medindo. */
  var lastTempC = null;
  var CF_TIPS = ["DICA CENTERFRIOS: mantenha as portas dos balc\u00f5es fechadas \u2014 cada abertura aumenta o consumo de energia e reduz a vida \u00fatil do equipamento.", "DICA CENTERFRIOS: limpe o condensador todo m\u00eas \u2014 equipamento limpo gasta menos energia e conserva melhor seus produtos.", "DICA CENTERFRIOS: confira a temperatura da c\u00e2mara fria todos os dias \u2014 evita perdas e problemas sanit\u00e1rios.", "DICA CENTERFRIOS: n\u00e3o sobrecarregue o expositor \u2014 o ar precisa circular para manter a temperatura uniforme.", "DICA CENTERFRIOS: veda\u00e7\u00e3o ressecada \u00e9 energia jogada fora \u2014 troque a borracha das portas assim que perceber o desgaste.", "DICA CENTERFRIOS: a manuten\u00e7\u00e3o preventiva custa menos que uma parada inesperada \u2014 programe a revis\u00e3o do seu equipamento."];
  var HOT_MSG = "CALOR FORTE EM MACEI\u00d3: proteja seus produtos \u2014 c\u00e2maras frias e balc\u00f5es refrigerados CENTERFRIOS, com frete gr\u00e1tis em todo o estado.";
  function extraPromos() {
    var out = [];
    var day = Math.floor(cfNow().getTime() / 86400000);   /* dica muda à meia-noite de Maceió */
    out.push(CF_TIPS[day % CF_TIPS.length]);
    if (lastTempC !== null && lastTempC >= 30) out.push(HOT_MSG);
    return out;
  }

  function newsItemsForTicker() {
    var out = [], m = String((tv && tv.ticker_text) || "").replace(/^\s+|\s+$/g, "");
    if (m) out.push({ text: m, source: "", promo: true });
    var ex = extraPromos();
    for (var x = 0; x < ex.length; x++) out.push({ text: ex[x], source: "", promo: true });
    for (var i = 0; i < newsHeadlines.length; i++) {
      out.push({ text: newsHeadlines[i].text, source: newsHeadlines[i].source });
      if (m && (i + 1) % NEWS_PROMO_EVERY === 0 && i + 1 < newsHeadlines.length) out.push({ text: m, source: "", promo: true });
    }
    return out;
  }

  /* Alterna entre texto manual (clássico) e marquee de manchetes sem piscar:
     o marquee só é remontado quando o conteúdo realmente muda. */
  function renderTicker() {
    var useNews = newsOn();
    var mode = useNews ? "news" : "text";
    if (mode !== tickerMode) {
      tickerMode = mode;
      tickerText.style.display = useNews ? "none" : "inline-block";
      tickerTop.style.display = useNews ? "block" : "none";
      tickerTrack.style.display = useNews ? "block" : "none";
      if (useNews) updateNewsClock();
      tickerEl.className = useNews ? "pro" : "";
      tickerNewsKey = "";
    }
    if (!useNews) return;
    /* Sempre há conteúdo: manchetes + texto manual; sem nada, o slogan (nunca fica só a barra vazia). */
    var items = newsItemsForTicker(), key = "", html = "", k, i;
    if (!items.length) items = [{ text: "CENTERFRIOS \u2014 Crescendo com voc\u00ea", source: "", promo: true }];
    for (i = 0; i < items.length; i++) key += items[i].text + "|" + items[i].source + "¦";
    if (key === tickerNewsKey) return;
    tickerNewsKey = key;
    for (k = 0; k < 2; k++) {
      for (i = 0; i < items.length; i++) {
        html += '<span class="ni"><span class="' + (items[i].promo ? "np" : "nt") + '">' + esc(items[i].text) + "</span>" +
          (items[i].source ? '<span class="ns">' + esc(items[i].source) + "</span>" : "") + '</span><span class="nd"></span>';
      }
    }
    tickerNews.innerHTML = html;
    var dur = Math.max(30, Math.round((tickerNews.scrollWidth / 2) / 140)); /* ~140 px/s */
    tickerNews.style.webkitAnimationDuration = dur + "s";
    tickerNews.style.animationDuration = dur + "s";
  }

  function updateNewsClock() {
    var d = cfNow(), hh = d.getUTCHours(), mm = d.getUTCMinutes();   /* hora de Maceió */
    tickerClock.innerHTML = (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }
  /* Vigia: se o timer de 30 min atrasar/parar (Silk pode segurar timers), força a atualização. */
  var newsLastTry = 0;
  setInterval(function () {
    if (tickerMode === "news") updateNewsClock();
    if (newsOn() && newsLastTry && new Date().getTime() - newsLastTry > 32 * 60 * 1000) loadNews();
  }, 15000);

  function loadNews() {
    if (!newsOn()) return;
    newsLastTry = new Date().getTime();
    var qs = ["t=" + newsLastTry]; /* fura o cache do navegador */
    if (tv.news_queries) qs.push("queries=" + encodeURIComponent(tv.news_queries));
    if (tv.news_exclude) qs.push("exclude=" + encodeURIComponent(tv.news_exclude));
    httpGetJson("/api/public/news?" + qs.join("&"), function (err, data) {
      /* falhou: mantém o último cache válido, sem mexer na tela.
         Sem nada para mostrar ainda, tenta de novo em 60 s (não espera o ciclo de 30 min). */
      if (err || !data || !data.items || !data.items.length) {
        if (!newsRetry) {
          /* sem nada na tela: 60 s; com cache antigo na tela: 5 min (não espera o ciclo de 30 min) */
          newsRetry = setTimeout(function () { newsRetry = null; loadNews(); }, newsHeadlines.length ? 300000 : 60000);
        }
        return;
      }
      newsHeadlines = data.items;
      lsSet(K_NEWS, JSON.stringify({ sig: newsLoadedSig, items: data.items }));
      renderTicker();
    });
  }

  function applyNews(row) {
    var sig = (row.show_news_ticker ? "1" : "0") + "#" + (row.news_queries || "") + "#" + (row.news_exclude || "") + "#" + (row.news_interval_min || 30);
    if (sig === newsLoadedSig) { renderTicker(); return; }
    newsLoadedSig = sig;
    if (newsTimer) { clearInterval(newsTimer); newsTimer = null; }
    if (!newsOn()) { renderTicker(); return; }
    if (!newsHeadlines.length) {
      try {
        var c = JSON.parse(ls(K_NEWS) || "null");
        if (c && c.sig === sig && c.items && c.items.length) newsHeadlines = c.items;
      } catch (e) {}
    }
    renderTicker();
    loadNews();
    newsTimer = setInterval(loadNews, Math.min(30, Math.max(10, row.news_interval_min || 30)) * 60 * 1000);
  }

  function applyLayout(row) {
    var portrait = row.orientation === "portrait";
    var fit = row.media_fit === "cover" ? "cover" : "contain";
    var multizone = row.layout_mode === "multizone";
    var tickerPos = row.ticker_position || "bottom";

    applyOrientation(portrait);
    applyMediaFit(fit);
    applyTicker(multizone, tickerPos, row.ticker_text);
    applyCorner(row, multizone);
    applyAudio(row);
    applyPresence(row);
    applySponsors(row, multizone && tickerPos !== "hidden", tickerPos);
    applyWeather(row);
    applyCurrency(row);
    applyNews(row);
    tickClock();
  }

  function corner(el, position) {
    el.style.top = "auto"; el.style.bottom = "auto"; el.style.left = "auto"; el.style.right = "auto";
    var topPx = (tickerEdge() === "top" ? tickerHeight() + 24 : 24) + "px";
    var botPx = (tickerEdge() === "bottom" ? tickerHeight() + 20 : 110) + "px";
    if (position === "top-left") { el.style.top = topPx; el.style.left = "24px"; }
    else if (position === "bottom-left") { el.style.bottom = botPx; el.style.left = "24px"; }
    else if (position === "bottom-right") { el.style.bottom = botPx; el.style.right = "24px"; }
    else { el.style.top = topPx; el.style.right = "24px"; }
  }

  function updateCornerQr() {
    var item = items.length ? items[idx % items.length] : null;
    var url = (item && item.qr_url) || (tv && tv.qr_url) || null;
    if (!url) { showEl(cornerQr, false); cornerQr.removeAttribute("src"); syncCornerBox(); return; }
    var next = qrSrc(url, 200);
    if (cornerQr.getAttribute("src") !== next) cornerQr.src = next;
    cornerQr.style.display = "inline-block";
    if (tv && tv.layout_mode !== "multizone") { showEl(cornerEl, true); }
    syncCornerBox();
  }

  /* Multi-zona: o cartão azul do canto só existe se tiver logo OU QR (sem isso sobrava uma "elipse" vazia). */
  function syncCornerBox() {
    if (!tv || tv.layout_mode !== "multizone") return;
    var hasLogo = tv.show_logo !== false;
    var hasQr = cornerQr.style.display !== "none" && !!cornerQr.getAttribute("src");
    showEl(cornerEl, hasLogo || hasQr);
  }

  function tickClock() {
    if (!tv) return;
    var now = new Date().getTime();             /* relógio local: só para alertHideAt (relativo) */
    var srvNow = nowMs();                       /* hora certa: compara com horários do servidor */

    // boas-vindas
    var welcomeOn = !!(tv.welcome_message && tv.welcome_until &&
      new Date(tv.welcome_until).getTime() > srvNow);
    if (welcomeOn) welcomeMsg.innerHTML = String(tv.welcome_message).replace(/</g, "&lt;");
    showEl(welcomeEl, welcomeOn);

    // cronômetro
    var ms = tv.countdown_ends_at ? new Date(tv.countdown_ends_at).getTime() - srvNow : -1;
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
    req("GET", "/rest/v1/tv_alerts?select=id,message,expires_at,created_at&order=created_at.desc&limit=1", null,
      function (err, rows) {
        if (err || !rows || !rows.length) return;
        var a = rows[0];
        if (!a.message || a.id === lastAlertId) return;
        lastAlertId = a.id;
        /* tempo de tela = (expira - criado) - janela de entrega; mínimo 5 s.
           Conta a partir de agora (quando esta TV recebeu), não do relógio do servidor. */
        var span = 20000;
        if (a.expires_at && a.created_at) {
          span = new Date(a.expires_at).getTime() - new Date(a.created_at).getTime() - DELIVERY_GRACE_MS;
          if (!(span >= 5000)) span = 5000;
        }
        alertMsg.innerHTML = String(a.message).replace(/</g, "&lt;");
        alertHideAt = new Date().getTime() + Math.min(span, 10 * 60 * 1000);
        showEl(alertEl, true);
      });
  }

  function pollSpotlight() {
    if (!tv || !tv.event_mode) { if (spotlight) { spotlight = null; showEl(spotEl, false); } return; }
    req("GET", "/rest/v1/event_photos?select=id,image_url,featured_until&status=eq.approved" +
      "&featured=is.true&order=created_at.desc&limit=1", null, function (err, rows) {
      if (err) return;                                   /* falha de rede: não mexe na tela */
      var row = (rows && rows.length) ? rows[0] : null;
      if (!row || !row.image_url) { spotlight = null; showEl(spotEl, false); return; }
      /* Cada destaque (foto + horário) aparece UMA vez por 10 s, contados de quando esta TV o
         recebeu. O painel o mantém disponível por 10 s + janela de entrega. */
      var key = row.id + "|" + (row.featured_until || "");
      if (key === spotShownKey) return;
      spotShownKey = key;
      /* destaque já vencido (ex.: TV ligou depois): não exibe */
      if (row.featured_until && new Date(row.featured_until).getTime() < nowMs()) return;
      spotlight = row;
      spotImg.src = row.image_url;
      showEl(spotEl, true);
      clearTimeout(spotTimer);
      spotTimer = setTimeout(function () { spotlight = null; showEl(spotEl, false); }, SPOT_SHOW_MS);
    });
  }
  var spotShownKey = "", spotTimer = null;

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

  /* ---------------- Endomarketing (MKT & RH): vídeo do YouTube controlado ao vivo ----------------
     O painel grava tvs.is_endomarketing_active + tvs.endomarketing_state. A TV:
     - entra no modo em até POLL_MS (20 s) e, enquanto ativo, consulta SÓ o estado a cada ENDO_POLL_MS;
     - pausa a playlist e mostra um player YouTube próprio (#endo), separado do double buffer;
     - converge continuamente para playing/volume/isMuted/loop/fullscreen;
     - aplica UMA vez por nonce: troca de vídeo e "voltar ao início" (seekTo currentTime);
     - ao desativar, destrói o player e retoma a playlist de onde estava.
     Sem WebSocket (polling simples, como todo o engine). */
  var ENDO_POLL_MS = 2000;
  var endoEl = $("endo"), endoTitleEl = $("endo-title"), endoEndEl = $("endo-end");
  var endoActive = false, endoTimer = null, endoTitleTimer = null;
  var endoYt = { player: null, ready: false, videoId: "" };
  var endoApplied = { nonce: "", volume: -1, muted: null, fullscreen: null };
  var endoState = null, endoEnded = false;

  function endoValid(st) { return !!(st && typeof st === "object" && ytId(st.videoId || "")); }

  /* chamada a cada leitura da linha da TV (poll normal ou rápido) */
  function endoApplyRow(row) {
    var st = row && row.endomarketing_state;
    if (row && row.is_endomarketing_active && endoValid(st)) {
      if (!endoActive) endoEnter();
      endoState = st;
      endoSync();
    } else if (endoActive) {
      endoExit();
    }
  }

  function endoEnter() {
    endoActive = true;
    stopPlayback();                        /* pausa a playlist (libera decodificador e iframes) */
    screenMode("");
    endoEnded = false;
    endoApplied = { nonce: "", volume: -1, muted: null, fullscreen: null };
    showEl(endoEl, true);
    showEl(endoEndEl, false);
    if (endoTimer) clearInterval(endoTimer);
    endoTimer = setInterval(endoPoll, ENDO_POLL_MS);
  }

  function endoExit() {
    endoActive = false;
    if (endoTimer) { clearInterval(endoTimer); endoTimer = null; }
    if (endoTitleTimer) { clearTimeout(endoTitleTimer); endoTitleTimer = null; }
    if (endoYt.player) { try { endoYt.player.destroy(); } catch (e) {} }
    endoYt = { player: null, ready: false, videoId: "" };
    $("endo-video").innerHTML = '<div id="endo-holder"></div>';
    endoState = null;
    showEl(endoTitleEl, false);
    showEl(endoEndEl, false);
    showEl(endoEl, false);
    if (items.length) startLoop();         /* volta para a programação normal */
  }

  /* consulta rápida: só as 2 colunas do modo, enquanto ele estiver ativo */
  function endoPoll() {
    if (!tvId || !endoActive) return;
    req("GET", "/rest/v1/tvs?id=eq." + tvId + "&select=is_endomarketing_active,endomarketing_state", null,
      function (err, rows) {
        if (err || !rows || !rows.length || !endoActive) return;   /* falha de rede: mantém como está */
        if (tv) { tv.is_endomarketing_active = rows[0].is_endomarketing_active; tv.endomarketing_state = rows[0].endomarketing_state; }
        endoApplyRow(rows[0]);
      });
  }

  function endoCreate(videoId) {
    if (endoYt.player) { try { endoYt.player.destroy(); } catch (e) {} }
    $("endo-video").innerHTML = '<div id="endo-holder"></div>';
    endoYt = { player: null, ready: false, videoId: videoId };
    whenYtReady(function () {
      if (!endoActive || endoYt.videoId !== videoId) return;
      try {
        endoYt.player = new window.YT.Player("endo-holder", {
          videoId: videoId, width: "100%", height: "100%",
          playerVars: {
            autoplay: endoState && endoState.playing ? 1 : 0, controls: 0, modestbranding: 1, rel: 0,
            playsinline: 1, fs: 0, disablekb: 1, iv_load_policy: 3,
            origin: window.location.protocol + "//" + window.location.host,
            widget_referrer: window.location.href
          },
          events: {
            onReady: function () {
              endoYt.ready = true;
              endoApplied.volume = -1; endoApplied.muted = null;   /* reaplica áudio no player novo */
              endoSync();
            },
            onStateChange: function (e) {
              var S = window.YT && window.YT.PlayerState;
              if (!S || !endoActive) return;
              if (e.data === S.ENDED) endoOnEnded();
              else if (e.data === S.PLAYING) { endoEnded = false; showEl(endoEndEl, false); }
            },
            onError: function () { diag("endo: video indisponivel"); endoEnded = true; showEl(endoEndEl, true); }
          }
        });
      } catch (e) { endoYt.player = null; }
    });
  }

  function endoOnEnded() {
    if (endoState && endoState.loop) {
      try { endoYt.player.seekTo(0, true); endoYt.player.playVideo(); } catch (e) {}
      return;
    }
    endoEnded = true;                      /* sem loop: mostra a tela institucional até o próximo comando */
    showEl(endoEndEl, true);
  }

  function endoShowTitle(txt) {
    if (endoTitleTimer) { clearTimeout(endoTitleTimer); endoTitleTimer = null; }
    if (!txt) { showEl(endoTitleEl, false); return; }
    endoTitleEl.innerHTML = esc(txt);
    showEl(endoTitleEl, true);
    endoTitleTimer = setTimeout(function () { showEl(endoTitleEl, false); }, 8000);
  }

  /* converge o player para endoState */
  function endoSync() {
    var st = endoState;
    if (!endoActive || !st) return;
    var vid = ytId(st.videoId);

    /* tela cheia total x área da mídia (mantém rodapé/barra institucional) */
    var fs = !!st.fullscreen;
    if (endoApplied.fullscreen !== fs) {
      endoApplied.fullscreen = fs;
      endoEl.className = fs ? "full-on" : "";
      if (!fs) { endoEl.style.top = zone.style.top || "0px"; endoEl.style.bottom = zone.style.bottom || "0px"; }
      else { endoEl.style.top = "0px"; endoEl.style.bottom = "0px"; }
    } else if (!fs) {
      endoEl.style.top = zone.style.top || "0px"; endoEl.style.bottom = zone.style.bottom || "0px";
    }

    /* comando pontual (nonce novo): troca de vídeo ou volta à posição pedida */
    var newNonce = String(st.nonce || "") !== endoApplied.nonce;
    if (newNonce) {
      endoApplied.nonce = String(st.nonce || "");
      endoEnded = false;
      showEl(endoEndEl, false);
      endoShowTitle(st.momentTitle || "");
      if (endoYt.videoId !== vid || !endoYt.player) { endoCreate(vid); return; }
      /* currentTime >= 0: vai para essa posição (0 = início); negativo: só libera um vídeo que terminou */
      var ct = Number(st.currentTime);
      if (endoYt.ready && ct >= 0) { try { endoYt.player.seekTo(ct, true); } catch (e) {} }
      if (endoYt.ready && st.playing) { try { endoYt.player.playVideo(); } catch (e) {} }
    }
    if (endoYt.videoId !== vid) { endoCreate(vid); return; }
    if (!endoYt.player || !endoYt.ready) return;
    var p = endoYt.player, S = window.YT && window.YT.PlayerState;

    /* áudio: volume 0-100 e mudo (caixa de som Bluetooth do Fire TV) */
    var vol = Math.max(0, Math.min(100, Math.round(Number(st.volume))));
    if (isNaN(vol)) vol = 80;
    if (endoApplied.volume !== vol) { endoApplied.volume = vol; try { p.setVolume(vol); } catch (e) {} }
    var muted = !!st.isMuted;
    if (endoApplied.muted !== muted) { endoApplied.muted = muted; try { if (muted) p.mute(); else p.unMute(); } catch (e) {} }

    /* play/pause (não reinicia sozinho um vídeo que terminou sem loop) */
    var s = -9;
    try { s = p.getPlayerState(); } catch (e) {}
    if (!S) return;
    if (st.playing) {
      if (!endoEnded && s !== S.PLAYING && s !== S.BUFFERING) { try { p.playVideo(); } catch (e) {} }
    } else if (s === S.PLAYING || s === S.BUFFERING) {
      try { p.pauseVideo(); } catch (e) {}
    }
    /* ENDED que o evento não avisou (Silk): leitura direta. Logo após um comando o estado
       ainda pode ser o antigo (ENDED): não conclui "terminou" nessa mesma leitura. */
    if (s === S.ENDED && !endoEnded && !newNonce) endoOnEnded();
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

  /* ---------------- agenda por item (dias, horário, validade) ----------------
     Guardada em playlists.items (JSONB): days [0-6, 0=domingo], start/end "HH:MM", from/until "AAAA-MM-DD".
     Item sem agenda toca sempre. Falha ao ler a agenda = toca tudo (nunca deixa a tela vazia). */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function itemActive(it) {
    var sc = it && it.sched;
    if (!sc) return true;
    var d = cfNow();                            /* agenda sempre na hora de Maceió */
    var today = cfYmd(d);
    if (sc.from && today < sc.from) return false;
    if (sc.until && today > sc.until) return false;
    if (sc.days && sc.days.length) {
      var ok = false;
      for (var i = 0; i < sc.days.length; i++) if (sc.days[i] === d.getUTCDay()) ok = true;
      if (!ok) return false;
    }
    if (sc.start || sc.end) {
      var hm = pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
      var st = sc.start || "00:00", en = sc.end || "23:59";
      if (st <= en) { if (hm < st || hm > en) return false; }
      else if (hm < st && hm > en) return false; /* janela que cruza a meia-noite */
    }
    return true;
  }
  function pickIndex(from) {
    for (var k = 0; k < items.length; k++) {
      var j = (from + k) % items.length;
      if (itemActive(items[j]) && !ytIsBad(items[j])) return j;
    }
    return -1;
  }

  /* Vídeos do YouTube que falharam NESTE aparelho (indisponível, bloqueado, não inicia):
     após 2 falhas seguidas, ficam fora do rodízio por 2 h e depois são testados de novo.
     Assim um vídeo problemático não custa espera/tela parada a cada volta da playlist. */
  var ytFails = {}, ytBadUntil = {}, YT_BAD_MS = 2 * 60 * 60 * 1000;
  function isYoutubeItem(it) {
    return !!(it && (it.type === "youtube" || /(^|\/\/|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)/i.test(String(it.url || ""))));
  }
  function itemYtId(it) {
    return it && (it.type === "youtube" || (it.type !== "image" && ytId(it.url))) ? ytId(it.url) : "";
  }
  function ytIsBad(it) {
    var v = itemYtId(it);
    return !!(v && ytBadUntil[v] && new Date().getTime() < ytBadUntil[v]);
  }
  function ytMarkFail(v) {
    ytFails[v] = (ytFails[v] || 0) + 1;
    if (ytFails[v] >= 2) { ytBadUntil[v] = new Date().getTime() + YT_BAD_MS; ytFails[v] = 0; }
  }
  function ytMarkOk(v) { ytFails[v] = 0; ytBadUntil[v] = 0; }
  function attachSched(list, playlistId, cb) {
    if (!playlistId || !list.length) { cb(); return; }
    req("GET", "/rest/v1/playlists?id=eq." + playlistId + "&select=items", null, function (err, pls) {
      try {
        if (!err && pls && pls.length && pls[0].items && pls[0].items.length) {
          var src = pls[0].items.slice(0);
          src.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
          var used = {};
          for (var i = 0; i < list.length; i++) {
            for (var k = 0; k < src.length; k++) {
              var sr = src[k];
              if (used[k] || !sr || sr.media_id !== list[i].media_id) continue;
              used[k] = true;
              if ((sr.days && sr.days.length) || sr.start || sr.end || sr.from || sr.until) {
                list[i].sched = { days: sr.days || null, start: sr.start || null, end: sr.end || null, from: sr.from || null, until: sr.until || null };
              }
              break;
            }
          }
        }
      } catch (e) {}
      cb();
    });
  }
  /* ---------------- relatorio de exibicao (contadores agregados) ----------------
     Conta cada exibicao em memoria e envia o total a cada 5 min (rpc log_plays). Se a migration
     ainda nao existir ou a rede falhar, mantem os contadores (limite 200) e tenta de novo depois;
     apos 3 falhas seguidas pausa por 1 h. Nunca interfere na reproducao. */
  var playCounts = {}, playFails = 0, playPauseUntil = 0, PLAY_FLUSH_MS = 5 * 60 * 1000;
  function countPlay(mediaId) {
    if (!mediaId || String(mediaId).length < 30) return; /* so uuid (fotos do mural nao entram) */
    var n = 0, k;
    for (k in playCounts) if (playCounts.hasOwnProperty(k)) n++;
    if (n >= 200 && !playCounts[mediaId]) return;
    playCounts[mediaId] = (playCounts[mediaId] || 0) + 1;
  }
  function flushPlays() {
    if (!tvId || new Date().getTime() < playPauseUntil) return;
    var list = [], k;
    for (k in playCounts) if (playCounts.hasOwnProperty(k)) list.push({ m: k, n: playCounts[k] });
    if (!list.length) return;
    var sent = playCounts;
    playCounts = {};
    req("POST", "/rest/v1/rpc/log_plays", { _tv: tvId, _items: list }, function (err) {
      if (!err) { playFails = 0; return; }
      for (var m in sent) if (sent.hasOwnProperty(m)) playCounts[m] = (playCounts[m] || 0) + sent[m];
      if (++playFails >= 3) { playPauseUntil = new Date().getTime() + 60 * 60 * 1000; playFails = 0; }
    });
  }

  var schedTimer = null;
  function failsafeNoItem() {
    /* nenhum item programado para este horário: tela institucional e nova checagem em 20 s */
    clearAllTimers(); token++;
    emptyMsg.innerHTML = "CENTERFRIOS &mdash; Crescendo com voc&ecirc;";
    emptyCode.innerHTML = "";
    screenMode("empty");
    timers.item = setTimeout(function () {
      var n = pickIndex(0);
      if (n < 0) { failsafeNoItem(); return; }
      idx = n; screenMode(""); render();
    }, 20000);
  }

  /* ---------------- playlist (RPC + fallback direto) ---------------- */
  function loadPlaylist(playlistId, eventMode) {
    var resolved = [];

    function finish() {
      attachSched(resolved, playlistId, function () {
        if (eventMode) { appendEventPhotos(resolved, apply); return; }
        apply();
      });
    }

    function apply() {
      /* durante o Endomarketing: só guarda a playlist nova; a tela é do modo */
      if (endoActive) {
        if (resolved.length) { items = resolved; idx = 0; lastSignature = ""; lsSet(K_PL, JSON.stringify(resolved)); }
        return;
      }
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
        sig += resolved[i].media_id + "|" + resolved[i].url + "|" + resolved[i].duration + "|" + (resolved[i].sched ? JSON.stringify(resolved[i].sched) : "") + ",";
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
    ytDestroy(ytA); ytDestroy(ytB);
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
    if (isLive || endoActive || !items.length) return;
    screenMode("");
    if (playing) return;
    playing = true;
    render();
  }

  function advance() {
    if (pendingReload) { try { flushPlays(); } catch (e) {} setTimeout(function () { window.location.reload(); }, 1500); return; }
    if (!playing || isLive) return;
    var n = pickIndex(idx + 1);
    if (n < 0) { failsafeNoItem(); return; }
    idx = n;
    render();
  }

  function render() {
    if (isLive || endoActive || !items.length) return;
    clearAllTimers();
    token++;
    var my = token;
    var item = items[idx % items.length];
    if (item && (!itemActive(item) || ytIsBad(item))) {
      var pn = pickIndex(idx + 1);
      if (pn < 0) { failsafeNoItem(); return; }
      idx = pn; item = items[idx];
    }
    if (!item || !item.url) { scheduleFail(); return; }
    countPlay(item.media_id);

    updateCornerQr();

    /* qualquer link do YouTube vai para a API de iframes (link sem ID válido é pulado lá) */
    if (isYoutubeItem(item) || (item.type !== "image" && ytId(item.url))) renderYoutube(item, my);
    else if (item.type === "video") renderVideo(item, my);
    else renderImage(item, my);
  }

  function scheduleFail() {
    timers.item = setTimeout(advance, 2000);
  }

  function crossfade(nextEl, prevEls) {
    nextEl.className = "media on";
    for (var i = 0; i < prevEls.length; i++) {
      (function (el) {
        if (!el || el === nextEl) return;
        el.className = "media";
        setTimeout(function () {
          if (el === nextEl) return;
          if (el.tagName === "VIDEO") releaseVideo(el);        // libera o decoder (RAM no Silk)
          else if (el === ytA.el || el === ytB.el) {           // libera o webview do YouTube
            ytDestroy(el === ytA.el ? ytA : ytB);
          } else el.removeAttribute("src");
        }, FADE_MS + 100);
      })(prevEls[i]);
    }
  }

  function renderVideo(item, my) {
    var el = idleVideo;
    var other = activeVideo;

    function go() {
      if (my !== token) return;
      /* Aplica áudio pendente ANTES do play — elemento já tem readyState >= 3,
         decoder inicializado: não há renegociação de pipeline no Silk.
         Após o 1º desbloqueio, só mexemos em .volume. */
      if (_pendingAudio) {
        if (!_audioUnlocked && el.muted !== _pendingAudio.muted) el.muted = _pendingAudio.muted;
        if (Math.abs(el.volume - _pendingAudio.vol) > 0.001) el.volume = _pendingAudio.vol;
      }
      try { el.currentTime = 0; } catch (e) {}
      var pr;
      try { pr = el.play(); } catch (e) { pr = null; }
      if (pr && typeof pr["catch"] === "function") {
        pr["catch"](function () {
          if (!_audioUnlocked) { el.muted = true; }
          else { el.volume = 0; }
          try { el.play(); } catch (e2) {}
        });
      }
      crossfade(el, [other, activeImg, idleImg, activeYt.el]);
      activeVideo = el; idleVideo = other;
      /* vigia: se o vídeo nunca começar a tocar (sem 'playing' nem 'waiting'), avança em 20 s.
         O onplaying substitui este timer pelo watchdog da duração real. */
      clearTimer("hard");
      timers.hard = setTimeout(function () { if (my === token) { diag("video nao iniciou"); advance(); } }, 20000);
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
      crossfade(el, [other, activeVideo, idleVideo, activeYt.el]);
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
    var ni = pickIndex(idx + 1);          /* respeita agenda e vídeos com falha */
    if (ni < 0 || ni === idx % items.length) return;
    var next = items[ni];
    if (!next || !next.url) return;
    var nextYt = itemYtId(next);
    if (nextYt) {
      /* mesmo princípio do double buffer de MP4: cueVideoById no slot oculto, sem play */
      whenYtReady(function () {
        if (idleYt.player && idleYt.videoId === nextYt) return;
        idleYt.h = null;
        ytCreate(idleYt, nextYt, false);
      });
      return;
    }
    /* YouTube é SEMPRE da API de iframes: nunca baixar pelo <video>/<img> (link inválido = só pula) */
    if (isYoutubeItem(next)) return;
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

  /* ---------------- YouTube: double buffer de iframes ---------------- */
  /* NOTA: controls=0&modestbranding=1&rel=0 apenas limpa a interface do embed.
     Isso NÃO remove anúncios — a exibição de anúncios é definida pelo dono do
     vídeo/monetização do canal, não pelo player nem pelos parâmetros do embed. */

  function ytId(u) {
    if (!u) return "";
    u = String(u);
    if (/^[A-Za-z0-9_-]{11}$/.test(u)) return u;
    var m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : "";
  }

  function loadYtApi() {
    if (ytApiReady || ytApiLoading) return;
    ytApiLoading = true;
    var s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  }

  /* callback global exigido pela API oficial do YouTube */
  window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true; ytApiLoading = false;
    var q = ytQueue; ytQueue = [];
    for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) {} }
  };

  function whenYtReady(fn) {
    if (ytApiReady && window.YT && window.YT.Player) { fn(); return; }
    ytQueue.push(fn);
    loadYtApi();
  }

  function ytDestroy(slot) {
    if (!slot || !slot.el) return;
    if (slot.player) { try { slot.player.destroy(); } catch (e) {} }
    slot.player = null; slot.videoId = ""; slot.ready = false; slot.h = null;
    slot.el.className = "media";
    slot.el.innerHTML = '<div id="' + slot.holder + '"></div>';
  }

  function ytCreate(slot, videoId, autoplay) {
    var h = slot.h;                 /* ytDestroy zera os handlers: preserva os do item atual */
    ytDestroy(slot);
    slot.h = h;
    slot.videoId = videoId;
    try {
      slot.player = new window.YT.Player(slot.holder, {
        videoId: videoId,
        width: "100%",
        height: "100%",
        /* origin/widget_referrer: o YouTube passou a exigir a identificação do site que incorpora
           (sem ela: "Erro de configuração do player"/"Vídeo indisponível" em alguns aparelhos) */
        playerVars: {
          autoplay: autoplay ? 1 : 0, controls: 0, modestbranding: 1, rel: 0,
          playsinline: 1, fs: 0, disablekb: 1, iv_load_policy: 3,
          origin: window.location.protocol + "//" + window.location.host,
          widget_referrer: window.location.href
        },
        events: {
          onReady: function () {
            slot.ready = true;
            ytApplyAudio(slot);
            if (slot.h && slot.h.onReady) slot.h.onReady();
          },
          onStateChange: function (e) { if (slot.h && slot.h.onStateChange) slot.h.onStateChange(e); },
          onError: function (e) { if (slot.h && slot.h.onError) slot.h.onError(e); }
        }
      });
    } catch (e) { slot.player = null; }
  }

  function ytSetAudio(slot, muted, volume) {
    if (!slot || !slot.player || !slot.ready) return;
    try {
      slot.player.setVolume(Math.round(Math.min(100, Math.max(0, volume))));
      if (muted) slot.player.mute(); else slot.player.unMute();
    } catch (e) {}
  }

  /* mesma fonte de verdade do vídeo nativo: tv.muted / tv.volume */
  function ytApplyAudio(slot) {
    var volume = (tv && typeof tv.volume === "number") ? tv.volume : 100;
    var muted = !tv || tv.muted !== false;
    ytSetAudio(slot, muted, volume);
  }

  /* YouTube: o iframe só aparece na tela quando o vídeo REALMENTE começa a tocar.
     Enquanto isso, a mídia anterior continua visível. Assim a tela de erro do YouTube
     ("Vídeo indisponível", "Erro de configuração", botão de play parado) nunca é exibida:
     se não tocar em 20 s, ou se o player reportar erro, pula para o próximo item.
     Tudo é conferido também por leitura direta (getPlayerState/getVideoData a cada 1 s),
     porque no Silk os eventos do iframe (postMessage) às vezes não chegam. */
  var YT_START_MS = 20000, YT_FROZEN_S = 20;

  function renderYoutube(item, my) {
    var vid = ytId(item.url);
    if (!vid) { scheduleFail(); return; }
    var slot = idleYt, other = activeYt;
    var started = false, shown = false, finished = false, lastT = -1, still = 0, hardFromDuration = false;

    function st() { return window.YT && window.YT.PlayerState; }

    function fail(why) {
      if (my !== token || finished) return;
      finished = true;
      clearTimer("ytpoll");
      ytMarkFail(vid);
      diag(why);
      if (!shown) ytDestroy(slot);          /* nunca apareceu: descarta o iframe com erro */
      advance();
    }

    function end() {
      if (my !== token || finished) return;
      finished = true;
      clearTimer("ytpoll");
      advance();
    }

    function reveal() {
      if (my !== token || shown || finished) return;
      shown = true;
      clearTimer("canplay");
      ytMarkOk(vid);
      diag("");
      crossfade(slot.el, [other.el, activeVideo, idleVideo, activeImg, idleImg]);
      activeYt = slot; idleYt = other;
      var d = 0;
      try { d = slot.player.getDuration(); } catch (x) {}
      clearTimer("hard");
      hardFromDuration = !!(d && isFinite(d) && d > 0);
      var secs = hardFromDuration ? d + 8 : 900;   // watchdog dinâmico
      timers.hard = setTimeout(end, secs * 1000);
      /* pré-carrega DEPOIS da limpeza do crossfade (que destrói o slot antigo do YouTube) */
      setTimeout(function () { if (my === token) preloadNext(); }, FADE_MS + 300);
    }

    function check() {
      if (my !== token) { clearTimer("ytpoll"); return; }
      var S = st();
      if (!S || !slot.player) return;
      var s = -9, t = 0, ec = "";
      try { s = slot.player.getPlayerState(); } catch (e) {}
      try { var vd = slot.player.getVideoData(); ec = vd && vd.errorCode ? String(vd.errorCode) : ""; } catch (e) {}
      if (ec) { fail("youtube indisponivel (" + ec + ")"); return; }
      if (s === S.ENDED) { if (shown) end(); else fail("youtube nao iniciou"); return; }
      if (!shown) {
        if (s === S.PLAYING) reveal();
        else if (s === S.PAUSED || s === S.CUED || s === -1) { try { slot.player.playVideo(); } catch (e) {} }
        return;
      }
      /* duração só conhecida depois (ex.: após um anúncio): ajusta o watchdog ao tempo real */
      if (!hardFromDuration) {
        var dd = 0;
        try { dd = slot.player.getDuration(); } catch (e) {}
        if (dd && isFinite(dd) && dd > 0) {
          hardFromDuration = true;
          var cur = 0;
          try { cur = slot.player.getCurrentTime() || 0; } catch (e) {}
          clearTimer("hard");
          timers.hard = setTimeout(end, (Math.max(0, dd - cur) + 8) * 1000);
        }
      }
      /* já na tela: se o tempo não anda, avança. Tocando (pode ser anúncio): 90 s;
         pausado/carregando/parado: 20 s, tentando retomar a cada 5 s. */
      try { t = slot.player.getCurrentTime(); } catch (e) {}
      if (t !== lastT) { lastT = t; still = 0; return; }
      still++;
      if (still >= (s === S.PLAYING ? 90 : YT_FROZEN_S)) { end(); return; }
      if (still % 5 === 0 && s !== S.BUFFERING && s !== S.PLAYING) { try { slot.player.playVideo(); } catch (e) {} }
    }

    function go() {
      if (my !== token || started || !slot.player) return;
      started = true;
      try { slot.player.playVideo(); } catch (e) {}
      ytApplyAudio(slot);
      clearTimer("ytpoll");
      timers.ytpoll = setInterval(check, 1000);
    }

    slot.h = {
      onReady: go,
      onStateChange: function (e) {
        if (my !== token) return;
        var S = st();
        if (!S) return;
        if (e.data === S.PLAYING) reveal();
        else if (e.data === S.ENDED && shown) end();
      },
      onError: function (e) {
        fail("youtube indisponivel (" + (e && e.data) + ")");   // privado/removido/bloqueado: pula sem travar
      }
    };

    whenYtReady(function () {
      if (my !== token) return;
      if (slot.player && slot.videoId === vid) {
        if (slot.ready) go();             // já pré-carregado (cue): entra sem esperar rede
        return;                           // senão, onReady -> go
      }
      ytCreate(slot, vid, true);
    });

    timers.canplay = setTimeout(function () {                     // não começou a tocar: pula
      if (my !== token || shown) return;
      fail("youtube nao iniciou");
    }, YT_START_MS);
  }

  /* ---------------- go ---------------- */
  boot();
})();

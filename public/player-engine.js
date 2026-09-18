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

  /* Intervalo mínimo praticável sem abusar de APIs públicas gratuitas.
     Open-Meteo atualiza a fonte ~1x/hora e o Banco Central Europeu (cotação)
     ~1x/dia -- consultar mais rápido que isso não traz dado mais novo, só
     garante que a tela pegue a atualização assim que ela sai. */
  var WEATHER_MS = 60 * 1000;
  var CURRENCY_MS = 60 * 1000;

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
    showWeather: null, showCurrency: null
  };
  var weatherTimer = null, currencyTimer = null;

  /* ---------------- utils ---------------- */
  function ls(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function showEl(el, on) { el.style.display = on ? "block" : "none"; }
  function clearTimer(name) { if (timers[name]) { clearTimeout(timers[name]); timers[name] = null; } }
  function clearAllTimers() { clearTimer("item"); clearTimer("stall"); clearTimer("hard"); clearTimer("canplay"); clearTimer("ytpoll"); }
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
        row.countdown_label, row.countdown_ends_at, row.presence_logo_size,
        row.show_weather, row.show_currency].join("|");
      if (sig !== lastTvSig) { lastTvSig = sig; applyLayout(row); ytApplyAudio(activeYt); }

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

  function applyTicker(multizone, tickerPos, tickerTxt) {
    var tickerOn = multizone && tickerPos !== "hidden";
    var zoneTop = tickerOn && tickerPos === "top" ? "90px" : "0px";
    var zoneBottom = tickerOn && tickerPos !== "top" ? "90px" : "0px";

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
        tickerText.innerHTML = String(tickerTxt || "CENTERFRIOS — Crescendo com você").replace(/</g, "&lt;");
      }
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
      if (lastLayout.qrPos !== qrPos) {
        lastLayout.qrPos = qrPos;
        corner(cornerEl, qrPos);
      }
      if (lastLayout.logoSize !== logoSize) {
        lastLayout.logoSize = logoSize;
        var logoImg = cornerEl.querySelector("img.logo");
        if (logoImg) logoImg.style.height = Math.round(logoSize / 2) + "px";
        if (cornerQr) { cornerQr.style.height = logoSize + "px"; cornerQr.style.width = logoSize + "px"; }
      }
    }
    updateCornerQr();
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
      if (lastLayout.presencePos !== pos) { lastLayout.presencePos = pos; corner(presenceEl, pos); }
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

  function loadWeather() {
    if (!tv || !tv.show_weather) return;
    httpGetJson(
      "https://api.open-meteo.com/v1/forecast?latitude=-9.6498&longitude=-35.7089" +
        "&current=temperature_2m,weather_code&timezone=America%2FMaceio",
      function (err, data) {
        if (err || !data || !data.current) return; // mantém o último valor exibido
        var t = data.current.temperature_2m;
        if (typeof t === "number") weatherTemp.innerHTML = Math.round(t) + "&deg;C";
        weatherIcon.innerHTML = weatherEmojiFor(data.current.weather_code);
        showEl(weatherEl, true);
        weatherEl.style.display = "flex";
      }
    );
  }

  function loadCurrency() {
    if (!tv || !tv.show_currency) return;
    // Frankfurter (BCE, sem chave, sem limite de uso perceptível) em vez da
    // AwesomeAPI -- essa vinha batendo "limite de uso atingido" para o IP
    // compartilhado da Lovable. Pede BRL->USD/EUR e inverte (1/taxa) pra
    // exibir quantos BRL valem 1 USD / 1 EUR, que é o que faz sentido aqui.
    // .dev direto (nao .app, que faz redirect 301) -- Silk/Fire OS nao segue
    // bem redirect cross-origin em fetch(), a cotacao ficava sem atualizar.
    httpGetJson("https://api.frankfurter.dev/v1/latest?from=BRL&to=USD,EUR", function (err, data) {
      if (err || !data || !data.rates) return; // mantém o último valor exibido
      var usd = data.rates.USD ? 1 / data.rates.USD : 0;
      var eur = data.rates.EUR ? 1 / data.rates.EUR : 0;
      var html = "";
      if (usd && isFinite(usd)) html += "<span>US$ " + usd.toFixed(2) + "</span>";
      if (eur && isFinite(eur)) html += "<span>&euro; " + eur.toFixed(2) + "</span>";
      if (!html) return;
      currencyEl.innerHTML = html;
      currencyEl.style.display = "flex";
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

    if (item.type === "youtube" || (item.type !== "image" && ytId(item.url))) renderYoutube(item, my);
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
    var next = items[(idx + 1) % items.length];
    if (!next || !next.url) return;
    var nextYt = (next.type === "youtube" || (next.type !== "image" && ytId(next.url))) ? ytId(next.url) : "";
    if (nextYt) {
      /* mesmo princípio do double buffer de MP4: cueVideoById no slot oculto, sem play */
      whenYtReady(function () {
        if (idleYt.player && idleYt.videoId === nextYt) return;
        idleYt.h = null;
        ytCreate(idleYt, nextYt, false);
      });
      return;
    }
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
    ytDestroy(slot);
    slot.videoId = videoId;
    try {
      slot.player = new window.YT.Player(slot.holder, {
        videoId: videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: autoplay ? 1 : 0, controls: 0, modestbranding: 1, rel: 0,
          playsinline: 1, fs: 0, disablekb: 1, iv_load_policy: 3
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

  function renderYoutube(item, my) {
    var vid = ytId(item.url);
    if (!vid) { scheduleFail(); return; }
    var slot = idleYt, other = activeYt;
    var started = false;

    function go() {
      if (my !== token || started || !slot.player) return;
      started = true;
      clearTimer("canplay");
      try { slot.player.playVideo(); } catch (e) {}
      ytApplyAudio(slot);
      crossfade(slot.el, [other.el, activeVideo, idleVideo, activeImg, idleImg]);
      activeYt = slot; idleYt = other;
      preloadNext();
      /* Rede de segurança: em alguns Fire TV Stick/Silk o postMessage de
         onStateChange(ENDED) as vezes nao chega (o iframe do YouTube fica
         parado na tela de "replay" e o player nunca avanca). getPlayerState()
         e uma leitura direta do objeto, nao depende do evento chegar --
         confere a cada 2s como um fallback independente do listener. */
      clearTimer("ytpoll");
      timers.ytpoll = setInterval(function () {
        if (my !== token) { clearTimer("ytpoll"); return; }
        var st = window.YT && window.YT.PlayerState;
        if (!st || !slot.player) return;
        try {
          if (slot.player.getPlayerState() === st.ENDED) { clearTimer("ytpoll"); advance(); }
        } catch (e) {}
      }, 2000);
    }

    slot.h = {
      onReady: go,
      onStateChange: function (e) {
        if (my !== token) return;
        var st = window.YT && window.YT.PlayerState;
        if (!st) return;
        if (e.data === st.PLAYING) {
          clearTimer("hard");
          var d = 0;
          try { d = slot.player.getDuration(); } catch (x) {}
          var secs = (d && isFinite(d) && d > 0) ? d + 8 : 900;   // watchdog dinâmico
          timers.hard = setTimeout(function () { if (my === token) advance(); }, secs * 1000);
        } else if (e.data === st.ENDED) {
          if (my === token) advance();
        }
      },
      onError: function () {
        if (my !== token) return;
        diag("youtube indisponivel");     // privado/removido/bloqueado: pula sem travar
        advance();
      }
    };

    whenYtReady(function () {
      if (my !== token) return;
      if (slot.player && slot.videoId === vid) {
        if (slot.ready) go();             // já pré-carregado (cue): entra sem esperar rede
        return;
      }
      ytCreate(slot, vid, true);
    });

    timers.canplay = setTimeout(function () {                     // segurança
      if (my !== token || started) return;
      if (slot.player && slot.ready) go(); else advance();
    }, 10000);
  }

  /* ---------------- go ---------------- */
  boot();
})();

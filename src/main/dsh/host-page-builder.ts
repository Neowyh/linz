/**
 * Generates the DSH host page HTML.
 *
 * The host page is served at `http://localhost:PORT/synapse-host` and contains:
 * 1. A view switch UI (对话 / 会话地图)
 * 2. An `<iframe>` loading the plugin SPA (e.g. `/synapse/`)
 * 3. A bridge script that translates between `window.dshBridge` (AeroMind IPC)
 *    and `postMessage` (the SPA's communication protocol)
 *
 * Both host and iframe share the same origin (http://localhost:PORT),
 * so the SPA's `event.origin === window.location.origin` check passes.
 *
 * The bridge script is a rewrite of DSH's `client.js` that uses
 * `window.dshBridge` instead of DSH's `ctx.sessions` / `ctx.workspaces`.
 */
export function buildHostPage(pluginRoute: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Plugin Host</title>
<style>
.dsh-switch{position:fixed;z-index:80;top:12px;left:50%;display:flex;gap:2px;transform:translateX(-50%);border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.96);padding:3px;backdrop-filter:blur(10px)}
.dsh-switch button{height:28px;border:0;border-radius:999px;background:transparent;padding:0 11px;color:#6b7280;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.dsh-switch button:hover{background:#f3f4f6;color:#111827}
.dsh-switch button.active{background:#111827;color:#fff}
.dsh-switch button:focus-visible{outline:2px solid #111827;outline-offset:2px}
.dsh-overlay{position:fixed;z-index:100;inset:0;background:#f5f7fa}
.dsh-overlay.is-opening{visibility:hidden}
.dsh-overlay[hidden]{display:none}
.dsh-overlay iframe{display:block;width:100%;height:100%;border:0}
</style>
</head>
<body>
<div class="dsh-host">
  <div class="dsh-switch" role="group" aria-label="视图切换">
    <button type="button" data-view="dialog" class="active" aria-pressed="true">对话</button>
    <button type="button" data-view="map" aria-pressed="false">会话地图</button>
  </div>
  <section class="dsh-overlay" hidden>
    <iframe title="会话地图" src="${pluginRoute}"></iframe>
  </section>
</div>
<script>
(function() {
  var bridge = window.dshBridge;
  if (!bridge) { console.error('[DSH Host] dshBridge not available'); return; }

  var host = document.querySelector('.dsh-host');
  var dialogBtn = host.querySelector('[data-view="dialog"]');
  var mapBtn = host.querySelector('[data-view="map"]');
  var overlay = host.querySelector('.dsh-overlay');
  var frame = host.querySelector('iframe');

  var currentSessionId = null;
  var liveUnsubscribers = {};
  var pollTimer = null;

  function setView(view) {
    var showingMap = view === 'map';
    dialogBtn.classList.toggle('active', !showingMap);
    dialogBtn.setAttribute('aria-pressed', String(!showingMap));
    mapBtn.classList.toggle('active', showingMap);
    mapBtn.setAttribute('aria-pressed', String(showingMap));
  }

  function close() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    overlay.classList.remove('is-opening');
    overlay.hidden = true;
    setView('dialog');
  }

  function send(type, payload) {
    if (frame.contentWindow) {
      frame.contentWindow.postMessage(Object.assign({ source: 'dsh-synapse', type: type }, payload || {}), location.origin);
    }
  }

  // ── Push data to the SPA iframe ──────────────────────────

  function syncTheme() {
    bridge.getTheme().then(function(t) { send('synapse:theme', { dark: t.dark }); });
  }

  function syncSessionsAndWorkspaces() {
    Promise.all([bridge.listSessions(), bridge.listWorkspaces()]).then(function(results) {
      var sessions = results[0] || [];
      var workspaces = results[1] || [];
      var accounted = {};
      workspaces.forEach(function(w) { (w.sessionIds || []).forEach(function(id) { accounted[id] = true; }); });
      var ungrouped = sessions.filter(function(s) { return !accounted[s.id]; }).map(function(s) { return s.id; });
      workspaces.push({ workspaceId: 'dsh-ungrouped', title: '未分组', path: null, sessionIds: ungrouped });
      send('synapse:workspaces', { workspaces: workspaces });

      // Push current session
      var current = currentSessionId || (sessions.length > 0 ? sessions[0].id : null);
      if (current) {
        var sess = sessions.find(function(s) { return s.id === current; });
        if (sess) send('synapse:current-session', { session: { id: sess.id, title: sess.displayTitle, cwd: sess.cwd } });
      }
    }).catch(function(err) { console.error('[DSH Host] syncSessions error:', err); });
  }

  function syncLiveSession(sessionId) {
    bridge.subscribeSession(sessionId, function(state) {
      if (overlay.hidden) return;
      var text = (state.partial && state.partial.blocks)
        ? state.partial.blocks.filter(function(b) { return b.kind === 'text'; }).map(function(b) { return b.text; }).join('\\n')
        : '';
      send('synapse:live-reply', { sessionId: sessionId, running: state.running, text: text });
    });
  }

  // ── Handle messages from the SPA iframe ──────────────────

  window.addEventListener('message', function(event) {
    if (event.origin !== location.origin || !event.data || event.data.source !== 'dsh-synapse') return;
    var data = event.data;

    if (data.type === 'synapse:close') return close();
    if (data.type === 'synapse:map-ready') return showMap();
    if (data.type === 'synapse:request-current') {
      syncSessionsAndWorkspaces();
      syncTheme();
      return;
    }
    if (data.type === 'synapse:open-session') {
      bridge.openSession(data.sessionId);
      close();
      return;
    }
    if (data.type === 'synapse:activate-session') {
      currentSessionId = data.sessionId;
      bridge.openSession(data.sessionId);
      return;
    }
    if (data.type === 'synapse:fork-session') {
      bridge.fork(data.sessionId, data.atSeq).then(function(result) {
        send('synapse:forked-session', { requestId: data.requestId, session: { id: result.id, title: result.title } });
        currentSessionId = result.id;
        syncSessionsAndWorkspaces();
        syncLiveSession(result.id);
      }).catch(function() {
        send('synapse:bridge-error', { requestId: data.requestId, message: '分支创建失败' });
      });
      return;
    }
    if (data.type === 'synapse:send-message') {
      var text = typeof data.text === 'string' ? data.text.trim() : '';
      if (text === '') {
        send('synapse:bridge-error', { requestId: data.requestId, message: '消息不能为空' });
        return;
      }
      bridge.prompt(data.sessionId, text).then(function(result) {
        if (result.ok) {
          send('synapse:message-sent', { requestId: data.requestId, sessionId: data.sessionId });
          syncLiveSession(data.sessionId);
        } else {
          send('synapse:bridge-error', { requestId: data.requestId, message: result.error && result.error.message || '消息发送失败' });
        }
      });
      return;
    }
    if (data.type === 'synapse:create-session') {
      bridge.createSession(data.cwd).then(function(result) {
        send('synapse:created-session', { requestId: data.requestId, session: { id: result.id, title: result.title, cwd: result.cwd } });
        currentSessionId = result.id;
        syncSessionsAndWorkspaces();
        syncLiveSession(result.id);
      }).catch(function() {
        send('synapse:bridge-error', { requestId: data.requestId, message: '会话创建失败' });
      });
      return;
    }
  });

  // ── View switch ──────────────────────────────────────────

  var mapOpening = false;
  var mapOpenFallback = 0;

  function showMap() {
    if (mapOpening) { mapOpening = false; }
    overlay.classList.remove('is-opening');
    syncSessionsAndWorkspaces();
    syncTheme();
  }

  function open() {
    clearTimeout(mapOpenFallback);
    mapOpening = true;
    setView('map');
    overlay.hidden = false;
    overlay.classList.add('is-opening');
    requestAnimationFrame(function() {
      send('synapse:map-opened');
      syncSessionsAndWorkspaces();
      syncTheme();
    });
    mapOpenFallback = setTimeout(showMap, 300);

    // Poll for session list changes while map is open
    if (!pollTimer) {
      pollTimer = setInterval(syncSessionsAndWorkspaces, 2000);
    }
  }

  dialogBtn.addEventListener('click', close);
  mapBtn.addEventListener('click', open);
  window.addEventListener('keydown', function(e) { if (e.key === 'Escape' && !overlay.hidden) close(); });

  // Initial sync
  syncTheme();
  syncSessionsAndWorkspaces();
})();
</script>
</body>
</html>`;
}

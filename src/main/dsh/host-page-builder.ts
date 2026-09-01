/**
 * Generates the DSH host page HTML.
 *
 * The host page is served at `http://localhost:PORT/synapse-host` and:
 * 1. Renders the plugin SPA in a full-viewport iframe (no view switch)
 * 2. Injects CSS into the iframe to hide the left sidebar
 * 3. Bridges between `window.dshBridge` (AeroMind IPC) and the SPA's
 *    `postMessage` protocol
 *
 * Both host and iframe share the same origin (http://localhost:PORT),
 * so the SPA's `event.origin === window.location.origin` check passes
 * and the host can inject styles into the iframe's document.
 */
export function buildHostPage(pluginRoute: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>会话地图</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  .dsh-frame { display: block; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe class="dsh-frame" src="${pluginRoute}"></iframe>
<script>
(function() {
  var bridge = window.dshBridge;
  if (!bridge) { console.error('[DSH Host] dshBridge not available'); return; }

  var frame = document.querySelector('.dsh-frame');
  var currentSessionId = null;
  var dataReady = false;

  function send(type, payload) {
    if (frame.contentWindow) {
      frame.contentWindow.postMessage(Object.assign({ source: 'dsh-synapse', type: type }, payload || {}), location.origin);
    }
  }

  // ── CSS injection: hide the SPA's left sidebar ───────────
  function injectSidebarHide() {
    try {
      var doc = frame.contentDocument;
      if (!doc) return;
      var style = doc.createElement('style');
      style.textContent =
        '.synapse-shell { grid-template-columns: 1fr !important; }' +
        '.sidebar { display: none !important; }' +
        '.topbar, .main-stage { grid-column: 1 !important; }';
      doc.head.appendChild(style);
    } catch (e) {
      console.warn('[DSH Host] CSS injection failed:', e);
    }
  }

  // ── Push data to the SPA ──────────────────────────────────

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

      var current = currentSessionId || (sessions.length > 0 ? sessions[0].id : null);
      if (current) {
        var sess = sessions.find(function(s) { return s.id === current; });
        if (sess) send('synapse:current-session', { session: { id: sess.id, title: sess.displayTitle, cwd: sess.cwd } });
      }
    }).catch(function(err) { console.error('[DSH Host] syncSessions error:', err); });
  }

  function syncLiveSession(sessionId) {
    bridge.subscribeSession(sessionId, function(state) {
      var text = (state.partial && state.partial.blocks)
        ? state.partial.blocks.filter(function(b) { return b.kind === 'text'; }).map(function(b) { return b.text; }).join('\\n')
        : '';
      send('synapse:live-reply', { sessionId: sessionId, running: state.running, text: text });
    });
  }

  function pushInitialData() {
    if (dataReady) return;
    dataReady = true;
    syncTheme();
    syncSessionsAndWorkspaces();
  }

  // ── Iframe load handler ───────────────────────────────────

  frame.addEventListener('load', function() {
    injectSidebarHide();
    // Tell the SPA the map is open so it initializes
    send('synapse:map-opened');
    pushInitialData();
  });

  // ── Handle messages from the SPA iframe ──────────────────

  window.addEventListener('message', function(event) {
    if (event.origin !== location.origin || !event.data || event.data.source !== 'dsh-synapse') return;
    var data = event.data;

    if (data.type === 'synapse:close') return;  // No overlay to close
    if (data.type === 'synapse:map-ready') return pushInitialData();
    if (data.type === 'synapse:request-current') {
      syncSessionsAndWorkspaces();
      syncTheme();
      return;
    }
    if (data.type === 'synapse:open-session') {
      // Switch conversation in the main chat sidebar (don't close the map)
      bridge.openSession(data.sessionId);
      currentSessionId = data.sessionId;
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
      syncLiveSession(data.sessionId);
      bridge.prompt(data.sessionId, text).then(function(result) {
        if (result.ok) {
          send('synapse:message-sent', { requestId: data.requestId, sessionId: data.sessionId });
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

  // ── Periodic refresh ──────────────────────────────────────
  // Poll for session/workspace changes while the map is visible
  setInterval(syncSessionsAndWorkspaces, 3000);
})();
</script>
</body>
</html>`;
}

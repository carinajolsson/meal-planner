// Reusable Dropbox sync for static PWAs. You shouldn't need to edit this file.
//
// Usage:
//   const sync = createDropboxSync({ appKey, filePath });
//   await sync.init();          // call once on page load (finishes sign-in after the Dropbox redirect)
//   sync.isConnected();         // true if this device is signed in
//   sync.connect();             // sends the user to Dropbox to sign in
//   sync.disconnect();          // forgets the sign-in on this device
//   await sync.read();          // returns your saved data, or null if nothing is saved yet
//   await sync.write(data);     // saves any JSON-serializable data
//
// read() and write() throw an Error with code "signed-out" when the user needs to connect again.
//
// Storage keys are prefixed with this site's path, so several sites on the same
// domain (like username.github.io/site-a/ and /site-b/) never overwrite each other.

(function () {
  function createDropboxSync({ appKey, filePath = "/data.json", storagePrefix }) {
    const redirectUri = location.origin + location.pathname.replace(/index\.html$/, "");
    const prefix = storagePrefix || "pwa:" + location.pathname.replace(/index\.html$/, "") + ":";
    const TOKEN_KEY = prefix + "dropbox-tokens";
    const PKCE_KEY = prefix + "dropbox-pkce";

    // ── storage
    const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
    const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
    const forget = (k) => { try { localStorage.removeItem(k); } catch {} };

    // ── PKCE helpers
    const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const randomString = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); };
    const sha256 = (t) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));

    function signedOut() {
      forget(TOKEN_KEY);
      const e = new Error("Connect Dropbox to sync.");
      e.code = "signed-out";
      return e;
    }

    function saveTokens(t) {
      const prev = load(TOKEN_KEY) || {};
      store(TOKEN_KEY, {
        access_token: t.access_token,
        refresh_token: t.refresh_token || prev.refresh_token,
        expires_at: Date.now() + (t.expires_in || 14400) * 1000,
      });
    }

    async function tokenRequest(params) {
      const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ client_id: appKey, ...params }),
      });
      return res;
    }

    async function accessToken() {
      const t = load(TOKEN_KEY);
      if (!t) throw signedOut();
      if (t.access_token && t.expires_at > Date.now() + 60000) return t.access_token;
      if (!t.refresh_token) throw signedOut();
      const res = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
      if (res.status === 400 || res.status === 401) throw signedOut();
      if (!res.ok) throw new Error("Couldn't reach Dropbox (" + res.status + ").");
      saveTokens(await res.json());
      return load(TOKEN_KEY).access_token;
    }

    async function init() {
      const q = new URLSearchParams(location.search);
      if (!q.has("code") && !q.has("error")) return;
      history.replaceState(null, "", redirectUri);

      if (q.has("error")) {
        throw new Error("Dropbox sign-in was cancelled or failed: " + (q.get("error_description") || q.get("error")));
      }
      const pkce = load(PKCE_KEY);
      forget(PKCE_KEY);
      if (!pkce || pkce.state !== q.get("state")) {
        throw new Error("Sign-in couldn't be verified. Connect Dropbox again.");
      }
      const res = await tokenRequest({
        code: q.get("code"),
        grant_type: "authorization_code",
        code_verifier: pkce.verifier,
        redirect_uri: redirectUri,
      });
      if (!res.ok) {
        throw new Error("Dropbox rejected the sign-in (" + res.status + "). Check that your Dropbox app's redirect URI is exactly " + redirectUri);
      }
      saveTokens(await res.json());
    }

    async function connect() {
      if (!appKey || appKey.startsWith("YOUR_")) {
        throw new Error("Add your Dropbox App key to config.js first.");
      }
      const verifier = randomString(64);
      const state = randomString(16);
      store(PKCE_KEY, { verifier, state });
      const params = new URLSearchParams({
        client_id: appKey,
        response_type: "code",
        code_challenge: b64url(await sha256(verifier)),
        code_challenge_method: "S256",
        redirect_uri: redirectUri,
        token_access_type: "offline",
        state,
      });
      location.href = "https://www.dropbox.com/oauth2/authorize?" + params;
    }

    async function read() {
      const token = await accessToken();
      const res = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": JSON.stringify({ path: filePath }) },
      });
      if (res.status === 409) return null; // nothing saved yet
      if (res.status === 401) throw signedOut();
      if (!res.ok) throw new Error("Couldn't read from Dropbox (" + res.status + ").");
      const text = await res.text();
      try { return JSON.parse(text); } catch { throw new Error("The file in Dropbox isn't valid JSON."); }
    }

    async function write(data) {
      const token = await accessToken();
      const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({ path: filePath, mode: "overwrite", mute: true }),
        },
        body: JSON.stringify(data),
      });
      if (res.status === 401) throw signedOut();
      if (!res.ok) throw new Error("Couldn't save to Dropbox (" + res.status + ").");
    }

    return {
      init,
      connect,
      read,
      write,
      isConnected: () => !!load(TOKEN_KEY),
      disconnect: () => forget(TOKEN_KEY),
      redirectUri,
    };
  }

  // Simple helper so apps can label which device saved something.
  function deviceName() {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return "Android";
    if (/iPhone|iPad/i.test(ua)) return "iPhone or iPad";
    if (/Macintosh/i.test(ua)) return "Mac";
    if (/Windows/i.test(ua)) return "Windows";
    return "another device";
  }

  window.createDropboxSync = createDropboxSync;
  window.deviceName = deviceName;
})();

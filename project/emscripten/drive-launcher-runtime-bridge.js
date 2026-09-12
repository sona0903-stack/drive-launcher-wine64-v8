
(function () {
  "use strict";

  const hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const TOKEN = hash.get("ddlToken") || "";
  // This adapter belongs only to a token-bound launcher iframe.
  // Keep the upstream standalone page and its boot smoke unchanged.
  if (!TOKEN || parent === window) return;
  const queued = [];
  let draining = false;

  function send(type, extra) {
    try {
      parent.postMessage(Object.assign({ type, token: TOKEN }, extra || {}), "*");
    } catch (_) {}
  }

  function canvas() {
    return document.getElementById("canvas");
  }

  function canvasInfo() {
    const c = canvas();
    if (!c) return { width: 1024, height: 768 };
    const r=c.getBoundingClientRect(); return { width: Number(c.width) || 1024, height: Number(c.height) || 768, left:r.left, top:r.top, displayWidth:r.width, displayHeight:r.height };
  }

  function postReady() {
    const M = window.Module;
    let ready = false;
    try { ready = location.pathname.includes("/win32/") ? !!window.isRunning : !!(window.crossOriginIsolated && M && M.FS && M.ccall && M.ccall("bw64_session_ready", "number", [], []) === 1 && (document.getElementById("output")?.value || "").includes("XWire: first window mapped")); } catch (_) {}
    if (!ready) { send("DDL_RUNTIME_STATUS", {text: "Wine64 booting · isolated=" + window.crossOriginIsolated + " · " + (document.getElementById("status")?.textContent || "")}); return; }
    if (!document.getElementById("ddl-fit-style")) { fitStyle.id="ddl-fit-style"; document.head.appendChild(fitStyle); }
    if(document.getElementById("loading"))document.getElementById("loading").style.display="none";
    const c = canvasInfo();
    send("DDL_RUNTIME_BRIDGE_READY", { canvasWidth: c.width, canvasHeight: c.height });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitFor(fnName, maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (typeof window[fnName] === "function") return window[fnName];
      await sleep(250);
    }
    return null;
  }

  async function runExe(msg) {
    if (!msg.buffer) throw new Error("No EXE buffer received");
    const name = String(msg.name || "PROGRAM.EXE").replace(/[\\/:*?"<>|]/g, "_");
    const file = new File([msg.buffer], name, { type: "application/octet-stream" });

    // Boxedwine64 bridge: exact public helper from wine64-launcher.js.
    const run64 = await waitFor("uploadAndRunExe", 360000);
    if (run64) {
      // ZIP-backed guest directories need a writable MEMFS upload directory.
      const fs = window.Module.FS;
      try {
        fs.mkdirTree("/root/home/username");
        const probe = "/root/home/username/.ddl-write-probe";
        fs.writeFile(probe, new Uint8Array([0]));
        fs.unlink(probe);
      } catch(e) {
        throw new Error("Wine upload directory unavailable: errno=" + e.errno + " " + e.message);
      }
      console.log("DDL: upload directory ready; injecting " + name + " (" + file.size + " bytes)");
      send("DDL_RUNTIME_STATUS", { text: "Win64 runtime received " + name });
      await run64(file);
      return;
    }

    // Original BoxedWine 32-bit web shell.
    const start32 = await waitFor("startWithFiles", 15000);
    if (start32) {
      send("DDL_RUNTIME_STATUS", { text: "Win32 runtime received " + name });
      start32([file]);

      // If the 32-bit shell exposes execute(), ask it to launch the uploaded EXE.
      // startWithFiles uploads into the guest drive; a short delay lets FileReader finish.
      await sleep(900);
      if (typeof window.execute === "function") {
        try { window.execute("/" + name); } catch (_) {}
      }
      return;
    }

    throw new Error("No compatible BoxedWine upload function became available");
  }

  function dispatchMouse(msg) {
    const c = canvas();
    if (!c) throw new Error("Runtime canvas not found");
    const r = c.getBoundingClientRect();
    const cw = Number(c.width) || 1024;
    const ch = Number(c.height) || 768;
    const clientX = r.left + (Number(msg.x) / cw) * r.width;
    const clientY = r.top + (Number(msg.y) / ch) * r.height;
    const init = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: Number(msg.button) || 0,
      buttons: 1
    };

    if (msg.action === "click") {
      c.dispatchEvent(new MouseEvent("mousemove", init));
      c.dispatchEvent(new MouseEvent("mousedown", init));
      c.dispatchEvent(new MouseEvent("mouseup", Object.assign({}, init, { buttons: 0 })));
      c.dispatchEvent(new MouseEvent("click", Object.assign({}, init, { buttons: 0 })));
    } else {
      c.dispatchEvent(new MouseEvent(msg.action || "mousemove", init));
    }
  }

  function dispatchKey(msg) {
    const c = canvas() || document.body;
    const init = {
      bubbles: true,
      cancelable: true,
      key: msg.key || "",
      code: msg.code || "",
      ctrlKey: !!msg.ctrl,
      altKey: !!msg.alt,
      shiftKey: !!msg.shift
    };
    c.focus?.();
    c.dispatchEvent(new KeyboardEvent("keydown", init));
    c.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  async function dispatchText(msg) {
    const value = String(msg.text || "");
    for (const ch of value) {
      dispatchKey({ key: ch, code: "", ctrl: false, alt: false, shift: false });
      await sleep(16);
    }
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queued.length) {
        const msg = queued.shift();
        try {
          if (msg.type === "DDL_RUN_EXE") await runExe(msg);
          else if (msg.type === "DDL_POINTER") dispatchMouse(msg);
          else if (msg.type === "DDL_KEY") dispatchKey(msg);
          else if (msg.type === "DDL_TEXT") await dispatchText(msg);
        } catch (e) {
          send("DDL_RUNTIME_ERROR", { message: e && e.message ? e.message : String(e) });
        }
      }
    } finally {
      draining = false;
    }
  }

  addEventListener("message", ev => {
    if (ev.source !== parent) return;
    const msg = ev.data || {};
    if (!TOKEN || msg.token !== TOKEN) return;
    if (!/^DDL_/.test(String(msg.type || ""))) return;
    queued.push(msg);
    drain();
  });

  const fitStyle=document.createElement("style");fitStyle.textContent="body{margin:0!important;padding:0!important;background:#000} #dropzone{position:fixed;inset:0;display:grid;place-items:center;background:#000;z-index:3} #canvas{max-width:100vw;max-height:100vh;width:auto!important;height:auto!important} #loading{position:fixed;top:0;left:0;z-index:4;background:#172438;color:white}";
  addEventListener("load", () => {
    setTimeout(postReady, 0);
    setInterval(() => {
      const c = canvasInfo();
      send("DDL_CANVAS_INFO", c);
    }, 2000);
  });

  setInterval(postReady, 1000);
  if (document.readyState === "complete") postReady();
  else setTimeout(postReady, 500);
})();

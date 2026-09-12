
(function () {
  "use strict";

  const hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const TOKEN = hash.get("ddlToken") || "";
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
    return { width: Number(c.width) || 1024, height: Number(c.height) || 768 };
  }

  function postReady() {
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
      send("DDL_RUNTIME_STATUS", { text: "Win64 runtime received " + name });
      run64(file);
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

  addEventListener("load", () => {
    setTimeout(postReady, 0);
    setInterval(() => {
      const c = canvasInfo();
      send("DDL_CANVAS_INFO", c);
    }, 2000);
  });

  if (document.readyState === "complete") postReady();
  else setTimeout(postReady, 500);
})();

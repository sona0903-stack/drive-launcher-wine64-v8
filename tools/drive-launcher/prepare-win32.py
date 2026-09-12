from pathlib import Path
import urllib.request, hashlib
out = Path("_site/win32")
out.mkdir(parents=True, exist_ok=True)
base = "https://boxedwine.org/v/26R1/wine11/st/"
for name in ["boxedwine.html","boxedwine.css","boxedwine-shell.js","boxedwine.js","boxedwine.wasm","boxedwine.zip"]:
    data=urllib.request.urlopen(base+name, timeout=120).read()
    (out/name).write_bytes(data)
    print(name, len(data), hashlib.sha256(data).hexdigest())
html=(out/"boxedwine.html").read_text()
setup="""<script>
Config.storageMode = STORAGE_MEMORY;
const ddlHash = new URLSearchParams(location.hash.slice(1));
Config.urlParams = "auto=true&sound=false&resolution=1024x768&p=PROGRAM.EXE&app-payload=" + (ddlHash.get("payload") || "");
</script>
<script src="../drive-launcher-runtime-bridge.js"></script>"""
html=html.replace('<script src="boxedwine-shell.js"></script>','<script src="boxedwine-shell.js"></script>'+setup)
(out/"boxedwine.html").write_text(html)

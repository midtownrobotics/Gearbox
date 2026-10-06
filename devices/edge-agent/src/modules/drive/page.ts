import { appTitle, wordmark } from "@g3/site-config";

/**
 * The shop drive's web page, served by the box itself on the LAN. Fully
 * self-contained (no fonts, scripts, or images from the internet), so opening
 * it uses no hotspot data. Colors mirror the palette in packages/ui.
 */
export const DRIVE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${appTitle("Shop Drive")}</title>
<style>
  :root {
    --primary-50: #f8e6e8; --primary-200: #e8a5af; --primary-500: #a32035; --primary-600: #8b1a2c;
    --gray-50: #f8f8f8; --gray-100: #efefef; --gray-200: #e0e0e0; --gray-400: #8a8a8a;
    --gray-500: #5a5a5a; --gray-900: #1a1a1a; --ok: #10b981;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.4 system-ui, sans-serif; background: var(--gray-50); color: var(--gray-900); }
  header { background: #fff; border-bottom: 1px solid var(--gray-200); padding: 0 16px; height: 56px; display: flex; align-items: center; gap: 12px; }
  header b { color: var(--primary-500); font-size: 22px; letter-spacing: .03em; }
  header span { color: var(--gray-400); font-size: 13px; }
  main { max-width: 900px; margin: 0 auto; padding: 20px 16px; display: grid; gap: 16px; }
  .card { background: #fff; border: 1px solid var(--gray-200); border-radius: 12px; padding: 16px; }
  .bar { height: 8px; border-radius: 99px; background: var(--gray-100); overflow: hidden; margin-top: 8px; }
  .bar > div { height: 100%; background: var(--primary-500); }
  .muted { color: var(--gray-500); font-size: 13px; }
  #drop { border: 2px dashed var(--gray-200); border-radius: 12px; padding: 28px 16px; text-align: center; cursor: pointer; }
  #drop.over { border-color: var(--primary-500); background: var(--primary-50); }
  button { font: inherit; font-size: 13px; border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; background: transparent; color: var(--gray-500); }
  button:hover { background: var(--gray-100); color: var(--gray-900); }
  .primary { background: var(--primary-500); color: #fff; }
  .primary:hover { background: var(--primary-600); color: #fff; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--gray-100); }
  li:first-child { border-top: 0; }
  li a { color: var(--gray-900); font-weight: 500; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
  li a:hover { color: var(--primary-500); }
  .size { color: var(--gray-500); font-size: 13px; white-space: nowrap; }
  .error { color: var(--primary-600); background: var(--primary-50); border: 1px solid var(--primary-200); border-radius: 8px; padding: 8px 12px; }
  .upload { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; font-size: 13px; }
  .upload .bar { grid-column: 1 / -1; margin-top: 0; }
  .upload.done .bar > div { background: var(--ok); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<header><b>${wordmark("Shop Drive")}</b><span>Files stay on the shop network</span></header>
<main>
  <div id="error" class="error" hidden></div>
  <section class="card">
    <div><strong id="used">…</strong> <span class="muted" id="total"></span></div>
    <div class="bar"><div id="usedbar" style="width:0"></div></div>
  </section>
  <section class="card">
    <div id="drop">
      <p style="margin:0 0 10px">Drag files here, or</p>
      <button class="primary" type="button" id="pick">Choose files</button>
      <input type="file" id="input" multiple hidden>
      <p class="muted" style="margin:10px 0 0">Uploads and downloads go straight to the box over the shop network, not the internet.</p>
    </div>
    <div id="uploads" style="display:grid;gap:10px;margin-top:12px"></div>
  </section>
  <section class="card">
    <ul id="files"></ul>
    <p id="empty" class="muted" hidden>No files yet.</p>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const fmt = (n) => { const u = ["B","KB","MB","GB","TB"]; let i = 0; while (n >= 1000 && i < 4) { n /= 1000; i++; } return (i && n < 100 ? n.toFixed(1) : Math.round(n)) + " " + u[i]; };
const ago = (t) => { const s = Date.now() / 1000 - t; return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : new Date(t * 1000).toLocaleDateString(); };
function showError(msg) { $("error").textContent = msg; $("error").hidden = !msg; }

async function load() {
  try {
    const res = await fetch("api/files");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't load files.");
    showError("");
    $("used").textContent = fmt(data.used) + " used";
    $("total").textContent = "of " + fmt(data.total) + " · " + fmt(data.free) + " free";
    $("usedbar").style.width = Math.min(100, data.used / data.total * 100) + "%";
    $("files").replaceChildren(...data.files.map(fileRow));
    $("empty").hidden = data.files.length > 0;
  } catch (e) { showError(e.message); }
}

function fileRow(f) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = "files/" + encodeURIComponent(f.name);
  a.textContent = f.name;
  a.title = "Download " + f.name;
  const size = document.createElement("span");
  size.className = "size";
  size.textContent = fmt(f.size) + " · " + ago(f.modifiedAt);
  const del = document.createElement("button");
  del.textContent = "Delete";
  del.onclick = async () => {
    if (!confirm("Delete " + f.name + " for everyone?")) return;
    const res = await fetch("api/files/" + encodeURIComponent(f.name), { method: "DELETE" });
    if (!res.ok) showError((await res.json().catch(() => ({}))).error || "Delete failed.");
    load();
  };
  li.append(a, size, del);
  return li;
}

// Uploads run one at a time, each with its own progress bar.
let queue = Promise.resolve();
function upload(files) {
  for (const file of files) {
    const row = document.createElement("div");
    row.className = "upload";
    row.innerHTML = '<span class="name"></span><span class="pct muted">waiting</span><div class="bar"><div style="width:0"></div></div>';
    row.querySelector(".name").textContent = file.name;
    $("uploads").prepend(row);
    queue = queue.then(() => new Promise((done) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", "api/files/" + encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        row.querySelector(".bar > div").style.width = (e.loaded / e.total * 100) + "%";
        row.querySelector(".pct").textContent = fmt(e.loaded) + " of " + fmt(e.total);
      };
      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status === 200) {
          row.classList.add("done");
          row.querySelector(".bar > div").style.width = "100%";
          row.querySelector(".pct").textContent = body.name && body.name !== file.name ? "uploaded as " + body.name : "done";
        } else {
          row.querySelector(".pct").textContent = body.error || "failed";
        }
        load();
        done();
      };
      xhr.onerror = () => { row.querySelector(".pct").textContent = "failed (connection lost)"; done(); };
      xhr.send(file);
    }));
  }
}

$("pick").onclick = () => $("input").click();
$("input").onchange = (e) => { upload(e.target.files); e.target.value = ""; };
const drop = $("drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); upload(e.dataTransfer.files); };
load();
</script>
</body>
</html>
`;

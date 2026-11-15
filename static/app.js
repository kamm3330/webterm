/* WebTerm – Frontend */
(() => {
"use strict";

// ------------------------------------------------------------------ Farbschemata
const ANSI_KEYS = ["black","red","green","yellow","blue","magenta","cyan","white",
  "brightBlack","brightRed","brightGreen","brightYellow","brightBlue","brightMagenta","brightCyan","brightWhite"];
const ANSI_NAMES = ["Schwarz","Rot","Grün","Gelb","Blau","Magenta","Cyan","Weiß"];
const MAIN_KEYS = [
  ["background", "Hintergrund"], ["foreground", "Text"],
  ["cursor", "Cursor"], ["cursorAccent", "Text unter Cursor"],
  ["selectionBackground", "Markierung"],
];
const pal = (s) => Object.fromEntries(s.split(" ").map((c, i) => [ANSI_KEYS[i], "#" + c]));
const VGA = "000000 aa0000 00aa00 aa5500 0000aa aa00aa 00aaaa aaaaaa 555555 ff5555 55ff55 ffff55 5555ff ff55ff 55ffff ffffff";
const SOL = "073642 dc322f 859900 b58900 268bd2 d33682 2aa198 eee8d5 002b36 cb4b16 586e75 657b83 839496 6c71c4 93a1a1 fdf6e3";
const PRESETS = {
  "Neon Matrix": { background:"#0a0a0a", foreground:"#00ff41", cursor:"#ff0080", cursorAccent:"#0a0a0a", selectionBackground:"#00521a",
    ...pal("0a0a0a ff0080 00ff41 ffff00 0080ff ff0080 00ffff c0c0c0 404040 ff4080 40ff80 ffff80 4080ff ff40ff 40ffff ffffff") },
  "Standard (dunkel)": { background:"#1e1e1e", foreground:"#d4d4d4", cursor:"#aeafad", cursorAccent:"#1e1e1e", selectionBackground:"#264f78",
    ...pal("000000 cd3131 0dbc79 e5e510 2472c8 bc3fbc 11a8cd e5e5e5 666666 f14c4c 23d18b f5f543 3b8eea d670d6 29b8db ffffff") },
  "Linux-Konsole": { background:"#000000", foreground:"#aaaaaa", cursor:"#aaaaaa", cursorAccent:"#000000", selectionBackground:"#555555", ...pal(VGA) },
  "Solarized Dunkel": { background:"#002b36", foreground:"#839496", cursor:"#93a1a1", cursorAccent:"#002b36", selectionBackground:"#0e4a5a", ...pal(SOL) },
  "Solarized Hell": { background:"#fdf6e3", foreground:"#657b83", cursor:"#586e75", cursorAccent:"#fdf6e3", selectionBackground:"#e3dcc6", ...pal(SOL) },
  "Dracula": { background:"#282a36", foreground:"#f8f8f2", cursor:"#f8f8f2", cursorAccent:"#282a36", selectionBackground:"#44475a",
    ...pal("21222c ff5555 50fa7b f1fa8c bd93f9 ff79c6 8be9fd f8f8f2 6272a4 ff6e6e 69ff94 ffffa5 d6acff ff92df a4ffff ffffff") },
  "Gruvbox Dunkel": { background:"#282828", foreground:"#ebdbb2", cursor:"#ebdbb2", cursorAccent:"#282828", selectionBackground:"#504945",
    ...pal("282828 cc241d 98971a d79921 458588 b16286 689d6a a89984 928374 fb4934 b8bb26 fabd2f 83a598 d3869b 8ec07c ebdbb2") },
  "Nord": { background:"#2e3440", foreground:"#d8dee9", cursor:"#d8dee9", cursorAccent:"#2e3440", selectionBackground:"#434c5e",
    ...pal("3b4252 bf616a a3be8c ebcb8b 81a1c1 b48ead 88c0d0 e5e9f0 4c566a bf616a a3be8c ebcb8b 81a1c1 b48ead 8fbcbb eceff4") },
  "Hell": { background:"#ffffff", foreground:"#383a42", cursor:"#526eff", cursorAccent:"#ffffff", selectionBackground:"#c9d0e0",
    ...pal("383a42 e45649 50a14f c18401 0184bc a626a4 0997b3 d0d0d0 4f525e e06c75 3f953a b08000 61afef c678dd 56b6c2 888888") },
  "Retro Grün": { background:"#050d06", foreground:"#33ff66", cursor:"#33ff66", cursorAccent:"#050d06", selectionBackground:"#1d4d2a", ...pal(VGA) },
  "Retro Bernstein": { background:"#120c02", foreground:"#ffb000", cursor:"#ffb000", cursorAccent:"#120c02", selectionBackground:"#4d3500", ...pal(VGA) },
};
const CUSTOM = "Benutzerdefiniert";

const DEFAULTS = {
  fontSize: 15, fontFamily: "DejaVu Sans Mono", lineHeight: 1.0, bold: true,
  preset: "Neon Matrix", colors: { ...PRESETS["Neon Matrix"] },
  cursorStyle: "block", cursorBlink: true, scrollback: 5000,
  copyOnSelect: false, hideBarFs: true, confirmClose: true, keyDebug: false,
};
const STORE_KEY = "webterm.settings.v1";

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return { ...DEFAULTS, ...s, colors: { ...DEFAULTS.colors, ...(s.colors || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch {}
}
let cfg = loadSettings();

// ------------------------------------------------------------------ Terminals (Tabs)
const $ = (id) => document.getElementById(id);
const fontStack = (f) => `"${f.replace(/"/g, "")}", "DejaVu Sans Mono", "Liberation Mono", monospace`;
const enc = new TextEncoder();

const termOptions = () => ({
  fontSize: cfg.fontSize, fontFamily: fontStack(cfg.fontFamily), lineHeight: cfg.lineHeight,
  fontWeightBold: cfg.bold ? "bold" : "normal",
  theme: { ...cfg.colors }, cursorStyle: cfg.cursorStyle, cursorBlink: cfg.cursorBlink,
  scrollback: cfg.scrollback,
});

// Aufbau: Jeder Tab enthält einen Layout-Baum.
//   Blatt:  { s: Sitzung, parent }
//   Teilung: { dir: "row" (nebeneinander) | "col" (untereinander), kids: [Knoten, Knoten], parent }
const sessions = [];
const tabs = [];         // { root, focus: Sitzung, view: HTMLElement }
let cur = null;          // aktive (fokussierte) Sitzung
let curTab = null;
let nextId = 1;
let quitting = false;

const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const ro = new ResizeObserver((entries) => { for (const en of entries) refit(en.target._s); });

// Sitzung anlegen (noch ohne Terminal – das braucht ein sichtbares Element zum Messen)
function createSession(tab) {
  const s = { id: nextId++, ws: null, alive: false, ended: null, closed: false, title: "", tab };
  s.box = mk("div", "paneBox");
  s.box._s = s;
  s.pane = mk("div", "termPane");
  s.ov = mk("div", "paneOverlay");
  s.ov.hidden = true;
  s.ov.innerHTML = '<div class="box"><p></p><button class="primary">Neue Sitzung (Enter)</button></div>';
  s.ov.querySelector("button").onclick = () => connect(s);
  s.box.append(s.pane, s.ov);
  // Klick oder Fokus in einem Bereich macht ihn zum aktiven Terminal
  s.box.addEventListener("mousedown", () => { if (cur !== s && !s.closed) activate(s); });
  s.box.addEventListener("focusin", () => { if (cur !== s && !s.closed) activate(s); });
  return s;
}

function openTerm(s) {
  const term = s.term = new Terminal({ ...termOptions(), allowProposedApi: true,
    macOptionIsMeta: true, rightClickSelectsWord: false, drawBoldTextInBrightColors: true });
  s.fit = new FitAddon.FitAddon();
  term.loadAddon(s.fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  try { term.loadAddon(new Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion = "11"; } catch {}
  term.open(s.pane);

  term.onData((d) => send(s, enc.encode(d)));
  term.onBinary((d) => {           // Maus-Ereignisse im "binary"-Format
    const b = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i++) b[i] = d.charCodeAt(i) & 0xff;
    send(s, b);
  });
  term.onResize(() => sendResize(s));
  term.onTitleChange((t) => { s.title = t; renderTabs(); });
  term.onSelectionChange(() => { if (cfg.copyOnSelect && term.hasSelection()) copyText(term.getSelection()); });
  term.attachCustomKeyEventHandler((e) => keyHandler(e, s));
  ro.observe(s.box);
}

// Layout-Baum eines Tabs in DOM-Elemente umsetzen (vorhandene Terminals werden nur umgehängt)
function renderLayout(tab) {
  const build = (n) => {
    if (n.s) return n.s.box;
    const d = mk("div", "split " + n.dir);
    for (const k of n.kids) d.appendChild(build(k));
    return d;
  };
  tab.view.replaceChildren(build(tab.root));
  tab.view.classList.toggle("multi", !tab.root.s);
}
const leaves = (n) => n.s ? [n.s] : n.kids.flatMap(leaves);

// Neuer Tab mit einem Terminal
function newSession() {
  const tab = { view: mk("div", "tabView") };
  $("termWrap").appendChild(tab.view);
  const s = createSession(tab);
  tab.root = s.leaf = { s, parent: null };
  tab.focus = s;
  tabs.push(tab);
  sessions.push(s);
  renderLayout(tab);
  showTab(tab);                 // erst sichtbar machen, dann öffnen
  openTerm(s);
  activate(s);
  connect(s);
  return s;
}

// Aktives Terminal teilen: dir = "row" (nebeneinander) oder "col" (untereinander)
function splitSession(dir) {
  if (!cur) return newSession();
  const old = cur, tab = old.tab, node = old.leaf;
  const s = createSession(tab);
  const a = { s: old, parent: node }, b = { s, parent: node };
  delete node.s;
  node.dir = dir; node.kids = [a, b];
  old.leaf = a; s.leaf = b;
  sessions.push(s);
  renderLayout(tab);
  openTerm(s);
  activate(s);
  connect(s);
  return s;
}

function showTab(tab) {
  curTab = tab;
  for (const t of tabs) t.view.classList.toggle("active", t === tab);
}

function activate(s) {
  cur = s;
  s.tab.focus = s;
  showTab(s.tab);
  for (const o of sessions) o.box.classList.toggle("focus", o === s);
  renderTabs();
  updateStatus();
  setTimeout(() => refitTab(s.tab), 80);   // nach dem Umbau des Layouts noch einmal anpassen
  requestAnimationFrame(() => {
    refitTab();
    if (cur !== s) return;
    if (s.ended) s.ov.querySelector("button").focus(); else s.term.focus();
  });
}

function closeSession(s, force) {
  if (s.closed) return;
  if (!force && cfg.confirmClose && s.alive &&
      !confirm("Dieses Terminal schließen? Die laufende Shell wird beendet.")) return;
  s.closed = true;
  if (s.ws) { s.ws.onclose = null; try { s.ws.close(); } catch {} }
  ro.unobserve(s.box);
  s.term.dispose();
  s.box.remove();
  sessions.splice(sessions.indexOf(s), 1);

  const tab = s.tab, leaf = s.leaf, p = leaf.parent;
  let next;
  if (!p) {                                   // letztes Terminal im Tab -> Tab weg
    const ti = tabs.indexOf(tab);
    tabs.splice(ti, 1);
    tab.view.remove();
    if (!tabs.length) { newSession(); return; }
    next = tabs[Math.min(ti, tabs.length - 1)].focus;
  } else {                                    // Nachbarbereich übernimmt den Platz
    const sib = p.kids.find((k) => k !== leaf);
    delete p.dir; delete p.kids;
    if (sib.s) { p.s = sib.s; p.s.leaf = p; }
    else { p.dir = sib.dir; p.kids = sib.kids; for (const k of p.kids) k.parent = p; }
    if (tab.focus === s) tab.focus = leaves(p)[0];
    renderLayout(tab);
    next = tab.focus;
  }
  if (cur === s) activate(next);
  else { renderTabs(); if (cur) activate(cur); }
}

// ganzen Tab (mit allen geteilten Terminals) schließen
function closeTab(tab) {
  const list = leaves(tab.root);
  if (cfg.confirmClose && list.some((s) => s.alive) && !confirm(list.length > 1
      ? `Diesen Tab mit ${list.length} Terminals schließen? Die laufenden Shells werden beendet.`
      : "Dieses Terminal schließen? Die laufende Shell wird beendet.")) return;
  for (const s of list) closeSession(s, true);
}

function switchTab(delta) {
  if (tabs.length < 2) return;
  const i = tabs.indexOf(curTab);
  activate(tabs[(i + delta + tabs.length) % tabs.length].focus);
}

function renderTabs() {
  const host = $("tabs");
  host.textContent = "";
  tabs.forEach((t, i) => {
    const s = t.focus, n = leaves(t.root).length;
    const tab = mk("div", "tab" + (t === curTab ? " active" : "") + (s.alive ? "" : " dead"));
    const name = s.title || "Terminal";
    tab.title = `${name}${n > 1 ? `\n${n} Terminals (geteilt)` : ""}\n(Mittelklick schließt)`;
    const lab = mk("span", "tabLabel");
    lab.textContent = `${i + 1}: ${name}${n > 1 ? ` [${n}]` : ""}`;
    const x = mk("button", "tabClose");
    x.title = n > 1 ? "Tab schließen" : "Terminal schließen"; x.innerHTML = "&#x2715;";
    x.onclick = (e) => { e.stopPropagation(); closeTab(t); };
    tab.append(lab, x);
    tab.addEventListener("mousedown", (e) => {
      if (e.button === 1) { e.preventDefault(); closeTab(t); }
      else if (e.button === 0 && e.target !== x) { e.preventDefault(); activate(t.focus); }
    });
    host.appendChild(tab);
  });
  document.title = cur && cur.title ? `${cur.title} – WebTerm` : "WebTerm";
}

function refit(s = cur) {
  if (!s || !s.term || s.closed || !s.box.offsetWidth || !s.box.offsetHeight) return;
  try { s.fit.fit(); } catch {}
}
function refitTab(tab = curTab) {
  if (tab) for (const s of leaves(tab.root)) refit(s);
}

function applySettings() {
  for (const s of sessions) {
    const o = termOptions();
    for (const k of Object.keys(o)) s.term.options[k] = o[k];
  }
  document.documentElement.style.setProperty("--term-bg", cfg.colors.background);
  $("sizeLabel").textContent = cfg.fontSize + " px";
  document.body.classList.toggle("fs-hide", !!document.fullscreenElement && cfg.hideBarFs);
  $("keyDiag").hidden = !cfg.keyDebug;
  saveSettings();
  requestAnimationFrame(() => refitTab());
}

// ------------------------------------------------------------------ Verbindung
function setStatus(cls, text) {
  const st = $("status"); st.className = "status " + cls; st.textContent = text;
}
function updateStatus() {
  const s = cur;
  if (!s) return;
  if (s.alive) setStatus("on", "verbunden");
  else if (s.ws && s.ws.readyState === WebSocket.CONNECTING) setStatus("wait", "verbinde …");
  else setStatus("off", "getrennt");
}

function connect(s = cur) {
  if (s.ws) { s.ws.onclose = null; try { s.ws.close(); } catch {} }
  s.ended = null; s.alive = false;
  s.ov.hidden = true;
  refit(s);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams(location.search);
  params.set("cols", s.term.cols); params.set("rows", s.term.rows);
  const ws = s.ws = new WebSocket(`${proto}//${location.host}/ws?${params}`);
  ws.binaryType = "arraybuffer";
  updateStatus();
  ws.onopen = () => {
    s.alive = true; updateStatus(); renderTabs();
    s.term.reset();
    if (s === cur) s.term.focus();
    sendResize(s);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      try { if (JSON.parse(ev.data).t === "exit") { s.alive = false; ended(s, "Die Shell wurde beendet.", true); } } catch {}
      return;
    }
    s.term.write(new Uint8Array(ev.data));
  };
  ws.onclose = () => {
    if (s.closed) return;
    if (s.alive) ended(s, "Verbindung zum Server verloren.");
    else if (!s.ended) ended(s, "Verbindung nicht möglich. Läuft webterm.py?");
    s.alive = false;
    updateStatus(); renderTabs();
  };
}

// Sitzung zu Ende: bei mehreren Tabs schließt "exit" einfach den Tab
function ended(s, text, exited) {
  if (exited && sessions.length > 1) { closeSession(s, true); return; }
  s.ended = text;
  updateStatus(); renderTabs();
  s.ov.querySelector("p").textContent = text;
  s.ov.hidden = false;
  if (s === cur) s.ov.querySelector("button").focus();
}
function send(s, data) {
  if (s.ws && s.ws.readyState === WebSocket.OPEN) s.ws.send(data);
}
function sendResize(s) {
  send(s, JSON.stringify({ t: "r", c: s.term.cols, r: s.term.rows }));
}
$("btnNew").onclick = () => newSession();
$("btnSplitV").onclick = () => splitSession("row");
$("btnSplitH").onclick = () => splitSession("col");

// ------------------------------------------------------------------ Uhr
function tick() {
  const d = new Date(), c = $("clock");
  c.textContent = d.toLocaleTimeString("de-DE");
  c.title = d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  setTimeout(tick, 1000 - d.getMilliseconds() + 5);   // genau zum Sekundenwechsel
}
tick();

// ------------------------------------------------------------------ QUIT
function quitAll() {
  if (cfg.confirmClose && sessions.some((s) => s.alive) &&
      !confirm("Alle Terminals beenden und das Browserfenster schließen?")) return;
  quitting = true;
  for (const s of sessions) {      // Verbindung trennen -> Server beendet die Shells
    s.closed = true;
    if (s.ws) { s.ws.onclose = null; try { s.ws.close(); } catch {} }
  }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  window.close();
  // Hat der Browser das Schließen verweigert, steht die Seite noch da
  setTimeout(() => { document.body.classList.add("quit"); $("bye").hidden = false; }, 300);
}
$("btnQuit").onclick = quitAll;
$("btnRestart").onclick = () => location.reload();

// ------------------------------------------------------------------ Kopieren
async function copyText(text) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); return; } catch {}
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch {}
  ta.remove(); cur.term.focus();
}

// ------------------------------------------------------------------ Vollbild
async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } else {
      await document.exitFullscreen();
    }
  } catch (e) { console.warn("Vollbild nicht möglich:", e); }
}
document.addEventListener("fullscreenchange", async () => {
  const fs = !!document.fullscreenElement;
  if (fs && navigator.keyboard && navigator.keyboard.lock) {
    // Alle Tasten (auch Esc, F11, Strg+W …) an die Seite geben – nur Chromium-Browser
    try { await navigator.keyboard.lock(); } catch {}
  } else if (!fs && navigator.keyboard && navigator.keyboard.unlock) {
    navigator.keyboard.unlock();
  }
  $("btnFull").innerHTML = fs ? "&#x2715; Vollbild beenden" : "&#x26F6; Vollbild";
  document.body.classList.toggle("fs-hide", fs && cfg.hideBarFs);
  document.body.classList.remove("bar-peek");
  setTimeout(() => { refitTab(); if (cur && !cur.ended) cur.term.focus(); }, 60);
});
$("btnFull").onclick = toggleFullscreen;
// Leiste im Vollbild einblenden, wenn die Maus an den oberen Rand geht
$("hoverZone").addEventListener("mouseenter", () => document.body.classList.add("bar-peek"));
$("bar").addEventListener("mouseleave", () => document.body.classList.remove("bar-peek"));

// ------------------------------------------------------------------ Tastatur
function changeFont(delta) {
  cfg.fontSize = delta === 0 ? DEFAULTS.fontSize : Math.min(40, Math.max(8, cfg.fontSize + delta));
  applySettings(); syncForm();
}

// Steuertasten selbst übersetzen, falls xterm sie verwerfen würde
// (keyCode 229 = IME/Bildschirmtastatur/TV-Browser -> xterm ignoriert dann Pfeile usw.)
const CSI = "\x1b[";
function navSeq(e) {
  const app = cur.term.modes && cur.term.modes.applicationCursorKeysMode;
  const mod = 1 + (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0);
  const c = (ch) => mod > 1 ? `${CSI}1;${mod}${ch}` : (app ? "\x1bO" : CSI) + ch;
  const tilde = (n) => mod > 1 ? `${CSI}${n};${mod}~` : `${CSI}${n}~`;
  switch (e.key) {
    case "ArrowUp": case "Up": return c("A");
    case "ArrowDown": case "Down": return c("B");
    case "ArrowRight": case "Right": return c("C");
    case "ArrowLeft": case "Left": return c("D");
    case "Home": return c("H");
    case "End": return c("F");
    case "Insert": return tilde(2);
    case "Delete": case "Del": return tilde(3);
    case "PageUp": return tilde(5);
    case "PageDown": return tilde(6);
    case "Enter": return "\r";
    case "Backspace": return "\x7f";
    case "Tab": return e.shiftKey ? CSI + "Z" : "\t";
    case "Escape": case "Esc": return "\x1b";
  }
  return null;
}

function keyDiag(e, how) {
  if (!cfg.keyDebug) return;
  $("keyDiag").textContent = `${e.key} | ${e.code || "-"} | ${e.keyCode} → ${how}`;
}

// Eigene Kürzel (alle mit Strg+Umschalt, damit sie Linux-Programmen nicht im Weg sind)
function keyHandler(e, s) {
  if (e.type === "keydown") {
    if (e.keyCode === 229 || e.isComposing) {
      const seq = navSeq(e);
      if (seq) { e.preventDefault(); send(s, enc.encode(seq)); keyDiag(e, "eigen"); return false; }
    }
    keyDiag(e, "xterm");
  }
  if (e.type !== "keydown" || !(e.ctrlKey && e.shiftKey) || e.altKey || e.metaKey) return true;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) {
    e.preventDefault();
    const t = tabs[+digit[1] - 1];
    if (t) activate(t.focus);
    return false;
  }
  switch (e.code) {
    case "KeyF": e.preventDefault(); toggleFullscreen(); return false;
    case "KeyX": e.preventDefault(); closeSession(s); return false;
    case "KeyE": e.preventDefault(); splitSession("row"); return false;
    case "KeyO": e.preventDefault(); splitSession("col"); return false;
    case "KeyC":
      e.preventDefault();
      if (s.term.hasSelection()) copyText(s.term.getSelection());
      return false;
    case "KeyV": return false;   // Browser löst das native Einfügen aus -> xterm verarbeitet es
    case "Enter": case "NumpadEnter": e.preventDefault(); newSession(); return false;
    case "PageUp": e.preventDefault(); switchTab(-1); return false;
    case "PageDown": e.preventDefault(); switchTab(+1); return false;
    case "Equal": case "NumpadAdd": case "BracketRight": e.preventDefault(); changeFont(+1); return false;
    case "Minus": case "NumpadSubtract": case "Slash": e.preventDefault(); changeFont(-1); return false;
    case "Digit0": case "Numpad0": e.preventDefault(); changeFont(0); return false;
    case "Comma": e.preventDefault(); openSettings(); return false;
  }
  return true;
}

// Browser-Standardaktionen für F-Tasten & Alt unterdrücken (z. B. F10 = Firefox-Menüleiste,
// F1 = Hilfe, F3 = Suche, F5 = Neu laden, F7 = Caret-Browsing), solange das Terminal aktiv ist.
const termHasFocus = () => $("termWrap").contains(document.activeElement);
const isFKey = (e) => /^F([1-9]|1[0-2])$/.test(e.key);
// Tasten, die der Browser sonst selbst nutzt (Scrollen, Fokus wechseln, Zurück, TV-Navigation).
// KEINE druckbaren Zeichen (z. B. Leertaste): xterm braucht dafür das keypress-Ereignis,
// das durch preventDefault auf keydown wegfallen würde.
const NAV_KEYS = new Set(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Up","Down","Left","Right",
  "Home","End","PageUp","PageDown","Tab","Backspace","Escape","Esc"]);
for (const type of ["keydown", "keyup"]) {
  window.addEventListener(type, (e) => {
    if (quitting || !cur) return;
    if (!$("settings").hidden && $("settings").contains(e.target)) return;
    if (cur.ended) return;
    const inTerm = termHasFocus();
    if (isFKey(e) || (type === "keyup" && e.key === "Alt") || (inTerm && NAV_KEYS.has(e.key))) {
      e.preventDefault();
    }
    // Tastendruck außerhalb des Terminals (z. B. nach Klick auf einen Knopf):
    // Terminal fokussieren und die Taste trotzdem weitergeben
    if (!inTerm && type === "keydown" && !e.ctrlKey && !e.metaKey) {
      const seq = navSeq(e) || (isFKey(e) ? null : (e.key.length === 1 ? e.key : null));
      cur.term.focus();
      if (seq) { e.preventDefault(); send(cur, enc.encode(seq)); keyDiag(e, "umgeleitet"); }
    }
  }, true);
}
// Klick irgendwo in den Terminalbereich / zurück ins Fenster -> Terminal hat den Fokus
$("termWrap").addEventListener("mousedown", () => setTimeout(() => { if (cur && !cur.ended) cur.term.focus(); }, 0));
window.addEventListener("focus", () => { if (!quitting && $("settings").hidden && cur && !cur.ended) cur.term.focus(); });
document.addEventListener("keydown", (e) => {
  if (quitting || !cur || !cur.ended) return;
  if (e.key === "Enter") { e.preventDefault(); connect(cur); }
  // Auch in einem beendeten Bereich: Strg+Umschalt+X schließt ihn
  else if (e.ctrlKey && e.shiftKey && e.code === "KeyX") { e.preventDefault(); closeSession(cur, true); }
});

window.addEventListener("beforeunload", (e) => {
  if (!quitting && cfg.confirmClose && sessions.some((s) => s.alive)) { e.preventDefault(); e.returnValue = ""; }
});

// ------------------------------------------------------------------ Einstellungs-Dialog
const presetSel = $("preset");
for (const name of [...Object.keys(PRESETS), CUSTOM]) presetSel.add(new Option(name, name));

const colorInputs = {};
function colorItem(key, label, host, compact) {
  const lab = document.createElement("label");
  lab.className = "cItem"; lab.title = label;
  const inp = document.createElement("input");
  inp.type = "color";
  inp.addEventListener("input", () => {
    cfg.colors[key] = inp.value; cfg.preset = CUSTOM; presetSel.value = CUSTOM; applySettings();
  });
  lab.appendChild(inp);
  if (!compact) lab.append(label);
  host.appendChild(lab);
  colorInputs[key] = inp;
}
MAIN_KEYS.forEach(([k, l]) => colorItem(k, l, $("mainColors")));
const ansiHost = $("ansiColors");
const lbl = document.createElement("div"); lbl.className = "ansiLabel";
lbl.innerHTML = ANSI_NAMES.map((n) => `<span>${n}</span>`).join("");
ansiHost.appendChild(lbl);
ANSI_KEYS.forEach((k, i) => colorItem(k, (i < 8 ? "" : "Hell-") + ANSI_NAMES[i % 8], ansiHost, true));

// <input type=color> kennt nur #rrggbb
const hex6 = (c) => /^#[0-9a-f]{6}$/i.test(c) ? c :
  /^#[0-9a-f]{3}$/i.test(c) ? "#" + [...c.slice(1)].map((x) => x + x).join("") : "#000000";

function syncForm() {
  $("fontSize").value = $("fontSizeNum").value = cfg.fontSize;
  $("fontFamily").value = cfg.fontFamily;
  $("lineHeight").value = cfg.lineHeight; $("lineHeightOut").value = (+cfg.lineHeight).toFixed(2);
  $("bold").checked = cfg.bold;
  presetSel.value = cfg.preset in PRESETS ? cfg.preset : CUSTOM;
  for (const [k, inp] of Object.entries(colorInputs)) inp.value = hex6(cfg.colors[k] || "#000000");
  $("cursorStyle").value = cfg.cursorStyle;
  $("cursorBlink").checked = cfg.cursorBlink;
  $("scrollback").value = cfg.scrollback;
  $("copyOnSelect").checked = cfg.copyOnSelect;
  $("hideBarFs").checked = cfg.hideBarFs;
  $("confirmClose").checked = cfg.confirmClose;
  $("keyDebug").checked = cfg.keyDebug;
}

const bind = (id, ev, fn) => $(id).addEventListener(ev, (e) => { fn(e.target); applySettings(); syncForm(); });
bind("fontSize", "input", (t) => cfg.fontSize = +t.value);
bind("fontSizeNum", "change", (t) => cfg.fontSize = Math.min(40, Math.max(8, +t.value || DEFAULTS.fontSize)));
bind("fontFamily", "change", (t) => cfg.fontFamily = t.value.trim() || DEFAULTS.fontFamily);
bind("lineHeight", "input", (t) => cfg.lineHeight = +t.value);
bind("bold", "change", (t) => cfg.bold = t.checked);
bind("preset", "change", (t) => { if (PRESETS[t.value]) { cfg.colors = { ...PRESETS[t.value] }; } cfg.preset = t.value; });
bind("cursorStyle", "change", (t) => cfg.cursorStyle = t.value);
bind("cursorBlink", "change", (t) => cfg.cursorBlink = t.checked);
bind("scrollback", "change", (t) => cfg.scrollback = Math.min(100000, Math.max(0, +t.value || 0)));
bind("copyOnSelect", "change", (t) => cfg.copyOnSelect = t.checked);
bind("hideBarFs", "change", (t) => cfg.hideBarFs = t.checked);
bind("confirmClose", "change", (t) => cfg.confirmClose = t.checked);
bind("keyDebug", "change", (t) => cfg.keyDebug = t.checked);

$("btnReset").onclick = () => {
  if (!confirm("Alle Einstellungen auf Standard zurücksetzen?")) return;
  cfg = structuredClone(DEFAULTS); applySettings(); syncForm();
};
$("btnExport").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" }));
  a.download = "webterm-einstellungen.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("btnImport").onclick = () => $("importFile").click();
$("importFile").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    cfg = { ...DEFAULTS, ...s, colors: { ...DEFAULTS.colors, ...(s.colors || {}) } };
    applySettings(); syncForm();
  } catch { alert("Datei konnte nicht gelesen werden."); }
  e.target.value = "";
};

function openSettings() { syncForm(); $("settings").hidden = false; $("btnClose").focus(); }
function closeSettings() { $("settings").hidden = true; cur.term.focus(); }
$("btnSettings").onclick = () => $("settings").hidden ? openSettings() : closeSettings();
$("btnClose").onclick = closeSettings;
$("settings").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeSettings(); } });
$("btnBigger").onclick = () => { changeFont(+1); cur.term.focus(); };
$("btnSmaller").onclick = () => { changeFont(-1); cur.term.focus(); };

if (!(navigator.keyboard && navigator.keyboard.lock)) {
  $("lockInfo").textContent = "Hinweis: Dieser Browser unterstützt keine Tastatursperre. " +
    "F11 und Strg+W/T/N bleiben hier beim Browser. Für volle Tastenkontrolle Chrome, Chromium oder Edge nutzen.";
} else if (!window.isSecureContext) {
  $("lockInfo").textContent = "Hinweis: Die Tastatursperre im Vollbild funktioniert nur über http://localhost " +
    "oder HTTPS, nicht über eine IP-Adresse mit http.";
}

// ------------------------------------------------------------------ Start
applySettings();
syncForm();
document.fonts && document.fonts.ready.then(() => refitTab());
newSession();
})();

// ============================================================================
// LINK TERMINAL (LT•01) — Physical URL Shortener Hardware & Cloud Controller
// Live API and browser-only demo resolver for the Link Terminal interface.
// ============================================================================
const API_BASE = "https://u3ykuix7nf.execute-api.us-east-1.amazonaws.com";
// Deployed build is intentionally Live-API-only. No browser demo fallback.
const USE_DEMO_DATA = false;

const DEMO_URLS = {
  LAB42: "https://docs.aws.amazon.com/",
  DOCS7: "https://developer.mozilla.org/",
  MAP01: "https://www.openstreetmap.org/",
  PY101: "https://docs.python.org/3/",
  SRU24: "https://www.sru.edu.in/"
};

// Demo mappings stay in browser storage; live mappings are sent only to the configured API.
const DEMO_STORAGE_KEY = "link-terminal-demo-mappings-v1";
try {
  const savedMappings = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) || "{}");
  if (savedMappings && typeof savedMappings === "object" && !Array.isArray(savedMappings)) {
    Object.assign(DEMO_URLS, savedMappings);
  }
} catch (_) {}
function persistDemoMappings() {
  try { localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(DEMO_URLS)); }
  catch (_) { toast("Browser storage is unavailable; mapping may not persist after refresh."); }
}

function normalizeApiBase(value) {
  const base = value.trim().replace(/\/+$/, "");
  if (!base) return "";
  const parsed = new URL(base);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API URL must use http:// or https://.");
  }
  return base.replace(/\/api$/i, "");
}

function apiEndpoint(path) {
  const base = API_BASE.replace(/\/+$/, "").replace(/\/api$/i, "");
  return `${base}/api/${path.replace(/^\/+/, "")}`;
}

function responseMessage(data, fallback) {
  const message = data && (data.error || data.message);
  return typeof message === "string" && message.trim() ? message : fallback;
}

// Character wheel includes A-Z, 0-9, plus 2 hardware action tokens:
// "✓" (Submit/Resolve directly from 3-button keypad) and "⌫" (Backspace)
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789✓⌫";
const MAX = 12;

let code = "";
let charIndex = 0;
let entering = false;
let busy = false;
let hwMode = "CHAR"; // "CHAR" (character wheel entry) or "PRESET" (EVM-style preset scroll)
let presetIndex = 0;
let soundOn = true;
let toastTimer;

const $ = (id) => document.getElementById(id);

// Compact, tactile interface sounds. AudioContext is resumed from the user's
// click gesture so Chrome/Edge autoplay restrictions are handled correctly.
let audioCtx = null;
async function playTone(kind) {
  if (!soundOn) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx || audioCtx.state === "closed") audioCtx = new Ctx();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    if (audioCtx.state !== "running") return;

    const now = audioCtx.currentTime;
    const presets = {
      tick:    { start: 520, end: 310, duration: 0.032, volume: 0.055, type: "triangle" },
      select:  { start: 640, end: 470, duration: 0.060, volume: 0.065, type: "sine" },
      error:   { start: 240, end: 170, duration: 0.115, volume: 0.060, type: "triangle" }
    };
    if (kind === "success") {
      [[520, 0], [740, 0.085]].forEach(([hz, offset]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const t = now + offset;
        osc.type = "sine";
        osc.frequency.setValueAtTime(hz, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.055, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.08);
      });
      return;
    }
    const s = presets[kind];
    if (!s) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, now);
    osc.type = s.type;
    osc.frequency.setValueAtTime(s.start, now);
    osc.frequency.exponentialRampToValueAtTime(s.end, now + s.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(s.volume, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + s.duration);
    osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
    osc.start(now); osc.stop(now + s.duration + 0.006);
    if (kind === "error") {
      window.setTimeout(() => { if (soundOn) void playTone("tick"); }, 135);
    }
  } catch (_) {
    // Sound is optional; controls and lookup must continue working if audio is blocked.
  }
}

// Pulse GPIO TX LED on hardware bezel
function pulseTxLed() {
  const tx = $("ledTx");
  if (!tx) return;
  tx.classList.add("on-amber");
  setTimeout(() => tx.classList.remove("on-amber"), 180);
}

// Log line to ESP32 Serial Monitor drawer
function logSerial(tag, text) {
  const box = $("serialLog");
  if (!box) return;
  const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const div = document.createElement("div");
  div.className = "serial-line";
  div.textContent = `[${t}] [${tag}] ${text}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// Highlight active hop in the 4-stage Cloud Architecture Pipeline
function setPipelineHop(stepIndex) {
  const ids = ["hopEsp32", "hopApiGw", "hopLambda", "hopDynamo"];
  ids.forEach((id, idx) => {
    const el = $(id);
    if (!el) return;
    if (stepIndex === idx) {
      el.classList.add("active-hop");
    } else {
      el.classList.remove("active-hop");
    }
  });
}

// Draw deterministic visual Matrix Code on the 64x64 Canvas for the resolved URL
function drawUrlMatrixCanvas(urlString) {
  const canvas = $("qrCanvas");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const size = 21;
  const scale = Math.floor(canvas.width / size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Simple hash stream from URL
  let hash = 2166136261;
  for (let i = 0; i < urlString.length; i++) {
    hash ^= urlString.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  function isFinderPattern(r, c) {
    const inTL = r < 7 && c < 7;
    const inTR = r < 7 && c >= size - 7;
    const inBL = r >= size - 7 && c < 7;
    return inTL || inTR || inBL;
  }

  function drawFinder(ox, oy) {
    ctx.fillStyle = "#142026";
    ctx.fillRect(ox * scale, oy * scale, 7 * scale, 7 * scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect((ox + 1) * scale, (oy + 1) * scale, 5 * scale, 5 * scale);
    ctx.fillStyle = "#146963";
    ctx.fillRect((ox + 2) * scale, (oy + 2) * scale, 3 * scale, 3 * scale);
  }

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  ctx.fillStyle = "#142026";
  let seed = Math.abs(hash) || 1234567;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isFinderPattern(r, c)) continue;
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      const bit = ((seed >>> 16) + r * 3 + c * 5 + urlString.charCodeAt((r + c) % urlString.length)) % 3 === 0;
      if (bit) {
        ctx.fillRect(c * scale, r * scale, scale, scale);
      }
    }
  }
}

function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

// Render Character Wheel Strip inside OLED
function renderPickerWheel() {
  const prev2 = CHARS[(charIndex - 2 + CHARS.length) % CHARS.length];
  const prev1 = CHARS[(charIndex - 1 + CHARS.length) % CHARS.length];
  const curr = CHARS[charIndex];
  const next1 = CHARS[(charIndex + 1) % CHARS.length];
  const next2 = CHARS[(charIndex + 2) % CHARS.length];

  const wheelEl = $("pickerStrip");
  const modeTag = $("pickerModeLabel");
  if (!wheelEl) return;

  if (hwMode === "PRESET") {
    const keys = Object.keys(DEMO_URLS);
    const activeKey = keys[presetIndex % keys.length] || "LAB42";
    modeTag.textContent = `SLOT ${String((presetIndex % keys.length) + 1).padStart(2, "0")}/${String(keys.length).padStart(2, "0")}`;
    wheelEl.innerHTML = `<span class="picker-neighbor">◀</span> <span class="picker-active">${activeKey}</span> <span class="picker-neighbor">▶</span>`;
  } else {
    const label = curr === "✓" ? "✓ SEND" : curr === "⌫" ? "⌫ DEL" : curr;
    modeTag.textContent = curr === "✓" ? "ACTION: RESOLVE" : curr === "⌫" ? "ACTION: BACKSPACE" : `CHAR ${charIndex + 1}/${CHARS.length}`;
    wheelEl.innerHTML = `
      <span class="picker-neighbor">${prev2}</span>
      <span class="picker-neighbor">${prev1}</span>
      <span class="picker-active">${label}</span>
      <span class="picker-neighbor">${next1}</span>
      <span class="picker-neighbor">${next2}</span>
    `;
  }
}

// Render Demo Chips list dynamically (supports user-added codes!)
function renderDemoChips() {
  // This deployment uses the cloud database only; it does not display browser-only demo mappings.
  const container = $("demoChipsContainer");
  const label = $("demoCodesLabel");
  const hint = $("demoCodesHint");
  if (container) container.hidden = true;
  if (label) label.hidden = true;
  if (hint) hint.hidden = true;
}

function render() {
  $("codeDisplay").textContent = code || "_ _ _ _";
  $("count").textContent = String(code.length).padStart(2, "0") + " / 12";
  $("shortCode").value = code;
  renderPickerWheel();
  renderDemoChips();
}

function begin() {
  entering = true;
  $("oledState").textContent = hwMode === "PRESET" ? "PRESET" : "INPUT";
  $("prompt").textContent = hwMode === "PRESET" ? "SELECT PRESET SLOT" : "CHOOSE CHARACTER";
  $("message").textContent = hwMode === "PRESET" ? "UP / DOWN CYCLES PRESETS" : "UP / DOWN TO SCROLL WHEEL";
  $("hint").textContent = hwMode === "PRESET"
    ? "UP / DOWN cycle preset codes. Press SELECT to resolve immediately."
    : "UP / DOWN scroll character wheel (includes ✓ SEND & ⌫ DEL). SELECT confirms.";
}

function move(dir) {
  playTone("tick");
  pulseTxLed();

  if (hwMode === "PRESET") {
    const keys = Object.keys(DEMO_URLS);
    if (!entering) begin();
    presetIndex = (presetIndex + dir + keys.length) % keys.length;
    code = keys[presetIndex];
    render();
    $("prompt").textContent = "PRESET CODE READY";
    $("message").textContent = `SELECTED: [ ${code} ]`;
    $("hint").textContent = `Preset ${code} selected. Press SELECT (↵) to resolve on cloud.`;
    logSerial("GPIO", `Preset selector moved to [${code}]`);
    return;
  }

  if (!entering) begin();
  charIndex = (charIndex + dir + CHARS.length) % CHARS.length;
  const ch = CHARS[charIndex];
  renderPickerWheel();

  if (ch === "✓") {
    $("prompt").textContent = "SUBMIT SHORT CODE?";
    $("message").textContent = "CURRENT: [ ✓ RESOLVE ]";
    $("hint").textContent = "Press SELECT (↵) now to send code to cloud backend.";
  } else if (ch === "⌫") {
    $("prompt").textContent = "EDIT SHORT CODE";
    $("message").textContent = "CURRENT: [ ⌫ BACKSPACE ]";
    $("hint").textContent = "Press SELECT (↵) to delete the last character.";
  } else {
    $("prompt").textContent = "CHOOSE CHARACTER";
    $("message").textContent = "CURRENT: [ " + ch + " ]";
    $("hint").textContent = "Selected " + ch + ". Press SELECT to add it, or RESOLVE NOW below.";
  }
}

function add() {
  playTone("select");
  pulseTxLed();

  if (hwMode === "PRESET") {
    const keys = Object.keys(DEMO_URLS);
    if (!code) code = keys[presetIndex] || "LAB42";
    render();
    resolve(code);
    return;
  }

  if (!entering) {
    move(0);
    return;
  }

  const chosen = CHARS[charIndex];

  // Handle built-in wheel action tokens so 3 buttons can do everything
  if (chosen === "✓") {
    resolve(code);
    return;
  }
  if (chosen === "⌫") {
    backspaceChar();
    return;
  }

  if (code.length >= MAX) {
    toast("Code limit (12 chars) reached.");
    return;
  }

  code += chosen;
  render();
  $("prompt").textContent = "ENTER SHORT CODE";
  $("message").textContent = `ADDED '${chosen}' • ${code.length}/12 CHARS`;
  $("hint").textContent = "Add more characters, or press RESOLVE NOW (or scroll to ✓).";
  logSerial("GPIO_27", `Appended '${chosen}' -> Buffer: "${code}"`);
}

function backspaceChar() {
  playTone("tick");
  pulseTxLed();
  if (!code.length) {
    clearAll();
    return;
  }
  code = code.slice(0, -1);
  render();
  $("oledState").textContent = "EDIT";
  $("prompt").textContent = "CHARACTER REMOVED";
  $("message").textContent = code ? `BUFFER: ${code}` : "BUFFER EMPTY";
  logSerial("GPIO", `Backspace -> Buffer: "${code}"`);
}

function clearAll() {
  playTone("tick");
  code = "";
  charIndex = 0;
  entering = false;
  render();
  setPipelineHop(-1);
  $("oledState").textContent = "READY";
  $("prompt").textContent = "ENTER SHORT CODE";
  $("message").textContent = "SELECT TO BEGIN";
  $("oledUrl").textContent = "";
  $("hint").textContent = "Press SELECT to begin. UP / DOWN change the highlighted character.";
  $("badge").textContent = "WAITING";
  $("badge").className = "badge";
  $("empty").hidden = false;
  $("empty").querySelector("p").textContent = "The resolved URL will appear here after a successful lookup.";
  $("result").hidden = true;
  logSerial("RESET", "Buffer and OLED display cleared.");
}

function showResult(c, url, elapsedMs) {
  playTone("success");
  $("oledState").textContent = "SUCCESS";
  $("prompt").textContent = "DESTINATION FOUND";
  $("message").textContent = `CODE: ${c} (${elapsedMs}ms)`;
  $("oledUrl").textContent = url;
  $("badge").textContent = "RESOLVED";
  $("badge").className = "badge success";
  $("empty").hidden = true;
  $("result").hidden = false;
  $("resultCode").textContent = c;
  if ($("resultLatency")) $("resultLatency").textContent = `${elapsedMs} ms`;
  $("url").textContent = url;
  $("url").href = url;
  $("open").href = url;
  $("status").textContent = `Last lookup: ${c} → 200 OK (${elapsedMs}ms)`;
  $("hint").textContent = "URL resolved on OLED. Press CLEAR to enter another code.";
  drawUrlMatrixCanvas(url);
}

function showError(c, msg, statusCode) {
  const notFound = statusCode === 404;
  playTone("error");
  $("oledState").textContent = notFound ? "NOT FOUND" : "ERROR";
  $("prompt").textContent = "LOOKUP FAILED";
  $("message").textContent = msg || "NO MATCH FOR " + c;
  $("oledUrl").textContent = "";
  $("badge").textContent = notFound ? "NOT FOUND" : "ERROR";
  $("badge").className = "badge error";
  $("empty").hidden = false;
  $("empty").querySelector("p").textContent = msg || "No destination is mapped to " + c + ". Check the code or add it below.";
  $("result").hidden = true;
  $("status").textContent = statusCode
    ? `Last lookup (${c}) failed: HTTP ${statusCode} — ${msg}`
    : `Last lookup (${c}) failed: ${msg}`;
}

async function resolve(raw) {
  const c = (raw || "").trim().toUpperCase();
  if (!c) {
    toast("Enter or select a short code first.");
    $("shortCode").focus();
    return;
  }
  if (busy) return;
  busy = true;

  const t0 = performance.now();
  const btn = document.querySelector(".resolve");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Resolving…";

  $("oledState").textContent = "LOOKUP";
  $("prompt").textContent = "CONTACTING CLOUD";
  $("message").textContent = "RESOLVING " + c + "...";
  $("oledUrl").textContent = "";
  $("badge").textContent = "LOADING";
  $("badge").className = "badge";
  $("status").textContent = `Querying ${USE_DEMO_DATA ? "browser demo data" : "Live API"} for ${c}…`;

  logSerial("HTTP", `GET /api/resolve/${c} dispatched from ESP32`);

  try {
    // Animate the 4-stage IoT-to-Cloud Architecture hops
    setPipelineHop(0);
    await new Promise((r) => setTimeout(r, 95));
    setPipelineHop(1);
    await new Promise((r) => setTimeout(r, 95));
    setPipelineHop(2);
    await new Promise((r) => setTimeout(r, 95));
    setPipelineHop(3);

    let url;
    if (USE_DEMO_DATA) {
      await new Promise((r) => setTimeout(r, 110));
      url = DEMO_URLS[c];
      if (!url) {
        showError(c, "Short code not found", 404);
        logSerial("DEMO_404", `Key "${c}" not found in browser demo data.`);
        return;
      }
    } else {
      const endpoint = apiEndpoint(`resolve/${encodeURIComponent(c)}`);
      const res = await fetch(endpoint, { headers: { Accept: "application/json" } });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = res.status === 404
          ? "Short code not found"
          : responseMessage(data, `API lookup failed (HTTP ${res.status}).`);
        throw Object.assign(new Error(message), { statusCode: res.status });
      }
      url = data && (data.url || data.destination_url);
      if (typeof url !== "string" || !url.trim()) {
        throw new Error("API response did not include a destination URL.");
      }
    }

    const elapsedMs = Math.max(18, Math.round(performance.now() - t0));

    if (!url) {
      showError(c, "Short code not found", 404);
      logSerial("DEMO_404", `Key "${c}" not found in browser demo data.`);
      return;
    }

    code = c;
    render();
    showResult(c, url, elapsedMs);
    logSerial(USE_DEMO_DATA ? "DEMO_200" : "API_200", `Resolved "${c}" -> ${url} (${elapsedMs}ms)`);
  } catch (e) {
    const message = e instanceof TypeError
      ? "Could not reach the Live API. Check the API URL, network, and CORS configuration."
      : e.message || "Could not complete the lookup.";
    showError(c, message, e.statusCode);
    toast(message);
    logSerial("ERR", message);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.querySelector("span").textContent = "Resolve destination";
  }
}

// Primary 3 Hardware Buttons
$("up").addEventListener("click", () => move(-1));
$("down").addEventListener("click", () => move(1));
$("select").addEventListener("click", add);

// Hardware Sub-Buttons on the LT•01 Unit (Resolve Now & Backspace/Clear)
if ($("hwResolveBtn")) {
  $("hwResolveBtn").addEventListener("click", () => resolve(code || $("shortCode").value));
}
if ($("hwBackspaceBtn")) {
  $("hwBackspaceBtn").addEventListener("click", backspaceChar);
}

// Clear Button inside Lookup Input
$("clear").addEventListener("click", clearAll);

// Form Submit
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  resolve($("shortCode").value);
});

// Direct Input Sync
$("shortCode").addEventListener("input", () => {
  code = $("shortCode").value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX);
  render();
});

// Copy URL Button with fallback
$("copy").addEventListener("click", async () => {
  const targetUrl = $("url").href;
  if (!targetUrl) return;
  try {
    await navigator.clipboard.writeText(targetUrl);
    toast("URL copied to clipboard.");
  } catch {
    const temp = document.createElement("input");
    temp.value = targetUrl;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    document.body.removeChild(temp);
    toast("URL copied to clipboard.");
  }
});

// Hardware Mode Switcher (CHAR ENTRY vs PRESET SELECT)
if ($("modeCharBtn") && $("modePresetBtn")) {
  $("modeCharBtn").addEventListener("click", () => {
    hwMode = "CHAR";
    $("modeCharBtn").classList.add("active");
    $("modePresetBtn").classList.remove("active");
    playTone("tick");
    begin();
    render();
  });
  $("modePresetBtn").addEventListener("click", () => {
    hwMode = "PRESET";
    $("modePresetBtn").classList.add("active");
    $("modeCharBtn").classList.remove("active");
    const keys = Object.keys(DEMO_URLS);
    code = keys[presetIndex % keys.length] || "LAB42";
    playTone("tick");
    begin();
    render();
  });
}

// OLED Screen Color Theme Switcher (Mint LCD / Cyan SSD1306 / Amber SSD1306)
document.querySelectorAll("[data-set-oled]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.setOled;
    const oledEl = $("oledScreen");
    if (oledEl) {
      if (theme === "mint") {
        oledEl.removeAttribute("data-oled-theme");
      } else {
        oledEl.setAttribute("data-oled-theme", theme);
      }
    }
    playTone("tick");
    logSerial("I2C_OLED", `SSD1306 display palette set to ${theme.toUpperCase()}`);
  });
});

// Sound Toggle Button
if ($("soundToggleBtn")) {
  $("soundToggleBtn").addEventListener("click", () => {
    soundOn = !soundOn;
    $("soundToggleBtn").textContent = soundOn ? "🔊 SOUND ON" : "🔇 SOUND OFF";
    $("soundToggleBtn").classList.toggle("active", soundOn);
    if (soundOn) playTone("select");
  });
}

// Add Custom Short Code Mapping to either browser demo data or the configured Live API.
if ($("addMappingForm")) {
  $("addMappingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newCodeInput = $("newMapCode");
    const newUrlInput = $("newMapUrl");
    const c = newCodeInput.value.trim().toUpperCase();
    const u = newUrlInput.value.trim();
    const saveToDemo = USE_DEMO_DATA;
    if (!c) {
      toast("Enter a short code first.");
      newCodeInput.focus();
      return;
    }
    try {
      const parsedUrl = new URL(u);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("Destination URL must use http:// or https://.");
      }
    } catch (error) {
      const message = error instanceof TypeError
        ? "Enter a valid destination URL using http:// or https://."
        : error.message;
      toast(message);
      newUrlInput.focus();
      return;
    }

    const saveButton = $("addMappingForm").querySelector("button[type='submit']");
    saveButton.disabled = true;
    try {
      if (saveToDemo) {
        DEMO_URLS[c] = u;
        persistDemoMappings();
        logSerial("LOCAL STORE", `Saved mapping ${c} in browser demo data.`);
        toast(`Saved ${c} in this browser demo.`);
      } else {
        $("status").textContent = `Saving ${c} to the Live API…`;
        const res = await fetch(apiEndpoint("links"), {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ short_code: c, url: u })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const message = res.status === 409
            ? responseMessage(data, "That short code already exists.")
            : responseMessage(data, `Could not save mapping (HTTP ${res.status}).`);
          throw Object.assign(new Error(message), { statusCode: res.status });
        }
        $("status").textContent = `Cloud mapping ${c} saved (HTTP ${res.status}).`;
        logSerial(`API_${res.status}`, `Cloud API saved mapping ${c} (HTTP ${res.status}).`);
        toast(`Cloud mapping ${c} saved successfully.`);
      }

      code = c;
      newCodeInput.value = "";
      newUrlInput.value = "";
      render();
      if (USE_DEMO_DATA === saveToDemo) resolve(c);
    } catch (error) {
      const message = error instanceof TypeError
        ? "Could not reach the Live API. Check the API URL, network, and CORS configuration."
        : error.message || "Could not save the mapping.";
      if (!saveToDemo) $("status").textContent = `Cloud save failed: ${message}`;
      logSerial("ERR", `Save mapping ${c} failed: ${message}`);
      toast(message);
    } finally {
      saveButton.disabled = false;
    }
  });
}

// Keyboard Navigation Support
document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
  const inInput = activeTag === "input" || activeTag === "textarea";

  if (e.key === "ArrowUp" && !inInput) {
    e.preventDefault();
    $("up").classList.add("is-pressed");
    move(-1);
    setTimeout(() => $("up").classList.remove("is-pressed"), 110);
  } else if (e.key === "ArrowDown" && !inInput) {
    e.preventDefault();
    $("down").classList.add("is-pressed");
    move(1);
    setTimeout(() => $("down").classList.remove("is-pressed"), 110);
  } else if (e.key === "Enter" && !inInput) {
    e.preventDefault();
    $("select").classList.add("is-pressed");
    add();
    setTimeout(() => $("select").classList.remove("is-pressed"), 110);
  } else if (e.key === "Backspace" && !inInput) {
    e.preventDefault();
    backspaceChar();
  } else if (e.key === "Escape") {
    clearAll();
  }
});


// Page appearance toggle (separate from the OLED phosphor theme).
(function setupPageTheme() {
  const btn = $("themeToggleBtn");
  if (!btn) return;
  let theme = "light";
  try { theme = localStorage.getItem("link-terminal-page-theme") || "light"; } catch (_) {}
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    btn.textContent = theme === "dark" ? "☀ LIGHT MODE" : "☾ DARK MODE";
    btn.setAttribute("aria-pressed", String(theme === "dark"));
    btn.title = theme === "dark" ? "Switch to light appearance" : "Switch to dark appearance";
  };
  btn.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("link-terminal-page-theme", theme); } catch (_) {}
    apply();
  });
  apply();
})();

// Initialize on load
$("mode").textContent = "AWS LIVE API MODE";
$("liveBadgeBox").classList.add("api-active");
$("status").textContent = `AWS API configured: ${apiEndpoint("resolve/<CODE>")}`;
logSerial("BOOT", "Link Terminal LT•01 browser simulator initialized (I2C OLED 0x3C)");
render();

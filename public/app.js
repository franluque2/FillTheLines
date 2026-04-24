'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  config:    null,      // loaded from /api/config
  character: null,      // currently selected character string
  files:     {},        // { [lineId]: string[] }  — filenames on server
  recording: null,      // { lineId, mediaRecorder, stream, chunks, timerInterval } | null
  preview:   null,      // { lineId, blob, url, mimeType } | null
};

// ── Safe element ID ──────────────────────────────────────────────────────────
// HTML element IDs accept any string when set via .id; getElementById does exact match.
// We keep the raw lineId for all DOM look-ups.
const rowId      = id => `row-${id}`;
const recAreaId  = id => `rec-area-${id}`;
const recListId  = id => `rec-list-${id}`;
const recBtnId   = id => `btn-rec-${id}`;
const recTimerId = id => `rec-timer-${id}`;

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(url, options) {
  const res  = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function apiUpload(lineId, blob, filename) {
  const fd  = new FormData();
  fd.append('audio', blob, filename);
  const url = `/api/upload?person=${enc(state.character)}&lineId=${enc(lineId)}`;
  return apiFetch(url, { method: 'POST', body: fd });
}

function apiDelete(person, filename) {
  return apiFetch(`/api/files/${enc(person)}/${enc(filename)}`, { method: 'DELETE' });
}

function enc(s) { return encodeURIComponent(s); }

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function toast(msg, type = 'error') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show toast-${type}`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

// ── View switching ────────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Character Selection ───────────────────────────────────────────────────────
function renderCharacterSelection() {
  document.getElementById('char-badge').hidden = true;
  showView('view-characters');

  const grid = document.getElementById('character-grid');
  grid.innerHTML = '';
  for (const char of state.config.characters) {
    const btn = document.createElement('button');
    btn.className   = 'character-card';
    btn.textContent = char;
    btn.addEventListener('click', () => selectCharacter(char));
    grid.appendChild(btn);
  }
}

async function selectCharacter(char) {
  state.character = char;
  try {
    state.files = await apiFetch(`/api/files/${enc(char)}`);
    renderLinesView();
  } catch (err) {
    toast(err.message);
  }
}

// ── Lines View ────────────────────────────────────────────────────────────────
function renderLinesView() {
  document.getElementById('char-badge').hidden = false;
  document.getElementById('char-label').textContent = state.character;
  showView('view-lines');

  const list = document.getElementById('lines-list');
  list.innerHTML = '';
  for (const line of state.config.lines) {
    list.appendChild(buildRow(line));
    refreshRecList(line.id);
    refreshRowColor(line.id);
  }
  updateProgress();
}

function buildRow(line) {
  const row = document.createElement('div');
  row.className   = 'line-row';
  row.id          = rowId(line.id);
  row.dataset.lid = line.id;

  // ── top ──
  const top = document.createElement('div');
  top.className = 'line-top';

  const idBadge = document.createElement('span');
  idBadge.className   = 'line-id';
  idBadge.textContent = line.id;

  const textEl = document.createElement('span');
  textEl.className   = 'line-text';
  textEl.textContent = line.text;

  const actions = document.createElement('div');
  actions.className = 'line-actions';

  const recBtn = document.createElement('button');
  recBtn.id        = recBtnId(line.id);
  recBtn.className = 'btn btn-record';
  recBtn.textContent = '🎙 Record';
  recBtn.addEventListener('click', () => onRecordClick(line.id));

  const uploadBtn = document.createElement('button');
  uploadBtn.className   = 'btn btn-upload';
  uploadBtn.textContent = '📁 Upload';

  const fileInput = document.createElement('input');
  fileInput.type   = 'file';
  fileInput.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.opus';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) onFileChosen(line.id, fileInput.files[0]);
    fileInput.value = '';   // allow re-selecting the same file
  });
  uploadBtn.addEventListener('click', () => fileInput.click());

  actions.append(recBtn, uploadBtn, fileInput);
  top.append(idBadge, textEl, actions);

  // ── recording / preview area ──
  const recArea = document.createElement('div');
  recArea.className = 'rec-area';
  recArea.id        = recAreaId(line.id);

  // ── recordings list ──
  const recList = document.createElement('div');
  recList.className = 'recordings-list';
  recList.id        = recListId(line.id);

  row.append(top, recArea, recList);
  return row;
}

// ── Recordings list ───────────────────────────────────────────────────────────
function refreshRecList(lineId) {
  const el    = document.getElementById(recListId(lineId));
  if (!el) return;
  const files = state.files[lineId] || [];
  el.innerHTML = '';
  el.style.display = files.length ? 'flex' : 'none';

  for (const filename of files) {
    const item = document.createElement('div');
    item.className = 'rec-item';

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload  = 'none';
    audio.src      = `/uploads/${enc(state.character)}/${enc(filename)}`;

    const label = document.createElement('span');
    label.className   = 'rec-filename';
    label.textContent = filename;
    label.title       = filename;

    const delBtn = document.createElement('button');
    delBtn.className   = 'btn-del';
    delBtn.title       = 'Delete recording';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => onDelete(lineId, filename));

    item.append(audio, label, delBtn);
    el.appendChild(item);
  }
}

function refreshRowColor(lineId) {
  const row = document.getElementById(rowId(lineId));
  if (!row) return;
  row.classList.toggle('has-recordings', (state.files[lineId] || []).length > 0);
}

function updateProgress() {
  if (!state.config) return;
  const total = state.config.lines.length;
  const done  = state.config.lines.filter(l => (state.files[l.id] || []).length > 0).length;
  document.getElementById('progress-text').textContent = `${done} / ${total} lines recorded`;
  document.getElementById('progress-fill').style.width = total ? `${(done / total) * 100}%` : '0%';
}

// ── Record button handler ─────────────────────────────────────────────────────
function onRecordClick(lineId) {
  if (state.recording) {
    if (state.recording.lineId === lineId) {
      stopRecording();   // stop → triggers onstop → preview
    } else {
      toast('Finish or discard your current recording first.', 'warning');
    }
    return;
  }
  startRecording(lineId);
}

// ── Start recording ───────────────────────────────────────────────────────────
async function startRecording(lineId) {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Microphone access requires a secure connection (HTTPS). Recording is only available over HTTPS or on localhost.', 'error');
      return;
    }
    const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMime();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks   = [];

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      state.recording = null;
      state.preview   = { lineId, blob, url: URL.createObjectURL(blob), mimeType: recorder.mimeType };
      setRecArea(lineId, 'preview');
      syncRecBtn(lineId);
    };

    let elapsed = 0;
    const timerInterval = setInterval(() => {
      elapsed++;
      const el = document.getElementById(recTimerId(lineId));
      if (el) el.textContent = fmtTime(elapsed);
    }, 1000);

    state.recording = { lineId, mediaRecorder: recorder, stream, chunks, timerInterval };
    recorder.start(100);
    setRecArea(lineId, 'active');
    syncRecBtn(lineId);

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      toast('Microphone access was denied. Please allow it in your browser settings.', 'error');
    } else {
      toast(`Could not start recording: ${err.message}`, 'error');
    }
  }
}

function stopRecording() {
  if (!state.recording) return;
  clearInterval(state.recording.timerInterval);
  const { mediaRecorder } = state.recording;
  if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

// ── Recording area states ─────────────────────────────────────────────────────
function setRecArea(lineId, mode) {
  const el = document.getElementById(recAreaId(lineId));
  if (!el) return;
  el.innerHTML = '';

  if (mode === 'active') {
    el.style.display = 'flex';

    const dot = document.createElement('span');
    dot.className   = 'rec-dot';
    dot.textContent = 'Recording';

    const timer = document.createElement('span');
    timer.className   = 'rec-timer';
    timer.id          = recTimerId(lineId);
    timer.textContent = '0:00';

    el.append(dot, timer);

  } else if (mode === 'preview' && state.preview) {
    el.style.display = 'flex';

    const lbl = document.createElement('span');
    lbl.className   = 'preview-label';
    lbl.textContent = 'Preview:';

    const audio = document.createElement('audio');
    audio.controls  = true;
    audio.className = 'preview-audio';
    audio.src       = state.preview.url;

    const saveBtn = document.createElement('button');
    saveBtn.className   = 'btn btn-save';
    saveBtn.textContent = '✓ Save';
    saveBtn.addEventListener('click', () => savePreview(lineId, saveBtn));

    const discardBtn = document.createElement('button');
    discardBtn.className   = 'btn btn-discard';
    discardBtn.textContent = '✕ Discard';
    discardBtn.addEventListener('click', () => discardPreview(lineId));

    el.append(lbl, audio, saveBtn, discardBtn);

  } else {
    el.style.display = 'none';
  }
}

function clearRecArea(lineId) {
  const el = document.getElementById(recAreaId(lineId));
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

function syncRecBtn(lineId) {
  const btn = document.getElementById(recBtnId(lineId));
  if (!btn) return;
  const isRecordingThis = state.recording && state.recording.lineId === lineId;
  btn.textContent = isRecordingThis ? '⏹ Stop' : '🎙 Record';
  btn.classList.toggle('active', isRecordingThis);
}

// ── Save preview ──────────────────────────────────────────────────────────────
async function savePreview(lineId, saveBtn) {
  if (!state.preview || state.preview.lineId !== lineId) return;
  const { blob, mimeType, url } = state.preview;

  saveBtn.disabled    = true;
  saveBtn.textContent = 'Saving…';

  try {
    const ext    = extFromMime(mimeType);
    const result = await apiUpload(lineId, blob, `recording${ext}`);
    URL.revokeObjectURL(url);
    state.preview = null;

    if (!state.files[lineId]) state.files[lineId] = [];
    state.files[lineId].push(result.filename);

    clearRecArea(lineId);
    refreshRecList(lineId);
    refreshRowColor(lineId);
    updateProgress();
  } catch (err) {
    toast(`Save failed: ${err.message}`);
    saveBtn.disabled    = false;
    saveBtn.textContent = '✓ Save';
  }
}

function discardPreview(lineId) {
  if (!state.preview) return;
  URL.revokeObjectURL(state.preview.url);
  state.preview = null;
  clearRecArea(lineId);
}

// ── File upload ───────────────────────────────────────────────────────────────
async function onFileChosen(lineId, file) {
  const row       = document.getElementById(rowId(lineId));
  const uploadBtn = row ? row.querySelector('.btn-upload') : null;
  if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '⏳ Uploading…'; }

  try {
    const result = await apiUpload(lineId, file, file.name);
    if (!state.files[lineId]) state.files[lineId] = [];
    state.files[lineId].push(result.filename);
    refreshRecList(lineId);
    refreshRowColor(lineId);
    updateProgress();
  } catch (err) {
    toast(`Upload failed: ${err.message}`);
  } finally {
    if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = '📁 Upload'; }
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function onDelete(lineId, filename) {
  if (!confirm(`Delete "${filename}"?`)) return;
  try {
    await apiDelete(state.character, filename);
    state.files[lineId] = (state.files[lineId] || []).filter(f => f !== filename);
    refreshRecList(lineId);
    refreshRowColor(lineId);
    updateProgress();
  } catch (err) {
    toast(`Delete failed: ${err.message}`);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function pickMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  return candidates.find(t => {
    try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
  }) ?? null;
}

function extFromMime(mimeType) {
  if (!mimeType)                    return '.webm';
  if (mimeType.includes('ogg'))     return '.ogg';
  if (mimeType.includes('mp4'))     return '.m4a';
  return '.webm';
}

function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Change character button ───────────────────────────────────────────────────
function leaveRecordingView() {
  if (state.recording) {
    clearInterval(state.recording.timerInterval);
    state.recording.stream.getTracks().forEach(t => t.stop());
    // Suppress onstop so no preview is shown
    state.recording.mediaRecorder.ondataavailable = null;
    state.recording.mediaRecorder.onstop          = null;
    try { state.recording.mediaRecorder.stop(); } catch { /* ignore */ }
    state.recording = null;
  }
  if (state.preview) {
    URL.revokeObjectURL(state.preview.url);
    state.preview = null;
  }
  state.character = null;
  state.files     = {};
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  document.getElementById('btn-change-char').addEventListener('click', () => {
    leaveRecordingView();
    renderCharacterSelection();
  });

  try {
    state.config = await apiFetch('/api/config');
    renderCharacterSelection();
  } catch {
    document.getElementById('view-characters').innerHTML = `
      <div class="error-state">
        <h2>No configuration found</h2>
        <p>Place a <code>config.json</code> file in the server directory and restart.</p>
        <p style="margin-top:8px;font-size:.85rem">
          See <code>config.example.json</code> for the expected format.
        </p>
      </div>`;
    showView('view-characters');
  }
}

document.addEventListener('DOMContentLoaded', init);

'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app        = express();
const PORT       = process.env.PORT       || 3000;
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function resolveSafe(base, ...parts) {
  const resolved = path.resolve(path.join(base, ...parts));
  const safeBase = path.resolve(base);
  if (resolved !== safeBase && !resolved.startsWith(safeBase + path.sep)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

ensureDir(UPLOADS_DIR);

// ─── Static ───────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));
// Uploaded audio served for in-browser playback
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── GET /api/config ──────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  try {
    res.json(loadConfig());
  } catch {
    res.status(404).json({ error: 'config.json not found. Place it in the server directory.' });
  }
});

// ─── GET /api/files/:person ───────────────────────────────────────────────────
// Returns { [lineId]: [filename, ...] } for every line in the config.

app.get('/api/files/:person', (req, res) => {
  try {
    const config = loadConfig();
    const person = req.params.person;

    if (!config.characters.includes(person)) {
      return res.status(400).json({ error: 'Unknown character' });
    }

    const personDir = resolveSafe(UPLOADS_DIR, person);
    const result = Object.fromEntries(config.lines.map(l => [l.id, []]));

    if (fs.existsSync(personDir)) {
      for (const file of fs.readdirSync(personDir)) {
        for (const line of config.lines) {
          const prefix = `${line.id}${person}`;
          const base   = path.basename(file, path.extname(file));
          const numStr = base.slice(prefix.length);
          if (file.startsWith(prefix) && /^\d+$/.test(numStr)) {
            result[line.id].push(file);
          }
        }
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/upload ─────────────────────────────────────────────────────────
// Query params: person, lineId
// Multipart body field: audio (the file)

const ALLOWED_AUDIO_EXTS = new Set(['.webm', '.ogg', '.wav', '.mp3', '.m4a', '.flac', '.aac', '.opus']);

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    try {
      const personDir = resolveSafe(UPLOADS_DIR, req.query.person);
      ensureDir(personDir);
      cb(null, personDir);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    try {
      const person    = req.query.person;
      const lineId    = req.query.lineId;
      const personDir = resolveSafe(UPLOADS_DIR, person);

      const rawExt = path.extname(file.originalname).toLowerCase();
      const ext    = ALLOWED_AUDIO_EXTS.has(rawExt) ? rawExt : '.webm';
      const prefix = `${lineId}${person}`;

      let nextNum = 0;
      if (fs.existsSync(personDir)) {
        const nums = fs.readdirSync(personDir)
          .map(f => {
            const base   = path.basename(f, path.extname(f));
            const numStr = base.slice(prefix.length);
            return f.startsWith(prefix) && /^\d+$/.test(numStr) ? parseInt(numStr, 10) : -1;
          })
          .filter(n => n >= 0);
        if (nums.length > 0) nextNum = Math.max(...nums) + 1;
      }

      cb(null, `${prefix}${nextNum}${ext}`);
    } catch (err) {
      cb(err);
    }
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter(_req, file, cb) {
    const isAudio = file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm';
    cb(isAudio ? null : new Error('Only audio files are accepted'), isAudio);
  },
});

// Validation middleware runs before multer so we can reject early
function validateUploadParams(req, res, next) {
  try {
    const config = loadConfig();
    const { person, lineId } = req.query;

    if (!person || !lineId) {
      return res.status(400).json({ error: 'person and lineId query params are required' });
    }
    if (!config.characters.includes(person)) {
      return res.status(400).json({ error: 'Unknown character' });
    }
    if (!config.lines.find(l => l.id === lineId)) {
      return res.status(400).json({ error: 'Unknown line ID' });
    }
    next();
  } catch {
    res.status(500).json({ error: 'Could not load config' });
  }
}

app.post('/api/upload', validateUploadParams, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file received' });
  res.json({
    success:  true,
    filename: req.file.filename,
    person:   req.query.person,
    lineId:   req.query.lineId,
  });
});

// ─── DELETE /api/files/:person/:filename ──────────────────────────────────────

app.delete('/api/files/:person/:filename', (req, res) => {
  try {
    const config   = loadConfig();
    const person   = req.params.person;
    const filename = path.basename(req.params.filename); // strip any path component

    if (!config.characters.includes(person)) {
      return res.status(400).json({ error: 'Unknown character' });
    }

    const filePath = resolveSafe(UPLOADS_DIR, person, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`FillTheLines running on http://localhost:${PORT}`);
  console.log(`  Config : ${CONFIG_PATH}`);
  console.log(`  Uploads: ${UPLOADS_DIR}`);
});

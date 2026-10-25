const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_MB = Number(process.env.MAX_FILE_MB || 500);

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB = path.join(DATA_DIR, 'files.json');
const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return []; } };
const save = (list) => fs.writeFileSync(DB, JSON.stringify(list, null, 2));

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Falta definir ADMIN_PASSWORD en el servidor.' });
  const given = Buffer.from(String(req.get('x-admin-password') || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real))
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: DATA_DIR,
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID())
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

const publicView = (f) => ({
  id: f.id, title: f.title, version: f.version, notes: f.notes,
  filename: f.filename, size: f.size, createdAt: f.createdAt, downloads: f.downloads
});

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/files', (_req, res) => res.json(load().map(publicView)));

app.post('/api/check', requireAdmin, (_req, res) => res.json({ ok: true }));

// La contraseña se valida ANTES de recibir el archivo.
app.post('/api/upload', requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `El archivo supera ${MAX_MB} MB.` : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo.' });
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const entry = {
      id: req.file.filename,
      title: (req.body.title || '').trim() || filename,
      version: (req.body.version || '').trim(),
      notes: (req.body.notes || '').trim(),
      filename,
      size: req.file.size,
      createdAt: new Date().toISOString(),
      downloads: 0
    };
    const list = load();
    list.unshift(entry);
    save(list);
    res.status(201).json(publicView(entry));
  });
});

app.delete('/api/files/:id', requireAdmin, (req, res) => {
  const list = load();
  const f = list.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Ese archivo ya no existe.' });
  fs.rm(path.join(DATA_DIR, f.id), { force: true }, () => {
    save(list.filter((x) => x !== f));
    res.json({ ok: true });
  });
});

app.get('/download/:id', (req, res) => {
  const list = load();
  const f = list.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).send('Archivo no encontrado.');
  f.downloads += 1;
  save(list);
  res.download(path.join(DATA_DIR, f.id), f.filename);
});

app.listen(PORT, () => console.log(`Descargas listo en el puerto ${PORT}`));

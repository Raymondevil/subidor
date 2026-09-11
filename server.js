const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || 'cambia-esta-clave';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = ['.mp4', '.jpg', '.jpeg', '.mov', '.mkv', '.avi', '.webm'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 * 1024 }, // 20 GB máximo, ajusta si lo necesitas
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Tipo de archivo no permitido'));
    }
    cb(null, true);
  }
});

function checkToken(req, res, next) {
  const token = req.header('x-upload-token');
  if (token !== UPLOAD_TOKEN) {
    return res.status(403).json({ error: 'Clave inválida' });
  }
  next();
}

// Los archivos de la interfaz viven en la raíz del proyecto. Exponerlos con
// rutas explícitas evita publicar por accidente el código del servidor,
// dependencias o los archivos subidos.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/icons/icon-192.png', (req, res) => res.sendFile(path.join(__dirname, 'icon-192.png')));

app.post('/upload', checkToken, (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo' });
    res.json({ message: 'Subido correctamente', filename: req.file.filename });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de subida escuchando en el puerto ${PORT}`);
  console.log(`Guardando archivos en: ${UPLOAD_DIR}`);
});

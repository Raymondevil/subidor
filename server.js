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

function sanitizeFilename(original) {
  const base = path.basename(original);
  return base.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

function checkToken(req, res, next) {
  const token = req.header('x-upload-token') || req.query.token;
  if (token !== UPLOAD_TOKEN) {
    return res.status(403).json({ error: 'Clave inválida' });
  }
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = sanitizeFilename(file.originalname);
    cb(null, safeName);
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

    const safeName = sanitizeFilename(file.originalname);
    const filePath = path.join(UPLOAD_DIR, safeName);
    const allowOverwrite = req.header('x-overwrite') === 'true' || req.query.overwrite === 'true';

    if (fs.existsSync(filePath) && !allowOverwrite) {
      return cb(new Error(`El archivo "${safeName}" ya existe en el servidor`));
    }

    cb(null, true);
  }
});

const CHUNK_DIR = path.join(UPLOAD_DIR, '.chunks');
if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });

async function mergeChunks(chunkDir, totalChunks, destinationPath) {
  const destStream = fs.createWriteStream(destinationPath);
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(chunkDir, `chunk_${i}.part`);
    await new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(chunkPath);
      readStream.pipe(destStream, { end: false });
      readStream.on('end', resolve);
      readStream.on('error', reject);
    });
  }
  destStream.end();
  await new Promise((resolve, reject) => {
    destStream.on('finish', resolve);
    destStream.on('error', reject);
  });
}

// Los archivos de la interfaz viven en la raíz del proyecto. Exponerlos con
// rutas explícitas evita publicar por accidente el código del servidor,
// dependencias o los archivos subidos.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));
app.get('/icons/icon-192.png', (req, res) => res.sendFile(path.join(__dirname, 'icon-192.png')));

// Endpoint para comprobar si un archivo final ya existe antes de subirlo
app.get('/check-file', checkToken, (req, res) => {
  const filename = req.query.filename;
  if (!filename) return res.status(400).json({ error: 'Falta el nombre de archivo' });

  const safeName = sanitizeFilename(filename);
  const filePath = path.join(UPLOAD_DIR, safeName);

  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    return res.json({
      exists: true,
      filename: safeName,
      size: stats.size,
      mtime: stats.mtime
    });
  }

  res.json({ exists: false, filename: safeName });
});

// Endpoint para consultar qué fragmentos de una subida previa ya están en el servidor
app.get('/upload-status', checkToken, (req, res) => {
  const uploadId = req.query.uploadId;
  if (!uploadId) return res.status(400).json({ error: 'Falta uploadId' });

  const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const chunkDir = path.join(CHUNK_DIR, safeUploadId);

  if (!fs.existsSync(chunkDir)) {
    return res.json({ exists: false, uploadedChunks: [] });
  }

  try {
    const files = fs.readdirSync(chunkDir);
    const uploadedChunks = [];
    for (const file of files) {
      const match = file.match(/^chunk_(\d+)\.part$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        const stat = fs.statSync(path.join(chunkDir, file));
        if (stat.size > 0) {
          uploadedChunks.push(idx);
        }
      }
    }
    res.json({ exists: true, uploadedChunks });
  } catch (err) {
    console.error('Error al leer estado de fragmentos:', err);
    res.status(500).json({ error: 'Error al consultar estado de fragmentos' });
  }
});

// Endpoint para recibir fragmentos individuales de forma reanudable (chunks)
app.post('/upload-chunk', checkToken, (req, res) => {
  const uploadId = req.header('x-upload-id');
  const chunkIndex = parseInt(req.header('x-chunk-index'), 10);
  const totalChunks = parseInt(req.header('x-total-chunks'), 10);
  const rawFilename = req.header('x-filename');
  const allowOverwrite = req.header('x-overwrite') === 'true' || req.query.overwrite === 'true';

  if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks) || !rawFilename) {
    return res.status(400).json({ error: 'Parámetros de fragmento incompletos o inválidos' });
  }

  const filename = sanitizeFilename(decodeURIComponent(rawFilename));
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido' });
  }

  const finalPath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(finalPath) && !allowOverwrite) {
    return res.status(409).json({ error: `El archivo "${filename}" ya existe en el servidor` });
  }

  const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const chunkDir = path.join(CHUNK_DIR, safeUploadId);
  if (!fs.existsSync(chunkDir)) {
    fs.mkdirSync(chunkDir, { recursive: true });
  }

  const chunkPath = path.join(chunkDir, `chunk_${chunkIndex}.part`);
  const writeStream = fs.createWriteStream(chunkPath);

  req.pipe(writeStream);

  writeStream.on('finish', async () => {
    try {
      // Comprobar si ya se recibieron todos los fragmentos
      let allPresent = true;
      for (let i = 0; i < totalChunks; i++) {
        const part = path.join(chunkDir, `chunk_${i}.part`);
        if (!fs.existsSync(part) || fs.statSync(part).size === 0) {
          allPresent = false;
          break;
        }
      }

      if (allPresent) {
        await mergeChunks(chunkDir, totalChunks, finalPath);
        fs.rmSync(chunkDir, { recursive: true, force: true });
        return res.json({
          message: 'Subido y ensamblado correctamente',
          filename,
          completed: true
        });
      }

      res.json({
        message: `Fragmento ${chunkIndex + 1} de ${totalChunks} recibido`,
        completed: false,
        chunkIndex
      });
    } catch (err) {
      console.error('Error al unir fragmentos:', err);
      res.status(500).json({ error: 'Error al ensamblar los fragmentos en el servidor' });
    }
  });

  writeStream.on('error', (err) => {
    console.error('Error al guardar fragmento:', err);
    res.status(500).json({ error: 'Error al escribir fragmento en el servidor' });
  });
});

// Endpoint para descartar y limpiar fragmentos de una subida cancelada
app.post('/cancel-upload', checkToken, (req, res) => {
  const uploadId = req.query.uploadId || req.header('x-upload-id');
  if (!uploadId) return res.status(400).json({ error: 'Falta uploadId' });

  const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const chunkDir = path.join(CHUNK_DIR, safeUploadId);

  if (fs.existsSync(chunkDir)) {
    fs.rmSync(chunkDir, { recursive: true, force: true });
  }

  res.json({ message: 'Fragmentos temporales descartados correctamente' });
});

// Endpoint tradicional para subida directa en un solo archivo
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

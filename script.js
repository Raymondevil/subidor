const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const btn = document.getElementById('btn');
const bar = document.getElementById('bar');
const statusEl = document.getElementById('status');
const tokenInput = document.getElementById('token');
const rememberBox = document.getElementById('remember');
const overwriteBox = document.getElementById('overwrite-box');
const overwriteMsg = document.getElementById('overwrite-msg');
const overwriteInput = document.getElementById('overwrite');
const cancelBtn = document.getElementById('cancel-btn');

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB por fragmento
let selectedFile = null;
let fileAlreadyExists = false;
let isUploading = false;
let isCancelled = false;
let activeXhr = null;
let currentUploadId = null;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getUploadId(file) {
  const str = `${file.name}_${file.size}_${file.lastModified}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const cleanName = file.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 16);
  return `${cleanName}_${Math.abs(hash)}_${file.size}`;
}

// Cargar token guardado
const savedToken = localStorage.getItem('uploadToken');
if (savedToken) {
  tokenInput.value = savedToken;
  rememberBox.checked = true;
}

rememberBox.addEventListener('change', () => {
  if (!rememberBox.checked) localStorage.removeItem('uploadToken');
});

// Eventos de drop zone
drop.addEventListener('click', () => {
  if (!isUploading) fileInput.click();
});

drop.addEventListener('dragover', e => {
  e.preventDefault();
  if (!isUploading) drop.classList.add('over');
});

drop.addEventListener('dragleave', () => drop.classList.remove('over'));

drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('over');
  if (!isUploading && e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) setFile(fileInput.files[0]);
});

// Funciones de API
async function checkExistence(file) {
  const token = tokenInput.value;
  if (!token) return null;
  try {
    const res = await fetch(`/check-file?filename=${encodeURIComponent(file.name)}`, {
      headers: { 'x-upload-token': token }
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.error('Error al comprobar archivo:', err);
  }
  return null;
}

async function fetchUploadStatus(uploadId) {
  const token = tokenInput.value;
  if (!token || !uploadId) return null;
  try {
    const res = await fetch(`/upload-status?uploadId=${encodeURIComponent(uploadId)}`, {
      headers: { 'x-upload-token': token }
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.error('Error al consultar estado de fragmentos:', err);
  }
  return null;
}

// Actualizar estado del archivo seleccionado
async function updateFileStatus() {
  if (!selectedFile || isUploading) return;

  fileAlreadyExists = false;
  overwriteBox.style.display = 'none';
  overwriteInput.checked = false;
  btn.className = '';

  if (tokenInput.value) {
    statusEl.textContent = 'Comprobando en el servidor...';
    statusEl.style.color = '#aaa';

    // 1. Comprobar si el archivo final ya existe
    const info = await checkExistence(selectedFile);
    if (info && info.exists) {
      fileAlreadyExists = true;
      overwriteBox.style.display = 'block';
      overwriteMsg.textContent = `⚠️ "${info.filename}" ya existe en el servidor (${formatBytes(info.size)}).`;
      statusEl.textContent = 'El video ya fue subido anteriormente.';
      statusEl.style.color = '#f5c066';
      btn.disabled = true;
      btn.textContent = 'Ya existe en el servidor';
      return;
    }

    // 2. Comprobar si hay fragmentos previos para reanudar
    currentUploadId = getUploadId(selectedFile);
    const chunkStatus = await fetchUploadStatus(currentUploadId);
    if (chunkStatus && chunkStatus.uploadedChunks && chunkStatus.uploadedChunks.length > 0) {
      const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
      const uploadedCount = chunkStatus.uploadedChunks.length;
      const pct = Math.min(99, Math.round((uploadedCount / totalChunks) * 100));
      bar.style.display = 'block';
      bar.value = pct;
      statusEl.textContent = `ℹ️ Se detectó una subida previa (${pct}%). Continuará donde se quedó.`;
      statusEl.style.color = '#7ec8ff';
      btn.disabled = false;
      btn.textContent = `Reanudar subida (${pct}%)`;
      return;
    }
  }

  statusEl.textContent = '';
  btn.disabled = false;
  btn.textContent = 'Subir';
}

async function setFile(file) {
  selectedFile = file;
  currentUploadId = getUploadId(file);
  drop.textContent = `Seleccionado: ${file.name} (${formatBytes(file.size)})`;
  cancelBtn.style.display = 'block';
  cancelBtn.className = '';
  cancelBtn.textContent = 'Cancelar';
  await updateFileStatus();
}

// Evento de cambio en el token
tokenInput.addEventListener('input', () => {
  if (selectedFile && !fileAlreadyExists && !isUploading) {
    updateFileStatus();
  }
});

// Evento de overwrite checkbox
overwriteInput.addEventListener('change', () => {
  if (overwriteInput.checked) {
    btn.disabled = false;
    btn.className = 'warning';
    btn.textContent = 'Sobrescribir video';
  } else {
    btn.disabled = true;
    btn.className = '';
    btn.textContent = 'Ya existe en el servidor';
  }
});

// Reiniciar el uploader
function resetUploader(keepStatus = false) {
  selectedFile = null;
  fileAlreadyExists = false;
  isUploading = false;
  isCancelled = false;
  activeXhr = null;
  currentUploadId = null;
  fileInput.value = '';
  drop.textContent = '📷 Toca para elegir un video de tus fotos';
  overwriteBox.style.display = 'none';
  overwriteInput.checked = false;
  btn.disabled = true;
  btn.className = '';
  btn.textContent = 'Subir';
  cancelBtn.style.display = 'none';
  cancelBtn.className = '';
  cancelBtn.textContent = 'Cancelar';
  bar.style.display = 'none';
  bar.value = 0;
  if (!keepStatus) {
    statusEl.textContent = '';
  }
}

// Botón de cancelar
cancelBtn.addEventListener('click', async () => {
  if (isUploading) {
    isCancelled = true;
    if (activeXhr) {
      activeXhr.abort();
      activeXhr = null;
    }
  } else {
    if (currentUploadId && tokenInput.value) {
      try {
        await fetch(`/cancel-upload?uploadId=${encodeURIComponent(currentUploadId)}`, {
          method: 'POST',
          headers: { 'x-upload-token': tokenInput.value }
        });
      } catch (e) {}
    }
    resetUploader(false);
    statusEl.textContent = 'Selección cancelada';
    statusEl.style.color = '#aaa';
  }
});

// Subir fragmento con progreso
function uploadChunkWithProgress({ chunkBlob, chunkIndex, totalChunks, token, uploadId, filename, overwrite, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeXhr = xhr;

    xhr.open('POST', '/upload-chunk');
    xhr.setRequestHeader('x-upload-token', token);
    xhr.setRequestHeader('x-upload-id', uploadId);
    xhr.setRequestHeader('x-chunk-index', chunkIndex.toString());
    xhr.setRequestHeader('x-total-chunks', totalChunks.toString());
    xhr.setRequestHeader('x-filename', encodeURIComponent(filename));
    if (overwrite) {
      xhr.setRequestHeader('x-overwrite', 'true');
    }

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded);
      }
    });

    xhr.onload = () => {
      activeXhr = null;
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status === 200) {
          resolve(res);
        } else {
          reject(new Error(res.error || `Error ${xhr.status}`));
        }
      } catch {
        reject(new Error('Respuesta inesperada del servidor'));
      }
    };

    xhr.onerror = () => {
      activeXhr = null;
      reject(new Error('Error de conexión al enviar fragmento'));
    };

    xhr.onabort = () => {
      activeXhr = null;
      reject(new Error('Cancelado'));
    };

    xhr.send(chunkBlob);
  });
}

// Botón principal de subir
btn.addEventListener('click', async () => {
  if (!selectedFile || isUploading) return;
  const token = tokenInput.value;
  if (!token) {
    statusEl.textContent = '✖ Debes ingresar la clave de acceso';
    statusEl.style.color = '#ff5555';
    return;
  }
  if (rememberBox.checked) localStorage.setItem('uploadToken', token);

  // Verificación previa si no está activado sobrescribir
  if (!overwriteInput.checked) {
    statusEl.textContent = 'Verificando en el servidor...';
    const check = await checkExistence(selectedFile);
    if (check && check.exists) {
      fileAlreadyExists = true;
      overwriteBox.style.display = 'block';
      overwriteMsg.textContent = `⚠️ "${check.filename}" ya existe en el servidor (${formatBytes(check.size)}).`;
      statusEl.textContent = 'El video ya fue subido antes. No se subió para evitar duplicados.';
      statusEl.style.color = '#f5c066';
      btn.disabled = true;
      btn.textContent = 'Ya existe en el servidor';
      return;
    }
  }

  isUploading = true;
  isCancelled = false;
  currentUploadId = getUploadId(selectedFile);

  btn.disabled = true;
  cancelBtn.style.display = 'block';
  cancelBtn.className = 'uploading';
  cancelBtn.textContent = 'Cancelar subida';
  bar.style.display = 'block';

  const totalSize = selectedFile.size;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

  // Consultar qué fragmentos ya están en el servidor
  let uploadedChunksSet = new Set();
  const chunkStatus = await fetchUploadStatus(currentUploadId);
  if (chunkStatus && chunkStatus.uploadedChunks) {
    uploadedChunksSet = new Set(chunkStatus.uploadedChunks);
  }

  // Calcular bytes ya subidos
  let totalBytesUploaded = 0;
  for (let i = 0; i < totalChunks; i++) {
    if (uploadedChunksSet.has(i)) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      totalBytesUploaded += (end - start);
    }
  }

  const initialPercent = totalSize > 0 ? (totalBytesUploaded / totalSize) * 100 : 0;
  bar.value = initialPercent;

  // Subir fragmentos
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    if (isCancelled) break;

    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalSize);
    const chunkBlob = selectedFile.slice(start, end);
    const chunkSize = end - start;

    // Saltar si ya está subido
    if (uploadedChunksSet.has(chunkIndex)) {
      continue;
    }

    try {
      await uploadChunkWithProgress({
        chunkBlob,
        chunkIndex,
        totalChunks,
        token,
        uploadId: currentUploadId,
        filename: selectedFile.name,
        overwrite: overwriteInput.checked,
        onProgress: (loadedBytes) => {
          const currentTotal = totalBytesUploaded + loadedBytes;
          const pct = Math.min(99, Math.round((currentTotal / totalSize) * 100));
          bar.value = pct;
          statusEl.textContent = `Subiendo: ${pct}% (Parte ${chunkIndex + 1}/${totalChunks}) - ${formatBytes(currentTotal)} / ${formatBytes(totalSize)}`;
          statusEl.style.color = '#eee';
        }
      });

      totalBytesUploaded += chunkSize;
      uploadedChunksSet.add(chunkIndex);
      const pct = Math.min(99, Math.round((totalBytesUploaded / totalSize) * 100));
      bar.value = pct;
    } catch (err) {
      if (isCancelled) break;

      console.error('Error subiendo fragmento:', err);
      isUploading = false;
      btn.disabled = false;
      btn.className = '';
      btn.textContent = 'Reanudar subida';
      cancelBtn.className = '';
      cancelBtn.textContent = 'Cancelar';
      statusEl.textContent = `✖ Pausado en parte ${chunkIndex + 1}: ${err.message || 'Error de conexión'}. Puedes reanudar.`;
      statusEl.style.color = '#ff5555';
      return;
    }
  }

  isUploading = false;

  if (isCancelled) {
    const uploadedCount = uploadedChunksSet.size;
    const pct = Math.round((uploadedCount / totalChunks) * 100);
    bar.value = pct;
    statusEl.textContent = `⏹ Subida pausada (${pct}% completado). Los fragmentos se guardaron para reanudar cuando quieras.`;
    statusEl.style.color = '#f5c066';
    btn.disabled = false;
    btn.className = '';
    btn.textContent = `Reanudar subida (${pct}%)`;
    cancelBtn.className = '';
    cancelBtn.textContent = 'Cancelar';
    return;
  }

  // Todo completado
  bar.value = 100;
  statusEl.textContent = `✔ Subido y ensamblado correctamente: ${selectedFile.name}`;
  statusEl.style.color = '#44ff88';
  resetUploader(true);
});

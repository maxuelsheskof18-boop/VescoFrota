'use strict';

/**
 * URL do Web App publicado no Google Apps Script.
 * Mantenha sempre a URL final terminada em /exec.
 */
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxyufThTQd639n9Vp-MR8pIiD90luMT6zc7imqmwsshRaco-1SLXwb84rhfazgvVPE/exec';
const TIME_ZONE = 'America/Sao_Paulo';
const EXPECTED_API_VERSION = '2.3.0-drive-permissions';

const PHOTO_CONFIG = Object.freeze({
  maxPhotos: 5,
  maxOriginalBytes: 15 * 1024 * 1024,
  maxCompressedBytes: 900 * 1024,
  maxTotalBytes: 4.5 * 1024 * 1024,
  initialMaxEdge: 1600
});

const elements = {
  currentDateTime: document.getElementById('currentDateTime'),
  tabCheck: document.getElementById('tabCheck'),
  tabMaint: document.getElementById('tabMaint'),
  sectionCheck: document.getElementById('sectionCheck'),
  sectionMaint: document.getElementById('sectionMaint'),
  checkForm: document.getElementById('checkForm'),
  maintenanceForm: document.getElementById('maintenanceForm'),
  submitCheck: document.getElementById('submitCheck'),
  submitMaint: document.getElementById('submitMaint'),
  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toastIcon'),
  toastMessage: document.getElementById('toastMessage'),
  resultDialog: document.getElementById('resultDialog'),
  closeResultDialog: document.getElementById('closeResultDialog'),
  newRecordButton: document.getElementById('newRecordButton'),
  shareWhatsAppButton: document.getElementById('shareWhatsAppButton'),
  openPhotosButton: document.getElementById('openPhotosButton'),
  resultProtocol: document.getElementById('resultProtocol'),
  resultVehicle: document.getElementById('resultVehicle'),
  resultPhotoCount: document.getElementById('resultPhotoCount'),
  resultSharingNotice: document.getElementById('resultSharingNotice')
};

const photoCollections = {
  check: [],
  maintenance: []
};

const photoUi = {
  check: {
    cameraInput: document.getElementById('checkCameraInput'),
    galleryInput: document.getElementById('checkGalleryInput'),
    preview: document.getElementById('checkPhotoPreview'),
    count: document.getElementById('checkPhotoCount'),
    error: document.getElementById('checkPhotoError'),
    card: document.querySelector('[data-photo-section="check"]')
  },
  maintenance: {
    cameraInput: document.getElementById('maintenanceCameraInput'),
    galleryInput: document.getElementById('maintenanceGalleryInput'),
    preview: document.getElementById('maintenancePhotoPreview'),
    count: document.getElementById('maintenancePhotoCount'),
    error: document.getElementById('maintenancePhotoError'),
    card: document.querySelector('[data-photo-section="maintenance"]')
  }
};

let toastTimer = null;
let lastResult = null;

function getBrasiliaParts() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  return formatter.formatToParts(new Date()).reduce((result, part) => {
    if (part.type !== 'literal') {
      result[part.type] = part.value;
    }
    return result;
  }, {});
}

function setCurrentDateTimes() {
  const parts = getBrasiliaParts();
  const dateValue = `${parts.year}-${parts.month}-${parts.day}`;
  const timeValue = `${parts.hour}:${parts.minute}`;

  ['dateCheck', 'dateMaint'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = dateValue;
  });

  ['timeCheck', 'timeMaint'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = timeValue;
  });
}

function updateHeaderClock() {
  if (!elements.currentDateTime) return;

  elements.currentDateTime.textContent = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());
}

function activateTab(tabName) {
  const checkActive = tabName === 'check';

  elements.tabCheck.classList.toggle('is-active', checkActive);
  elements.tabMaint.classList.toggle('is-active', !checkActive);

  elements.tabCheck.setAttribute('aria-selected', String(checkActive));
  elements.tabMaint.setAttribute('aria-selected', String(!checkActive));

  elements.sectionCheck.hidden = !checkActive;
  elements.sectionMaint.hidden = checkActive;

  elements.sectionCheck.classList.toggle('is-hidden', !checkActive);
  elements.sectionMaint.classList.toggle('is-hidden', checkActive);
}

function setupTabs() {
  elements.tabCheck.addEventListener('click', () => activateTab('check'));
  elements.tabMaint.addEventListener('click', () => activateTab('maintenance'));
}

function setToggleState(button) {
  const field = button.dataset.field;
  const value = button.dataset.value;

  document.querySelectorAll(`.toggle-btn[data-field="${field}"]`).forEach((currentButton) => {
    const selected = currentButton === button;
    currentButton.classList.toggle('is-active', selected);
    currentButton.setAttribute('aria-pressed', String(selected));
  });

  const hiddenInput = document.getElementById(`${field}Status`);
  if (hiddenInput) hiddenInput.value = value;

  button.closest('.check-item')?.classList.remove('has-error');
}

function setupToggles() {
  document.querySelectorAll('.toggle-btn').forEach((button) => {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => setToggleState(button));
  });
}

function showToast(message, type = 'success', duration = 3800) {
  window.clearTimeout(toastTimer);

  elements.toast.classList.remove('is-error', 'is-warning');

  if (type === 'error') {
    elements.toast.classList.add('is-error');
    elements.toastIcon.className = 'fa-solid fa-circle-exclamation';
  } else if (type === 'warning') {
    elements.toast.classList.add('is-warning');
    elements.toastIcon.className = 'fa-solid fa-triangle-exclamation';
  } else {
    elements.toastIcon.className = 'fa-solid fa-circle-check';
  }

  elements.toastMessage.textContent = message;
  elements.toast.classList.add('is-visible');

  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('is-visible');
  }, duration);
}

function combineDateTimeForBR(dateString, timeString) {
  if (!dateString || !timeString) return '';

  const [year, month, day] = dateString.split('-');
  const [hour, minute] = timeString.split(':');

  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function setButtonLoading(button, isLoading, loadingText) {
  if (!button.dataset.originalHtml) {
    button.dataset.originalHtml = button.innerHTML;
  }

  button.disabled = isLoading;
  button.innerHTML = isLoading
    ? `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>${loadingText}</span>`
    : button.dataset.originalHtml;
}

function clearValidationState(form) {
  form.querySelectorAll('.is-invalid').forEach((field) => field.classList.remove('is-invalid'));
  form.querySelectorAll('.check-item.has-error').forEach((item) => item.classList.remove('has-error'));
}

function validateRequiredFields(form) {
  clearValidationState(form);

  let firstInvalidField = null;

  form.querySelectorAll('[required]').forEach((field) => {
    if (!String(field.value || '').trim()) {
      field.classList.add('is-invalid');
      firstInvalidField ??= field;
    }
  });

  if (firstInvalidField) {
    firstInvalidField.focus();
    showToast('Preencha todos os campos obrigatórios.', 'error');
    return false;
  }

  return true;
}

function validateChecklist() {
  const checklistFields = ['water', 'oil', 'brakes', 'lights', 'tires'];
  let firstInvalidItem = null;

  checklistFields.forEach((field) => {
    const hiddenInput = document.getElementById(`${field}Status`);
    const checkItem = document.querySelector(`.toggle-btn[data-field="${field}"]`)?.closest('.check-item');
    const isInvalid = !hiddenInput?.value;

    checkItem?.classList.toggle('has-error', isInvalid);

    if (isInvalid && !firstInvalidItem) {
      firstInvalidItem = checkItem;
    }
  });

  if (firstInvalidItem) {
    firstInvalidItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Marque uma opção em todas as verificações.', 'error');
    return false;
  }

  return true;
}

function validatePhotos(section) {
  const hasPhotos = photoCollections[section].length > 0;
  photoUi[section].card.classList.toggle('has-error', !hasPhotos);
  photoUi[section].error.hidden = hasPhotos;

  if (!hasPhotos) {
    photoUi[section].card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Adicione pelo menos uma foto ao registro.', 'error');
  }

  return hasPhotos;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeFileBaseName(name) {
  const withoutExtension = String(name || 'foto').replace(/\.[^.]+$/, '');
  const normalized = withoutExtension
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);

  return normalized || 'foto';
}

function createPhotoId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Não foi possível comprimir a imagem.'));
    }, type, quality);
  });
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url)
    });

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Formato de imagem não suportado pelo navegador.'));
    };

    image.src = url;
  });
}

async function loadImageSource(file) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close()
      };
    } catch (error) {
      console.warn('createImageBitmap falhou; usando Image:', error);
    }
  }

  return loadImageElement(file);
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name}: selecione somente arquivos de imagem.`);
  }

  if (file.size > PHOTO_CONFIG.maxOriginalBytes) {
    throw new Error(`${file.name}: a foto original ultrapassa 15 MB.`);
  }

  const image = await loadImageSource(file);

  try {
    let maxEdge = PHOTO_CONFIG.initialMaxEdge;
    const qualityLevels = [0.78, 0.68, 0.58, 0.5, 0.44];
    let lastBlob = null;

    for (let attempt = 0; attempt < qualityLevels.length; attempt += 1) {
      const ratio = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * ratio));
      const height = Math.max(1, Math.round(image.height * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image.source, 0, 0, width, height);

      lastBlob = await canvasToBlob(canvas, 'image/jpeg', qualityLevels[attempt]);

      if (lastBlob.size <= PHOTO_CONFIG.maxCompressedBytes) {
        return lastBlob;
      }

      maxEdge = Math.max(900, Math.round(maxEdge * 0.82));
    }

    if (!lastBlob || lastBlob.size > PHOTO_CONFIG.maxCompressedBytes * 1.3) {
      throw new Error(`${file.name}: não foi possível reduzir a foto para o limite permitido.`);
    }

    return lastBlob;
  } finally {
    image.cleanup();
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };

    reader.onerror = () => reject(new Error('Não foi possível ler a imagem comprimida.'));
    reader.readAsDataURL(blob);
  });
}

function getCollectionTotalBytes(section) {
  return photoCollections[section].reduce((total, photo) => total + photo.size, 0);
}

async function addPhotoFiles(section, files) {
  const incomingFiles = Array.from(files || []);

  if (!incomingFiles.length) return;

  const availableSlots = PHOTO_CONFIG.maxPhotos - photoCollections[section].length;

  if (availableSlots <= 0) {
    showToast('O limite é de 5 fotos por registro.', 'warning');
    return;
  }

  const selectedFiles = incomingFiles.slice(0, availableSlots);

  if (incomingFiles.length > availableSlots) {
    showToast(`Somente ${availableSlots} foto(s) foram adicionadas por causa do limite.`, 'warning', 4500);
  } else {
    showToast('Processando e comprimindo as fotos...', 'warning', 2500);
  }

  for (const file of selectedFiles) {
    try {
      const compressedBlob = await compressImage(file);
      const prospectiveTotal = getCollectionTotalBytes(section) + compressedBlob.size;

      if (prospectiveTotal > PHOTO_CONFIG.maxTotalBytes) {
        throw new Error('O conjunto de fotos ultrapassou o limite total. Remova uma foto e tente novamente.');
      }

      const base64 = await blobToBase64(compressedBlob);
      const previewUrl = URL.createObjectURL(compressedBlob);

      photoCollections[section].push({
        id: createPhotoId(),
        name: `${sanitizeFileBaseName(file.name)}.jpg`,
        mimeType: 'image/jpeg',
        base64,
        size: compressedBlob.size,
        previewUrl
      });
    } catch (error) {
      console.error('Erro ao preparar foto:', error);
      showToast(error.message || 'Não foi possível processar uma das fotos.', 'error', 5200);
    }
  }

  photoUi[section].cameraInput.value = '';
  photoUi[section].galleryInput.value = '';
  photoUi[section].card.classList.remove('has-error');
  photoUi[section].error.hidden = true;
  renderPhotoPreviews(section);
}

function removePhoto(section, photoId) {
  const index = photoCollections[section].findIndex((photo) => photo.id === photoId);

  if (index < 0) return;

  URL.revokeObjectURL(photoCollections[section][index].previewUrl);
  photoCollections[section].splice(index, 1);
  renderPhotoPreviews(section);
}

function renderPhotoPreviews(section) {
  const ui = photoUi[section];
  ui.preview.innerHTML = '';

  photoCollections[section].forEach((photo, index) => {
    const item = document.createElement('div');
    item.className = 'photo-preview-item';

    const image = document.createElement('img');
    image.src = photo.previewUrl;
    image.alt = `Foto ${index + 1} do registro`;

    const size = document.createElement('span');
    size.className = 'photo-preview-size';
    size.textContent = formatBytes(photo.size);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'photo-preview-remove';
    removeButton.setAttribute('aria-label', `Remover foto ${index + 1}`);
    removeButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
    removeButton.addEventListener('click', () => removePhoto(section, photo.id));

    item.append(image, size, removeButton);
    ui.preview.appendChild(item);
  });

  ui.count.textContent = `${photoCollections[section].length} de ${PHOTO_CONFIG.maxPhotos} fotos`;
}

function setupPhotoUploadSection(section) {
  const ui = photoUi[section];

  document.querySelector(`[data-photo-camera="${section}"]`).addEventListener('click', () => {
    ui.cameraInput.click();
  });

  document.querySelector(`[data-photo-gallery="${section}"]`).addEventListener('click', () => {
    ui.galleryInput.click();
  });

  ui.cameraInput.addEventListener('change', () => addPhotoFiles(section, ui.cameraInput.files));
  ui.galleryInput.addEventListener('change', () => addPhotoFiles(section, ui.galleryInput.files));
}

function setupPhotoUploads() {
  setupPhotoUploadSection('check');
  setupPhotoUploadSection('maintenance');
}

function serializePhotos(section) {
  return photoCollections[section].map(({ name, mimeType, base64, size }) => ({
    name,
    mimeType,
    base64,
    size
  }));
}

/**
 * Envia o JSON sem Content-Type application/json.
 * Assim o navegador não dispara o preflight OPTIONS bloqueado pelo Web App.
 */
async function postJSON(payload) {
  const response = await fetch(WEBAPP_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
    redirect: 'follow',
    credentials: 'omit'
  });

  if (!response.ok) {
    throw new Error(`Erro HTTP ${response.status}`);
  }

  const responseText = await response.text();

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error('O servidor retornou uma resposta inválida.');
  }
}


function validateServerResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('O servidor retornou uma resposta vazia ou inválida.');
  }

  if (result.status !== 'success' && result.success !== true) {
    throw new Error(result.message || 'O servidor não conseguiu concluir o registro.');
  }

  const missingFields = [];

  if (!result.protocol) missingFields.push('protocolo');
  if (!Number.isInteger(Number(result.photoCount)) || Number(result.photoCount) < 1) {
    missingFields.push('quantidade de fotos');
  }
  if (!result.reportFolderUrl) missingFields.push('link das fotos');

  if (missingFields.length) {
    throw new Error(
      'O Apps Script publicado está desatualizado. Faltaram: ' +
      missingFields.join(', ') +
      '. Publique uma nova versão do Web App e tente novamente.'
    );
  }

  if (result.apiVersion && result.apiVersion !== EXPECTED_API_VERSION) {
    console.warn(
      `Versão da API diferente. Esperada: ${EXPECTED_API_VERSION}. Recebida: ${result.apiVersion}.`
    );
  }

  return result;
}

function clearPhotoCollection(section) {
  photoCollections[section].forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  photoCollections[section] = [];
  photoUi[section].cameraInput.value = '';
  photoUi[section].galleryInput.value = '';
  photoUi[section].card.classList.remove('has-error');
  photoUi[section].error.hidden = true;
  renderPhotoPreviews(section);
}

function resetForm(form, photoSection) {
  form.reset();

  form.querySelectorAll('input[type="hidden"]').forEach((input) => {
    input.value = '';
  });

  form.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
  });

  clearValidationState(form);
  clearPhotoCollection(photoSection);
  setCurrentDateTimes();
}

function openResultDialog(result, vehicle) {
  lastResult = result;
  elements.resultProtocol.textContent = result.protocol;
  elements.resultVehicle.textContent = vehicle || '-';
  elements.resultPhotoCount.textContent = String(result.photoCount);

  if (result.reportFolderUrl) {
    elements.openPhotosButton.href = result.reportFolderUrl;
    elements.openPhotosButton.hidden = false;
  } else {
    elements.openPhotosButton.removeAttribute('href');
    elements.openPhotosButton.hidden = true;
  }

  if (result.linkSharingAvailable === false) {
    elements.resultSharingNotice.hidden = false;
    elements.resultSharingNotice.textContent = 'As fotos foram salvas, mas a conta Google não permitiu acesso público pelo link. Quem abrir poderá precisar entrar na conta autorizada.';
  } else {
    elements.resultSharingNotice.hidden = true;
    elements.resultSharingNotice.textContent = '';
  }

  if (typeof elements.resultDialog.showModal === 'function') {
    elements.resultDialog.showModal();
  } else {
    elements.resultDialog.setAttribute('open', '');
  }
}

function closeResultDialog() {
  if (typeof elements.resultDialog.close === 'function') {
    elements.resultDialog.close();
  } else {
    elements.resultDialog.removeAttribute('open');
  }
}

function shareLastResultOnWhatsApp() {
  if (!lastResult) return;

  const message = lastResult.whatsappMessage || [
    'RELATÓRIO DE FROTA VESCO',
    '',
    `Protocolo: ${lastResult.protocol || '-'}`,
    lastResult.reportFolderUrl ? `Fotos: ${lastResult.reportFolderUrl}` : ''
  ].filter(Boolean).join('\n');

  const shareUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(shareUrl, '_blank', 'noopener,noreferrer');
}

function setupResultDialog() {
  elements.closeResultDialog.addEventListener('click', closeResultDialog);
  elements.newRecordButton.addEventListener('click', closeResultDialog);
  elements.shareWhatsAppButton.addEventListener('click', shareLastResultOnWhatsApp);

  elements.resultDialog.addEventListener('click', (event) => {
    if (event.target === elements.resultDialog) {
      closeResultDialog();
    }
  });
}

async function handleCheckSubmit(event) {
  event.preventDefault();

  if (!validateRequiredFields(elements.checkForm) || !validateChecklist() || !validatePhotos('check')) {
    return;
  }

  const date = document.getElementById('dateCheck').value;
  const time = document.getElementById('timeCheck').value;
  const vehicle = document.getElementById('vehicleCheck').value.trim();

  const payload = {
    type: 'dailyCheck',
    timestamp: combineDateTimeForBR(date, time),
    driverName: document.getElementById('driverName').value.trim(),
    vehicle,
    km: document.getElementById('kmCheck').value.trim(),
    waterStatus: document.getElementById('waterStatus').value,
    oilStatus: document.getElementById('oilStatus').value,
    brakesStatus: document.getElementById('brakesStatus').value,
    lightsStatus: document.getElementById('lightsStatus').value,
    tiresStatus: document.getElementById('tiresStatus').value,
    observations: document.getElementById('observationsCheck').value.trim(),
    photos: serializePhotos('check')
  };

  try {
    setButtonLoading(elements.submitCheck, true, 'Enviando relatório e fotos...');

    const result = await postJSON(payload);

    validateServerResult(result);

    showToast(result.message || 'Verificação registrada com sucesso.');
    resetForm(elements.checkForm, 'check');
    openResultDialog(result, vehicle);
  } catch (error) {
    console.error('Erro ao enviar verificação:', error);
    showToast(error.message || 'Erro ao enviar. Tente novamente.', 'error', 5200);
  } finally {
    setButtonLoading(elements.submitCheck, false);
  }
}

async function handleMaintenanceSubmit(event) {
  event.preventDefault();

  if (!validateRequiredFields(elements.maintenanceForm) || !validatePhotos('maintenance')) {
    return;
  }

  const date = document.getElementById('dateMaint').value;
  const time = document.getElementById('timeMaint').value;
  const vehicle = document.getElementById('vehicleMaint').value.trim();

  const payload = {
    type: 'maintenance',
    timestamp: combineDateTimeForBR(date, time),
    responsible: document.getElementById('responsible').value.trim(),
    vehicle,
    km: document.getElementById('kmMaint').value.trim(),
    maintenanceType: document.getElementById('maintenanceType').value,
    priority: document.getElementById('priority').value,
    description: document.getElementById('description').value.trim(),
    cost: document.getElementById('cost').value.trim(),
    photos: serializePhotos('maintenance')
  };

  try {
    setButtonLoading(elements.submitMaint, true, 'Enviando solicitação e fotos...');

    const result = await postJSON(payload);

    validateServerResult(result);

    showToast(result.message || 'Solicitação registrada com sucesso.');
    resetForm(elements.maintenanceForm, 'maintenance');
    openResultDialog(result, vehicle);
  } catch (error) {
    console.error('Erro ao enviar manutenção:', error);
    showToast(error.message || 'Erro ao enviar. Tente novamente.', 'error', 5200);
  } finally {
    setButtonLoading(elements.submitMaint, false);
  }
}

function setupValidationCleanup() {
  document.querySelectorAll('input, select, textarea').forEach((field) => {
    const eventName = field.tagName === 'SELECT' ? 'change' : 'input';
    field.addEventListener(eventName, () => field.classList.remove('is-invalid'));
  });
}

function initializeApp() {
  setupTabs();
  setupToggles();
  setupPhotoUploads();
  setupResultDialog();
  setupValidationCleanup();

  elements.checkForm.addEventListener('submit', handleCheckSubmit);
  elements.maintenanceForm.addEventListener('submit', handleMaintenanceSubmit);

  setCurrentDateTimes();
  updateHeaderClock();
  window.setInterval(updateHeaderClock, 1000);
}

initializeApp();

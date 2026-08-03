'use strict';

/**
 * URL do Web App publicado no Google Apps Script.
 * Mantenha sempre a URL final terminada em /exec.
 */
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxyufThTQd639n9Vp-MR8pIiD90luMT6zc7imqmwsshRaco-1SLXwb84rhfazgvVPE/exec';
const TIME_ZONE = 'America/Sao_Paulo';

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
  toastMessage: document.getElementById('toastMessage')
};

let toastTimer = null;

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

function showToast(message, type = 'success') {
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
  }, 3800);
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

/**
 * Envia o JSON sem Content-Type application/json.
 * Assim o navegador não dispara o preflight OPTIONS que é bloqueado
 * pelo Web App do Google Apps Script.
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

function resetForm(form) {
  form.reset();

  form.querySelectorAll('input[type="hidden"]').forEach((input) => {
    input.value = '';
  });

  form.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
  });

  clearValidationState(form);
  setCurrentDateTimes();
}

async function handleCheckSubmit(event) {
  event.preventDefault();

  if (!validateRequiredFields(elements.checkForm) || !validateChecklist()) {
    return;
  }

  const date = document.getElementById('dateCheck').value;
  const time = document.getElementById('timeCheck').value;

  const payload = {
    type: 'dailyCheck',
    timestamp: combineDateTimeForBR(date, time),
    driverName: document.getElementById('driverName').value.trim(),
    vehicle: document.getElementById('vehicleCheck').value.trim(),
    km: document.getElementById('kmCheck').value.trim(),
    waterStatus: document.getElementById('waterStatus').value,
    oilStatus: document.getElementById('oilStatus').value,
    brakesStatus: document.getElementById('brakesStatus').value,
    lightsStatus: document.getElementById('lightsStatus').value,
    tiresStatus: document.getElementById('tiresStatus').value,
    observations: document.getElementById('observationsCheck').value.trim()
  };

  try {
    setButtonLoading(elements.submitCheck, true, 'Enviando...');

    const result = await postJSON(payload);

    if (result.status !== 'success' && result.success !== true) {
      throw new Error(result.message || 'Não foi possível registrar a verificação.');
    }

    showToast(result.message || 'Verificação registrada com sucesso.');
    resetForm(elements.checkForm);
  } catch (error) {
    console.error('Erro ao enviar verificação:', error);
    showToast(error.message || 'Erro ao enviar. Tente novamente.', 'error');
  } finally {
    setButtonLoading(elements.submitCheck, false);
  }
}

async function handleMaintenanceSubmit(event) {
  event.preventDefault();

  if (!validateRequiredFields(elements.maintenanceForm)) {
    return;
  }

  const date = document.getElementById('dateMaint').value;
  const time = document.getElementById('timeMaint').value;

  const payload = {
    type: 'maintenance',
    timestamp: combineDateTimeForBR(date, time),
    responsible: document.getElementById('responsible').value.trim(),
    vehicle: document.getElementById('vehicleMaint').value.trim(),
    km: document.getElementById('kmMaint').value.trim(),
    maintenanceType: document.getElementById('maintenanceType').value,
    priority: document.getElementById('priority').value,
    description: document.getElementById('description').value.trim(),
    cost: document.getElementById('cost').value.trim()
  };

  try {
    setButtonLoading(elements.submitMaint, true, 'Enviando...');

    const result = await postJSON(payload);

    if (result.status !== 'success' && result.success !== true) {
      throw new Error(result.message || 'Não foi possível registrar a manutenção.');
    }

    showToast(result.message || 'Solicitação registrada com sucesso.');
    resetForm(elements.maintenanceForm);
  } catch (error) {
    console.error('Erro ao enviar manutenção:', error);
    showToast(error.message || 'Erro ao enviar. Tente novamente.', 'error');
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
  setupValidationCleanup();

  elements.checkForm.addEventListener('submit', handleCheckSubmit);
  elements.maintenanceForm.addEventListener('submit', handleMaintenanceSubmit);

  setCurrentDateTimes();
  updateHeaderClock();
  window.setInterval(updateHeaderClock, 1000);
}

initializeApp();

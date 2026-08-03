/**
 * VESCO FLEET CONTROL
 * Back-end do Google Apps Script.
 *
 * Recursos:
 * - Verificação diária
 * - Manutenção / melhorias
 * - Upload de 1 a 5 fotos comprimidas
 * - Organização das fotos por mês e protocolo
 * - Link para compartilhamento no WhatsApp
 * - Limpeza mensal automática das fotos antigas
 */

const CONFIG = Object.freeze({
  /**
   * Se o Apps Script estiver vinculado à planilha, pode deixar vazio.
   * Em projeto independente, informe o ID da planilha.
   */
  SPREADSHEET_ID: '',

  API_VERSION: '2.2.0-fotos-protocolo',

  /**
   * Cole o ID ou a URL completa da pasta que você criou no Google Drive.
   * Exemplo de ID: 1AbCdEfGhIjKlMnOpQrStUvWxYz
   */
  PHOTO_ROOT_FOLDER_ID_OR_URL: 'https://drive.google.com/drive/folders/1Z6Qba_eI6UdGDJn_arOPMBYDySv9-jii?usp=drive_link',

  DAILY_CHECK_SHEET: 'Verificações Diárias',
  MAINTENANCE_SHEET: 'Manutenções',
  TIME_ZONE: 'America/Sao_Paulo',

  MAX_PHOTOS: 5,
  MAX_PHOTO_BYTES: 950 * 1024,
  MAX_TOTAL_PHOTO_BYTES: 5 * 1024 * 1024,

  /**
   * 1 = mantém somente as fotos do mês atual.
   * 2 = mantém mês atual + mês anterior.
   */
  PHOTO_RETENTION_MONTHS: 1,

  /**
   * true = exclusão definitiva das pastas mensais antigas.
   * Requer o Serviço avançado do Google Drive habilitado.
   */
  PERMANENT_DELETE_OLD_PHOTOS: true,

  /**
   * Permite abrir as fotos pelo link enviado no WhatsApp.
   * A configuração pode ser bloqueada pelo administrador do Google Workspace.
   */
  SHARE_REPORT_FOLDER_WITH_LINK: true,

  MONTH_FOLDER_PREFIX: 'VESCO_FROTA_',
  CLEANUP_TRIGGER_FUNCTION: 'limparFotosMensais'
});

const DAILY_HEADERS = Object.freeze([
  'Protocolo',
  'Registro no Sistema',
  'Data/Hora Informada',
  'Nome do Motorista',
  'Veículo',
  'Quilometragem',
  'Nível de Água',
  'Nível de Óleo',
  'Freios',
  'Luzes',
  'Pneus',
  'Observações / Ações a Tomar',
  'Quantidade de Fotos',
  'Link das Fotos',
  'Status das Fotos'
]);

const MAINTENANCE_HEADERS = Object.freeze([
  'Protocolo',
  'Registro no Sistema',
  'Data/Hora Informada',
  'Responsável',
  'Veículo',
  'Quilometragem',
  'Tipo',
  'Prioridade',
  'Descrição Detalhada',
  'Custo Estimado',
  'Quantidade de Fotos',
  'Link das Fotos',
  'Status das Fotos'
]);

/**
 * Recebe o JSON enviado pelo front-end.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  let lockObtido = false;
  let reportFolder = null;

  try {
    validarConfiguracao_();

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Nenhum dado foi recebido.');
    }

    const payload = JSON.parse(e.postData.contents);

    if (!payload.type) {
      throw new Error('O tipo do registro não foi informado.');
    }

    const photos = validarFotos_(payload.photos);
    const protocol = criarProtocolo_();
    const serverDate = new Date();
    const vehicle = textoObrigatorio_(payload.vehicle, 'Veículo', 200);

    reportFolder = criarPastaDoRelatorio_(protocol, vehicle, serverDate);
    const savedPhotos = salvarFotos_(reportFolder, photos, protocol);
    const linkSharingAvailable = configurarCompartilhamento_(reportFolder);

    lock.waitLock(30000);
    lockObtido = true;

    let result;

    if (payload.type === 'dailyCheck') {
      result = registrarVerificacaoDiaria_(
        payload,
        protocol,
        serverDate,
        reportFolder,
        savedPhotos,
        linkSharingAvailable
      );
    } else if (payload.type === 'maintenance') {
      result = registrarManutencao_(
        payload,
        protocol,
        serverDate,
        reportFolder,
        savedPhotos,
        linkSharingAvailable
      );
    } else {
      throw new Error('Tipo de registro inválido: ' + payload.type);
    }

    return criarRespostaJson_({
      status: 'success',
      success: true,
      apiVersion: CONFIG.API_VERSION,
      message: result.message,
      protocol: protocol,
      sheet: result.sheet,
      row: result.row,
      photoCount: savedPhotos.length,
      reportFolderUrl: reportFolder.getUrl(),
      linkSharingAvailable: linkSharingAvailable,
      whatsappMessage: result.whatsappMessage
    });
  } catch (error) {
    console.error('Erro no doPost:', error);

    if (reportFolder) {
      try {
        reportFolder.setTrashed(true);
      } catch (cleanupError) {
        console.error('Não foi possível remover a pasta parcial:', cleanupError);
      }
    }

    return criarRespostaJson_({
      status: 'error',
      success: false,
      message: error && error.message
        ? error.message
        : 'Erro interno ao registrar os dados.'
    });
  } finally {
    if (lockObtido) {
      lock.releaseLock();
    }
  }
}

/**
 * Endpoint de diagnóstico.
 */
function doGet() {
  return criarRespostaJson_({
    status: 'success',
    success: true,
    service: 'Vesco Fleet Control',
    apiVersion: CONFIG.API_VERSION,
    photoUpload: true,
    protocolResponse: true,
    retentionMonths: CONFIG.PHOTO_RETENTION_MONTHS,
    message: 'API online e funcionando.',
    timestamp: Utilities.formatDate(
      new Date(),
      CONFIG.TIME_ZONE,
      'dd/MM/yyyy HH:mm:ss'
    )
  });
}

/**
 * Execute uma vez após colar o código.
 * Cria as abas, valida a pasta e instala a limpeza mensal.
 */
function configurarSistema() {
  validarConfiguracao_();

  const dailySheet = obterOuCriarAba_(CONFIG.DAILY_CHECK_SHEET, DAILY_HEADERS);
  const maintenanceSheet = obterOuCriarAba_(CONFIG.MAINTENANCE_SHEET, MAINTENANCE_HEADERS);

  formatarAbaVerificacoes_(dailySheet);
  formatarAbaManutencoes_(maintenanceSheet);

  const rootFolder = obterPastaRaizFotos_();
  obterOuCriarPastaMensal_(rootFolder, new Date());
  instalarGatilhoLimpezaMensal_();

  return {
    success: true,
    message: 'Sistema configurado com sucesso.',
    apiVersion: CONFIG.API_VERSION,
    folder: rootFolder.getName(),
    folderId: rootFolder.getId(),
    folderUrl: rootFolder.getUrl(),
    retentionMonths: CONFIG.PHOTO_RETENTION_MONTHS,
    permanentDelete: CONFIG.PERMANENT_DELETE_OLD_PHOTOS
  };
}


/**
 * Execute manualmente para confirmar que a implantação está usando
 * a pasta correta e que o retorno inclui protocolo e quantidade de fotos.
 */
function diagnosticarSistema() {
  validarConfiguracao_();

  const rootFolder = obterPastaRaizFotos_();
  const triggers = ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === CONFIG.CLEANUP_TRIGGER_FUNCTION;
    })
    .map(function(trigger) {
      return {
        functionName: trigger.getHandlerFunction(),
        eventType: String(trigger.getEventType())
      };
    });

  return {
    success: true,
    apiVersion: CONFIG.API_VERSION,
    spreadsheet: obterPlanilha_().getName(),
    photoFolderName: rootFolder.getName(),
    photoFolderId: rootFolder.getId(),
    photoFolderUrl: rootFolder.getUrl(),
    maxPhotos: CONFIG.MAX_PHOTOS,
    retentionMonths: CONFIG.PHOTO_RETENTION_MONTHS,
    permanentDelete: CONFIG.PERMANENT_DELETE_OLD_PHOTOS,
    cleanupTriggerInstalled: triggers.length > 0,
    cleanupTriggers: triggers
  };
}

/**
 * Exclui as pastas mensais que ficaram fora da retenção configurada.
 * Com PHOTO_RETENTION_MONTHS = 1, mantém apenas o mês atual.
 */
function limparFotosMensais() {
  validarConfiguracao_();

  const rootFolder = obterPastaRaizFotos_();
  const now = new Date();
  const retentionMonths = Math.max(1, Number(CONFIG.PHOTO_RETENTION_MONTHS) || 1);
  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth() - (retentionMonths - 1),
    1,
    0,
    0,
    0,
    0
  );

  const foldersToDelete = [];
  const folderIterator = rootFolder.getFolders();

  while (folderIterator.hasNext()) {
    const folder = folderIterator.next();
    const folderMonth = extrairMesDaPasta_(folder.getName());

    if (folderMonth && folderMonth.getTime() < cutoff.getTime()) {
      foldersToDelete.push(folder);
    }
  }

  const deleted = [];

  foldersToDelete.forEach(function(folder) {
    const folderName = folder.getName();
    excluirPastaMensal_(folder);
    deleted.push(folderName);
  });

  marcarFotosExpiradasNasPlanilhas_(cutoff);

  console.log(JSON.stringify({
    action: 'monthly-photo-cleanup',
    cutoff: cutoff.toISOString(),
    deletedFolders: deleted
  }));

  return {
    success: true,
    cutoff: cutoff,
    deletedFolders: deleted
  };
}

/**
 * Teste manual da limpeza. Não exclui a pasta do mês atual.
 */
function testarLimpezaMensal() {
  return limparFotosMensais();
}

function registrarVerificacaoDiaria_(
  payload,
  protocol,
  serverDate,
  reportFolder,
  savedPhotos,
  linkSharingAvailable
) {
  const driverName = textoObrigatorio_(payload.driverName, 'Nome do motorista', 150);
  const vehicle = textoObrigatorio_(payload.vehicle, 'Veículo', 200);
  const km = numeroObrigatorio_(payload.km, 'Quilometragem');
  const timestamp = textoObrigatorio_(payload.timestamp, 'Data e hora', 50);

  const waterStatus = converterStatus_(payload.waterStatus, 'Nível de água', {
    ok: 'OK',
    complete: 'Completar'
  });

  const oilStatus = converterStatus_(payload.oilStatus, 'Nível de óleo', {
    ok: 'OK',
    change: 'Trocar'
  });

  const brakesStatus = converterStatus_(payload.brakesStatus, 'Freios', {
    ok: 'OK',
    maintenance: 'Manutenção'
  });

  const lightsStatus = converterStatus_(payload.lightsStatus, 'Luzes', {
    ok: 'OK',
    replace: 'Substituir'
  });

  const tiresStatus = converterStatus_(payload.tiresStatus, 'Pneus', {
    ok: 'OK',
    pressure: 'Calibrar',
    replace: 'Substituir'
  });

  const observations = textoOpcional_(payload.observations, 2000);
  const folderUrl = reportFolder.getUrl();

  const summary = criarResumoVerificacao_({
    protocol: protocol,
    timestamp: timestamp,
    driverName: driverName,
    vehicle: vehicle,
    km: km,
    waterStatus: waterStatus,
    oilStatus: oilStatus,
    brakesStatus: brakesStatus,
    lightsStatus: lightsStatus,
    tiresStatus: tiresStatus,
    observations: observations,
    photoCount: savedPhotos.length,
    folderUrl: folderUrl
  });

  salvarResumoNaPasta_(reportFolder, protocol, summary);

  const sheet = obterOuCriarAba_(CONFIG.DAILY_CHECK_SHEET, DAILY_HEADERS);

  sheet.appendRow([
    protocol,
    serverDate,
    protegerCelula_(timestamp),
    protegerCelula_(driverName),
    protegerCelula_(vehicle),
    km,
    waterStatus,
    oilStatus,
    brakesStatus,
    lightsStatus,
    tiresStatus,
    protegerCelula_(observations),
    savedPhotos.length,
    folderUrl,
    'Ativas'
  ]);

  formatarAbaVerificacoes_(sheet);
  SpreadsheetApp.flush();

  return {
    message: 'Verificação e fotos registradas com sucesso.',
    sheet: CONFIG.DAILY_CHECK_SHEET,
    row: sheet.getLastRow(),
    whatsappMessage: summary + (linkSharingAvailable
      ? ''
      : '\n\nAtenção: o acesso ao link pode exigir login na conta Google autorizada.')
  };
}

function registrarManutencao_(
  payload,
  protocol,
  serverDate,
  reportFolder,
  savedPhotos,
  linkSharingAvailable
) {
  const responsible = textoObrigatorio_(payload.responsible, 'Responsável', 150);
  const vehicle = textoObrigatorio_(payload.vehicle, 'Veículo', 200);
  const km = numeroObrigatorio_(payload.km, 'Quilometragem');
  const timestamp = textoObrigatorio_(payload.timestamp, 'Data e hora', 50);

  const maintenanceType = converterStatus_(payload.maintenanceType, 'Tipo da manutenção', {
    preventiva: 'Preventiva',
    corretiva: 'Corretiva',
    melhoria: 'Melhoria',
    troca: 'Troca de Peças'
  });

  const priority = converterStatus_(payload.priority, 'Prioridade', {
    alta: 'Alta',
    media: 'Média',
    baixa: 'Baixa'
  });

  const description = textoObrigatorio_(payload.description, 'Descrição', 3000);
  const cost = numeroOpcional_(payload.cost, 'Custo estimado');
  const folderUrl = reportFolder.getUrl();

  const summary = criarResumoManutencao_({
    protocol: protocol,
    timestamp: timestamp,
    responsible: responsible,
    vehicle: vehicle,
    km: km,
    maintenanceType: maintenanceType,
    priority: priority,
    description: description,
    cost: cost,
    photoCount: savedPhotos.length,
    folderUrl: folderUrl
  });

  salvarResumoNaPasta_(reportFolder, protocol, summary);

  const sheet = obterOuCriarAba_(CONFIG.MAINTENANCE_SHEET, MAINTENANCE_HEADERS);

  sheet.appendRow([
    protocol,
    serverDate,
    protegerCelula_(timestamp),
    protegerCelula_(responsible),
    protegerCelula_(vehicle),
    km,
    maintenanceType,
    priority,
    protegerCelula_(description),
    cost,
    savedPhotos.length,
    folderUrl,
    'Ativas'
  ]);

  formatarAbaManutencoes_(sheet);
  SpreadsheetApp.flush();

  return {
    message: 'Solicitação e fotos registradas com sucesso.',
    sheet: CONFIG.MAINTENANCE_SHEET,
    row: sheet.getLastRow(),
    whatsappMessage: summary + (linkSharingAvailable
      ? ''
      : '\n\nAtenção: o acesso ao link pode exigir login na conta Google autorizada.')
  };
}

function criarPastaDoRelatorio_(protocol, vehicle, date) {
  const rootFolder = obterPastaRaizFotos_();
  const monthFolder = obterOuCriarPastaMensal_(rootFolder, date);
  const safeVehicle = sanitizarNomeArquivo_(vehicle).slice(0, 70) || 'Veiculo';
  const reportFolder = monthFolder.createFolder(protocol + ' - ' + safeVehicle);

  reportFolder.setDescription(
    'Relatório de frota Vesco. Protocolo: ' + protocol
  );

  return reportFolder;
}

function obterOuCriarPastaMensal_(rootFolder, date) {
  const monthKey = Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM');
  const folderName = CONFIG.MONTH_FOLDER_PREFIX + monthKey;
  const folders = rootFolder.getFoldersByName(folderName);

  if (folders.hasNext()) {
    return folders.next();
  }

  const folder = rootFolder.createFolder(folderName);
  folder.setDescription(
    'Fotos da frota Vesco referentes ao mês ' + monthKey + '.'
  );
  return folder;
}

function salvarFotos_(reportFolder, photos, protocol) {
  const savedFiles = [];

  photos.forEach(function(photo, index) {
    const bytes = Utilities.base64Decode(photo.base64);

    if (bytes.length > CONFIG.MAX_PHOTO_BYTES) {
      throw new Error('A foto ' + (index + 1) + ' ultrapassou o limite permitido.');
    }

    const sequence = String(index + 1).padStart(2, '0');
    const fileName = protocol + '_' + sequence + '_' + sanitizarNomeArquivo_(photo.name || 'foto.jpg');
    const blob = Utilities.newBlob(bytes, photo.mimeType || 'image/jpeg', fileName);
    const file = reportFolder.createFile(blob);

    file.setDescription(
      'Foto do relatório de frota ' + protocol + ', item ' + sequence + '.'
    );

    savedFiles.push({
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      size: bytes.length
    });
  });

  return savedFiles;
}

function salvarResumoNaPasta_(reportFolder, protocol, summary) {
  const file = reportFolder.createFile(
    protocol + '_RESUMO.txt',
    summary,
    MimeType.PLAIN_TEXT
  );

  file.setDescription('Resumo textual do relatório ' + protocol + '.');
  return file;
}

function configurarCompartilhamento_(reportFolder) {
  if (!CONFIG.SHARE_REPORT_FOLDER_WITH_LINK) {
    return false;
  }

  try {
    reportFolder.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW
    );
    return true;
  } catch (error) {
    console.warn('A conta não permitiu compartilhamento por link:', error);
    return false;
  }
}

function validarFotos_(photosValue) {
  if (!Array.isArray(photosValue) || photosValue.length === 0) {
    throw new Error('Adicione pelo menos uma foto ao registro.');
  }

  if (photosValue.length > CONFIG.MAX_PHOTOS) {
    throw new Error('O limite é de ' + CONFIG.MAX_PHOTOS + ' fotos por registro.');
  }

  let totalBytes = 0;

  return photosValue.map(function(photo, index) {
    if (!photo || typeof photo.base64 !== 'string' || !photo.base64.trim()) {
      throw new Error('A foto ' + (index + 1) + ' está vazia ou inválida.');
    }

    const mimeType = String(photo.mimeType || 'image/jpeg').toLowerCase();

    if (mimeType.indexOf('image/') !== 0) {
      throw new Error('O arquivo ' + (index + 1) + ' não é uma imagem válida.');
    }

    const estimatedBytes = Math.ceil(photo.base64.length * 0.75);
    totalBytes += estimatedBytes;

    if (estimatedBytes > CONFIG.MAX_PHOTO_BYTES * 1.1) {
      throw new Error('A foto ' + (index + 1) + ' ultrapassou o limite permitido.');
    }

    return {
      name: sanitizarNomeArquivo_(photo.name || ('foto-' + (index + 1) + '.jpg')),
      mimeType: mimeType,
      base64: photo.base64.replace(/^data:[^;]+;base64,/, '')
    };
  }).map(function(photo) {
    if (totalBytes > CONFIG.MAX_TOTAL_PHOTO_BYTES) {
      throw new Error('O tamanho total das fotos ultrapassou o limite permitido.');
    }
    return photo;
  });
}

function criarResumoVerificacao_(data) {
  return [
    'RELATÓRIO DE FROTA VESCO',
    '',
    'Protocolo: ' + data.protocol,
    'Tipo: Verificação diária',
    'Motorista: ' + data.driverName,
    'Veículo: ' + data.vehicle,
    'Quilometragem: ' + data.km + ' km',
    'Data: ' + data.timestamp,
    '',
    'Água: ' + data.waterStatus,
    'Óleo: ' + data.oilStatus,
    'Freios: ' + data.brakesStatus,
    'Luzes: ' + data.lightsStatus,
    'Pneus: ' + data.tiresStatus,
    '',
    'Observações:',
    data.observations || 'Nenhuma observação.',
    '',
    'Fotos anexadas: ' + data.photoCount,
    'Fotos e comprovante:',
    data.folderUrl
  ].join('\n');
}

function criarResumoManutencao_(data) {
  const costText = data.cost === ''
    ? 'Não informado'
    : Utilities.formatString('R$ %.2f', Number(data.cost)).replace('.', ',');

  return [
    'MANUTENÇÃO / MELHORIA - VESCO',
    '',
    'Protocolo: ' + data.protocol,
    'Responsável: ' + data.responsible,
    'Veículo: ' + data.vehicle,
    'Quilometragem: ' + data.km + ' km',
    'Data: ' + data.timestamp,
    'Tipo: ' + data.maintenanceType,
    'Prioridade: ' + data.priority,
    'Custo estimado: ' + costText,
    '',
    'Descrição:',
    data.description,
    '',
    'Fotos anexadas: ' + data.photoCount,
    'Fotos e comprovante:',
    data.folderUrl
  ].join('\n');
}

function instalarGatilhoLimpezaMensal_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === CONFIG.CLEANUP_TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(CONFIG.CLEANUP_TRIGGER_FUNCTION)
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .inTimezone(CONFIG.TIME_ZONE)
    .create();
}

function excluirPastaMensal_(folder) {
  if (CONFIG.PERMANENT_DELETE_OLD_PHOTOS) {
    if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.remove) {
      throw new Error(
        'O Serviço avançado do Google Drive não está habilitado. ' +
        'Ative Drive API v3 antes de usar exclusão definitiva.'
      );
    }

    Drive.Files.remove(folder.getId(), {
      supportsAllDrives: true
    });
    return;
  }

  folder.setTrashed(true);
}

function extrairMesDaPasta_(folderName) {
  const escapedPrefix = CONFIG.MONTH_FOLDER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(folderName).match(new RegExp('^' + escapedPrefix + '(\\d{4})-(\\d{2})$'));

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!year || month < 1 || month > 12) {
    return null;
  }

  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

function marcarFotosExpiradasNasPlanilhas_(cutoff) {
  marcarFotosExpiradasNaAba_(
    CONFIG.DAILY_CHECK_SHEET,
    2,
    13,
    15,
    cutoff
  );

  marcarFotosExpiradasNaAba_(
    CONFIG.MAINTENANCE_SHEET,
    2,
    11,
    13,
    cutoff
  );
}

function marcarFotosExpiradasNaAba_(sheetName, dateColumn, photoCountColumn, statusColumn, cutoff) {
  const spreadsheet = obterPlanilha_();
  const sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet || sheet.getLastRow() < 2) {
    return;
  }

  const lastRow = sheet.getLastRow();
  const maxColumn = Math.max(dateColumn, photoCountColumn, statusColumn);
  const values = sheet.getRange(2, 1, lastRow - 1, maxColumn).getValues();
  const statusUpdates = [];
  const expirationText = 'Expiradas em ' + Utilities.formatDate(
    new Date(),
    CONFIG.TIME_ZONE,
    'dd/MM/yyyy'
  );

  values.forEach(function(row) {
    const dateValue = row[dateColumn - 1];
    const photoCount = Number(row[photoCountColumn - 1] || 0);
    const currentStatus = String(row[statusColumn - 1] || '');

    const shouldExpire = dateValue instanceof Date &&
      !isNaN(dateValue.getTime()) &&
      dateValue.getTime() < cutoff.getTime() &&
      photoCount > 0 &&
      currentStatus.indexOf('Expiradas') !== 0;

    statusUpdates.push([
      shouldExpire ? expirationText : currentStatus
    ]);
  });

  sheet.getRange(2, statusColumn, statusUpdates.length, 1).setValues(statusUpdates);
}

function validarConfiguracao_() {
  const folderId = extrairIdDrive_(CONFIG.PHOTO_ROOT_FOLDER_ID_OR_URL);

  if (!folderId || folderId.indexOf('COLE_AQUI') >= 0) {
    throw new Error(
      'Configure PHOTO_ROOT_FOLDER_ID_OR_URL com o ID ou a URL da pasta de fotos.'
    );
  }

  if (Number(CONFIG.PHOTO_RETENTION_MONTHS) < 1) {
    throw new Error('PHOTO_RETENTION_MONTHS precisa ser 1 ou maior.');
  }
}

function obterPastaRaizFotos_() {
  const folderId = extrairIdDrive_(CONFIG.PHOTO_ROOT_FOLDER_ID_OR_URL);

  try {
    return DriveApp.getFolderById(folderId);
  } catch (error) {
    throw new Error(
      'Não foi possível abrir a pasta de fotos. Confira o ID e as permissões.'
    );
  }
}

function extrairIdDrive_(value) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  const folderUrlMatch = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderUrlMatch) {
    return folderUrlMatch[1];
  }

  const idMatch = text.match(/[a-zA-Z0-9_-]{20,}/);
  return idMatch ? idMatch[0] : text;
}

function criarProtocolo_() {
  const timestamp = Utilities.formatDate(
    new Date(),
    CONFIG.TIME_ZONE,
    'yyyyMMdd-HHmmss'
  );

  const randomPart = Utilities.getUuid()
    .replace(/-/g, '')
    .slice(0, 6)
    .toUpperCase();

  return 'VESCO-' + timestamp + '-' + randomPart;
}

function obterPlanilha_() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error(
      'Nenhuma planilha foi encontrada. Informe SPREADSHEET_ID no início do código.'
    );
  }

  return spreadsheet;
}

function obterOuCriarAba_(sheetName, headers) {
  const spreadsheet = obterPlanilha_();
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  garantirCabecalhos_(sheet, headers);
  return sheet;
}

function garantirCabecalhos_(sheet, headers) {
  const currentHeaders = sheet
    .getRange(1, 1, 1, headers.length)
    .getDisplayValues()[0];

  const headersDifferent = headers.some(function(header, index) {
    return String(currentHeaders[index] || '').trim() !== header;
  });

  if (headersDifferent) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet
    .getRange(1, 1, 1, headers.length)
    .setBackground('#1e3a8a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sheet.setFrozenRows(1);
}

function formatarAbaVerificacoes_(sheet) {
  sheet.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('F:F').setNumberFormat('0');

  const widths = [210, 170, 170, 190, 220, 130, 130, 130, 130, 130, 130, 420, 130, 320, 160];
  widths.forEach(function(width, index) {
    sheet.setColumnWidth(index + 1, width);
  });

  sheet.getRange('A:O').setVerticalAlignment('middle');
  sheet.getRange('L:L').setWrap(true);
  sheet.getRange('N:N').setWrap(true);
}

function formatarAbaManutencoes_(sheet) {
  sheet.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('F:F').setNumberFormat('0');
  sheet.getRange('J:J').setNumberFormat('"R$" #,##0.00');

  const widths = [210, 170, 170, 190, 220, 130, 150, 120, 450, 150, 130, 320, 160];
  widths.forEach(function(width, index) {
    sheet.setColumnWidth(index + 1, width);
  });

  sheet.getRange('A:M').setVerticalAlignment('middle');
  sheet.getRange('I:I').setWrap(true);
  sheet.getRange('L:L').setWrap(true);
}

function textoObrigatorio_(value, fieldName, limit) {
  const text = value === null || value === undefined
    ? ''
    : String(value).trim();

  if (!text) {
    throw new Error(fieldName + ' não foi informado.');
  }

  if (text.length > limit) {
    throw new Error(
      fieldName + ' excedeu o limite de ' + limit + ' caracteres.'
    );
  }

  return text;
}

function textoOpcional_(value, limit) {
  const text = value === null || value === undefined
    ? ''
    : String(value).trim();

  if (text.length > limit) {
    throw new Error(
      'O texto excedeu o limite de ' + limit + ' caracteres.'
    );
  }

  return text;
}

function numeroObrigatorio_(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error(fieldName + ' não foi informado.');
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(fieldName + ' possui um valor inválido.');
  }

  return number;
}

function numeroOpcional_(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return '';
  }

  const number = Number(String(value).replace(',', '.'));

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(fieldName + ' possui um valor inválido.');
  }

  return number;
}

function converterStatus_(value, fieldName, allowedValues) {
  const key = value === null || value === undefined
    ? ''
    : String(value).trim().toLowerCase();

  if (!allowedValues[key]) {
    throw new Error(fieldName + ' possui um valor inválido.');
  }

  return allowedValues[key];
}

function sanitizarNomeArquivo_(value) {
  const text = String(value || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|#%{}~&]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110);

  return text || 'arquivo';
}

function protegerCelula_(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function criarRespostaJson_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * VESCO FLEET CONTROL — API v4
 *
 * Recursos:
 * - App do motorista com checklist e fotos
 * - Criação automática de pendências para qualquer item diferente de OK
 * - Painel administrativo com veículos, pendências, histórico e gastos
 * - Conclusão de manutenção com valor real
 * - Fotos no Google Drive, protocolo e WhatsApp
 * - Retenção e exclusão mensal das fotos antigas
 */

const CONFIG = Object.freeze({
  SPREADSHEET_ID: '',
  API_VERSION: '4.0.0-fleet-dashboard',
  ADMIN_ACCESS_KEY: 'VESCO2026',
  PHOTO_ROOT_FOLDER_ID_OR_URL: '1Z6Qba_eI6UdGDJn_arOPMBYDySv9-jii',
  TIME_ZONE: 'America/Sao_Paulo',

  DAILY_CHECK_SHEET: 'Verificações Diárias',
  PENDING_SHEET: 'Pendências',
  HISTORY_SHEET: 'Histórico de Manutenções',
  VEHICLES_SHEET: 'Veículos',
  LEGACY_MAINTENANCE_SHEET: 'Manutenções',

  MAX_PHOTOS: 5,
  MAX_PHOTO_BYTES: 950 * 1024,
  MAX_TOTAL_PHOTO_BYTES: 5 * 1024 * 1024,
  PHOTO_RETENTION_MONTHS: 1,
  PERMANENT_DELETE_OLD_PHOTOS: true,
  SHARE_REPORT_FOLDER_WITH_LINK: true,
  MONTH_FOLDER_PREFIX: 'VESCO_FROTA_',
  CLEANUP_TRIGGER_FUNCTION: 'limparFotosMensais'
});

const HEADERS = Object.freeze({
  daily: [
    'Protocolo', 'Request ID', 'Registro no Sistema', 'Data/Hora Informada',
    'ID Veículo', 'Veículo', 'Nome do Motorista', 'Quilometragem',
    'Nível de Água', 'Nível de Óleo', 'Freios', 'Luzes', 'Pneus',
    'Observações / Ações a Tomar', 'Pendências Criadas',
    'Quantidade de Fotos', 'Link das Fotos', 'Status das Fotos'
  ],
  pending: [
    'ID Pendência', 'Request ID', 'Data Abertura', 'Origem', 'Protocolo Origem',
    'Item', 'ID Veículo', 'Veículo', 'Quilometragem', 'Categoria', 'Descrição',
    'Prioridade', 'Prazo', 'Custo Estimado', 'Responsável', 'Status',
    'Quantidade de Fotos', 'Link Fotos', 'Status das Fotos', 'Data Atualização',
    'Data Resolução', 'Valor Real', 'Código Manutenção'
  ],
  history: [
    'Código Manutenção', 'ID Pendência', 'Data Conclusão', 'Registro no Sistema',
    'ID Veículo', 'Veículo', 'Quilometragem', 'Categoria', 'Tipo',
    'Serviço Realizado', 'Fornecedor', 'Valor Estimado', 'Valor Real',
    'Forma de Pagamento', 'Nota Fiscal / Comprovante', 'Responsável',
    'Observações', 'Quantidade de Fotos', 'Link Fotos', 'Status das Fotos'
  ],
  vehicles: [
    'ID Veículo', 'Nome / Identificação', 'Placa', 'Modelo', 'Ano', 'Tipo',
    'KM Atual', 'Status', 'Data Cadastro', 'Última Atualização'
  ]
});

const PENDING_STATUSES = Object.freeze([
  'Pendente', 'Orçamento solicitado', 'Aguardando aprovação',
  'Aprovada', 'Em manutenção', 'Concluída', 'Cancelada'
]);

const PRIORITIES = Object.freeze(['Alta', 'Média', 'Baixa']);

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Nenhum dado foi recebido.');
    }

    const payload = JSON.parse(e.postData.contents);
    const type = String(payload.type || '').trim();

    if (!type) {
      throw new Error('O tipo da operação não foi informado.');
    }

    let result;

    switch (type) {
      case 'publicConfig':
        result = obterConfiguracaoPublica_();
        break;
      case 'dailyCheck':
        result = processarVerificacaoDiaria_(payload);
        break;
      case 'maintenance':
        result = processarSolicitacaoMotorista_(payload);
        break;
      case 'adminDashboard':
        validarAcessoAdmin_(payload.adminKey);
        result = obterDashboardAdmin_();
        break;
      case 'adminCreatePending':
        validarAcessoAdmin_(payload.adminKey);
        result = criarPendenciaAdmin_(payload);
        break;
      case 'adminUpdatePending':
        validarAcessoAdmin_(payload.adminKey);
        result = atualizarPendenciaAdmin_(payload);
        break;
      case 'adminResolvePending':
        validarAcessoAdmin_(payload.adminKey);
        result = resolverPendenciaAdmin_(payload);
        break;
      case 'adminCreateVehicle':
        validarAcessoAdmin_(payload.adminKey);
        result = criarVeiculoAdmin_(payload);
        break;
      case 'adminUpdateVehicle':
        validarAcessoAdmin_(payload.adminKey);
        result = atualizarVeiculoAdmin_(payload);
        break;
      default:
        throw new Error('Operação inválida: ' + type);
    }

    return respostaJson_(Object.assign({
      status: 'success',
      success: true,
      apiVersion: CONFIG.API_VERSION
    }, result));
  } catch (error) {
    console.error(error);

    return respostaJson_({
      status: 'error',
      success: false,
      apiVersion: CONFIG.API_VERSION,
      message: error && error.message ? error.message : 'Erro interno no servidor.'
    });
  }
}

function doGet() {
  return respostaJson_({
    status: 'success',
    success: true,
    service: 'Vesco Fleet Control',
    apiVersion: CONFIG.API_VERSION,
    dashboard: true,
    automaticPending: true,
    photoUpload: true,
    retentionMonths: CONFIG.PHOTO_RETENTION_MONTHS,
    configuredPhotoFolderId: extrairIdDrive_(CONFIG.PHOTO_ROOT_FOLDER_ID_OR_URL),
    timestamp: Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'dd/MM/yyyy HH:mm:ss')
  });
}

/**
 * Execute uma vez depois de substituir o codigo.gs.
 */
function configurarSistema() {
  validarConfiguracao_();

  const daily = obterOuCriarAba_(CONFIG.DAILY_CHECK_SHEET, HEADERS.daily);
  const pending = obterOuCriarAba_(CONFIG.PENDING_SHEET, HEADERS.pending);
  const history = obterOuCriarAba_(CONFIG.HISTORY_SHEET, HEADERS.history);
  const vehicles = obterOuCriarAba_(CONFIG.VEHICLES_SHEET, HEADERS.vehicles);

  formatarAba_(daily, HEADERS.daily);
  formatarAba_(pending, HEADERS.pending);
  formatarAba_(history, HEADERS.history);
  formatarAba_(vehicles, HEADERS.vehicles);

  semearVeiculosIniciais_();

  const rootFolder = obterPastaRaizFotos_();
  obterOuCriarPastaMensal_(rootFolder, new Date());
  instalarGatilhoLimpezaMensal_();

  const migrated = migrarManutencoesLegadas_();

  return {
    success: true,
    apiVersion: CONFIG.API_VERSION,
    message: 'Sistema configurado com sucesso.',
    adminAccessKey: CONFIG.ADMIN_ACCESS_KEY,
    folderName: rootFolder.getName(),
    folderId: rootFolder.getId(),
    migratedLegacyRecords: migrated,
    cleanupTriggerInstalled: true
  };
}

function autorizarAcessoDrive() {
  validarConfiguracao_();

  const folder = obterPastaRaizFotos_();
  const email = obterEmailExecucao_();
  let file = null;

  try {
    file = folder.createFile(
      '.TESTE_VESCO_' + Date.now() + '.txt',
      'Teste temporário de permissão de escrita.',
      MimeType.PLAIN_TEXT
    );

    const result = {
      success: true,
      apiVersion: CONFIG.API_VERSION,
      executionEmail: email,
      folderName: folder.getName(),
      folderId: folder.getId(),
      folderUrl: folder.getUrl(),
      canWrite: true
    };

    file.setTrashed(true);
    return result;
  } catch (error) {
    if (file) {
      try { file.setTrashed(true); } catch (ignored) {}
    }
    throw new Error(
      'A conta ' + email + ' não conseguiu gravar na pasta. Detalhe: ' +
      (error && error.message ? error.message : String(error))
    );
  }
}

function diagnosticarSistema() {
  const folder = obterPastaRaizFotos_();
  const spreadsheet = obterPlanilha_();
  const triggerCount = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === CONFIG.CLEANUP_TRIGGER_FUNCTION;
  }).length;

  return {
    success: true,
    apiVersion: CONFIG.API_VERSION,
    spreadsheet: spreadsheet.getName(),
    executionEmail: obterEmailExecucao_(),
    folderName: folder.getName(),
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    triggerCount: triggerCount,
    adminAccessKeyConfigured: Boolean(CONFIG.ADMIN_ACCESS_KEY),
    sheetNames: spreadsheet.getSheets().map(function(sheet) { return sheet.getName(); })
  };
}

function obterConfiguracaoPublica_() {
  const vehicles = listarVeiculos_().filter(function(vehicle) {
    return vehicle.status !== 'Inativo';
  });

  return {
    message: 'Configuração carregada.',
    vehicles: vehicles,
    automaticPending: true,
    maxPhotos: CONFIG.MAX_PHOTOS
  };
}

function processarVerificacaoDiaria_(payload) {
  validarConfiguracao_();

  const requestId = textoOpcional_(payload.requestId, 100) || Utilities.getUuid();
  const duplicate = buscarPorRequestId_(CONFIG.DAILY_CHECK_SHEET, 'Request ID', requestId);

  if (duplicate) {
    return respostaDuplicadaDiaria_(duplicate.record);
  }

  const photos = validarFotos_(payload.photos, true);
  const protocol = criarCodigo_('VESCO');
  const serverDate = new Date();
  const vehicleInput = textoObrigatorio_(payload.vehicle, 'Veículo', 200);
  let folder = null;

  try {
    folder = criarPastaRelatorio_(protocol, vehicleInput, serverDate, 'CHECK');
    const savedPhotos = salvarFotos_(folder, photos, protocol);
    const sharing = configurarCompartilhamento_(folder);

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    let result;
    try {
      const vehicle = obterOuCriarVeiculoPorTexto_(vehicleInput, payload.km);
      result = registrarVerificacaoDiaria_(
        payload,
        requestId,
        protocol,
        serverDate,
        vehicle,
        folder,
        savedPhotos
      );
    } finally {
      lock.releaseLock();
    }

    return {
      message: result.pendingIds.length
        ? 'Verificação registrada e ' + result.pendingIds.length + ' pendência(s) criada(s).'
        : 'Verificação registrada sem pendências.',
      protocol: protocol,
      photoCount: savedPhotos.length,
      reportFolderUrl: folder.getUrl(),
      linkSharingAvailable: sharing,
      pendingCount: result.pendingIds.length,
      pendingIds: result.pendingIds,
      whatsappMessage: result.whatsappMessage
    };
  } catch (error) {
    if (folder) {
      try { folder.setTrashed(true); } catch (ignored) {}
    }
    throw error;
  }
}

function processarSolicitacaoMotorista_(payload) {
  validarConfiguracao_();

  const requestId = textoOpcional_(payload.requestId, 100) || Utilities.getUuid();
  const duplicate = buscarPorRequestId_(CONFIG.PENDING_SHEET, 'Request ID', requestId);

  if (duplicate) {
    return respostaDuplicadaPendencia_(duplicate.record);
  }

  const photos = validarFotos_(payload.photos, true);
  const protocol = criarCodigo_('VESCO');
  const serverDate = new Date();
  const vehicleInput = textoObrigatorio_(payload.vehicle, 'Veículo', 200);
  let folder = null;

  try {
    folder = criarPastaRelatorio_(protocol, vehicleInput, serverDate, 'SOLICITACAO');
    const savedPhotos = salvarFotos_(folder, photos, protocol);
    const sharing = configurarCompartilhamento_(folder);

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    let pending;
    try {
      const vehicle = obterOuCriarVeiculoPorTexto_(vehicleInput, payload.km);
      pending = registrarSolicitacaoMotorista_(
        payload,
        requestId,
        protocol,
        serverDate,
        vehicle,
        folder,
        savedPhotos
      );
    } finally {
      lock.releaseLock();
    }

    return {
      message: 'Solicitação registrada e adicionada às pendências.',
      protocol: protocol,
      photoCount: savedPhotos.length,
      reportFolderUrl: folder.getUrl(),
      linkSharingAvailable: sharing,
      pendingCount: 1,
      pendingIds: [pending.id],
      whatsappMessage: pending.whatsappMessage
    };
  } catch (error) {
    if (folder) {
      try { folder.setTrashed(true); } catch (ignored) {}
    }
    throw error;
  }
}

function registrarVerificacaoDiaria_(payload, requestId, protocol, serverDate, vehicle, folder, savedPhotos) {
  const driverName = textoObrigatorio_(payload.driverName, 'Nome do motorista', 150);
  const km = numeroObrigatorio_(payload.km, 'Quilometragem');
  const timestamp = textoObrigatorio_(payload.timestamp, 'Data e hora', 50);
  const observations = textoOpcional_(payload.observations, 2000);

  const statuses = {
    water: statusPermitido_(payload.waterStatus, 'Nível de água', { ok: 'OK', complete: 'Completar' }),
    oil: statusPermitido_(payload.oilStatus, 'Nível de óleo', { ok: 'OK', change: 'Trocar' }),
    brakes: statusPermitido_(payload.brakesStatus, 'Freios', { ok: 'OK', maintenance: 'Manutenção' }),
    lights: statusPermitido_(payload.lightsStatus, 'Luzes', { ok: 'OK', replace: 'Substituir' }),
    tires: statusPermitido_(payload.tiresStatus, 'Pneus', { ok: 'OK', pressure: 'Calibrar', replace: 'Substituir' })
  };

  const issues = criarProblemasChecklist_(payload, observations);
  const pendingIds = [];

  issues.forEach(function(issue, index) {
    const pending = adicionarPendencia_({
      requestId: requestId + '-issue-' + (index + 1),
      openedAt: serverDate,
      source: 'Verificação diária',
      sourceProtocol: protocol,
      item: issue.item,
      vehicle: vehicle,
      km: km,
      category: issue.category,
      description: issue.description,
      priority: issue.priority,
      dueDate: somarDias_(serverDate, issue.dueDays),
      estimatedCost: '',
      assignedTo: '',
      status: 'Pendente',
      photoCount: savedPhotos.length,
      photoUrl: folder.getUrl()
    });

    pendingIds.push(pending.id);
  });

  const summary = resumoVerificacao_({
    protocol: protocol,
    timestamp: timestamp,
    driverName: driverName,
    vehicle: vehicle.displayName,
    km: km,
    water: statuses.water,
    oil: statuses.oil,
    brakes: statuses.brakes,
    lights: statuses.lights,
    tires: statuses.tires,
    observations: observations,
    pendingIds: pendingIds,
    photoCount: savedPhotos.length,
    folderUrl: folder.getUrl()
  });

  salvarResumo_(folder, protocol, summary);

  const sheet = obterOuCriarAba_(CONFIG.DAILY_CHECK_SHEET, HEADERS.daily);
  adicionarObjeto_(sheet, {
    'Protocolo': protocol,
    'Request ID': requestId,
    'Registro no Sistema': serverDate,
    'Data/Hora Informada': protegerCelula_(timestamp),
    'ID Veículo': vehicle.id,
    'Veículo': protegerCelula_(vehicle.displayName),
    'Nome do Motorista': protegerCelula_(driverName),
    'Quilometragem': km,
    'Nível de Água': statuses.water,
    'Nível de Óleo': statuses.oil,
    'Freios': statuses.brakes,
    'Luzes': statuses.lights,
    'Pneus': statuses.tires,
    'Observações / Ações a Tomar': protegerCelula_(observations),
    'Pendências Criadas': pendingIds.join(', '),
    'Quantidade de Fotos': savedPhotos.length,
    'Link das Fotos': folder.getUrl(),
    'Status das Fotos': 'Ativas'
  });

  atualizarKmVeiculo_(vehicle.id, km);
  SpreadsheetApp.flush();

  return { pendingIds: pendingIds, whatsappMessage: summary };
}

function registrarSolicitacaoMotorista_(payload, requestId, protocol, serverDate, vehicle, folder, savedPhotos) {
  const responsible = textoObrigatorio_(payload.responsible, 'Responsável', 150);
  const assignedTo = textoOpcional_(payload.assignedTo, 150) || responsible;
  const km = numeroObrigatorio_(payload.km, 'Quilometragem');
  const timestamp = textoObrigatorio_(payload.timestamp, 'Data e hora', 50);
  const type = statusPermitido_(payload.maintenanceType, 'Tipo', {
    preventiva: 'Preventiva', corretiva: 'Corretiva', melhoria: 'Melhoria', troca: 'Troca de Peças'
  });
  const priority = statusPermitido_(payload.priority, 'Prioridade', {
    alta: 'Alta', media: 'Média', baixa: 'Baixa'
  });
  const category = textoObrigatorio_(payload.category, 'Categoria', 100);
  const dueDate = dataObrigatoria_(payload.dueDate, 'Prazo');
  const description = textoObrigatorio_(payload.description, 'Descrição', 3000);
  const estimatedCost = numeroOpcional_(payload.cost, 'Custo estimado');

  const pending = adicionarPendencia_({
    requestId: requestId,
    openedAt: serverDate,
    source: 'Solicitação do app',
    sourceProtocol: protocol,
    item: type,
    vehicle: vehicle,
    km: km,
    category: category,
    description: description,
    priority: priority,
    dueDate: dueDate,
    estimatedCost: estimatedCost,
    assignedTo: assignedTo,
    status: 'Pendente',
    photoCount: savedPhotos.length,
    photoUrl: folder.getUrl()
  });

  const summary = resumoSolicitacao_({
    protocol: protocol,
    pendingId: pending.id,
    timestamp: timestamp,
    responsible: responsible,
    assignedTo: assignedTo,
    vehicle: vehicle.displayName,
    km: km,
    type: type,
    category: category,
    priority: priority,
    dueDate: dueDate,
    description: description,
    estimatedCost: estimatedCost,
    photoCount: savedPhotos.length,
    folderUrl: folder.getUrl()
  });

  salvarResumo_(folder, protocol, summary);
  atualizarKmVeiculo_(vehicle.id, km);
  SpreadsheetApp.flush();

  return { id: pending.id, whatsappMessage: summary };
}

function criarProblemasChecklist_(payload, observations) {
  const map = [
    { field: 'waterStatus', ok: 'ok', item: 'Nível de água', category: 'Arrefecimento', description: 'Completar ou revisar o nível de água do veículo.', priority: 'Média', dueDays: 2 },
    { field: 'oilStatus', ok: 'ok', item: 'Nível de óleo', category: 'Óleo e filtros', description: 'Trocar ou revisar o nível de óleo do motor.', priority: 'Média', dueDays: 3 },
    { field: 'brakesStatus', ok: 'ok', item: 'Freios', category: 'Freios', description: 'Realizar revisão ou manutenção dos freios.', priority: 'Alta', dueDays: 1 },
    { field: 'lightsStatus', ok: 'ok', item: 'Luzes', category: 'Elétrica / Luzes', description: 'Substituir ou revisar as luzes do veículo.', priority: 'Média', dueDays: 3 },
    { field: 'tiresStatus', ok: 'ok', item: 'Pneus', category: 'Pneus', description: String(payload.tiresStatus) === 'pressure' ? 'Calibrar os pneus.' : 'Revisar ou substituir os pneus.', priority: String(payload.tiresStatus) === 'replace' ? 'Alta' : 'Baixa', dueDays: String(payload.tiresStatus) === 'replace' ? 1 : 5 }
  ];

  const issues = map.filter(function(item) {
    return String(payload[item.field] || '').toLowerCase() !== item.ok;
  }).map(function(item) {
    return {
      item: item.item,
      category: item.category,
      priority: item.priority,
      dueDays: item.dueDays,
      description: item.description + (observations ? '\nObservação do motorista: ' + observations : '')
    };
  });

  if (!issues.length && observations && payload.createObservationPending !== false) {
    issues.push({
      item: 'Observação geral',
      category: 'Outros',
      priority: 'Média',
      dueDays: 3,
      description: observations
    });
  }

  return issues;
}

function criarPendenciaAdmin_(payload) {
  validarConfiguracao_();

  const vehicle = obterVeiculoPorIdObrigatorio_(payload.vehicleId);
  const photos = validarFotos_(payload.photos, false);
  const protocol = criarCodigo_('ADM');
  let folder = null;

  try {
    let photoCount = 0;
    let photoUrl = '';

    if (photos.length) {
      folder = criarPastaRelatorio_(protocol, vehicle.displayName, new Date(), 'PENDENCIA');
      photoCount = salvarFotos_(folder, photos, protocol).length;
      configurarCompartilhamento_(folder);
      photoUrl = folder.getUrl();
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    let pending;
    try {
      pending = adicionarPendencia_({
        requestId: Utilities.getUuid(),
        openedAt: new Date(),
        source: 'Painel administrativo',
        sourceProtocol: protocol,
        item: 'Pendência manual',
        vehicle: vehicle,
        km: numeroObrigatorio_(payload.km, 'Quilometragem'),
        category: textoObrigatorio_(payload.category, 'Categoria', 100),
        description: textoObrigatorio_(payload.description, 'Descrição', 3000),
        priority: prioridadeObrigatoria_(payload.priority),
        dueDate: dataObrigatoria_(payload.dueDate, 'Prazo'),
        estimatedCost: numeroOpcional_(payload.estimatedCost, 'Custo estimado'),
        assignedTo: textoOpcional_(payload.assignedTo, 150),
        status: 'Pendente',
        photoCount: photoCount,
        photoUrl: photoUrl
      });
      atualizarKmVeiculo_(vehicle.id, payload.km);
    } finally {
      lock.releaseLock();
    }

    return {
      message: 'Pendência ' + pending.id + ' criada com sucesso.',
      pendingId: pending.id
    };
  } catch (error) {
    if (folder) {
      try { folder.setTrashed(true); } catch (ignored) {}
    }
    throw error;
  }
}

function atualizarPendenciaAdmin_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = obterOuCriarAba_(CONFIG.PENDING_SHEET, HEADERS.pending);
    const found = buscarLinhaPorValor_(sheet, 'ID Pendência', payload.pendingId);

    if (!found) {
      throw new Error('Pendência não encontrada.');
    }

    const currentStatus = String(found.record['Status'] || '');
    if (currentStatus === 'Concluída') {
      throw new Error('Uma pendência concluída não pode ser editada.');
    }

    const newStatus = statusPendenciaObrigatorio_(payload.status, false);

    atualizarLinhaObjeto_(sheet, found.row, {
      'Prioridade': prioridadeObrigatoria_(payload.priority),
      'Status': newStatus,
      'Prazo': dataObrigatoria_(payload.dueDate, 'Prazo'),
      'Custo Estimado': numeroOpcional_(payload.estimatedCost, 'Custo estimado'),
      'Responsável': protegerCelula_(textoOpcional_(payload.assignedTo, 150)),
      'Categoria': protegerCelula_(textoObrigatorio_(payload.category, 'Categoria', 100)),
      'Descrição': protegerCelula_(textoObrigatorio_(payload.description, 'Descrição', 3000)),
      'Data Atualização': new Date()
    });

    SpreadsheetApp.flush();
    return { message: 'Pendência atualizada com sucesso.' };
  } finally {
    lock.releaseLock();
  }
}

function resolverPendenciaAdmin_(payload) {
  validarConfiguracao_();

  const pendingSheet = obterOuCriarAba_(CONFIG.PENDING_SHEET, HEADERS.pending);
  const initial = buscarLinhaPorValor_(pendingSheet, 'ID Pendência', payload.pendingId);

  if (!initial) {
    throw new Error('Pendência não encontrada.');
  }

  if (String(initial.record['Status']) === 'Concluída') {
    throw new Error('Esta pendência já foi concluída.');
  }

  const vehicle = obterVeiculoPorIdObrigatorio_(initial.record['ID Veículo']);
  const photos = validarFotos_(payload.photos, false);
  const maintenanceCode = criarCodigo_('MAN');
  let folder = null;

  try {
    let photoCount = 0;
    let photoUrl = '';

    if (photos.length) {
      folder = criarPastaRelatorio_(maintenanceCode, vehicle.displayName, new Date(), 'CONCLUSAO');
      photoCount = salvarFotos_(folder, photos, maintenanceCode).length;
      configurarCompartilhamento_(folder);
      photoUrl = folder.getUrl();
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const fresh = buscarLinhaPorValor_(pendingSheet, 'ID Pendência', payload.pendingId);
      if (!fresh || String(fresh.record['Status']) === 'Concluída') {
        throw new Error('A pendência foi alterada por outra pessoa. Atualize o painel.');
      }

      const completedAt = dataObrigatoria_(payload.completedAt, 'Data da conclusão');
      const km = numeroObrigatorio_(payload.km, 'Quilometragem');
      const actualCost = numeroObrigatorio_(payload.actualCost, 'Valor gasto');
      const category = textoObrigatorio_(payload.category, 'Categoria', 100);
      const service = textoObrigatorio_(payload.service, 'Serviço realizado', 3000);
      const responsible = textoObrigatorio_(payload.responsible, 'Responsável', 150);

      const historySheet = obterOuCriarAba_(CONFIG.HISTORY_SHEET, HEADERS.history);
      adicionarObjeto_(historySheet, {
        'Código Manutenção': maintenanceCode,
        'ID Pendência': payload.pendingId,
        'Data Conclusão': completedAt,
        'Registro no Sistema': new Date(),
        'ID Veículo': vehicle.id,
        'Veículo': protegerCelula_(vehicle.displayName),
        'Quilometragem': km,
        'Categoria': protegerCelula_(category),
        'Tipo': protegerCelula_(fresh.record['Item'] || fresh.record['Origem'] || 'Manutenção'),
        'Serviço Realizado': protegerCelula_(service),
        'Fornecedor': protegerCelula_(textoOpcional_(payload.supplier, 200)),
        'Valor Estimado': fresh.record['Custo Estimado'] === '' ? '' : numeroOpcional_(fresh.record['Custo Estimado'], 'Valor estimado'),
        'Valor Real': actualCost,
        'Forma de Pagamento': protegerCelula_(textoOpcional_(payload.payment, 100)),
        'Nota Fiscal / Comprovante': protegerCelula_(textoOpcional_(payload.invoice, 150)),
        'Responsável': protegerCelula_(responsible),
        'Observações': protegerCelula_(textoOpcional_(payload.notes, 2000)),
        'Quantidade de Fotos': photoCount,
        'Link Fotos': photoUrl,
        'Status das Fotos': photoCount ? 'Ativas' : 'Sem fotos'
      });

      atualizarLinhaObjeto_(pendingSheet, fresh.row, {
        'Status': 'Concluída',
        'Data Atualização': new Date(),
        'Data Resolução': completedAt,
        'Valor Real': actualCost,
        'Código Manutenção': maintenanceCode
      });

      atualizarKmVeiculo_(vehicle.id, km);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    return {
      message: 'Manutenção concluída. O valor ' + formatarMoeda_(payload.actualCost) + ' já entrou no dashboard.',
      maintenanceCode: maintenanceCode
    };
  } catch (error) {
    if (folder) {
      try { folder.setTrashed(true); } catch (ignored) {}
    }
    throw error;
  }
}

function criarVeiculoAdmin_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const name = textoObrigatorio_(payload.name, 'Nome do veículo', 150);
    const plate = textoOpcional_(payload.plate, 20).toUpperCase();

    const existing = listarVeiculos_().find(function(vehicle) {
      return normalizar_(vehicle.name) === normalizar_(name) ||
        (plate && normalizar_(vehicle.plate) === normalizar_(plate));
    });

    if (existing) {
      throw new Error('Já existe um veículo com esse nome ou placa.');
    }

    const sheet = obterOuCriarAba_(CONFIG.VEHICLES_SHEET, HEADERS.vehicles);
    const now = new Date();
    const id = criarCodigo_('VEI');

    adicionarObjeto_(sheet, {
      'ID Veículo': id,
      'Nome / Identificação': protegerCelula_(name),
      'Placa': protegerCelula_(plate),
      'Modelo': protegerCelula_(textoOpcional_(payload.model, 150)),
      'Ano': numeroOpcional_(payload.year, 'Ano'),
      'Tipo': protegerCelula_(textoOpcional_(payload.type, 50) || 'Outro'),
      'KM Atual': numeroOpcional_(payload.km, 'Quilometragem'),
      'Status': statusVeiculo_(payload.status),
      'Data Cadastro': now,
      'Última Atualização': now
    });

    SpreadsheetApp.flush();
    return { message: 'Veículo cadastrado com sucesso.', vehicleId: id };
  } finally {
    lock.releaseLock();
  }
}

function atualizarVeiculoAdmin_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = obterOuCriarAba_(CONFIG.VEHICLES_SHEET, HEADERS.vehicles);
    const found = buscarLinhaPorValor_(sheet, 'ID Veículo', payload.vehicleId);

    if (!found) {
      throw new Error('Veículo não encontrado.');
    }

    atualizarLinhaObjeto_(sheet, found.row, {
      'Nome / Identificação': protegerCelula_(textoObrigatorio_(payload.name, 'Nome do veículo', 150)),
      'Placa': protegerCelula_(textoOpcional_(payload.plate, 20).toUpperCase()),
      'Modelo': protegerCelula_(textoOpcional_(payload.model, 150)),
      'Ano': numeroOpcional_(payload.year, 'Ano'),
      'Tipo': protegerCelula_(textoOpcional_(payload.type, 50) || 'Outro'),
      'KM Atual': numeroOpcional_(payload.km, 'Quilometragem'),
      'Status': statusVeiculo_(payload.status),
      'Última Atualização': new Date()
    });

    SpreadsheetApp.flush();
    return { message: 'Veículo atualizado com sucesso.' };
  } finally {
    lock.releaseLock();
  }
}

function obterDashboardAdmin_() {
  return {
    message: 'Dashboard carregado.',
    vehicles: listarVeiculos_(),
    pendings: listarPendencias_(),
    maintenances: listarHistorico_(),
    generatedAt: new Date().toISOString()
  };
}

function adicionarPendencia_(data) {
  const sheet = obterOuCriarAba_(CONFIG.PENDING_SHEET, HEADERS.pending);

  if (data.sourceProtocol && data.item) {
    const rows = lerObjetos_(sheet);
    const duplicate = rows.find(function(record) {
      return String(record['Protocolo Origem'] || '') === String(data.sourceProtocol) &&
        String(record['Item'] || '') === String(data.item);
    });

    if (duplicate) {
      return { id: duplicate['ID Pendência'], duplicate: true };
    }
  }

  const id = criarCodigo_('PEN');
  adicionarObjeto_(sheet, {
    'ID Pendência': id,
    'Request ID': data.requestId || Utilities.getUuid(),
    'Data Abertura': data.openedAt || new Date(),
    'Origem': protegerCelula_(data.source || 'Não informada'),
    'Protocolo Origem': protegerCelula_(data.sourceProtocol || ''),
    'Item': protegerCelula_(data.item || 'Pendência'),
    'ID Veículo': data.vehicle.id,
    'Veículo': protegerCelula_(data.vehicle.displayName),
    'Quilometragem': Number(data.km) || 0,
    'Categoria': protegerCelula_(data.category || 'Outros'),
    'Descrição': protegerCelula_(data.description || ''),
    'Prioridade': data.priority || 'Média',
    'Prazo': data.dueDate || somarDias_(new Date(), 3),
    'Custo Estimado': data.estimatedCost === '' ? '' : data.estimatedCost,
    'Responsável': protegerCelula_(data.assignedTo || ''),
    'Status': data.status || 'Pendente',
    'Quantidade de Fotos': Number(data.photoCount) || 0,
    'Link Fotos': data.photoUrl || '',
    'Status das Fotos': Number(data.photoCount) ? 'Ativas' : 'Sem fotos',
    'Data Atualização': new Date(),
    'Data Resolução': '',
    'Valor Real': '',
    'Código Manutenção': ''
  });

  return { id: id, duplicate: false };
}

function listarVeiculos_() {
  const sheet = obterOuCriarAba_(CONFIG.VEHICLES_SHEET, HEADERS.vehicles);
  return lerObjetos_(sheet).map(function(record) {
    const vehicle = {
      id: String(record['ID Veículo'] || ''),
      name: String(record['Nome / Identificação'] || ''),
      plate: String(record['Placa'] || ''),
      model: String(record['Modelo'] || ''),
      year: record['Ano'] === '' ? '' : Number(record['Ano']),
      type: String(record['Tipo'] || ''),
      km: Number(record['KM Atual'] || 0),
      status: String(record['Status'] || 'Ativo'),
      createdAt: dataCliente_(record['Data Cadastro'], false),
      updatedAt: dataCliente_(record['Última Atualização'], false)
    };
    vehicle.displayName = montarNomeVeiculo_(vehicle);
    return vehicle;
  }).filter(function(vehicle) { return vehicle.id && vehicle.name; });
}

function listarPendencias_() {
  const sheet = obterOuCriarAba_(CONFIG.PENDING_SHEET, HEADERS.pending);
  return lerObjetos_(sheet).map(function(record) {
    return {
      id: String(record['ID Pendência'] || ''),
      requestId: String(record['Request ID'] || ''),
      openedAt: dataCliente_(record['Data Abertura'], false),
      source: String(record['Origem'] || ''),
      sourceProtocol: String(record['Protocolo Origem'] || ''),
      item: String(record['Item'] || ''),
      vehicleId: String(record['ID Veículo'] || ''),
      vehicle: String(record['Veículo'] || ''),
      km: Number(record['Quilometragem'] || 0),
      category: String(record['Categoria'] || 'Outros'),
      description: String(record['Descrição'] || ''),
      priority: String(record['Prioridade'] || 'Média'),
      dueDate: dataCliente_(record['Prazo'], true),
      estimatedCost: record['Custo Estimado'] === '' ? '' : Number(record['Custo Estimado'] || 0),
      assignedTo: String(record['Responsável'] || ''),
      status: String(record['Status'] || 'Pendente'),
      photoCount: Number(record['Quantidade de Fotos'] || 0),
      photoUrl: String(record['Link Fotos'] || ''),
      photoStatus: String(record['Status das Fotos'] || ''),
      updatedAt: dataCliente_(record['Data Atualização'], false),
      resolvedAt: dataCliente_(record['Data Resolução'], true),
      actualCost: record['Valor Real'] === '' ? '' : Number(record['Valor Real'] || 0),
      maintenanceCode: String(record['Código Manutenção'] || '')
    };
  }).filter(function(record) { return record.id; });
}

function listarHistorico_() {
  const sheet = obterOuCriarAba_(CONFIG.HISTORY_SHEET, HEADERS.history);
  return lerObjetos_(sheet).map(function(record) {
    return {
      code: String(record['Código Manutenção'] || ''),
      pendingId: String(record['ID Pendência'] || ''),
      completedAt: dataCliente_(record['Data Conclusão'], true),
      registeredAt: dataCliente_(record['Registro no Sistema'], false),
      vehicleId: String(record['ID Veículo'] || ''),
      vehicle: String(record['Veículo'] || ''),
      km: Number(record['Quilometragem'] || 0),
      category: String(record['Categoria'] || 'Outros'),
      type: String(record['Tipo'] || ''),
      service: String(record['Serviço Realizado'] || ''),
      supplier: String(record['Fornecedor'] || ''),
      estimatedCost: record['Valor Estimado'] === '' ? '' : Number(record['Valor Estimado'] || 0),
      actualCost: Number(record['Valor Real'] || 0),
      payment: String(record['Forma de Pagamento'] || ''),
      invoice: String(record['Nota Fiscal / Comprovante'] || ''),
      responsible: String(record['Responsável'] || ''),
      notes: String(record['Observações'] || ''),
      photoCount: Number(record['Quantidade de Fotos'] || 0),
      photoUrl: String(record['Link Fotos'] || ''),
      photoStatus: String(record['Status das Fotos'] || '')
    };
  }).filter(function(record) { return record.code; });
}

function obterOuCriarVeiculoPorTexto_(input, kmValue) {
  const text = textoObrigatorio_(input, 'Veículo', 200);
  const normalized = normalizar_(text);
  const vehicles = listarVeiculos_();

  let vehicle = vehicles.find(function(item) {
    return [item.name, item.plate, item.model, item.displayName]
      .map(normalizar_)
      .some(function(value) { return value && (value === normalized || normalized.indexOf(value) >= 0 || value.indexOf(normalized) >= 0); });
  });

  if (vehicle) {
    atualizarKmVeiculo_(vehicle.id, kmValue);
    return vehicle;
  }

  const sheet = obterOuCriarAba_(CONFIG.VEHICLES_SHEET, HEADERS.vehicles);
  const now = new Date();
  const id = criarCodigo_('VEI');

  adicionarObjeto_(sheet, {
    'ID Veículo': id,
    'Nome / Identificação': protegerCelula_(text),
    'Placa': '',
    'Modelo': '',
    'Ano': '',
    'Tipo': 'Outro',
    'KM Atual': numeroOpcional_(kmValue, 'Quilometragem'),
    'Status': 'Ativo',
    'Data Cadastro': now,
    'Última Atualização': now
  });

  return {
    id: id,
    name: text,
    plate: '',
    model: '',
    year: '',
    type: 'Outro',
    km: Number(kmValue || 0),
    status: 'Ativo',
    displayName: text
  };
}

function obterVeiculoPorIdObrigatorio_(vehicleId) {
  const id = textoObrigatorio_(vehicleId, 'Veículo', 100);
  const vehicle = listarVeiculos_().find(function(item) { return item.id === id; });

  if (!vehicle) {
    throw new Error('Veículo não encontrado no cadastro.');
  }

  return vehicle;
}

function atualizarKmVeiculo_(vehicleId, kmValue) {
  const km = Number(kmValue);
  if (!Number.isFinite(km) || km < 0) return;

  const sheet = obterOuCriarAba_(CONFIG.VEHICLES_SHEET, HEADERS.vehicles);
  const found = buscarLinhaPorValor_(sheet, 'ID Veículo', vehicleId);
  if (!found) return;

  const current = Number(found.record['KM Atual'] || 0);
  if (km >= current) {
    atualizarLinhaObjeto_(sheet, found.row, {
      'KM Atual': km,
      'Última Atualização': new Date()
    });
  }
}

function semearVeiculosIniciais_() {
  if (listarVeiculos_().length) return;

  const defaults = [
    { name: 'Doblò Branca', type: 'Utilitário' },
    { name: 'Doblò Verde', type: 'Utilitário' },
    { name: 'Doblò Cinza', type: 'Utilitário' },
    { name: 'Caminhão Pequeno', type: 'Caminhão' },
    { name: 'Caminhão Grande', type: 'Caminhão' }
  ];

  const sheet = obterOuCriarAba_(CONFIG.VEHICLES_SHEET, HEADERS.vehicles);
  const now = new Date();

  defaults.forEach(function(vehicle) {
    adicionarObjeto_(sheet, {
      'ID Veículo': criarCodigo_('VEI'),
      'Nome / Identificação': vehicle.name,
      'Placa': '',
      'Modelo': '',
      'Ano': '',
      'Tipo': vehicle.type,
      'KM Atual': 0,
      'Status': 'Ativo',
      'Data Cadastro': now,
      'Última Atualização': now
    });
  });
}

function migrarManutencoesLegadas_() {
  const spreadsheet = obterPlanilha_();
  const legacy = spreadsheet.getSheetByName(CONFIG.LEGACY_MAINTENANCE_SHEET);

  if (!legacy || legacy.getLastRow() < 2 || CONFIG.LEGACY_MAINTENANCE_SHEET === CONFIG.PENDING_SHEET) {
    return 0;
  }

  const records = lerObjetos_(legacy);
  let migrated = 0;

  records.forEach(function(record) {
    const protocol = String(record['Protocolo'] || '');
    if (!protocol) return;

    const pendingSheet = obterOuCriarAba_(CONFIG.PENDING_SHEET, HEADERS.pending);
    const exists = lerObjetos_(pendingSheet).some(function(pending) {
      return String(pending['Protocolo Origem'] || '') === protocol;
    });
    if (exists) return;

    const vehicle = obterOuCriarVeiculoPorTexto_(record['Veículo'] || 'Veículo não identificado', record['Quilometragem']);
    const openedAt = record['Registro no Sistema'] instanceof Date ? record['Registro no Sistema'] : new Date();

    adicionarPendencia_({
      requestId: 'legacy-' + protocol,
      openedAt: openedAt,
      source: 'Migração da aba Manutenções',
      sourceProtocol: protocol,
      item: record['Tipo'] || 'Manutenção',
      vehicle: vehicle,
      km: Number(record['Quilometragem'] || 0),
      category: 'Outros',
      description: String(record['Descrição Detalhada'] || 'Registro legado'),
      priority: String(record['Prioridade'] || 'Média'),
      dueDate: somarDias_(openedAt, 3),
      estimatedCost: record['Custo Estimado'] === '' ? '' : Number(record['Custo Estimado'] || 0),
      assignedTo: String(record['Responsável'] || ''),
      status: 'Pendente',
      photoCount: Number(record['Quantidade de Fotos'] || 0),
      photoUrl: String(record['Link das Fotos'] || '')
    });

    migrated += 1;
  });

  return migrated;
}

function respostaDuplicadaDiaria_(record) {
  const pendingIds = String(record['Pendências Criadas'] || '').split(',').map(function(item) { return item.trim(); }).filter(Boolean);
  return {
    message: 'Este envio já havia sido registrado.',
    protocol: String(record['Protocolo'] || ''),
    photoCount: Number(record['Quantidade de Fotos'] || 0),
    reportFolderUrl: String(record['Link das Fotos'] || ''),
    linkSharingAvailable: true,
    pendingCount: pendingIds.length,
    pendingIds: pendingIds,
    whatsappMessage: 'RELATÓRIO DE FROTA VESCO\n\nProtocolo: ' + record['Protocolo'] + '\nFotos: ' + record['Link das Fotos']
  };
}

function respostaDuplicadaPendencia_(record) {
  return {
    message: 'Esta solicitação já havia sido registrada.',
    protocol: String(record['Protocolo Origem'] || ''),
    photoCount: Number(record['Quantidade de Fotos'] || 0),
    reportFolderUrl: String(record['Link Fotos'] || ''),
    linkSharingAvailable: true,
    pendingCount: 1,
    pendingIds: [String(record['ID Pendência'] || '')],
    whatsappMessage: 'PENDÊNCIA DE FROTA VESCO\n\nCódigo: ' + record['ID Pendência'] + '\nFotos: ' + record['Link Fotos']
  };
}

function buscarPorRequestId_(sheetName, header, requestId) {
  if (!requestId) return null;
  const sheet = obterOuCriarAba_(sheetName, sheetName === CONFIG.DAILY_CHECK_SHEET ? HEADERS.daily : HEADERS.pending);
  return buscarLinhaPorValor_(sheet, header, requestId);
}

function criarPastaRelatorio_(protocol, vehicle, date, kind) {
  const root = obterPastaRaizFotos_();
  const month = obterOuCriarPastaMensal_(root, date);
  const safeVehicle = sanitizarNomeArquivo_(vehicle).slice(0, 70) || 'Veiculo';
  const folder = month.createFolder(kind + ' - ' + protocol + ' - ' + safeVehicle);
  folder.setDescription('Registro de frota Vesco: ' + protocol);
  return folder;
}

function obterOuCriarPastaMensal_(rootFolder, date) {
  const monthKey = Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM');
  const name = CONFIG.MONTH_FOLDER_PREFIX + monthKey;
  const folders = rootFolder.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  const folder = rootFolder.createFolder(name);
  folder.setDescription('Fotos da frota Vesco referentes a ' + monthKey + '.');
  return folder;
}

function salvarFotos_(folder, photos, protocol) {
  return photos.map(function(photo, index) {
    const bytes = Utilities.base64Decode(photo.base64);
    if (bytes.length > CONFIG.MAX_PHOTO_BYTES) {
      throw new Error('A foto ' + (index + 1) + ' ultrapassou o limite permitido.');
    }
    const name = protocol + '_' + String(index + 1).padStart(2, '0') + '_' + sanitizarNomeArquivo_(photo.name || 'foto.jpg');
    const file = folder.createFile(Utilities.newBlob(bytes, photo.mimeType || 'image/jpeg', name));
    return { id: file.getId(), name: file.getName(), url: file.getUrl(), size: bytes.length };
  });
}

function salvarResumo_(folder, protocol, text) {
  return folder.createFile(protocol + '_RESUMO.txt', text, MimeType.PLAIN_TEXT);
}

function configurarCompartilhamento_(folder) {
  if (!CONFIG.SHARE_REPORT_FOLDER_WITH_LINK) return false;
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  } catch (error) {
    console.warn(error);
    return false;
  }
}

function validarFotos_(photosValue, required) {
  const list = Array.isArray(photosValue) ? photosValue : [];
  if (required && !list.length) throw new Error('Adicione pelo menos uma foto.');
  if (list.length > CONFIG.MAX_PHOTOS) throw new Error('O limite é de ' + CONFIG.MAX_PHOTOS + ' fotos.');

  let total = 0;
  const photos = list.map(function(photo, index) {
    if (!photo || typeof photo.base64 !== 'string' || !photo.base64.trim()) {
      throw new Error('A foto ' + (index + 1) + ' está inválida.');
    }
    const base64 = photo.base64.replace(/^data:[^;]+;base64,/, '');
    const estimated = Math.ceil(base64.length * 0.75);
    total += estimated;
    if (estimated > CONFIG.MAX_PHOTO_BYTES * 1.1) throw new Error('A foto ' + (index + 1) + ' está muito grande.');
    const mime = String(photo.mimeType || 'image/jpeg').toLowerCase();
    if (mime.indexOf('image/') !== 0) throw new Error('O arquivo ' + (index + 1) + ' não é uma imagem.');
    return { name: sanitizarNomeArquivo_(photo.name || 'foto.jpg'), mimeType: mime, base64: base64 };
  });

  if (total > CONFIG.MAX_TOTAL_PHOTO_BYTES) throw new Error('O tamanho total das fotos ultrapassou o limite.');
  return photos;
}

function resumoVerificacao_(data) {
  return [
    'RELATÓRIO DE FROTA VESCO', '',
    'Protocolo: ' + data.protocol,
    'Motorista: ' + data.driverName,
    'Veículo: ' + data.vehicle,
    'Quilometragem: ' + data.km + ' km',
    'Data: ' + data.timestamp, '',
    'Água: ' + data.water,
    'Óleo: ' + data.oil,
    'Freios: ' + data.brakes,
    'Luzes: ' + data.lights,
    'Pneus: ' + data.tires, '',
    'Observações: ' + (data.observations || 'Nenhuma.'),
    'Pendências criadas: ' + (data.pendingIds.length ? data.pendingIds.join(', ') : 'Nenhuma'),
    'Fotos: ' + data.photoCount,
    'Link: ' + data.folderUrl
  ].join('\n');
}

function resumoSolicitacao_(data) {
  return [
    'PENDÊNCIA DE FROTA VESCO', '',
    'Protocolo: ' + data.protocol,
    'Código da pendência: ' + data.pendingId,
    'Veículo: ' + data.vehicle,
    'Quilometragem: ' + data.km + ' km',
    'Solicitante: ' + data.responsible,
    'Responsável por resolver: ' + data.assignedTo,
    'Data: ' + data.timestamp,
    'Prazo: ' + Utilities.formatDate(data.dueDate, CONFIG.TIME_ZONE, 'dd/MM/yyyy'),
    'Tipo: ' + data.type,
    'Categoria: ' + data.category,
    'Prioridade: ' + data.priority,
    'Custo estimado: ' + (data.estimatedCost === '' ? 'Não informado' : formatarMoeda_(data.estimatedCost)), '',
    'Descrição: ' + data.description, '',
    'Fotos: ' + data.photoCount,
    'Link: ' + data.folderUrl
  ].join('\n');
}

function validarAcessoAdmin_(key) {
  const provided = String(key || '').trim();
  const expected = String(CONFIG.ADMIN_ACCESS_KEY || '').trim();
  if (!expected) throw new Error('A chave administrativa não foi configurada no Apps Script.');
  if (provided !== expected) throw new Error('Código de acesso administrativo inválido.');
}

function obterPlanilha_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Nenhuma planilha ativa. Informe SPREADSHEET_ID.');
  return spreadsheet;
}

function obterOuCriarAba_(name, headers) {
  const spreadsheet = obterPlanilha_();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  garantirCabecalhos_(sheet, headers);
  return sheet;
}

function garantirCabecalhos_(sheet, requiredHeaders) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  let current = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(function(value) { return String(value || '').trim(); });
  const empty = current.every(function(value) { return !value; });

  if (empty) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    current = requiredHeaders.slice();
  } else {
    const missing = requiredHeaders.filter(function(header) { return current.indexOf(header) < 0; });
    if (missing.length) {
      sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
      current = current.concat(missing);
    }
  }

  sheet.getRange(1, 1, 1, current.length)
    .setBackground('#1e3a8a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
}

function formatarAba_(sheet, headers) {
  const map = mapaCabecalhos_(sheet);
  ['Registro no Sistema', 'Data Abertura', 'Data Atualização', 'Data Cadastro', 'Última Atualização'].forEach(function(header) {
    if (map[header]) sheet.getRange(2, map[header], Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  });
  ['Prazo', 'Data Resolução', 'Data Conclusão'].forEach(function(header) {
    if (map[header]) sheet.getRange(2, map[header], Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('dd/MM/yyyy');
  });
  ['Custo Estimado', 'Valor Estimado', 'Valor Real'].forEach(function(header) {
    if (map[header]) sheet.getRange(2, map[header], Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('R$ #,##0.00');
  });
  sheet.autoResizeColumns(1, headers.length);
  headers.forEach(function(header, index) {
    if (/Descrição|Observações|Serviço/.test(header)) sheet.setColumnWidth(index + 1, 360);
    if (/Link/.test(header)) sheet.setColumnWidth(index + 1, 280);
  });
}

function mapaCabecalhos_(sheet) {
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const map = {};
  headers.forEach(function(header, index) { map[String(header).trim()] = index + 1; });
  return map;
}

function adicionarObjeto_(sheet, object) {
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const row = headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(object, header) ? object[header] : '';
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function atualizarLinhaObjeto_(sheet, rowNumber, updates) {
  const map = mapaCabecalhos_(sheet);
  Object.keys(updates).forEach(function(header) {
    if (map[header]) sheet.getRange(rowNumber, map[header]).setValue(updates[header]);
  });
}

function lerObjetos_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(function(header) { return String(header || '').trim(); });
  return values.map(function(row) {
    const object = {};
    headers.forEach(function(header, index) { if (header) object[header] = row[index]; });
    return object;
  }).filter(function(object) {
    return Object.keys(object).some(function(key) { return object[key] !== '' && object[key] !== null; });
  });
}

function buscarLinhaPorValor_(sheet, header, value) {
  const map = mapaCabecalhos_(sheet);
  if (!map[header] || sheet.getLastRow() < 2) return null;
  const target = String(value || '').trim();
  const columnValues = sheet.getRange(2, map[header], sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let index = 0; index < columnValues.length; index += 1) {
    if (String(columnValues[index][0] || '').trim() === target) {
      const row = index + 2;
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
      const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
      const record = {};
      headers.forEach(function(item, col) { record[String(item || '').trim()] = values[col]; });
      return { row: row, record: record };
    }
  }
  return null;
}

function validarConfiguracao_() {
  const folderId = extrairIdDrive_(CONFIG.PHOTO_ROOT_FOLDER_ID_OR_URL);
  if (!folderId || folderId.indexOf('COLE_AQUI') >= 0) throw new Error('Configure o ID da pasta de fotos.');
  if (Number(CONFIG.PHOTO_RETENTION_MONTHS) < 1) throw new Error('PHOTO_RETENTION_MONTHS precisa ser 1 ou maior.');
}

function obterPastaRaizFotos_() {
  const id = extrairIdDrive_(CONFIG.PHOTO_ROOT_FOLDER_ID_OR_URL);
  const email = obterEmailExecucao_();
  try {
    const folder = DriveApp.getFolderById(id);
    folder.getName();
    return folder;
  } catch (error) {
    throw new Error(
      'Não foi possível abrir a pasta de fotos. Pasta: ' + id + '. Conta executora: ' + email + '. Detalhe: ' +
      (error && error.message ? error.message : String(error))
    );
  }
}

function obterEmailExecucao_() {
  try { return Session.getEffectiveUser().getEmail() || 'não identificada'; }
  catch (error) { return 'não identificada'; }
}

function extrairIdDrive_(value) {
  const text = String(value || '').trim();
  const url = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (url) return url[1];
  const id = text.match(/[a-zA-Z0-9_-]{20,}/);
  return id ? id[0] : text;
}

function instalarGatilhoLimpezaMensal_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === CONFIG.CLEANUP_TRIGGER_FUNCTION) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(CONFIG.CLEANUP_TRIGGER_FUNCTION).timeBased().onMonthDay(1).atHour(3).inTimezone(CONFIG.TIME_ZONE).create();
}

function limparFotosMensais() {
  validarConfiguracao_();
  const root = obterPastaRaizFotos_();
  const now = new Date();
  const months = Math.max(1, Number(CONFIG.PHOTO_RETENTION_MONTHS) || 1);
  const cutoff = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const iterator = root.getFolders();
  const deleted = [];

  while (iterator.hasNext()) {
    const folder = iterator.next();
    const month = extrairMesPasta_(folder.getName());
    if (month && month.getTime() < cutoff.getTime()) {
      const name = folder.getName();
      if (CONFIG.PERMANENT_DELETE_OLD_PHOTOS) {
        if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.remove) {
          throw new Error('Ative o Serviço avançado Google Drive API v3 para excluir definitivamente.');
        }
        Drive.Files.remove(folder.getId());
      } else {
        folder.setTrashed(true);
      }
      deleted.push(name);
    }
  }

  marcarFotosExpiradas_(CONFIG.DAILY_CHECK_SHEET, 'Registro no Sistema', 'Quantidade de Fotos', 'Status das Fotos', cutoff);
  marcarFotosExpiradas_(CONFIG.PENDING_SHEET, 'Data Abertura', 'Quantidade de Fotos', 'Status das Fotos', cutoff);
  marcarFotosExpiradas_(CONFIG.HISTORY_SHEET, 'Registro no Sistema', 'Quantidade de Fotos', 'Status das Fotos', cutoff);

  return { success: true, deletedFolders: deleted, cutoff: cutoff };
}

function testarLimpezaMensal() { return limparFotosMensais(); }

function marcarFotosExpiradas_(sheetName, dateHeader, countHeader, statusHeader, cutoff) {
  const sheet = obterPlanilha_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return;
  const map = mapaCabecalhos_(sheet);
  if (!map[dateHeader] || !map[countHeader] || !map[statusHeader]) return;
  const rows = sheet.getLastRow() - 1;
  const dates = sheet.getRange(2, map[dateHeader], rows, 1).getValues();
  const counts = sheet.getRange(2, map[countHeader], rows, 1).getValues();
  const statuses = sheet.getRange(2, map[statusHeader], rows, 1).getValues();
  const label = 'Expiradas em ' + Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'dd/MM/yyyy');
  const output = statuses.map(function(row, index) {
    const date = dates[index][0];
    const count = Number(counts[index][0] || 0);
    const should = date instanceof Date && date.getTime() < cutoff.getTime() && count > 0;
    return [should ? label : row[0]];
  });
  sheet.getRange(2, map[statusHeader], rows, 1).setValues(output);
}

function extrairMesPasta_(name) {
  const escaped = CONFIG.MONTH_FOLDER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(name).match(new RegExp('^' + escaped + '(\\d{4})-(\\d{2})$'));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

function criarCodigo_(prefix) {
  const timestamp = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyyMMdd-HHmmss');
  const random = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  return prefix + '-' + timestamp + '-' + random;
}

function montarNomeVeiculo_(vehicle) {
  const plate = String(vehicle.plate || '').trim();
  return plate ? vehicle.name + ' — ' + plate : vehicle.name;
}

function normalizar_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function textoObrigatorio_(value, field, max) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) throw new Error(field + ' não foi informado.');
  if (text.length > max) throw new Error(field + ' excedeu ' + max + ' caracteres.');
  return text;
}

function textoOpcional_(value, max) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (text.length > max) throw new Error('Um campo de texto excedeu ' + max + ' caracteres.');
  return text;
}

function numeroObrigatorio_(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') throw new Error(field + ' não foi informado.');
  const number = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) throw new Error(field + ' possui valor inválido.');
  return number;
}

function numeroOpcional_(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  const number = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) throw new Error(field + ' possui valor inválido.');
  return number;
}

function statusPermitido_(value, field, allowed) {
  const key = String(value || '').trim().toLowerCase();
  if (!allowed[key]) throw new Error(field + ' possui valor inválido.');
  return allowed[key];
}

function prioridadeObrigatoria_(value) {
  const normalized = String(value || '').trim();
  const map = { alta: 'Alta', média: 'Média', media: 'Média', baixa: 'Baixa' };
  const priority = map[normalized.toLowerCase()];
  if (!priority || PRIORITIES.indexOf(priority) < 0) throw new Error('Prioridade inválida.');
  return priority;
}

function statusPendenciaObrigatorio_(value, allowCompleted) {
  const status = String(value || '').trim();
  if (PENDING_STATUSES.indexOf(status) < 0) throw new Error('Status inválido.');
  if (!allowCompleted && status === 'Concluída') throw new Error('Use a ação Resolver para concluir uma pendência.');
  return status;
}

function statusVeiculo_(value) {
  const status = String(value || 'Ativo').trim();
  if (['Ativo', 'Em manutenção', 'Inativo'].indexOf(status) < 0) throw new Error('Status do veículo inválido.');
  return status;
}

function dataObrigatoria_(value, field) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(field + ' possui data inválida.');
  const parts = text.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  if (isNaN(date.getTime())) throw new Error(field + ' possui data inválida.');
  return date;
}

function somarDias_(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + Number(days || 0));
  result.setHours(12, 0, 0, 0);
  return result;
}

function dataCliente_(value, dateOnly) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return dateOnly ? Utilities.formatDate(value, CONFIG.TIME_ZONE, 'yyyy-MM-dd') : value.toISOString();
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return dateOnly ? text.slice(0, 10) : text;
  return text;
}

function formatarMoeda_(value) {
  return 'R$ ' + Number(value || 0).toFixed(2).replace('.', ',');
}

function protegerCelula_(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function sanitizarNomeArquivo_(value) {
  return String(value || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"<>|#%{}~]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110) || 'arquivo';
}

function respostaJson_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

'use strict';

const ADMIN_API_URL = window.VESCO_CONFIG.webAppUrl;
const ADMIN_API_VERSION = window.VESCO_CONFIG.apiVersion;
const ADMIN_TIME_ZONE = window.VESCO_CONFIG.timeZone;
const CATEGORIES = ['Óleo e filtros','Pneus','Freios','Suspensão','Motor','Arrefecimento','Elétrica / Luzes','Funilaria','Documentação','Combustível','Outros'];
const PHOTO_LIMITS = { max: 5, original: 15 * 1024 * 1024, compressed: 850 * 1024, total: 4.5 * 1024 * 1024, edge: 1500 };
const API_TIMEOUT_MS = 30000;

const state = {
  adminKey: '', vehicles: [], pendings: [], maintenances: [], charts: {},
  photos: { newPending: [], resolve: [] }, lastUpdated: null
};

const el = {};
let toastTimer = null;

function byId(id) { return document.getElementById(id); }
function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function numberValue(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function currency(value) { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(numberValue(value)); }
function isoToday() { return new Intl.DateTimeFormat('en-CA',{timeZone:ADMIN_TIME_ZONE}).format(new Date()); }
function monthToday() { return isoToday().slice(0,7); }
function displayDate(value) {
  if (!value) return '-';
  const text = String(value).slice(0,10);
  const parts = text.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value);
}
function isOverdue(pending) { return pending.status !== 'Concluída' && pending.status !== 'Cancelada' && pending.dueDate && pending.dueDate.slice(0,10) < isoToday(); }
function vehicleNameById(id, fallback='') { return state.vehicles.find(v => v.id === id)?.displayName || fallback || 'Veículo não informado'; }

function cacheElements() {
  ['loginScreen','loginForm','adminKey','rememberKey','loginButton','togglePassword','adminApp','sidebar','mobileMenuButton','logoutButton','refreshButton','lastUpdate','viewTitle','navPendingBadge','dashboardMonth','dashboardVehicle','clearDashboardFilters','kpiPeriodCost','kpiPeriodLabel','kpiOpenPending','kpiOverdue','kpiCompleted','attentionList','pendingSearch','pendingStatusFilter','pendingPriorityFilter','pendingVehicleFilter','pendingTableBody','pendingEmpty','newPendingForm','newPendingVehicle','newPendingKm','newPendingCategory','newPendingPriority','newPendingDueDate','newPendingAssigned','newPendingEstimate','newPendingDescription','newPendingPhotos','newPendingPhotoPreview','saveNewPending','historySearch','historyMonth','historyVehicle','historyTotal','historyTableBody','historyEmpty','vehicleCards','addVehicleButton','resolveDialog','resolveForm','resolveTitle','resolveSubtitle','resolvePendingId','resolveDate','resolveKm','resolveCategory','resolveActualCost','resolveSupplier','resolvePayment','resolveInvoice','resolveResponsible','resolveService','resolveNotes','resolvePhotos','resolvePhotoPreview','resolveSubmit','editPendingDialog','editPendingForm','editPendingTitle','editPendingId','editPendingPriority','editPendingStatus','editPendingDueDate','editPendingEstimate','editPendingAssigned','editPendingCategory','editPendingDescription','editPendingSubmit','vehicleDialog','vehicleForm','vehicleDialogTitle','vehicleId','vehicleName','vehiclePlate','vehicleModel','vehicleYear','vehicleType','vehicleKm','vehicleStatus','vehicleSubmit','adminToast','adminToastIcon','adminToastMessage','loadingOverlay'].forEach(id => el[id] = byId(id));
}

async function api(type, data = {}, includeAdmin = true) {
  const payload = { type, ...data };
  if (includeAdmin) payload.adminKey = state.adminKey;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(ADMIN_API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      redirect: 'follow',
      credentials: 'omit',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Erro HTTP ${response.status}`);
    }

    const text = await response.text();
    let result;

    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(
        'O Apps Script retornou uma resposta inválida. ' +
        'Confirme a URL /exec e publique uma nova versão.'
      );
    }

    if (!result.success) {
      throw new Error(result.message || 'Não foi possível concluir a operação.');
    }

    if (result.apiVersion && result.apiVersion !== ADMIN_API_VERSION) {
      console.warn(
        `Versão da API diferente. Front-end: ${ADMIN_API_VERSION}; servidor: ${result.apiVersion}`
      );
    }

    return result;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(
        'A conexão com o Apps Script demorou mais de 30 segundos. ' +
        'Confira a implantação, a URL /exec e tente novamente.'
      );
    }

    if (error instanceof TypeError && /fetch/i.test(error.message || '')) {
      throw new Error(
        'Não foi possível acessar o Apps Script. ' +
        'Confira a URL /exec, a publicação como Web App e a conexão com a internet.'
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function showToast(message, type='success', duration=4200) {
  clearTimeout(toastTimer);
  el.adminToast.classList.remove('is-error','is-warning');
  if(type==='error'){el.adminToast.classList.add('is-error');el.adminToastIcon.className='fa-solid fa-circle-exclamation';}
  else if(type==='warning'){el.adminToast.classList.add('is-warning');el.adminToastIcon.className='fa-solid fa-triangle-exclamation';}
  else el.adminToastIcon.className='fa-solid fa-circle-check';
  el.adminToastMessage.textContent=message;el.adminToast.classList.add('is-visible');
  toastTimer=setTimeout(()=>el.adminToast.classList.remove('is-visible'),duration);
}
function setLoading(show){el.loadingOverlay.hidden=!show;}
function setButtonLoading(button, loading, text='Salvando...'){
  if(!button.dataset.original) button.dataset.original=button.innerHTML;
  button.disabled=loading;button.innerHTML=loading?`<i class="fa-solid fa-spinner fa-spin"></i> ${text}`:button.dataset.original;
}

function storeKey() {
  sessionStorage.setItem('vescoAdminKey',state.adminKey);
  if(el.rememberKey.checked)localStorage.setItem('vescoAdminKey',state.adminKey);else localStorage.removeItem('vescoAdminKey');
}
function clearKey(){sessionStorage.removeItem('vescoAdminKey');localStorage.removeItem('vescoAdminKey');state.adminKey='';}

async function login(key, silent=false){
  state.adminKey=String(key||'').trim();
  if(!state.adminKey) throw new Error('Informe o código de acesso.');
  if(!silent)setButtonLoading(el.loginButton,true,'Entrando...');
  try{
    const result=await api('adminDashboard');
    applyDashboardData(result);storeKey();
    el.loginScreen.hidden=true;el.adminApp.hidden=false;
    renderAll();
  }finally{if(!silent)setButtonLoading(el.loginButton,false);}
}

function applyDashboardData(result){
  state.vehicles=Array.isArray(result.vehicles)?result.vehicles:[];
  state.pendings=Array.isArray(result.pendings)?result.pendings:[];
  state.maintenances=Array.isArray(result.maintenances)?result.maintenances:[];
  state.lastUpdated=new Date();
  el.lastUpdate.textContent=`Atualizado às ${state.lastUpdated.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
}

async function refreshData(showOverlay=true){
  if(showOverlay)setLoading(true);
  try{applyDashboardData(await api('adminDashboard'));renderAll();showToast('Dados atualizados.');}
  catch(error){showToast(error.message,'error');if(/acesso|chave/i.test(error.message)){logout();}}
  finally{if(showOverlay)setLoading(false);}
}

function logout(){clearKey();el.adminApp.hidden=true;el.loginScreen.hidden=false;el.adminKey.value='';}

function setView(view){
  document.querySelectorAll('.admin-view').forEach(v=>v.classList.toggle('is-active',v.id===`view-${view}`));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('is-active',b.dataset.view===view));
  const titles={dashboard:'Dashboard da frota',pending:'Pendências da frota','new-pending':'Cadastrar pendência',history:'Histórico de manutenções',vehicles:'Veículos cadastrados'};
  el.viewTitle.textContent=titles[view]||'Painel da frota';el.sidebar.classList.remove('is-open');
  if(view==='dashboard')renderDashboard();if(view==='pending')renderPending();if(view==='history')renderHistory();if(view==='vehicles')renderVehicles();
}

function populateSelect(select, includeAll=true, selected=''){
  const first=includeAll?'<option value="">Todos</option>':'<option value="">Selecione</option>';
  select.innerHTML=first+state.vehicles.filter(v=>v.status!=='Inativo').map(v=>`<option value="${escapeHtml(v.id)}">${escapeHtml(v.displayName)}</option>`).join('');
  select.value=selected;
}
function populateCategory(select, selected=''){select.innerHTML='<option value="">Selecione</option>'+CATEGORIES.map(c=>`<option>${escapeHtml(c)}</option>`).join('');select.value=selected;}
function escapeHtml(value){return String(value??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));}

function renderAll(){
  [el.dashboardVehicle,el.pendingVehicleFilter,el.historyVehicle].forEach(s=>populateSelect(s,true,s.value));
  populateSelect(el.newPendingVehicle,false,el.newPendingVehicle.value);
  [el.newPendingCategory,el.resolveCategory,el.editPendingCategory].forEach(s=>populateCategory(s,s.value));
  el.navPendingBadge.textContent=state.pendings.filter(p=>!['Concluída','Cancelada'].includes(p.status)).length;
  renderDashboard();renderPending();renderHistory();renderVehicles();
}

function dashboardFilteredMaintenances(){
  const month=el.dashboardMonth.value;const vehicleId=el.dashboardVehicle.value;
  return state.maintenances.filter(m=>(!month||String(m.completedAt).slice(0,7)===month)&&(!vehicleId||m.vehicleId===vehicleId));
}
function dashboardFilteredPendings(){const vehicleId=el.dashboardVehicle.value;return state.pendings.filter(p=>(!vehicleId||p.vehicleId===vehicleId)&&!['Concluída','Cancelada'].includes(p.status));}

function renderDashboard(){
  const maintenance=dashboardFilteredMaintenances();const pending=dashboardFilteredPendings();const month=el.dashboardMonth.value;
  el.kpiPeriodCost.textContent=currency(maintenance.reduce((s,m)=>s+numberValue(m.actualCost),0));
  el.kpiPeriodLabel.textContent=month?new Date(`${month}-02T12:00:00`).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}):'Todos os períodos';
  el.kpiOpenPending.textContent=pending.length;el.kpiOverdue.textContent=pending.filter(isOverdue).length;el.kpiCompleted.textContent=maintenance.length;
  renderCharts(maintenance);renderAttention(pending);
}

function destroyChart(name){if(state.charts[name]){state.charts[name].destroy();delete state.charts[name];}}
function renderCharts(filtered){
  if (typeof window.Chart !== 'function') {
    ['monthlyCostChart', 'vehicleCostChart', 'categoryCostChart'].forEach(id => {
      const canvas = byId(id);
      if (!canvas) return;
      const wrapper = canvas.parentElement;
      if (wrapper && !wrapper.querySelector('.chart-fallback')) {
        canvas.hidden = true;
        const fallback = document.createElement('div');
        fallback.className = 'empty-state chart-fallback';
        fallback.innerHTML =
          '<i class="fa-solid fa-chart-column"></i>' +
          '<h3>Gráficos indisponíveis</h3>' +
          '<p>O painel continua funcionando, mas a biblioteca de gráficos não carregou.</p>';
        wrapper.appendChild(fallback);
      }
    });
    return;
  }

  const monthly=new Map();state.maintenances.forEach(m=>{const key=String(m.completedAt||'').slice(0,7);if(key)monthly.set(key,(monthly.get(key)||0)+numberValue(m.actualCost));});
  const months=[];const base=new Date();base.setDate(1);for(let i=11;i>=0;i--){const d=new Date(base.getFullYear(),base.getMonth()-i,1);months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}
  destroyChart('monthly');state.charts.monthly=new Chart(byId('monthlyCostChart'),{type:'line',data:{labels:months.map(m=>{const[y,mo]=m.split('-');return `${mo}/${y.slice(2)}`}),datasets:[{label:'Gasto real',data:months.map(m=>monthly.get(m)||0),fill:true,tension:.32,borderWidth:3,backgroundColor:'rgba(37,99,235,.12)',borderColor:'#2563eb',pointBackgroundColor:'#2563eb'}]},options:chartOptions(true)});
  const byVehicle=new Map();filtered.forEach(m=>{const name=vehicleNameById(m.vehicleId,m.vehicle);byVehicle.set(name,(byVehicle.get(name)||0)+numberValue(m.actualCost));});
  destroyChart('vehicle');state.charts.vehicle=new Chart(byId('vehicleCostChart'),{type:'bar',data:{labels:[...byVehicle.keys()],datasets:[{label:'Gasto',data:[...byVehicle.values()],backgroundColor:'#2563eb',borderRadius:7}]},options:chartOptions(true)});
  const byCategory=new Map();filtered.forEach(m=>{const key=m.category||'Outros';byCategory.set(key,(byCategory.get(key)||0)+numberValue(m.actualCost));});
  destroyChart('category');state.charts.category=new Chart(byId('categoryCostChart'),{type:'doughnut',data:{labels:[...byCategory.keys()],datasets:[{data:[...byCategory.values()],backgroundColor:['#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#475569','#ea580c','#be123c','#65a30d']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:8}}}}});
}
function chartOptions(currencyAxis=false){return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>currencyAxis?currency(ctx.raw):ctx.raw}}},scales:{y:{beginAtZero:true,ticks:{callback:v=>currencyAxis?new Intl.NumberFormat('pt-BR',{notation:'compact',style:'currency',currency:'BRL'}).format(v):v},grid:{color:'#e2e8f0'}},x:{grid:{display:false}}}};}

function renderAttention(pending){
  const list=[...pending].sort((a,b)=>{const ao=isOverdue(a)?0:1,bo=isOverdue(b)?0:1;return ao-bo||String(a.dueDate).localeCompare(String(b.dueDate));}).slice(0,7);
  el.attentionList.innerHTML=list.length?list.map(p=>`<div class="attention-item"><div><strong>${escapeHtml(p.vehicle)}</strong><span>${escapeHtml(p.description)}</span></div><div><strong>${escapeHtml(p.priority)}</strong><span>Prioridade</span></div><div class="${isOverdue(p)?'overdue-text':''}"><strong>${displayDate(p.dueDate)}</strong><span>${isOverdue(p)?'Atrasada':'Prazo'}</span></div><button class="table-action table-action--resolve" data-resolve="${escapeHtml(p.id)}" title="Resolver"><i class="fa-solid fa-check"></i></button></div>`).join(''):'<div class="empty-state"><i class="fa-regular fa-circle-check"></i><h3>Nenhuma pendência crítica</h3><p>A frota está sem itens atrasados ou prioritários.</p></div>';
}

function filteredPendings(){
  const search=normalize(el.pendingSearch.value),status=el.pendingStatusFilter.value,priority=el.pendingPriorityFilter.value,vehicle=el.pendingVehicleFilter.value;
  return state.pendings.filter(p=>!['Concluída','Cancelada'].includes(p.status)).filter(p=>(!search||normalize([p.id,p.vehicle,p.description,p.category,p.assignedTo].join(' ')).includes(search))&&(!status||p.status===status)&&(!priority||p.priority===priority)&&(!vehicle||p.vehicleId===vehicle)).sort((a,b)=>(isOverdue(a)?0:1)-(isOverdue(b)?0:1)||String(a.dueDate).localeCompare(String(b.dueDate)));
}
function priorityClass(priority){return priority==='Alta'?'priority-badge--high':priority==='Média'?'priority-badge--medium':'priority-badge--low';}
function statusClass(status){return status==='Em manutenção'?'status-badge--progress':'';}
function renderPending(){
  const rows=filteredPendings();el.pendingEmpty.hidden=rows.length>0;
  el.pendingTableBody.innerHTML=rows.map(p=>`<tr><td><strong>${escapeHtml(p.id)}</strong><small>${escapeHtml(p.source)}</small></td><td><strong>${escapeHtml(p.vehicle)}</strong><small>${numberValue(p.km).toLocaleString('pt-BR')} km</small></td><td><strong>${escapeHtml(p.category)}</strong><small>${escapeHtml(p.description)}</small></td><td><span class="priority-badge ${priorityClass(p.priority)}">${escapeHtml(p.priority)}</span></td><td class="${isOverdue(p)?'overdue-text':''}">${displayDate(p.dueDate)}${isOverdue(p)?'<small> Atrasada</small>':''}</td><td>${p.estimatedCost===''||p.estimatedCost==null?'-':currency(p.estimatedCost)}</td><td><span class="status-badge ${statusClass(p.status)}">${escapeHtml(p.status)}</span></td><td><div class="table-actions">${p.photoUrl?`<a class="table-action" href="${escapeHtml(p.photoUrl)}" target="_blank" title="Fotos"><i class="fa-regular fa-images"></i></a>`:''}<button class="table-action" data-edit-pending="${escapeHtml(p.id)}" title="Editar"><i class="fa-solid fa-pen"></i></button><button class="table-action table-action--resolve" data-resolve="${escapeHtml(p.id)}" title="Resolver"><i class="fa-solid fa-check"></i></button></div></td></tr>`).join('');
}

function filteredHistory(){
  const search=normalize(el.historySearch.value),month=el.historyMonth.value,vehicle=el.historyVehicle.value;
  return state.maintenances.filter(m=>(!search||normalize([m.code,m.vehicle,m.service,m.category,m.supplier,m.responsible].join(' ')).includes(search))&&(!month||String(m.completedAt).slice(0,7)===month)&&(!vehicle||m.vehicleId===vehicle)).sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt)));
}
function renderHistory(){
  const rows=filteredHistory();el.historyEmpty.hidden=rows.length>0;el.historyTotal.textContent=currency(rows.reduce((s,m)=>s+numberValue(m.actualCost),0));
  el.historyTableBody.innerHTML=rows.map(m=>`<tr><td><strong>${displayDate(m.completedAt)}</strong><small>${escapeHtml(m.code)}</small></td><td><strong>${escapeHtml(m.vehicle)}</strong><small>${numberValue(m.km).toLocaleString('pt-BR')} km</small></td><td>${escapeHtml(m.service)}</td><td>${escapeHtml(m.category)}</td><td>${escapeHtml(m.supplier||'-')}</td><td><strong>${currency(m.actualCost)}</strong>${m.estimatedCost!==''&&m.estimatedCost!=null?`<small>Previsto ${currency(m.estimatedCost)}</small>`:''}</td><td>${escapeHtml(m.responsible)}</td><td>${m.photoUrl?`<a class="table-action" href="${escapeHtml(m.photoUrl)}" target="_blank"><i class="fa-regular fa-images"></i></a>`:'-'}</td></tr>`).join('');
}

function renderVehicles(){
  el.vehicleCards.innerHTML=state.vehicles.map(v=>{const open=state.pendings.filter(p=>p.vehicleId===v.id&&!['Concluída','Cancelada'].includes(p.status)).length;const spent=state.maintenances.filter(m=>m.vehicleId===v.id).reduce((s,m)=>s+numberValue(m.actualCost),0);return`<article class="vehicle-card"><div class="vehicle-card__top"><div><h3>${escapeHtml(v.displayName)}</h3><p>${escapeHtml([v.model,v.year,v.type].filter(Boolean).join(' • ')||'Cadastro básico')}</p></div><span class="vehicle-status">${escapeHtml(v.status)}</span></div><div class="vehicle-metrics"><div class="vehicle-metric"><span>KM atual</span><strong>${numberValue(v.km).toLocaleString('pt-BR')}</strong></div><div class="vehicle-metric"><span>Pendências</span><strong>${open}</strong></div><div class="vehicle-metric"><span>Gasto total</span><strong>${currency(spent)}</strong></div></div><div class="vehicle-actions"><button class="secondary-button" data-edit-vehicle="${escapeHtml(v.id)}"><i class="fa-solid fa-pen"></i> Editar</button></div></article>`;}).join('')||'<div class="empty-state"><i class="fa-solid fa-car"></i><h3>Nenhum veículo cadastrado</h3></div>';
}

function openResolve(id){
  const p=state.pendings.find(item=>item.id===id);if(!p)return;
  el.resolveForm.reset();clearPhotos('resolve');el.resolvePendingId.value=p.id;el.resolveTitle.textContent=`Resolver ${p.id}`;el.resolveSubtitle.textContent=`${p.vehicle} — ${p.description}`;el.resolveDate.value=isoToday();el.resolveKm.value=p.km||'';populateCategory(el.resolveCategory,p.category);el.resolveResponsible.value=p.assignedTo||'';el.resolveService.value=p.description||'';el.resolveDialog.showModal();
}
function openEditPending(id){
  const p=state.pendings.find(item=>item.id===id);if(!p)return;
  el.editPendingForm.reset();el.editPendingId.value=p.id;el.editPendingTitle.textContent=`Editar ${p.id}`;el.editPendingPriority.value=p.priority;el.editPendingStatus.value=p.status;el.editPendingDueDate.value=String(p.dueDate||'').slice(0,10);el.editPendingEstimate.value=p.estimatedCost??'';el.editPendingAssigned.value=p.assignedTo||'';populateCategory(el.editPendingCategory,p.category);el.editPendingDescription.value=p.description||'';el.editPendingDialog.showModal();
}
function openVehicle(vehicle=null){
  el.vehicleForm.reset();el.vehicleId.value=vehicle?.id||'';el.vehicleDialogTitle.textContent=vehicle?'Editar veículo':'Novo veículo';el.vehicleName.value=vehicle?.name||'';el.vehiclePlate.value=vehicle?.plate||'';el.vehicleModel.value=vehicle?.model||'';el.vehicleYear.value=vehicle?.year||'';el.vehicleType.value=vehicle?.type||'Carro';el.vehicleKm.value=vehicle?.km||'';el.vehicleStatus.value=vehicle?.status||'Ativo';el.vehicleDialog.showModal();
}

async function submitNewPending(event){
  event.preventDefault();setButtonLoading(el.saveNewPending,true);
  try{const result=await api('adminCreatePending',{vehicleId:el.newPendingVehicle.value,km:el.newPendingKm.value,category:el.newPendingCategory.value,priority:el.newPendingPriority.value,dueDate:el.newPendingDueDate.value,assignedTo:el.newPendingAssigned.value.trim(),estimatedCost:el.newPendingEstimate.value,description:el.newPendingDescription.value.trim(),photos:serializePhotos('newPending')});showToast(result.message);el.newPendingForm.reset();clearPhotos('newPending');el.newPendingDueDate.value=isoToday();await refreshData(false);setView('pending');}catch(error){showToast(error.message,'error');}finally{setButtonLoading(el.saveNewPending,false);}
}
async function submitResolve(event){
  event.preventDefault();setButtonLoading(el.resolveSubmit,true,'Concluindo...');
  try{const result=await api('adminResolvePending',{pendingId:el.resolvePendingId.value,completedAt:el.resolveDate.value,km:el.resolveKm.value,category:el.resolveCategory.value,actualCost:el.resolveActualCost.value,supplier:el.resolveSupplier.value.trim(),payment:el.resolvePayment.value,invoice:el.resolveInvoice.value.trim(),responsible:el.resolveResponsible.value.trim(),service:el.resolveService.value.trim(),notes:el.resolveNotes.value.trim(),photos:serializePhotos('resolve')});showToast(result.message);el.resolveDialog.close();clearPhotos('resolve');await refreshData(false);}catch(error){showToast(error.message,'error');}finally{setButtonLoading(el.resolveSubmit,false);}
}
async function submitEditPending(event){
  event.preventDefault();setButtonLoading(el.editPendingSubmit,true);
  try{const result=await api('adminUpdatePending',{pendingId:el.editPendingId.value,priority:el.editPendingPriority.value,status:el.editPendingStatus.value,dueDate:el.editPendingDueDate.value,estimatedCost:el.editPendingEstimate.value,assignedTo:el.editPendingAssigned.value.trim(),category:el.editPendingCategory.value,description:el.editPendingDescription.value.trim()});showToast(result.message);el.editPendingDialog.close();await refreshData(false);}catch(error){showToast(error.message,'error');}finally{setButtonLoading(el.editPendingSubmit,false);}
}
async function submitVehicle(event){
  event.preventDefault();setButtonLoading(el.vehicleSubmit,true);
  try{const result=await api(el.vehicleId.value?'adminUpdateVehicle':'adminCreateVehicle',{vehicleId:el.vehicleId.value,name:el.vehicleName.value.trim(),plate:el.vehiclePlate.value.trim(),model:el.vehicleModel.value.trim(),year:el.vehicleYear.value,type:el.vehicleType.value,km:el.vehicleKm.value,status:el.vehicleStatus.value});showToast(result.message);el.vehicleDialog.close();await refreshData(false);}catch(error){showToast(error.message,'error');}finally{setButtonLoading(el.vehicleSubmit,false);}
}

function canvasToBlob(canvas,type,quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Falha ao comprimir imagem.')),type,quality));}
async function loadImage(file){if('createImageBitmap'in window){try{const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});return{source:bitmap,width:bitmap.width,height:bitmap.height,cleanup:()=>bitmap.close()};}catch{}}return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>resolve({source:img,width:img.naturalWidth,height:img.naturalHeight,cleanup:()=>URL.revokeObjectURL(url)});img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Imagem não suportada.'));};img.src=url;});}
async function compressPhoto(file){
  if(!file.type.startsWith('image/'))throw new Error('Selecione somente imagens.');if(file.size>PHOTO_LIMITS.original)throw new Error(`${file.name} ultrapassa 15 MB.`);const image=await loadImage(file);
  try{let edge=PHOTO_LIMITS.edge,last;for(const quality of [.78,.66,.56,.48]){const ratio=Math.min(1,edge/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image.source,0,0,canvas.width,canvas.height);last=await canvasToBlob(canvas,'image/jpeg',quality);if(last.size<=PHOTO_LIMITS.compressed)return last;edge=Math.max(850,Math.round(edge*.8));}return last;}finally{image.cleanup();}
}
function blobBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Falha ao ler imagem.'));reader.readAsDataURL(blob);});}
async function addPhotos(collection, files){
  const selected=[...files].slice(0,PHOTO_LIMITS.max-state.photos[collection].length);for(const file of selected){try{const blob=await compressPhoto(file);const total=state.photos[collection].reduce((s,p)=>s+p.size,0)+blob.size;if(total>PHOTO_LIMITS.total)throw new Error('As fotos ultrapassaram o limite total.');state.photos[collection].push({id:`p-${Date.now()}-${Math.random()}`,name:`${file.name.replace(/\.[^.]+$/,'').slice(0,60)}.jpg`,mimeType:'image/jpeg',base64:await blobBase64(blob),size:blob.size,url:URL.createObjectURL(blob)});}catch(error){showToast(error.message,'error');}}renderPhotoCollection(collection);
}
function renderPhotoCollection(collection){const target=collection==='newPending'?el.newPendingPhotoPreview:el.resolvePhotoPreview;target.innerHTML=state.photos[collection].map(p=>`<div class="mini-photo"><img src="${p.url}" alt="Foto"><button type="button" data-remove-photo="${p.id}" data-collection="${collection}"><i class="fa-solid fa-xmark"></i></button></div>`).join('');}
function removePhoto(collection,id){const index=state.photos[collection].findIndex(p=>p.id===id);if(index>=0){URL.revokeObjectURL(state.photos[collection][index].url);state.photos[collection].splice(index,1);renderPhotoCollection(collection);}}
function clearPhotos(collection){state.photos[collection].forEach(p=>URL.revokeObjectURL(p.url));state.photos[collection]=[];renderPhotoCollection(collection);}
function serializePhotos(collection){return state.photos[collection].map(({name,mimeType,base64,size})=>({name,mimeType,base64,size}));}

function setupEvents(){
  el.loginForm.addEventListener('submit',async e=>{e.preventDefault();try{await login(el.adminKey.value);}catch(error){showToast(error.message,'error');}});
  el.togglePassword.addEventListener('click',()=>{el.adminKey.type=el.adminKey.type==='password'?'text':'password';});
  el.logoutButton.addEventListener('click',logout);el.refreshButton.addEventListener('click',()=>refreshData());el.mobileMenuButton.addEventListener('click',()=>el.sidebar.classList.toggle('is-open'));
  document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));document.querySelectorAll('[data-go-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.goView)));
  [el.dashboardMonth,el.dashboardVehicle].forEach(x=>x.addEventListener('change',renderDashboard));el.clearDashboardFilters.addEventListener('click',()=>{el.dashboardMonth.value=monthToday();el.dashboardVehicle.value='';renderDashboard();});
  [el.pendingSearch,el.pendingStatusFilter,el.pendingPriorityFilter,el.pendingVehicleFilter].forEach(x=>x.addEventListener(x.tagName==='INPUT'?'input':'change',renderPending));
  [el.historySearch,el.historyMonth,el.historyVehicle].forEach(x=>x.addEventListener(x.tagName==='INPUT'?'input':'change',renderHistory));
  document.body.addEventListener('click',e=>{const resolve=e.target.closest('[data-resolve]');if(resolve)openResolve(resolve.dataset.resolve);const edit=e.target.closest('[data-edit-pending]');if(edit)openEditPending(edit.dataset.editPending);const vehicle=e.target.closest('[data-edit-vehicle]');if(vehicle)openVehicle(state.vehicles.find(v=>v.id===vehicle.dataset.editVehicle));const remove=e.target.closest('[data-remove-photo]');if(remove)removePhoto(remove.dataset.collection,remove.dataset.removePhoto);});
  document.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>byId(b.dataset.closeDialog).close()));
  el.addVehicleButton.addEventListener('click',()=>openVehicle());el.newPendingForm.addEventListener('submit',submitNewPending);el.resolveForm.addEventListener('submit',submitResolve);el.editPendingForm.addEventListener('submit',submitEditPending);el.vehicleForm.addEventListener('submit',submitVehicle);
  el.newPendingPhotos.addEventListener('change',()=>{addPhotos('newPending',el.newPendingPhotos.files);el.newPendingPhotos.value='';});el.resolvePhotos.addEventListener('change',()=>{addPhotos('resolve',el.resolvePhotos.files);el.resolvePhotos.value='';});
}

async function initialize(){
  cacheElements();
  setupEvents();

  // Estado inicial explícito. Evita telas sobrepostas e overlay preso.
  el.loadingOverlay.hidden = true;
  el.adminApp.hidden = true;
  el.loginScreen.hidden = false;

  el.dashboardMonth.value = monthToday();
  el.historyMonth.value = monthToday();
  el.newPendingDueDate.value = isoToday();

  const saved =
    sessionStorage.getItem('vescoAdminKey') ||
    localStorage.getItem('vescoAdminKey');

  if (saved) {
    el.adminKey.value = saved;
    el.rememberKey.checked = Boolean(localStorage.getItem('vescoAdminKey'));
    setLoading(true);

    try {
      await login(saved, true);
    } catch (error) {
      clearKey();
      el.adminApp.hidden = true;
      el.loginScreen.hidden = false;
      showToast(error.message, 'error', 7000);
    } finally {
      setLoading(false);
    }
  }
}

document.addEventListener('DOMContentLoaded',initialize);

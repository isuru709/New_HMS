const API_BASE = 'http://localhost:3000/api';

// Helpers
async function safeFetch(url, options = {}) {
  const token = localStorage.getItem('session_id');
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
  return data;
}
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }
function setText(id, val){ const el = document.getElementById(id); if (el) el.textContent = val; }
function today(){ return new Date().toISOString().slice(0,10); }

// App state
const state = {
  currentUser: null,
  branches: [],
  patients: [],
  staff: [],
  appointments: [],
  policies: [],
  invoices: [],
  treatments: [],
  treatmentTypes: []
};

// Tabs
const panels = {
  overview: $('#panel-overview'),
  patients: $('#panel-patients'),
  appointments: $('#panel-appointments'),
  staff: $('#panel-staff'),
  branches: $('#panel-branches'),
  insurance: $('#panel-insurance'),
  invoices: $('#panel-invoices'),
  treatments: $('#panel-treatments'),
};
$all('button[data-tab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $all('button[data-tab]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(panels).forEach(p=>p.classList.add('hidden'));
    panels[btn.dataset.tab].classList.remove('hidden');
  });
});

// Fancy sheen follow
document.addEventListener('pointermove', (e)=>{
  $all('.liquid-btn').forEach(btn=>{
    const r = btn.getBoundingClientRect();
    const x = ((e.clientX - r.left)/r.width)*100;
    const y = ((e.clientY - r.top)/r.height)*100;
    btn.style.setProperty('--x', x+'%'); btn.style.setProperty('--y', y+'%');
  });
});

// Elements
const patientsTbody = $('#patientsTbody');
const apptsTbody = $('#apptsTbody');
const staffTbody = $('#staffTbody');
const branchesGrid = $('#branchesGrid');
const policyTbody = $('#policyTbody');
const invoicesTbody = $('#invoicesTbody');
const treatmentsTbody = $('#treatmentsTbody');

// RBAC
function hasRole(rolesCsv) {
  if (!rolesCsv) return true;
  const allowed = rolesCsv.split(',').map(s=>s.trim());
  const role = state.currentUser?.role || 'Anonymous';
  return allowed.includes(role);
}
function applyRBAC() {
  // Tabs and buttons
  $all('[data-roles]').forEach(el=>{
    const roles = el.getAttribute('data-roles');
    if (hasRole(roles)) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
  // Header login/logout/userBox
  const loginBtn = $('#loginBtn'), logoutBtn = $('#logoutBtn'), userBox = $('#userBox');
  if (state.currentUser) {
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    userBox.classList.remove('hidden');
    userBox.textContent = `${state.currentUser.first_name} ${state.currentUser.last_name} (${state.currentUser.role})`;
  } else {
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    userBox.classList.add('hidden');
    userBox.textContent = '';
  }
}

// KPIs
async function loadKPIs() {
  try {
    const m = await safeFetch(`${API_BASE}/metrics/overview`);
    setText('kpiPatients', m.patients);
    const today = m.appointments_today || {};
    setText('kpiAppointments', (today.Scheduled||0) + (today.Completed||0) + (today.Cancelled||0));
    setText('kpiDoctors', m.active_doctors || 0);
    setText('kpiCoverage', `${m.avg_insurance_coverage||0}%`);
  } catch {
    // Fallback local
    setText('kpiPatients', state.patients.length);
    setText('kpiAppointments', state.appointments.filter(a=>a.appointment_date===today()).length);
    setText('kpiDoctors', state.staff.filter(s=>s.role==='Doctor' && s.is_active).length);
    const avg = state.policies.length ? Math.round(state.policies.reduce((a,p)=>a+(Number(p.coverage_percentage)||0),0)/state.policies.length) : 0;
    setText('kpiCoverage', `${avg}%`);
  }
}

// Renders
function renderPatients(){
  const q1 = ($('#patientSearch').value||'').toLowerCase();
  const q2 = ($('#globalSearch').value||'').toLowerCase();
  const q = (q1 || q2).trim();
  patientsTbody.innerHTML = '';
  state.patients
    .filter(p => !q || (p.first_name+' '+p.last_name).toLowerCase().includes(q) || (p.phone||'').includes(q))
    .forEach(p=>{
      const tr = document.createElement('tr');
      tr.className='row-card';
      tr.innerHTML = `
        <td class="cell font-semibold">${p.first_name||''} ${p.last_name||''}</td>
        <td class="cell">${p.date_of_birth||'-'}</td>
        <td class="cell">${p.gender||'-'}</td>
        <td class="cell">${p.phone||'-'}</td>
        <td class="cell">${p.email||'-'}</td>
        <td class="cell">
          <div class="flex gap-2">
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${p.patient_id}">Edit</button>
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="appt" data-id="${p.patient_id}" data-roles="Admin,Doctor,Nurse,Receptionist">Schedule</button>
            <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${p.patient_id}" data-roles="Admin">Delete</button>
          </div>
        </td>`;
      patientsTbody.appendChild(tr);
    });
  applyRBAC();
}

function renderBranches(){
  branchesGrid.innerHTML = '';
  const q = ($('#globalSearch').value||'').toLowerCase();
  state.branches
    .filter(b => !q || (b.branch_name+' '+(b.location||'')+' '+(b.phone||'')).toLowerCase().includes(q))
    .forEach(b=>{
      const card = document.createElement('div');
      card.className='glass rounded-2xl p-4';
      card.innerHTML = `
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-bold">${b.branch_name}</h4>
          <span class="pill bg-cyan-500/15 text-cyan-200">#${b.branch_id}</span>
        </div>
        <p class="text-sm text-cyan-200/80">Location: ${b.location||'-'}</p>
        <p class="text-sm text-cyan-200/80">Phone: ${b.phone||'-'}</p>
        <div class="mt-3 flex gap-2">
          <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${b.branch_id}" data-roles="Admin">Edit</button>
          <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${b.branch_id}" data-roles="Admin">Delete</button>
        </div>`;
      branchesGrid.appendChild(card);
    });
  applyRBAC();
}

function renderStaff(){
  staffTbody.innerHTML = '';
  const role = $('#staffRoleFilter').value;
  const q = ($('#globalSearch').value||'').toLowerCase();
  state.staff
    .filter(s=>!role || s.role===role)
    .filter(s=>(s.first_name+' '+s.last_name).toLowerCase().includes(q) || (s.email||'').toLowerCase().includes(q))
    .forEach(s=>{
      const b = state.branches.find(x=>x.branch_id===s.branch_id);
      const tr = document.createElement('tr');
      tr.className='row-card';
      tr.innerHTML = `
        <td class="cell font-semibold">${s.first_name||''} ${s.last_name||''}</td>
        <td class="cell">${s.role}</td>
        <td class="cell">${s.speciality||'-'}</td>
        <td class="cell">${s.email||'-'}</td>
        <td class="cell">${b? b.branch_name : '-'}</td>
        <td class="cell"><span class="pill ${s.is_active?'bg-emerald-500/15 text-emerald-200':'bg-rose-500/15 text-rose-200'}">${s.is_active? 'Active':'Off'}</span></td>
        <td class="cell">
          <div class="flex gap-2">
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${s.staff_id}" data-roles="Admin">Edit</button>
            <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${s.staff_id}" data-roles="Admin">Delete</button>
          </div>
        </td>`;
      staffTbody.appendChild(tr);
    });
  applyRBAC();
}

function renderAppts(){
  apptsTbody.innerHTML = '';
  const status = $('#apptStatusFilter').value;
  state.appointments
    .filter(a => !status || a.status===status)
    .forEach(a=>{
      const p = state.patients.find(x=>x.patient_id===a.patient_id);
      const d = state.staff.find(x=>x.staff_id===a.doctor_id);
      const b = state.branches.find(x=>x.branch_id===a.branch_id);
      const tr = document.createElement('tr');
      tr.className='row-card';
      tr.innerHTML = `
        <td class="cell font-semibold">${p? p.first_name+' '+p.last_name : '-'}</td>
        <td class="cell">${d? d.first_name+' '+d.last_name : '-'}</td>
        <td class="cell">${b? b.branch_name : '-'}</td>
        <td class="cell">${a.appointment_date}</td>
        <td class="cell">${a.appointment_time}</td>
        <td class="cell"><span class="pill ${
          a.status==='Scheduled' ? 'bg-cyan-500/15 text-cyan-200' :
          a.status==='Completed' ? 'bg-emerald-500/15 text-emerald-200' :
                                   'bg-amber-500/15 text-amber-200'
        }">${a.status}</span></td>
        <td class="cell">
          <div class="flex gap-2">
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${a.appointment_id}" data-roles="Admin,Doctor,Nurse,Receptionist">Edit</button>
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="complete" data-id="${a.appointment_id}" data-roles="Admin,Doctor,Nurse">Complete</button>
            <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${a.appointment_id}" data-roles="Admin">Delete</button>
          </div>
        </td>`;
      apptsTbody.appendChild(tr);
    });
  applyRBAC();
}

function renderPolicies(){
  policyTbody.innerHTML = '';
  const q = ($('#globalSearch').value||'').toLowerCase();
  state.policies
    .filter(p=>{
      const pt = state.patients.find(pa=>pa.patient_id===p.patient_id);
      const name = pt? (pt.first_name+' '+pt.last_name).toLowerCase() : '';
      return !q || name.includes(q) || (p.provider_name||'').toLowerCase().includes(q) || (p.policy_number||'').toLowerCase().includes(q);
    })
    .forEach(p=>{
      const pt = state.patients.find(pa=>pa.patient_id===p.patient_id);
      const tr = document.createElement('tr');
      tr.className='row-card';
      tr.innerHTML = `
        <td class="cell font-semibold">${pt? pt.first_name+' '+pt.last_name : '-'}</td>
        <td class="cell">${p.provider_name||'-'}</td>
        <td class="cell">${p.policy_number||'-'}</td>
        <td class="cell">${p.coverage_percentage!=null ? Number(p.coverage_percentage).toFixed(0) : '0'}%</td>
        <td class="cell">$${Number(p.deductable||0).toFixed(2)}</td>
        <td class="cell">${p.expiry_date||'-'}</td>
        <td class="cell"><span class="pill ${p.is_active?'bg-emerald-500/15 text-emerald-200':'bg-rose-500/15 text-rose-200'}">${p.is_active? 'Active':'Inactive'}</span></td>
        <td class="cell">
          <div class="flex gap-2">
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${p.policy_id}" data-roles="Admin,Receptionist">Edit</button>
            <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${p.policy_id}" data-roles="Admin">Delete</button>
          </div>
        </td>`;
      policyTbody.appendChild(tr);
    });
  applyRBAC();
}

function renderInvoices(){
  invoicesTbody.innerHTML = '';
  state.invoices.forEach(inv=>{
    const p = state.patients.find(x=>x.patient_id===inv.patient_id);
    const tr = document.createElement('tr');
    tr.className='row-card';
    tr.innerHTML = `
      <td class="cell font-semibold">#${inv.invoice_id}</td>
      <td class="cell">${p? p.first_name+' '+p.last_name : '-'}</td>
      <td class="cell">${inv.appointment_id || '-'}</td>
      <td class="cell">$${Number(inv.total_amount||0).toFixed(2)}</td>
      <td class="cell">$${Number(inv.insurance_amount||0).toFixed(2)}</td>
      <td class="cell">$${Number(inv.patient_amount||0).toFixed(2)}</td>
      <td class="cell"><span class="pill ${inv.status==='Paid'?'bg-emerald-500/15 text-emerald-200':inv.status==='Pending'?'bg-amber-500/15 text-amber-200':'bg-rose-500/15 text-rose-200'}">${inv.status}</span></td>
      <td class="cell">
        <div class="flex gap-2">
          <button class="glass rounded-lg px-3 py-1 text-xs" data-action="recalc" data-id="${inv.invoice_id}" data-roles="Admin,Receptionist">Recalc</button>
          <button class="glass rounded-lg px-3 py-1 text-xs" data-action="pay" data-id="${inv.invoice_id}" data-roles="Admin,Receptionist">Payment</button>
          <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${inv.invoice_id}" data-roles="Admin">Delete</button>
        </div>
      </td>`;
    invoicesTbody.appendChild(tr);
  });
  applyRBAC();
}

function renderTreatments(){
  treatmentsTbody.innerHTML = '';
  state.treatments.forEach(t=>{
    const a = state.appointments.find(x=>x.appointment_id===t.appointment_id);
    const name = t.treatment_name || t.treatment_type_id;
    const tr = document.createElement('tr');
    tr.className='row-card';
    tr.innerHTML = `
      <td class="cell">${a? `#${a.appointment_id} • ${a.appointment_date} ${a.appointment_time}` : '-'}</td>
      <td class="cell">${name}</td>
      <td class="cell">$${Number(t.cost||0).toFixed(2)}</td>
      <td class="cell">${(t.treatment_date||'').toString().slice(0,16)}</td>
      <td class="cell">
        <div class="flex gap-2">
          <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${t.treatment_id}" data-roles="Admin,Doctor,Nurse">Edit</button>
          <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${t.treatment_id}" data-roles="Admin">Delete</button>
        </div>
      </td>`;
    treatmentsTbody.appendChild(tr);
  });
  applyRBAC();
}

// Modal system (generic)
const modalBack = $('#modalBack');
const modalTitle = $('#modalTitle');
const modalForm = $('#modalForm');
const modalClose = $('#modalClose');
const modalCancel = $('#modalCancel');
const modalSave = $('#modalSave');
let currentModal = null;

function openModal(type, id=null){
  currentModal = { type, id };
  modalForm.innerHTML = '';
  modalTitle.textContent = ({
    patient: id? 'Edit Patient':'Add Patient',
    appt: id? 'Edit Appointment':'Schedule Appointment',
    staff: id? 'Edit Staff':'Add Staff',
    branch: id? 'Edit Branch':'Add Branch',
    policy: id? 'Edit Policy':'Add Policy',
    invoice: id? 'Edit Invoice':'Create Invoice',
    payment: 'Record Payment',
    treatment: id? 'Edit Treatment':'Add Treatment',
    treatment_type: id? 'Edit Treatment Type':'Add Treatment Type'
  })[type] || 'Form';

  if (type==='patient') {
    const p = id? state.patients.find(x=>x.patient_id===id) : {};
    modalForm.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <input class="glass rounded-xl px-3 py-2" placeholder="First name" name="first_name" value="${p?.first_name||''}" required />
        <input class="glass rounded-xl px-3 py-2" placeholder="Last name" name="last_name" value="${p?.last_name||''}" required />
        <input class="glass rounded-xl px-3 py-2" type="date" name="date_of_birth" value="${p?.date_of_birth||''}" />
        <select class="glass rounded-xl px-3 py-2" name="gender">
          <option ${!p?.gender?'selected':''} disabled value="">Gender</option>
          <option ${p?.gender==='Male'?'selected':''}>Male</option>
          <option ${p?.gender==='Female'?'selected':''}>Female</option>
          <option ${p?.gender==='Other'?'selected':''}>Other</option>
        </select>
        <input class="glass rounded-xl px-3 py-2" placeholder="Phone" name="phone" value="${p?.phone||''}" />
        <input class="glass rounded-xl px-3 py-2" placeholder="Email" name="email" value="${p?.email||''}" />
      </div>
      <textarea class="glass rounded-xl px-3 py-2 w-full" placeholder="Address" name="address">${p?.address||''}</textarea>
      <input class="glass rounded-xl px-3 py-2 w-full" placeholder="Emergency contact" name="emergency_contact" value="${p?.emergency_contact||''}" />
    `;
  }

  if (type==='appt') {
    const a = id? state.appointments.find(x=>x.appointment_id===id) : {};
    const patientOptions = state.patients.map(p=>`<option value="${p.patient_id}" ${a?.patient_id===p.patient_id?'selected':''}>${p.first_name} ${p.last_name}</option>`).join('');
    const doctorOptions = state.staff.filter(s=>s.role==='Doctor').map(s=>`<option value="${s.staff_id}" ${a?.doctor_id===s.staff_id?'selected':''}>${s.first_name} ${s.last_name} — ${s.speciality||'General'}</option>`).join('');
    const branchOptions = state.branches.map(b=>`<option value="${b.branch_id}" ${a?.branch_id===b.branch_id?'selected':''}>${b.branch_name}</option>`).join('');
    modalForm.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <select class="glass rounded-xl px-3 py-2" name="patient_id" required>${patientOptions}</select>
        <select class="glass rounded-xl px-3 py-2" name="doctor_id" required>${doctorOptions}</select>
        <select class="glass rounded-xl px-3 py-2" name="branch_id" required>${branchOptions}</select>
        <input class="glass rounded-xl px-3 py-2" type="date" name="appointment_date" value="${a?.appointment_date||today()}" required />
        <input class="glass rounded-xl px-3 py-2" type="time" name="appointment_time" value="${a?.appointment_time||'09:00'}" required />
        <select class="glass rounded-xl px-3 py-2" name="status"><option ${a?.status==='Scheduled'?'selected':''}>Scheduled</option><option ${a?.status==='Completed'?'selected':''}>Completed</option><option ${a?.status==='Cancelled'?'selected':''}>Cancelled</option></select>
      </div>
    `;
  }

  if (type==='staff') {
    const s = id? state.staff.find(x=>x.staff_id===id) : {};
    const branchOptions = state.branches.map(b=>`<option value="${b.branch_id}" ${s?.branch_id===b.branch_id?'selected':''}>${b.branch_name}</option>`).join('');
    modalForm.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <input class="glass rounded-xl px-3 py-2" placeholder="First name" name="first_name" value="${s?.first_name||''}" required />
        <input class="glass rounded-xl px-3 py-2" placeholder="Last name" name="last_name" value="${s?.last_name||''}" required />
        <select class="glass rounded-xl px-3 py-2" name="role" required>
          ${['Admin','Doctor','Nurse','Receptionist','Other'].map(r=>`<option ${s?.role===r?'selected':''}>${r}</option>`).join('')}
        </select>
        <input class="glass rounded-xl px-3 py-2" placeholder="Speciality" name="speciality" value="${s?.speciality||''}" />
        <input class="glass rounded-xl px-3 py-2" placeholder="Email" name="email" value="${s?.email||''}" />
        <select class="glass rounded-xl px-3 py-2" name="branch_id" required>${branchOptions}</select>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" ${s?.is_active? 'checked':''}/> Active</label>
        ${id? '' : '<input class="glass rounded-xl px-3 py-2" placeholder="Password (min 6 chars)" name="password" type="password" required />'}
      </div>
    `;
  }

  if (type==='branch') {
    const b = id? state.branches.find(x=>x.branch_id===id) : {};
    modalForm.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <input class="glass rounded-xl px-3 py-2" placeholder="Branch name" name="branch_name" value="${b?.branch_name||''}" required />
        <input class="glass rounded-xl px-3 py-2" placeholder="Location" name="location" value="${b?.location||''}" />
        <input class="glass rounded-xl px-3 py-2" placeholder="Phone" name="phone" value="${b?.phone||''}" />
      </div>
    `;
  }

  if (type==='policy') {
    const p = id? state.policies.find(x=>x.policy_id===id) : {};
    const ptOpts = state.patients.map(pt=>`<option value="${pt.patient_id}" ${p?.patient_id===pt.patient_id?'selected':''}>${pt.first_name} ${pt.last_name}</option>`).join('');
    modalForm.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <select class="glass rounded-xl px-3 py-2" name="patient_id" required>${ptOpts}</select>
        <input class="glass rounded-xl px-3 py-2" placeholder="Provider name" name="provider_name" value="${p?.provider_name||''}" />
        <input class="glass rounded-xl px-3 py-2" placeholder="Policy number" name="policy_number" value="${p?.policy_number||''}" />
        <input class="glass rounded-xl px-3 py-2" type="number" step="1" min="0" max="100" placeholder="Coverage %" name="coverage_percentage" value="${p?.coverage_percentage ?? 80}" />
        <input class="glass rounded-xl px-3 py-2" type="number" step="0.01" min="0" placeholder="Deductible" name="deductable" value="${p?.deductable ?? 0}" />
        <input class="glass rounded-xl px-3 py-2" type="date" name="expiry_date" value="${p?.expiry_date || today()}" />
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" ${p?.is_active? 'checked':''}/> Active</label>
      </div>
    `;
  }

  if (type==='invoice') {
    const inv = id? state.invoices.find(x=>x.invoice_id===id) : {};
    const ptOpts = state.patients.map(pt=>`<option value="${pt.patient_id}" ${inv?.patient_id===pt.patient_id?'selected':''}>${pt.first_name} ${pt.last_name}</option>`).join('');
    const apptOpts = state.appointments.map(a=>`<option value="${a.appointment_id}" ${inv?.appointment_id===a.appointment_id?'selected':''}>#${a.appointment_id} — ${a.appointment_date} ${a.appointment_time}</option>`).join('');
    modalForm.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <select class="glass rounded-xl px-3 py-2" name="patient_id" required>${ptOpts}</select>
        <select class="glass rounded-xl px-3 py-2" name="appointment_id"><option value="">(optional)</option>${apptOpts}</select>
        <input class="glass rounded-xl px-3 py-2" type="number" step="0.01" min="0" placeholder="Total amount (optional, auto from treatments)" name="total_amount" />
      </div>
      <p class="text-[11px] text-cyan-200/70">Leave total empty to auto-calc from treatments on the appointment and current policy.</p>
    `;
  }

  if (type==='payment') {
    modalForm.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <input class="glass rounded-xl px-3 py-2" type="number" step="0.01" min="0" placeholder="Amount" name="amount" required />
        <select class="glass rounded-xl px-3 py-2" name="payment_method"><option>Cash</option><option>Card</option><option>Insurance</option><option>Online</option></select>
        <input class="glass rounded-xl px-3 py-2" placeholder="Transaction ref (optional)" name="transaction_reference" />
      </div>
    `;
  }

  if (type==='treatment') {
    const tr = id? state.treatments.find(x=>x.treatment_id===id) : {};
    const apptOpts = state.appointments.map(a=>`<option value="${a.appointment_id}" ${tr?.appointment_id===a.appointment_id?'selected':''}>#${a.appointment_id} — ${a.appointment_date} ${a.appointment_time}</option>`).join('');
    const ttOpts = state.treatmentTypes.map(tt=>`<option value="${tt.treatment_type_id}" ${tr?.treatment_type_id===tt.treatment_type_id?'selected':''}>${tt.treatment_name} — $${Number(tt.standard_cost||0).toFixed(2)}</option>`).join('');
    modalForm.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <select class="glass rounded-xl px-3 py-2" name="appointment_id" required>${apptOpts}</select>
        <select class="glass rounded-xl px-3 py-2" name="treatment_type_id" required>${ttOpts}</select>
        <input class="glass rounded-xl px-3 py-2" type="number" step="0.01" min="0" placeholder="Cost (optional)" name="cost" value="${tr?.cost ?? ''}" />
        <input class="glass rounded-xl px-3 py-2" type="datetime-local" name="treatment_date" />
        <input class="glass rounded-xl px-3 py-2" placeholder="Doctor signature (optional)" name="doctor_signature" />
        <textarea class="glass rounded-xl px-3 py-2 w-full" placeholder="Consultation notes" name="consultation_notes">${tr?.consultation_notes||''}</textarea>
        <textarea class="glass rounded-xl px-3 py-2 w-full" placeholder="Prescription" name="prescription">${tr?.prescription||''}</textarea>
      </div>
    `;
  }

  if (type==='treatment_type') {
    modalForm.innerHTML = `
      <div class="grid sm:grid-cols-2 gap-3">
        <input class="glass rounded-xl px-3 py-2" placeholder="Treatment name" name="treatment_name" required />
        <input class="glass rounded-xl px-3 py-2" placeholder="ICD-10 code" name="icd10_code" />
        <input class="glass rounded-xl px-3 py-2" placeholder="CPT code" name="cpt_code" />
        <input class="glass rounded-xl px-3 py-2" type="number" step="0.01" min="0" placeholder="Standard cost" name="standard_cost" />
        <input class="glass rounded-xl px-3 py-2" placeholder="Category" name="category" />
      </div>
      <textarea class="glass rounded-xl px-3 py-2 w-full" placeholder="Description" name="description"></textarea>
    `;
  }

  modalBack.classList.remove('hidden'); modalBack.classList.add('flex');
}
function closeModal(){ modalBack.classList.add('hidden'); modalBack.classList.remove('flex'); currentModal=null; }
modalClose.addEventListener('click', closeModal); modalCancel.addEventListener('click', closeModal);

// Save handler
modalSave.addEventListener('click', async (e)=>{
  e.preventDefault();
  if (!currentModal) return;
  const fd = new FormData(modalForm);
  const type = currentModal.type, id = currentModal.id;
  try {
    if (type==='patient') {
      const payload = Object.fromEntries(fd.entries());
      const body = { first_name: payload.first_name?.trim(), last_name: payload.last_name?.trim(), date_of_birth: payload.date_of_birth || null, gender: payload.gender || null, phone: payload.phone || null, email: payload.email || null, address: payload.address || null, emergency_contact: payload.emergency_contact || null };
      const data = id
        ? await safeFetch(`${API_BASE}/patients/${id}`, { method:'PUT', body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/patients`, { method:'POST', body: JSON.stringify(body) });
      if (id) { const i = state.patients.findIndex(p=>p.patient_id===id); if (i>-1) state.patients[i]=data; } else { state.patients.unshift(data); }
      renderPatients(); await loadKPIs();
    }

    if (type==='appt') {
      const payload = Object.fromEntries(fd.entries());
      const body = { patient_id: Number(payload.patient_id), doctor_id: Number(payload.doctor_id), branch_id: Number(payload.branch_id), appointment_date: payload.appointment_date, appointment_time: payload.appointment_time, status: payload.status };
      const data = id
        ? await safeFetch(`${API_BASE}/appointments/${id}`, { method:'PUT', body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/appointments`, { method:'POST', body: JSON.stringify(body) });
      if (id) { const i = state.appointments.findIndex(a=>a.appointment_id===id); if (i>-1) state.appointments[i]=data; } else { state.appointments.unshift(data); }
      renderAppts(); await loadKPIs();
    }

    if (type==='staff') {
      const payload = Object.fromEntries(fd.entries());
      const body = { first_name: payload.first_name?.trim(), last_name: payload.last_name?.trim(), role: payload.role, speciality: payload.speciality || null, email: payload.email || null, branch_id: Number(payload.branch_id), is_active: payload.is_active==='on'?1:0 };
      if (!id && payload.password) body.password = payload.password;
      const data = id
        ? await safeFetch(`${API_BASE}/staff/${id}`, { method:'PUT', body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/staff`, { method:'POST', body: JSON.stringify(body) });
      if (id) { const i = state.staff.findIndex(s=>s.staff_id===id); if (i>-1) state.staff[i]=data; } else { state.staff.unshift(data); }
      renderStaff(); await loadKPIs();
    }

    if (type==='branch') {
      const payload = Object.fromEntries(fd.entries());
      const body = { branch_name: payload.branch_name?.trim(), location: payload.location || null, phone: payload.phone || null };
      const data = id
        ? await safeFetch(`${API_BASE}/branches/${id}`, { method:'PUT', body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/branches`, { method:'POST', body: JSON.stringify(body) });
      if (id) { const i = state.branches.findIndex(b=>b.branch_id===id); if (i>-1) state.branches[i]=data; } else { state.branches.unshift(data); }
      renderBranches();
    }

    if (type==='policy') {
      const payload = Object.fromEntries(fd.entries());
      const body = { patient_id: Number(payload.patient_id), provider_name: payload.provider_name || null, policy_number: payload.policy_number || null, coverage_percentage: payload.coverage_percentage ? Number(payload.coverage_percentage) : null, deductable: payload.deductable ? Number(payload.deductable) : null, expiry_date: payload.expiry_date || null, is_active: payload.is_active==='on'?1:0 };
      const data = id
        ? await safeFetch(`${API_BASE}/insurance-policies/${id}`, { method:'PUT', body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/insurance-policies`, { method:'POST', body: JSON.stringify(body) });
      if (id) { const i = state.policies.findIndex(p=>p.policy_id===id); if (i>-1) state.policies[i]=data; } else { state.policies.unshift(data); }
      renderPolicies(); await loadKPIs();
    }

    if (type==='invoice') {
      const payload = Object.fromEntries(fd.entries());
      const body = { patient_id: Number(payload.patient_id), appointment_id: payload.appointment_id? Number(payload.appointment_id): null, total_amount: payload.total_amount? Number(payload.total_amount): null };
      const data = id
        ? await safeFetch(`${API_BASE}/invoices/${id}`, { method:'PUT', body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/invoices`, { method:'POST', body: JSON.stringify(body) });
      if (id) { const i = state.invoices.findIndex(inv=>inv.invoice_id===id); if (i>-1) state.invoices[i]=data; } else { state.invoices.unshift(data); }
      renderInvoices();
    }

    if (type==='payment') {
      const payload = Object.fromEntries(fd.entries());
      const body = { invoice_id: Number(currentModal.id), amount: Number(payload.amount), payment_method: payload.payment_method, transaction_reference: payload.transaction_reference || null, status: 'Paid' };
      const data = await safeFetch(`${API_BASE}/payments`, { method:'POST', body: JSON.stringify(body) });
      // Refresh invoice list
      await loadInvoices();
      renderInvoices();
    }

    if (type==='treatment') {
      const payload = Object.fromEntries(fd.entries());
      const body = {
        appointment_id: Number(payload.appointment_id),
        treatment_type_id: Number(payload.treatment_type_id),
        consultation_notes: payload.consultation_notes || null,
        prescription: payload.prescription || null,
        treatment_date: payload.treatment_date || null,
        cost: payload.cost? Number(payload.cost): null,
        doctor_signature: payload.doctor_signature || null
      };
      const data = id
        ? await safeFetch(`${API_BASE}/treatments/${id}`, { method:'PUT', body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/treatments`, { method:'POST', body: JSON.stringify(body) });
      await loadTreatments();
      renderTreatments();
    }

    if (type==='treatment_type') {
      const payload = Object.fromEntries(fd.entries());
      const body = {
        treatment_name: payload.treatment_name?.trim(),
        description: payload.description || null,
        icd10_code: payload.icd10_code || null,
        cpt_code: payload.cpt_code || null,
        standard_cost: payload.standard_cost ? Number(payload.standard_cost) : null,
        category: payload.category || null,
        is_active: 1
      };
      await safeFetch(`${API_BASE}/treatment-catalogue`, { method:'POST', body: JSON.stringify(body) });
      await loadTreatmentTypes();
    }

    closeModal();
  } catch (err) {
    alert(`Save failed: ${err.message}`);
  }
});

// Login modal
const loginModal = $('#loginModal');
function openLogin(){ loginModal.classList.remove('hidden'); loginModal.classList.add('flex'); }
function closeLogin(){ loginModal.classList.add('hidden'); loginModal.classList.remove('flex'); }
$('#loginBtn').addEventListener('click', openLogin);
$('#loginClose').addEventListener('click', closeLogin);
$('#loginCancel').addEventListener('click', closeLogin);
$('#loginSubmit').addEventListener('click', async ()=>{
  const fd = new FormData($('#loginForm'));
  const username = fd.get('username')?.trim();
  const password = fd.get('password');
  if (!username || !password) return alert('Enter username/email and password');
  try {
    const data = await safeFetch(`${API_BASE}/auth/login`, { method:'POST', body: JSON.stringify({ username, password }) });
    localStorage.setItem('session_id', data.session_id);
    state.currentUser = data.staff;
    applyRBAC();
    await loadAll();
    closeLogin();
    $('#loginBtnText').textContent = 'Switch User';
  } catch (e) {
    alert(`Login failed: ${e.message}`);
  }
});
$('#logoutBtn').addEventListener('click', async ()=>{
  try { await safeFetch(`${API_BASE}/auth/logout`, { method:'POST' }); } catch {}
  localStorage.removeItem('session_id');
  state.currentUser = null;
  applyRBAC();
});

// Listeners
$('#patientSearch').addEventListener('input', renderPatients);
$('#apptStatusFilter').addEventListener('change', renderAppts);
$('#staffRoleFilter').addEventListener('change', renderStaff);
$('#quickAddBtn').addEventListener('click', ()=>openModal('patient'));
$('#qaNewPatient').addEventListener('click', ()=>{ openModal('patient'); switchTab('patients'); });
$('#qaNewAppointment').addEventListener('click', ()=>{ openModal('appt'); switchTab('appointments'); });
$('#qaNewStaff').addEventListener('click', ()=>{ openModal('staff'); switchTab('staff'); });
$('#addPatientBtn')?.addEventListener('click', ()=>openModal('patient'));
$('#addApptBtn')?.addEventListener('click', ()=>openModal('appt'));
$('#addStaffBtn')?.addEventListener('click', ()=>openModal('staff'));
$('#addBranchBtn')?.addEventListener('click', ()=>openModal('branch'));
$('#addPolicyBtn')?.addEventListener('click', ()=>openModal('policy'));
$('#addInvoiceBtn')?.addEventListener('click', ()=>openModal('invoice'));
$('#addTreatmentBtn')?.addEventListener('click', ()=>openModal('treatment'));
$('#addTreatmentTypeBtn')?.addEventListener('click', ()=>openModal('treatment_type'));
$('#globalSearch').addEventListener('input', ()=>{
  renderPatients(); renderStaff(); renderBranches(); renderPolicies(); renderAppts(); renderInvoices(); renderTreatments();
});

// Table actions
patientsTbody.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  const action = btn.dataset.action;
  if (action==='edit') return openModal('patient', id);
  if (action==='appt'){ openModal('appt', null); setTimeout(()=>{ modalForm.querySelector('[name="patient_id"]').value = String(id); },0); return; }
  if (action==='del'){
    if (!confirm('Delete this patient?')) return;
    try {
      await safeFetch(`${API_BASE}/patients/${id}`, { method:'DELETE' });
      state.patients = state.patients.filter(p=>p.patient_id!==id);
      state.appointments = state.appointments.filter(a=>a.patient_id!==id);
      state.policies = state.policies.filter(p=>p.patient_id!==id);
      renderPatients(); renderAppts(); renderPolicies(); await loadKPIs();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

apptsTbody.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  const action = btn.dataset.action;
  if (action==='edit') return openModal('appt', id);
  if (action==='complete'){
    try {
      const body = { status: 'Completed', modified_by: state.currentUser?.staff_id || null, reason: 'Marked complete' };
      const data = await safeFetch(`${API_BASE}/appointments/${id}`, { method:'PUT', body: JSON.stringify(body) });
      const i = state.appointments.findIndex(a=>a.appointment_id===id); if (i>-1) state.appointments[i]=data;
      renderAppts(); await loadKPIs();
    } catch (err) { alert(`Failed: ${err.message}`); }
  }
  if (action==='del'){
    if (!confirm('Delete this appointment?')) return;
    try {
      await safeFetch(`${API_BASE}/appointments/${id}`, { method:'DELETE' });
      state.appointments = state.appointments.filter(a=>a.appointment_id!==id);
      renderAppts(); await loadKPIs();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

staffTbody.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  const action = btn.dataset.action;
  if (action==='edit') return openModal('staff', id);
  if (action==='del'){
    const hasAppts = state.appointments.some(a=>a.doctor_id===id);
    if (hasAppts) return alert('This staff member has appointments. Remove or reassign them first.');
    if (!confirm('Delete this staff member?')) return;
    try {
      await safeFetch(`${API_BASE}/staff/${id}`, { method:'DELETE' });
      state.staff = state.staff.filter(s=>s.staff_id!==id);
      renderStaff(); await loadKPIs();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

branchesGrid.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  const action = btn.dataset.action;
  if (action==='edit') return openModal('branch', id);
  if (action==='del'){
    const used = state.staff.some(s=>s.branch_id===id) || state.appointments.some(a=>a.branch_id===id);
    if (used) return alert('This branch is in use by staff/appointments. Reassign first.');
    if (!confirm('Delete this branch?')) return;
    try {
      await safeFetch(`${API_BASE}/branches/${id}`, { method:'DELETE' });
      state.branches = state.branches.filter(b=>b.branch_id!==id);
      renderBranches();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

policyTbody.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  const action = btn.dataset.action;
  if (action==='edit') return openModal('policy', id);
  if (action==='del'){
    if (!confirm('Delete this policy?')) return;
    try {
      await safeFetch(`${API_BASE}/insurance-policies/${id}`, { method:'DELETE' });
      state.policies = state.policies.filter(p=>p.policy_id!==id);
      renderPolicies(); await loadKPIs();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

invoicesTbody.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  const action = btn.dataset.action;
  if (action==='recalc'){
    try {
      const data = await safeFetch(`${API_BASE}/invoices/${id}/recalculate`, { method:'POST' });
      const i = state.invoices.findIndex(x=>x.invoice_id===id); if (i>-1) state.invoices[i]=data;
      renderInvoices();
    } catch (err) { alert(`Recalc failed: ${err.message}`); }
  }
  if (action==='pay'){
    openModal('payment', id);
  }
  if (action==='del'){
    if (!confirm('Delete this invoice?')) return;
    try {
      await safeFetch(`${API_BASE}/invoices/${id}`, { method:'DELETE' });
      state.invoices = state.invoices.filter(x=>x.invoice_id!==id);
      renderInvoices();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

treatmentsTbody.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  const action = btn.dataset.action;
  if (action==='edit') return openModal('treatment', id);
  if (action==='del'){
    if (!confirm('Delete this treatment?')) return;
    try {
      await safeFetch(`${API_BASE}/treatments/${id}`, { method:'DELETE' });
      state.treatments = state.treatments.filter(t=>t.treatment_id!==id);
      renderTreatments();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

function switchTab(name){
  $all('button[data-tab]').forEach(b=>b.classList.remove('active'));
  document.querySelector(`button[data-tab="${name}"]`).classList.add('active');
  Object.values(panels).forEach(p=>p.classList.add('hidden'));
  panels[name].classList.remove('hidden');
}

// Loaders
async function loadBranches(){ state.branches = await safeFetch(`${API_BASE}/branches`); }
async function loadPatients(){ state.patients = await safeFetch(`${API_BASE}/patients`); }
async function loadStaff(){ state.staff = await safeFetch(`${API_BASE}/staff`); }
async function loadAppointments(){ state.appointments = await safeFetch(`${API_BASE}/appointments`); }
async function loadPolicies(){ state.policies = await safeFetch(`${API_BASE}/insurance-policies`); }
async function loadInvoices(){ state.invoices = await safeFetch(`${API_BASE}/invoices`); }
async function loadTreatments(){ 
  const t = await safeFetch(`${API_BASE}/treatments`);
  // merge name from catalogue if present
  state.treatments = t.map(x=>{
    const tt = state.treatmentTypes.find(tt=>tt.treatment_type_id===x.treatment_type_id);
    return { ...x, treatment_name: x.treatment_name || tt?.treatment_name };
  });
}
async function loadTreatmentTypes(){ state.treatmentTypes = await safeFetch(`${API_BASE}/treatment-catalogue`); }
async function loadCurrentUser(){
  const token = localStorage.getItem('session_id');
  if (!token) { state.currentUser = null; return; }
  const me = await safeFetch(`${API_BASE}/auth/me`);
  state.currentUser = me.user;
}

// Initial load
async function loadAll(){
  await Promise.all([
    loadCurrentUser(),
    loadBranches(),
    loadPatients(),
    loadStaff(),
    loadAppointments(),
    loadPolicies(),
    loadTreatmentTypes(),
    loadInvoices(),
    loadTreatments(),
    loadKPIs()
  ]);
  renderPatients();
  renderAppts();
  renderStaff();
  renderBranches();
  renderPolicies();
  renderInvoices();
  renderTreatments();
  applyRBAC();
}

document.addEventListener('DOMContentLoaded', loadAll);
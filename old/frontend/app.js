// Change this if your API runs on a different host/port
const API_BASE = 'http://localhost:3000/api';

// Helpers
async function safeFetch(url, options = {}) {
  const token = localStorage.getItem('session_id'); // set after login
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
  const res = await fetch(url, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
  return data;
}
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }
function setText(id, val){ const el = document.getElementById(id); if (el) el.textContent = val; }

// App state
const state = { branches: [], patients: [], staff: [], appointments: [], policies: [] };

// Tabs
const panels = {
  overview: document.getElementById('panel-overview'),
  patients: document.getElementById('panel-patients'),
  appointments: document.getElementById('panel-appointments'),
  staff: document.getElementById('panel-staff'),
  branches: document.getElementById('panel-branches'),
  insurance: document.getElementById('panel-insurance'),
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
const patientsTbody = document.getElementById('patientsTbody');
const apptsTbody = document.getElementById('apptsTbody');
const staffTbody = document.getElementById('staffTbody');
const branchesGrid = document.getElementById('branchesGrid');
const policyTbody = document.getElementById('policyTbody');

// Rendering
function today(){ return new Date().toISOString().slice(0,10); }
function renderKPIs(){
  setText('kpiPatients', state.patients.length);
  setText('kpiAppointments', state.appointments.filter(a=>a.appointment_date===today()).length);
  setText('kpiDoctors', state.staff.filter(s=>s.role==='Doctor' && s.is_active).length);
  const avg = state.policies.length ? Math.round(state.policies.reduce((a,p)=>a+(Number(p.coverage_percentage)||0),0)/state.policies.length) : 0;
  setText('kpiCoverage', `${avg}%`);
}

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
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="appt" data-id="${p.patient_id}">Schedule</button>
            <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${p.patient_id}">Delete</button>
          </div>
        </td>`;
      patientsTbody.appendChild(tr);
    });
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
          <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${b.branch_id}">Edit</button>
          <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${b.branch_id}">Delete</button>
        </div>`;
      branchesGrid.appendChild(card);
    });
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
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${s.staff_id}">Edit</button>
            <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${s.staff_id}">Delete</button>
          </div>
        </td>`;
      staffTbody.appendChild(tr);
    });
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
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${a.appointment_id}">Edit</button>
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="complete" data-id="${a.appointment_id}">Complete</button>
            <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${a.appointment_id}">Delete</button>
          </div>
        </td>`;
      apptsTbody.appendChild(tr);
    });
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
            <button class="glass rounded-lg px-3 py-1 text-xs" data-action="edit" data-id="${p.policy_id}">Edit</button>
            <button class="glass rounded-lg px-3 py-1 text-xs text-rose-300" data-action="del" data-id="${p.policy_id}">Delete</button>
          </div>
        </td>`;
      policyTbody.appendChild(tr);
    });
}

// Modal system
const modalBack = document.getElementById('modalBack');
const modalTitle = document.getElementById('modalTitle');
const modalForm = document.getElementById('modalForm');
const modalClose = document.getElementById('modalClose');
const modalCancel = document.getElementById('modalCancel');
const modalSave = document.getElementById('modalSave');
let currentModal = null;

function openModal(type, id=null){
  currentModal = { type, id };
  modalForm.innerHTML = '';
  modalTitle.textContent = ({
    patient: id? 'Edit Patient':'Add Patient',
    appt: id? 'Edit Appointment':'Schedule Appointment',
    staff: id? 'Edit Staff':'Add Staff',
    branch: id? 'Edit Branch':'Add Branch',
    policy: id? 'Edit Policy':'Add Policy'
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
        <select class="glass rounded-xl px-3 py-2" name="status">
          <option ${a?.status==='Scheduled'?'selected':''}>Scheduled</option>
          <option ${a?.status==='Completed'?'selected':''}>Completed</option>
          <option ${a?.status==='Cancelled'?'selected':''}>Cancelled</option>
        </select>
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
      const body = {
        first_name: payload.first_name?.trim(), last_name: payload.last_name?.trim(),
        date_of_birth: payload.date_of_birth || null, gender: payload.gender || null,
        phone: payload.phone || null, email: payload.email || null,
        address: payload.address || null, emergency_contact: payload.emergency_contact || null
      };
      const data = id
        ? await safeFetch(`${API_BASE}/patients/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/patients`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (id) {
        const i = state.patients.findIndex(p=>p.patient_id===id); if (i>-1) state.patients[i]=data;
      } else {
        state.patients.unshift(data);
      }
      renderPatients(); renderKPIs();
    }

    if (type==='appt') {
      const payload = Object.fromEntries(fd.entries());
      const body = {
        patient_id: Number(payload.patient_id),
        doctor_id: Number(payload.doctor_id),
        branch_id: Number(payload.branch_id),
        appointment_date: payload.appointment_date,
        appointment_time: payload.appointment_time,
        status: payload.status
      };
      const data = id
        ? await safeFetch(`${API_BASE}/appointments/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/appointments`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (id) {
        const i = state.appointments.findIndex(a=>a.appointment_id===id); if (i>-1) state.appointments[i]=data;
      } else {
        state.appointments.unshift(data);
      }
      renderAppts(); renderKPIs();
    }

    if (type==='staff') {
      const payload = Object.fromEntries(fd.entries());
      const body = {
        first_name: payload.first_name?.trim(), last_name: payload.last_name?.trim(),
        role: payload.role, speciality: payload.speciality || null,
        email: payload.email || null, branch_id: Number(payload.branch_id), is_active: payload.is_active==='on'?1:0
      };
      if (!id && payload.password) body.password = payload.password;
      const data = id
        ? await safeFetch(`${API_BASE}/staff/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/staff`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (id) {
        const i = state.staff.findIndex(s=>s.staff_id===id); if (i>-1) state.staff[i]=data;
      } else {
        state.staff.unshift(data);
      }
      renderStaff(); renderKPIs();
    }

    if (type==='branch') {
      const payload = Object.fromEntries(fd.entries());
      const body = { branch_name: payload.branch_name?.trim(), location: payload.location || null, phone: payload.phone || null };
      const data = id
        ? await safeFetch(`${API_BASE}/branches/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/branches`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (id) {
        const i = state.branches.findIndex(b=>b.branch_id===id); if (i>-1) state.branches[i]=data;
      } else {
        state.branches.unshift(data);
      }
      renderBranches();
    }

    if (type==='policy') {
      const payload = Object.fromEntries(fd.entries());
      const body = {
        patient_id: Number(payload.patient_id),
        provider_name: payload.provider_name || null,
        policy_number: payload.policy_number || null,
        coverage_percentage: payload.coverage_percentage ? Number(payload.coverage_percentage) : null,
        deductable: payload.deductable ? Number(payload.deductable) : null,
        expiry_date: payload.expiry_date || null,
        is_active: payload.is_active==='on'?1:0
      };
      const data = id
        ? await safeFetch(`${API_BASE}/insurance-policies/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
        : await safeFetch(`${API_BASE}/insurance-policies`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (id) {
        const i = state.policies.findIndex(p=>p.policy_id===id); if (i>-1) state.policies[i]=data;
      } else {
        state.policies.unshift(data);
      }
      renderPolicies(); renderKPIs();
    }

    closeModal();
  } catch (err) {
    alert(`Save failed: ${err.message}`);
  }
});

// Listeners
document.getElementById('patientSearch').addEventListener('input', renderPatients);
document.getElementById('apptStatusFilter').addEventListener('change', renderAppts);
document.getElementById('staffRoleFilter').addEventListener('change', renderStaff);
document.getElementById('quickAddBtn').addEventListener('click', ()=>openModal('patient'));
document.getElementById('qaNewPatient').addEventListener('click', ()=>{ openModal('patient'); switchTab('patients'); });
document.getElementById('qaNewAppointment').addEventListener('click', ()=>{ openModal('appt'); switchTab('appointments'); });
document.getElementById('qaNewStaff').addEventListener('click', ()=>{ openModal('staff'); switchTab('staff'); });
document.getElementById('addPatientBtn')?.addEventListener('click', ()=>openModal('patient'));
document.getElementById('addApptBtn')?.addEventListener('click', ()=>openModal('appt'));
document.getElementById('addStaffBtn')?.addEventListener('click', ()=>openModal('staff'));
document.getElementById('addBranchBtn')?.addEventListener('click', ()=>openModal('branch'));
document.getElementById('addPolicyBtn')?.addEventListener('click', ()=>openModal('policy'));
document.getElementById('globalSearch').addEventListener('input', ()=>{
  renderPatients(); renderStaff(); renderBranches(); renderPolicies(); renderAppts();
});

function switchTab(name){
  $all('button[data-tab]').forEach(b=>b.classList.remove('active'));
  document.querySelector(`button[data-tab="${name}"]`).classList.add('active');
  Object.values(panels).forEach(p=>p.classList.add('hidden'));
  panels[name].classList.remove('hidden');
}

// Table actions
patientsTbody.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  if (btn.dataset.action==='edit') return openModal('patient', id);
  if (btn.dataset.action==='appt'){ openModal('appt', null); setTimeout(()=>{ modalForm.querySelector('[name="patient_id"]').value = String(id); },0); return; }
  if (btn.dataset.action==='del'){
    if (!confirm('Delete this patient?')) return;
    try {
      await safeFetch(`${API_BASE}/patients/${id}`, { method:'DELETE' });
      state.patients = state.patients.filter(p=>p.patient_id!==id);
      state.appointments = state.appointments.filter(a=>a.patient_id!==id);
      state.policies = state.policies.filter(p=>p.patient_id!==id);
      renderPatients(); renderAppts(); renderPolicies(); renderKPIs();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

apptsTbody.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  if (btn.dataset.action==='edit') return openModal('appt', id);
  if (btn.dataset.action==='complete'){
    try {
      const appt = state.appointments.find(a=>a.appointment_id===id);
      const body = { status: 'Completed', modified_by: null, reason: 'Marked complete' };
      const data = await safeFetch(`${API_BASE}/appointments/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const i = state.appointments.findIndex(a=>a.appointment_id===id); if (i>-1) state.appointments[i]=data;
      renderAppts(); renderKPIs();
    } catch (err) { alert(`Failed: ${err.message}`); }
  }
  if (btn.dataset.action==='del'){
    if (!confirm('Delete this appointment?')) return;
    try {
      await safeFetch(`${API_BASE}/appointments/${id}`, { method:'DELETE' });
      state.appointments = state.appointments.filter(a=>a.appointment_id!==id);
      renderAppts(); renderKPIs();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

staffTbody.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  if (btn.dataset.action==='edit') return openModal('staff', id);
  if (btn.dataset.action==='del'){
    const hasAppts = state.appointments.some(a=>a.doctor_id===id);
    if (hasAppts) return alert('This staff member has appointments. Remove or reassign them first.');
    if (!confirm('Delete this staff member?')) return;
    try {
      await safeFetch(`${API_BASE}/staff/${id}`, { method:'DELETE' });
      state.staff = state.staff.filter(s=>s.staff_id!==id);
      renderStaff(); renderKPIs();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

branchesGrid.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if (!btn) return; const id = Number(btn.dataset.id);
  if (btn.dataset.action==='edit') return openModal('branch', id);
  if (btn.dataset.action==='del'){
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
  if (btn.dataset.action==='edit') return openModal('policy', id);
  if (btn.dataset.action==='del'){
    if (!confirm('Delete this policy?')) return;
    try {
      await safeFetch(`${API_BASE}/insurance-policies/${id}`, { method:'DELETE' });
      state.policies = state.policies.filter(p=>p.policy_id!==id);
      renderPolicies(); renderKPIs();
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }
});

// Load initial data
async function loadAll(){
  try {
    const [branches, patients, staff, appointments, policies] = await Promise.all([
      safeFetch(`${API_BASE}/branches`),
      safeFetch(`${API_BASE}/patients`),
      safeFetch(`${API_BASE}/staff`),
      safeFetch(`${API_BASE}/appointments`),
      safeFetch(`${API_BASE}/insurance-policies`)
    ]);
    state.branches = branches;
    state.patients = patients;
    state.staff = staff;
    state.appointments = appointments;
    state.policies = policies;
    renderKPIs(); renderPatients(); renderAppts(); renderStaff(); renderBranches(); renderPolicies();
  } catch (err) {
    alert(`Failed to load data from API: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', loadAll);
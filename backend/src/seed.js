const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function ensureBranch(name) {
  const [rows] = await pool.query('SELECT branch_id FROM branch WHERE branch_name = ? LIMIT 1', [name]);
  if (rows.length) return rows[0].branch_id;
  const [r] = await pool.query('INSERT INTO branch (branch_name, location, phone) VALUES (?, ?, ?)', [name, 'HQ', '']);
  return r.insertId;
}

async function ensureStaff({ email, role, first_name, last_name, branch_id, is_active = 1, password }) {
  const [rows] = await pool.query('SELECT staff_id FROM staff WHERE email = ? LIMIT 1', [email]);
  if (rows.length) return rows[0].staff_id;
  const hashed = await bcrypt.hash(password, 10);
  const [r] = await pool.query(
    `INSERT INTO staff (first_name, last_name, role, speciality, email, branch_id, is_active, password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [first_name, last_name, role, null, email, branch_id, is_active, hashed]
  );
  return r.insertId;
}

async function seedDefaults() {
  // Create a default branch to attach staff to
  const centralId = await ensureBranch('Central');

  // Default Admin login: username=admin, password=admin -> email admin@hospitalos.local
  await ensureStaff({
    email: 'admin@hospitalos.local',
    role: 'Admin',
    first_name: 'System',
    last_name: 'Admin',
    branch_id: centralId,
    password: 'admin'
  });

  // A couple of doctors (password=admin)
  await ensureStaff({
    email: 'dr.maya@hospitalos.local',
    role: 'Doctor',
    first_name: 'Maya',
    last_name: 'Singh',
    branch_id: centralId,
    password: 'admin'
  });
  await ensureStaff({
    email: 'dr.noah@hospitalos.local',
    role: 'Doctor',
    first_name: 'Noah',
    last_name: 'Kim',
    branch_id: centralId,
    password: 'admin'
  });

  // Optional nurse (password=admin)
  await ensureStaff({
    email: 'nurse.zara@hospitalos.local',
    role: 'Nurse',
    first_name: 'Zara',
    last_name: 'Lopez',
    branch_id: centralId,
    password: 'admin'
  });
}

module.exports = { seedDefaults };
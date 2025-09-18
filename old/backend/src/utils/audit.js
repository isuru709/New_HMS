const { pool } = require('../db');

// Writes one row to audit_log with JSON copies of old/new values.
// Call this after you modify the DB (INSERT/UPDATE/DELETE).
async function logAudit({
  staff_id = null,
  table_name,
  operation_type, // 'INSERT' | 'UPDATE' | 'DELETE'
  record_id = null,
  ip_address = null,
  old_values = null,
  new_values = null
}) {
  try {
    await pool.query(
      `INSERT INTO audit_log (staff_id, table_name, operation_type, record_id, timestamp, ip_address, old_values, new_values)
       VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
      [
        staff_id,
        table_name,
        operation_type,
        record_id,
        ip_address,
        old_values ? JSON.stringify(old_values) : null,
        new_values ? JSON.stringify(new_values) : null
      ]
    );
  } catch (e) {
    // Do not break main flow if audit fails; just log.
    console.error('Audit log failed:', e.message);
  }
}

function getStaffId(req) {
  return req.user?.staff_id || null;
}
function getIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  return Array.isArray(xfwd) ? xfwd[0] : (xfwd || req.ip || null);
}

module.exports = { logAudit, getStaffId, getIp };
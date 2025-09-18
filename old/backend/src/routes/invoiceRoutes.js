const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

async function getActivePolicyForPatient(patient_id) {
  const [rows] = await pool.query(
    `SELECT * FROM insurance_policy
      WHERE patient_id = ? AND (is_active = 1 OR expiry_date >= CURDATE())
      ORDER BY is_active DESC, expiry_date DESC, created_at DESC
      LIMIT 1`,
    [patient_id]
  );
  return rows[0] || null;
}

async function calculateTotals({ patient_id, appointment_id, total_amount }) {
  let total = total_amount != null ? Number(total_amount) : null;
  if (appointment_id && total == null) {
    const [rows] = await pool.query(
      `SELECT COALESCE(SUM(cost), 0) AS total FROM treatment WHERE appointment_id = ?`,
      [appointment_id]
    );
    total = Number(rows[0].total || 0);
  }
  if (total == null) total = 0;

  let insurance_amount = 0;
  let patient_amount = total;

  const policy = await getActivePolicyForPatient(patient_id);
  if (policy) {
    const coverage = Number(policy.coverage_percentage || 0);
    const deduct = Number(policy.deductable || 0);
    const eligible = Math.max(0, total - deduct);
    insurance_amount = Math.round((eligible * (coverage / 100)) * 100) / 100;
    insurance_amount = Math.min(insurance_amount, total); // safety
    patient_amount = Math.round((total - insurance_amount) * 100) / 100;
  }

  return { total_amount: total, insurance_amount, patient_amount };
}

// List
router.get('/',
  query('patient_id').optional().isInt().toInt(),
  query('status').optional().isIn(['Pending','Paid','Cancelled']),
  async (req, res, next) => {
    try {
      const filters = [], values = [];
      if (req.query.patient_id) { filters.push('i.patient_id = ?'); values.push(req.query.patient_id); }
      if (req.query.status) { filters.push('i.status = ?'); values.push(req.query.status); }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT i.*, p.first_name, p.last_name, a.appointment_date, a.appointment_time
           FROM invoice i
           LEFT JOIN patient p ON i.patient_id = p.patient_id
           LEFT JOIN appointment a ON i.appointment_id = a.appointment_id
           ${where}
           ORDER BY i.invoice_id DESC`,
        values
      );
      res.json(rows);
    } catch (e) { next(e); }
  }
);

// Get
router.get('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, p.first_name, p.last_name, a.appointment_date, a.appointment_time
         FROM invoice i
         LEFT JOIN patient p ON i.patient_id = p.patient_id
         LEFT JOIN appointment a ON i.appointment_id = a.appointment_id
        WHERE i.invoice_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Create (auto-calc totals if needed)
router.post('/',
  body('patient_id').isInt().toInt(),
  body('appointment_id').optional({ nullable: true }).isInt().toInt(),
  body('total_amount').optional({ nullable: true }).isFloat({ min: 0 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { patient_id, appointment_id = null, total_amount = null } = req.body;

      const totals = await calculateTotals({ patient_id, appointment_id, total_amount });
      const [result] = await conn.query(
        `INSERT INTO invoice (patient_id, appointment_id, total_amount, insurance_amount, patient_amount, status, created_at, due_date)
         VALUES (?, ?, ?, ?, ?, 'Pending', NOW(), NOW())`,
        [patient_id, appointment_id, totals.total_amount, totals.insurance_amount, totals.patient_amount]
      );
      const [rows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [result.insertId]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'invoice', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) {
      try { await conn.rollback(); } catch {}
      try { await conn.release(); } catch {}
      next(e);
    }
  }
);

// Recalculate totals from current treatments/policy
router.post('/:id/recalculate', param('id').isInt().toInt(), async (req, res, next) => {
  const staff_id = getStaffId(req), ip = getIp(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = Number(req.params.id);
    const [invRows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [id]);
    if (!invRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Invoice not found' }); }
    const invBefore = invRows[0];

    const totals = await calculateTotals({ patient_id: invBefore.patient_id, appointment_id: invBefore.appointment_id, total_amount: invBefore.total_amount });
    await conn.query(
      `UPDATE invoice SET total_amount=?, insurance_amount=?, patient_amount=? WHERE invoice_id=?`,
      [totals.total_amount, totals.insurance_amount, totals.patient_amount, id]
    );
    const [afterRows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'invoice', operation_type: 'UPDATE', record_id: id, ip_address: ip, old_values: invBefore, new_values: afterRows[0] });
    res.json(afterRows[0]);
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

// Update (status or fields)
router.put('/:id',
  param('id').isInt().toInt(),
  body('status').optional().isIn(['Pending','Paid','Cancelled']),
  body('total_amount').optional().isFloat({ min: 0 }),
  body('insurance_amount').optional().isFloat({ min: 0 }),
  body('patient_amount').optional().isFloat({ min: 0 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id = Number(req.params.id);
      const [beforeRows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [id]);
      if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Invoice not found' }); }
      const before = beforeRows[0];

      const fields = ['status','total_amount','insurance_amount','patient_amount','due_date'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      if (!updates.length) { await conn.rollback(); await conn.release(); return res.status(400).json({ error: 'No fields to update' }); }
      values.push(id);
      await conn.query(`UPDATE invoice SET ${updates.join(', ')} WHERE invoice_id = ?`, values);

      const [afterRows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'invoice', operation_type: 'UPDATE', record_id: id, ip_address: ip, old_values: before, new_values: afterRows[0] });
      res.json(afterRows[0]);
    } catch (e) {
      try { await conn.rollback(); } catch {}
      try { await conn.release(); } catch {}
      next(e);
    }
  }
);

// Delete
router.delete('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  const staff_id = getStaffId(req), ip = getIp(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = Number(req.params.id);
    const [beforeRows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Invoice not found' }); }
    await conn.query('DELETE FROM invoice WHERE invoice_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'invoice', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
const express = require('express');
const { body, param, validationResult, query } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

// List with optional filters
router.get('/',
  query('patient_id').optional().isInt().toInt(),
  query('doctor_id').optional().isInt().toInt(),
  query('branch_id').optional().isInt().toInt(),
  query('status').optional().isIn(['Scheduled','Completed','Cancelled']),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    try {
      const filters = [], values = [];
      const { patient_id, doctor_id, branch_id, status } = req.query;
      if (patient_id) { filters.push('a.patient_id = ?'); values.push(patient_id); }
      if (doctor_id) { filters.push('a.doctor_id = ?'); values.push(doctor_id); }
      if (branch_id) { filters.push('a.branch_id = ?'); values.push(branch_id); }
      if (status)     { filters.push('a.status = ?');     values.push(status); }

      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT a.*,
                p.first_name AS patient_first_name, p.last_name AS patient_last_name,
                s.first_name AS doctor_first_name, s.last_name AS doctor_last_name,
                b.branch_name
           FROM appointment a
           LEFT JOIN patient p ON a.patient_id = p.patient_id
           LEFT JOIN staff s   ON a.doctor_id  = s.staff_id
           LEFT JOIN branch b  ON a.branch_id  = b.branch_id
           ${where}
           ORDER BY a.appointment_id DESC`,
        values
      );
      res.json(rows);
    } catch (e) { next(e); }
  }
);

// Get
router.get('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  if (!ok(req, res)) return;
  try {
    const [rows] = await pool.query(
      `SELECT a.*,
              p.first_name AS patient_first_name, p.last_name AS patient_last_name,
              s.first_name AS doctor_first_name, s.last_name AS doctor_last_name,
              b.branch_name
         FROM appointment a
         LEFT JOIN patient p ON a.patient_id = p.patient_id
         LEFT JOIN staff s   ON a.doctor_id  = s.staff_id
         LEFT JOIN branch b  ON a.branch_id  = b.branch_id
        WHERE a.appointment_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Create
router.post('/',
  body('patient_id').isInt().toInt(),
  body('doctor_id').isInt().toInt(),
  body('branch_id').isInt().toInt(),
  body('appointment_date').isISO8601(),
  body('appointment_time').matches(/^\d{2}:\d{2}(:\d{2})?$/),
  body('status').optional({ nullable: true }).isIn(['Scheduled','Completed','Cancelled']),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    try {
      const { patient_id, doctor_id, branch_id, appointment_date, appointment_time, status = 'Scheduled' } = req.body;
      const [result] = await pool.query(
        `INSERT INTO appointment (patient_id, doctor_id, branch_id, appointment_date, appointment_time, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [patient_id, doctor_id, branch_id, appointment_date, appointment_time, status]
      );
      const [rows] = await pool.query('SELECT * FROM appointment WHERE appointment_id = ?', [result.insertId]);
      await logAudit({ staff_id, table_name: 'appointment', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  }
);

// Update
router.put('/:id',
  param('id').isInt().toInt(),
  body('patient_id').optional().isInt().toInt(),
  body('doctor_id').optional().isInt().toInt(),
  body('branch_id').optional().isInt().toInt(),
  body('appointment_date').optional().isISO8601(),
  body('appointment_time').optional().matches(/^\d{2}:\d{2}(:\d{2})?$/),
  body('status').optional().isIn(['Scheduled','Completed','Cancelled']),
  body('modified_by').optional().isInt().toInt(),
  body('reason').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { id } = req.params;

      const [existRows] = await conn.query('SELECT * FROM appointment WHERE appointment_id = ?', [id]);
      if (!existRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Appointment not found' }); }
      const before = existRows[0];

      const fields = ['patient_id','doctor_id','branch_id','appointment_date','appointment_time','status'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      if (!updates.length) { await conn.rollback(); await conn.release(); return res.status(400).json({ error: 'No fields to update' }); }
      updates.push('updated_at = NOW()');
      values.push(id);
      await conn.query(`UPDATE appointment SET ${updates.join(', ')} WHERE appointment_id = ?`, values);

      if (req.body.status && req.body.status !== before.status) {
        const modified_by = req.body.modified_by || staff_id || null;
        const reason = req.body.reason || null;
        await conn.query(
          `INSERT INTO appointment_history (appointment_id, previous_status, new_status, reason, modified_by)
           VALUES (?, ?, ?, ?, ?)`,
          [id, before.status, req.body.status, reason, modified_by]
        );
      }

      const [afterRows] = await conn.query('SELECT * FROM appointment WHERE appointment_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'appointment', operation_type: 'UPDATE', record_id: Number(id), ip_address: ip, old_values: before, new_values: afterRows[0] });
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
  if (!ok(req, res)) return;
  const staff_id = getStaffId(req), ip = getIp(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = Number(req.params.id);
    const [beforeRows] = await conn.query('SELECT * FROM appointment WHERE appointment_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Appointment not found' }); }
    await conn.query('DELETE FROM appointment WHERE appointment_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'appointment', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
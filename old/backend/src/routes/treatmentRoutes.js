const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

// List by appointment
router.get('/',
  query('appointment_id').optional().isInt().toInt(),
  async (req, res, next) => {
    try {
      const filters = [], values = [];
      if (req.query.appointment_id) { filters.push('t.appointment_id = ?'); values.push(req.query.appointment_id); }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT t.*, tc.treatment_name, tc.standard_cost
           FROM treatment t
           LEFT JOIN treatment_catalogue tc ON t.treatment_type_id = tc.treatment_type_id
           ${where}
           ORDER BY t.treatment_id DESC`,
        values
      );
      res.json(rows);
    } catch (e) { next(e); }
  }
);

// Get
router.get('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM treatment WHERE treatment_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Treatment not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Create
router.post('/',
  body('appointment_id').isInt().toInt(),
  body('treatment_type_id').isInt().toInt(),
  body('consultation_notes').optional({ nullable: true }).isString(),
  body('prescription').optional({ nullable: true }).isString(),
  body('treatment_date').optional({ nullable: true }).isISO8601(),
  body('cost').optional({ nullable: true }).isFloat({ min: 0 }),
  body('doctor_signature').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    try {
      const {
        appointment_id, treatment_type_id, consultation_notes = null, prescription = null,
        treatment_date = null, cost = null, doctor_signature = null
      } = req.body;

      let finalCost = cost;
      if (finalCost == null) {
        const [tt] = await pool.query('SELECT standard_cost FROM treatment_catalogue WHERE treatment_type_id = ?', [treatment_type_id]);
        finalCost = tt.length ? Number(tt[0].standard_cost || 0) : 0;
      }

      const [result] = await pool.query(
        `INSERT INTO treatment (appointment_id, treatment_type_id, consultation_notes, prescription, treatment_date, cost, doctor_signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [appointment_id, treatment_type_id, consultation_notes, prescription, treatment_date, finalCost, doctor_signature]
      );
      const [rows] = await pool.query('SELECT * FROM treatment WHERE treatment_id = ?', [result.insertId]);
      await logAudit({ staff_id, table_name: 'treatment', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  }
);

// Update
router.put('/:id',
  param('id').isInt().toInt(),
  body('consultation_notes').optional({ nullable: true }).isString(),
  body('prescription').optional({ nullable: true }).isString(),
  body('treatment_date').optional({ nullable: true }).isISO8601(),
  body('cost').optional({ nullable: true }).isFloat({ min: 0 }),
  body('doctor_signature').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id = Number(req.params.id);
      const [beforeRows] = await conn.query('SELECT * FROM treatment WHERE treatment_id = ?', [id]);
      if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Treatment not found' }); }
      const before = beforeRows[0];

      const fields = ['consultation_notes','prescription','treatment_date','cost','doctor_signature'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      if (!updates.length) { await conn.rollback(); await conn.release(); return res.status(400).json({ error: 'No fields to update' }); }
      values.push(id);
      await conn.query(`UPDATE treatment SET ${updates.join(', ')} WHERE treatment_id = ?`, values);

      const [afterRows] = await conn.query('SELECT * FROM treatment WHERE treatment_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'treatment', operation_type: 'UPDATE', record_id: id, ip_address: ip, old_values: before, new_values: afterRows[0] });
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
    const [beforeRows] = await conn.query('SELECT * FROM treatment WHERE treatment_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Treatment not found' }); }
    await conn.query('DELETE FROM treatment WHERE treatment_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'treatment', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
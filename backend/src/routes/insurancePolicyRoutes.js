const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

// List
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT ip.*, p.first_name, p.last_name
         FROM insurance_policy ip
         LEFT JOIN patient p ON ip.patient_id = p.patient_id
         ORDER BY ip.policy_id DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Get
router.get('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM insurance_policy WHERE policy_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Policy not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Create
router.post('/',
  body('patient_id').isInt().toInt(),
  body('provider_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('policy_number').optional({ nullable: true }).isLength({ max: 10 }),
  body('coverage_percentage').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
  body('deductable').optional({ nullable: true }).isFloat({ min: 0 }),
  body('expiry_date').optional({ nullable: true }).isISO8601(),
  body('is_active').optional({ nullable: true }).isInt({ min: 0, max: 1 }).toInt(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    try {
      const {
        patient_id, provider_name = null, policy_number = null, coverage_percentage = null,
        deductable = null, expiry_date = null, is_active = 1
      } = req.body;
      const [result] = await pool.query(
        `INSERT INTO insurance_policy
         (patient_id, provider_name, policy_number, coverage_percentage, deductable, expiry_date, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [patient_id, provider_name, policy_number, coverage_percentage, deductable, expiry_date, is_active]
      );
      const [rows] = await pool.query('SELECT * FROM insurance_policy WHERE policy_id = ?', [result.insertId]);
      await logAudit({ staff_id, table_name: 'insurance_policy', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  }
);

// Update
router.put('/:id',
  param('id').isInt().toInt(),
  body('patient_id').optional().isInt().toInt(),
  body('provider_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('policy_number').optional({ nullable: true }).isLength({ max: 10 }),
  body('coverage_percentage').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
  body('deductable').optional({ nullable: true }).isFloat({ min: 0 }),
  body('expiry_date').optional({ nullable: true }).isISO8601(),
  body('is_active').optional({ nullable: true }).isInt({ min: 0, max: 1 }).toInt(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id = Number(req.params.id);
      const [beforeRows] = await conn.query('SELECT * FROM insurance_policy WHERE policy_id = ?', [id]);
      if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Policy not found' }); }
      const before = beforeRows[0];

      const fields = ['patient_id','provider_name','policy_number','coverage_percentage','deductable','expiry_date','is_active'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      if (!updates.length) { await conn.rollback(); await conn.release(); return res.status(400).json({ error: 'No fields to update' }); }
      values.push(id);
      await conn.query(`UPDATE insurance_policy SET ${updates.join(', ')} WHERE policy_id = ?`, values);

      const [afterRows] = await conn.query('SELECT * FROM insurance_policy WHERE policy_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'insurance_policy', operation_type: 'UPDATE', record_id: id, ip_address: ip, old_values: before, new_values: afterRows[0] });
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
    const [beforeRows] = await conn.query('SELECT * FROM insurance_policy WHERE policy_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Policy not found' }); }
    await conn.query('DELETE FROM insurance_policy WHERE policy_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'insurance_policy', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
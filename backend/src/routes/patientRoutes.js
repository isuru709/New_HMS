const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

// List
router.get('/',
  query('q').optional().isString(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    try {
      const { q } = req.query;
      if (q) {
        const like = `%${q}%`;
        const [rows] = await pool.query(
          `SELECT * FROM patient
           WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?
           ORDER BY patient_id DESC`, [like, like, like, like]
        );
        return res.json(rows);
      }
      const [rows] = await pool.query('SELECT * FROM patient ORDER BY patient_id DESC');
      res.json(rows);
    } catch (e) { next(e); }
  }
);

// Get
router.get('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  if (!ok(req, res)) return;
  try {
    const [rows] = await pool.query('SELECT * FROM patient WHERE patient_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Patient not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Create
router.post('/',
  body('first_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('last_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('date_of_birth').optional({ nullable: true }).isISO8601(),
  body('gender').optional({ nullable: true }).isIn(['Male', 'Female', 'Other']),
  body('phone').optional({ nullable: true }).isLength({ max: 10 }),
  body('email').optional({ nullable: true }).isEmail().isLength({ max: 50 }),
  body('address').optional({ nullable: true }).isString(),
  body('emergency_contact').optional({ nullable: true }).isLength({ max: 10 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    try {
      const {
        first_name = null, last_name = null, date_of_birth = null, gender = null,
        phone = null, email = null, address = null, emergency_contact = null
      } = req.body;
      const [result] = await pool.query(
        `INSERT INTO patient
         (first_name, last_name, date_of_birth, gender, phone, email, address, emergency_contact)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [first_name, last_name, date_of_birth, gender, phone, email, address, emergency_contact]
      );
      const [rows] = await pool.query('SELECT * FROM patient WHERE patient_id = ?', [result.insertId]);
      await logAudit({ staff_id, table_name: 'patient', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  }
);

// Update
router.put('/:id',
  param('id').isInt().toInt(),
  body('first_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('last_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('date_of_birth').optional({ nullable: true }).isISO8601(),
  body('gender').optional({ nullable: true }).isIn(['Male', 'Female', 'Other']),
  body('phone').optional({ nullable: true }).isLength({ max: 10 }),
  body('email').optional({ nullable: true }).isEmail().isLength({ max: 50 }),
  body('address').optional({ nullable: true }).isString(),
  body('emergency_contact').optional({ nullable: true }).isLength({ max: 10 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id = Number(req.params.id);
      const [beforeRows] = await conn.query('SELECT * FROM patient WHERE patient_id = ?', [id]);
      if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Patient not found' }); }
      const before = beforeRows[0];

      const fields = ['first_name','last_name','date_of_birth','gender','phone','email','address','emergency_contact'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      updates.push('updated_at = NOW()');
      values.push(id);
      await conn.query(`UPDATE patient SET ${updates.join(', ')} WHERE patient_id = ?`, values);

      const [afterRows] = await conn.query('SELECT * FROM patient WHERE patient_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'patient', operation_type: 'UPDATE', record_id: id, ip_address: ip, old_values: before, new_values: afterRows[0] });
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
    const [beforeRows] = await conn.query('SELECT * FROM patient WHERE patient_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Patient not found' }); }
    await conn.query('DELETE FROM patient WHERE patient_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'patient', operation_type: 'DELETE', record_id: id, ip_address: getIp(req), old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
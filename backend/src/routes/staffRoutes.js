const express = require('express');
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

// List
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT staff_id, first_name, last_name, role, speciality, email, branch_id, created_at, is_active FROM staff ORDER BY staff_id DESC'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Get
router.get('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  if (!ok(req, res)) return;
  try {
    const [rows] = await pool.query(
      'SELECT staff_id, first_name, last_name, role, speciality, email, branch_id, created_at, is_active FROM staff WHERE staff_id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Staff not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Create
router.post('/',
  body('first_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('last_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('role').isIn(['Admin', 'Doctor', 'Nurse', 'Receptionist', 'Other']),
  body('speciality').optional({ nullable: true }).isLength({ max: 25 }),
  body('email').optional({ nullable: true }).isEmail().isLength({ max: 50 }),
  body('branch_id').optional({ nullable: true }).isInt().toInt(),
  body('is_active').optional({ nullable: true }).isInt({ min: 0, max: 1 }).toInt(),
  body('password').isLength({ min: 6, max: 255 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const actor_id = getStaffId(req), ip = getIp(req);
    try {
      const {
        first_name = null, last_name = null, role,
        speciality = null, email = null, branch_id = null,
        is_active = 1, password
      } = req.body;
      const hashed = await bcrypt.hash(password, 10);
      const [result] = await pool.query(
        `INSERT INTO staff (first_name, last_name, role, speciality, email, branch_id, is_active, password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [first_name, last_name, role, speciality, email, branch_id, is_active, hashed]
      );
      const [rows] = await pool.query('SELECT staff_id, first_name, last_name, role, speciality, email, branch_id, created_at, is_active FROM staff WHERE staff_id = ?', [result.insertId]);
      await logAudit({ staff_id: actor_id, table_name: 'staff', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  }
);

// Update
router.put('/:id',
  param('id').isInt().toInt(),
  body('first_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('last_name').optional({ nullable: true }).isLength({ max: 25 }),
  body('role').optional().isIn(['Admin', 'Doctor', 'Nurse', 'Receptionist', 'Other']),
  body('speciality').optional({ nullable: true }).isLength({ max: 25 }),
  body('email').optional({ nullable: true }).isEmail().isLength({ max: 50 }),
  body('branch_id').optional({ nullable: true }).isInt().toInt(),
  body('is_active').optional({ nullable: true }).isInt({ min: 0, max: 1 }).toInt(),
  body('password').optional().isLength({ min: 6, max: 255 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const actor_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id = Number(req.params.id);
      const [beforeRows] = await conn.query('SELECT * FROM staff WHERE staff_id = ?', [id]);
      if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Staff not found' }); }
      const before = beforeRows[0];

      const fields = ['first_name','last_name','role','speciality','email','branch_id','is_active'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      if (req.body.password) {
        updates.push('password = ?'); values.push(await bcrypt.hash(req.body.password, 10));
      }
      if (!updates.length) { await conn.rollback(); await conn.release(); return res.status(400).json({ error: 'No fields to update' }); }
      values.push(id);
      await conn.query(`UPDATE staff SET ${updates.join(', ')} WHERE staff_id = ?`, values);

      const [afterRows] = await conn.query('SELECT staff_id, first_name, last_name, role, speciality, email, branch_id, created_at, is_active FROM staff WHERE staff_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id: actor_id, table_name: 'staff', operation_type: 'UPDATE', record_id: id, ip_address: ip, old_values: before, new_values: afterRows[0] });
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
  const actor_id = getStaffId(req), ip = getIp(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = Number(req.params.id);
    const [beforeRows] = await conn.query('SELECT * FROM staff WHERE staff_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Staff not found' }); }
    await conn.query('DELETE FROM staff WHERE staff_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id: actor_id, table_name: 'staff', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
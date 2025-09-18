const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

// List
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM branch ORDER BY branch_id DESC');
    res.json(rows);
  } catch (e) { next(e); }
});

// Get
router.get('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  if (!ok(req, res)) return;
  try {
    const [rows] = await pool.query('SELECT * FROM branch WHERE branch_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Branch not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Create
router.post('/',
  body('branch_name').isLength({ min: 1, max: 20 }),
  body('location').optional({ nullable: true }).isLength({ max: 20 }),
  body('phone').optional({ nullable: true }).isLength({ max: 10 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    try {
      const { branch_name, location = null, phone = null } = req.body;
      const [result] = await pool.query('INSERT INTO branch (branch_name, location, phone) VALUES (?, ?, ?)', [branch_name, location, phone]);
      const [rows] = await pool.query('SELECT * FROM branch WHERE branch_id = ?', [result.insertId]);
      await logAudit({ staff_id, table_name: 'branch', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  }
);

// Update
router.put('/:id',
  param('id').isInt().toInt(),
  body('branch_name').optional().isLength({ min: 1, max: 20 }),
  body('location').optional({ nullable: true }).isLength({ max: 20 }),
  body('phone').optional({ nullable: true }).isLength({ max: 10 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { id } = req.params;
      const [beforeRows] = await conn.query('SELECT * FROM branch WHERE branch_id = ?', [id]);
      if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Branch not found' }); }
      const before = beforeRows[0];

      const fields = ['branch_name', 'location', 'phone'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      if (!updates.length) { await conn.rollback(); await conn.release(); return res.status(400).json({ error: 'No fields to update' }); }
      values.push(id);
      await conn.query(`UPDATE branch SET ${updates.join(', ')} WHERE branch_id = ?`, values);

      const [afterRows] = await conn.query('SELECT * FROM branch WHERE branch_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'branch', operation_type: 'UPDATE', record_id: Number(id), ip_address: ip, old_values: before, new_values: afterRows[0] });
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
    const [beforeRows] = await conn.query('SELECT * FROM branch WHERE branch_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Branch not found' }); }
    await conn.query('DELETE FROM branch WHERE branch_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'branch', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
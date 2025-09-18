const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT sba.*, s.first_name, s.last_name, b.branch_name
         FROM staff_branch_access sba
         LEFT JOIN staff s ON sba.staff_id = s.staff_id
         LEFT JOIN branch b ON sba.branch_id = b.branch_id
         ORDER BY sba.access_id DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/',
  body('staff_id').isInt().toInt(),
  body('branch_id').isInt().toInt(),
  body('access_level').isIn(['Read','Write','Admin','Owner']),
  body('is_active').optional({ nullable: true }).isInt({ min: 0, max: 1 }).toInt(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const actor_id = getStaffId(req), ip = getIp(req);
    try {
      const { staff_id, branch_id, access_level, is_active = 1 } = req.body;
      const [result] = await pool.query(
        `INSERT INTO staff_branch_access (staff_id, branch_id, access_level, granted_at, is_active)
         VALUES (?, ?, ?, NOW(), ?)`,
        [staff_id, branch_id, access_level, is_active]
      );
      const [rows] = await pool.query('SELECT * FROM staff_branch_access WHERE access_id = ?', [result.insertId]);
      await logAudit({ staff_id: actor_id, table_name: 'staff_branch_access', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  }
);

router.put('/:id',
  param('id').isInt().toInt(),
  body('access_level').optional().isIn(['Read','Write','Admin','Owner']),
  body('is_active').optional({ nullable: true }).isInt({ min: 0, max: 1 }).toInt(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const actor_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id = Number(req.params.id);
      const [beforeRows] = await conn.query('SELECT * FROM staff_branch_access WHERE access_id = ?', [id]);
      if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Access record not found' }); }
      const before = beforeRows[0];

      const fields = ['access_level','is_active'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      if (!updates.length) { await conn.rollback(); await conn.release(); return res.status(400).json({ error: 'No fields to update' }); }
      values.push(id);
      await conn.query(`UPDATE staff_branch_access SET ${updates.join(', ')} WHERE access_id = ?`, values);

      const [afterRows] = await conn.query('SELECT * FROM staff_branch_access WHERE access_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id: actor_id, table_name: 'staff_branch_access', operation_type: 'UPDATE', record_id: id, ip_address: ip, old_values: before, new_values: afterRows[0] });
      res.json(afterRows[0]);
    } catch (e) {
      try { await conn.rollback(); } catch {}
      try { await conn.release(); } catch {}
      next(e);
    }
  }
);

router.delete('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  const actor_id = getStaffId(req), ip = getIp(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = Number(req.params.id);
    const [beforeRows] = await conn.query('SELECT * FROM staff_branch_access WHERE access_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Access record not found' }); }
    await conn.query('DELETE FROM staff_branch_access WHERE access_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id: actor_id, table_name: 'staff_branch_access', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
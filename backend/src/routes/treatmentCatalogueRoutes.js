const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM treatment_catalogue WHERE is_active IS NULL OR is_active = 1 ORDER BY treatment_type_id DESC');
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/',
  body('treatment_name').isLength({ min: 1, max: 25 }),
  body('description').optional({ nullable: true }).isString(),
  body('icd10_code').optional({ nullable: true }).isLength({ max: 7 }),
  body('cpt_code').optional({ nullable: true }).isLength({ max: 5 }),
  body('standard_cost').optional({ nullable: true }).isFloat({ min: 0 }),
  body('category').optional({ nullable: true }).isLength({ max: 25 }),
  body('is_active').optional({ nullable: true }).isInt({ min: 0, max: 1 }).toInt(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    try {
      const {
        treatment_name, description = null, icd10_code = null, cpt_code = null,
        standard_cost = null, category = null, is_active = 1
      } = req.body;
      const [result] = await pool.query(
        `INSERT INTO treatment_catalogue
         (treatment_name, description, icd10_code, cpt_code, standard_cost, category, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [treatment_name, description, icd10_code, cpt_code, standard_cost, category, is_active]
      );
      const [rows] = await pool.query('SELECT * FROM treatment_catalogue WHERE treatment_type_id = ?', [result.insertId]);
      await logAudit({ staff_id, table_name: 'treatment_catalogue', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  }
);

router.put('/:id',
  param('id').isInt().toInt(),
  body('treatment_name').optional().isLength({ min: 1, max: 25 }),
  body('description').optional({ nullable: true }).isString(),
  body('icd10_code').optional({ nullable: true }).isLength({ max: 7 }),
  body('cpt_code').optional({ nullable: true }).isLength({ max: 5 }),
  body('standard_cost').optional({ nullable: true }).isFloat({ min: 0 }),
  body('category').optional({ nullable: true }).isLength({ max: 25 }),
  body('is_active').optional({ nullable: true }).isInt({ min: 0, max: 1 }).toInt(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id = Number(req.params.id);
      const [beforeRows] = await conn.query('SELECT * FROM treatment_catalogue WHERE treatment_type_id = ?', [id]);
      if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Treatment type not found' }); }
      const before = beforeRows[0];

      const fields = ['treatment_name','description','icd10_code','cpt_code','standard_cost','category','is_active'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      if (!updates.length) { await conn.rollback(); await conn.release(); return res.status(400).json({ error: 'No fields to update' }); }
      values.push(id);
      await conn.query(`UPDATE treatment_catalogue SET ${updates.join(', ')} WHERE treatment_type_id = ?`, values);

      const [afterRows] = await conn.query('SELECT * FROM treatment_catalogue WHERE treatment_type_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'treatment_catalogue', operation_type: 'UPDATE', record_id: id, ip_address: ip, old_values: before, new_values: afterRows[0] });
      res.json(afterRows[0]);
    } catch (e) {
      try { await conn.rollback(); } catch {}
      try { await conn.release(); } catch {}
      next(e);
    }
  }
);

router.delete('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  const staff_id = getStaffId(req), ip = getIp(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = Number(req.params.id);
    const [beforeRows] = await conn.query('SELECT * FROM treatment_catalogue WHERE treatment_type_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Treatment type not found' }); }
    await conn.query('DELETE FROM treatment_catalogue WHERE treatment_type_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'treatment_catalogue', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
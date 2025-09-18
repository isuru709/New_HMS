const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

// List
router.get('/',
  query('invoice_id').optional().isInt().toInt(),
  async (req, res, next) => {
    try {
      const filters = [], values = [];
      if (req.query.invoice_id) { filters.push('invoice_id = ?'); values.push(req.query.invoice_id); }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const [rows] = await pool.query(`SELECT * FROM payment ${where} ORDER BY payment_id DESC`, values);
      res.json(rows);
    } catch (e) { next(e); }
  }
);

// Create (updates invoice status)
router.post('/',
  body('invoice_id').isInt().toInt(),
  body('amount').isFloat({ min: 0 }),
  body('payment_method').isIn(['Cash','Card','Insurance','Online']),
  body('transaction_reference').optional({ nullable: true }).isLength({ max: 25 }),
  body('status').optional({ nullable: true }).isIn(['Pending','Paid','Cancelled']),
  body('notes').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { invoice_id, amount, payment_method, transaction_reference = null, status = 'Paid', notes = null } = req.body;

      const [invRows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [invoice_id]);
      if (!invRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Invoice not found' }); }
      const invoice = invRows[0];

      const [result] = await conn.query(
        `INSERT INTO payment (invoice_id, payment_date, amount, payment_method, transaction_reference, status, notes)
         VALUES (?, NOW(), ?, ?, ?, ?, ?)`,
        [invoice_id, amount, payment_method, transaction_reference, status, notes]
      );

      // recompute invoice status
      const [sumRows] = await conn.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment WHERE invoice_id = ? AND status IN ("Paid")', [invoice_id]);
      const paid = Number(sumRows[0].paid || 0);
      const newStatus = paid >= Number(invoice.patient_amount || 0) ? 'Paid' : 'Pending';
      await conn.query('UPDATE invoice SET status = ? WHERE invoice_id = ?', [newStatus, invoice_id]);

      const [rows] = await conn.query('SELECT * FROM payment WHERE payment_id = ?', [result.insertId]);
      await conn.commit(); await conn.release();

      await logAudit({ staff_id, table_name: 'payment', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) {
      try { await conn.rollback(); } catch {}
      try { await conn.release(); } catch {}
      next(e);
    }
  }
);

// Delete payment
router.delete('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  const staff_id = getStaffId(req), ip = getIp(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = Number(req.params.id);
    const [beforeRows] = await conn.query('SELECT * FROM payment WHERE payment_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Payment not found' }); }
    const invoice_id = beforeRows[0].invoice_id;
    await conn.query('DELETE FROM payment WHERE payment_id = ?', [id]);

    // Recompute invoice status after delete
    const [invRows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [invoice_id]);
    if (invRows.length) {
      const invoice = invRows[0];
      const [sumRows] = await conn.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment WHERE invoice_id = ? AND status IN ("Paid")', [invoice_id]);
      const paid = Number(sumRows[0].paid || 0);
      const newStatus = paid >= Number(invoice.patient_amount || 0) ? 'Paid' : 'Pending';
      await conn.query('UPDATE invoice SET status = ? WHERE invoice_id = ?', [newStatus, invoice_id]);
    }

    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'payment', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
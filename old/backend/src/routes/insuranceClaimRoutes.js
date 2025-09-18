const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');
const { logAudit, getStaffId, getIp } = require('../utils/audit');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

// List (basic)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT ic.*, i.total_amount, i.insurance_amount, p.first_name, p.last_name
         FROM insurance_claim ic
         LEFT JOIN invoice i ON ic.invoice_id = i.invoice_id
         LEFT JOIN patient p ON i.patient_id = p.patient_id
         ORDER BY ic.claim_id DESC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Get
router.get('/:id', param('id').isInt().toInt(), async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM insurance_claim WHERE claim_id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Claim not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Create (defaults: claim_amount from invoice.insurance_amount)
router.post('/',
  body('invoice_id').isInt().toInt(),
  body('policy_id').optional({ nullable: true }).isInt().toInt(),
  body('claim_amount').optional({ nullable: true }).isFloat({ min: 0 }),
  body('submission_date').optional({ nullable: true }).isISO8601(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { invoice_id, policy_id = null, claim_amount = null, submission_date = null } = req.body;
      const [invRows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [invoice_id]);
      if (!invRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Invoice not found' }); }
      const invoice = invRows[0];
      const amount = claim_amount != null ? Number(claim_amount) : Number(invoice.insurance_amount || 0);

      const [result] = await conn.query(
        `INSERT INTO insurance_claim (invoice_id, policy_id, claim_amount, submission_date, claim_status, reimbursement_amount, denial_reason, created_at)
         VALUES (?, ?, ?, ?, 'Submitted', NULL, NULL, NOW())`,
        [invoice_id, policy_id, amount, submission_date]
      );
      const [rows] = await conn.query('SELECT * FROM insurance_claim WHERE claim_id = ?', [result.insertId]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'insurance_claim', operation_type: 'INSERT', record_id: result.insertId, ip_address: ip, new_values: rows[0] });
      res.status(201).json(rows[0]);
    } catch (e) {
      try { await conn.rollback(); } catch {}
      try { await conn.release(); } catch {}
      next(e);
    }
  }
);

// Update status (auto create Payment on Approved)
router.put('/:id',
  param('id').isInt().toInt(),
  body('claim_status').optional().isIn(['Submitted','Approved','Rejected']),
  body('reimbursement_amount').optional({ nullable: true }).isFloat({ min: 0 }),
  body('denial_reason').optional({ nullable: true }).isString(),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    const staff_id = getStaffId(req), ip = getIp(req);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const id = Number(req.params.id);
      const [beforeRows] = await conn.query('SELECT * FROM insurance_claim WHERE claim_id = ?', [id]);
      if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Claim not found' }); }
      const before = beforeRows[0];

      const fields = ['claim_status','reimbursement_amount','denial_reason'];
      const updates = [], values = [];
      fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
      if (!updates.length) { await conn.rollback(); await conn.release(); return res.status(400).json({ error: 'No fields to update' }); }
      values.push(id);
      await conn.query(`UPDATE insurance_claim SET ${updates.join(', ')} WHERE claim_id = ?`, values);

      // If approved with reimbursement, record a payment
      if (req.body.claim_status === 'Approved' && req.body.reimbursement_amount != null) {
        const reimbursement = Number(req.body.reimbursement_amount);
        const invoice_id = before.invoice_id;
        await conn.query(
          `INSERT INTO payment (invoice_id, payment_date, amount, payment_method, transaction_reference, status, notes)
           VALUES (?, NOW(), ?, 'Insurance', ?, 'Paid', 'Auto-created from approved insurance claim')`,
          [invoice_id, reimbursement, `CLAIM-${id}`]
        );
        // Update invoice status
        const [invRows] = await conn.query('SELECT * FROM invoice WHERE invoice_id = ?', [invoice_id]);
        const invoice = invRows[0];
        const [sumRows] = await conn.query('SELECT COALESCE(SUM(amount),0) AS paid FROM payment WHERE invoice_id = ? AND status IN ("Paid")', [invoice_id]);
        const paid = Number(sumRows[0].paid || 0);
        const newStatus = paid >= Number(invoice.patient_amount || 0) ? 'Paid' : 'Pending';
        await conn.query('UPDATE invoice SET status = ? WHERE invoice_id = ?', [newStatus, invoice_id]);
      }

      const [afterRows] = await conn.query('SELECT * FROM insurance_claim WHERE claim_id = ?', [id]);
      await conn.commit(); await conn.release();
      await logAudit({ staff_id, table_name: 'insurance_claim', operation_type: 'UPDATE', record_id: id, ip_address: ip, old_values: before, new_values: afterRows[0] });
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
    const [beforeRows] = await conn.query('SELECT * FROM insurance_claim WHERE claim_id = ?', [id]);
    if (!beforeRows.length) { await conn.rollback(); await conn.release(); return res.status(404).json({ error: 'Claim not found' }); }
    await conn.query('DELETE FROM insurance_claim WHERE claim_id = ?', [id]);
    await conn.commit(); await conn.release();
    await logAudit({ staff_id, table_name: 'insurance_claim', operation_type: 'DELETE', record_id: id, ip_address: ip, old_values: beforeRows[0] });
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    try { await conn.release(); } catch {}
    next(e);
  }
});

module.exports = router;
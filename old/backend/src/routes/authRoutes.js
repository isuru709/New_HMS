const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');

const router = express.Router();
const ok = (req, res) => { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; };

router.post('/login',
  body('email').isEmail(),
  body('password').isString().isLength({ min: 6 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    try {
      const { email, password } = req.body;
      const [rows] = await pool.query('SELECT * FROM staff WHERE email = ? LIMIT 1', [email]);
      if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
      const staff = rows[0];
      const valid = await bcrypt.compare(password, staff.password);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      const session_id = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO user_session (session_id, staff_id, login_time, ip_address, status, last_activity)
         VALUES (?, ?, NOW(), ?, 'Active', NOW())`,
        [session_id, staff.staff_id, req.ip]
      );

      res.json({
        session_id,
        staff: {
          staff_id: staff.staff_id,
          first_name: staff.first_name,
          last_name: staff.last_name,
          role: staff.role,
          email: staff.email,
          branch_id: staff.branch_id,
          is_active: staff.is_active
        }
      });
    } catch (e) { next(e); }
  }
);

router.post('/logout', async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(400).json({ error: 'No session token' });
    await pool.query(`UPDATE user_session SET status='Expired', logout_time=NOW() WHERE session_id = ?`, [token]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(200).json({ user: null });
  res.json({ user: req.user });
});

module.exports = router;
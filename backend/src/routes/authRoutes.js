const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');

const router = express.Router();

const ok = (req, res) => {
  const e = validationResult(req);
  if (!e.isEmpty()) {
    res.status(400).json({ errors: e.array() });
    return false;
  }
  return true;
};

function getIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (Array.isArray(xfwd)) return xfwd[0];
  if (typeof xfwd === 'string' && xfwd.length) return xfwd.split(',')[0].trim();
  return req.ip || null;
}

// Accept username or email; default admin login is username=admin, password=admin
router.post(
  '/login',
  body('password').isString().isLength({ min: 3 }),
  async (req, res, next) => {
    if (!ok(req, res)) return;
    try {
      const { email, username, password } = req.body;

      // Map username to an email if needed (e.g., admin -> admin@hospitalos.local)
      let loginEmail = email;
      if (!loginEmail) {
        if (!username) return res.status(400).json({ error: 'email or username is required' });
        loginEmail = username.includes('@') ? username : `${username}@hospitalos.local`;
      }

      const [rows] = await pool.query('SELECT * FROM staff WHERE email = ? LIMIT 1', [loginEmail]);
      if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

      const staff = rows[0];
      const valid = await bcrypt.compare(password, staff.password);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      const session_id = crypto.randomBytes(32).toString('hex');
      const ip = getIp(req);

      // IMPORTANT: include logout_time explicitly as NULL to satisfy strict sql modes or NOT NULL constraints
      await pool.query(
        `INSERT INTO user_session (session_id, staff_id, login_time, logout_time, ip_address, status, last_activity)
         VALUES (?, ?, NOW(), NULL, ?, 'Active', NOW())`,
        [session_id, staff.staff_id, ip]
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
    } catch (e) {
      next(e);
    }
  }
);

router.post('/logout', async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(400).json({ error: 'No session token' });
    await pool.query(
      `UPDATE user_session SET status='Expired', logout_time=NOW(), last_activity=NOW() WHERE session_id = ?`,
      [token]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.json({ user: null });

    const [rows] = await pool.query(
      `SELECT us.session_id, us.status, s.staff_id, s.role, s.first_name, s.last_name, s.email
         FROM user_session us
         LEFT JOIN staff s ON us.staff_id = s.staff_id
        WHERE us.session_id = ? AND us.status = 'Active'
        LIMIT 1`,
      [token]
    );

    if (!rows.length) return res.json({ user: null });
    const u = rows[0];
    res.json({
      user: {
        session_id: u.session_id,
        staff_id: u.staff_id,
        role: u.role,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email
      }
    });
  } catch {
    res.json({ user: null });
  }
});

module.exports = router;
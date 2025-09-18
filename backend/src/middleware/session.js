const { pool } = require('../db');

// Optional session middleware
// - Reads Authorization: Bearer <session_id>
// - If valid & Active, attaches req.user = { staff_id, role, first_name, last_name, email }
// - Does NOT block anonymous requests (flip REQUIRE_AUTH to true to enforce)
const REQUIRE_AUTH = false;

async function optionalSession(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) {
      const [rows] = await pool.query(
        `SELECT us.session_id, us.status, s.staff_id, s.role, s.first_name, s.last_name, s.email
           FROM user_session us
           LEFT JOIN staff s ON us.staff_id = s.staff_id
          WHERE us.session_id = ? AND us.status = 'Active'
          LIMIT 1`,
        [token]
      );
      if (rows.length) {
        const s = rows[0];
        req.user = {
          session_id: s.session_id,
          staff_id: s.staff_id,
          role: s.role,
          first_name: s.first_name,
          last_name: s.last_name,
          email: s.email
        };
      }
    }
    if (REQUIRE_AUTH && !req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { optionalSession };
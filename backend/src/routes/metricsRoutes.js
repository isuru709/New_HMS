const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/overview', async (req, res, next) => {
  try {
    const [
      [patientCountRows],
      [apptTodayRows],
      [activeDoctorsRows],
      [avgCoverageRows],
      [revenueRows]
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM patient'),
      pool.query(`SELECT status, COUNT(*) AS count FROM appointment WHERE appointment_date = CURDATE() GROUP BY status`),
      pool.query(`SELECT COUNT(*) AS count FROM staff WHERE role='Doctor' AND (is_active = 1 OR is_active IS NULL)`),
      pool.query(`SELECT ROUND(COALESCE(AVG(coverage_percentage),0),0) AS avg FROM insurance_policy WHERE is_active = 1`),
      pool.query(`SELECT DATE(payment_date) AS day, SUM(amount) AS amount FROM payment WHERE status='Paid' AND payment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY DATE(payment_date) ORDER BY day`)
    ]);

    const appointmentToday = apptTodayRows.reduce((acc, r) => (acc[r.status] = Number(r.count), acc), {});
    res.json({
      patients: Number(patientCountRows[0].count || 0),
      appointments_today: appointmentToday, // { Scheduled, Completed, Cancelled }
      active_doctors: Number(activeDoctorsRows[0].count || 0),
      avg_insurance_coverage: Number(avgCoverageRows[0].avg || 0),
      revenue_last_30_days: revenueRows.map(r => ({ day: r.day, amount: Number(r.amount || 0) }))
    });
  } catch (e) { next(e); }
});

module.exports = router;
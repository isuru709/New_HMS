require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { optionalSession } = require('./middleware/session');
const { seedDefaults } = require('./seed');

// Routes
const branchRoutes = require('./routes/branchRoutes');
const patientRoutes = require('./routes/patientRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const staffRoutes = require('./routes/staffRoutes');
const insurancePolicyRoutes = require('./routes/insurancePolicyRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const insuranceClaimRoutes = require('./routes/insuranceClaimRoutes');
const treatmentCatalogueRoutes = require('./routes/treatmentCatalogueRoutes');
const treatmentRoutes = require('./routes/treatmentRoutes');
const staffBranchAccessRoutes = require('./routes/staffBranchAccessRoutes');
const metricsRoutes = require('./routes/metricsRoutes');
const authRoutes = require('./routes/authRoutes');

async function start() {
  await seedDefaults();

  const app = express();

  // Security & basics
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan('dev'));

  // Rate limiting
  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
  app.use('/api', apiLimiter);

  // Optional session parsing
  app.use(optionalSession);

  // Health
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'HMS API', time: new Date().toISOString() });
  });

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/branches', branchRoutes);
  app.use('/api/patients', patientRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/insurance-policies', insurancePolicyRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/insurance-claims', insuranceClaimRoutes);
  app.use('/api/treatment-catalogue', treatmentCatalogueRoutes);
  app.use('/api/treatments', treatmentRoutes);
  app.use('/api/staff-branch-access', staffBranchAccessRoutes);
  app.use('/api/metrics', metricsRoutes);

  // 404
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Error:', err);
    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ error: 'Foreign key constraint failed', details: err.sqlMessage });
    }
    res.status(500).json({ error: 'Internal Server Error', details: err.message || 'Something went wrong' });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`API running at http://localhost:${PORT}`));
}

start().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
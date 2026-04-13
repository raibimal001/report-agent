require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { extractFromImage, extractReconciliationData } = require('./extractor');
const { formatWhatsAppReport, generateSummary }       = require('./formatter');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Multer: receipt (1) + reconciliation (up to 5) ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${file.fieldname}-${suffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ok = ['image/jpeg','image/png','image/gif','image/webp'];
  ok.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Only image files are allowed (JPG PNG GIF WEBP)'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).fields([
  { name: 'receipt',        maxCount: 1 },
  { name: 'reconciliation', maxCount: 5 }
]);

// ── Helper: delete an array of file paths ────
function cleanupFiles(paths) {
  (paths || []).forEach(p => {
    if (fs.existsSync(p)) fs.unlink(p, () => {});
  });
}

// ── Health check ─────────────────────────────
app.get('/api/health', (req, res) => {
  const configured = !!process.env.ANTHROPIC_API_KEY &&
                     process.env.ANTHROPIC_API_KEY !== 'your_claude_api_key_here';
  res.json({
    status: 'ok',
    apiKeyConfigured: configured,
    message: configured ? 'System ready' : 'Set ANTHROPIC_API_KEY in .env'
  });
});

// ── Main extraction endpoint ─────────────────
app.post('/api/extract', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    const receiptFiles = req.files?.receipt        || [];
    const reconFiles   = req.files?.reconciliation || [];

    if (receiptFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No X-report receipt image uploaded.'
      });
    }

    const receiptPath = receiptFiles[0].path;
    const reconPaths  = reconFiles.map(f => f.path);
    const allPaths    = [receiptPath, ...reconPaths];

    try {
      console.log(`\n[Server] Receipt: ${receiptFiles[0].originalname}`);
      console.log(`[Server] Reconciliation images: ${reconFiles.length}`);

      // 1. Extract X-report data
      const xData = await extractFromImage(receiptPath);

      // 2. Extract & reconcile recon images
      const reconData = await extractReconciliationData(reconPaths);

      // 3. Calculate variance
      const variance = parseFloat(
        (reconData.reconciliation_total - xData.marn_pos_sales).toFixed(2)
      );

      // 4. Format WhatsApp report
      const whatsappReport = formatWhatsAppReport(xData, reconData);

      // 5. Generate UI summary
      const summary = generateSummary(xData, reconData);

      // 6. Cleanup temp files
      cleanupFiles(allPaths);

      console.log(`[Server] Done — Variance: ${variance}`);

      res.json({
        success: true,
        xData,
        reconData,
        variance,
        summary,
        whatsappReport
      });

    } catch (error) {
      console.error('[Server] Error:', error.message);
      cleanupFiles(allPaths);

      if (error.status === 401 || error.message.includes('API key')) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or missing Claude API key. Check your .env file.'
        });
      }

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to process image. Please try again.'
      });
    }
  });
});

// ── Network IP helper ─────────────────────────
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'unknown';
}

// ── Start ─────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     📊 Report Agent - Server Ready      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n💻 PC Browser:    http://localhost:${PORT}`);
  console.log(`📱 Phone/Tablet:  http://${ip}:${PORT}`);

  const ok = !!process.env.ANTHROPIC_API_KEY &&
             process.env.ANTHROPIC_API_KEY !== 'your_claude_api_key_here';
  console.log(ok ? '\n✅ Claude API key: Configured' : '\n⚠️  Claude API key: NOT SET');
  console.log('\n📌 Both devices must be on the same WiFi');
  console.log('📌 Press Ctrl+C to stop the server\n');
});

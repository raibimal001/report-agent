require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { extractFromImage } = require('./extractor');
const { formatWhatsAppReport, generateSummary } = require('./formatter');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'receipt-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (JPG, PNG, GIF, WEBP)'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Health check
app.get('/api/health', (req, res) => {
  const apiKeySet = !!process.env.ANTHROPIC_API_KEY && 
                    process.env.ANTHROPIC_API_KEY !== 'your_claude_api_key_here';
  res.json({ 
    status: 'ok', 
    apiKeyConfigured: apiKeySet,
    message: apiKeySet ? 'System ready' : 'Please set your ANTHROPIC_API_KEY in the .env file'
  });
});

// Main extraction endpoint
app.post('/api/extract', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ 
      success: false, 
      error: 'No image file uploaded. Please select a receipt image.' 
    });
  }

  const imagePath = req.file.path;

  try {
    console.log(`\n[Server] Processing receipt: ${req.file.originalname}`);
    console.log(`[Server] Saved to: ${imagePath}`);

    // Extract data using Claude Vision
    const extractedData = await extractFromImage(imagePath);

    // Format WhatsApp report
    const whatsappReport = formatWhatsAppReport(extractedData);

    // Generate UI summary
    const summary = generateSummary(extractedData);

    // Clean up uploaded file after processing
    fs.unlink(imagePath, (err) => {
      if (err) console.warn('[Server] Could not delete temp file:', err.message);
    });

    console.log('[Server] Report generated successfully');

    res.json({
      success: true,
      data: extractedData,
      summary,
      whatsappReport
    });

  } catch (error) {
    console.error('[Server] Processing error:', error.message);

    // Clean up uploaded file on error
    if (fs.existsSync(imagePath)) {
      fs.unlink(imagePath, () => {});
    }

    // Check for API key issues
    if (error.message.includes('API key') || error.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or missing Claude API key. Please check your .env file.'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process the receipt image. Please try again.'
    });
  }
});

// Start server
const os = require('os');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'unknown';
}

app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     📊 Report Agent - Server Ready      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n💻 PC Browser:    http://localhost:${PORT}`);
  console.log(`📱 Phone/Tablet:  http://${localIP}:${PORT}`);
  
  const apiKeySet = !!process.env.ANTHROPIC_API_KEY && 
                    process.env.ANTHROPIC_API_KEY !== 'your_claude_api_key_here';
  
  if (apiKeySet) {
    console.log('\n✅ Claude API key: Configured');
  } else {
    console.log('\n⚠️  Claude API key: NOT SET — Open .env and add your key!');
  }
  
  console.log('\n📌 Both devices must be on the same WiFi');
  console.log('📌 Press Ctrl+C to stop the server\n');
});

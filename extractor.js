require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// X-REPORT EXTRACTION
// ─────────────────────────────────────────────
const XREPORT_PROMPT = `You are an expert at reading POS (Point of Sale) X-Report receipts.
Analyze this receipt image carefully and extract the fields below.
Return ONLY a valid JSON object — no markdown, no code blocks, no extra text.

{
  "branch": "branch code or store identifier near the top (e.g. KAFD-SNB-1079)",
  "date": "date in DD-MM-YYYY format from the printed date on the receipt",
  "time": "time printed on receipt",
  "cashier": "cashier or user name on the receipt",
  "total_sales": the total gross sales amount as a number (no currency symbols),
  "total_orders": the total number of orders/transactions as a number,
  "cash_amount": the cash payment total as a number (0 if not present),
  "card_amount": the card payment total as a number (0 if not present) — THIS IS THE MARN POS SALES VALUE. Look for lines labeled 'Card', 'CARD', 'Credit Card', 'Visa', 'Mada', 'Card Sales', or any card/digital payment method. It may show a percentage like (100%) next to the amount. This is the most critical field to extract accurately,
  "net_sales": the net sales amount as a number,
  "sales_tax": the sales tax amount as a number,
  "total_discount": the total discount amount as a number (0 if none),
  "total_refund": the total refund amount as a number (0 if none),
  "total_void": the total void amount as a number (0 if none),
  "complimentary": the complimentary total as a number (0 if none),
  "dine_in_sales": dine-in sales amount as a number (0 if none),
  "takeaway_sales": takeaway/delivery sales as a number (0 if none),
  "employee_meals": employee meals amount as a number (0 if none)
}

Rules:
- All values must be numbers (not strings)
- Use 0 for any field not visible or shown as 0/blank
- Do NOT include currency symbols
- card_amount is THE MOST IMPORTANT FIELD — it represents MARN POS Sales (card/digital payments only, not cash)`;

// ─────────────────────────────────────────────
// RECONCILIATION EXTRACTION
// ─────────────────────────────────────────────
const RECONCILIATION_PROMPT = `You are an expert at reading POS reconciliation reports, settlement reports, or card transaction summaries.
Analyze this image carefully. Your goal is to extract the TOTAL POS SALES value shown in this reconciliation document.

Return ONLY a valid JSON object — no markdown, no code blocks, no extra text.

{
  "source_label": "a short label describing what this document is (e.g. 'POS Reconciliation Report', 'Card Settlement', 'Daily Recon')",
  "pos_sales": the total POS sales amount shown in this document as a number — look for fields labeled 'POS Sales', 'Total Sales', 'Net Sales', 'Settlement Amount', 'Total Amount', 'Grand Total', or similar. This is the main total of the reconciliation. If multiple totals exist, pick the one most clearly labeled as the overall POS or card total,
  "reference": "any reference number, batch number, or document ID shown (null if not present)",
  "date": "date shown on this document in any format (null if not present)",
  "individual_transactions": [
    {
      "id": "transaction ID or reference if visible, else null",
      "amount": the transaction amount as a number,
      "time": "time if visible, else null",
      "description": "description or label if visible, else null"
    }
  ],
  "reported_total": the total/grand total stated in the document as a number (same as pos_sales if only one total exists, 0 if not shown)
}

Rules:
- pos_sales is the MOST CRITICAL field — this is what will be used as the reconciliation amount
- If the document shows only a grand total (no individual breakdown), set pos_sales to that total and leave individual_transactions as an empty array
- If individual transactions are listed, extract them AND set pos_sales to the document's stated total (not a sum you calculate)
- All amounts must be numbers (no currency symbols)
- Be thorough and precise — accuracy here determines the variance calculation`;

// ─────────────────────────────────────────────
// HELPER: Load image as base64
// ─────────────────────────────────────────────
function loadImage(imagePath) {
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mediaTypeMap = {
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.gif':  'image/gif',
    '.webp': 'image/webp'
  };
  return {
    base64,
    mediaType: mediaTypeMap[ext] || 'image/jpeg'
  };
}

// ─────────────────────────────────────────────
// HELPER: Call Claude with an image + prompt
// ─────────────────────────────────────────────
async function callClaude(imagePath, prompt) {
  const { base64, mediaType } = loadImage(imagePath);

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 }
        },
        { type: 'text', text: prompt }
      ]
    }]
  });

  const raw = response.content[0].text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no valid JSON. Please try again.');
  return JSON.parse(match[0]);
}

// ─────────────────────────────────────────────
// MAIN: Extract X-Report
// ─────────────────────────────────────────────
async function extractFromImage(imagePath) {
  console.log(`[Extractor] Processing X-report: ${path.basename(imagePath)}`);

  const data = await callClaude(imagePath, XREPORT_PROMPT);

  const totalSales   = parseFloat(data.total_sales)   || 0;
  const totalOrders  = parseFloat(data.total_orders)  || 0;
  const cardAmount   = parseFloat(data.card_amount)   || 0;
  const averageOrder = totalOrders > 0 ? (totalSales / totalOrders).toFixed(2) : '0.00';

  const enriched = {
    branch:          data.branch        || 'N/A',
    date:            data.date          || 'N/A',
    time:            data.time          || 'N/A',
    cashier:         data.cashier       || 'N/A',
    total_sales:     totalSales,
    total_orders:    totalOrders,
    cash_amount:     parseFloat(data.cash_amount)    || 0,
    card_amount:     cardAmount,
    net_sales:       parseFloat(data.net_sales)      || 0,
    sales_tax:       parseFloat(data.sales_tax)      || 0,
    total_discount:  parseFloat(data.total_discount) || 0,
    total_refund:    parseFloat(data.total_refund)   || 0,
    total_void:      parseFloat(data.total_void)     || 0,
    complimentary:   parseFloat(data.complimentary)  || 0,
    dine_in_sales:   parseFloat(data.dine_in_sales)  || 0,
    takeaway_sales:  parseFloat(data.takeaway_sales) || 0,
    employee_meals:  parseFloat(data.employee_meals) || 0,
    // Calculated
    average_order:   averageOrder,
    // MARN POS Sales = Card amount from X-report (card/digital payment total)
    marn_pos_sales:  cardAmount
  };

  console.log(`[Extractor] X-report OK — Card (MARN POS): ${cardAmount}, Gross Sales: ${totalSales}`);
  return enriched;
}

// ─────────────────────────────────────────────
// MAIN: Extract & reconcile multiple recon images
// ─────────────────────────────────────────────
async function extractReconciliationData(imagePaths) {
  if (!imagePaths || imagePaths.length === 0) {
    return {
      reconciliation_total: 0,
      pos_sales_total: 0,
      images: [],
      duplicates: [],
      duplicate_count: 0,
      unique_transactions: [],
      all_transactions: []
    };
  }

  console.log(`[Extractor] Processing ${imagePaths.length} reconciliation image(s)...`);

  const allResults = [];

  // Extract from each image
  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i];
    console.log(`[Extractor] Recon image ${i + 1}/${imagePaths.length}: ${path.basename(imgPath)}`);
    try {
      const result = await callClaude(imgPath, RECONCILIATION_PROMPT);

      // Extract the primary POS Sales value from this image
      const posSales = parseFloat(result.pos_sales) || parseFloat(result.reported_total) || 0;

      // Normalize any individual transactions listed
      const transactions = (result.individual_transactions || []).map((t, idx) => ({
        image_index:  i,
        image_label:  result.source_label || `Image ${i + 1}`,
        tx_index:     idx,
        id:           t.id   || null,
        amount:       parseFloat(t.amount) || 0,
        time:         t.time || null,
        description:  t.description || null
      }));

      allResults.push({
        image_index:    i,
        source_label:   result.source_label || `Reconciliation ${i + 1}`,
        pos_sales:      posSales,
        reference:      result.reference    || null,
        date:           result.date         || null,
        transactions,
        reported_total: parseFloat(result.reported_total) || posSales
      });

    } catch (err) {
      console.error(`[Extractor] Failed on recon image ${i + 1}:`, err.message);
      allResults.push({
        image_index:    i,
        source_label:   `Image ${i + 1}`,
        pos_sales:      0,
        reference:      null,
        date:           null,
        transactions:   [],
        reported_total: 0,
        error:          err.message
      });
    }
  }

  // ── Duplicate detection on POS Sales values across images ────────────────
  // If two images report the exact same POS sales amount AND have matching
  // reference/date clues, treat the second as a duplicate.
  // Strategy: deduplicate on {pos_sales + reference} or {pos_sales + date}
  const seenPosSales = new Map();
  const uniqueImages = [];
  const duplicateImages = [];

  for (const img of allResults) {
    // Build a dedup key
    let key;
    if (img.reference && img.reference !== null) {
      key = `ref:${String(img.reference).trim().toLowerCase()}`;
    } else if (img.date && img.pos_sales > 0) {
      key = `date:${img.date}|amt:${img.pos_sales}`;
    } else {
      // No good identifier — treat as unique (different recon pages)
      key = `img:${img.image_index}|amt:${img.pos_sales}`;
    }

    if (seenPosSales.has(key)) {
      duplicateImages.push({ ...img, duplicate_of: key });
      console.log(`[Extractor] Duplicate recon image detected: Image ${img.image_index + 1} (key: ${key})`);
    } else {
      seenPosSales.set(key, img);
      uniqueImages.push(img);
    }
  }

  // Sum POS Sales from unique images only
  const pos_sales_total = uniqueImages.reduce((sum, img) => sum + img.pos_sales, 0);

  // ── Also combine individual transactions (for UI detail view) ──────────
  const allTransactions = allResults.flatMap(r => r.transactions);

  // Dedup individual transactions
  const seenTx = new Map();
  const uniqueTx = [];
  const duplicateTx = [];

  for (const tx of allTransactions) {
    let key;
    if (tx.id) {
      key = `id:${tx.id.toString().trim()}`;
    } else if (tx.time) {
      key = `amt:${tx.amount}|time:${tx.time}`;
    } else {
      key = `img:${tx.image_index}|idx:${tx.tx_index}|amt:${tx.amount}`;
    }

    if (seenTx.has(key)) {
      duplicateTx.push({ ...tx, duplicate_of: key });
    } else {
      seenTx.set(key, tx);
      uniqueTx.push(tx);
    }
  }

  // Combined duplicate count = duplicate images + duplicate transactions
  const duplicateCount = duplicateImages.length + duplicateTx.length;

  console.log(`[Extractor] Recon — Images: ${allResults.length}, Unique: ${uniqueImages.length}, Duplicate images: ${duplicateImages.length}`);
  console.log(`[Extractor] Recon — POS Sales Total (unique): ${pos_sales_total.toFixed(2)}`);

  return {
    reconciliation_total: parseFloat(pos_sales_total.toFixed(2)),
    pos_sales_total:      parseFloat(pos_sales_total.toFixed(2)),
    images:               allResults,
    unique_images:        uniqueImages,
    duplicate_images:     duplicateImages,
    all_transactions:     allTransactions,
    unique_transactions:  uniqueTx,
    duplicates:           [...duplicateImages, ...duplicateTx],
    duplicate_count:      duplicateCount
  };
}

module.exports = { extractFromImage, extractReconciliationData };

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
  "coupon": the coupon/voucher discount total as a number — look for lines labeled 'Coupon', 'Coupon Discount', 'Voucher', 'Promo Code', 'Coupon Value', or similar. This is the total value of all coupons/vouchers redeemed (0 if none),
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
- card_amount is THE MOST IMPORTANT FIELD — it represents MARN POS Sales (card/digital payments only, not cash)
- coupon is the total value of coupons/vouchers redeemed, not a count`;

// ─────────────────────────────────────────────
// RECONCILIATION EXTRACTION — COMPREHENSIVE
// ─────────────────────────────────────────────
const RECONCILIATION_PROMPT = `You are an expert at reading POS reconciliation/settlement receipts and card terminal reports.
This image may show one or more settlement sections side by side (e.g. two columns or two receipts photographed together).

Your task:
1. Find EVERY payment method section in the image (Mada, Visa, Credit, Debit, Maestro, STC Pay, Apple Pay, UnionPay, Discover, GCCNET, AMEX, etc.)
2. For EACH payment method section, extract the transaction count and total amount
3. Some sections may say "No Transactions" — record them with count=0 and amount=0
4. Find the overall document total if printed (often labeled "NET", "Grand Total", "Total", or similar)
5. Extract document metadata (date, reference/batch number, branch/terminal)

Return ONLY a valid JSON object — no markdown, no code blocks, no extra text:

{
  "source_label": "brief description of document type (e.g. 'POS Settlement Report', 'Card Recon Receipt')",
  "branch": "branch name or terminal ID if visible (null if not)",
  "date": "date shown on this document in DD/MM/YYYY or as printed (null if not present)",
  "reference": "batch number, reference number, or document ID (null if not present)",
  "payment_rows": [
    {
      "method": "payment method name (e.g. 'Mada', 'Visa', 'Credit', 'Debit', 'Maestro', 'STC Pay', 'Apple Pay')",
      "count": transaction count as a number (0 if no transactions or not shown),
      "amount": total amount for this method as a number (0 if no transactions),
      "has_transactions": true if this method has actual transactions, false if 'No Transactions'
    }
  ],
  "reported_total": the grand total / net total stated in the document as a number (0 if not explicitly printed),
  "anomaly_notes": "any observations about suspicious values, mismatched totals, or unusual entries (null if everything looks normal)"
}

Rules:
- Extract EVERY payment method you see, even those with 0 transactions
- payment_rows MUST be a complete list — do not skip any method
- amounts are numbers only (no currency symbols, no commas)
- If the image shows two separate receipt sections next to each other, treat ALL rows from both sections as part of one unified list (they are from the same terminal session)
- reported_total is what the document itself states as its total — if not found, use 0
- Be very thorough — this data feeds a financial reconciliation system`;

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
    max_tokens: 2000,
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
    coupon:          parseFloat(data.coupon)         || 0,
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
      unique_images: [],
      duplicate_images: [],
      duplicates: [],
      duplicate_count: 0,
      all_payment_rows: [],
      anomalies: []
    };
  }

  console.log(`[Extractor] Processing ${imagePaths.length} reconciliation image(s)...`);

  const allResults = [];

  // ── Extract from each image ─────────────────────────────────────────────
  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i];
    console.log(`[Extractor] Recon image ${i + 1}/${imagePaths.length}: ${path.basename(imgPath)}`);
    try {
      const result = await callClaude(imgPath, RECONCILIATION_PROMPT);

      // Normalize payment rows
      const paymentRows = (result.payment_rows || []).map(r => ({
        image_index:      i,
        method:           r.method || 'Unknown',
        count:            parseInt(r.count)  || 0,
        amount:           parseFloat(r.amount) || 0,
        has_transactions: r.has_transactions !== false
      }));

      // Compute total from rows (sum of amounts with actual transactions)
      const computedTotal = paymentRows
        .filter(r => r.has_transactions && r.amount > 0)
        .reduce((sum, r) => sum + r.amount, 0);

      const reportedTotal = parseFloat(result.reported_total) || 0;

      // Anomaly: computed vs reported mismatch (allow 1 SAR tolerance for rounding)
      const anomaly = reportedTotal > 0 && Math.abs(computedTotal - reportedTotal) > 1.0;
      const anomalyNote = anomaly
        ? `Computed sum (${computedTotal.toFixed(2)}) differs from reported total (${reportedTotal.toFixed(2)})`
        : (result.anomaly_notes || null);

      allResults.push({
        image_index:    i,
        source_label:   result.source_label || `Reconciliation ${i + 1}`,
        branch:         result.branch       || null,
        date:           result.date         || null,
        reference:      result.reference    || null,
        payment_rows:   paymentRows,
        computed_total: parseFloat(computedTotal.toFixed(2)),
        reported_total: reportedTotal,
        // Use reported_total if trustworthy (close to computed), else use computed
        effective_total: (reportedTotal > 0 && !anomaly) ? reportedTotal : parseFloat(computedTotal.toFixed(2)),
        anomaly:        anomaly,
        anomaly_note:   anomalyNote,
        error:          null
      });

      console.log(
        `[Extractor] Image ${i + 1} — Rows: ${paymentRows.length}, ` +
        `Computed: ${computedTotal.toFixed(2)}, Reported: ${reportedTotal}` +
        (anomaly ? ' ⚠️ ANOMALY' : ' ✓')
      );

    } catch (err) {
      console.error(`[Extractor] Failed on recon image ${i + 1}:`, err.message);
      allResults.push({
        image_index:    i,
        source_label:   `Image ${i + 1}`,
        branch:         null,
        date:           null,
        reference:      null,
        payment_rows:   [],
        computed_total: 0,
        reported_total: 0,
        effective_total: 0,
        anomaly:        false,
        anomaly_note:   null,
        error:          err.message
      });
    }
  }

  // ── Duplicate detection across images ───────────────────────────────────
  // Two images are duplicates if they share the same effective_total AND (same reference OR same date)
  const seenKeys = new Map();
  const uniqueImages    = [];
  const duplicateImages = [];

  for (const img of allResults) {
    let key;
    if (img.reference) {
      key = `ref:${String(img.reference).trim().toLowerCase()}`;
    } else if (img.date && img.effective_total > 0) {
      key = `date:${img.date}|amt:${img.effective_total.toFixed(2)}`;
    } else {
      // No good dedup identifier — treat each as unique
      key = `img:${img.image_index}|amt:${img.effective_total.toFixed(2)}`;
    }

    if (seenKeys.has(key)) {
      duplicateImages.push({ ...img, duplicate_of: key });
      console.log(`[Extractor] Duplicate image detected: Image ${img.image_index + 1} (key: ${key})`);
    } else {
      seenKeys.set(key, img);
      uniqueImages.push(img);
    }
  }

  // ── Final totals ────────────────────────────────────────────────────────
  const reconciliationTotal = uniqueImages.reduce((sum, img) => sum + img.effective_total, 0);

  // Aggregate all payment rows from unique images (for display)
  const allPaymentRows = uniqueImages.flatMap(img =>
    img.payment_rows.map(r => ({ ...r, image_label: img.source_label }))
  );

  // Collect anomalies
  const anomalies = allResults
    .filter(img => img.anomaly || img.anomaly_note)
    .map(img => ({
      image_index: img.image_index,
      image_label: img.source_label,
      note: img.anomaly_note
    }));

  console.log(
    `[Extractor] Recon — Images: ${allResults.length}, Unique: ${uniqueImages.length}, ` +
    `Duplicates: ${duplicateImages.length}, Total: ${reconciliationTotal.toFixed(2)}`
  );

  return {
    reconciliation_total: parseFloat(reconciliationTotal.toFixed(2)),
    pos_sales_total:      parseFloat(reconciliationTotal.toFixed(2)),
    images:               allResults,
    unique_images:        uniqueImages,
    duplicate_images:     duplicateImages,
    duplicates:           duplicateImages,
    duplicate_count:      duplicateImages.length,
    all_payment_rows:     allPaymentRows,
    anomalies
  };
}

module.exports = { extractFromImage, extractReconciliationData };

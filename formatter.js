/**
 * Formatter module
 *
 * Field mapping:
 *   GROSS SALES    = total_sales         (X-report)
 *   ADO            = total_orders        (X-report)
 *   AO             = total_sales / total_orders  (calculated)
 *   CASH SALE      = cash_amount         (X-report)
 *   COUPON         = coupon              (X-report — always shown, 0 if none)
 *   Marn POS Sales = card_amount         (X-report — card/digital payment total)
 *   POS Sales      = reconciliation_total (summed from recon image(s), duplicates removed)
 *   Variance       = POS Sales - Marn POS Sales
 */

// ─────────────────────────────────────────────
// WhatsApp Report Formatter — Enhanced Layout
// ─────────────────────────────────────────────
function formatWhatsAppReport(xData, reconData) {
  const grossSales = formatNum(xData.total_sales);
  const ado        = Math.round(xData.total_orders);
  const ao         = parseFloat(xData.average_order).toFixed(2);
  const cashSale   = formatNum(xData.cash_amount);
  const coupon     = parseFloat(xData.coupon || 0);

  // MARN POS Sales = card_amount from X-report
  const marnPos  = parseFloat(xData.marn_pos_sales || 0);

  // POS Sales = total from reconciliation image(s), duplicates already removed
  const posSales = parseFloat(reconData.reconciliation_total || 0);

  // Variance = POS Sales (recon) − MARN POS Sales (card from X-report)
  const variance = parseFloat((posSales - marnPos).toFixed(2));

  const marnStr   = formatNum(marnPos);
  const posStr    = formatNum(posSales);
  const couponStr = formatNum(coupon);   // always show
  const varAbs    = formatNum(Math.abs(variance));
  const varSign   = variance > 0 ? '+' : variance < 0 ? '-' : '';
  const varFlag   = variance === 0 ? '✅ OK' : '⚠️ CHECK';

  // Duplicate info
  const dupLine = reconData.duplicate_count > 0
    ? `\n⚠️  Duplicates Removed : ${reconData.duplicate_count}`
    : '';

  // Anomaly info
  const anomalyLine = (reconData.anomalies || []).length > 0
    ? `\n⚠️  Anomaly Detected   : ${reconData.anomalies.length} image(s)`
    : '';

  // Recon breakdown by payment method (aggregate across all unique images)
  const paymentRows = reconData.all_payment_rows || [];
  let reconBreakdown = '';
  if (paymentRows.length > 0) {
    reconBreakdown = '\n';
    paymentRows
      .filter(r => r.has_transactions && r.amount > 0)
      .forEach(r => {
        const label = (r.method || 'Unknown').slice(0, 16).padEnd(16);
        reconBreakdown += `  ${label}: ${formatNum(r.amount).padStart(10)}\n`;
      });
  } else if ((reconData.images || []).length > 1) {
    // Fallback: show per-image total when no payment rows
    reconBreakdown = '\n';
    reconData.images.forEach((img, i) => {
      const label = (img.source_label || `Recon ${i + 1}`).slice(0, 18).padEnd(18);
      reconBreakdown += `  ${i + 1}. ${label}: ${formatNum(img.effective_total || img.computed_total)}\n`;
    });
  }

  const report =
`*📊 DAILY SALES UPDATE*
\`\`\`
╔══════════════════════════════╗
  🏪  ${(xData.branch || 'N/A').padEnd(26)}
  📅  ${(xData.date   || 'N/A').padEnd(26)}
╚══════════════════════════════╝

▌ SALES SUMMARY
  💰 Gross Sales    : ${String(grossSales).padStart(10)}
  📦 ADO            : ${String(ado).padStart(10)}
  📊 Avg Order (AO) : ${String(ao).padStart(10)}
  💵 Cash Sale      : ${String(cashSale).padStart(10)}
  🎟️  Coupon         : ${String(couponStr).padStart(10)}

▌ POS RECONCILIATION${reconBreakdown}
  📋 MARN POS Sales : ${String(marnStr).padStart(10)}
  🏧 POS Sales      : ${String(posStr).padStart(10)}
  ─────────────────────────────
  📉 Variance       : ${String(varSign + varAbs).padStart(10)}  ${varFlag}${dupLine}${anomalyLine}
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
\`\`\`
_Thank you_ 🙏
@Mr Ibrahim  DM @🇱🇰 محمد سفراز`;

  return report;
}

// ─────────────────────────────────────────────
// Summary for UI — Report panel only (no raw X-report table)
// ─────────────────────────────────────────────
function generateSummary(xData, reconData) {
  const marnPos  = parseFloat(xData.marn_pos_sales || 0);
  const posSales = parseFloat(reconData.reconciliation_total || 0);
  const variance = parseFloat((posSales - marnPos).toFixed(2));
  const coupon   = parseFloat(xData.coupon || 0);

  // Build reconciliation items from payment rows
  const paymentRows  = reconData.all_payment_rows || [];
  const activeRows   = paymentRows.filter(r => r.has_transactions && r.amount > 0);

  let reconItems = [];
  if (activeRows.length > 0) {
    activeRows.forEach(r => {
      reconItems.push({
        label: `↳ ${r.method}`,
        value: formatNum(r.amount),
        sub: true
      });
    });
  } else {
    // Fallback: per-image breakdown
    (reconData.images || []).forEach((img, i) => {
      reconItems.push({
        label: `↳ ${img.source_label || `Image ${i + 1}`}`,
        value: formatNum(img.effective_total || img.computed_total || 0),
        sub: true
      });
    });
  }

  // Anomaly rows
  if ((reconData.anomalies || []).length > 0) {
    reconData.anomalies.forEach(a => {
      reconItems.push({
        label: `⚠️ Anomaly: ${(a.image_label || '').slice(0, 20)}`,
        value: a.note || 'Mismatch detected',
        highlight: true
      });
    });
  }

  reconItems.push(
    { label: 'Duplicates Removed',    value: (reconData.duplicate_count || 0).toString(), highlight: (reconData.duplicate_count || 0) > 0 },
    { label: 'Reconciliation Total',  value: formatNum(posSales), bold: true }
  );

  return {
    sections: [
      {
        title: '📍 Branch & Session',
        items: [
          { label: 'Branch', value: xData.branch || 'N/A' },
          { label: 'Date',   value: xData.date   || 'N/A' },
          { label: 'Time',   value: xData.time   || 'N/A' }
        ]
      },
      {
        title: '💰 Sales Summary',
        items: [
          { label: 'Gross Sales',        value: formatNum(xData.total_sales) },
          { label: 'ADO (Total Orders)', value: Math.round(xData.total_orders).toString() },
          { label: 'AO (Avg Order)',     value: parseFloat(xData.average_order).toFixed(2), calculated: true },
          { label: 'Cash Sale',          value: formatNum(xData.cash_amount) },
          { label: '🎟️ Coupon',          value: formatNum(coupon) }           // always shown
        ]
      },
      {
        title: '📋 Reconciliation',
        items: reconItems
      },
      {
        title: '🔁 Variance Analysis',
        items: [
          { label: 'MARN POS Sales (Card)',  value: formatNum(marnPos) },
          { label: 'POS Sales (Recon)',      value: formatNum(posSales) },
          { label: 'Variance',               value: formatNum(variance), highlight: variance !== 0, bold: true }
        ]
      }
    ]
  };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatNum(num) {
  const n = parseFloat(num) || 0;
  return n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);
}

module.exports = { formatWhatsAppReport, generateSummary };

/**
 * Formatter module
 *
 * Field mapping:
 *   GROSS SALES    = total_sales         (X-report)
 *   ADO            = total_orders        (X-report)
 *   AO             = total_sales / total_orders  (calculated)
 *   CASH SALE      = cash_amount         (X-report)
 *   COUPON         = coupon              (X-report — coupon/voucher redemption total)
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

  const marnStr  = formatNum(marnPos);
  const posStr   = formatNum(posSales);
  const couponStr= formatNum(coupon);
  const varAbs   = formatNum(Math.abs(variance));
  const varSign  = variance > 0 ? '+' : variance < 0 ? '-' : '';
  const varFlag  = variance === 0 ? '✅ OK' : '⚠️ CHECK';

  // Duplicate info
  const dupLine = reconData.duplicate_count > 0
    ? `\n⚠️  Duplicates Removed : ${reconData.duplicate_count}`
    : '';

  // Recon image breakdown (if more than 1 image)
  let reconBreakdown = '';
  if ((reconData.images || []).length > 1) {
    reconBreakdown = '\n';
    reconData.images.forEach((img, i) => {
      const label = (img.source_label || `Recon ${i + 1}`).slice(0, 18).padEnd(18);
      reconBreakdown += `  ${i + 1}. ${label}: ${formatNum(img.pos_sales)}\n`;
    });
  }

  // Only show coupon line if value > 0
  const couponLine = coupon > 0 ? `\n  🎟️  Coupon            : ${String(couponStr).padStart(10)}` : '';

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
  💵 Cash Sale      : ${String(cashSale).padStart(10)}${couponLine}

▌ POS RECONCILIATION${reconBreakdown}
  🏧 MARN POS Sales : ${String(marnStr).padStart(10)}
  📋 POS Sales      : ${String(posStr).padStart(10)}
  ─────────────────────────────
  📉 Variance       : ${String(varSign + varAbs).padStart(10)}  ${varFlag}${dupLine}
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

  // Per-image breakdown for Reconciliation section
  const reconImageItems = (reconData.images || []).map((img, i) => ({
    label:     `↳ ${img.source_label || `Image ${i + 1}`}`,
    value:     formatNum(img.pos_sales || 0),
    sub:       true
  }));

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
          ...(coupon > 0 ? [{ label: 'Coupon', value: formatNum(coupon), highlight: false }] : [])
        ]
      },
      {
        title: '📋 Reconciliation',
        items: [
          ...reconImageItems,
          { label: 'Duplicates Removed', value: reconData.duplicate_count.toString(), highlight: reconData.duplicate_count > 0 },
          { label: 'Reconciliation Total', value: formatNum(posSales), bold: true }
        ]
      },
      {
        title: '🔁 Variance Analysis',
        items: [
          { label: 'Card Sales',           value: formatNum(marnPos) },
          { label: 'Reconciliation Sales', value: formatNum(posSales) },
          { label: 'Variance',             value: formatNum(variance), highlight: variance !== 0, bold: true }
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

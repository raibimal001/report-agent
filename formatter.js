/**
 * Formatter module: Converts extracted POS data to WhatsApp report format
 * 
 * Target WhatsApp Format:
 * Update
 * ```Address 1079 KAFD-SNB
 * 
 * | DATE :- 12-04-2026
 * 
 * • GROSS SALES : 2126
 * • ADO 173
 * • AO : 12.28
 * • CASH SALE :-0
 * 
 * POS Sales -2126
 * Marn POS Sales -2126
 * Variance :0
 * 
 * THANK YOU 🙏
 * @Mr Ibrahim DM @🇱🇰 محمد سفراز
 */

function formatWhatsAppReport(data) {
  const {
    branch,
    date,
    total_sales,
    total_orders,
    average_order,
    cash_amount,
    marn_pos_sales,
    variance
  } = data;

  // Format the branch display (e.g. "Address 1079 KAFD-SNB")
  // Clean up branch code for display
  const branchDisplay = formatBranch(branch);

  // Format numbers: show as integer if .0, else 2 decimal places
  const grossSales = formatNumber(total_sales);
  const ado = Math.round(total_orders);
  const ao = parseFloat(average_order).toFixed(2);
  const cashSale = formatNumber(cash_amount);
  const posSales = formatNumber(total_sales);
  const marnSales = formatNumber(marn_pos_sales);
  const varianceDisplay = formatNumber(parseFloat(variance));

  const report = `Update
\`\`\`Address ${branchDisplay}

| DATE :- ${date}

• GROSS SALES : ${grossSales}
• ADO ${ado}
• AO : ${ao}
• CASH SALE :-${cashSale}

POS Sales -${posSales}
Marn POS Sales -${marnSales}
Variance :${varianceDisplay}

THANK YOU 🙏
@Mr Ibrahim DM @🇱🇰 محمد سفراز\`\`\``;

  return report;
}

function formatBranch(branch) {
  if (!branch) return 'UNKNOWN BRANCH';
  // Remove common prefixes if present
  return branch.trim();
}

function formatNumber(num) {
  const n = parseFloat(num) || 0;
  // If it's a whole number, show without decimals
  if (n % 1 === 0) {
    return n.toString();
  }
  // Otherwise show 2 decimal places
  return n.toFixed(2);
}

/**
 * Generate a structured summary object for the UI display table
 */
function generateSummary(data) {
  return {
    sections: [
      {
        title: 'Branch & Date',
        items: [
          { label: 'Branch', value: data.branch || 'N/A' },
          { label: 'Date', value: data.date || 'N/A' },
          { label: 'Time', value: data.time || 'N/A' },
          { label: 'Cashier', value: data.cashier || 'N/A' }
        ]
      },
      {
        title: 'Sales Metrics',
        items: [
          { label: 'Gross Sales', value: formatNumber(data.total_sales) },
          { label: 'ADO (Total Orders)', value: Math.round(data.total_orders).toString() },
          { label: 'AO (Avg Order Value)', value: `${parseFloat(data.average_order).toFixed(2)}`, calculated: true },
          { label: 'Cash Sales', value: formatNumber(data.cash_amount) },
          { label: 'Card Sales', value: formatNumber(data.card_amount) }
        ]
      },
      {
        title: 'POS Reconciliation',
        items: [
          { label: 'POS Sales', value: formatNumber(data.total_sales) },
          { label: 'Marn POS Sales', value: formatNumber(data.marn_pos_sales) },
          { label: 'Variance', value: formatNumber(data.variance), highlight: parseFloat(data.variance) !== 0 }
        ]
      },
      {
        title: 'Other Details',
        items: [
          { label: 'Net Sales', value: formatNumber(data.net_sales) },
          { label: 'Sales Tax', value: formatNumber(data.sales_tax) },
          { label: 'Total Discount', value: formatNumber(data.total_discount) },
          { label: 'Total Refund', value: formatNumber(data.total_refund) },
          { label: 'Total Void', value: formatNumber(data.total_void) },
          { label: 'Complimentary', value: formatNumber(data.complimentary) }
        ]
      }
    ]
  };
}

module.exports = { formatWhatsAppReport, generateSummary };

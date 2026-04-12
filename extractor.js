require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACTION_PROMPT = `You are an expert at reading POS (Point of Sale) X-Report receipts. 
Analyze this receipt image carefully and extract the following fields. 
Return ONLY a valid JSON object with no extra text, no markdown, no code blocks.

Extract these fields:
{
  "branch": "branch code/name (e.g. KAFD-SNB-1079 or the store identifier shown on the receipt)",
  "date": "date in format DD-MM-YYYY (from the printed date on the receipt)",
  "time": "time printed on receipt",
  "cashier": "cashier or user name on the receipt",
  "total_sales": "total sales amount as a number (no currency symbols)",
  "total_orders": "total number of orders/transactions as a number",
  "cash_amount": "cash payment total as a number (0 if none)",
  "card_amount": "card payment total as a number (0 if none)",
  "net_sales": "net sales amount as a number",
  "sales_tax": "sales tax amount as a number",
  "total_discount": "total discount amount as a number (0 if none)",
  "total_refund": "total refund amount as a number (0 if none)",
  "total_void": "total void amount as a number (0 if none)",
  "complimentary": "complimentary total as a number (0 if none)",
  "dine_in_sales": "dine in sales amount as a number (0 if none)",
  "takeaway_sales": "takeaway/drive-thru/delivery sales as a number (0 if none)",
  "employee_meals": "employee meals amount as a number (0 if none)"
}

Rules:
- Use 0 for any field that is not visible or is shown as 0 or blank
- Extract numbers only (no currency symbols like ﷼ or SAR)
- For the branch field, look for a branch code, outlet name, or store identifier near the top of the receipt
- For the date, look for the printed date (usually near the bottom: "Printed at:")
- Be precise - this data will be used in financial reports`;

async function extractFromImage(imagePath) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Determine media type
    const ext = path.extname(imagePath).toLowerCase();
    const mediaTypeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const mediaType = mediaTypeMap[ext] || 'image/jpeg';

    console.log(`[Extractor] Processing image: ${path.basename(imagePath)}`);
    console.log(`[Extractor] Calling Claude Vision API...`);

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image
              }
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT
            }
          ]
        }
      ]
    });

    const rawText = response.content[0].text.trim();
    console.log('[Extractor] Raw response:', rawText);

    // Parse the JSON response
    let extractedData;
    try {
      // Handle case where Claude might wrap in code blocks despite instructions
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('[Extractor] JSON parse error:', parseError.message);
      throw new Error('Failed to parse extracted data. Please try again.');
    }

    // Calculate AO (Average Order value)
    const totalSales = parseFloat(extractedData.total_sales) || 0;
    const totalOrders = parseFloat(extractedData.total_orders) || 0;
    const averageOrder = totalOrders > 0 ? (totalSales / totalOrders).toFixed(2) : '0.00';

    // Marn POS Sales = same as total_sales (since this is a Marn POS receipt)
    const marnPosSales = totalSales;
    const variance = (totalSales - marnPosSales).toFixed(2);

    // Enrich the data with calculated fields
    const enrichedData = {
      ...extractedData,
      total_sales: totalSales,
      total_orders: totalOrders,
      cash_amount: parseFloat(extractedData.cash_amount) || 0,
      card_amount: parseFloat(extractedData.card_amount) || 0,
      net_sales: parseFloat(extractedData.net_sales) || 0,
      sales_tax: parseFloat(extractedData.sales_tax) || 0,
      total_discount: parseFloat(extractedData.total_discount) || 0,
      total_refund: parseFloat(extractedData.total_refund) || 0,
      total_void: parseFloat(extractedData.total_void) || 0,
      complimentary: parseFloat(extractedData.complimentary) || 0,
      dine_in_sales: parseFloat(extractedData.dine_in_sales) || 0,
      takeaway_sales: parseFloat(extractedData.takeaway_sales) || 0,
      employee_meals: parseFloat(extractedData.employee_meals) || 0,
      // Calculated fields
      average_order: averageOrder,
      marn_pos_sales: marnPosSales,
      variance: variance
    };

    console.log('[Extractor] Extraction successful:', enrichedData);
    return enrichedData;

  } catch (error) {
    console.error('[Extractor] Error:', error.message);
    throw error;
  }
}

module.exports = { extractFromImage };

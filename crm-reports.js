// Luminus CRM — shared PDF + Excel report generation for Orders and Finance.
//
// PDF: unlike the Proposal System's own PDF path (api/pdfGen.js), which has
// Puppeteer navigate to a public Vue route that fetches its own data client-side
// via the anon Supabase key — fine for proposal data, not fine for admin-only
// revenue/expense figures — these reports are built as a plain HTML string
// server-side (the caller already has the data from its own admin-gated route)
// and handed to Puppeteer via page.setContent(). No network round-trip, no
// route that could ever be reached without going through requireAdmin first.
//
// Excel: exceljs (the only new dependency this adds) — chosen over the
// already-installed-elsewhere SheetJS/xlsx because exceljs is built for
// *authoring* styled output (currency number formats, a bold header row,
// autofilter, a totals row), where SheetJS is oriented more toward parsing.
import puppeteer from 'puppeteer'
import ExcelJS from 'exceljs'

const BRAND = 'Signage Crafting'
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—')
const rangeLabel = (filters) => {
  if (filters.from && filters.to) return `${fmtDate(filters.from)} – ${fmtDate(filters.to)}`
  if (filters.from) return `Since ${fmtDate(filters.from)}`
  if (filters.to) return `Through ${fmtDate(filters.to)}`
  return 'All time'
}

// ── PDF ──────────────────────────────────────────────────
const PDF_MARGIN_TOP_IN = 0.5
const PDF_MARGIN_BOTTOM_IN = 0.6
const PDF_MARGIN_SIDE_IN = 0.5
const PDF_PAGE_HEIGHT_IN = 11 // Letter

export async function htmlToPdfBuffer(html) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  try {
    const page = await browser.newPage()
    // Match the viewport to Letter's print width (8.5in @ 96dpi) before loading
    // content, so the height measured below reflects the actual print layout
    // rather than whatever Puppeteer's default viewport happens to be.
    await page.setViewport({ width: 816, height: 1056 })
    await page.setContent(html, { waitUntil: 'networkidle0' })

    // A short report (a handful of orders/vendors) was always rendered on a
    // full fixed Letter page regardless of how little it actually contained —
    // a two-row report left ~70% of the page a blank void below the table,
    // which read as broken/unfinished rather than just short. Measure the
    // real rendered content height (this already includes the top/bottom
    // margin, since that's now CSS padding on body rather than a PDF-level
    // margin — see reportShell) and, if it fits on one page, size that one
    // page tightly to it instead. A genuinely long report (many rows) still
    // gets real multi-page pagination at the standard Letter size — this only
    // changes the common case where a report is shorter than a page.
    const contentHeightPx = await page.evaluate(() => document.body.scrollHeight)
    const neededPageHeightIn = contentHeightPx / 96

    // Zero PDF-level margin everywhere: the visual margin is CSS padding on
    // body now, which the page's own dark/light background fills right to the
    // true page edge. A Puppeteer margin here would re-introduce the exact
    // white gutter this was built to remove, regardless of theme.
    const margin = { top: '0in', right: '0in', bottom: '0in', left: '0in' }
    const pdfOptions = neededPageHeightIn <= PDF_PAGE_HEIGHT_IN
      ? { width: '8.5in', height: `${Math.max(neededPageHeightIn, 3)}in`, printBackground: true, margin }
      : { format: 'Letter', printBackground: true, margin }

    // Puppeteer's page.pdf() returns a plain Uint8Array, not a Node Buffer —
    // Express's res.send() only special-cases Buffer.isBuffer(), so an
    // unwrapped Uint8Array falls through to res.json() and gets serialized
    // as {"0":37,"1":80,...} instead of sent as raw PDF bytes.
    const bytes = await page.pdf(pdfOptions)
    return Buffer.from(bytes)
  } finally {
    await browser.close()
  }
}

// Matches the CRM app's own two UI themes (see src/style.css's html.theme-pro /
// html.theme-light, and crmThemeStore.js) — every report is generated in whichever
// theme the caller is currently using, 'light' by default. printBackground:true in
// htmlToPdfBuffer is what makes the dark background actually show up in the PDF
// (browsers skip background colors on print/PDF output unless that's set).
const THEMES = {
  light: {
    bg: '#ffffff', ink: '#1a1d24', mutedText: '#6b7280', ftText: '#9aa0a8',
    border: '#e5e7eb', totBorder: '#1a1d24', cardBg: 'transparent',
    accent: '#0891b2', accentSoft: '#e6f7fa',
    success: '#16a34a', danger: '#dc2626', dangerSoft: '#fef2f2'
  },
  dark: {
    bg: '#050505', ink: '#e2e8f0', mutedText: '#9aa0a8', ftText: '#5c5c64',
    border: '#2c2c34', totBorder: '#e2e8f0', cardBg: '#0b0b0e',
    accent: '#00f3ff', accentSoft: 'rgba(0, 243, 255, .15)',
    success: '#34d399', danger: '#f0736a', dangerSoft: '#2c1214'
  }
}
const resolveTheme = (theme) => THEMES[theme] || THEMES.light

function reportShell(title, subtitle, bodyHtml, theme = 'light') {
  const t = resolveTheme(theme)
  // The page margin lives here as CSS padding on body, NOT as Puppeteer's own
  // page.pdf({ margin }) option (see htmlToPdfBuffer, which now passes zero
  // margin there) — Chrome's PDF margin gutter is blank/white by definition,
  // outside the page's own painted content, so it ignores html/body's dark
  // background entirely. That's what produced a white border around an
  // otherwise-black report. Padding is part of body's own box, so the
  // background fills it — no white edge, in any theme.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { background: ${t.bg}; }
    body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: ${t.ink}; margin: 0; padding: ${PDF_MARGIN_TOP_IN}in ${PDF_MARGIN_SIDE_IN}in ${PDF_MARGIN_BOTTOM_IN}in; font-size: 12px; }
    .hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid ${t.accent}; padding-bottom: 14px; margin-bottom: 22px; }
    .hd-brand { font-size: 22px; font-weight: 800; letter-spacing: .3px; display: flex; align-items: center; gap: 8px; }
    .hd-brand .dot { width: 10px; height: 10px; border-radius: 50%; background: ${t.accent}; box-shadow: 0 0 0 4px ${t.accentSoft}; }
    .hd-sub { color: ${t.mutedText}; font-size: 11px; margin-top: 2px; margin-left: 18px; }
    .hd-title { text-align: right; }
    .hd-title .t1 { font-size: 15px; font-weight: 700; }
    .hd-title .t2 { color: ${t.accent}; font-size: 11px; margin-top: 2px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .stat-row { display: flex; gap: 14px; margin-bottom: 22px; }
    .stat { flex: 1; background: ${t.cardBg}; border: 1px solid ${t.border}; border-top: 3px solid ${t.accent}; border-radius: 8px; padding: 12px 14px; }
    .stat .lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px; color: ${t.mutedText}; font-weight: 600; margin-bottom: 4px; }
    .stat .val { font-size: 19px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
    th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .5px; color: ${t.mutedText}; font-weight: 700; padding: 7px 8px; border-bottom: 2px solid ${t.border}; }
    td { padding: 7px 8px; border-bottom: 1px solid ${t.border}; font-size: 11px; }
    tr:last-child td { border-bottom: none; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .tot-row td { font-weight: 800; border-top: 2px solid ${t.totBorder}; border-bottom: none; padding-top: 10px; }
    .ft { margin-top: 26px; padding-top: 10px; border-top: 1px solid ${t.border}; font-size: 9.5px; color: ${t.ftText}; display: flex; justify-content: space-between; }
    .section-title { font-size: 13px; font-weight: 700; margin: 20px 0 8px; padding-left: 8px; border-left: 3px solid ${t.accent}; }
  </style></head><body>
    <div class="hd">
      <div><div class="hd-brand"><span class="dot"></span>${BRAND}</div><div class="hd-sub">info@signagecrafting.com</div></div>
      <div class="hd-title"><div class="t1">${esc(title)}</div><div class="t2">${esc(subtitle)}</div></div>
    </div>
    ${bodyHtml}
    <div class="ft"><span>Generated ${fmtDate(new Date())}</span><span>${BRAND} — internal use</span></div>
  </body></html>`
}

export function buildOrdersReportHtml(rows, summary, filters, theme = 'light') {
  const body = `
    <div class="stat-row">
      <div class="stat"><div class="lbl">Revenue</div><div class="val">${money(summary.revenue)}</div></div>
      <div class="stat"><div class="lbl">Sales Tax Collected</div><div class="val">${money(summary.tax)}</div></div>
      <div class="stat"><div class="lbl">Orders</div><div class="val">${summary.count}</div></div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Client</th><th>Description</th><th>Status</th><th class="num">Amount</th><th class="num">Tax</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${fmtDate(r.order_date)}</td>
          <td>${esc(r.client_name)}</td>
          <td>${esc(r.description || '—')}</td>
          <td>${esc(r.status)}</td>
          <td class="num">${money(r.amount_charged)}</td>
          <td class="num">${money(r.sales_tax)}</td>
          <td class="num">${money(r.total_amount)}</td>
        </tr>`).join('')}
        <tr class="tot-row"><td colspan="4">Total</td><td class="num">${money(summary.revenue)}</td><td class="num">${money(summary.tax)}</td><td class="num">${money(summary.total)}</td></tr>
      </tbody>
    </table>`
  return reportShell('Orders Report', rangeLabel(filters), body, theme)
}

export function buildExpensesReportHtml(rows, summary, filters, theme = 'light') {
  const catLabel = { ad_spend: 'Ad Spend', shipping: 'Shipping', tax: 'Tax', materials: 'Materials', software: 'Software', other: 'Other' }
  const byCat = Object.entries(summary.byCategory || {})
  const body = `
    <div class="stat-row">
      <div class="stat"><div class="lbl">Total Expenses</div><div class="val">${money(summary.total)}</div></div>
      <div class="stat"><div class="lbl">Entries</div><div class="val">${summary.count}</div></div>
    </div>
    <div class="section-title">By Category</div>
    <table>
      <thead><tr><th>Category</th><th class="num">Amount</th></tr></thead>
      <tbody>${byCat.map(([cat, amt]) => `<tr><td>${esc(catLabel[cat] || cat)}</td><td class="num">${money(amt)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="section-title">All Entries</div>
    <table>
      <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${fmtDate(r.expense_date)}</td>
          <td>${esc(catLabel[r.category] || r.category)}</td>
          <td>${esc(r.description || '—')}</td>
          <td>${esc(r.vendor || '—')}</td>
          <td class="num">${money(r.amount)}</td>
        </tr>`).join('')}
        <tr class="tot-row"><td colspan="4">Total</td><td class="num">${money(summary.total)}</td></tr>
      </tbody>
    </table>`
  return reportShell('Expenses Report', rangeLabel(filters), body, theme)
}

export function buildFinanceReportHtml(ordersSummary, expensesSummary, filters, theme = 'light') {
  const t = resolveTheme(theme)
  const catLabel = { ad_spend: 'Ad Spend', shipping: 'Shipping', tax: 'Tax', materials: 'Materials', software: 'Software', other: 'Other' }
  const netProfit = ordersSummary.revenue - expensesSummary.total
  const byCat = Object.entries(expensesSummary.byCategory || {})
  const body = `
    <div class="stat-row">
      <div class="stat"><div class="lbl">Revenue</div><div class="val" style="color:${t.success}">${money(ordersSummary.revenue)}</div></div>
      <div class="stat"><div class="lbl">Expenses</div><div class="val" style="color:${t.danger}">${money(expensesSummary.total)}</div></div>
      <div class="stat"><div class="lbl">Net Profit</div><div class="val" style="color:${netProfit >= 0 ? t.success : t.danger}">${money(netProfit)}</div></div>
    </div>
    <div class="section-title">Expenses by Category</div>
    <table>
      <thead><tr><th>Category</th><th class="num">Amount</th><th class="num">% of Total</th></tr></thead>
      <tbody>${byCat.map(([cat, amt]) => `<tr><td>${esc(catLabel[cat] || cat)}</td><td class="num">${money(amt)}</td><td class="num">${expensesSummary.total ? Math.round((amt / expensesSummary.total) * 100) : 0}%</td></tr>`).join('')}
      <tr class="tot-row"><td>Total Expenses</td><td class="num">${money(expensesSummary.total)}</td><td class="num">100%</td></tr>
      </tbody>
    </table>
    <div class="section-title">Summary</div>
    <table>
      <tbody>
        <tr><td>Total Revenue (${ordersSummary.count} orders)</td><td class="num">${money(ordersSummary.revenue)}</td></tr>
        <tr><td>Sales Tax Collected</td><td class="num">${money(ordersSummary.tax)}</td></tr>
        <tr><td>Total Expenses (${expensesSummary.count} entries)</td><td class="num">−${money(expensesSummary.total)}</td></tr>
        <tr class="tot-row"><td>Net Profit</td><td class="num">${money(netProfit)}</td></tr>
      </tbody>
    </table>`
  return reportShell('Business Summary Report', rangeLabel(filters), body, theme)
}

const CAT_LABEL = { acrylic: 'Acrylic', led: 'LED', vinyl: 'Vinyl', hardware: 'Hardware', metal: 'Metal', other: 'Other' }

export function buildMaterialsReportHtml(rows, summary, theme = 'light') {
  const t = resolveTheme(theme)
  const body = `
    <div class="stat-row">
      <div class="stat"><div class="lbl">Items</div><div class="val">${summary.itemCount}</div></div>
      <div class="stat"><div class="lbl">Low Stock</div><div class="val" style="color:${summary.lowStockCount ? t.danger : t.ink}">${summary.lowStockCount}</div></div>
      <div class="stat"><div class="lbl">Inventory Value</div><div class="val">${money(summary.totalValue)}</div></div>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Category</th><th>Unit</th><th class="num">Qty On Hand</th><th class="num">Reorder At</th><th class="num">Unit Cost</th><th class="num">Value</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr${Number(r.quantity_on_hand) <= Number(r.reorder_threshold) ? ` style="background:${t.dangerSoft}"` : ''}>
          <td>${esc(r.name)}</td>
          <td>${esc(CAT_LABEL[r.category] || r.category)}</td>
          <td>${esc(r.unit)}</td>
          <td class="num">${Number(r.quantity_on_hand).toLocaleString()}</td>
          <td class="num">${Number(r.reorder_threshold).toLocaleString()}</td>
          <td class="num">${money(r.unit_cost)}</td>
          <td class="num">${money(Number(r.quantity_on_hand) * Number(r.unit_cost))}</td>
        </tr>`).join('')}
      </tbody>
    </table>`
  return reportShell('Materials & Inventory Report', `As of ${fmtDate(new Date())}`, body, theme)
}

export function buildVendorsReportHtml(rows, theme = 'light') {
  const body = `
    <div class="stat-row">
      <div class="stat"><div class="lbl">Vendors</div><div class="val">${rows.length}</div></div>
      <div class="stat"><div class="lbl">Total Paid</div><div class="val">${money(rows.reduce((a, r) => a + r.totalPaid, 0))}</div></div>
      <div class="stat"><div class="lbl">Open POs</div><div class="val">${rows.reduce((a, r) => a + r.openPOs, 0)}</div></div>
    </div>
    <table>
      <thead><tr><th>Vendor</th><th>Contact</th><th class="num">Total Paid</th><th class="num">Open POs</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${esc(r.name)}</td>
          <td>${esc(r.contact_email || r.contact_phone || '—')}</td>
          <td class="num">${money(r.totalPaid)}</td>
          <td class="num">${r.openPOs}</td>
        </tr>`).join('')}
      </tbody>
    </table>`
  return reportShell('Vendors Report', `As of ${fmtDate(new Date())}`, body, theme)
}

export function buildTaxSummaryReportHtml({ year, quarters, vendorTotals, businessTaxPaid }, theme = 'light') {
  const t = resolveTheme(theme)
  const body = `
    <div class="section-title">Quarterly Sales Tax — ${year}</div>
    <table>
      <thead><tr><th>Quarter</th><th class="num">Revenue</th><th class="num">Sales Tax Collected</th></tr></thead>
      <tbody>
        ${quarters.map((q) => `<tr><td>Q${q.quarter}</td><td class="num">${money(q.revenue)}</td><td class="num">${money(q.tax)}</td></tr>`).join('')}
        <tr class="tot-row"><td>Year Total</td><td class="num">${money(quarters.reduce((a, q) => a + q.revenue, 0))}</td><td class="num">${money(quarters.reduce((a, q) => a + q.tax, 0))}</td></tr>
      </tbody>
    </table>
    <div class="section-title">Vendor Payments — ${year} (1099-NEC reference: $600+ flagged)</div>
    <table>
      <thead><tr><th>Vendor</th><th class="num">Total Paid</th><th>1099 Threshold</th></tr></thead>
      <tbody>
        ${vendorTotals.map((v) => `<tr><td>${esc(v.name)}</td><td class="num">${money(v.total)}</td><td>${v.total >= 600 ? '⚠ Review' : '—'}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="section-title">Business Tax Paid — ${year}</div>
    <table><tbody><tr><td>Total (expense category: tax)</td><td class="num">${money(businessTaxPaid)}</td></tr></tbody></table>
    <p style="color:${t.ftText};font-size:9.5px;margin-top:6px">Informational only, not tax advice — confirm actual filing thresholds/requirements with an accountant.</p>`
  return reportShell('Tax & Compliance Summary', String(year), body, theme)
}

// ── Excel ────────────────────────────────────────────────
function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1D24' } }
  row.alignment = { vertical: 'middle' }
}
function moneyCol(ws, colLetter) {
  ws.getColumn(colLetter).numFmt = '$#,##0.00'
}

export async function buildOrdersWorkbook(rows, summary) {
  const wb = new ExcelJS.Workbook()
  wb.creator = BRAND
  const ws = wb.addWorksheet('Orders')
  ws.columns = [
    { header: 'Date', key: 'order_date', width: 14 },
    { header: 'Client', key: 'client_name', width: 24 },
    { header: 'Email', key: 'client_email', width: 26 },
    { header: 'Description', key: 'description', width: 28 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Payment Method', key: 'payment_method', width: 16 },
    { header: 'Amount Charged', key: 'amount_charged', width: 16 },
    { header: 'Sales Tax', key: 'sales_tax', width: 14 },
    { header: 'Total', key: 'total_amount', width: 14 }
  ]
  styleHeaderRow(ws.getRow(1))
  rows.forEach((r) => ws.addRow({ ...r, order_date: fmtDate(r.order_date) }))
  const totalsRow = ws.addRow({ description: 'TOTAL', amount_charged: summary.revenue, sales_tax: summary.tax, total_amount: summary.total })
  totalsRow.font = { bold: true }
  ;['G', 'H', 'I'].forEach((c) => moneyCol(ws, c))
  ws.autoFilter = { from: 'A1', to: 'I1' }
  return wb.xlsx.writeBuffer()
}

export async function buildExpensesWorkbook(rows, summary) {
  const catLabel = { ad_spend: 'Ad Spend', shipping: 'Shipping', tax: 'Tax', materials: 'Materials', software: 'Software', other: 'Other' }
  const wb = new ExcelJS.Workbook()
  wb.creator = BRAND
  const ws = wb.addWorksheet('Expenses')
  ws.columns = [
    { header: 'Date', key: 'expense_date', width: 14 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Vendor', key: 'vendor', width: 20 },
    { header: 'Amount', key: 'amount', width: 14 }
  ]
  styleHeaderRow(ws.getRow(1))
  rows.forEach((r) => ws.addRow({ ...r, expense_date: fmtDate(r.expense_date), category: catLabel[r.category] || r.category }))
  const totalsRow = ws.addRow({ description: 'TOTAL', amount: summary.total })
  totalsRow.font = { bold: true }
  moneyCol(ws, 'E')
  ws.autoFilter = { from: 'A1', to: 'E1' }

  const cw = wb.addWorksheet('By Category')
  cw.columns = [{ header: 'Category', key: 'cat', width: 20 }, { header: 'Amount', key: 'amt', width: 16 }]
  styleHeaderRow(cw.getRow(1))
  Object.entries(summary.byCategory || {}).forEach(([cat, amt]) => cw.addRow({ cat: catLabel[cat] || cat, amt }))
  moneyCol(cw, 'B')
  return wb.xlsx.writeBuffer()
}

export async function buildFinanceWorkbook(ordersRows, ordersSummary, expenseRows, expensesSummary) {
  const catLabel = { ad_spend: 'Ad Spend', shipping: 'Shipping', tax: 'Tax', materials: 'Materials', software: 'Software', other: 'Other' }
  const netProfit = ordersSummary.revenue - expensesSummary.total
  const wb = new ExcelJS.Workbook()
  wb.creator = BRAND

  const sw = wb.addWorksheet('Summary')
  sw.columns = [{ header: '', key: 'label', width: 30 }, { header: '', key: 'value', width: 18 }]
  sw.addRow({ label: 'Revenue', value: ordersSummary.revenue })
  sw.addRow({ label: 'Sales Tax Collected', value: ordersSummary.tax })
  sw.addRow({ label: 'Total Expenses', value: -expensesSummary.total })
  const npRow = sw.addRow({ label: 'Net Profit', value: netProfit })
  npRow.font = { bold: true }
  moneyCol(sw, 'B')
  sw.addRow({})
  const catHdr = sw.addRow({ label: 'Expenses by Category', value: '' })
  catHdr.font = { bold: true }
  Object.entries(expensesSummary.byCategory || {}).forEach(([cat, amt]) => sw.addRow({ label: catLabel[cat] || cat, value: amt }))

  const ow = wb.addWorksheet('Orders')
  ow.columns = [
    { header: 'Date', key: 'order_date', width: 14 }, { header: 'Client', key: 'client_name', width: 24 },
    { header: 'Description', key: 'description', width: 26 }, { header: 'Amount', key: 'amount_charged', width: 14 },
    { header: 'Tax', key: 'sales_tax', width: 12 }, { header: 'Total', key: 'total_amount', width: 14 }
  ]
  styleHeaderRow(ow.getRow(1))
  ordersRows.forEach((r) => ow.addRow({ ...r, order_date: fmtDate(r.order_date) }))
  ;['D', 'E', 'F'].forEach((c) => moneyCol(ow, c))

  const ew = wb.addWorksheet('Expenses')
  ew.columns = [
    { header: 'Date', key: 'expense_date', width: 14 }, { header: 'Category', key: 'category', width: 16 },
    { header: 'Description', key: 'description', width: 28 }, { header: 'Amount', key: 'amount', width: 14 }
  ]
  styleHeaderRow(ew.getRow(1))
  expenseRows.forEach((r) => ew.addRow({ ...r, expense_date: fmtDate(r.expense_date), category: catLabel[r.category] || r.category }))
  moneyCol(ew, 'D')

  return wb.xlsx.writeBuffer()
}

export async function buildMaterialsWorkbook(rows, summary) {
  const wb = new ExcelJS.Workbook()
  wb.creator = BRAND
  const ws = wb.addWorksheet('Materials')
  ws.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Category', key: 'category', width: 14 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Qty On Hand', key: 'quantity_on_hand', width: 14 },
    { header: 'Reorder At', key: 'reorder_threshold', width: 12 },
    { header: 'Unit Cost', key: 'unit_cost', width: 12 },
    { header: 'Value', key: 'value', width: 14 }
  ]
  styleHeaderRow(ws.getRow(1))
  rows.forEach((r) => {
    const row = ws.addRow({ ...r, category: CAT_LABEL[r.category] || r.category, value: Number(r.quantity_on_hand) * Number(r.unit_cost) })
    if (Number(r.quantity_on_hand) <= Number(r.reorder_threshold)) {
      row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } } })
    }
  })
  const totalsRow = ws.addRow({ name: 'TOTAL', value: summary.totalValue })
  totalsRow.font = { bold: true }
  ;['F', 'G'].forEach((c) => moneyCol(ws, c))
  ws.autoFilter = { from: 'A1', to: 'G1' }
  return wb.xlsx.writeBuffer()
}

export async function buildVendorsWorkbook(rows) {
  const wb = new ExcelJS.Workbook()
  wb.creator = BRAND
  const ws = wb.addWorksheet('Vendors')
  ws.columns = [
    { header: 'Vendor', key: 'name', width: 24 },
    { header: 'Email', key: 'contact_email', width: 26 },
    { header: 'Phone', key: 'contact_phone', width: 16 },
    { header: 'Total Paid', key: 'totalPaid', width: 14 },
    { header: 'Open POs', key: 'openPOs', width: 12 }
  ]
  styleHeaderRow(ws.getRow(1))
  rows.forEach((r) => ws.addRow(r))
  moneyCol(ws, 'D')
  ws.autoFilter = { from: 'A1', to: 'E1' }
  return wb.xlsx.writeBuffer()
}

export async function buildTaxSummaryWorkbook({ year, quarters, vendorTotals, businessTaxPaid }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = BRAND

  const qw = wb.addWorksheet('Quarterly Sales Tax')
  qw.columns = [
    { header: 'Quarter', key: 'quarter', width: 12 },
    { header: 'Revenue', key: 'revenue', width: 16 },
    { header: 'Sales Tax', key: 'tax', width: 16 }
  ]
  styleHeaderRow(qw.getRow(1))
  quarters.forEach((q) => qw.addRow({ quarter: `Q${q.quarter} ${year}`, revenue: q.revenue, tax: q.tax }))
  const qTotal = qw.addRow({ quarter: 'Year Total', revenue: quarters.reduce((a, q) => a + q.revenue, 0), tax: quarters.reduce((a, q) => a + q.tax, 0) })
  qTotal.font = { bold: true }
  ;['B', 'C'].forEach((c) => moneyCol(qw, c))

  const vw = wb.addWorksheet('Vendor Payments (1099)')
  vw.columns = [
    { header: 'Vendor', key: 'name', width: 24 },
    { header: 'Total Paid', key: 'total', width: 14 },
    { header: '1099 Threshold ($600+)', key: 'flag', width: 20 }
  ]
  styleHeaderRow(vw.getRow(1))
  vendorTotals.forEach((v) => vw.addRow({ name: v.name, total: v.total, flag: v.total >= 600 ? 'Review' : '' }))
  moneyCol(vw, 'B')

  const bw = wb.addWorksheet('Business Tax')
  bw.columns = [{ header: '', key: 'label', width: 30 }, { header: '', key: 'value', width: 16 }]
  bw.addRow({ label: `Total Business Tax Paid (${year})`, value: businessTaxPaid })
  moneyCol(bw, 'B')

  return wb.xlsx.writeBuffer()
}

// Fixed test — generates a real PDF using jsPDF then emails it
import nodemailer from 'nodemailer'
import 'dotenv/config'
import { jsPDF } from 'jspdf'

const TO_EMAIL = 'shmamraniltd@gmail.com'

// ─── Build a real proposal-style PDF ─────────────────────────────────────────
const doc = new jsPDF({ unit: 'pt', format: 'letter' })

// Background
doc.setFillColor(26, 26, 46)
doc.rect(0, 0, 612, 792, 'F')

// Header bar
doc.setFillColor(34, 211, 238)
doc.rect(0, 0, 612, 90, 'F')

// Company name
doc.setTextColor(26, 26, 46)
doc.setFontSize(28)
doc.setFont('helvetica', 'bold')
doc.text('SIGNAGE CRAFTING', 40, 56)

// Tagline
doc.setFontSize(11)
doc.setFont('helvetica', 'normal')
doc.text('Professional Signage Solutions', 40, 76)

// Proposal title
doc.setTextColor(34, 211, 238)
doc.setFontSize(20)
doc.setFont('helvetica', 'bold')
doc.text('PROPOSAL', 40, 130)

// Client info
doc.setTextColor(255, 255, 255)
doc.setFontSize(13)
doc.setFont('helvetica', 'normal')
doc.text('Client:   Test Client', 40, 165)
doc.text('Email:    shmamraniltd@gmail.com', 40, 185)
doc.text(`Date:     ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 40, 205)
doc.text('Ref:      TEST-001', 40, 225)

// Divider
doc.setDrawColor(34, 211, 238)
doc.setLineWidth(1)
doc.line(40, 245, 572, 245)

// Item header
doc.setFillColor(22, 33, 62)
doc.rect(40, 258, 532, 28, 'F')
doc.setTextColor(34, 211, 238)
doc.setFontSize(11)
doc.setFont('helvetica', 'bold')
doc.text('Sign Type', 52, 276)
doc.text('Size', 250, 276)
doc.text('Price', 470, 276)

// Items
const items = [
  { type: '3D Metal Back-lit Sign', size: '36in x 24in', price: '$962.00' },
  { type: 'LED Channel Letters', size: '48in x 12in', price: '$1,450.00' },
  { type: 'Illuminated Cabinet Sign', size: '60in x 36in', price: '$2,180.00' }
]

doc.setTextColor(200, 210, 230)
doc.setFont('helvetica', 'normal')
doc.setFontSize(11)
items.forEach((item, i) => {
  const y = 304 + i * 30
  if (i % 2 === 0) {
    doc.setFillColor(20, 30, 55)
    doc.rect(40, y - 14, 532, 28, 'F')
  }
  doc.text(item.type, 52, y)
  doc.text(item.size, 250, y)
  doc.text(item.price, 470, y)
})

// Total
doc.setDrawColor(34, 211, 238)
doc.line(40, 408, 572, 408)
doc.setTextColor(34, 211, 238)
doc.setFont('helvetica', 'bold')
doc.setFontSize(14)
doc.text('TOTAL:', 390, 432)
doc.setTextColor(255, 255, 255)
doc.text('$4,592.00', 450, 432)

// Discount note
doc.setFontSize(10)
doc.setTextColor(100, 180, 100)
doc.setFont('helvetica', 'italic')
doc.text('* 5% early-acceptance discount has been applied.', 40, 460)

// Footer
doc.setFillColor(34, 211, 238)
doc.rect(0, 740, 612, 52, 'F')
doc.setTextColor(26, 26, 46)
doc.setFont('helvetica', 'bold')
doc.setFontSize(11)
doc.text('Signage Crafting  |  info@signagecrafting.com', 40, 768)

// Get PDF as Buffer
const pdfBuffer = Buffer.from(doc.output('arraybuffer'))
console.log(`✅ PDF generated — ${Math.round(pdfBuffer.length / 1024)} KB`)

// ─── Send via SMTP ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: { rejectUnauthorized: false }
})

console.log(`\n📧 Sending proposal email with PDF to ${TO_EMAIL}...`)

try {
  const proposalDateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const clientName = 'Alexis Bradshaw'

  const info = await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'Signage Crafting'}" <${process.env.SMTP_USER}>`,
    to: TO_EMAIL,
    subject: `Your Custom Signage Proposal Is Ready, ${clientName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 24px 30px; text-align: left;">
          <h1 style="color: #38bdf8; font-size: 22px; font-weight: 800; margin: 0; letter-spacing: 0.5px;">Signage Crafting</h1>
        </div>
        <div style="padding: 30px; font-size: 15px; line-height: 1.65; color: #334155;">
          <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin-top: 0;">Hi ${clientName},</p>
          
          <p style="margin-bottom: 16px;">Your custom signage proposal is ready for review — I think you'll be pleased with how it turned out.</p>
          
          <p style="margin-bottom: 12px;">To move this project forward with no surprises, here's what's included:</p>
          
          <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px 20px; margin: 18px 0;">
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="margin-bottom: 10px; color: #0369a1; font-size: 14.5px;">
                <span style="color: #0284c7; font-weight: bold; margin-right: 8px;">•</span><strong>10% discount</strong>, locked in through <strong>${proposalDateStr}</strong>
              </li>
              <li style="margin-bottom: 10px; color: #0369a1; font-size: 14.5px;">
                <span style="color: #0284c7; font-weight: bold; margin-right: 8px;">•</span><strong>Unlimited design revisions</strong> included, so we can fine-tune the details together
              </li>
              <li style="color: #0369a1; font-size: 14.5px;">
                <span style="color: #0284c7; font-weight: bold; margin-right: 8px;">•</span><strong>Professional installation</strong> and mounting kit.
              </li>
            </ul>
          </div>

          <div style="display: inline-block; background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 6px; margin: 12px 0 20px 0;">
            📎 Proposal PDF attached for your review
          </div>
          
          <p style="margin-bottom: 16px;">Take a look and let me know your thoughts — happy to adjust anything that's not quite right. Once you're ready to move forward, I'll send a secure payment link along with a clear timeline for production.</p>
          
          <p style="margin-bottom: 24px;">I'm available by email or phone if you'd like to talk through the design or next steps.</p>
          
          <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0 0 6px 0; color: #64748b; font-size: 14px;">Best,</p>
            <p style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0;">Steven <span style="font-weight: 400; color: #64748b; font-size: 14px;">| Customer Relationship</span></p>
            <p style="font-size: 15px; font-weight: 700; color: #0284c7; margin: 0 0 6px 0;">Signage Crafting</p>
            <div style="font-size: 13.5px; color: #64748b;">
              <a href="mailto:Info@signagecrafting.com" style="color: #0284c7; text-decoration: none; font-weight: 600;">Info@signagecrafting.com</a><br/>
              <a href="https://signagecrafting.com" target="_blank" style="color: #0284c7; text-decoration: none;">https://signagecrafting.com</a>
            </div>
          </div>
        </div>
      </div>
    `,
    attachments: [
      {
        filename: 'Alexis_Bradshaw_Proposal.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  })

  console.log('\n✅ EMAIL SENT SUCCESSFULLY!')
  console.log('   Message ID:', info.messageId)
  console.log('   Check inbox:', TO_EMAIL)
  console.log('   (Also check Spam if not visible in 2 minutes)')
} catch (err) {
  console.error('\n❌ Send failed:', err.message)
  process.exit(1)
}

// Quick SMTP connectivity test — run with: node test-smtp.js
import nodemailer from 'nodemailer'
import 'dotenv/config'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true, // SSL
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: { rejectUnauthorized: false }
})

console.log('🔌 Testing SMTP connection to Hostinger...')
console.log('   Host:', process.env.SMTP_HOST)
console.log('   Port:', process.env.SMTP_PORT)
console.log('   User:', process.env.SMTP_USER)

try {
  await transporter.verify()
  console.log('✅ SMTP connection verified! Credentials are working.')

  // Send a real test email to yourself
  const testEmail = process.env.SMTP_USER // send to yourself
  const info = await transporter.sendMail({
    from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
    to: testEmail,
    subject: '✅ Luminus SMTP Test — Connection Working',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #22d3ee;">🎉 SMTP is Working!</h2>
        <p>This is an automated test from your <strong>Luminus Proposal System</strong>.</p>
        <p>Your Hostinger SMTP is configured correctly and ready to send proposals to clients.</p>
        <hr/>
        <small>Sent at ${new Date().toLocaleString()}</small>
      </div>
    `
  })

  console.log('✅ Test email sent! Message ID:', info.messageId)
  console.log('   Check the inbox of:', testEmail)
} catch (error) {
  console.error('❌ SMTP Error:', error.message)
  if (error.code === 'ECONNREFUSED') {
    console.log('💡 Try port 587 instead of 465 in your .env (SMTP_PORT=587)')
  }
  if (error.responseCode === 535) {
    console.log('💡 Authentication failed — check SMTP_USER and SMTP_PASS in .env')
  }
  process.exit(1)
}

import nodemailer from 'nodemailer';
import fetch from 'node-fetch';

export default async function handler(req, res) {
    // CORS Handling
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    )

    if (req.method === 'OPTIONS') {
        res.status(200).end()
        return
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { clientName, clientEmail, pdfBase64, companyId } = req.body;

    if (!clientEmail || !pdfBase64) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const smtpHost = process.env.SMTP_HOST || 'smtp.hostinger.com';
        const smtpPort = parseInt(process.env.SMTP_PORT || '465');
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        const fromName = process.env.SMTP_FROM_NAME || 'Signage Crafting';

        if (smtpUser && smtpPass) {
            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port: smtpPort,
                secure: smtpPort === 465,
                auth: {
                    user: smtpUser,
                    pass: smtpPass
                },
                tls: {
                    rejectUnauthorized: false
                }
            });

            const safeClientName = (clientName || 'Client').replace(/[^a-z0-9]/gi, '_');
            const fileName = `${safeClientName}_Proposal.pdf`;
            const pdfBuffer = Buffer.from(pdfBase64, 'base64');
            const proposalDateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

            const info = await transporter.sendMail({
                from: `"${fromName}" <${smtpUser}>`,
                to: clientEmail,
                cc: 'junev8316@gmail.com',
                subject: `Your Custom Signage Proposal Is Ready, ${clientName || 'Valued Client'}`,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 24px 30px; text-align: left;">
                        <h1 style="color: #38bdf8; font-size: 22px; font-weight: 800; margin: 0; letter-spacing: 0.5px;">Signage Crafting</h1>
                      </div>
                      <div style="padding: 30px; font-size: 15px; line-height: 1.65; color: #334155;">
                        <p style="font-size: 16px; font-weight: 600; color: #0f172a; margin-top: 0;">Hi ${clientName || 'there'},</p>
                        
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
                        filename: fileName,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    }
                ]
            });

            // Ping N8N webhook in background if configured
            const webhookUrl = process.env.N8N_EMAIL_WEBHOOK || process.env.VITE_N8N_EMAIL_WEBHOOK || 'http://8.208.125.43:5678/webhook/email-pdf';
            if (webhookUrl) {
                fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clientName,
                        clientEmail,
                        companyId,
                        date: new Date().toISOString(),
                        messageId: info.messageId
                    })
                }).catch(err => console.warn('N8N webhook ping failed:', err.message));
            }

            return res.status(200).json({ success: true, serviceUsed: 'SMTP', messageId: info.messageId });
        }

        // Fallback to N8N webhook directly if SMTP not configured
        const webhookUrl = process.env.N8N_EMAIL_WEBHOOK || process.env.VITE_N8N_EMAIL_WEBHOOK || 'http://8.208.125.43:5678/webhook/email-pdf';
        if (!webhookUrl) {
            throw new Error('Neither SMTP credentials nor N8N_EMAIL_WEBHOOK configured');
        }

        const webhookResponse = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientName,
                clientEmail,
                pdfBase64,
                companyId,
                timestamp: new Date().toISOString()
            })
        });

        if (!webhookResponse.ok) {
            const errorText = await webhookResponse.text();
            throw new Error(`N8N Error: ${webhookResponse.status} - ${errorText}`);
        }

        return res.status(200).json({ success: true, serviceUsed: 'N8N' });

    } catch (error) {
        console.error('Email API Error:', error);
        return res.status(500).json({
            error: 'Failed to send email',
            details: error.message
        });
    }
}

import fetch from 'node-fetch'

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST')
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')

    if (req.method === 'OPTIONS') {
        return res.status(200).end()
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    try {
        const { clientName, clientEmail, items, totalAmount } = req.body

        // Generate a unique payment reference
        const paymentRef = `PAY-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`

        // Forward to N8N webhook if configured
        const n8nWebhook = process.env.VITE_N8N_PAYMENT_WEBHOOK || 'http://8.208.125.43:5678/webhook/payment'

        if (n8nWebhook) {
            try {
                await fetch(n8nWebhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        paymentRef,
                        clientName,
                        clientEmail,
                        items,
                        totalAmount,
                        timestamp: new Date().toISOString()
                    })
                })
            } catch (webhookError) {
                console.warn('N8N webhook failed:', webhookError.message)
            }
        }

        // Return payment link
        const paymentLink = `https://pay.signagecrafting.com/${paymentRef}`

        return res.status(200).json({
            paymentLink,
            paymentRef,
            success: true
        })

    } catch (error) {
        console.error('Payment API Error:', error)
        return res.status(500).json({
            error: 'Payment link generation failed',
            details: error.message
        })
    }
}

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
        const { name, price, size, image, signType, timestamp } = req.body

        const googleScriptUrl = process.env.VITE_GOOGLE_SHEETS_SCRIPT_URL
        const n8nWebhook = process.env.VITE_N8N_SHEETS_WEBHOOK || 'http://8.208.125.43:5678/webhook/sheets'

        if (!googleScriptUrl && !n8nWebhook) {
            return res.status(200).json({
                success: false,
                message: 'No webhooks configured. Data logged locally.',
                data: { name, price, size, image, timestamp }
            })
        }

        // Google Apps Script Payload (Strict Schema)
        const googlePayload = {
            productName: `${name} - ${signType || 'Signage'}`,
            price: price,
            size: size,
            imageUrl: image
        }

        // N8N Payload (Flexible)
        const n8nPayload = {
            name,
            price,
            size,
            image,
            signType,
            timestamp: timestamp || new Date().toISOString()
        }

        const promises = []

        // 1. Send to Google Apps Script
        if (googleScriptUrl) {
            const p1 = fetch(googleScriptUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(googlePayload)
            })
            promises.push(p1)
        }

        // 2. Send to N8N
        if (n8nWebhook) {
            const p2 = fetch(n8nWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(n8nPayload)
            })
            promises.push(p2)
        }

        await Promise.all(promises)

        return res.status(200).json({ success: true, message: 'Data sent to configured webhooks' })

    } catch (error) {
        console.error('Sheets API Error:', error)
        // Don't crash frontend if webhook fails
        return res.status(200).json({ success: false, message: 'Webhook error, check server logs' })
    }
}

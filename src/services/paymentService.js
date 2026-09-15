/**
 * Payment Service
 * Handles payment link generation and Google Sheets integration
 */

const WEBHOOK_URL = import.meta.env.VITE_N8N_PAYMENT_WEBHOOK || ''
const SHEETS_WEBHOOK_URL = import.meta.env.VITE_N8N_SHEETS_WEBHOOK || ''

/**
 * Generate payment link for proposal
 * @param {Object} data - Payment data
 * @returns {Promise<string>} - Payment link URL
 */
export const generatePaymentLink = async (data) => {
    const { clientName, clientEmail, items, totalAmount } = data

    try {
        const response = await fetch('/api/payment-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientName,
                clientEmail,
                items,
                totalAmount,
                timestamp: new Date().toISOString()
            })
        })

        if (!response.ok) {
            throw new Error('Failed to generate payment link')
        }

        const result = await response.json()
        return result.paymentLink
    } catch (error) {
        console.error('Payment link error:', error)
        throw error
    }
}

/**
 * Send proposal data to Google Sheets via N8N
 * @param {Object} data - Proposal data
 * @returns {Promise<boolean>}
 */
export const sendToGoogleSheets = async (data) => {
    const { clientName, pricing, selectedSize, imageUrl } = data

    try {
        // Get first price from pricing table
        const priceEntry = pricing.find(p => p.size === selectedSize) || pricing[0]

        const response = await fetch('/api/send-to-sheets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: clientName,
                price: priceEntry.cost,
                size: priceEntry.dim,
                image: imageUrl || '', // Image URL if available
                timestamp: new Date().toISOString()
            })
        })

        if (!response.ok) {
            throw new Error('Failed to send to Google Sheets')
        }

        return true
    } catch (error) {
        console.error('Google Sheets error:', error)
        throw error
    }
}

/**
 * Trigger N8N workflow
 * @param {string} webhookUrl - N8N webhook URL
 * @param {Object} data - Data to send
 * @returns {Promise<Object>}
 */
export const triggerN8NWorkflow = async (webhookUrl, data) => {
    if (!webhookUrl) {
        console.warn('N8N webhook URL not configured')
        return { success: false, error: 'Webhook not configured' }
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })

        return { success: response.ok }
    } catch (error) {
        console.error('N8N workflow error:', error)
        return { success: false, error: error.message }
    }
}

/**
 * Format pricing data for export
 * @param {Array} pages - Proposal pages
 * @param {string} clientName - Client name
 * @returns {Array} - Formatted data rows
 */
export const formatForExport = (pages, clientName) => {
    const rows = []

    pages.forEach((page, pageIndex) => {
        page.pricing.forEach((price) => {
            rows.push({
                clientName,
                pageNumber: pageIndex + 1,
                signType: page.signType,
                size: price.size,
                dimensions: price.dim,
                cost: price.cost,
                image: page.assets[0]?.src || ''
            })
        })
    })

    return rows
}

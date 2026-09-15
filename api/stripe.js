import express from 'express'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

router.get('/pay/:clientId', async (req, res) => {
  const { clientId } = req.params
  const { itemId, priceIdx } = req.query

  try {
    // 1. Fetch Client
    const { data: client, error: clientErr } = await supabase
      .from('import_clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (clientErr || !client) throw new Error('Client not found')

    // 2. Fetch specific item or all items
    let query = supabase.from('import_items').select('*').eq('client_id', clientId)
    if (itemId) {
      query = query.eq('id', itemId)
    }
    const { data: items, error: itemsErr } = await query

    if (itemsErr || !items || items.length === 0) {
      throw new Error('No items found to checkout')
    }

    // 3. Build Line Items
    const lineItems = []

    for (const item of items) {
      // Determine the price to use
      let priceToUse = item.discounted_price || item.original_price || 0
      let itemName = item.sign_type || 'Signage Product'
      let itemDesc = `Dimensions: ${item.dimensions || item.size || 'N/A'}`

      // Calculate a default 15% discount if only original price exists
      if (!item.discounted_price && item.original_price) {
        priceToUse = item.original_price * 0.85
      }

      // Convert to cents
      let unitAmountCents = Math.round(Number(priceToUse) * 100)

      // If the pricing JSON exists and they clicked a specific price index
      if (item.pricing_details && Array.isArray(item.pricing_details) && priceIdx !== undefined) {
        const selectedPrice = item.pricing_details[parseInt(priceIdx)]
        if (selectedPrice) {
          itemName = `${itemName} - ${selectedPrice.size || 'Selected Size'}`
          itemDesc = `Dimensions: ${selectedPrice.dim || 'N/A'}`
          
          let p = selectedPrice.discounted_cost || selectedPrice.discounted || selectedPrice.cost || 0
          if (!selectedPrice.discounted_cost && !selectedPrice.discounted && selectedPrice.cost) {
            p = selectedPrice.cost * 0.85
          }
          unitAmountCents = Math.round(Number(p) * 100)
        }
      }

      // Skip 0 dollar items unless there's only one
      if (unitAmountCents <= 0 && items.length > 1) continue;

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: itemName,
            description: itemDesc
          },
          unit_amount: unitAmountCents > 0 ? unitAmountCents : 100, // Minimum $1 for Stripe
        },
        quantity: 1,
      })
    }

    if (lineItems.length === 0) {
      throw new Error('Total amount is zero, cannot create checkout.')
    }

    const publicUrl = process.env.PUBLIC_URL || 'https://signagecrafting.vercel.app'

    // 4. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email: client.client_email || undefined,
      success_url: `${publicUrl}/?payment=success`,
      cancel_url: `${publicUrl}/?payment=cancelled`,
      metadata: {
        clientId: clientId,
        itemId: itemId || 'all'
      }
    })

    // 5. Redirect to Stripe
    res.redirect(303, session.url)

  } catch (error) {
    console.error('Stripe Checkout Error:', error)
    res.status(500).send(`Payment Error: ${error.message}`)
  }
})

export default router

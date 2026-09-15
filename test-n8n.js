import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const webhookUrl = process.env.VITE_N8N_PAYMENT_WEBHOOK;

console.log('Testing N8N Webhook...');
console.log('URL:', webhookUrl);

if (!webhookUrl) {
    console.error('❌ No webhook URL found in .env');
    process.exit(1);
}

const payload = {
    test: true,
    message: "Hello from local test script",
    timestamp: new Date().toISOString()
};

try {
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    console.log('Response Status:', response.status);
    const text = await response.text();
    console.log('Response Body:', text);

    if (response.ok) {
        console.log('✅ Webhook triggered successfully!');
    } else {
        console.error('❌ Webhook failed with status:', response.status);
    }
} catch (error) {
    console.error('❌ Network error:', error.message);
}

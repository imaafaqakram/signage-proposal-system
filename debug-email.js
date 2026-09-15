import fetch from 'node-fetch';

const debugEmail = async () => {
    console.log('🚀 Sending test email request to local server...');

    try {
        const response = await fetch('http://localhost:3001/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientName: 'Debug Client',
                clientEmail: 'debug@example.com',
                companyId: 'luminus',
                pdfBase64: 'A'.repeat(500000) // Simulate 500KB PDF
            })
        });

        const data = await response.json();
        console.log('Status:', response.status);
        console.log('Response:', JSON.stringify(data, null, 2));

    } catch (error) {
        console.error('❌ Request failed:', error.message);
    }
};

debugEmail();

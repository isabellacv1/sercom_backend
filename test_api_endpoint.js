// Simular exactamente lo que hace el widget Flutter al llamar al endpoint
const https = require('https');

const profileId = "9baf141d-c907-46b2-b83f-0129e13ee7c5";
const url = `https://sercom-backend.onrender.com/reviews/profile/${profileId}`;

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log('Status:', res.statusCode);
      console.log('Count:', Array.isArray(parsed) ? parsed.length : 'not array');
      console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 500));
    } catch (e) {
      console.log('Raw response (first 500 chars):', data.substring(0, 500));
    }
  });
}).on('error', (e) => {
  console.error('Error:', e.message);
});

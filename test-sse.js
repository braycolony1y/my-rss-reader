import http from 'http';

const data = JSON.stringify({ url: "https://voz.vn/t/cac-loi-khuyen-cua-cac-hr-va-sep-cu-da-nhau-the-nao-y-domain-vs-da-nang.1265202/unread" });

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/summary/voz',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk.toString()}`);
  });
  res.on('end', () => {
    console.log('No more data in response.');
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();

#!/usr/bin/env node

const axios = require('axios');

const DEFAULT_SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8600';

function printUsage() {
  console.log(`Usage: node test_axios_request.js [options]

Options:
  --server-url=<url>      API server base URL, default ${DEFAULT_SERVER_URL}
  --device-id=<id>        deviceId to use for /api/axios/request
  --method=<method>       HTTP method for proxied request, default GET
  --url=<url>             Request URL for proxied request, required
  --headers='<json>'      Optional JSON string for request headers
  --data='<json>'         Optional JSON string for request body

Example:
  node test_axios_request.js --device-id=server_local --method=GET --url=https://httpbin.org/get
  node test_axios_request.js --server-url=http://127.0.0.1:8600 --device-id=server_local --method=POST --url=https://httpbin.org/post --data='{"foo":"bar"}'
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};

  args.forEach(arg => {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (!key.startsWith('--')) return;
    result[key.slice(2)] = value;
  });

  return result;
}

async function main() {
  const args = parseArgs();
  const serverUrl = args['server-url'] || DEFAULT_SERVER_URL;
  const deviceId = args['device-id'];
  const method = (args.method || 'GET').toUpperCase();
  const url = args.url;
  const headers = args.headers ? JSON.parse(args.headers) : undefined;
  const data = args.data ? JSON.parse(args.data) : undefined;

  if (!deviceId || !url) {
    printUsage();
    process.exit(1);
  }

  const body = {
    deviceId,
    config: {
      method,
      url,
      headers,
      data,
    },
  };

  try {
    console.log(`Sending request to ${serverUrl}/api/axios/request`);
    console.log('Request body:', JSON.stringify(body, null, 2));

    const response = await axios.post(`${serverUrl}/api/axios/request`, body, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    if (error.response) {
      console.error('Response error status:', error.response.status);
      console.error('Response error data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Request failed:', error.message);
    }
    process.exit(1);
  }
}

main();

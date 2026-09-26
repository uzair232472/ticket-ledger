import assert from 'node:assert';
import test from 'node:test';
import app from './src/app.js';
import http from 'node:http';

test('Express API Health Endpoint responds 200 OK', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  const data = await res.json();

  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.status, 'ok');
  assert.strictEqual(data.project, 'TicketLedger API');
  assert.strictEqual(data.module, 'Module 1 - Project Setup & Architecture');

  await new Promise((resolve) => server.close(resolve));
});

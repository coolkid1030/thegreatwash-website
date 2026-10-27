import test from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTION_URL, readToken, createApi, canSubmit, firstName, confirmationText, formatSignedDate, formatToday } from '../sign-assets/sign-core.js';

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const htmlRes = (status) => ({ status, ok: status < 300, json: async () => { throw new SyntaxError('not json'); } });
const fake = (...responses) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  return fn;
};

test('readToken', () => {
  assert.equal(readToken('?t=abc'), 'abc');
  assert.equal(readToken(''), null);
  assert.equal(readToken('?x=1'), null);
  assert.equal(readToken('?t='), null);
});

test('get maps 200 states', async () => {
  const ready = { state: 'ready', quoteNumber: 'Q1', quoteHtml: '<p>x</p>', contractText: 'c', business: {} };
  const f = fake(res(200, ready));
  const v = await createApi(f).get('tok');
  assert.equal(v.kind, 'ready');
  assert.equal(v.quoteNumber, 'Q1');
  assert.equal(f.calls[0].url, FUNCTION_URL);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { action: 'get', token: 'tok' });
  const s = await createApi(fake(res(200, { state: 'signed', quoteNumber: 'Q1', signedAt: 'x', signerName: 'J' }))).get('t');
  assert.equal(s.kind, 'signed');
  assert.equal((await createApi(fake(res(200, { state: 'replaced' }))).get('t')).kind, 'replaced');
});

test('error mappings', async () => {
  assert.equal((await createApi(fake(res(404, { error: 'invalid' }))).get('t')).kind, 'invalid');
  assert.equal((await createApi(fake(res(410, { error: 'replaced' }))).get('t')).kind, 'replaced');
  const e = await createApi(fake(res(400, { error: 'bad_request' }))).get('t');
  assert.deepEqual(e, { kind: 'error', message: 'Please check your name, signature and the checkbox, then try again.' });
  assert.equal((await createApi(fake(res(500, { error: 'unavailable' }))).get('t')).kind, 'unavailable');
  assert.equal((await createApi(fake(res(413, { error: 'too_large' }))).get('t')).kind, 'unavailable');
  assert.equal((await createApi(fake(new TypeError('network'))).get('t')).kind, 'unavailable');
  assert.equal((await createApi(fake(htmlRes(200))).get('t')).kind, 'unavailable');
  assert.equal((await createApi(fake(htmlRes(502))).get('t')).kind, 'unavailable');
});

test('sign request shape and result', async () => {
  const f = fake(res(200, { state: 'signed', quoteNumber: 'Q1', signedAt: 'x', signerName: 'Jane' }));
  const v = await createApi(f).sign({ token: 't', name: 'Jane', signaturePng: 'data:image/png;base64,AAA', agreed: true });
  assert.equal(v.kind, 'signed');
  const { init } = f.calls[0];
  assert.equal(init.method, 'POST');
  assert.deepEqual(Object.keys(init.headers), ['Content-Type']);
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { action: 'sign', token: 't', name: 'Jane', signaturePng: 'data:image/png;base64,AAA', agreed: true });
});

test('already_signed re-runs get and returns signed', async () => {
  const f = fake(res(409, { error: 'already_signed' }), res(200, { state: 'signed', quoteNumber: 'Q1', signedAt: 'x', signerName: 'J' }));
  const v = await createApi(f).sign({ token: 't', name: 'J', signaturePng: 'p', agreed: true });
  assert.equal(v.kind, 'signed');
  assert.equal(f.calls.length, 2);
  assert.equal(JSON.parse(f.calls[1].init.body).action, 'get');
});

test('contractPdf', async () => {
  const v = await createApi(fake(res(200, { filename: 'a.pdf', pdfBase64: 'QQ==' }))).contractPdf('t');
  assert.deepEqual(v, { kind: 'pdf', filename: 'a.pdf', pdfBase64: 'QQ==' });
  assert.equal((await createApi(fake(res(500, {}))).contractPdf('t')).kind, 'unavailable');
});

test('canSubmit truth table', () => {
  assert.equal(canSubmit({ name: 'Jo', agreed: true, hasInk: true }), true);
  assert.equal(canSubmit({ name: ' J ', agreed: true, hasInk: true }), false);
  assert.equal(canSubmit({ name: 'Jo', agreed: false, hasInk: true }), false);
  assert.equal(canSubmit({ name: 'Jo', agreed: true, hasInk: false }), false);
  assert.equal(canSubmit({ name: '', agreed: true, hasInk: true }), false);
});

test('firstName and confirmationText', () => {
  assert.equal(firstName('  jane   doe '), 'jane');
  assert.equal(confirmationText('  jane   doe '), '✓ Signed. Thank you, jane! A copy is on its way to your email.');
  assert.equal(confirmationText('Jane Doe'), '✓ Signed. Thank you, Jane! A copy is on its way to your email.');
});

test('formatSignedDate', () => {
  assert.equal(formatSignedDate('2026-10-30T22:42:00Z'), 'October 30, 2026');
  assert.equal(formatSignedDate('2026-11-01T03:00:00Z'), 'October 31, 2026');
  assert.equal(formatSignedDate('garbage'), '');
});

test('formatToday uses local date parts', () => {
  assert.equal(formatToday(new Date(2026, 9, 26)), 'October 26, 2026');
  assert.equal(formatToday(new Date(2027, 0, 5)), 'January 5, 2027');
});

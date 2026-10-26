// Pure logic for the signing page. No DOM access, so Node can import it for tests.
export const FUNCTION_URL = 'https://mkwopmwhbkblmxhnylcw.supabase.co/functions/v1/sign-quote';

const BAD_REQUEST_MESSAGE = 'Please check your name, signature and the checkbox, then try again.';

export function readToken(search) {
  const t = new URLSearchParams(search || '').get('t');
  return t ? t : null;
}

export function createApi(fetchFn, url = FUNCTION_URL) {
  async function post(payload) {
    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      return { status: 0, body: null };
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  const unavailable = { kind: 'unavailable' };

  function toView(status, body) {
    if (body === null || typeof body !== 'object') return unavailable;
    if (status === 200) {
      if (body.state === 'ready' || body.state === 'signed') return { ...body, kind: body.state };
      if (body.state === 'replaced') return { kind: 'replaced' };
      return unavailable;
    }
    if (status === 404) return { kind: 'invalid' };
    if (status === 410) return { kind: 'replaced' };
    if (status === 400) return { kind: 'error', message: BAD_REQUEST_MESSAGE };
    return unavailable;
  }

  async function get(token) {
    const { status, body } = await post({ action: 'get', token });
    return toView(status, body);
  }

  async function sign({ token, name, signaturePng, agreed }) {
    const { status, body } = await post({ action: 'sign', token, name, signaturePng, agreed: agreed === true });
    if (status === 409 && body && body.error === 'already_signed') return get(token);
    return toView(status, body);
  }

  async function contractPdf(token) {
    const { status, body } = await post({ action: 'contract-pdf', token });
    if (status === 200 && body && typeof body.pdfBase64 === 'string' && typeof body.filename === 'string') {
      return { kind: 'pdf', filename: body.filename, pdfBase64: body.pdfBase64 };
    }
    return toView(status, body && body.pdfBase64 ? null : body);
  }

  return { get, sign, contractPdf };
}

export function canSubmit({ name, agreed, hasInk }) {
  return String(name || '').trim().length >= 2 && agreed === true && hasInk === true;
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

export function confirmationText(name) {
  return `✓ Signed. Thank you, ${firstName(name)}! A copy is on its way to your email.`;
}

// "October 30, 2026" in Pacific time (matches the server's signed-at display).
export function formatSignedDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

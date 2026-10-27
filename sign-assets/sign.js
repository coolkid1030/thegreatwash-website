import { readToken, createApi, canSubmit, confirmationText, formatSignedDate, formatToday } from './sign-core.js';

const app = document.getElementById('app');
const token = readToken(location.search);
const api = createApi((...a) => fetch(...a));

const MAX_EXPORT_WIDTH = 600; // keeps the exported PNG well under the server's 200,000 byte cap

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) n.append(kid);
  return n;
}
const card = (cls, ...kids) => el('div', { class: 'card ' + cls }, ...kids);
function render(...nodes) { app.replaceChildren(...nodes); window.scrollTo(0, 0); }

function messageCard(text, withContact) {
  const c = card('card--msg', el('p', { text }));
  if (withContact) {
    c.append(
      el('p', {},
        el('a', { href: 'tel:+14259549698', text: '(425) 954-9698' }),
        document.createTextNode(' • '),
        el('a', { href: 'mailto:raymondfree@thegreatwashllc.com', text: 'raymondfree@thegreatwashllc.com' })),
    );
  }
  return c;
}

function showTerminal(view) {
  if (view.kind === 'replaced') return render(messageCard('This quote was updated. Please use the newest email from The Great Wash.'));
  if (view.kind === 'unavailable') return render(messageCard('This page is temporarily unavailable. Please call or text (425) 954-9698 or email raymondfree@thegreatwashllc.com.', true));
  return render(messageCard("This link isn't valid. Please contact The Great Wash."));
}

function quoteSection(html) {
  // Sandboxed with no permissions: no scripts, no same-origin access.
  const frame = el('iframe', { class: 'frame', title: 'Your quote', sandbox: '' });
  frame.srcdoc = html;
  return card('', el('h2', { text: 'Your quote' }), frame);
}

function downloadPdf(btn, label, errBox) {
  return async () => {
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    errBox.hidden = true;
    const r = await api.contractPdf(token);
    btn.disabled = false;
    btn.textContent = label;
    if (r.kind !== 'pdf') {
      errBox.textContent = 'Could not prepare the PDF. Please try again in a moment.';
      errBox.hidden = false;
      return;
    }
    const bin = atob(r.pdfBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = el('a', { href: url, download: r.filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
}

function pdfButton(label) {
  const btn = el('button', { class: 'btn', type: 'button', text: label });
  const err = el('p', { class: 'note' });
  err.hidden = true;
  btn.addEventListener('click', downloadPdf(btn, label, err));
  return el('div', { class: 'actions' }, btn, err);
}

function showSigned(view, justSigned) {
  const text = justSigned ? confirmationText(view.signerName) : '✓ Signed on ' + formatSignedDate(view.signedAt);
  const nodes = [card('card--ok', el('span', { text })), pdfButton('Download signed agreement (PDF)')];
  if (view.quoteHtml) nodes.push(quoteSection(view.quoteHtml));
  render(...nodes);
}

function makePad() {
  const canvas = el('canvas', { class: 'pad', 'aria-label': 'Signature pad' });
  const ctx = canvas.getContext('2d');
  let drawing = false;
  const state = { hasInk: false, onChange: () => {} };

  function size() {
    const ratio = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || (canvas.width === Math.round(w * ratio) && canvas.height === Math.round(h * ratio))) return;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0B1F4B';
    state.hasInk = false;
    state.onChange();
  }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y + 0.01); ctx.stroke();
    if (!state.hasInk) { state.hasInk = true; state.onChange(); }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y); ctx.stroke();
    e.preventDefault();
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  window.addEventListener('resize', size);

  state.canvas = canvas;
  state.size = size;
  state.clear = () => {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
    state.hasInk = false;
    state.onChange();
  };
  // Export a downscaled copy (white background) so a real signature stays under the 200 KB server cap.
  state.export = () => {
    const scale = Math.min(1, MAX_EXPORT_WIDTH / canvas.width);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    const o = out.getContext('2d');
    o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
    o.drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  };
  return state;
}

function showReady(view) {
  const nameInput = el('input', { type: 'text', id: 'name', autocomplete: 'name', maxlength: '100' });
  const pad = makePad();
  const clear = el('button', { class: 'btn btn--small', type: 'button', text: 'Clear' });
  const agree = el('input', { type: 'checkbox', id: 'agree' });
  const submit = el('button', { class: 'btn btn--primary', type: 'button', text: 'Submit' });
  const err = el('p', { class: 'card card--err', role: 'alert' });
  err.hidden = true;
  let submitting = false;

  const update = () => {
    submit.disabled = submitting || !canSubmit({ name: nameInput.value, agreed: agree.checked, hasInk: pad.hasInk });
  };
  pad.onChange = update;
  nameInput.addEventListener('input', update);
  agree.addEventListener('change', update);
  clear.addEventListener('click', pad.clear);

  submit.addEventListener('click', async () => {
    if (submit.disabled) return;
    submitting = true;
    submit.textContent = 'Submitting…';
    err.hidden = true;
    update();
    const name = nameInput.value.trim();
    const v = await api.sign({ token, name, signaturePng: pad.export(), agreed: agree.checked });
    submitting = false;
    if (v.kind === 'signed') return showSigned(v, true);
    if (v.kind === 'error') {
      err.textContent = v.message;
      err.hidden = false;
    } else if (v.kind === 'unavailable') {
      err.textContent = 'Something went wrong sending your signature. Please try again, or call or text (425) 954-9698.';
      err.hidden = false;
    } else {
      return showTerminal(v);
    }
    submit.textContent = 'Submit';
    update();
  });

  const contractBox = el('div', { class: 'contract', tabindex: '0', role: 'region', 'aria-label': 'Agreement text' });
  contractBox.textContent = view.contractText;

  render(
    quoteSection(view.quoteHtml),
    card('', el('h2', { text: 'Agreement' }), contractBox, pdfButton('Download contract (PDF)')),
    card('',
      el('h2', { text: 'Sign below' }),
      el('div', { class: 'field' }, el('label', { for: 'name', text: 'Full name' }), nameInput),
      el('div', { class: 'field' },
        el('div', { class: 'padhead' }, el('span', { class: 'label', text: 'Signature' }), clear),
        pad.canvas),
      el('p', { class: 'note', text: 'Date: ' + formatToday(new Date()) }),
      el('label', { class: 'consent', for: 'agree' }, agree, el('span', { text: 'I agree to the terms above and to sign electronically.' })),
      err,
      submit),
  );
  pad.size();
  update();
}

async function init() {
  if (!token) return showTerminal({ kind: 'invalid' });
  const v = await api.get(token);
  if (v.kind === 'ready') return showReady(v);
  if (v.kind === 'signed') return showSigned(v, false);
  return showTerminal(v);
}

init().catch(() => showTerminal({ kind: 'unavailable' }));

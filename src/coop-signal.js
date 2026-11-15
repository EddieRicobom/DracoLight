// Small MQTT 3.1.1 client for browser WebSockets. The broker only carries room
// announcements and WebRTC setup; game traffic uses encrypted data channels.
const enc = new TextEncoder();
const dec = new TextDecoder();
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const id = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const bytes = (s) => [...enc.encode(s)];
const str = (s) => { const b = bytes(s); return [b.length >> 8, b.length & 255, ...b]; };
function packet(type, body) {
  const length = []; let n = body.length;
  do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; length.push(b); } while (n);
  return Uint8Array.from([type, ...length, ...body]);
}
const connect = (client) => packet(0x10, [...str('MQTT'), 4, 2, 0, 30, ...str(client)]);
const subscribe = (topic, n) => packet(0x82, [n >> 8, n & 255, ...str(topic), 0]);
const unsubscribe = (topic, n) => packet(0xa2, [n >> 8, n & 255, ...str(topic)]);
const publish = (topic, data) => packet(0x30, [...str(topic), ...bytes(data)]);
const PING = Uint8Array.of(0xc0, 0);
function parse(buffer) {
  const messages = []; let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]; let size = 0, factor = 1, pos = offset + 1, digit;
    do { if (pos >= buffer.length || pos - offset > 4) return [messages, buffer.slice(offset)]; digit = buffer[pos++]; size += (digit & 127) * factor; factor *= 128; } while (digit & 128);
    if (size > 65536) throw Error('Oversized signal packet');
    if (pos + size > buffer.length) break;
    const body = buffer.subarray(pos, pos + size);
    if ((first >> 4) === 2) messages.push({ type: 'ready', ok: body[1] === 0 });
    if ((first >> 4) === 3 && body.length >= 2) {
      const len = (body[0] << 8) | body[1];
      if (len + 2 <= body.length && !(first & 1)) messages.push({ type: 'message', topic: dec.decode(body.subarray(2, len + 2)), data: dec.decode(body.subarray(len + 2)) });
    }
    offset = pos + size;
  }
  return [messages, buffer.slice(offset)];
}

export class SignalHub {
  constructor(onOnline = () => {}) {
    this.onOnline = onOnline;
    this.client = `dracolight-${id().replace(/-/g, '').slice(0, 16)}`;
    this.links = BROKERS.map((url) => ({ url, socket: null, ready: false, retry: null, ping: null, buffer: new Uint8Array(0), failures: 0 }));
    this.handlers = new Map(); this.seen = new Set(); this.nextPacket = 1; this.closed = false;
    for (const link of this.links) this.open(link);
  }
  get online() { return this.links.filter((link) => link.ready).length; }
  open(link) {
    if (this.closed) return;
    let socket;
    try { socket = new WebSocket(link.url, 'mqtt'); } catch { this.retry(link); return; }
    link.socket = socket; link.buffer = new Uint8Array(0); socket.binaryType = 'arraybuffer';
    const timeout = setTimeout(() => socket.close(), 8000);
    socket.onopen = () => socket.send(connect(this.client));
    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer) || socket !== link.socket) return;
      try {
        const merged = new Uint8Array(link.buffer.length + event.data.byteLength);
        merged.set(link.buffer); merged.set(new Uint8Array(event.data), link.buffer.length);
        const [messages, rest] = parse(merged); link.buffer = rest;
        for (const message of messages) {
          if (message.type === 'ready') {
            if (!message.ok) { socket.close(); return; }
            clearTimeout(timeout); link.ready = true; link.failures = 0;
            for (const topic of this.handlers.keys()) socket.send(subscribe(topic, this.nextPacket++));
            link.ping = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(PING); }, 25000);
            this.onOnline(this.online);
          } else if (message.type === 'message') this.deliver(message.topic, message.data);
        }
      } catch { socket.close(); }
    };
    socket.onclose = () => {
      clearTimeout(timeout); clearInterval(link.ping); link.ping = null;
      if (socket !== link.socket) return;
      link.socket = null; const wasReady = link.ready; link.ready = false;
      if (wasReady) this.onOnline(this.online);
      this.retry(link);
    };
    socket.onerror = () => socket.close();
  }
  retry(link) {
    if (this.closed || link.retry) return;
    const delay = Math.min(30000, 1500 * 2 ** Math.min(link.failures++, 5));
    link.retry = setTimeout(() => { link.retry = null; this.open(link); }, delay);
  }
  subscribe(topic, handler) {
    let set = this.handlers.get(topic);
    if (!set) { set = new Set(); this.handlers.set(topic, set); for (const link of this.links) if (link.ready) link.socket.send(subscribe(topic, this.nextPacket++)); }
    set.add(handler);
    return () => { set.delete(handler); if (set.size) return; this.handlers.delete(topic); for (const link of this.links) if (link.ready) link.socket.send(unsubscribe(topic, this.nextPacket++)); };
  }
  publish(topic, data) {
    if (!this.online) return false;
    const frame = publish(topic, JSON.stringify({ id: id(), data }));
    for (const link of this.links) if (link.ready) link.socket.send(frame);
    return true;
  }
  deliver(topic, raw) {
    const handlers = this.handlers.get(topic); if (!handlers || raw.length > 32000) return;
    let frame; try { frame = JSON.parse(raw); } catch { return; }
    if (typeof frame?.id !== 'string' || frame.id.length > 80 || !frame.data || typeof frame.data !== 'object') return;
    if (this.seen.has(frame.id)) return;
    this.seen.add(frame.id); if (this.seen.size > 400) this.seen.delete(this.seen.values().next().value);
    for (const handler of [...handlers]) handler(frame.data);
  }
  close() {
    this.closed = true;
    for (const link of this.links) { clearTimeout(link.retry); clearInterval(link.ping); link.socket?.close(); }
    this.handlers.clear();
  }
}

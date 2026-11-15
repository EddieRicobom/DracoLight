import { SignalHub } from './coop-signal.js';

const ROOT = 'dracolight/v1';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const uuid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const clean = (value) => String(value ?? '').replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
const codeOf = () => { const b = crypto.getRandomValues(new Uint8Array(5)); return [...b].map((n) => ALPHABET[n % ALPHABET.length]).join(''); };
export const normalizeRoomCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
const roomTopic = (code) => `${ROOT}/room/${code}`;
const lobbyTopic = `${ROOT}/lobby`;
const validPosition = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 100000;

/**
 * A small multiplayer session for up to four guests. The host owns the world;
 * this module transports JSON but leaves game-state rules to its caller.
 *
 * onMessage(message, peerId) receives data from one connected peer.
 * onPeer({ id, name, connected }) reports joins and departures.
 */
export function createCoop({ onStatus = () => {}, onRooms = () => {}, onPeer = () => {}, onMessage = () => {} } = {}) {
  const self = uuid();
  let role = null, code = null, name = '', hostId = null, watchOff = null, roomOff = null;
  let roomTimer = null, joinTimer = null, joinDeadline = null, roomMap = new Map();
  const peers = new Map();
  const earlyIce = new Map();
  const hub = new SignalHub((online) => {
    if (!online) onStatus('Sem conexão com o lobby. Verifique a rede.');
    else if (role === 'host') announce();
    else if (role === 'guest' && !connected()) joinRequest();
  });

  const status = (value) => onStatus(value);
  const signal = (data) => hub.publish(roomTopic(code), { ...data, code, from: self });
  const connected = () => [...peers.values()].some((peer) => peer.channel?.readyState === 'open');
  function announce() {
    if (role !== 'host' || !code) return;
    hub.publish(lobbyTopic, { type: 'open', code, host: self, name, count: 1 + [...peers.values()].filter((p) => p.channel?.readyState === 'open').length, max: 5 });
  }
  function removePeer(id) {
    const peer = peers.get(id); if (!peer) return;
    peers.delete(id);
    try { peer.pc.close(); } catch { /* already closed */ }
    earlyIce.delete(id);
    onPeer({ id, name: peer.name, connected: false });
    if (role === 'host') announce();
    else if (role === 'guest') status('Anfitrião desconectado.');
  }
  function flush(peer) {
    const channel = peer.channel;
    if (!channel || channel.readyState !== 'open') return;
    while (peer.queue.length && channel.bufferedAmount < 128000) {
      const payload = peer.queue.shift();
      peer.queueBytes -= payload.length;
      channel.send(payload);
    }
  }
  function sendPeer(peer, payload) {
    const channel = peer.channel;
    if (!channel || channel.readyState !== 'open') return false;
    // Preserve event order while a late joiner receives the city's history.
    if (peer.queue.length || channel.bufferedAmount >= 128000) {
      if (peer.queueBytes + payload.length > 2000000) return false;
      peer.queue.push(payload); peer.queueBytes += payload.length;
      flush(peer);
    } else channel.send(payload);
    return true;
  }
  function attachChannel(peer, channel) {
    peer.channel = channel;
    channel.bufferedAmountLowThreshold = 64000;
    channel.onbufferedamountlow = () => flush(peer);
    channel.onopen = () => {
      if (!peers.has(peer.id)) return;
      clearInterval(joinTimer); clearTimeout(joinDeadline);
      status(role === 'host' ? `${peer.name} entrou na sala.` : 'Conectado ao dragão.');
      onPeer({ id: peer.id, name: peer.name, connected: true });
      if (role === 'host') announce();
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 16000) return;
      try {
        const message = JSON.parse(event.data);
        if (message && typeof message === 'object' && !Array.isArray(message) && typeof message.type === 'string') onMessage(message, peer.id);
      } catch { /* malformed peer data */ }
    };
    channel.onclose = () => removePeer(peer.id);
    channel.onerror = () => removePeer(peer.id);
  }
  function newPeer(id, peerName) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { id, name: clean(peerName) || 'Jogador', pc, channel: null, pending: [], queue: [], queueBytes: 0 };
    peers.set(id, peer);
    peer.pending.push(...(earlyIce.get(id) ?? [])); earlyIce.delete(id);
    pc.onicecandidate = ({ candidate }) => { if (candidate && peers.has(id)) signal({ type: 'ice', to: id, candidate: candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') removePeer(id); };
    return peer;
  }
  async function addCandidate(peer, candidate) {
    if (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length > 3000) return;
    if (!peer.pc.remoteDescription) { peer.pending.push(candidate); return; }
    try { await peer.pc.addIceCandidate(candidate); } catch { /* stale candidate */ }
  }
  async function flushCandidates(peer) {
    for (const candidate of peer.pending.splice(0)) await addCandidate(peer, candidate);
  }
  async function hostSignal(m) {
    if (m.type === 'join' && typeof m.from === 'string' && m.from !== self) {
      if (peers.has(m.from)) return;
      if (peers.size >= 4) { signal({ type: 'full', to: m.from }); return; }
      try {
        const peer = newPeer(m.from, m.name);
        attachChannel(peer, peer.pc.createDataChannel('game'));
        await peer.pc.setLocalDescription(await peer.pc.createOffer());
        signal({ type: 'offer', to: peer.id, name, sdp: peer.pc.localDescription.sdp });
        status(`${peer.name} está conectando…`);
      } catch { removePeer(m.from); }
    } else if (m.type === 'answer' && peers.has(m.from) && typeof m.sdp === 'string' && m.sdp.length < 20000) {
      const peer = peers.get(m.from);
      try { await peer.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); await flushCandidates(peer); } catch { removePeer(m.from); }
    } else if (m.type === 'ice' && peers.has(m.from)) await addCandidate(peers.get(m.from), m.candidate);
  }
  async function guestSignal(m) {
    if (hostId && m.from !== hostId) return;
    if (m.type === 'full') { status('Sala cheia.'); clearInterval(joinTimer); clearTimeout(joinDeadline); return; }
    if (m.type === 'offer' && typeof m.sdp === 'string' && m.sdp.length < 20000) {
      if (peers.has(m.from)) return;
      hostId = m.from; clearInterval(joinTimer);
      try {
        const peer = newPeer(m.from, m.name || 'Dragão');
        peer.pc.ondatachannel = ({ channel }) => attachChannel(peer, channel);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        await flushCandidates(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        signal({ type: 'answer', to: hostId, sdp: peer.pc.localDescription.sdp });
        status('Abrindo a conexão com o dragão…');
      } catch { removePeer(m.from); status('Falha ao abrir a conexão.'); }
    } else if (m.type === 'ice' && peers.has(m.from)) await addCandidate(peers.get(m.from), m.candidate);
    else if (m.type === 'ice' && m.candidate && earlyIce.size < 4) {
      const list = earlyIce.get(m.from) ?? [];
      if (list.length < 16) list.push(m.candidate);
      earlyIce.set(m.from, list);
    }
  }
  function receiveSignal(m) {
    if (!m || m.code !== code || m.from === self || (m.to && m.to !== self)) return;
    if (role === 'host') void hostSignal(m);
    else if (role === 'guest') void guestSignal(m);
  }
  function joinRequest() {
    if (role !== 'guest' || !code || connected()) return;
    if (hub.online) signal({ type: 'join', name });
  }
  function resetRoom() {
    clearInterval(roomTimer); clearInterval(joinTimer); clearTimeout(joinDeadline);
    roomTimer = joinTimer = joinDeadline = null;
    roomOff?.(); roomOff = null;
    if (role === 'host' && code) hub.publish(lobbyTopic, { type: 'closed', code, host: self });
    role = null;
    for (const id of [...peers.keys()]) removePeer(id);
    earlyIce.clear();
    code = hostId = null;
  }
  return {
    get role() { return role; },
    get code() { return code; },
    get id() { return self; },
    get online() { return hub.online; },
    get peers() { return [...peers.values()].filter((p) => p.channel?.readyState === 'open').map((p) => ({ id: p.id, name: p.name })); },
    host(hostName = 'Dragão') {
      resetRoom();
      if (!('RTCPeerConnection' in window)) { status('Este navegador não oferece WebRTC.'); return null; }
      role = 'host'; name = clean(hostName) || 'Dragão'; code = codeOf();
      roomOff = hub.subscribe(roomTopic(code), receiveSignal);
      roomTimer = setInterval(announce, 3000); announce();
      status(`Sala ${code} aberta. Aguardando amigos…`);
      return code;
    },
    join(roomCode, guestName = 'Jogador') {
      resetRoom();
      const normalized = normalizeRoomCode(roomCode);
      if (normalized.length !== 5 || [...normalized].some((c) => !ALPHABET.includes(c))) { status('Código de sala inválido.'); return false; }
      if (!('RTCPeerConnection' in window)) { status('Este navegador não oferece WebRTC.'); return false; }
      role = 'guest'; code = normalized; name = clean(guestName) || 'Jogador';
      roomOff = hub.subscribe(roomTopic(code), receiveSignal);
      joinTimer = setInterval(joinRequest, 2000);
      joinDeadline = setTimeout(() => { if (!connected()) { clearInterval(joinTimer); status('Não foi possível encontrar a sala ou conectar. Confira o código e tente novamente.'); } }, 30000);
      setTimeout(joinRequest, 600); status(`Procurando a sala ${code}…`);
      return true;
    },
    watchRooms() {
      if (watchOff) return;
      const emit = () => {
        const now = Date.now();
        for (const [key, room] of roomMap) if (now - room.seenAt > 10000) roomMap.delete(key);
        onRooms([...roomMap.values()].sort((a, b) => b.seenAt - a.seenAt));
      };
      watchOff = hub.subscribe(lobbyTopic, (m) => {
        if (m?.type === 'who') { announce(); return; }
        if (typeof m?.code !== 'string' || !/^[A-HJ-NP-Z2-9]{5}$/.test(m.code) || typeof m.host !== 'string') return;
        const key = `${m.code}:${m.host}`;
        if (m.type === 'closed') roomMap.delete(key);
        else if (m.type === 'open') roomMap.set(key, { code: m.code, name: clean(m.name) || 'Dragão', count: Math.min(5, Math.max(1, Number(m.count) || 1)), max: 5, seenAt: Date.now() });
        emit();
      });
      hub.publish(lobbyTopic, { type: 'who' });
      this.roomSweep = setInterval(emit, 3000); emit();
    },
    stopWatching() { watchOff?.(); watchOff = null; clearInterval(this.roomSweep); roomMap.clear(); },
    send(message) { return this.broadcast(message); },
    broadcast(message, exceptPeerId = null) {
      if (!message || typeof message.type !== 'string') return 0;
      let payload; try { payload = JSON.stringify(message); } catch { return 0; }
      if (payload.length > 16000) return 0;
      let sent = 0;
      for (const peer of peers.values()) if (peer.id !== exceptPeerId && sendPeer(peer, payload)) sent++;
      return sent;
    },
    sendTo(peerId, message) {
      const peer = peers.get(peerId); if (!peer || typeof message?.type !== 'string') return false;
      let payload; try { payload = JSON.stringify(message); } catch { return false; }
      if (payload.length > 16000) return false;
      return sendPeer(peer, payload);
    },
    leave() { resetRoom(); status('Você saiu da sala.'); },
    close() { resetRoom(); this.stopWatching(); hub.close(); },
  };
}

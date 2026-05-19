import { onValue, ref, remove, set } from 'firebase/database';
import { db } from '../firebase/config';

export function createToken() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function createSession(token) {
  await set(ref(db, `sessions/${token}`), {
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
}

export async function uploadLocation(token, myId, lat, lon) {
  await set(ref(db, `sessions/${token}/${myId}/location`), {
    lat,
    lon,
    timestamp: Date.now(),
  });
}

export function subscribeToPartner(token, partnerId, onUpdate) {
  const partnerRef = ref(db, `sessions/${token}/${partnerId}/location`);
  return onValue(partnerRef, (snapshot) => {
    const data = snapshot.val();
    if (data) onUpdate(data);
  });
}

export async function endSession(token) {
  await remove(ref(db, `sessions/${token}`));
}

export async function testConnection() {
  try {
    await set(ref(db, 'test/ping'), { timestamp: Date.now() });
    console.log('Firebase 연결 성공');
  } catch (e) {
    console.log('Firebase 연결 실패:', e.message);
  }
}

export async function uploadUWBToken(sessionToken, myId, uwbToken) {
  await set(ref(db, `sessions/${sessionToken}/${myId}/uwb`), {
    token: uwbToken,
    platform: 'ios',
  });
}

export function subscribeUWBToken(sessionToken, partnerId, onReceived) {
  const tokenRef = ref(db, `sessions/${sessionToken}/${partnerId}/uwb`);
  return onValue(tokenRef, (snapshot) => {
    const data = snapshot.val();
    if (data) onReceived(data);
  });
}
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

export async function uploadUWBToken(sessionToken, myId, uwbToken, platform) {
  await set(ref(db, `sessions/${sessionToken}/${myId}/uwb`), {
    token: uwbToken,
    platform,  // 'ios' or 'android'
  });
}

export function subscribeUWBToken(sessionToken, partnerId, onReceived) {
  const tokenRef = ref(db, `sessions/${sessionToken}/${partnerId}/uwb`);
  return onValue(tokenRef, (snapshot) => {
    const data = snapshot.val();
    if (data) onReceived(data);
  });
}

export async function testConnection() {
  try {
    await set(ref(db, 'test/ping'), { timestamp: Date.now() });
    console.log('Firebase 연결 성공');
  } catch (e) {
    console.log('Firebase 연결 실패:', e.message);
  }
}

export async function uploadStatus(sessionToken, myId, status) {
  const clean = Object.fromEntries(
    Object.entries(status).filter(([_, v]) => v !== undefined && v !== null)
  );
  await set(ref(db, `sessions/${sessionToken}/${myId}/status`), {
    ...clean,
    timestamp: Date.now(),
  });
}

export async function uploadDistance(sessionToken, distance, bearing, mode = "gps", confidence = 0.4) {
  const data = { timestamp: Date.now(), mode, confidence };
  if (distance !== null) data.distance = distance;
  if (bearing !== null) data.bearing = bearing;
  await set(ref(db, `sessions/${sessionToken}/shared`), data);
}

export function subscribeDistance(sessionToken, onUpdate) {
  const distRef = ref(db, `sessions/${sessionToken}/shared`);
  return onValue(distRef, (snapshot) => {
    const data = snapshot.val();
    if (data) onUpdate(data);
  });
}

// 라우터 등록
export async function registerRouter(sessionToken, routerId, lat, lon) {
  await set(ref(db, `sessions/${sessionToken}/routers/${routerId}`), {
    lat,
    lon,
    timestamp: Date.now(),
    active: true,
  });
}

// 주변 라우터 구독
export function subscribeRouters(sessionToken, onUpdate) {
  const routersRef = ref(db, `sessions/${sessionToken}/routers`);
  return onValue(routersRef, (snapshot) => {
    const data = snapshot.val();
    if (data) onUpdate(data);
  });
}

// 라우터가 중계한 위치 업로드
export async function relayLocation(sessionToken, routerId, targetId, lat, lon, rssi) {
  await set(ref(db, `sessions/${sessionToken}/routers/${routerId}/relay/${targetId}`), {
    lat,
    lon,
    rssi,          // 신호 세기 (정확도 가중치용)
    timestamp: Date.now(),
  });
}

// 중계된 위치 구독
export function subscribeRelayed(sessionToken, targetId, onUpdate) {
  // 모든 라우터에서 targetId 중계 데이터 수집
  const sessionRef = ref(db, `sessions/${sessionToken}/routers`);
  return onValue(sessionRef, (snapshot) => {
    const routers = snapshot.val();
    if (!routers) return;

    // 가장 최신 + 신호 강한 라우터 데이터 선택
    let best: any = null;
    Object.values(routers).forEach((router: any) => {
      if (!router.relay?.[targetId]) return;
      const relayed = router.relay[targetId];
      if (!best || relayed.rssi > best.rssi) {
        best = relayed;
      }
    });

    if (best) onUpdate(best);
  });
}

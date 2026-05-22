import { get, ref } from 'firebase/database';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../firebase/config';
import { getBearing, getDistance } from '../services/bearing';
import { requestPermission, watchLocation } from '../services/location';
import * as Session from '../services/session';
import { calculatePosition } from '../services/positioning';
import { startUWB, stopUWB, UWB_ENTER_THRESHOLD, UWB_EXIT_THRESHOLD } from '../services/uwb';
import {
  requestBLEPermissions,
  startAdvertising,
  stopAdvertising,
  startScanning,
  stopScanning,
  rssiToDistance,
} from '../services/ble';

const SESSION_TOKEN = 'TEST001';
const UWB_DIRECTION_THRESHOLD = 10;
const UWB_TIMEOUT_MS = 3000;

function bearingToArrow(bearing: number): string {
  const arrows = ['↑','↗','→','↘','↓','↙','←','↖'];
  return arrows[Math.round(bearing / 45) % 8];
}

type AppMode = 'select' | 'user' | 'router';
type LocationMode = 'gps' | 'uwb';
type DirectionMode = 'gps_bearing' | 'uwb_azimuth';

export default function HomeScreen() {
  const [appMode, setAppMode] = useState<AppMode>('select');

  if (appMode === 'select') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20, padding: 32, backgroundColor: '#f5f5f5' }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>역할 선택</Text>
        <Text style={{ color: '#888' }}>세션: {SESSION_TOKEN}</Text>

        <TouchableOpacity
          style={{ backgroundColor: '#2255ff', padding: 24, borderRadius: 16, width: '100%', alignItems: 'center' }}
          onPress={() => setAppMode('user')}
        >
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>👤 일반 유저</Text>
          <Text style={{ color: '#adf', marginTop: 4 }}>위치 공유 + 상대방 찾기</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{ backgroundColor: '#22aa55', padding: 24, borderRadius: 16, width: '100%', alignItems: 'center' }}
          onPress={() => setAppMode('router')}
        >
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>📡 라우터</Text>
          <Text style={{ color: '#afd', marginTop: 4 }}>BLE 중계 (신호 정확도 향상)</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (appMode === 'router') return <RouterMode sessionToken={SESSION_TOKEN} />;
  return <UserMode sessionToken={SESSION_TOKEN} />;
}

// ── 라우터 모드 ──────────────────────────────
function RouterMode({ sessionToken }: { sessionToken: string }) {
  const [status, setStatus] = useState('시작중...');
  const [bleDevices, setBleDevices] = useState<Record<string, { rssi: number; distance: number }>>({});
  const [relayCount, setRelayCount] = useState(0);
  const [myLoc, setMyLoc] = useState<{ lat: number; lon: number } | null>(null);

  const routerId = useRef(`router_${Date.now()}`);
  const myLocRef = useRef<{ lat: number; lon: number } | null>(null);
  const userLocsRef = useRef<Record<string, { lat: number; lon: number }>>({});

  useEffect(() => {
    const start = async () => {
      const bleOk = await requestBLEPermissions();
      if (!bleOk) { setStatus('BLE 권한 없음'); return; }

      await requestPermission();

      watchLocation(async (loc) => {
        myLocRef.current = loc;
        setMyLoc(loc);
        await Session.registerRouter(sessionToken, routerId.current, loc.lat, loc.lon);
      });

      ['userA', 'userB'].forEach(userId => {
        Session.subscribeToPartner(sessionToken, userId, (data: any) => {
          userLocsRef.current[userId] = { lat: data.lat, lon: data.lon };
        });
      });

      startScanning(async (userId, rssi) => {
        const distance = rssiToDistance(rssi);
        setBleDevices(prev => ({ ...prev, [userId]: { rssi, distance } }));

        const userLoc = userLocsRef.current[userId];
        if (userLoc && myLocRef.current) {
          await Session.relayLocation(
            sessionToken,
            routerId.current,
            userId,
            userLoc.lat,
            userLoc.lon,
            rssi
          );
          setRelayCount(c => c + 1);
          setStatus('BLE 중계 중 ✅');
        }
      });

      setStatus('BLE 스캔 중...');
    };

    start();
    return () => { stopScanning(); };
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 20, backgroundColor: '#0a1a0a' }}>
      <Text style={{ fontSize: 60 }}>📡</Text>
      <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#4f4' }}>라우터 모드</Text>
      <Text style={{ color: '#aaa' }}>{status}</Text>

      <View style={{ backgroundColor: '#111', padding: 16, borderRadius: 12, width: '100%' }}>
        <Text style={{ color: '#4f4', fontWeight: 'bold', marginBottom: 8 }}>BLE 감지 현황</Text>
        {Object.entries(bleDevices).map(([userId, data]) => (
          <Text key={userId} style={{ color: '#aaa' }}>
            {userId}: {data.rssi}dBm → {data.distance.toFixed(1)}m
          </Text>
        ))}
        {Object.keys(bleDevices).length === 0 && (
          <Text style={{ color: '#555' }}>감지된 기기 없음</Text>
        )}
        <Text style={{ color: '#888', marginTop: 8 }}>총 중계 횟수: {relayCount}</Text>
      </View>

      {myLoc && (
        <View style={{ backgroundColor: '#111', padding: 16, borderRadius: 12, width: '100%' }}>
          <Text style={{ color: '#4f4', fontWeight: 'bold' }}>내 위치</Text>
          <Text style={{ color: '#aaa' }}>{myLoc.lat.toFixed(5)}, {myLoc.lon.toFixed(5)}</Text>
        </View>
      )}
    </View>
  );
}

// ── 일반 유저 모드 ──────────────────────────────
function UserMode({ sessionToken }: { sessionToken: string }) {
  const [myId, setMyId] = useState('');
  const [gpsDistance, setGpsDistance] = useState<number | null>(null);
  const [uwbDistance, setUwbDistance] = useState<number | null>(null);
  const [gpsBearing, setGpsBearing] = useState<number | null>(null);
  const [uwbAzimuth, setUwbAzimuth] = useState<number | null>(null);
  const [distanceMode, setDistanceMode] = useState<LocationMode>('gps');
  const [directionMode, setDirectionMode] = useState<DirectionMode>('gps_bearing');
  const [routerCount, setRouterCount] = useState(0);
  const [posMode, setPosMode] = useState<string>('gps');
  const [confidence, setConfidence] = useState(0);

  const partnerLocRef = useRef<{ lat: number; lon: number } | null>(null);
  const uwbActiveRef = useRef(false);
  const lastUwbTimeRef = useRef<number>(0);
  const uwbDistanceRef = useRef<number | null>(null);
  const gpsDistanceRef = useRef<number | null>(null);
  const gpsBearingRef = useRef<number | null>(null);
  const uwbAzimuthRef = useRef<number | null>(null);
  const routerDataRef = useRef<any[]>([]);

  useEffect(() => {
    const assignId = async () => {
      const snapshot = await get(ref(db, `sessions/${sessionToken}/userA`));
      setMyId(!snapshot.exists() ? 'userA' : 'userB');
    };
    assignId();
  }, []);

  useEffect(() => {
    if (!myId) return;
    const partnerId = myId === 'userA' ? 'userB' : 'userA';
    const isHost = myId === 'userA';

    const uploadCurrentStatus = async () => {
      const uwbDist = uwbDistanceRef.current;
      const gpsDist = gpsDistanceRef.current;
      const dMode: LocationMode = uwbActiveRef.current && uwbDist !== null ? 'uwb' : 'gps';
      const dirMode: DirectionMode = (uwbDist !== null && uwbDist < UWB_DIRECTION_THRESHOLD)
        ? 'uwb_azimuth' : 'gps_bearing';
      setDistanceMode(dMode);
      setDirectionMode(dirMode);

      const status: Record<string, any> = {
        distanceMode: dMode,
        directionMode: dirMode,
        platform: Platform.OS,
      };
      if (gpsDist !== null) status.gpsDistance = gpsDist;
      if (uwbDist !== null) status.uwbDistance = uwbDist;
      if (gpsBearingRef.current !== null) status.gpsBearing = gpsBearingRef.current;
      if (uwbAzimuthRef.current !== null) status.uwbAzimuth = uwbAzimuthRef.current;
      await Session.uploadStatus(sessionToken, myId, status);
    };

    const checkUWBTimeout = () => {
      if (uwbActiveRef.current && Date.now() - lastUwbTimeRef.current > UWB_TIMEOUT_MS) {
        console.log('UWB 타임아웃 → GPS 모드');
        uwbActiveRef.current = false;
        uwbDistanceRef.current = null;
        setUwbDistance(null);
      }
    };

    const handleDistanceTransition = (dist: number) => {
      if (!uwbActiveRef.current && dist < UWB_ENTER_THRESHOLD) {
        uwbActiveRef.current = true;
      } else if (uwbActiveRef.current && dist > UWB_EXIT_THRESHOLD) {
        uwbActiveRef.current = false;
        uwbDistanceRef.current = null;
        setUwbDistance(null);
      }
    };

    const start = async () => {
      await Session.testConnection();
      await requestPermission();
      await requestBLEPermissions();

      try {
        await startAdvertising(myId);
      } catch (e) {
        console.log('BLE 광고 실패:', e);
      }

      Session.subscribeRouters(sessionToken, (routers: any) => {
        const routerDataArray = Object.values(routers).flatMap((router: any) => {
          if (!router.relay) return [];
          return Object.entries(router.relay).map(([userId, relayData]: [string, any]) => ({
            lat: router.lat,
            lon: router.lon,
            rssi: relayData.rssi ?? -90,
            targetLat: relayData.lat,
            targetLon: relayData.lon,
          }));
        });
        routerDataRef.current = routerDataArray;
        setRouterCount(Object.keys(routers).length);
      });

      startUWB(
        sessionToken, myId, partnerId,
        ({ distance, azimuth }) => {
          uwbDistanceRef.current = distance;
          uwbAzimuthRef.current = azimuth ?? null;
          setUwbDistance(distance);
          setUwbAzimuth(azimuth ?? null);
          uwbActiveRef.current = true;
          lastUwbTimeRef.current = Date.now();
          uploadCurrentStatus();
        },
        () => {
          uwbActiveRef.current = false;
          uploadCurrentStatus();
        }
      );

      Session.subscribeToPartner(sessionToken, partnerId, (data: any) => {
        partnerLocRef.current = { lat: data.lat, lon: data.lon };
      });

      Session.subscribeRelayed(sessionToken, partnerId, (data: any) => {
        partnerLocRef.current = { lat: data.lat, lon: data.lon };
      });

      if (isHost) {
        watchLocation(async (loc) => {
          await Session.uploadLocation(sessionToken, myId, loc.lat, loc.lon);

          if (partnerLocRef.current) {
            const dist = getDistance(loc.lat, loc.lon, partnerLocRef.current.lat, partnerLocRef.current.lon);
            const bear = getBearing(loc.lat, loc.lon, partnerLocRef.current.lat, partnerLocRef.current.lon);

            gpsDistanceRef.current = dist;
            gpsBearingRef.current = bear;
            setGpsDistance(dist);
            setGpsBearing(bear);

            // UWB 타임아웃 체크
            checkUWBTimeout();

            // GPS/UWB 전환
            handleDistanceTransition(dist);

            // calculatePosition으로 최종 거리 계산
            const result = calculatePosition({
              myGpsPos: { lat: loc.lat, lon: loc.lon },
              partnerGpsPos: partnerLocRef.current,
              routers: routerDataRef.current,
              uwbDistance: uwbActiveRef.current ? uwbDistanceRef.current : null,
              uwbAzimuth: uwbAzimuthRef.current,
            });

            setPosMode(result.mode);
            setConfidence(result.confidence);

            const finalDist = result.distance ?? dist;
            const finalBear = result.bearing ?? bear;
            await Session.uploadDistance(sessionToken, finalDist, finalBear, result.mode, result.confidence);
            await uploadCurrentStatus();
          }
        });
      } else {
        watchLocation(async (loc) => {
          await Session.uploadLocation(sessionToken, myId, loc.lat, loc.lon);
        });

        Session.subscribeDistance(sessionToken, (data: any) => {
          if (data.mode) setPosMode(data.mode);
          if (data.confidence !== undefined) setConfidence(data.confidence);
          gpsDistanceRef.current = data.distance;
          gpsBearingRef.current = data.bearing;
          setGpsDistance(data.distance);
          setGpsBearing(data.bearing);

          // UWB 타임아웃 체크
          checkUWBTimeout();

          // GPS/UWB 전환
          handleDistanceTransition(data.distance);

          uploadCurrentStatus();
        });
      }
    };

    start();
    return () => {
      stopUWB();
      stopAdvertising();
    };
  }, [myId]);

  const displayDistance = distanceMode === 'uwb' ? uwbDistance : gpsDistance;
  const displayBearing = directionMode === 'uwb_azimuth' ? uwbAzimuth : gpsBearing;
  const arrow = displayBearing !== null ? bearingToArrow(displayBearing) : '?';

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 20, backgroundColor: '#f5f5f5' }}>

      {routerCount > 0 && (
        <View style={{ backgroundColor: '#e8ffe8', padding: 8, borderRadius: 8, width: '100%', alignItems: 'center' }}>
          <Text style={{ color: '#228833' }}>📡 라우터 {routerCount}개 연결 → 정확도 향상</Text>
        </View>
      )}

      <View style={{ alignItems: 'center', backgroundColor: '#fff', padding: 32, borderRadius: 20, width: '100%', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 }}>
        <Text style={{ fontSize: 80, lineHeight: 100, textAlign: 'center' }}>{arrow}</Text>
        <Text style={{ fontSize: 36, fontWeight: 'bold', marginTop: 8 }}>
          {displayDistance !== null ? `${displayDistance.toFixed(1)}m` : '-'}
        </Text>
        <Text style={{ color: '#888', marginTop: 4 }}>
          {distanceMode.toUpperCase()} · {directionMode === 'uwb_azimuth' ? 'UWB방향' : 'GPS방향'}
        </Text>
      </View>

      <View style={{ backgroundColor: '#fff', padding: 16, borderRadius: 12, width: '100%' }}>
        <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>디버그</Text>
        <Text>나: {myId} ({Platform.OS}) {myId === 'userA' ? '👑' : '📡'}</Text>
        <Text>GPS 거리: {gpsDistance?.toFixed(1) ?? '-'}m</Text>
        <Text>UWB 거리: {uwbDistance?.toFixed(2) ?? '-'}m</Text>
        <Text>GPS 방향: {gpsBearing?.toFixed(1) ?? '-'}°</Text>
        <Text>UWB azimuth: {uwbAzimuth?.toFixed(3) ?? '-'}</Text>
        <Text>전환: 진입 {UWB_ENTER_THRESHOLD}m / 탈출 {UWB_EXIT_THRESHOLD}m</Text>
        <Text>측위 모드: {posMode} (신뢰도: {(confidence * 100).toFixed(0)}%)</Text>
      </View>
    </View>
  );
}

import { get, ref } from 'firebase/database';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { db } from '../firebase/config';
import { getBearing, getDistance } from '../services/bearing';
import { requestPermission, watchLocation } from '../services/location';
import * as Session from '../services/session';
import { startUWB } from '../services/uwb';

const SESSION_TOKEN = 'TEST001';

export default function HomeScreen() {
  const [myId, setMyId] = useState<string>('');
  const [partnerLoc, setPartnerLoc] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsDistance, setGpsDistance] = useState<number | null>(null);
  const [uwbDistance, setUwbDistance] = useState<number | null>(null);
  const partnerLocRef = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    const assignId = async () => {
      const snapshot = await get(ref(db, `sessions/${SESSION_TOKEN}/userA`));
      if (!snapshot.exists()) {
        setMyId('userA');
        console.log('나는 userA');
      } else {
        setMyId('userB');
        console.log('나는 userB');
      }
    };
    assignId();
  }, []);

  useEffect(() => {
    if (!myId) return;

    const partnerId = myId === 'userA' ? 'userB' : 'userA';

    const start = async () => {
      await Session.testConnection();
      await requestPermission();

      startUWB(SESSION_TOKEN, myId, partnerId, (distance: number) => {
        setUwbDistance(distance);
      });

      Session.subscribeToPartner(SESSION_TOKEN, partnerId, (data: any) => {
        partnerLocRef.current = { lat: data.lat, lon: data.lon };
        setPartnerLoc({ lat: data.lat, lon: data.lon });
        console.log('상대방 위치:', data.lat, data.lon);
      });

      watchLocation(async (loc) => {
        console.log('내 위치:', loc.lat, loc.lon);
        await Session.uploadLocation(SESSION_TOKEN, myId, loc.lat, loc.lon);

        if (partnerLocRef.current) {
          const bearing = getBearing(loc.lat, loc.lon, partnerLocRef.current.lat, partnerLocRef.current.lon);
          const distance = getDistance(loc.lat, loc.lon, partnerLocRef.current.lat, partnerLocRef.current.lon);
          setGpsDistance(distance);
          console.log('GPS 방향:', bearing.toFixed(1), '도');
          console.log('GPS 거리:', distance.toFixed(0), 'm');
        }
      });
    };
    start();
  }, [myId]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: '500' }}>위치 테스트 중...</Text>
      <Text>내 ID: {myId}</Text>
      {gpsDistance !== null && (
        <Text>GPS 거리: {gpsDistance.toFixed(0)}m</Text>
      )}
      {uwbDistance !== null && (
        <Text>UWB 거리: {uwbDistance.toFixed(2)}m</Text>
      )}
      {partnerLoc && (
        <Text>상대방: {partnerLoc.lat.toFixed(5)}, {partnerLoc.lon.toFixed(5)}</Text>
      )}
    </View>
  );
}
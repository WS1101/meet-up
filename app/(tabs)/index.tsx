import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Dimensions, StatusBar, SafeAreaView, ScrollView, Alert, TextInput } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';

// Firebase 관련 임포트
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, update, onDisconnect, remove, serverTimestamp } from 'firebase/database';

// ★ 본인의 Firebase 프로젝트 설정값으로 교체하세요 ★
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://mobileprogramming-dawhat-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const { width } = Dimensions.get('window');
const COLORS = {
  bg: '#FFFFFF',
  surface: '#F9FAFB',
  border: '#E5E7EB',
  text: '#111827',
  textSecondary: '#6B7280',
  primary: '#2563EB',
  accent: '#F97316',
  success: '#10B981',
};

const refinedMapStyle = [{ "elementType": "geometry", "stylers": [{ "color": "#f5f5f5" }] }, { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#ffffff" }] }, { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#d2e5f9" }] }, { "featureType": "poi", "stylers": [{ "visibility": "off" }] }];

export default function Index() {
  const [appState, setAppState] = useState<'TOKEN' | 'MAIN' | 'DONE'>('TOKEN');
  const [activeTab, setActiveTab] = useState<'MAP' | 'ARROW'>('MAP');
  const [distance, setDistance] = useState(0);
  const [heading, setHeading] = useState(0);
  const [myLocation, setMyLocation] = useState<any>(null);
  const [targetLoc, setTargetLoc] = useState<any>(null);
  const [myInviteCode, setMyInviteCode] = useState<string>('');
  const [inputCode, setInputCode] = useState<string>('');
  const [userRole, setUserRole] = useState<'userA' | 'userB' | null>(null);
  const [trackChanges, setTrackChanges] = useState(true);

  const [recentFriends] = useState([
    { id: 1, name: '김철수', date: '방금 전' },
    { id: 2, name: '이영희', date: '2일 전' },
  ]);

  const KOREA_CENTER = { latitude: 37.5564, longitude: 126.9723 };

  // 1. 초기 초대 코드 생성
  useEffect(() => {
    const charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += charSet[Math.floor(Math.random() * charSet.length)];
    setMyInviteCode(code);
  }, []);

  // 2. 위치 실시간 감시 및 Firebase 전송 (onDisconnect 포함)
  useEffect(() => {
    let locSub: any;
    let headSub: any;

    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      let initialLoc = await Location.getCurrentPositionAsync({});
      setMyLocation({ latitude: initialLoc.coords.latitude, longitude: initialLoc.coords.longitude });

      locSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 1 },
        (loc) => {
          const currentPos = {
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            timestamp: Date.now()
          };
          setMyLocation({ latitude: currentPos.lat, longitude: currentPos.lon });

          const roomID = userRole === 'userA' ? myInviteCode : inputCode;
          if (appState === 'MAIN' && roomID && userRole) {
            update(ref(db, `sessions/${roomID}/${userRole}`), currentPos);
          }
        }
      );

      headSub = await Location.watchHeadingAsync((data) => {
        setHeading(data.magHeading);
      });
    })();

    return () => {
      if (locSub) locSub.remove();
      if (headSub) headSub.remove();
    };
  }, [appState, userRole, myInviteCode, inputCode]);

  // 3. 상대방 위치 실시간 수신
  useEffect(() => {
    const roomID = userRole === 'userA' ? myInviteCode : inputCode;
    if (!roomID || appState !== 'MAIN') return;

    const otherUser = userRole === 'userA' ? 'userB' : 'userA';
    const otherRef = ref(db, `sessions/${roomID}/${otherUser}`);

    const unsub = onValue(otherRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.lat && data.lon) {
        setTargetLoc({ latitude: data.lat, longitude: data.lon });
      } else {
        setTargetLoc(null); // 상대방이 나가서 데이터가 삭제되면 점을 지움
      }
    });

    return () => unsub();
  }, [appState, userRole, myInviteCode, inputCode]);

  // 4. 거리 계산
  useEffect(() => {
    if (myLocation && targetLoc) {
      const R = 6371e3;
      const φ1 = myLocation.latitude * Math.PI / 180;
      const φ2 = targetLoc.latitude * Math.PI / 180;
      const Δφ = (targetLoc.latitude - myLocation.latitude) * Math.PI / 180;
      const Δλ = (targetLoc.longitude - myLocation.longitude) * Math.PI / 180;
      const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
      const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      setDistance(Math.round(d));
      if (d <= 5 && d > 0) setAppState('DONE');
    }
  }, [myLocation, targetLoc]);

  // 마커 렌더링 최적화
  useEffect(() => {
    if (activeTab === 'MAP' || appState === 'MAIN') {
      setTrackChanges(true);
      const timer = setTimeout(() => setTrackChanges(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [activeTab, appState]);

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(myInviteCode);
    Alert.alert("복사 완료", "초대 코드가 클립보드에 복사되었습니다.");
  };

  // 방 생성 (방장 userA)
  const createRoom = () => {
    if (!myLocation) return Alert.alert("위치 정보를 가져오는 중입니다.");
    setUserRole('userA');

    const userRef = ref(db, `sessions/${myInviteCode}/userA`);

    // 데이터 생성 및 즉시 삭제 설정
    set(userRef, {
      lat: myLocation.latitude,
      lon: myLocation.longitude,
      timestamp: Date.now(),
      serverCreatedAt: serverTimestamp() // TTL용 타임스탬프
    });
    onDisconnect(userRef).remove(); // 앱 종료 시 자동 삭제

    setAppState('MAIN');
  };

  // 입장 (게스트 userB)
  const joinRoom = (code?: string) => {
    const finalCode = code || inputCode;
    if (finalCode.length < 6) return Alert.alert("올바른 코드를 입력해주세요.");

    setUserRole('userB');
    const userRef = ref(db, `sessions/${finalCode}/userB`);

    set(userRef, {
      lat: myLocation ? myLocation.latitude : 0,
      lon: myLocation ? myLocation.longitude : 0,
      timestamp: Date.now()
    });
    onDisconnect(userRef).remove(); // 앱 종료 시 자동 삭제

    if (code) setInputCode(code);
    setAppState('MAIN');
  };

  const exitSession = async () => {
    const roomID = userRole === 'userA' ? myInviteCode : inputCode;
    if (roomID && userRole) {
      await remove(ref(db, `sessions/${roomID}/${userRole}`));
    }
    setAppState('TOKEN');
    setUserRole(null);
    setTargetLoc(null);
    setDistance(0);
    generateInviteCode();
  };

  const bearing = (start: any, end: any) => {
    if (!start || !end) return 0;
    const startLat = start.latitude * Math.PI / 180;
    const endLat = end.latitude * Math.PI / 180;
    const dLng = (end.longitude - start.longitude) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(endLat);
    const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };

  const arrowRotation = (bearing(myLocation || KOREA_CENTER, targetLoc) - heading + 360) % 360;

  if (appState === 'TOKEN') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.tokenContainer}>
          <Text style={styles.mainTitle}>위치 공유 시작</Text>

          <View style={styles.codeSection}>
            <Text style={styles.sectionLabel}>나의 공유 코드 (방장)</Text>
            <TouchableOpacity style={styles.codeCard} onPress={copyToClipboard}>
              <Text style={styles.codeText}>{myInviteCode || '------'}</Text>
              <Text style={styles.copyHint}>터치하여 복사</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mainStartBtn} onPress={createRoom}>
              <Text style={styles.mainStartBtnText}>방 생성하고 공유 시작</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.shareOptions}>
            <TouchableOpacity style={[styles.shareBtn, { backgroundColor: '#FEE500' }]} onPress={() => Alert.alert("공유", "카카오톡 전송")}>
              <Text style={styles.shareBtnText}>카카오톡</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shareBtn, { backgroundColor: '#E5E7EB' }]} onPress={() => Alert.alert("공유", "문자 전송")}>
              <Text style={styles.shareBtnText}>문자</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shareBtn, { backgroundColor: COLORS.primary }]} onPress={copyToClipboard}>
              <Text style={[styles.shareBtnText, { color: '#fff' }]}>링크 복사</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.joinSection}>
            <Text style={styles.sectionLabel}>초대 코드로 입장 (게스트)</Text>
            <View style={styles.joinInputRow}>
              <TextInput style={styles.joinInput} placeholder="6자리 코드 입력" value={inputCode} onChangeText={setInputCode} maxLength={6} autoCapitalize="characters" />
              <TouchableOpacity style={styles.joinBtn} onPress={() => joinRoom()}><Text style={{color: '#fff', fontWeight: 'bold'}}>입장</Text></TouchableOpacity>
            </View>
          </View>

          <View style={styles.recentSection}>
            <Text style={styles.sectionLabel}>최근 함께한 친구</Text>
            {recentFriends.map(friend => (
              <TouchableOpacity key={friend.id} style={styles.friendItem} onPress={() => joinRoom('TEST01')}>
                <View style={styles.friendProfile}><Text style={styles.friendInitial}>{friend.name[0]}</Text></View>
                <View style={styles.friendInfo}>
                  <Text style={styles.friendName}>{friend.name}</Text>
                  <Text style={styles.friendDate}>{friend.date}</Text>
                </View>
                <Text style={styles.startText}>시작 ›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.tabContainer}>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'MAP' && styles.activeTab]} onPress={() => setActiveTab('MAP')}>
          <Text style={[styles.tabText, activeTab === 'MAP' && styles.activeTabText]}>지도</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'ARROW' && styles.activeTab]} onPress={() => setActiveTab('ARROW')}>
          <Text style={[styles.tabText, activeTab === 'ARROW' && styles.activeTabText]}>방향 {distance > 0 && distance <= 50 && "●"}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.mainView}>
        {activeTab === 'MAP' ? (
          <MapView
            style={styles.full}
            provider={PROVIDER_GOOGLE}
            customMapStyle={refinedMapStyle}
            region={{
              latitude: myLocation ? myLocation.latitude : KOREA_CENTER.latitude,
              longitude: myLocation ? myLocation.longitude : KOREA_CENTER.longitude,
              latitudeDelta: 0.01, longitudeDelta: 0.01,
            }}
          >
            {myLocation && targetLoc && <Polyline coordinates={[myLocation, targetLoc]} strokeWidth={4} strokeColor={COLORS.primary} lineDashPattern={[6, 6]} zIndex={1} />}
            {myLocation && (
              <Marker coordinate={myLocation} anchor={{ x: 0.5, y: 0.5 }} zIndex={100} tracksViewChanges={trackChanges}>
                <View style={styles.simpleMarker}><View style={[styles.dotCore, { backgroundColor: COLORS.primary }]} /></View>
              </Marker>
            )}
            {targetLoc && (
              <Marker coordinate={targetLoc} anchor={{ x: 0.5, y: 0.5 }} zIndex={99} tracksViewChanges={trackChanges}>
                <View style={styles.simpleMarker}><View style={[styles.dotCore, { backgroundColor: COLORS.accent }]} /></View>
              </Marker>
            )}
          </MapView>
        ) : (
          <View style={styles.arrowCenter}>
            <View style={styles.outerCircle}>
              <View style={[styles.arrowWrapper, { transform: [{ rotate: `${arrowRotation}deg` }] }]}>
                <View style={styles.arrowHead} /><View style={styles.arrowStem} />
              </View>
            </View>
            <Text style={styles.arrowSub}>{targetLoc ? "화살표 방향을 따라가세요" : "상대방의 위치를 기다리는 중..."}</Text>
          </View>
        )}
      </View>
      <View style={styles.bottomBar}>
        <View style={styles.infoBox}>
          <Text style={styles.label}>상대방까지</Text>
          <Text style={styles.distValue}>{targetLoc ? `약 ${distance}m` : "연결 대기중"}</Text>
        </View>
        <TouchableOpacity style={styles.exitBtn} onPress={exitSession}>
          <Text style={styles.exitBtnText}>종료</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  full: { flex: 1 },
  tokenContainer: { padding: 24 },
  mainTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 32, marginTop: 20 },
  codeSection: { alignItems: 'center', marginBottom: 24 },
  sectionLabel: { fontSize: 16, fontWeight: '600', marginBottom: 16, alignSelf: 'flex-start' },
  codeCard: { backgroundColor: COLORS.surface, width: '100%', padding: 24, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  codeText: { fontSize: 42, fontWeight: 'bold', letterSpacing: 8, color: COLORS.primary },
  copyHint: { marginTop: 8, color: COLORS.textSecondary, fontSize: 12 },
  mainStartBtn: { backgroundColor: COLORS.text, width: '100%', height: 55, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  mainStartBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  shareOptions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 40 },
  shareBtn: { flex: 0.31, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  shareBtnText: { fontWeight: 'bold', fontSize: 13 },
  joinSection: { marginBottom: 32 },
  joinInputRow: { flexDirection: 'row', gap: 10 },
  joinInput: { flex: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16, fontSize: 16 },
  joinBtn: { backgroundColor: COLORS.text, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  recentSection: { flex: 1, marginTop: 10 },
  friendItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  friendProfile: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EFF6FF', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  friendInitial: { color: COLORS.primary, fontWeight: 'bold', fontSize: 16 },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 16, fontWeight: 'bold' },
  friendDate: { fontSize: 12, color: COLORS.textSecondary },
  startText: { color: COLORS.primary, fontWeight: '600' },
  tabContainer: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: '#fff', zIndex: 10 },
  tabButton: { flex: 1, alignItems: 'center', padding: 15 },
  activeTab: { borderBottomWidth: 3, borderBottomColor: COLORS.primary },
  tabText: { fontSize: 16, color: COLORS.textSecondary },
  activeTabText: { color: COLORS.primary, fontWeight: 'bold' },
  mainView: { flex: 1 },
  arrowCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  outerCircle: { width: 280, height: 280, borderRadius: 140, backgroundColor: '#fff', elevation: 8, justifyContent: 'center', alignItems: 'center' },
  arrowWrapper: { alignItems: 'center', justifyContent: 'center' },
  arrowHead: { width: 0, height: 0, borderLeftWidth: 40, borderLeftColor: 'transparent', borderRightWidth: 40, borderRightColor: 'transparent', borderBottomWidth: 60, borderBottomColor: COLORS.primary },
  arrowStem: { width: 30, height: 60, backgroundColor: COLORS.primary, marginTop: -5 },
  arrowSub: { marginTop: 40, color: COLORS.textSecondary, fontWeight: '600', paddingHorizontal: 20, textAlign: 'center' },
  simpleMarker: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dotCore: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#FFFFFF', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 4 },
  bottomBar: { flexDirection: 'row', padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: COLORS.border, alignItems: 'center' },
  infoBox: { flex: 1 },
  label: { fontSize: 12, color: COLORS.textSecondary },
  distValue: { fontSize: 24, fontWeight: 'bold', color: COLORS.primary },
  exitBtn: { backgroundColor: '#FF4444', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10 },
  exitBtnText: { color: '#fff', fontWeight: 'bold' }
});
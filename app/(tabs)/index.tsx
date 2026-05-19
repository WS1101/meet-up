import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Dimensions, StatusBar, SafeAreaView, ScrollView, Alert, TextInput, KeyboardAvoidingView, Platform, FlatList } from 'react-native';
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

const { width, height } = Dimensions.get('window');
const COLORS = {
  bg: '#FFFFFF',
  surface: '#F9FAFB',
  border: '#E5E7EB',
  text: '#111827',
  textSecondary: '#6B7280',
  primary: '#2563EB',
  accent: '#F97316',
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

  // 대화 및 리퀴드 글래스 관련 상태
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState<string>('');

  // ★ 핵심 뼈대 변경: 서버에서 오는 한 줄을 받아서 앱 내부(UI)에 누적할 히스토리 배열 상태 ★
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const flatListRef = useRef<FlatList>(null);

  // 이전 수신 메시지의 타임스탬프를 기억해서 중복 누적을 방지하는 Ref
  const lastMsgTimestamp = useRef<number>(0);

  const [recentFriends] = useState([
    { id: 1, name: '김철수', date: '방금 전' },
    { id: 2, name: '이영희', date: '2일 전' },
  ]);

  const KOREA_CENTER = { latitude: 37.5564, longitude: 126.9723 };

  const generateInviteCode = () => {
    const charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += charSet[Math.floor(Math.random() * charSet.length)];
    setMyInviteCode(code);
  };

  useEffect(() => {
    generateInviteCode();
  }, []);

  // 2. 위치 실시간 감시 및 Firebase 전송
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
          const currentPos: any = {
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

  // 3. 상대방 위치 실시간 수신 및 ★UI 단독 누적 리스너★
  useEffect(() => {
    const roomID = userRole === 'userA' ? myInviteCode : inputCode;
    if (!roomID || appState !== 'MAIN') return;

    const otherUser = userRole === 'userA' ? 'userB' : 'userA';

    // 상대방 위치 감시
    const otherRef = ref(db, `sessions/${roomID}/${otherUser}`);
    const unsubLocation = onValue(otherRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.lat && data.lon) {
        setTargetLoc({ latitude: data.lat, longitude: data.lon });
      } else {
        setTargetLoc(null);
      }
    });

    // ★ 단일 chat 노드를 보되, 새로운 타임스탬프가 감지되면 UI 배열에 push로 쌓아버림 ★
    const chatRef = ref(db, `sessions/${roomID}/chat`);
    const unsubChat = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.text && data.timestamp !== lastMsgTimestamp.current) {
        lastMsgTimestamp.current = data.timestamp; // 최근 찍힌 시간 낙인

        // 내 폰 화면 상태(History)에만 대화 추가 (서버에는 안 쌓임!)
        setChatHistory((prev) => [
          ...prev,
          { id: String(data.timestamp), sender: data.sender, text: data.text }
        ]);
      }
    });

    return () => {
      unsubLocation();
      unsubChat();
    };
  }, [appState, userRole, myInviteCode, inputCode]);

  // ★ 서버엔 기존 방식대로 set()으로 덮어쓰기 날리기 ★
  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    const roomID = userRole === 'userA' ? myInviteCode : inputCode;
    if (roomID && userRole) {
      const chatRef = ref(db, `sessions/${roomID}/chat`);
      set(chatRef, {
        sender: userRole,
        text: chatInput.trim(),
        timestamp: Date.now()
      });
      setChatInput('');
    }
  };

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

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(myInviteCode);
    Alert.alert("복사 완료", "초대 코드가 클립보드에 복사되었습니다.");
  };

  const createRoom = () => {
    if (!myLocation) return Alert.alert("위치 정보를 가져오는 중입니다.");
    setUserRole('userA');
    const userRef = ref(db, `sessions/${myInviteCode}/userA`);
    set(userRef, {
      lat: myLocation.latitude,
      lon: myLocation.longitude,
      timestamp: Date.now(),
      serverCreatedAt: serverTimestamp()
    });
    onDisconnect(userRef).remove();
    setAppState('MAIN');
  };

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
    onDisconnect(userRef).remove();
    if (code) setInputCode(code);
    setAppState('MAIN');
  };

  const exitSession = async () => {
    const roomID = userRole === 'userA' ? myInviteCode : inputCode;
    if (roomID && userRole) {
      await remove(ref(db, `sessions/${roomID}`));
    }
    setAppState('TOKEN');
    setUserRole(null);
    setTargetLoc(null);
    setDistance(0);
    setChatHistory([]); // 퇴근 시 로컬 UI 대화방도 초기화
    lastMsgTimestamp.current = 0;
    setIsChatOpen(false);
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
                <View style={friend.friendProfile}><Text style={styles.friendInitial}>{friend.name[0]}</Text></View>
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

      {/* 지도 뷰 레이어 */}
      <View style={styles.fullMapContainer}>
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
              <Marker key="me" coordinate={myLocation} anchor={{ x: 0.5, y: 0.5 }} zIndex={100} tracksViewChanges={trackChanges}>
                <View style={styles.simpleMarker}><View style={[styles.dotCore, { backgroundColor: COLORS.primary }]} /></View>
              </Marker>
            )}
            {targetLoc && (
              <Marker key="target" coordinate={targetLoc} anchor={{ x: 0.5, y: 0.5 }} zIndex={99} tracksViewChanges={trackChanges}>
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
          </View>
        )}
      </View>

      {/* 상단 탭 */}
      <View style={styles.glassTabContainer}>
        <TouchableOpacity style={[styles.glassTabBtn, activeTab === 'MAP' && styles.activeGlassTab]} onPress={() => setActiveTab('MAP')}>
          <Text style={[styles.glassTabText, activeTab === 'MAP' && styles.activeGlassTabText]}>지도</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.glassTabBtn, activeTab === 'ARROW' && styles.activeGlassTab]} onPress={() => setActiveTab('ARROW')}>
          <Text style={[styles.glassTabText, activeTab === 'ARROW' && styles.activeGlassTabText]}>방향</Text>
        </TouchableOpacity>
      </View>

      {/* 우측 하단 플로팅 버튼 */}
      {!isChatOpen && (
        <TouchableOpacity style={styles.floatingChatBtn} onPress={() => setIsChatOpen(true)}>
          <Text style={styles.floatingChatBtnText}>💬 대화하기</Text>
        </TouchableOpacity>
      )}

      {/* ★ 리퀴드 글래스 역사 복구 패널 (FlatList 부활) ★ */}
      {isChatOpen && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.glassChatOverlay}>
          <View style={styles.liquidGlassPanel}>
            <View style={styles.glassHeader}>
              <View style={styles.glassHandle} />
              <TouchableOpacity onPress={() => setIsChatOpen(false)} style={styles.glassCloseBtn}>
                <Text style={styles.glassCloseBtnText}>접기 ✕</Text>
              </TouchableOpacity>
            </View>

            {/* 서버엔 한 줄만 있지만 UI 상에는 누적되어 가독성 확보 */}
            <FlatList
              ref={flatListRef}
              data={chatHistory}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 15 }}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => {
                const isMe = item.sender === userRole;
                return (
                  <View style={[styles.chatBubbleWrapper, isMe ? styles.chatMeWrapper : styles.chatOtherWrapper]}>
                    <View style={[styles.liquidBubble, isMe ? styles.liquidBubbleMe : styles.liquidBubbleOther]}>
                      <Text style={[styles.chatText, isMe ? styles.chatTextMe : styles.chatTextOther]}>{item.text}</Text>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyGlassText}>리퀴드 글래스 대화방이 활성화되었습니다.</Text>}
            />

            <View style={styles.glassInputArea}>
              <TextInput
                style={styles.glassTextInput}
                placeholder="메시지 또는 층수 입력..."
                placeholderTextColor="rgba(0,0,0,0.3)"
                value={chatInput}
                onChangeText={setChatInput}
                onSubmitEditing={sendChatMessage}
              />
              <TouchableOpacity style={styles.glassSendBtn} onPress={sendChatMessage}>
                <Text style={styles.glassSendBtnText}>전송</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* 하단 미니 바 */}
      {!isChatOpen && (
        <View style={styles.minimalBottomBar}>
          <View style={styles.miniInfo}>
            <Text style={styles.miniLabel}>상대방 거리</Text>
            <Text style={styles.miniValue}>{targetLoc ? `${distance}m` : '연결 중'}</Text>
          </View>
          <TouchableOpacity style={styles.miniExitBtn} onPress={exitSession}>
            <Text style={styles.miniExitText}>종료</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  full: { flex: 1 },
  fullMapContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tokenContainer: { padding: 24 },
  mainTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 32, marginTop: 20 },
  codeSection: { alignItems: 'center', marginBottom: 24 },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10, alignSelf: 'flex-start' },
  codeCard: { backgroundColor: '#F9FAFB', width: '100%', padding: 24, borderRadius: 20, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center' },
  codeText: { fontSize: 42, fontWeight: 'bold', letterSpacing: 8, color: '#2563EB' },
  copyHint: { marginTop: 8, color: '#6B7280', fontSize: 12 },
  mainStartBtn: { backgroundColor: '#111827', width: '100%', height: 55, borderRadius: 15, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  mainStartBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  shareOptions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32 },
  shareBtn: { flex: 0.31, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  shareBtnText: { fontWeight: 'bold', fontSize: 13 },
  joinSection: { marginBottom: 32 },
  joinInputRow: { flexDirection: 'row', gap: 10 },
  joinInput: { flex: 1, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 16, fontSize: 16 },
  joinBtn: { backgroundColor: '#111827', paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  recentSection: { flex: 1, marginTop: 10 },
  friendItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  friendProfile: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EFF6FF', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  friendInitial: { color: '#2563EB', fontWeight: 'bold', fontSize: 16 },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 16, fontWeight: 'bold' },
  friendDate: { fontSize: 12, color: '#6B7280' },
  startText: { color: '#2563EB', fontWeight: '600' },

  glassTabContainer: { flexDirection: 'row', position: 'absolute', top: 60, alignSelf: 'center', backgroundColor: 'rgba(255, 255, 255, 0.6)', borderRadius: 25, padding: 5, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.4)', zIndex: 10 },
  glassTabBtn: { paddingHorizontal: 25, paddingVertical: 10, borderRadius: 20 },
  activeGlassTab: { backgroundColor: '#fff' },
  glassTabText: { fontSize: 14, color: '#666', fontWeight: '600' },
  activeGlassTabText: { color: '#2563EB' },

  floatingChatBtn: { position: 'absolute', bottom: 110, right: 20, backgroundColor: '#111827', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 25, elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 },
  floatingChatBtnText: { color: '#fff', fontWeight: 'bold' },

  glassChatOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: height * 0.45, zIndex: 999 }, // 높이 밸런스 재조정
  liquidGlassPanel: { flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.85)', borderTopLeftRadius: 35, borderTopRightRadius: 35, borderWidth: 1.5, borderColor: 'rgba(255, 255, 255, 0.5)', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20 },
  glassHeader: { padding: 15, alignItems: 'center', marginBottom: 5 },
  glassHandle: { width: 40, height: 5, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 10, marginBottom: 10 },
  glassCloseBtn: { position: 'absolute', right: 20, top: 15 },
  glassCloseBtnText: { color: '#666', fontWeight: '600' },

  chatBubbleWrapper: { flexDirection: 'row', marginVertical: 4, width: '100%' },
  chatMeWrapper: { justifyContent: 'flex-end' },
  chatOtherWrapper: { justifyContent: 'flex-start' },
  liquidBubble: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, maxWidth: '80%', borderWidth: 1 },
  liquidBubbleMe: { backgroundColor: 'rgba(37, 99, 235, 0.85)', borderColor: 'rgba(255, 255, 255, 0.2)' },
  liquidBubbleOther: { backgroundColor: 'rgba(255, 255, 255, 0.9)', borderColor: 'rgba(0, 0, 0, 0.05)' },
  chatText: { fontSize: 15, lineHeight: 20 },
  chatTextMe: { color: '#fff' },
  chatTextOther: { color: '#333' },
  emptyGlassText: { color: '#999', textAlign: 'center', fontStyle: 'italic', fontSize: 13, marginTop: 50 },

  glassInputArea: { flexDirection: 'row', padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 20, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  glassTextInput: { flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.8)', height: 48, borderRadius: 24, paddingHorizontal: 20, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.5)' },
  glassSendBtn: { marginLeft: 10, backgroundColor: '#111827', paddingHorizontal: 20, borderRadius: 24, justifyContent: 'center' },
  glassSendBtnText: { color: '#fff', fontWeight: 'bold' },

  minimalBottomBar: { position: 'absolute', bottom: 30, left: 20, right: 20, height: 70, backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.5)', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  miniInfo: { flex: 1 },
  miniLabel: { fontSize: 10, color: '#999', fontWeight: 'bold' },
  miniValue: { fontSize: 20, fontWeight: 'bold', color: '#2563EB' },
  miniExitBtn: { backgroundColor: '#FF4444', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 12 },
  miniExitText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },

  mainView: { flex: 1 },
  arrowCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  outerCircle: { width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255, 255, 255, 0.8)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.4)' },
  arrowWrapper: { alignItems: 'center', justifyContent: 'center' },
  arrowHead: { width: 0, height: 0, borderLeftWidth: 30, borderLeftColor: 'transparent', borderRightWidth: 30, borderRightColor: 'transparent', borderBottomWidth: 45, borderBottomColor: '#2563EB' },
  arrowStem: { width: 22, height: 45, backgroundColor: '#2563EB', marginTop: -5 },
  simpleMarker: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  dotCore: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#FFFFFF', elevation: 6 }
});
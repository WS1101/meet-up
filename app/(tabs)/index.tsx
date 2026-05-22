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
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const flatListRef = useRef<FlatList>(null);

  // ★ 신규 상태: 내 닉네임 및 실제 매칭된 친구 기록 배열 (초기값 빈 배열) ★
  const [myNameInput, setMyNameInput] = useState<string>('');
  const [recentFriends, setRecentFriends] = useState<any[]>([]);

  const lastMsgTimestamp = useRef<number>(0);
  const locationSubscription = useRef<any>(null);
  const headingSubscription = useRef<any>(null);

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
    let active = true;

    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      let initialLoc = await Location.getCurrentPositionAsync({ timeout: 5000 }).catch(() => null);
      if (initialLoc && active) {
        setMyLocation({ latitude: initialLoc.coords.latitude, longitude: initialLoc.coords.longitude });
      }

      if (appState === 'MAIN') {
        if (locationSubscription.current) locationSubscription.current.remove();
        if (headingSubscription.current) headingSubscription.current.remove();

        locationSubscription.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 1 },
          (loc) => {
            const currentPos: any = {
              lat: loc.coords.latitude,
              lon: loc.coords.longitude,
              timestamp: Date.now()
            };
            setMyLocation({ latitude: currentPos.lat, longitude: currentPos.lon });

            const roomID = userRole === 'userA' ? myInviteCode : inputCode;
            if (roomID && userRole) {
              update(ref(db, `sessions/${roomID}/${userRole}`), currentPos).catch(e => console.log(e.message));
            }
          }
        );

        headingSubscription.current = await Location.watchHeadingAsync((data) => {
          setHeading(data.magHeading);
        });
      }
    })();

    return () => {
      active = false;
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
      if (headingSubscription.current) {
        headingSubscription.current.remove();
        headingSubscription.current = null;
      }
    };
  }, [appState, userRole, myInviteCode, inputCode]);

  // 3. 상대방 위치 실시간 수신 및 ★진짜 이름 감지 후 최근 기록 누적★
  useEffect(() => {
    const roomID = userRole === 'userA' ? myInviteCode : inputCode;
    if (!roomID || appState !== 'MAIN') return;

    const otherUser = userRole === 'userA' ? 'userB' : 'userA';

    const otherRef = ref(db, `sessions/${roomID}/${otherUser}`);
    const unsubLocation = onValue(otherRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data.lat && data.lon) {
          setTargetLoc({ latitude: data.lat, longitude: data.lon });
        }

        // ★ 상대방이 입장해서 이름을 공유했다면 내 로컬 화면 기록(recentFriends)에 실시간 자동 누적 ★
        if (data.name) {
          setRecentFriends((prev) => {
            // 이미 목록에 존재하는 이름이면 중복 추가 방지
            if (prev.some(f => f.name === data.name)) return prev;
            // 새 친구 목록에 맨 위로 쌓기
            return [{ id: String(Date.now()), name: data.name, date: '방금 전' }, ...prev];
          });
        }
      } else {
        setTargetLoc(null);
      }
    });

    const chatRef = ref(db, `sessions/${roomID}/chat`);
    const unsubChat = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.text && data.timestamp !== lastMsgTimestamp.current) {
        lastMsgTimestamp.current = data.timestamp;
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

  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    const roomID = userRole === 'userA' ? myInviteCode : inputCode;
    if (roomID && userRole) {
      const chatRef = ref(db, `sessions/${roomID}/chat`);
      set(chatRef, {
        sender: userRole,
        text: chatInput.trim(),
        timestamp: Date.now()
      }).catch(e => console.log(e.message));
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

  // 방 생성 (내 이름 탑재)
  const createRoom = async () => {
    if (!myNameInput.trim()) return Alert.alert("확인", "사용하실 닉네임을 먼저 입력해주세요.");
    if (!myLocation) return Alert.alert("알림", "위치 정보를 수신하는 중입니다. 잠시 후 다시 누르세요.");
    setUserRole('userA');

    try {
      const userRef = ref(db, `sessions/${myInviteCode}/userA`);
      await set(userRef, {
        lat: myLocation.latitude,
        lon: myLocation.longitude,
        name: myNameInput.trim(), // 내 이름 업로드!
        timestamp: Date.now(),
        serverCreatedAt: serverTimestamp()
      });
      onDisconnect(userRef).remove();
      setAppState('MAIN');
    } catch (e) {
      Alert.alert("에러", "Firebase Database 권한을 확인하세요.");
    }
  };

  // 입장하기 (내 이름 탑재)
  const joinRoom = async () => {
    if (!myNameInput.trim()) return Alert.alert("확인", "사용하실 닉네임을 먼저 입력해주세요.");
    if (inputCode.length < 6) return Alert.alert("오류", "올바른 6자리 코드를 입력해주세요.");
    setUserRole('userB');

    try {
      const userRef = ref(db, `sessions/${inputCode}/userB`);
      await set(userRef, {
        lat: myLocation ? myLocation.latitude : KOREA_CENTER.latitude,
        lon: myLocation ? myLocation.longitude : KOREA_CENTER.longitude,
        name: myNameInput.trim(), // 내 이름 업로드!
        timestamp: Date.now()
      });
      onDisconnect(userRef).remove();
      setAppState('MAIN');
    } catch (e) {
      Alert.alert("오류", "방 입장에 실패했습니다.");
    }
  };

  // 종료 (최근 친구 목록은 파괴하지 않고 유지)
  const exitSession = async () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    if (headingSubscription.current) {
      headingSubscription.current.remove();
      headingSubscription.current = null;
    }

    const roomID = userRole === 'userA' ? myInviteCode : inputCode;
    if (roomID && userRole) {
      await remove(ref(db, `sessions/${roomID}`)).catch(e => console.log(e.message));
    }

    setAppState('TOKEN');
    setUserRole(null);
    setTargetLoc(null);
    setDistance(0);
    setChatHistory([]);
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

          {/* ★ 심플 UI 디자인: 맨 상단에 배치된 내 닉네임 설정 칸 ★ */}
          <View style={styles.nameSetupCard}>
            <Text style={styles.nameSetupLabel}>나의 닉네임 설정</Text>
            <TextInput
              style={styles.nameSetupInput}
              placeholder="상대방에게 보여질 이름 입력"
              placeholderTextColor="#9CA3AF"
              value={myNameInput}
              onChangeText={setMyNameInput}
              maxLength={10}
            />
          </View>

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
              <TouchableOpacity style={styles.joinBtn} onPress={joinRoom}><Text style={{color: '#fff', fontWeight: 'bold'}}>입장</Text></TouchableOpacity>
            </View>
          </View>

          {/* ★ 최근 함께한 친구 섹션: 처음엔 비어있다가 연동 시 동적 렌더링 ★ */}
          <View style={styles.recentSection}>
            <Text style={styles.sectionLabel}>최근 함께한 친구</Text>
            {recentFriends.length > 0 ? (
              recentFriends.map(friend => (
                <View key={friend.id} style={styles.friendItem}>
                  <View style={styles.friendProfile}><Text style={styles.friendInitial}>{friend.name[0]}</Text></View>
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{friend.name}</Text>
                    <Text style={styles.friendDate}>{friend.date}</Text>
                  </View>
                  <View style={styles.statusBadge}><Text style={styles.statusBadgeText}>기록됨 ✓</Text></View>
                </View>
              ))
            ) : (
              <View style={styles.emptyRecentBox}>
                <Text style={styles.emptyRecentText}>아직 함께 공유한 친구 기록이 없습니다.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

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

      <View style={styles.glassTabContainer}>
        <TouchableOpacity style={[styles.glassTabBtn, activeTab === 'MAP' && styles.activeGlassTab]} onPress={() => setActiveTab('MAP')}>
          <Text style={[styles.glassTabText, activeTab === 'MAP' && styles.activeGlassTabText]}>지도</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.glassTabBtn, activeTab === 'ARROW' && styles.activeGlassTab]} onPress={() => setActiveTab('ARROW')}>
          <Text style={[styles.glassTabText, activeTab === 'ARROW' && styles.activeGlassTabText]}>방향</Text>
        </TouchableOpacity>
      </View>

      {!isChatOpen && (
        <TouchableOpacity style={styles.floatingChatBtn} onPress={() => setIsChatOpen(true)}>
          <Text style={styles.floatingChatBtnText}>💬 대화하기</Text>
        </TouchableOpacity>
      )}

      {isChatOpen && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.glassChatOverlay}>
          <View style={styles.liquidGlassPanel}>
            <View style={styles.glassHeader}>
              <View style={styles.glassHandle} />
              <TouchableOpacity onPress={() => setIsChatOpen(false)} style={styles.glassCloseBtn}>
                <Text style={styles.glassCloseBtnText}>접기 ✕</Text>
              </TouchableOpacity>
            </View>

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
  mainTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, marginTop: 20 },

  // 닉네임 입력 컴포넌트 카드 디자인
  nameSetupCard: { backgroundColor: '#F3F4F6', padding: 16, borderRadius: 16, borderHorizontal: 1, borderColor: '#E5E7EB', marginBottom: 24 },
  nameSetupLabel: { fontSize: 13, fontWeight: '700', color: '#4B5563', marginBottom: 6 },
  nameSetupInput: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, paddingHorizontal: 14, height: 44, fontSize: 14, color: '#111827' },

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

  // 친구 목록 UI 구조화
  recentSection: { flex: 1, marginTop: 10, paddingBottom: 40 },
  friendItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', padding: 14, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  friendProfile: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EFF6FF', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  friendInitial: { color: '#2563EB', fontWeight: 'bold', fontSize: 15 },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 15, fontWeight: 'bold', color: '#111827' },
  friendDate: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  statusBadge: { backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusBadgeText: { color: '#10B981', fontWeight: '700', fontSize: 11 },
  emptyRecentBox: { backgroundColor: '#F9FAFB', borderStyle: 'dashed', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 16, paddingVertical: 30, alignItems: 'center', justifyContent: 'center' },
  emptyRecentText: { color: '#9CA3AF', fontSize: 13, fontWeight: '500' },

  glassTabContainer: { flexDirection: 'row', position: 'absolute', top: 60, alignSelf: 'center', backgroundColor: 'rgba(255, 255, 255, 0.6)', borderRadius: 25, padding: 5, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.4)', zIndex: 10 },
  glassTabBtn: { paddingHorizontal: 25, paddingVertical: 10, borderRadius: 20 },
  activeGlassTab: { backgroundColor: '#fff' },
  glassTabText: { fontSize: 14, color: '#666', fontWeight: '600' },
  activeGlassTabText: { color: '#2563EB' },
  floatingChatBtn: { position: 'absolute', bottom: 110, right: 20, backgroundColor: '#111827', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 25, zIndex: 10 },
  floatingChatBtnText: { color: '#fff', fontWeight: 'bold' },
  glassChatOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: height * 0.45, zIndex: 999 },
  liquidGlassPanel: { flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.85)', borderTopLeftRadius: 35, borderTopRightRadius: 35, borderWidth: 1.5, borderColor: 'rgba(255, 255, 255, 0.5)' },
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
  minimalBottomBar: { position: 'absolute', bottom: 30, left: 20, right: 20, height: 70, backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.5)' },
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
  simpleMarker: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  dotCore: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#FFFFFF', elevation: 6 }
});
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Dimensions, StatusBar, SafeAreaView, ScrollView, Alert, TextInput, KeyboardAvoidingView, Platform, FlatList } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Clipboard from 'expo-clipboard';
import { ref, set, onValue } from 'firebase/database';

// ★ 경로 수정: 한 단계 더 올라가서 루트의 firebase와 services를 바라보도록 복구 ★
import { db } from '../../firebase/config';
import { requestPermission, watchLocation } from '../../services/location';
import * as Session from '../../services/session';
import { calculatePosition } from '../../services/positioning';
import { startUWB, stopUWB, UWB_ENTER_THRESHOLD, UWB_EXIT_THRESHOLD } from '../../services/uwb';
import {
  requestBLEPermissions, startAdvertising, stopAdvertising,
  startScanning, stopScanning, rssiToDistance,
} from '../../services/ble';

const { width, height } = Dimensions.get('window');
const UWB_TIMEOUT_MS = 3000;

const COLORS = {
  bg: '#FFFFFF', surface: '#F9FAFB', border: '#E5E7EB',
  text: '#111827', textSecondary: '#6B7280',
  primary: '#2563EB', accent: '#F97316',
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
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const lastMsgTimestamp = useRef<number>(0);

  // 실시간 매칭 친구 기록 배열
  const [myNameInput, setMyNameInput] = useState<string>('');
  const [recentFriends, setRecentFriends] = useState<any[]>([]);

  // 백엔드 refs
  const partnerLocRef = useRef<any>(null);
  const uwbActiveRef = useRef(false);
  const lastUwbTimeRef = useRef<number>(0);
  const uwbDistanceRef = useRef<number | null>(null);
  const uwbAzimuthRef = useRef<number | null>(null);
  const routerDataRef = useRef<any[]>([]);

  const KOREA_CENTER = { latitude: 37.5564, longitude: 126.9723 };

  const generateInviteCode = () => {
    const token = Session.createToken();
    setMyInviteCode(token);
  };

  useEffect(() => { generateInviteCode(); }, []);

  // 나침반
  useEffect(() => {
    let headSub: any;
    (async () => {
      const Location = require('expo-location');
      headSub = await Location.watchHeadingAsync((data: any) => {
        setHeading(data.magHeading);
      });
    })();
    return () => { if (headSub) headSub.remove(); };
  }, []);

  // 세션 시작 후 백엔드 초기화
  useEffect(() => {
    if (appState !== 'MAIN' || !userRole) return;

    const sessionToken = userRole === 'userA' ? myInviteCode : inputCode;
    const partnerId = userRole === 'userA' ? 'userB' : 'userA';
    const isHost = userRole === 'userA';

    const checkUWBTimeout = () => {
      if (uwbActiveRef.current && Date.now() - lastUwbTimeRef.current > UWB_TIMEOUT_MS) {
        uwbActiveRef.current = false;
        uwbDistanceRef.current = null;
      }
    };

    const handleDistanceTransition = (dist: number) => {
      if (!uwbActiveRef.current && dist < UWB_ENTER_THRESHOLD) {
        uwbActiveRef.current = true;
      } else if (uwbActiveRef.current && dist > UWB_EXIT_THRESHOLD) {
        uwbActiveRef.current = false;
        uwbDistanceRef.current = null;
      }
    };

    const handlePartnerNameDiscovery = (partnerName: string) => {
      if (!partnerName) return;
      setRecentFriends((prev) => {
        const filtered = prev.filter(f => f.name !== partnerName);
        return [{ id: String(Date.now()), name: partnerName, date: '방금 전' }, ...filtered].slice(0, 3);
      });
    };

    const init = async () => {
      await requestPermission();
      await requestBLEPermissions();

      try { await startAdvertising(userRole); } catch (e) {}

      // 라우터 구독
      Session.subscribeRouters(sessionToken, (routers: any) => {
        const arr = Object.values(routers).flatMap((router: any) => {
          if (!router.relay) return [];
          return Object.entries(router.relay).map(([_, relayData]: [string, any]) => ({
            lat: router.lat, lon: router.lon,
            rssi: relayData.rssi ?? -90,
            targetLat: relayData.lat, targetLon: relayData.lon,
          }));
        });
        routerDataRef.current = arr;
      });

      // UWB
      startUWB(
        sessionToken, userRole, partnerId,
        ({ distance, azimuth }) => {
          uwbDistanceRef.current = distance;
          uwbAzimuthRef.current = azimuth ?? null;
          uwbActiveRef.current = true;
          lastUwbTimeRef.current = Date.now();
        },
        () => { uwbActiveRef.current = false; }
      );

      // 상대방 위치 및 실시간 이름 구독 연동
      Session.subscribeToPartner(sessionToken, partnerId, (data: any) => {
        if (data) {
          partnerLocRef.current = { lat: data.lat, lon: data.lon };
          setTargetLoc({ latitude: data.lat, longitude: data.lon });
          if (data.name) handlePartnerNameDiscovery(data.name);
        }
      });

      Session.subscribeRelayed(sessionToken, partnerId, (data: any) => {
        if (data) {
          partnerLocRef.current = { lat: data.lat, lon: data.lon };
          setTargetLoc({ latitude: data.lat, longitude: data.lon });
          if (data.name) handlePartnerNameDiscovery(data.name);
        }
      });

      // 채팅 구독
      const chatRef = ref(db, `sessions/${sessionToken}/chat`);
      onValue(chatRef, (snapshot) => {
        const data = snapshot.val();
        if (data && data.timestamp !== lastMsgTimestamp.current) {
          lastMsgTimestamp.current = data.timestamp;
          setChatHistory(prev => [...prev, {
            id: String(data.timestamp), sender: data.sender, text: data.text
          }]);
        }
      });

      if (isHost) {
        watchLocation(async (loc) => {
          setMyLocation({ latitude: loc.lat, longitude: loc.lon });
          await Session.uploadLocation(sessionToken, userRole, loc.lat, loc.lon);

          set(ref(db, `sessions/${sessionToken}/${userRole}/name`), myNameInput.trim());

          if (partnerLocRef.current) {
            checkUWBTimeout();
            handleDistanceTransition(
              // ★ 여기 내장 require 경로도 한 단계 더 위인 ../../로 수정 ★
              require('../../services/bearing').getDistance(
                loc.lat, loc.lon,
                partnerLocRef.current.lat, partnerLocRef.current.lon
              )
            );

            const result = calculatePosition({
              myGpsPos: { lat: loc.lat, lon: loc.lon },
              partnerGpsPos: partnerLocRef.current,
              routers: routerDataRef.current,
              uwbDistance: uwbActiveRef.current ? uwbDistanceRef.current : null,
              uwbAzimuth: uwbAzimuthRef.current,
            });

            const finalDist = result.distance ?? 0;
            setDistance(Math.round(finalDist));
            await Session.uploadDistance(
              sessionToken, finalDist,
              result.bearing ?? 0, result.mode, result.confidence
            );

            if (finalDist <= 5 && finalDist > 0) setAppState('DONE');
          }
        });
      } else {
        watchLocation(async (loc) => {
          setMyLocation({ latitude: loc.lat, longitude: loc.lon });
          await Session.uploadLocation(sessionToken, userRole, loc.lat, loc.lon);

          set(ref(db, `sessions/${sessionToken}/${userRole}/name`), myNameInput.trim());
        });

        Session.subscribeDistance(sessionToken, (data: any) => {
          setDistance(Math.round(data.distance));
          checkUWBTimeout();
          handleDistanceTransition(data.distance);
          if (data.distance <= 5) setAppState('DONE');
        });
      }
    };

    init();
    return () => {
      stopUWB();
      stopAdvertising();
      stopScanning();
    };
  }, [appState, userRole]);

  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    const sessionToken = userRole === 'userA' ? myInviteCode : inputCode;
    if (sessionToken && userRole) {
      set(ref(db, `sessions/${sessionToken}/chat`), {
        sender: userRole, text: chatInput.trim(), timestamp: Date.now()
      });
      setChatInput('');
    }
  };

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(myInviteCode);
    Alert.alert("복사 완료", "초대 코드가 클립보드에 복사되었습니다.");
  };

  const createRoom = async () => {
    if (!myNameInput.trim()) return Alert.alert("확인", "사용하실 닉네임을 먼저 입력해주세요.");
    if (!myLocation) return Alert.alert("위치 정보를 가져오는 중입니다.");

    await Session.createSession(myInviteCode);
    await set(ref(db, `sessions/${myInviteCode}/userA/name`), myNameInput.trim());
    setUserRole('userA');
    setAppState('MAIN');
  };

  const joinRoom = (code?: string) => {
    const finalCode = code || inputCode;
    if (!myNameInput.trim()) return Alert.alert("확인", "사용하실 닉네임을 먼저 입력해주세요.");
    if (finalCode.length < 6) return Alert.alert("올바른 코드를 입력해주세요.");

    if (code) setInputCode(code);
    set(ref(db, `sessions/${finalCode}/userB/name`), myNameInput.trim());
    setUserRole('userB');
    setAppState('MAIN');
  };

  const exitSession = async () => {
    const sessionToken = userRole === 'userA' ? myInviteCode : inputCode;
    await Session.endSession(sessionToken);
    stopUWB();
    stopAdvertising();
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
              <TouchableOpacity style={styles.joinBtn} onPress={() => joinRoom()}><Text style={{color: '#fff', fontWeight: 'bold'}}>입장</Text></TouchableOpacity>
            </View>
          </View>

          <View style={styles.recentSection}>
            <Text style={styles.sectionLabel}>최근 함께한 친구 (최대 3명)</Text>
            {recentFriends.length > 0 ? (
              recentFriends.map(friend => (
                <View key={friend.id} style={styles.friendItem}>
                  <View style={styles.friendProfile}><Text style={styles.friendInitial}>{friend.name[0]}</Text></View>
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{friend.name}</Text>
                    <Text style={styles.friendDate}>{friend.date}</Text>
                  </View>
                  <View style={styles.statusBadge}><Text style={styles.statusBadgeText}>최근 ✓</Text></View>
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

  if (appState === 'DONE') {
    return (
      <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ fontSize: 80 }}>🎉</Text>
        <Text style={{ fontSize: 24, fontWeight: 'bold', marginTop: 20 }}>만났어요!</Text>
        <TouchableOpacity style={[styles.mainStartBtn, { marginTop: 40, width: 200 }]} onPress={exitSession}>
          <Text style={styles.mainStartBtnText}>종료</Text>
        </TouchableOpacity>
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

  nameSetupCard: { backgroundColor: '#F3F4F6', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 24 },
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
  floatingChatBtn: { position: 'absolute', bottom: 110, right: 20, backgroundColor: '#111827', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 25, elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 },
  floatingChatBtnText: { color: '#fff', fontWeight: 'bold' },
  glassChatOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: height * 0.45, zIndex: 999 },
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
  dotCore: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#FFFFFF', elevation: 6 },
});
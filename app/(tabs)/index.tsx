// app/(tabs)/index.tsx
import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Dimensions, StatusBar, SafeAreaView, ScrollView, Alert, TextInput } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';

// === 분리된 서비스 모듈 Import ===
import { getDistance, getBearing } from '../../services/bearing';
import { requestPermission, watchLocation } from '../../services/location';
import { createSession, uploadLocation, subscribeToPartner, endSession } from '../../services/session';
import { startUWB, stopUWB } from '../../services/uwb';

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

const refinedMapStyle = [
    { "elementType": "geometry", "stylers": [{ "color": "#f5f5f5" }] },
    { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#ffffff" }] },
    { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#d2e5f9" }] },
    { "featureType": "poi", "stylers": [{ "visibility": "off" }] }
];

export default function Index() {
    const [appState, setAppState] = useState<'TOKEN' | 'MAIN' | 'DONE'>('TOKEN');
    const [activeTab, setActiveTab] = useState<'MAP' | 'ARROW'>('MAP');

    const [distance, setDistance] = useState(0);
    const [uwbDistance, setUwbDistance] = useState<number | null>(null); // UWB 정밀 거리
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

    // 2. 내 위치 감시 (Kalman 필터 적용) 및 Firebase 전송
    useEffect(() => {
        let locSub: Location.LocationSubscription;
        let headSub: Location.LocationSubscription;

        (async () => {
            try {
                await requestPermission(); // location.ts의 권한 요청 사용

                // 나침반 방향 구독
                headSub = await Location.watchHeadingAsync((data) => {
                    setHeading(data.magHeading);
                });

                // Kalman 필터가 적용된 위치 구독
                locSub = await watchLocation(async (loc) => {
                    setMyLocation({ latitude: loc.lat, longitude: loc.lon });

                    // MAIN 상태일 때만 Firebase에 내 위치 업로드
                    const roomID = userRole === 'userA' ? myInviteCode : inputCode;
                    if (appState === 'MAIN' && roomID && userRole) {
                        await uploadLocation(roomID, userRole, loc.lat, loc.lon);
                    }
                });
            } catch (error) {
                Alert.alert("권한 오류", "위치 권한이 필요합니다.");
            }
        })();

        return () => {
            if (locSub) locSub.remove();
            if (headSub) headSub.remove();
        };
    }, [appState, userRole, myInviteCode, inputCode]);

    // 3. 상대방 위치 실시간 수신 및 UWB 시작
    useEffect(() => {
        const roomID = userRole === 'userA' ? myInviteCode : inputCode;
        if (!roomID || appState !== 'MAIN') return;

        const otherUser = userRole === 'userA' ? 'userB' : 'userA';

        // Firebase 상대방 위치 구독
        const unsub = subscribeToPartner(roomID, otherUser, (data) => {
            if (data && data.lat && data.lon) {
                setTargetLoc({ latitude: data.lat, longitude: data.lon });
            } else {
                setTargetLoc(null);
            }
        });

        // UWB 세션 시작 (두 기기가 모두 MAIN 상태에 진입했을 때)
        try {
            startUWB(roomID, userRole, otherUser, (dist) => {
                setUwbDistance(dist); // UWB를 통한 정밀 거리 업데이트
            });
        } catch (e) {
            console.log("UWB 모듈 초기화 실패 (네이티브 모듈이 없거나 에뮬레이터 환경일 수 있습니다.)");
        }

        return () => {
            unsub(); // Firebase 구독 해제
            stopUWB(); // UWB 세션 종료
        };
    }, [appState, userRole, myInviteCode, inputCode]);

    // 4. 거리 계산 (GPS 기반)
    useEffect(() => {
        if (myLocation && targetLoc) {
            const d = getDistance(myLocation.latitude, myLocation.longitude, targetLoc.latitude, targetLoc.longitude);
            setDistance(Math.round(d));

            // 거리가 5m 이하로 좁혀지면 만남 완료 처리
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
    const createRoom = async () => {
        if (!myLocation) return Alert.alert("위치 정보를 가져오는 중입니다.");
        setUserRole('userA');

        await createSession(myInviteCode); // session.ts 방 생성
        await uploadLocation(myInviteCode, 'userA', myLocation.latitude, myLocation.longitude);

        setAppState('MAIN');
    };

    // 입장 (게스트 userB)
    const joinRoom = async (code?: string) => {
        const finalCode = code || inputCode;
        if (finalCode.length < 6) return Alert.alert("올바른 코드를 입력해주세요.");

        setUserRole('userB');
        if (code) setInputCode(code);

        // 초기 위치 업로드
        await uploadLocation(finalCode, 'userB', myLocation?.latitude || 0, myLocation?.longitude || 0);

        setAppState('MAIN');
    };

    // 방 나가기
    const exitSession = async () => {
        const roomID = userRole === 'userA' ? myInviteCode : inputCode;
        if (roomID) {
            // 방장이면 방 전체 폭파, 아니면 본인 데이터만 지우는 로직이 session.ts 쪽에 추가되면 좋습니다.
            // 현재는 endSession 호출 시 방(session) 전체가 삭제됩니다.
            await endSession(roomID);
        }

        stopUWB();
        setAppState('TOKEN');
        setUserRole(null);
        setTargetLoc(null);
        setDistance(0);
        setUwbDistance(null);

        // 새 방을 팔 수 있도록 코드 재생성
        const charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let newCode = '';
        for (let i = 0; i < 6; i++) newCode += charSet[Math.floor(Math.random() * charSet.length)];
        setMyInviteCode(newCode);
    };

    // 화살표 방향 계산 (bearing.js 활용)
    const arrowRotation = targetLoc && myLocation
        ? (getBearing(myLocation.latitude, myLocation.longitude, targetLoc.latitude, targetLoc.longitude) - heading + 360) % 360
        : 0;

    // 화면 렌더링 (TOKEN 상태)
    if (appState === 'TOKEN') {
        return (
            <SafeAreaView style={styles.safeArea}>
                {/* 기존의 Token 화면 UI와 동일하게 유지 */}
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
                            <TouchableOpacity style={styles.joinBtn} onPress={() => joinRoom()}><Text style={{ color: '#fff', fontWeight: 'bold' }}>입장</Text></TouchableOpacity>
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

    // 화면 렌더링 (MAIN 상태)
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
                    {/* UWB 거리가 있으면 우선 표시 (정밀도 높음), 없으면 GPS 거리 표시 */}
                    <Text style={styles.distValue}>
                        {targetLoc ? (uwbDistance ? `약 ${uwbDistance.toFixed(1)}m (정밀)` : `약 ${distance}m`) : "연결 대기중"}
                    </Text>
                </View>
                <TouchableOpacity style={styles.exitBtn} onPress={exitSession}>
                    <Text style={styles.exitBtnText}>종료</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

// 스타일 코드는 기존과 동일하므로 생략 없이 그대로 유지
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
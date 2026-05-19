import NearbyInteraction
import React

@objc(UWBModule)
class UWBModule: RCTEventEmitter, NISessionDelegate {
  var session: NISession?
  
  override func supportedEvents() -> [String]! {
    return ["onUWBUpdate", "onUWBToken", "onUWBError"]
  }
  
  @objc func startSession() {
    session = NISession()
    session?.delegate = self
    
    guard let token = session?.discoveryToken else {
      sendEvent(withName: "onUWBError", body: ["error": "토큰 생성 실패"])
      return
    }
    
    guard let tokenData = try? NSKeyedArchiver.archivedData(
      withRootObject: token,
      requiringSecureCoding: true
    ) else {
      sendEvent(withName: "onUWBError", body: ["error": "토큰 직렬화 실패"])
      return
    }
    
    sendEvent(withName: "onUWBToken", body: ["token": tokenData.base64EncodedString()])
  }
  
  @objc func connectWithToken(_ partnerTokenString: String) {
    print("connectWithToken 호출됨")
    
    guard
      let tokenData = Data(base64Encoded: partnerTokenString),
      let partnerToken = try? NSKeyedUnarchiver.unarchivedObject(
        ofClass: NIDiscoveryToken.self,
        from: tokenData
      )
    else {
      print("토큰 파싱 실패")
      sendEvent(withName: "onUWBError", body: ["error": "상대방 토큰 파싱 실패"])
      return
    }
    
    print("토큰 파싱 성공, 세션 연결 시도")
    let config = NINearbyPeerConfiguration(peerToken: partnerToken)
    session?.run(config)
    print("session run 완료")
  }
  
  func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
    guard let object = nearbyObjects.first else { return }
    
    var body: [String: Any] = [:]
    
    if let distance = object.distance {
      body["distance"] = distance
    }
    
    if let direction = object.direction {
      body["directionX"] = direction.x
      body["directionY"] = direction.y
      body["directionZ"] = direction.z
      print("방향:", direction.x, direction.y, direction.z)
    } else {
      print("방향 없음")
    }
    
    sendEvent(withName: "onUWBUpdate", body: body)
  }
  
  func session(_ session: NISession, didInvalidateWith error: Error) {
    sendEvent(withName: "onUWBError", body: ["error": error.localizedDescription])
  }
  
  func sessionWasSuspended(_ session: NISession) {
    print("UWB 세션 일시정지")
  }
  
  func sessionSuspensionEnded(_ session: NISession) {
    // 세션 재시작
    if let token = session.discoveryToken,
       let tokenData = try? NSKeyedArchiver.archivedData(
        withRootObject: token,
        requiringSecureCoding: true
       ) {
      sendEvent(withName: "onUWBToken", body: ["token": tokenData.base64EncodedString()])
    }
  }
}

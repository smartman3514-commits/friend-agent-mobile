// 앱 안 카메라 화면: 일정표를 그 자리에서 찍는다. 찍은 사진은 대화 화면으로 넘기고 닫힌다(글자 읽기는 대화 화면이 백엔드에 맡김).
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deliverPhoto } from '@/lib/photo';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<ComponentRef<typeof CameraView>>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // 권한을 아직 모름
  if (!permission) return <View style={styles.black} />;

  // 권한이 없을 때: 앱이 멈추지 않고, 다시 묻거나 설정에서 켜는 방법을 안내한다
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.ask}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.askTitle}>카메라를 쓸 수 있게 허락해 주세요</Text>
        <Text style={styles.askText}>일정표를 찍어 글자를 읽으려면 카메라 권한이 필요해요.</Text>
        {permission.canAskAgain ? (
          <Pressable style={styles.primary} onPress={requestPermission}>
            <Text style={styles.primaryText}>권한 허락하기</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.askText}>권한을 거절해 두셨어요. 휴대폰 설정 → 앱 → Expo Go → 권한에서 카메라를 켜 주세요.</Text>
            <Pressable style={styles.primary} onPress={() => Linking.openSettings()}>
              <Text style={styles.primaryText}>설정 열기</Text>
            </Pressable>
          </>
        )}
        <Pressable style={styles.secondary} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>닫기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const shoot = async () => {
    if (!camera.current || !ready || busy) return;
    setBusy(true);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.7 });
      if (picture?.uri) deliverPhoto({ uri: picture.uri, mimeType: picture.format === 'png' ? 'image/png' : 'image/jpeg' });
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.black}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.close}>닫기</Text>
          </Pressable>
        </View>
        <Text style={styles.guide}>글자가 화면 안에 꽉 차게, 밝은 곳에서 똑바로 찍어 주세요</Text>
        <View style={styles.bottomBar}>
          <Pressable style={[styles.shutter, (!ready || busy) && styles.shutterOff]} onPress={shoot} disabled={!ready || busy}>
            <View style={styles.shutterInner} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', padding: 16 },
  close: { color: '#fff', fontSize: 16, fontWeight: '700' },
  guide: { alignSelf: 'center', color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, fontSize: 14 },
  bottomBar: { alignItems: 'center', paddingBottom: 28 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterOff: { opacity: 0.4 },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  ask: { flex: 1, backgroundColor: '#fff', padding: 24, justifyContent: 'center', gap: 14 },
  askTitle: { fontSize: 20, fontWeight: '700', color: '#1F2430' },
  askText: { fontSize: 15, color: '#5B6270', lineHeight: 22 },
  primary: { backgroundColor: '#F7585C', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: '#5B6270', fontSize: 15 },
});

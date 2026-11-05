// 대화 화면. 캐릭터가 없으면 캐릭터 화면으로 보낸다(백엔드도 캐릭터가 있어야 대화 기록을 돌려준다).
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Link, Redirect, router, Stack } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  Alert,
  Linking,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorView, Loading } from '@/components/StatusView';
import { api, readPhotoText, streamChat, type Character, type MemoryEvent, type Message, type ReminderEvent } from '@/lib/api';
import { onPhoto, type Photo } from '@/lib/photo';
import { cityFromGps, LocationDenied } from '@/lib/place';
import { useSession } from '@/lib/session';

export default function ChatScreen() {
  const session = useSession();
  if (session.status === 'loading') return <Loading />;
  if (session.status === 'error') return <ErrorView message={session.message} retry={session.retry} />;
  if (!session.me.has_character) return <Redirect href="/character" />;
  return <Chat ocrEnabled={!!session.config.ocr_enabled} cities={session.config.cities ?? []} />;
}

// 웹 화면(static/index.html)과 같은 안내 문장. 읽은 글은 바로 보내지 않고 입력창에 넣어 사람이 확인·수정한 뒤 보낸다.
const OCR_PREFIX = '사진에서 읽은 글이야. 여기 있는 일정 중에 알려 줘야 할 게 있으면 약속으로 저장해 줘.\n';

// 진동(햅틱). Expo Go·기기에 따라 안 될 수 있으니 실패해도 조용히 넘어간다.
const buzz = (kind: 'light' | 'success') =>
  (kind === 'light'
    ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  ).catch(() => {});

function Chat({ ocrEnabled, cities }: { ocrEnabled: boolean; cities: string[] }) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [reading, setReading] = useState(false);
  const [place, setPlace] = useState<string | null>(null);   // 날씨·미세먼지 지역(백엔드 /api/settings)
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    api<{ location: string }>('/api/settings').then((s) => setPlace(s.location)).catch(() => {});
  }, []);

  // 📍 지금 위치로 지역 맞추기. 좌표는 서버에 보내지 않고 도시 이름만 보낸다(src/lib/place.ts)
  const locate = async () => {
    setLocating(true);
    setError(null);
    try {
      const { city, area } = await cityFromGps(cities);
      if (!city) {
        setError(`지금 계신 곳(${area})은 날씨를 볼 수 있는 도시 목록에 없어요. 지역은 ${place ?? '그대로'}로 둘게요.`);
        return;
      }
      const saved = await api<{ location: string }>('/api/settings', { method: 'PUT', body: { location: city } });
      setPlace(saved.location);
      buzz('success');
      Alert.alert('지역을 맞췄어요', `날씨와 미세먼지를 ${saved.location} 기준으로 알려 드릴게요.`);
    } catch (e) {
      if (e instanceof LocationDenied && !e.canAskAgain) {
        Alert.alert('위치 권한이 꺼져 있어요', '휴대폰 설정 → 앱 → Expo Go → 권한에서 위치를 켜 주세요.', [
          { text: '닫기', style: 'cancel' },
          { text: '설정 열기', onPress: () => Linking.openSettings() },
        ]);
      } else {
        setError(String((e as Error).message ?? e));
      }
    } finally {
      setLocating(false);
    }
  };

  const askLocate = () =>
    Alert.alert('지금 위치로 지역 맞추기', `지금은 ${place ?? '서울'} 기준이에요. 위치로 가장 가까운 도시를 찾아 날씨 지역을 바꿀까요? (위치 좌표는 서버에 보내지 않아요)`, [
      { text: '취소', style: 'cancel' },
      { text: '맞추기', onPress: locate },
    ]);

  // 사진 한 장 → 백엔드 OCR → 안내 문장 + 읽은 글을 입력창에 넣는다(보내기는 사용자가)
  const readPhoto = async (photo: Photo) => {
    setReading(true);
    setError(null);
    try {
      const text = (await readPhotoText(photo.uri)).trim();
      if (!text) {
        setError('사진에서 글자를 찾지 못했어요. 밝은 곳에서 글자가 화면을 가득 채우게 다시 찍어 주세요.');
        return;
      }
      setInput(OCR_PREFIX + text);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setReading(false);
    }
  };

  // 카메라 화면에서 찍은 사진을 받는다
  useEffect(() => {
    onPhoto(readPhoto);
    return () => onPhoto(null);
  });

  const pickFromLibrary = async () => {
    // 사진첩은 따로 권한을 묻지 않아도 된다(Expo SDK 58 문서).
    // allowsEditing: 고른 뒤 자르기 화면이 나온다 — 일정 부분만 남기면 주변 글자가 섞이지 않아 더 잘 읽힌다.
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      await readPhoto({ uri: a.uri, mimeType: a.mimeType });
    }
  };

  const choosePhoto = () =>
    Alert.alert('사진으로 약속 만들기', '일정표나 안내문 사진의 글자를 읽어 입력창에 넣어 드려요.', [
      { text: '카메라로 찍기', onPress: () => router.push('/camera') },
      { text: '사진첩에서 고르기', onPress: pickFromLibrary },
      { text: '취소', style: 'cancel' },
    ]);

  useEffect(() => {
    (async () => {
      try {
        const [c, history] = await Promise.all([
          api<{ character: Character }>('/api/character'),
          api<Message[]>('/api/messages'),
        ]);
        setCharacter(c.character);
        setMessages(history.map(({ id, role, content }) => ({ id, role, content })));
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    })();
  }, []);

  // 마지막 메시지(답을 받는 중인 메시지)의 글자를 이어 붙인다
  const appendToLast = (text: string) =>
    setMessages((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, content: last.content + text };
      return next;
    });

  // 마지막 메시지(이번 답)에 메모를 붙인다
  const addNotes = (lines: string[]) => {
    if (!lines.length) return;
    setMessages((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, notes: [...(last.notes ?? []), ...lines] };
      return next;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    try {
      await streamChat(text, (event) => {
        if (event.type === 'delta') appendToLast(String(event.text));
        if (event.type === 'error') setError(String(event.message));
        if (event.type === 'done') buzz('light');
        if (event.type === 'reminder') {
          const r = event as ReminderEvent;
          buzz('success');
          const icon = r.action === 'cancel_reminder' ? '🗑' : r.action === 'update_reminder' ? '🔁' : '⏰';
          addNotes([`${icon} ${r.summary}`]);
        }
        if (event.type === 'memory') {
          const m = event as MemoryEvent;
          addNotes([
            ...(m.added ?? []).map((t) => `🧠 기억했어요: ${t}`),
            ...(m.updated ?? []).map((t) => `🧠 기억을 고쳤어요: ${t}`),
            ...(m.removed ?? []).map((t) => `🧠 잊었어요: ${t}`),
          ]);
        }
      });
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    // 헤더를 화면 안에 직접 그린다. iOS 26부터 기본 헤더가 화면 위에 겹쳐 배치되어 대화 목록 윗부분을 가리기 때문이다.
    <SafeAreaView style={styles.frame} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, title: character ? `${character.avatar} ${character.name}` : '하루친구' }} />
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <Pressable onPress={askLocate} disabled={locating} hitSlop={8} accessibilityLabel="지금 위치로 날씨 지역 맞추기">
            <Text style={styles.place} numberOfLines={1}>{locating ? '📍 찾는 중…' : `📍 ${place ?? '지역'}`}</Text>
          </Pressable>
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {character ? `${character.avatar} ${character.name}` : '하루친구'}
        </Text>
        <View style={[styles.headerSide, styles.headerRight]}>
          <Link href="/character" style={styles.headerLink}>
            캐릭터
          </Link>
        </View>
      </View>
      {/* Android 도 edge-to-edge 라 키보드가 올라와도 창이 줄지 않는다 → 두 플랫폼 모두 padding (Expo 키보드 문서) */}
      <KeyboardAvoidingView style={styles.screen} behavior="padding">
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? <Text style={styles.empty}>첫 메시지를 보내 보세요.</Text> : null}
          {messages.map((m, i) => (
            <View key={m.id ?? `local-${i}`} style={m.role === 'user' ? styles.rowMine : styles.rowTheirs}>
              <View style={[styles.bubble, m.role === 'user' ? styles.mine : styles.theirs]}>
                <Text style={m.role === 'user' ? styles.mineText : styles.theirsText}>{m.content || '…'}</Text>
              </View>
              {m.notes?.map((note, j) => (
                <Text key={j} style={styles.note}>
                  {note}
                </Text>
              ))}
            </View>
          ))}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {reading ? <Text style={styles.reading}>📷 사진 속 글자를 읽는 중…</Text> : null}
        </ScrollView>
        <View style={styles.inputRow}>
          {ocrEnabled ? (
            <Pressable style={styles.photo} onPress={choosePhoto} disabled={busy || reading} accessibilityLabel="사진으로 약속 만들기">
              <Text style={styles.photoText}>📷</Text>
            </Pressable>
          ) : null}
          <TextInput
            style={styles.input}
            multiline
            value={input}
            onChangeText={setInput}
            placeholder="메시지 보내기"
            editable={!busy}
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable style={[styles.send, (busy || !input.trim()) && styles.sendOff]} onPress={send} disabled={busy}>
            <Text style={styles.sendText}>{busy ? '…' : '보내기'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: '#fff' },
  screen: { flex: 1, backgroundColor: '#FAFAFB' },
  header: { flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: 8, borderBottomWidth: 1, borderColor: '#E6E8EC', backgroundColor: '#fff' },
  headerSide: { width: 72 },
  headerRight: { alignItems: 'flex-end' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#1F2430' },
  list: { padding: 16, gap: 8 },
  empty: { textAlign: 'center', color: '#5B6270', marginTop: 24 },
  rowMine: { alignSelf: 'flex-end', maxWidth: '82%', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', maxWidth: '82%', alignItems: 'flex-start', gap: 3 },
  note: { color: '#8A909C', fontSize: 12, paddingHorizontal: 4 },
  bubble: { maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#F7585C' },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E6E8EC' },
  mineText: { color: '#fff', fontSize: 15 },
  theirsText: { color: '#1F2430', fontSize: 15 },
  error: { color: '#D93D42', fontSize: 13, marginTop: 8 },
  reading: { color: '#5B6270', fontSize: 13, marginTop: 8, alignSelf: 'center' },
  photo: { justifyContent: 'center', paddingHorizontal: 6 },
  photoText: { fontSize: 22 },
  inputRow: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderColor: '#E6E8EC', backgroundColor: '#fff' },
  input: { flex: 1, maxHeight: 120, borderWidth: 1, borderColor: '#E6E8EC', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  send: { backgroundColor: '#F7585C', borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  sendOff: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '700' },
  place: { color: '#5B6270', fontSize: 13, fontWeight: '600', paddingHorizontal: 6 },
  headerLink: { color: '#D93D42', fontWeight: '700', fontSize: 15, paddingHorizontal: 8 },
});

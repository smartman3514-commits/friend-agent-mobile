// 백엔드(friend-agent-template)와 주고받는 코드. 백엔드 주소는 EXPO_PUBLIC_API_URL 에서 읽는다.
import { fetch as streamingFetch } from 'expo/fetch';
import { File } from 'expo-file-system';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

let token: string | null = null;

// 로그인하면 Supabase 토큰을 넣어 둔다. 백엔드가 AUTH=none 이면 토큰 없이 부른다.
export function setToken(value: string | null) {
  token = value;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function requireUrl() {
  if (!API_URL) {
    throw new Error('백엔드 주소가 비어 있습니다. .env 의 EXPO_PUBLIC_API_URL 을 확인하세요.');
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  requireUrl();
  const response = await fetch(API_URL + path, {
    method: options.method ?? 'GET',
    headers: headers(),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    throw new Error(`${path} 요청 실패: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

// /api/chat 은 한 줄에 이벤트 하나(JSON)씩 흘려보낸다. 답 글자는 delta, 끝나면 done, 실패하면 error.
// reminder: 도구가 약속을 저장(create_reminder)·취소(cancel_reminder)·시각 변경(update_reminder)했을 때 한 줄 요약.
// memory: 이번 턴에 새로 기억한 것(added), 고친 것(updated), 잊은 것(removed). 기억할 게 없으면 목록이 비어 있다.
export type ReminderEvent = { type: 'reminder'; action: string; summary: string };
export type MemoryEvent = { type: 'memory'; added: string[]; updated: string[]; removed: string[] };
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; message_id: number }
  | { type: 'error'; message: string }
  | ReminderEvent
  | MemoryEvent
  | { type: string; [key: string]: unknown };

export async function streamChat(message: string, onEvent: (event: ChatEvent) => void) {
  requireUrl();
  // 앱에서 응답을 조금씩 읽으려면 expo/fetch 를 쓴다. React Native 기본 fetch 는 스트리밍을 읽지 못한다.
  const response = await streamingFetch(API_URL + '/api/chat', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ message }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`/api/chat 요청 실패: ${response.status} ${await response.text()}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as ChatEvent);
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ChatEvent);
}

// 사진 속 글자 읽기(/api/ocr). 사진은 multipart 폼의 photo 필드로 보낸다.
// Content-Type 은 직접 넣지 않는다 — 경계 문자열(boundary)이 들어간 값을 요청이 스스로 만들어야 백엔드가 사진을 찾는다.
// SDK 58 은 전역 fetch 가 expo/fetch 라서, 옛 React Native 방식({uri, name, type})을 넣으면
// "Unsupported FormDataPart implementation" 오류가 난다(11-05 실측). 공식 문서대로 expo-file-system 의 File 을 넣는다.
export async function readPhotoText(uri: string): Promise<string> {
  requireUrl();
  const form = new FormData();
  form.append('photo', new File(uri));
  const response = await fetch(API_URL + '/api/ocr', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    // 사진 읽기는 크레딧 3개(백엔드 credits.COST['ocr']). 모자라면 402 와 안내 문구가 온다
    if (response.status === 402) throw new Error(JSON.parse(detail).message ?? '크레딧이 부족해요.');
    if (response.status === 404) throw new Error('서버에서 사진 글자 읽기가 꺼져 있어요.');
    if (response.status === 401) throw new Error('로그인이 풀렸어요. 앱을 다시 열어 주세요.');
    throw new Error(`사진을 읽지 못했어요(${response.status}). ${detail}`);
  }
  return ((await response.json()) as { text: string }).text ?? '';
}

// 백엔드 응답 모양
export type Config = {
  ocr_enabled?: boolean;
  cities?: string[];   // 날씨·미세먼지를 볼 수 있는 도시 이름(백엔드 tools.CITIES)
  env: string;
  auth: 'none' | 'supabase';
  storage: string;
  supabase_url: string;
  supabase_publishable_key: string;
  options: Record<string, string[]>;
};

export type Me = { id: string; anonymous: boolean; email: string | null; has_character: boolean };

export type Character = {
  name: string;
  gender: string;
  age_group: string;
  job: string;
  relationship: string;
  traits: string[];
  speech: string;
  emoji: string;
  interests: string[];
  avoid: string[];
  memo: string;
  avatar: string;
};

// notes: 답 아래에 붙이는 작은 메모(기억·약속). 그 턴의 스트리밍 이벤트로만 오고 /api/messages 에는 없다.
export type Message = { id?: number; role: 'user' | 'assistant'; content: string; notes?: string[] };

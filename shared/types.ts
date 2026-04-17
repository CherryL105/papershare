export type UserRole = "admin" | "member";

export interface User {
  id: string;
  username: string;
  role?: UserRole;
  mustChangePassword?: boolean;
  createdAt?: string | number;
  updatedAt?: string | number;
}

export interface UserWithStats extends User {
  annotationCount: number;
  uploadedPaperCount: number;
}

export interface Attachment {
  id?: string;
  url?: string;
  storage_path?: string;
  original_name?: string;
  filename?: string;
  mime_type?: string;
  extension?: string;
  size_bytes?: number;
  category?: "image" | "table" | string;
  created_at?: string | number;
}

export interface Paper {
  id: string;
  title: string;
  sourceUrl?: string;
  authors?: string;
  journal?: string;
  published?: string;
  abstract?: string;
  keywords?: string[];
  fetchedAt?: string | number;
  updatedAt?: string | number;
  createdAt?: string | number;
  created_by_user_id?: string;
  created_by_username?: string;
  snapshotPath?: string;
  hasSnapshot?: boolean;
  articleImagesEnabled?: boolean;
  speechCount?: number;
  latestSpeechAt?: string | number;
  latestSpeakerUsername?: string;
  activity_at?: string | number;
  attachments?: Attachment[];
}

export interface Annotation {
  id: string;
  paperId: string;
  note: string;
  exact: string;
  prefix: string;
  suffix: string;
  target_scope: string;
  start_offset: number;
  end_offset: number;
  created_by_user_id: string;
  created_by_username: string;
  created_at: string | number;
  parent_annotation_id: string;
  root_annotation_id: string;
  attachments: Attachment[];
}

export interface Discussion {
  id: string;
  paperId: string;
  note: string;
  created_by_user_id: string;
  created_by_username: string;
  created_at: string | number;
  parent_discussion_id: string;
  root_discussion_id: string;
  attachments: Attachment[];
}

export interface PendingSelection {
  exact: string;
  prefix: string;
  suffix: string;
  target_scope: string;
  start_offset: number;
  end_offset: number;
}

export interface ArticleImageSourceRule {
  label: string;
  hostnames: string[];
}

interface SpeechActivityMeta {
  activity_at: string | number;
  is_reply: boolean;
  paperExists: boolean;
  paperPublished: string;
  paperSourceUrl: string;
  paperTitle: string;
  parent_note: string;
  parent_username: string;
  thread_id: string;
  thread_note: string;
}

export interface AnnotationActivityRecord extends Annotation, SpeechActivityMeta {
  speech_type: "annotation";
  thread_annotation_id: string;
  reply_to_note?: string;
  reply_to_username?: string;
}

export interface DiscussionActivityRecord extends Discussion, SpeechActivityMeta {
  speech_type: "discussion";
  thread_discussion_id: string;
  reply_to_note?: string;
  reply_to_username?: string;
}

export type SpeechActivityRecord = AnnotationActivityRecord | DiscussionActivityRecord;

export interface DashboardData {
  myAnnotations: SpeechActivityRecord[];
  repliesToMyAnnotations: SpeechActivityRecord[];
  uploadedPapers: Paper[];
}

export interface MemberProfile {
  annotations: SpeechActivityRecord[];
  uploadedPapers: Paper[];
  user: User;
}

export interface AuthSessionState {
  authenticated: boolean;
  user: User | null;
}

export interface LoginResponse {
  ok: boolean;
  token: string;
  user: User;
}

export interface UserResponse {
  ok: boolean;
  user: User;
}

export interface DeletedContentSummary {
  paperCount: number;
  annotationCount: number;
  discussionCount: number;
}

export interface DeleteUserResponse {
  ok: boolean;
  deletedUserId: string;
  purgeContent: boolean;
  deletedContent: DeletedContentSummary | null;
}

export interface TransferAdminResponse {
  ok: boolean;
  currentUser: User;
  targetUser: User;
}

export interface PaperContentResponse {
  rawHtml: string;
}

export interface PaperDetailUrlOptions {
  paperId?: string;
  panel?: "reader" | "discussion";
  annotationId?: string;
  replyId?: string;
  discussionId?: string;
  discussionReplyId?: string;
}

export interface FocusReplyOptions {
  focusReplyId?: string;
}

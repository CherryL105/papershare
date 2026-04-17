import type {
  Annotation,
  Attachment,
  DashboardData,
  Discussion,
  FocusReplyOptions,
  MemberProfile,
  Paper,
  PendingSelection,
  SpeechActivityRecord,
  User,
  UserResponse,
  UserWithStats,
} from "../../../shared/types";

export type {
  Annotation,
  AnnotationActivityRecord,
  ArticleImageSourceRule,
  Attachment,
  AuthSessionState,
  DashboardData,
  DeleteUserResponse,
  DeletedContentSummary,
  Discussion,
  DiscussionActivityRecord,
  FocusReplyOptions,
  LoginResponse,
  MemberProfile,
  Paper,
  PaperContentResponse,
  PaperDetailUrlOptions,
  PendingSelection,
  SpeechActivityRecord,
  TransferAdminResponse,
  User,
  UserResponse,
  UserRole,
  UserWithStats,
} from "../../../shared/types";

export type CatalogView = "library" | "members" | "password" | "profile" | "user-management";
export type ProfilePanel = "papers" | "speeches" | "replies";
export type MemberProfilePanel = "papers" | "speeches";
export type DetailLibraryPanel = "reader" | "discussion";
export type DetailComposerKind = "annotation" | "discussion" | "discussionReply" | "reply";
export type DetailEditKind = "annotation" | "discussion";
export type DetailEditTargetType = "" | DetailEditKind | "reply";
export type DetailComposerKey =
  | "annotationComposer"
  | "discussionComposer"
  | "discussionReplyComposer"
  | "replyComposer";
export type DetailEditStateKey = "annotationEditState" | "discussionEditState";
export type DetailRecordsKey = "annotations" | "discussions";
export type DetailSelectedThreadKey = "selectedAnnotationId" | "selectedDiscussionId";
export type DetailSelectedReplyKey = "selectedReplyId" | "selectedDiscussionReplyId";
export type DetailReplySavingKey = "isSavingReply" | "isSavingDiscussionReply";

export interface ClientState {
  session: {
    apiBaseUrl: string;
    token: string;
  };
  auth: {
    currentUser: User | null;
    isInitializing: boolean;
    serverReady: boolean;
    isLoggingIn: boolean;
    loginStatus: string;
    databaseStatus: string;
  };
  papers: {
    items: Paper[];
  };
  catalog: CatalogState;
  profile: ProfileState;
  members: MembersState;
  detail: DetailState;
}

export interface CatalogState {
  currentView: CatalogView;
  profilePanel: ProfilePanel;
  memberProfilePanel: MemberProfilePanel;
  paperFormStatus: string;
  searchTerm: string;
  isSavingPaper: boolean;
  paperForm: {
    sourceUrl: string;
    rawHtml: string;
  };
}

export interface ProfileState {
  uploadedPapers: Paper[];
  myAnnotations: SpeechActivityRecord[];
  repliesToMyAnnotations: SpeechActivityRecord[];
  usernameStatus: string;
  passwordStatus: string;
  isUpdatingUsername: boolean;
  isChangingPassword: boolean;
}

export interface MembersState {
  allUsers: UserWithStats[];
  groupMembers: UserWithStats[];
  selectedMemberId: string;
  selectedMemberProfile: MemberProfile | null;
  userManagementStatus: string;
  isCreatingUser: boolean;
  isManagingUser: boolean;
  managedUserActionUserId: string;
  managedUserActionType: string;
}

export interface EditableAttachmentItem {
  kind: "existing" | "new";
  key: string;
  attachment?: Attachment;
  file?: File;
}

export interface ComposerState {
  draft: string;
  attachments: File[];
}

export interface EditState {
  targetId: string | null;
  targetType: DetailEditTargetType;
  draft: string;
  attachments: EditableAttachmentItem[];
  isSaving: boolean;
}

export interface DetailState {
  isInitializing: boolean;
  libraryPanel: DetailLibraryPanel;
  selectedPaperId: string;
  selectedPaper: Paper | null;
  articleHtml: string;
  articleLoaded: boolean;
  pendingSelection: PendingSelection | null;
  annotations: Annotation[];
  discussions: Discussion[];
  selectedAnnotationId: string | null;
  selectedReplyId: string | null;
  annotationNavigationTargetId: string | null;
  selectedDiscussionId: string | null;
  selectedDiscussionReplyId: string | null;
  discussionNavigationTargetId: string | null;
  isSavingAnnotation: boolean;
  isSavingReply: boolean;
  isSavingDiscussion: boolean;
  isSavingDiscussionReply: boolean;
  annotationComposer: ComposerState;
  replyComposer: ComposerState;
  discussionComposer: ComposerState;
  discussionReplyComposer: ComposerState;
  annotationEditState: EditState;
  discussionEditState: EditState;
}

export interface DetailStoreModule {
  clearSelectedDetailPaper(): void;
  openAnnotationLocation(
    paperId: string,
    annotationId: string,
    options?: FocusReplyOptions
  ): Promise<void>;
  openDiscussionLocation(
    paperId: string,
    discussionId: string,
    options?: FocusReplyOptions
  ): Promise<void>;
  refreshSelectedPaperAnnotations(): Promise<Annotation[]>;
  refreshSelectedPaperDiscussions(): Promise<Discussion[]>;
  selectPaper(paperId: string): Promise<Paper | null>;
}

export interface PasswordChangeForm {
  confirmPassword: string;
  currentPassword: string;
  nextPassword: string;
}

export interface CreateUserForm {
  confirmPassword: string;
  password: string;
  username: string;
}

export type DeleteActivityRecord = SpeechActivityRecord;

export type DeleteActivityResult = DeleteActivityRecord;

export interface UserMutationPayload extends UserResponse {}

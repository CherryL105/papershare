import type { Annotation, ArticleImageSourceRule, Discussion, User, UserRole } from "./types";

export const MAX_ATTACHMENT_COUNT: number;
export const MAX_ATTACHMENT_BYTES: number;
export const MAX_TOTAL_ATTACHMENT_BYTES: number;
export const ATTACHMENT_INPUT_ACCEPT: string;
export const IMAGE_ATTACHMENT_EXTENSIONS: Set<string>;
export const TABLE_ATTACHMENT_EXTENSIONS: Set<string>;
export const DEFAULT_ANNOTATION_SCOPE: string;
export const ANNOTATION_SCOPE_LABELS: Record<string, string>;
export const ARTICLE_IMAGE_SOURCE_RULES: readonly ArticleImageSourceRule[];

export function normalizeMimeType(value: string | null | undefined): string;
export function safeParseHostname(sourceUrl: string): string;
export function getArticleImageSourceRule(sourceUrl: string): ArticleImageSourceRule | null;
export function supportsArticleImagesForSourceUrl(sourceUrl: string): boolean;
export function stripBackgroundImagesFromInlineStyle(styleValue: string | null | undefined): string;
export function extractAssignedJsonObject(source: string | null | undefined, variableName: string): string;
export function parsePreloadedStateFromHtml(rawHtml: string): Record<string, unknown> | null;
export function getUserRole(user: User | null | undefined): UserRole;
export function isAdminUser(user: User | null | undefined): boolean;
export function doesRecordBelongToUser(
  record:
    | {
        created_by_user_id?: string;
        created_by_username?: string;
      }
    | null
    | undefined,
  user: User | null | undefined
): boolean;
export function canDeleteOwnedRecord(
  record:
    | {
        created_by_user_id?: string;
        created_by_username?: string;
      }
    | null
    | undefined,
  user: User | null | undefined
): boolean;
export function isReplyAnnotation(annotation: Annotation | null | undefined): boolean;
export function getThreadRootAnnotationId(annotation: Annotation | null | undefined): string;
export function isDiscussionReply(discussion: Discussion | null | undefined): boolean;
export function getThreadRootDiscussionId(discussion: Discussion | null | undefined): string;
export function escapeHtml(value: string | null | undefined): string;

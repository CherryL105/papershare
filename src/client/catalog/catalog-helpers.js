import * as sharedModule from "../../../shared/papershare-shared.js";
import { getRecordNoteDisplay } from "../shared/speech-helpers.js";

const shared = sharedModule?.default || sharedModule;
const { getUserRole, isAdminUser } = shared;

export function isCurrentUserAdmin(user) {
  return isAdminUser(user);
}

export function formatCurrentUserLabel(user) {
  if (!user) {
    return "";
  }

  return getUserRole(user) === "admin" ? `${user.username}（管理员）` : user.username;
}

export function formatUserBadge(user) {
  return formatCurrentUserLabel(user);
}

export function truncate(value, maxLength) {
  const normalizedValue = String(value || "");

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...`;
}

export function getSpeechDisplayText(record) {
  const speechType = record?.speech_type === "discussion" ? "discussion" : "annotation";
  const isReply = Boolean(record?.is_reply);
  const rootLabel = speechType === "discussion" ? "讨论" : "批注";
  const content = truncate(getRecordNoteDisplay(record), 90);

  if (isReply) {
    return `${record?.created_by_username || "未知用户"}回复${record?.parent_username || "未知用户"}: ${content}`;
  }

  return `${record?.created_by_username || "未知用户"}${rootLabel}: ${content}`;
}

export function getSpeechDeleteLabel(record) {
  const speechType = record?.speech_type === "discussion" ? "discussion" : "annotation";

  if (record?.is_reply) {
    return "删除回复";
  }

  return speechType === "discussion" ? "删除讨论" : "删除批注";
}

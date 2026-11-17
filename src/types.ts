export type PlatformId = 'instagram' | 'tiktok';

export type TargetStatus =
  | 'idle'
  | 'scheduled'
  | 'uploading'
  | 'processing'
  | 'published'
  | 'failed';

export type PublishMode = 'now' | 'schedule';

export interface ConnectedAccountPublic {
  platform: PlatformId;
  connected: boolean;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  accountType?: string;
  connectedAt?: string;
  expiresAt?: string;
  privacyOptions?: string[];
  oauthConfigured: boolean;
  callbackUrl: string;
}

export interface InstagramPostOptions {
  shareToFeed: boolean;
}

export interface TikTokPostOptions {
  privacyLevel: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
}

export interface PlatformDeliveryState {
  platform: PlatformId;
  enabled: boolean;
  status: TargetStatus;
  progressMessage: string;
  externalId?: string;
  permalink?: string;
  error?: string;
  updatedAt: string;
}

export interface VideoMetadata {
  originalName: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
}

export interface PublishJob {
  id: string;
  workspaceId: string;
  caption: string;
  hashtags: string;
  mode: PublishMode;
  scheduledAt: string | null;
  coverTimestampMs: number;
  video: VideoMetadata;
  videoUrl: string;
  instagramOptions: InstagramPostOptions;
  tiktokOptions: TikTokPostOptions;
  deliveries: Record<PlatformId, PlatformDeliveryState>;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationDefaults {
  autoPublishOnDrop: boolean;
  defaultTargets: PlatformId[];
  defaultHashtags: string;
  instagramShareToFeed: boolean;
  tiktokPrivacyLevel: TikTokPostOptions['privacyLevel'];
  tiktokAllowComment: boolean;
  tiktokAllowDuet: boolean;
  tiktokAllowStitch: boolean;
}

export interface WorkspaceOverviewResponse {
  workspaceId: string;
  appUrl: string;
  accounts: Record<PlatformId, ConnectedAccountPublic>;
  automation: AutomationDefaults;
  jobs: PublishJob[];
}

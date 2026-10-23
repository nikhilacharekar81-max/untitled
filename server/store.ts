/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { financeLedger, FinanceLedgerEngine } from '../src/server/financeLedger.js';
import { siteSettings, DEFAULT_SITE_SETTINGS } from '../src/server/siteSettings.js';
import { workspaceService } from '../src/server/workspaceService.js';
import { paymentGatewayManager } from '../src/server/paymentGateways.js';
import { postgresStore, isPostgresEnabled } from './db/postgresStore.js';
import { financialRepository, financialTransactionService } from './services/financialService.js';

export { financeLedger, siteSettings, DEFAULT_SITE_SETTINGS, FinanceLedgerEngine, postgresStore, isPostgresEnabled };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const WORKSTREAM_UPLOADS_DIR = path.join(DATA_DIR, 'workstream_uploads');

import type {
  User,
  GigExtra,
  Gig,
  Project,
  Proposal,
  Order,
  Dispute,
  WorkstreamOfferKind,
  WorkstreamOfferStatus,
  WorkstreamOffer,
  CustomInvoice,
  Refund,
  Payout,
  Category,
  Review,
  SupportTicket,
  AuditLog,
  Message,
  UserEmail,
  SiteFeeSettings,
  WorkstreamUploadRecord,
  Notification,
  ExtensionRequest,
  ProjectClarification
} from '../src/types.js';

export type {
  User,
  GigExtra,
  Gig,
  Project,
  Proposal,
  Order,
  Dispute,
  WorkstreamOfferKind,
  WorkstreamOfferStatus,
  WorkstreamOffer,
  CustomInvoice,
  Refund,
  Payout,
  Category,
  Review,
  SupportTicket,
  AuditLog,
  Message,
  UserEmail,
  SiteFeeSettings,
  WorkstreamUploadRecord,
  Notification,
  ExtensionRequest,
  ProjectClarification
};

export interface StoreInterface {
  getOrder(id: string): Promise<Order | undefined>;
  saveOrder(order: Order): Promise<void>;
  listOrders(): Promise<Order[]>;
  listMessages(orderId: string): Promise<Message[]>;
  addMessage(message: Message): Promise<void>;
  addReview(review: Review): Promise<void>;
  listReviews(): Promise<Review[]>;
  getUser(id: string): Promise<User | undefined>;
  saveUser(user: User): Promise<void>;
  listUsers(): Promise<User[]>;
  getUploadRecord(filename: string): Promise<WorkstreamUploadRecord | undefined>;
  saveUploadRecord(filename: string, record: WorkstreamUploadRecord): Promise<void>;
  listUploadRecords(): Promise<Record<string, WorkstreamUploadRecord>>;
  deleteUploadRecord(filename: string): Promise<void>;
}

export class PostgresAsyncStore implements StoreInterface {
  async getOrder(id: string): Promise<Order | undefined> {
    const res = await postgresStore.getPool().query('SELECT * FROM orders WHERE id = $1', [id]);
    if (res.rows.length === 0) return undefined;
    const r = res.rows[0];
    const resolvedType = r.order_type || (r.project_id ? 'project' : 'gig');
    return {
      id: r.id,
      title: r.title,
      orderTitle: r.title,
      buyerId: r.buyer_id,
      sellerId: r.seller_id,
      amount: Number(r.amount),
      status: r.status,
      createdAt: r.created_at,
      dueDate: r.due_date || r.created_at,
      completedAt: r.completed_at || undefined,
      requirements: r.requirements || undefined,
      deliverables: r.deliverables || undefined,
      deliverableFiles: r.deliverable_files || [],
      revisions: r.revisions || [],
      adminNotes: r.admin_notes || undefined,
      isMuted: Boolean(r.is_muted),
      escrowProtectionStartDate: r.escrow_protection_start_date || undefined,
      escrowProtectionEndDate: r.escrow_protection_end_date || undefined,
      gigId: r.gig_id || undefined,
      projectId: r.project_id || undefined,
      serviceUrl: r.service_url || undefined,
      gigSlug: r.gig_slug || undefined,
      sellerUsername: r.seller_username || undefined,
      buyerUsername: r.buyer_username || undefined,
      serviceTitle: r.service_title || undefined,
      serviceThumbnail: r.service_thumbnail || undefined,
      isTimerPaused: Boolean(r.is_timer_paused),
      feeBreakdown: r.fee_breakdown || undefined,
      deliveryHistory: r.delivery_history || [],
      deliveryNotes: r.delivery_notes || undefined,
      deliveryReference: r.delivery_reference || undefined,
      acceptedVersion: r.accepted_version ?? undefined,
      reviewWindowDays: r.review_window_days ?? undefined,
      reviewWindowExpiresAt: r.review_window_expires_at || undefined,
      review: r.review || undefined,
      workspaceId: r.workspace_id || undefined,
      sellerReview: r.seller_review || undefined,
      previousStatus: r.previous_status || undefined,
      orderType: resolvedType,
      type: resolvedType,
      gigOrderId: r.gig_order_id || (resolvedType === 'gig' ? r.id : undefined),
      projectOrderId: r.project_order_id || (resolvedType === 'project' ? r.id : undefined),
      proposalId: r.proposal_id || undefined,
      extensionRequests: r.extension_requests || [],
      freeExtensionUsed: Boolean(r.free_extension_used),
      cancellationRequest: r.cancellation_request || undefined,
      cancellationHistory: r.cancellation_history || [],
      cancellationType: r.cancellation_type || undefined,
      reviewWindowRestartedAt: r.review_window_restarted_at || undefined,
      responseDeadline: r.response_deadline || undefined
    } as unknown as Order;
  }

  async saveOrder(order: Order): Promise<void> {
    const resolvedOrderType = order.orderType || (order as any).type || (order.projectId ? 'project' : 'gig');
    await postgresStore.getPool().query(
      `INSERT INTO orders (
        id, title, buyer_id, seller_id, amount, status, created_at, due_date, completed_at, 
        requirements, deliverables, deliverable_files, revisions, admin_notes, is_muted, 
        escrow_protection_start_date, escrow_protection_end_date, gig_id, project_id, 
        service_url, gig_slug, seller_username, buyer_username, service_title, service_thumbnail, 
        is_timer_paused, fee_breakdown, delivery_history, delivery_notes, delivery_reference, 
        accepted_version, review_window_days, review_window_expires_at, review,
        workspace_id, seller_review, previous_status,
        order_type, gig_order_id, project_order_id, proposal_id, extension_requests,
        free_extension_used, cancellation_request, cancellation_history, cancellation_type,
        review_window_restarted_at, response_deadline
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37,
        $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        buyer_id = EXCLUDED.buyer_id,
        seller_id = EXCLUDED.seller_id,
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        created_at = EXCLUDED.created_at,
        due_date = EXCLUDED.due_date,
        completed_at = EXCLUDED.completed_at,
        requirements = EXCLUDED.requirements,
        deliverables = EXCLUDED.deliverables,
        deliverable_files = EXCLUDED.deliverable_files,
        revisions = EXCLUDED.revisions,
        admin_notes = EXCLUDED.admin_notes,
        is_muted = EXCLUDED.is_muted,
        escrow_protection_start_date = EXCLUDED.escrow_protection_start_date,
        escrow_protection_end_date = EXCLUDED.escrow_protection_end_date,
        gig_id = EXCLUDED.gig_id,
        project_id = EXCLUDED.project_id,
        service_url = EXCLUDED.service_url,
        gig_slug = EXCLUDED.gig_slug,
        seller_username = EXCLUDED.seller_username,
        buyer_username = EXCLUDED.buyer_username,
        service_title = EXCLUDED.service_title,
        service_thumbnail = EXCLUDED.service_thumbnail,
        is_timer_paused = EXCLUDED.is_timer_paused,
        fee_breakdown = EXCLUDED.fee_breakdown,
        delivery_history = EXCLUDED.delivery_history,
        delivery_notes = EXCLUDED.delivery_notes,
        delivery_reference = EXCLUDED.delivery_reference,
        accepted_version = EXCLUDED.accepted_version,
        review_window_days = EXCLUDED.review_window_days,
        review_window_expires_at = EXCLUDED.review_window_expires_at,
        review = EXCLUDED.review,
        workspace_id = EXCLUDED.workspace_id,
        seller_review = EXCLUDED.seller_review,
        previous_status = EXCLUDED.previous_status,
        order_type = EXCLUDED.order_type,
        gig_order_id = EXCLUDED.gig_order_id,
        project_order_id = EXCLUDED.project_order_id,
        proposal_id = EXCLUDED.proposal_id,
        extension_requests = EXCLUDED.extension_requests,
        free_extension_used = EXCLUDED.free_extension_used,
        cancellation_request = EXCLUDED.cancellation_request,
        cancellation_history = EXCLUDED.cancellation_history,
        cancellation_type = EXCLUDED.cancellation_type,
        review_window_restarted_at = EXCLUDED.review_window_restarted_at,
        response_deadline = EXCLUDED.response_deadline`,
      [
        order.id, order.title || (order as any).orderTitle || 'Untitled Order', order.buyerId, order.sellerId, order.amount, order.status,
        order.createdAt, order.dueDate || order.createdAt, order.completedAt || null, order.requirements || null,
        order.deliverables || null, JSON.stringify(order.deliverableFiles || []),
        JSON.stringify(order.revisions || []), order.adminNotes || null, Boolean(order.isMuted),
        order.escrowProtectionStartDate || null, order.escrowProtectionEndDate || null,
        order.gigId || null, order.projectId || null, order.serviceUrl || null,
        order.gigSlug || null, order.sellerUsername || null, order.buyerUsername || null,
        order.serviceTitle || null, order.serviceThumbnail || null, Boolean(order.isTimerPaused),
        JSON.stringify(order.feeBreakdown || null), JSON.stringify(order.deliveryHistory || []),
        order.deliveryNotes || null, order.deliveryReference || null, order.acceptedVersion ?? null,
        order.reviewWindowDays ?? null, order.reviewWindowExpiresAt || null, JSON.stringify(order.review || null),
        (order as any).workspaceId || null, JSON.stringify((order as any).sellerReview || null), (order as any).previousStatus || null,
        resolvedOrderType,
        order.gigOrderId || (resolvedOrderType === 'gig' ? order.id : null),
        order.projectOrderId || (resolvedOrderType === 'project' ? order.id : null),
        order.proposalId || null,
        JSON.stringify(order.extensionRequests || []),
        Boolean(order.freeExtensionUsed),
        JSON.stringify(order.cancellationRequest || null),
        JSON.stringify(order.cancellationHistory || []),
        order.cancellationType || null,
        order.reviewWindowRestartedAt || null,
        order.responseDeadline || null
      ]
    );
  }

  async listOrders(): Promise<Order[]> {
    return await postgresStore.listOrders();
  }

  async listMessages(orderId: string): Promise<Message[]> {
    const res = await postgresStore.getPool().query(
      'SELECT * FROM messages WHERE order_id = $1 ORDER BY timestamp ASC',
      [orderId]
    );
    return res.rows.map(r => ({
      id: r.id,
      orderId: r.order_id,
      senderId: r.sender_id,
      senderName: r.sender_name,
      text: r.text,
      timestamp: r.timestamp,
      type: r.type || undefined,
      fileInfo: r.file_info || undefined,
      metadata: r.metadata || undefined
    }));
  }

  async addMessage(message: Message): Promise<void> {
    await postgresStore.getPool().query(
      `INSERT INTO messages (id, order_id, sender_id, sender_name, text, timestamp, type, file_info, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         order_id = EXCLUDED.order_id,
         sender_id = EXCLUDED.sender_id,
         sender_name = EXCLUDED.sender_name,
         text = EXCLUDED.text,
         timestamp = EXCLUDED.timestamp,
         type = EXCLUDED.type,
         file_info = EXCLUDED.file_info,
         metadata = EXCLUDED.metadata`,
      [
        message.id, message.orderId, message.senderId, message.senderName, message.text, message.timestamp,
        message.type || 'message', JSON.stringify(message.fileInfo || null), JSON.stringify(message.metadata || null)
      ]
    );
  }

  async addReview(review: Review): Promise<void> {
    await postgresStore.getPool().query(
      `INSERT INTO reviews (
        id, order_id, reviewer_id, reviewer_name, reviewer_avatar, target_user_id, 
        rating, comment, order_title, gig_id, project_id, created_at, updated_at, is_cancelled_order, reply, moderation_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        order_id = EXCLUDED.order_id,
        reviewer_id = EXCLUDED.reviewer_id,
        reviewer_name = EXCLUDED.reviewer_name,
        reviewer_avatar = EXCLUDED.reviewer_avatar,
        target_user_id = EXCLUDED.target_user_id,
        rating = EXCLUDED.rating,
        comment = EXCLUDED.comment,
        order_title = EXCLUDED.order_title,
        gig_id = EXCLUDED.gig_id,
        project_id = EXCLUDED.project_id,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        is_cancelled_order = EXCLUDED.is_cancelled_order,
        reply = EXCLUDED.reply,
        moderation_status = EXCLUDED.moderation_status`,
      [
        review.id, review.orderId || null, review.reviewerId || null, review.reviewerName || null, review.reviewerAvatar || null,
        review.targetUserId || null, review.rating, review.comment || null, review.orderTitle || null, review.gigId || null,
        review.projectId || null, review.createdAt || null, review.updatedAt || null, Boolean(review.isCancelledOrder),
        JSON.stringify(review.reply || null), (review as any).moderationStatus || null
      ]
    );
  }

  async listReviews(): Promise<Review[]> {
    return await postgresStore.listReviews();
  }

  async getUser(id: string): Promise<User | undefined> {
    const res = await postgresStore.getPool().query('SELECT * FROM users WHERE id = $1', [id]);
    if (res.rows.length === 0) return undefined;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      username: r.username || undefined,
      email: r.email,
      mobile: r.mobile || undefined,
      role: r.role,
      avatar: r.avatar || '',
      title: r.title || '',
      rating: Number(r.rating || 5.0),
      reviewsCount: Number(r.reviews_count || 0),
      hourlyRate: Number(r.hourly_rate || 0),
      earned: Number(r.earned || 0),
      completedJobs: Number(r.completed_jobs || 0),
      bio: r.bio || '',
      skills: r.skills || [],
      status: r.status,
      verified: Boolean(r.verified),
      emailVerified: Boolean(r.email_verified),
      mobileVerified: Boolean(r.mobile_verified),
      walletBalance: Number(r.wallet_balance || 0),
      createdAt: r.created_at,
      isFlagged: Boolean(r.is_flagged),
      flagReason: r.flag_reason || undefined,
      password: r.password || undefined,
      sessionVersion: Number(r.session_version || 1),
      knownDevices: r.known_devices || [],
      isAvailableNow: Boolean(r.is_available_now),
      notificationPreferences: r.notification_preferences || undefined
    };
  }

  async saveUser(u: User): Promise<void> {
    await postgresStore.getPool().query(
      `INSERT INTO users (
        id, name, username, email, mobile, role, avatar, title, rating, reviews_count, 
        hourly_rate, earned, completed_jobs, bio, skills, status, verified, email_verified, 
        mobile_verified, wallet_balance, created_at, is_flagged, flag_reason, password, 
        session_version, known_devices, is_available_now, notification_preferences
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        username = EXCLUDED.username,
        email = EXCLUDED.email,
        mobile = EXCLUDED.mobile,
        role = EXCLUDED.role,
        avatar = EXCLUDED.avatar,
        title = EXCLUDED.title,
        rating = EXCLUDED.rating,
        reviews_count = EXCLUDED.reviews_count,
        hourly_rate = EXCLUDED.hourly_rate,
        earned = EXCLUDED.earned,
        completed_jobs = EXCLUDED.completed_jobs,
        bio = EXCLUDED.bio,
        skills = EXCLUDED.skills,
        status = EXCLUDED.status,
        verified = EXCLUDED.verified,
        email_verified = EXCLUDED.email_verified,
        mobile_verified = EXCLUDED.mobile_verified,
        wallet_balance = EXCLUDED.wallet_balance,
        created_at = EXCLUDED.created_at,
        is_flagged = EXCLUDED.is_flagged,
        flag_reason = EXCLUDED.flag_reason,
        password = EXCLUDED.password,
        session_version = EXCLUDED.session_version,
        known_devices = EXCLUDED.known_devices,
        is_available_now = EXCLUDED.is_available_now,
        notification_preferences = EXCLUDED.notification_preferences`,
      [
        u.id, u.name, u.username || null, u.email, u.mobile || null, u.role, u.avatar || null,
        u.title || null, u.rating ?? 5.0, u.reviewsCount ?? 0, u.hourlyRate ?? 0, u.earned ?? 0,
        u.completedJobs ?? 0, u.bio || null, u.skills || [], u.status || 'active',
        Boolean(u.verified), Boolean(u.emailVerified), Boolean(u.mobileVerified), u.walletBalance ?? 0,
        u.createdAt || new Date().toISOString(), Boolean(u.isFlagged), u.flagReason || null,
        u.password || null, u.sessionVersion ?? 1, u.knownDevices || ['dev_default_session'],
        Boolean(u.isAvailableNow), u.notificationPreferences ? JSON.stringify(u.notificationPreferences) : null
      ]
    );
  }

  async listUsers(): Promise<User[]> {
    return await postgresStore.listUsers();
  }

  async getUploadRecord(filename: string): Promise<WorkstreamUploadRecord | undefined> {
    const records = await postgresStore.listUploadRecords();
    return records[filename];
  }

  async saveUploadRecord(filename: string, record: WorkstreamUploadRecord): Promise<void> {
    await postgresStore.saveUploadRecord(filename, record);
  }

  async listUploadRecords(): Promise<Record<string, WorkstreamUploadRecord>> {
    return await postgresStore.listUploadRecords();
  }

  async deleteUploadRecord(filename: string): Promise<void> {
    await postgresStore.deleteUploadRecord(filename);
  }
}

export const store: StoreInterface = new PostgresAsyncStore();

export function saveOrdersToDisk() { return Promise.resolve(); }
export function saveMessagesToDisk() { return Promise.resolve(); }
export function saveReviewsToDisk() { return Promise.resolve(); }
export function saveProjectClarificationsToDisk() { return Promise.resolve(); }
export function saveWorkstreamUploadIndex() { return Promise.resolve(); }

export async function hydrateStoreFromPostgres() {
  if (!isPostgresEnabled()) {
    postgresStore.isHydrated = true;
    console.log('DEV mode: Postgres disabled');
    return;
  }
  try {
    await postgresStore.runMigrations();
    postgresStore.isHydrated = true;

    try {
      const persistedSettings = await postgresStore.loadSiteSettings();
      if (persistedSettings) siteSettings.loadFromState(persistedSettings);

      const persistedGateways = await postgresStore.loadPaymentGateways();
      if (persistedGateways) paymentGatewayManager.loadFromState(persistedGateways);

      const persistedCategories = await postgresStore.loadCategories();
      if (persistedCategories && Array.isArray(persistedCategories)) {
        const { setCategories } = await import('./routes/adminRoutes.js');
        setCategories(persistedCategories);
      }
    } catch (settErr) {
      console.warn('[Store] Notice: Failed to hydrate site settings/gateways/categories:', settErr);
    }

    const isProduction = process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_DATA !== 'true';
    const pool = postgresStore.getPool();
    const userCountRes = await pool.query('SELECT COUNT(*) as c FROM users');
    const userCount = Number(userCountRes.rows[0]?.c || 0);

    if (!isProduction && userCount === 0 && !(await postgresStore.isInitialized())) {
      const defaultPass = await bcrypt.hash('Password123!', 10);
      const nowIso = new Date().toISOString();
      const seedUsers: User[] = [
        {
          id: 'u1',
          name: 'Sarah Jenkins',
          username: 'sarah_j',
          email: 'sarah.j@example.com',
          role: 'freelancer',
          avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
          title: 'Principal Full-Stack & Cloud Architect',
          rating: 4.9,
          reviewsCount: 124,
          hourlyRate: 95,
          earned: 42500,
          completedJobs: 48,
          bio: '10+ years building distributed systems, high-scale Node.js backends, React SPAs, and PostgreSQL architectures.',
          skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'Cloud Architecture'],
          status: 'active',
          verified: true,
          emailVerified: true,
          mobileVerified: true,
          walletBalance: 1420,
          createdAt: nowIso,
          password: defaultPass,
          sessionVersion: 1,
          knownDevices: ['dev_default_session'],
          isAvailableNow: true
        },
        {
          id: 'u2',
          name: 'Marcus Vance',
          username: 'marcus_v',
          email: 'marcus.v@example.com',
          role: 'buyer',
          avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
          title: 'VP of Engineering & Product Buyer',
          rating: 5.0,
          reviewsCount: 38,
          hourlyRate: 0,
          earned: 0,
          completedJobs: 19,
          bio: 'Hiring top engineering and design talent for enterprise software initiatives.',
          skills: ['Product Management', 'SaaS', 'FinTech'],
          status: 'active',
          verified: true,
          emailVerified: true,
          mobileVerified: true,
          walletBalance: 5000,
          createdAt: nowIso,
          password: defaultPass,
          sessionVersion: 1,
          knownDevices: ['dev_default_session'],
          isAvailableNow: true
        },
        {
          id: 'u3',
          name: 'Elena Rostova',
          username: 'elena_r',
          email: 'elena.r@example.com',
          role: 'freelancer',
          avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
          title: 'AI Systems Engineer & UI/UX Specialist',
          rating: 5.0,
          reviewsCount: 89,
          hourlyRate: 120,
          earned: 68400,
          completedJobs: 62,
          bio: 'Specializing in production AI agents, RAG pipelines, and high-converting SaaS interfaces.',
          skills: ['AI Agents', 'Python', 'TypeScript', 'UI/UX Design', 'Next.js'],
          status: 'active',
          verified: true,
          emailVerified: true,
          mobileVerified: true,
          walletBalance: 3250,
          createdAt: nowIso,
          password: defaultPass,
          sessionVersion: 1,
          knownDevices: ['dev_default_session'],
          isAvailableNow: true
        },
        {
          id: 'admin_1',
          name: 'Platform Admin',
          username: 'admin',
          email: 'admin@workperhour.com',
          role: 'super_admin',
          avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
          title: 'Trust & Safety Administrator',
          rating: 5.0,
          reviewsCount: 0,
          hourlyRate: 0,
          earned: 0,
          completedJobs: 0,
          bio: 'WorkPerHour Marketplace Administration & Escrow Oversight.',
          skills: ['Escrow Auditing', 'Dispute Resolution', 'Security'],
          status: 'active',
          verified: true,
          emailVerified: true,
          mobileVerified: true,
          walletBalance: 10000,
          createdAt: nowIso,
          password: defaultPass,
          sessionVersion: 1,
          knownDevices: ['dev_default_session'],
          isAvailableNow: true
        }
      ];

      for (const u of seedUsers) {
        await store.saveUser(u);
        await financialTransactionService.ensureWallet({
          userId: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          initialBalance: u.walletBalance
        });
      }

      const seedGigs = [
        {
          id: 'g1',
          freelancerId: 'u1',
          freelancerName: 'Sarah Jenkins',
          freelancerUsername: 'sarah_j',
          freelancerAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
          freelancerLevel: 'Top Rated ★★★',
          title: 'I will architect and build a production full-stack React, Node.js and PostgreSQL web application',
          slug: 'architect-build-production-full-stack-react-nodejs-postgresql-web-app',
          category: 'Technology & Programming',
          subcategory: 'Web Development',
          description: 'Complete end-to-end full-stack engineering with TypeScript, React, Express, and transactional PostgreSQL persistence.',
          price: 450,
          deliveryDays: 7,
          rating: 4.9,
          reviewsCount: 124,
          tags: ['React', 'PostgreSQL', 'Node.js', 'TypeScript'],
          coverImage: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop&q=80',
          status: 'published',
          createdAt: nowIso
        },
        {
          id: 'g2',
          freelancerId: 'u3',
          freelancerName: 'Elena Rostova',
          freelancerUsername: 'elena_r',
          freelancerAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
          freelancerLevel: 'Top Rated ★★★',
          title: 'I will build custom AI agents, RAG pipelines, and enterprise LLM integrations',
          slug: 'build-custom-ai-agents-rag-pipelines-enterprise-llm-integrations',
          category: 'AI Services',
          subcategory: 'AI Agents',
          description: 'Production-grade AI workflows, vector search, function calling, and automated reasoning pipelines.',
          price: 650,
          deliveryDays: 5,
          rating: 5.0,
          reviewsCount: 89,
          tags: ['AI Agents', 'LLM', 'TypeScript', 'Python'],
          coverImage: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&auto=format&fit=crop&q=80',
          status: 'published',
          createdAt: nowIso
        }
      ];

      for (const g of seedGigs) {
        await pool.query(
          `INSERT INTO gigs (
            id, freelancer_id, freelancer_name, freelancer_username, freelancer_avatar, freelancer_level,
            title, slug, category, subcategory, description, price, delivery_days, rating, reviews_count,
            tags, cover_image, gallery, status, created_at, extras
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          ON CONFLICT (id) DO NOTHING`,
          [
            g.id, g.freelancerId, g.freelancerName, g.freelancerUsername, g.freelancerAvatar, g.freelancerLevel,
            g.title, g.slug, g.category, g.subcategory, g.description, g.price, g.deliveryDays, g.rating, g.reviewsCount,
            g.tags, g.coverImage, [], g.status, g.createdAt, JSON.stringify([])
          ]
        );
      }

      await pool.query(
        `INSERT INTO projects (
          id, buyer_id, buyer_name, title, slug, description, category, budget_type, budget, duration, status, proposals_count, skills, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO NOTHING`,
        [
          'p1', 'u2', 'Marcus Vance',
          'Enterprise Escrow Payment & Real-Time Workstream Portal',
          'enterprise-escrow-payment-real-time-workstream-portal',
          'Looking for a senior full-stack architect to build a high-reliability escrow ledger and real-time WebSocket collaboration portal backed by PostgreSQL.',
          'Technology & Programming', 'fixed', 1500, '2 weeks', 'open', 0,
          ['PostgreSQL', 'React', 'Node.js', 'WebSockets'], nowIso
        ]
      );

      await postgresStore.markInitialized();
    }

    await workspaceService.hydrateFromPostgres();

    const orderCountRes = await pool.query('SELECT COUNT(*) as c FROM orders');
    const orderCount = Number(orderCountRes.rows[0]?.c || 0);
    const seedCheckUsers = await pool.query("SELECT id FROM users WHERE id IN ('u1', 'u2')");

    if (!isProduction && orderCount === 0 && seedCheckUsers.rows.length === 2) {
      const todayDate = new Date().toISOString().split('T')[0];
      const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      const protectionEnd = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      const nowIso = new Date().toISOString();
      const seedOrderId = 'ord_seed_1';
      const seedWs = workspaceService.createWorkspace({
        buyerId: 'u2',
        sellerId: 'u1',
        originType: 'gig',
        originId: 'g1',
        activeOrderId: seedOrderId
      });

      const seedOrder: Order = {
        id: seedOrderId,
        workspaceId: seedWs.workspaceId,
        orderType: 'gig',
        type: 'gig',
        gigOrderId: seedOrderId,
        title: 'I will architect and build a production full-stack React, Node.js and PostgreSQL web application',
        orderTitle: 'I will architect and build a production full-stack React, Node.js and PostgreSQL web application',
        buyerId: 'u2',
        sellerId: 'u1',
        buyerUsername: 'marcus_v',
        sellerUsername: 'sarah_j',
        serviceTitle: 'I will architect and build a production full-stack React, Node.js and PostgreSQL web application',
        serviceThumbnail: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop&q=80',
        gigId: 'g1',
        gigSlug: 'architect-build-production-full-stack-react-nodejs-postgresql-web-app',
        serviceUrl: '/gig/g1/architect-build-production-full-stack-react-nodejs-postgresql-web-app',
        amount: 450,
        status: 'funded_in_escrow',
        createdAt: todayDate,
        dueDate,
        escrowProtectionStartDate: todayDate,
        escrowProtectionEndDate: protectionEnd,
        requirements: 'Build an enterprise-grade Workstream & Escrow collaboration module with real-time WebSockets and 100% PostgreSQL persistence.',
        feeBreakdown: financeLedger.quoteOrder(450),
        deliverableFiles: [],
        revisions: [],
        deliveryHistory: [],
        extensionRequests: [],
        freeExtensionUsed: false,
        cancellationHistory: []
      } as unknown as Order;

      await store.saveOrder(seedOrder);
      workspaceService.ensureWorkspaceForOrder(seedOrder);

      await pool.query(
        `INSERT INTO escrow_records (order_id, order_title, buyer_id, seller_id, initial_amount, remaining, released, refunded, platform_fee, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 'held', $7, $7)
         ON CONFLICT (order_id) DO NOTHING`,
        [seedOrderId, seedOrder.title, 'u2', 'u1', 450, 450, nowIso]
      );

      const seedMessages: Message[] = [
        {
          id: 'msg_seed_1',
          orderId: seedOrderId,
          senderId: 'system',
          senderName: 'System',
          text: `Order placed: ${seedOrder.title}. $450.00 is held safely in escrow until the work is approved.`,
          timestamp: new Date(Date.now() - 3600_000 * 4).toISOString(),
          type: 'system',
          metadata: { action: 'order_created', amount: 450 }
        },
        {
          id: 'msg_seed_2',
          orderId: seedOrderId,
          senderId: 'u2',
          senderName: 'Marcus Vance',
          text: 'Hi Sarah! Looking forward to collaborating on the PostgreSQL Workstream & Escrow architecture. I have shared the requirements above.',
          timestamp: new Date(Date.now() - 3600_000 * 3).toISOString(),
          type: 'message'
        },
        {
          id: 'msg_seed_3',
          orderId: seedOrderId,
          senderId: 'u1',
          senderName: 'Sarah Jenkins',
          text: 'Thanks Marcus! I have reviewed the technical specifications and started setting up the transactional PostgreSQL persistence layer. I will share a progress update shortly.',
          timestamp: new Date(Date.now() - 3600_000 * 2).toISOString(),
          type: 'message'
        }
      ];

      for (const m of seedMessages) {
        await store.addMessage(m);
      }
    }

    const allOrders = await store.listOrders();
    if (allOrders.length > 0) {
      const migrated = workspaceService.migrateLegacyOrders(allOrders, false);
      if (migrated.migratedCount > 0) {
        for (const o of allOrders) {
          await store.saveOrder(o);
        }
      }
    }

    console.log('[PostgresStore] Zero split-brain Cloud Run architecture initialized. PostgreSQL is the 100% source of truth.');
  } catch (err: any) {
    if (process.env.NODE_ENV === 'production') {
      console.error('FATAL: PostgreSQL failed to initialize in production mode:', err);
      throw err;
    }
    if (err?.code === 'ECONNREFUSED' || err?.message?.includes('ECONNREFUSED')) {
      console.warn('WARNING: PostgreSQL connection refused (ECONNREFUSED). Falling back to non-postgres mode for local development/preview.');
      postgresStore.isHydrated = true;
      return;
    }
    console.error('CRITICAL: Failed to initialize PostgreSQL at startup:', err);
    throw err;
  }
}

export async function cleanAllStoreData() {
  await postgresStore.cleanAllData();
  await financialRepository.hydrateFromPostgres();
  await workspaceService.hydrateFromPostgres();
  console.log('[Store] Cleaned all data from PostgreSQL.');
}

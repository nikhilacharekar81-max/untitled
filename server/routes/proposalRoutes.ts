import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  store,
  type Proposal,
  type Order,
  type WorkstreamOffer
} from '../store.js';
import { postgresStore } from '../db/postgresStore.js';
import {
  requireAuth,
  requireActiveStatus,
  requireAdmin,
  resolveAuthenticatedUserId,
  adminActor,
  rateLimit
} from '../middleware/auth.js';
import { workspaceService } from '../../src/server/workspaceService.js';
import { financeLedger } from '../../src/server/financeLedger.js';
import { siteSettings } from '../../src/server/siteSettings.js';
import { emitSystemEvent } from '../services/messagingService.js';
import { createNotification } from '../services/notificationService.js';
import {
  ensureWallet,
  recordOrder,
  orderIndex,
  tryAcquireOrderLock,
  releaseOrderLock,
  fundOrderEscrowWithEvent,
  syncUserBalances,
  enrichOrderWithServiceInfo,
  registerAuditLog
} from '../services/orderService.js';
import { postOfferMessage, viewOffer } from '../services/workstreamService.js';

export const proposalRouter = Router();

export async function enrichProposalWithWorkstream(p: Proposal): Promise<Proposal> {
  let workstreamOrderId = p.workstreamOrderId;
  let offerId = p.offerId;
  if (!workstreamOrderId) {
    const ordRes = await postgresStore.getPool().query("SELECT id FROM orders WHERE fee_breakdown->>'proposalId' = $1 OR requirements LIKE $2", [p.id, `%${p.id}%`]);
    if (ordRes.rows.length > 0) workstreamOrderId = ordRes.rows[0].id;
  }
  if (!offerId && workstreamOrderId) {
    const offRes = await postgresStore.getPool().query(
      "SELECT id FROM workstream_offers WHERE metadata->>'proposalId' = $1 OR (order_id = $2 AND kind = 'proposal')",
      [p.id, workstreamOrderId]
    );
    if (offRes.rows.length > 0) offerId = offRes.rows[0].id;
  }
  return {
    ...p,
    ...(workstreamOrderId ? { workstreamOrderId } : {}),
    ...(offerId ? { offerId } : {})
  };
}

// Proposals list
proposalRouter.get('/proposals', async (req: Request, res: Response) => {
  try {
    const authUserId = resolveAuthenticatedUserId(req);
    if (!authUserId) {
      return res.json([]);
    }
    const userRes = await postgresStore.getPool().query('SELECT role FROM users WHERE id = $1', [authUserId]);
    const callerRole = userRes.rows[0]?.role;
    const isAdmin = callerRole === 'admin' || callerRole === 'super_admin' || callerRole === 'support';

    let queryText = 'SELECT * FROM proposals ORDER BY created_at DESC';
    let queryParams: any[] = [];
    if (!isAdmin) {
      queryText = `
        SELECT p.* FROM proposals p
        LEFT JOIN projects pr ON p.project_id = pr.id
        WHERE p.freelancer_id = $1 OR pr.buyer_id = $1
        ORDER BY p.created_at DESC
      `;
      queryParams = [authUserId];
    }

    const propRes = await postgresStore.getPool().query(queryText, queryParams);
    const userProposals: Proposal[] = propRes.rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      freelancerId: r.freelancer_id,
      freelancerName: r.freelancer_name,
      freelancerAvatar: r.freelancer_avatar || '',
      freelancerTitle: r.freelancer_title || '',
      coverLetter: r.cover_letter || '',
      bidAmount: Number(r.bid_amount),
      deliveryDays: Number(r.delivery_days),
      createdAt: r.created_at,
      status: r.status,
      workstreamOrderId: r.workstream_order_id || undefined,
      offerId: r.offer_id || undefined
    }));

    const enriched = await Promise.all(userProposals.map(enrichProposalWithWorkstream));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list proposals' });
  }
});

// Submit proposal
proposalRouter.post('/proposals', requireAuth, requireActiveStatus, rateLimit(30, 60_000), async (req: Request, res: Response) => {
  try {
    const caller = (req as any).authenticatedUser;
    if (caller.status === 'restricted') return res.status(403).json({ error: 'Restricted: You cannot submit new proposals while your account is restricted.' });

    const projRes = await postgresStore.getPool().query('SELECT * FROM projects WHERE id = $1', [req.body.projectId]);
    if (projRes.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
    const proj = projRes.rows[0];

    if (!['open', 'published', 'in_progress'].includes(proj.status)) {
      return res.status(400).json({ error: 'This project is completed and closed to new proposals.' });
    }
    if (proj.buyer_id === caller.id) {
      return res.status(400).json({ error: 'You cannot submit a proposal to your own project.' });
    }
    const bidAmount = Math.round(Number(req.body.bidAmount) * 100) / 100;
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      return res.status(400).json({ error: 'Enter a valid USD bid amount.' });
    }
    const deliveryDays = Math.max(1, Math.min(365, Math.round(Number(req.body.deliveryDays) || 7)));

    const newPropId = 'prop_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const createdAt = new Date().toISOString().split('T')[0];
    const coverLetter = typeof req.body.coverLetter === 'string' ? req.body.coverLetter.trim().slice(0, 5000) : '';

    await postgresStore.getPool().query(
      `INSERT INTO proposals (
        id, project_id, freelancer_id, freelancer_name, freelancer_avatar, 
        freelancer_title, cover_letter, bid_amount, delivery_days, created_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
      [newPropId, req.body.projectId, caller.id, caller.name, caller.avatar || null, caller.title || 'Senior Engineer', coverLetter, bidAmount, deliveryDays, createdAt]
    );

    await postgresStore.getPool().query(
      'UPDATE projects SET proposals_count = proposals_count + 1 WHERE id = $1',
      [req.body.projectId]
    );

    const newProp: Proposal = {
      id: newPropId,
      projectId: req.body.projectId,
      freelancerId: caller.id,
      freelancerName: caller.name,
      freelancerAvatar: caller.avatar,
      freelancerTitle: caller.title || 'Senior Engineer',
      coverLetter,
      bidAmount,
      deliveryDays,
      createdAt,
      status: 'pending'
    };

    createNotification({
      userId: proj.buyer_id,
      type: 'proposal',
      title: 'New Proposal Received',
      message: `${caller.name} submitted a $${bidAmount} proposal for your project "${proj.title}".`,
      link: `/projects/${proj.id}`,
      dedupKey: `proposal_${newProp.id}`,
      actorId: caller.id
    });

    res.json(newProp);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to submit proposal' });
  }
});

// Accept Proposal Handler
export async function processProposalAccept(req: any, res: any) {
  const proposalId = req.params.id;
  const propRes = await postgresStore.getPool().query('SELECT * FROM proposals WHERE id = $1', [proposalId]);
  if (propRes.rows.length === 0) return res.status(404).json({ error: 'Proposal not found' });
  const r = propRes.rows[0];
  const proposal: Proposal = {
    id: r.id,
    projectId: r.project_id,
    freelancerId: r.freelancer_id,
    freelancerName: r.freelancer_name,
    freelancerAvatar: r.freelancer_avatar || '',
    freelancerTitle: r.freelancer_title || '',
    coverLetter: r.cover_letter || '',
    bidAmount: Number(r.bid_amount),
    deliveryDays: Number(r.delivery_days),
    createdAt: r.created_at,
    status: r.status
  };

  const projRes = await postgresStore.getPool().query('SELECT * FROM projects WHERE id = $1', [proposal.projectId]);
  if (projRes.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
  const proj = projRes.rows[0];

  if (!tryAcquireOrderLock(proposal.id, res)) return;
  try {
    const authUserId = (req as any).authenticatedUserId;
    const caller = (req as any).authenticatedUser || (await store.getUser(authUserId));
    if (!caller || (caller.status !== 'active' && caller.status !== 'restricted')) return res.status(403).json({ error: 'Authentication required' });
    if (proj.buyer_id !== caller.id) return res.status(403).json({ error: 'Forbidden: Only the project buyer can accept proposals.' });
    if (proj.status !== 'open' && proj.status !== 'published' && proj.status !== 'in_progress') {
      return res.status(409).json({ error: `Project is no longer open for proposal acceptance (status: ${proj.status}).` });
    }
    if (proposal.status !== 'pending') {
      return res.status(409).json({ error: `Proposal is already ${proposal.status}.` });
    }

    await ensureWallet(proj.buyer_id);
    await ensureWallet(proposal.freelancerId);

    const userWorkspaces = await workspaceService.getWorkspacesForUserAsync(proj.buyer_id);
    let workspace = userWorkspaces.find(w =>
      w.sellerId === proposal.freelancerId &&
      w.originType === 'project' &&
      w.originId === proj.id
    );
    let createdNewWorkspace = false;
    if (!workspace) {
      workspace = workspaceService.createWorkspace({
        buyerId: proj.buyer_id,
        sellerId: proposal.freelancerId,
        originType: 'project',
        originId: proj.id
      });
      createdNewWorkspace = true;
    }

    const orderId = 'ord_' + randomUUID().slice(0, 12);
    const today = new Date().toISOString().split('T')[0];
    const protectionDays = siteSettings.getSettings().commission.escrowProtectionDays;
    const deliveryDays = proposal.deliveryDays || 7;
    const dueDate = new Date(Date.now() + deliveryDays * 86400000).toISOString().split('T')[0];

    const order: Order = {
      id: orderId,
      projectOrderId: orderId,
      workspaceId: workspace.workspaceId,
      orderType: 'project',
      type: 'project',
      title: proj.title,
      buyerId: proj.buyer_id,
      sellerId: proposal.freelancerId,
      amount: proposal.bidAmount,
      status: 'payment_pending',
      createdAt: today,
      dueDate,
      escrowProtectionStartDate: today,
      escrowProtectionEndDate: new Date(Date.now() + protectionDays * 86400000).toISOString().split('T')[0],
      projectId: proj.id,
      proposalId: proposal.id,
      feeBreakdown: financeLedger.quoteOrder(proposal.bidAmount)
    };

    const offerId = 'off_' + randomUUID().slice(0, 12);
    const offerNum = `PRP-${Date.now().toString().slice(-4)}`;
    const offer: WorkstreamOffer = {
      id: offerId,
      number: offerNum,
      orderId: order.id,
      proposalId: proposal.id,
      kind: 'proposal',
      title: proj.title,
      amount: proposal.bidAmount,
      deliveryDays: proposal.deliveryDays,
      note: proposal.coverLetter ? proposal.coverLetter.slice(0, 1000) : undefined,
      status: 'pending',
      createdBy: proposal.freelancerId,
      createdAt: new Date().toISOString()
    };

    await postgresStore.getPool().query(
      `INSERT INTO workstream_offers (id, number, order_id, kind, title, amount, delivery_days, status, created_by, created_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [offer.id, offer.number, offer.orderId, offer.kind, offer.title, offer.amount, offer.deliveryDays, offer.status, offer.createdBy, offer.createdAt, JSON.stringify({ proposalId: proposal.id })]
    );

    recordOrder(order);
    await store.saveOrder(order);
    emitSystemEvent(order.id, 'order_created', `Order placed: ${order.title}. Payment is held in escrow until the work is approved.`);
    await postOfferMessage(order, offer, null, `Proposal ${offer.number} was created.`, 'offer_created');

    try {
      await fundOrderEscrowWithEvent({
        orderId: order.id,
        orderTitle: order.title,
        amount: order.amount,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        actor: `user:${order.buyerId}`
      });

      order.status = 'funded_in_escrow';
      await store.saveOrder(order);
    } catch (fundingErr: any) {
      orderIndex.delete(order.id);
      await postgresStore.getPool().query('DELETE FROM orders WHERE id = $1', [order.id]);
      await postgresStore.getPool().query('DELETE FROM workstream_offers WHERE id = $1', [offer.id]);
      await postgresStore.getPool().query('DELETE FROM messages WHERE order_id = $1', [order.id]);

      if (createdNewWorkspace) {
        workspaceService.deleteWorkspace(workspace.workspaceId);
      }

      return res.status(400).json({ error: fundingErr.message || 'Failed to fund escrow for proposal.' });
    }

    proposal.status = 'accepted';
    proposal.workstreamOrderId = order.id;
    proposal.offerId = offer.id;
    await postgresStore.getPool().query(
      'UPDATE proposals SET status = $1, workstream_order_id = $2, offer_id = $3 WHERE id = $4',
      ['accepted', order.id, offer.id, proposal.id]
    );
    await postgresStore.getPool().query('UPDATE projects SET status = $1 WHERE id = $2', ['in_progress', proj.id]);

    await syncUserBalances();

    offer.status = 'accepted';
    offer.resolvedAt = new Date().toISOString();
    offer.resolvedBy = caller.id;
    await postgresStore.getPool().query(
      'UPDATE workstream_offers SET status = $1, resolved_at = $2, resolved_by = $3 WHERE id = $4',
      ['accepted', offer.resolvedAt, offer.resolvedBy, offer.id]
    );

    await postOfferMessage(order, offer, null, `Proposal ${offer.number} was accepted and escrow funded ($${order.amount}).`, 'offer_accepted');

    createNotification({
      userId: proposal.freelancerId,
      type: 'proposal_accepted',
      title: 'Proposal accepted',
      message: `Your proposal for "${proj.title}" was accepted and escrow has been funded.`,
      link: `/workstream/${order.id}`,
      metadata: { orderId: order.id, projectId: proj.id, proposalId: proposal.id }
    });

    res.json({ success: true, proposal: await enrichProposalWithWorkstream(proposal), order: enrichOrderWithServiceInfo(order), workspace, offer: await viewOffer(offer) });
  } finally {
    releaseOrderLock(proposal.id);
  }
}

// Decline Proposal Handler
export async function processProposalDecline(req: any, res: any) {
  const proposalId = req.params.id;
  const propRes = await postgresStore.getPool().query('SELECT * FROM proposals WHERE id = $1', [proposalId]);
  if (propRes.rows.length === 0) return res.status(404).json({ error: 'Proposal not found' });
  const r = propRes.rows[0];
  const proposal: Proposal = {
    id: r.id,
    projectId: r.project_id,
    freelancerId: r.freelancer_id,
    freelancerName: r.freelancer_name,
    freelancerAvatar: r.freelancer_avatar || '',
    freelancerTitle: r.freelancer_title || '',
    coverLetter: r.cover_letter || '',
    bidAmount: Number(r.bid_amount),
    deliveryDays: Number(r.delivery_days),
    createdAt: r.created_at,
    status: r.status
  };

  const projRes = await postgresStore.getPool().query('SELECT * FROM projects WHERE id = $1', [proposal.projectId]);
  if (projRes.rows.length === 0) return res.status(404).json({ error: 'Project not found' });
  const proj = projRes.rows[0];

  if (!tryAcquireOrderLock(proposal.id, res)) return;
  try {
    const authUserId = (req as any).authenticatedUserId;
    const caller = (req as any).authenticatedUser || (await store.getUser(authUserId));
    if (!caller || (caller.status !== 'active' && caller.status !== 'restricted')) return res.status(403).json({ error: 'Authentication required' });
    if (proj.buyer_id !== caller.id) return res.status(403).json({ error: 'Forbidden: Only the project buyer can decline proposals.' });
    if (proposal.status !== 'pending') return res.status(409).json({ error: `Proposal is already ${proposal.status}.` });

    proposal.status = 'rejected';
    await postgresStore.getPool().query('UPDATE proposals SET status = $1 WHERE id = $2', ['rejected', proposal.id]);

    createNotification({
      userId: proposal.freelancerId,
      type: 'proposal_declined',
      title: 'Proposal declined',
      message: `Your proposal for "${proj.title}" was declined.`,
      link: `/projects/${proj.id}`,
      metadata: { projectId: proj.id, proposalId: proposal.id }
    });

    res.json({ success: true, proposal: await enrichProposalWithWorkstream(proposal) });
  } finally {
    releaseOrderLock(proposal.id);
  }
}

proposalRouter.post('/proposals/:id/accept', requireAuth, requireActiveStatus, rateLimit(20, 60_000), async (req: Request, res: Response) => {
  await processProposalAccept(req, res);
});

proposalRouter.post('/proposals/:id/decline', requireAuth, requireActiveStatus, rateLimit(20, 60_000), async (req: Request, res: Response) => {
  await processProposalDecline(req, res);
});

proposalRouter.post('/proposals/:id/:action(accept|decline)', requireAuth, rateLimit(20, 60_000), async (req: Request, res: Response) => {
  if (req.params.action === 'accept') {
    return await processProposalAccept(req, res);
  } else {
    return await processProposalDecline(req, res);
  }
});

// Admin Proposals Management
proposalRouter.patch('/admin/proposals/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const propRes = await postgresStore.getPool().query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    if (propRes.rows.length === 0) return res.status(404).json({ error: 'Proposal not found' });
    const p = propRes.rows[0];

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (req.body.coverLetter !== undefined) {
      updates.push(`cover_letter = $${idx++}`);
      values.push(req.body.coverLetter);
    }
    if (req.body.bidAmount !== undefined) {
      updates.push(`bid_amount = $${idx++}`);
      values.push(Number(req.body.bidAmount));
    }
    if (req.body.deliveryDays !== undefined) {
      updates.push(`delivery_days = $${idx++}`);
      values.push(Number(req.body.deliveryDays));
    }
    if (req.body.status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(req.body.status);
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      await postgresStore.getPool().query(
        `UPDATE proposals SET ${updates.join(', ')} WHERE id = $${idx}`,
        values
      );
    }

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: adminActor(req),
      role: (req as any).authenticatedUser?.role || 'admin',
      action: 'PROPOSAL_EDITED',
      target: `Proposal #${p.id}`,
      details: `Updated bid parameters ($${req.body.bidAmount || p.bid_amount}) for freelancer ${p.freelancer_name}`,
      timestamp: new Date().toLocaleString()
    });

    const updated = await postgresStore.getPool().query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    res.json(updated.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update proposal' });
  }
});

proposalRouter.patch('/admin/proposals/:id/status', requireAdmin, async (req: Request, res: Response) => {
  try {
    const propRes = await postgresStore.getPool().query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    if (propRes.rows.length === 0) return res.status(404).json({ error: 'Proposal not found' });
    const p = propRes.rows[0];

    const oldStatus = p.status;
    await postgresStore.getPool().query('UPDATE proposals SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: adminActor(req),
      role: (req as any).authenticatedUser?.role || 'admin',
      action: `PROPOSAL_STATUS_${req.body.status.toUpperCase()}`,
      target: `Proposal #${p.id}`,
      details: `Changed proposal status from "${oldStatus}" to "${req.body.status}" for freelancer ${p.freelancer_name}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ ...p, status: req.body.status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update status' });
  }
});

proposalRouter.delete('/admin/proposals/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const propRes = await postgresStore.getPool().query('SELECT * FROM proposals WHERE id = $1', [req.params.id]);
    if (propRes.rows.length === 0) return res.status(404).json({ error: 'Proposal not found' });
    const deleted = propRes.rows[0];

    await postgresStore.getPool().query('DELETE FROM proposals WHERE id = $1', [req.params.id]);
    await postgresStore.getPool().query('UPDATE projects SET proposals_count = GREATEST(0, proposals_count - 1) WHERE id = $1', [deleted.project_id]);

    registerAuditLog({
      id: 'log_' + Date.now(),
      actor: adminActor(req),
      role: (req as any).authenticatedUser?.role || 'admin',
      action: 'PROPOSAL_DELETED',
      target: `Proposal #${deleted.id}`,
      details: `Permanently removed proposal #${deleted.id} by freelancer ${deleted.freelancer_name} from project #${deleted.project_id}`,
      timestamp: new Date().toLocaleString()
    });

    res.json({ success: true, id: deleted.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete proposal' });
  }
});

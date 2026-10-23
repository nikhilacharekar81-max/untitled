import { randomUUID } from 'node:crypto';
import { Workspace, Order } from '../types.js';
import { postgresStore } from '../../server/db/postgresStore.js';

class WorkspaceService {
  private workspaces: Map<string, Workspace> = new Map();

  public loadFromList(list: any[]) {
    if (Array.isArray(list)) {
      this.workspaces.clear();
      for (const w of list) {
        if (w?.workspaceId) this.workspaces.set(w.workspaceId, w);
      }
    }
  }

  public async hydrateFromPostgres(): Promise<void> {
    try {
      const list = await postgresStore.listWorkspaces();
      this.loadFromList(list);
    } catch (err) {
      console.error('[WorkspaceService] Failed to hydrate workspaces from PostgreSQL:', err);
    }
  }

  public listAll(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  public async listAllAsync(): Promise<Workspace[]> {
    const dbList = await postgresStore.listWorkspaces();
    this.loadFromList(dbList);
    return Array.from(this.workspaces.values());
  }

  private persistWorkspace(workspace: Workspace) {
    postgresStore.saveWorkspace(workspace).catch(err => {
      console.error(`[WorkspaceService] Failed to persist workspace ${workspace.workspaceId} to PostgreSQL:`, err);
    });
  }

  public saveToDisk() {
    const list = Array.from(this.workspaces.values());
    postgresStore.saveWorkspaces(list).catch(err => {
      console.error('[WorkspaceService] Failed to persist workspaces to PostgreSQL:', err);
    });
  }

  public createWorkspace(params: {
    buyerId: string;
    sellerId: string;
    originType: 'gig' | 'project';
    originId: string;
    activeOrderId?: string;
    title?: string;
  }): Workspace {
    const workspaceId = 'ws_' + randomUUID().slice(0, 12);
    const createdAt = new Date().toISOString().split('T')[0];
    const workspace: Workspace & { orderIds?: string[]; title?: string; updatedAt?: string } = {
      workspaceId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      originType: params.originType,
      originId: params.originId,
      createdAt,
      updatedAt: new Date().toISOString(),
      status: 'active',
      activeOrderId: params.activeOrderId,
      orderIds: params.activeOrderId ? [params.activeOrderId] : [],
      title: params.title || params.originId
    };
    this.workspaces.set(workspaceId, workspace);
    this.persistWorkspace(workspace);
    return workspace;
  }

  public getWorkspace(workspaceId: string): Workspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  public async getWorkspaceAsync(workspaceId: string): Promise<Workspace | undefined> {
    const cached = this.workspaces.get(workspaceId);
    if (cached) return cached;
    await this.hydrateFromPostgres();
    return this.workspaces.get(workspaceId);
  }

  public getWorkspacesForUser(userId: string): Workspace[] {
    return Array.from(this.workspaces.values()).filter(w => w.buyerId === userId || w.sellerId === userId);
  }

  public async getWorkspacesForUserAsync(userId: string): Promise<Workspace[]> {
    await this.hydrateFromPostgres();
    return this.getWorkspacesForUser(userId);
  }

  public findWorkspaceByOrder(orderId: string, orders: Order[]): Workspace | undefined {
    const order = orders.find(o => o.id === orderId);
    if (!order) return undefined;
    if (order.workspaceId) {
      return this.workspaces.get(order.workspaceId);
    }
    for (const w of this.workspaces.values()) {
      if (w.activeOrderId === orderId) return w;
      if (Array.isArray((w as any).orderIds) && (w as any).orderIds.includes(orderId)) return w;
      if (order.projectId && w.originType === 'project' && w.originId === order.projectId && w.buyerId === order.buyerId && w.sellerId === order.sellerId) {
        return w;
      }
    }
    return undefined;
  }

  public ensureWorkspaceForOrder(order: Order): Workspace {
    if (order.workspaceId && this.workspaces.has(order.workspaceId)) {
      const existingWs = this.workspaces.get(order.workspaceId)! as Workspace & { orderIds?: string[]; updatedAt?: string };
      if (!existingWs.activeOrderId) existingWs.activeOrderId = order.id;
      if (!Array.isArray(existingWs.orderIds)) existingWs.orderIds = [];
      if (!existingWs.orderIds.includes(order.id)) existingWs.orderIds.push(order.id);
      existingWs.updatedAt = new Date().toISOString();
      this.persistWorkspace(existingWs);
      return existingWs;
    }

    const originType = order.projectId ? 'project' : 'gig';
    const originId = order.projectId || order.gigId || order.id;

    let existing: (Workspace & { orderIds?: string[]; updatedAt?: string }) | undefined;
    const targetOriginId = order.projectId || order.gigId;
    const targetOriginType = order.projectId ? 'project' : 'gig';

    if (targetOriginId) {
      existing = Array.from(this.workspaces.values()).find(w =>
        w.buyerId === order.buyerId &&
        w.sellerId === order.sellerId &&
        w.originType === targetOriginType &&
        w.originId === targetOriginId
      );
    }

    if (!existing) {
      existing = Array.from(this.workspaces.values()).find(w =>
        w.activeOrderId === order.id || (Array.isArray((w as any).orderIds) && (w as any).orderIds.includes(order.id))
      );
    }

    if (!existing) {
      existing = this.createWorkspace({
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        originType,
        originId,
        activeOrderId: order.id,
        title: order.title || originId
      });
    } else {
      if (!existing.activeOrderId) {
        existing.activeOrderId = order.id;
      }
      if (!Array.isArray(existing.orderIds)) {
        existing.orderIds = [];
      }
      if (!existing.orderIds.includes(order.id)) {
        existing.orderIds.push(order.id);
      }
      existing.updatedAt = new Date().toISOString();
      this.persistWorkspace(existing);
    }

    order.workspaceId = existing.workspaceId;
    return existing;
  }

  public migrateLegacyOrders(orders: Order[], dryRun: boolean = false): { migratedCount: number; dryRun: boolean; details: string[] } {
    let migratedCount = 0;
    const details: string[] = [];
    for (const o of orders) {
      if (!o.workspaceId || !this.workspaces.has(o.workspaceId)) {
        migratedCount++;
        if (!dryRun) {
          const ws = this.ensureWorkspaceForOrder(o);
          details.push(`Migrated order ${o.id} to workspace ${ws.workspaceId}`);
        } else {
          details.push(`[DryRun] Would migrate order ${o.id} to workspace for buyer ${o.buyerId} & seller ${o.sellerId}`);
        }
      }
    }
    return { migratedCount, dryRun, details };
  }

  public deleteWorkspace(workspaceId: string) {
    if (this.workspaces.delete(workspaceId)) {
      postgresStore.deleteWorkspace(workspaceId).catch(err => {
        console.error(`[WorkspaceService] Failed to delete workspace ${workspaceId} from PostgreSQL:`, err);
      });
    }
  }
}

export const workspaceService = new WorkspaceService();

